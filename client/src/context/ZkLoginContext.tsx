import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { generateNonce, generateRandomness, jwtToAddress, getExtendedEphemeralPublicKey, genAddressSeed, getZkLoginSignature } from '@mysten/sui/zklogin';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { getMainDomainOrigin } from '@/lib/queryClient';

let GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SUI_NETWORK = (import.meta.env.VITE_SUI_NETWORK as string) || 'mainnet';
const SUI_PROVER_URLS = [
  'https://prover-dev.mystenlabs.com/v1',
  'https://prover.mystenlabs.com/v1',
];

const suiClient = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK as any) });

interface ZkLoginSession {
  ephemeralKeyPair: string;
  randomness: string;
  maxEpoch: number;
  jwt: string;
  salt: string;
  address: string;
  proof: any;
  provider: string;
  subject: string;
  expiresAt: number;
}

interface ZkLoginContextType {
  zkLoginAddress: string | null;
  isZkLoginActive: boolean;
  isLoading: boolean;
  error: string | null;
  startGoogleLogin: () => Promise<void>;
  handleOAuthCallback: (hash: string) => Promise<string | null>;
  signAndExecuteZkLogin: (tx: Transaction) => Promise<{ digest: string; effects?: any }>;
  logout: () => void;
  isSessionValid: () => boolean;
  googleClientId: string;
}

const ZkLoginContext = createContext<ZkLoginContextType>({
  zkLoginAddress: null,
  isZkLoginActive: false,
  isLoading: false,
  error: null,
  startGoogleLogin: async () => {},
  handleOAuthCallback: async () => null,
  signAndExecuteZkLogin: async () => ({ digest: '' }),
  logout: () => {},
  isSessionValid: () => false,
  googleClientId: '',
});

export const useZkLogin = () => useContext(ZkLoginContext);

const SESSION_KEY = 'suibets_zklogin_session';
const PENDING_KEY = 'suibets_zklogin_pending';

function saveSession(session: ZkLoginSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    console.warn('[zkLogin] Failed to save session');
  }
}

function loadSession(): ZkLoginSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as ZkLoginSession;
    if (Date.now() > session.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function savePendingState(state: { ephemeralKeyPairExport: string; randomness: string; maxEpoch: number }) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[zkLogin] Failed to save pending state');
  }
}

function loadPendingState(): { ephemeralKeyPairExport: string; randomness: string; maxEpoch: number } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPendingState() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {}
}

export function ZkLoginProvider({ children }: { children: ReactNode }) {
  const [zkLoginAddress, setZkLoginAddress] = useState<string | null>(null);
  const [session, setSession] = useState<ZkLoginSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeClientId, setRuntimeClientId] = useState(GOOGLE_CLIENT_ID);

  useEffect(() => {
    const existingSession = loadSession();
    if (existingSession) {
      console.log('[zkLogin] Restored session for:', existingSession.address?.substring(0, 10));
      setSession(existingSession);
      setZkLoginAddress(existingSession.address);
    }

    if (!GOOGLE_CLIENT_ID) {
      fetch('/api/config/public')
        .then(res => res.json())
        .then(data => {
          if (data.googleClientId) {
            GOOGLE_CLIENT_ID = data.googleClientId;
            setRuntimeClientId(data.googleClientId);
            console.log('[zkLogin] Loaded Google Client ID from server config');
          }
        })
        .catch(() => {});
    }
  }, []);

  const isSessionValid = useCallback(() => {
    if (!session) return false;
    return Date.now() < session.expiresAt;
  }, [session]);

  const startGoogleLogin = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google login is not configured yet');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { epoch } = await suiClient.getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + 2;

      const ephemeralKeyPair = new Ed25519Keypair();
      const randomness = generateRandomness();
      const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);

      const exportedKey = ephemeralKeyPair.getSecretKey();

      const pendingState = {
        ephemeralKeyPairExport: exportedKey,
        randomness,
        maxEpoch,
      };

      savePendingState(pendingState);

      // Encode pending state in OAuth `state` param so cross-domain redirects work
      // (sessionStorage is domain-specific; when redirected from wal.app → suibets.com it would be lost)
      const encodedState = btoa(JSON.stringify(pendingState));

      const redirectUri = `${getMainDomainOrigin()}/auth/callback`;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=id_token` +
        `&scope=openid` +
        `&nonce=${nonce}` +
        `&state=${encodeURIComponent(encodedState)}`;

      console.log('[zkLogin] Redirecting to Google OAuth...');
      window.location.href = authUrl;
    } catch (err: any) {
      console.error('[zkLogin] Start login error:', err);
      setError(err.message || 'Failed to start login');
      setIsLoading(false);
    }
  }, []);

  const handleOAuthCallback = useCallback(async (hash: string): Promise<string | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams(hash.substring(1));
      const jwt = params.get('id_token');

      if (!jwt) {
        throw new Error('No token received from Google');
      }

      // Try sessionStorage first, then fall back to the OAuth state parameter
      // (state param is used when redirected cross-domain, e.g. from suibets.wal.app to suibets.com)
      let pendingState = loadPendingState();
      if (!pendingState) {
        const stateParam = params.get('state');
        if (stateParam) {
          try {
            pendingState = JSON.parse(atob(stateParam));
            console.log('[zkLogin] Restored pending state from OAuth state parameter (cross-domain flow)');
          } catch {
            // ignore decode errors
          }
        }
      }
      if (!pendingState) {
        throw new Error('Login session expired. Please try again.');
      }

      const { ephemeralKeyPairExport, randomness, maxEpoch } = pendingState;
      clearPendingState();

      const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(ephemeralKeyPairExport);

      const jwtParts = jwt.split('.');
      const payload = JSON.parse(atob(jwtParts[1]));
      const { sub, iss, aud } = payload;

      console.log('[zkLogin] JWT decoded, subject:', sub?.substring(0, 8), 'issuer:', iss);

      const saltRes = await fetch('/api/zklogin/salt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: iss, subject: sub }),
      });

      if (!saltRes.ok) {
        throw new Error('Failed to get salt from server');
      }

      const { salt } = await saltRes.json();
      const saltBigInt = BigInt('0x' + salt);

      const zkLoginAddress = jwtToAddress(jwt, saltBigInt);
      console.log('[zkLogin] Computed address:', zkLoginAddress);

      await fetch('/api/zklogin/save-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: iss, subject: sub, suiAddress: zkLoginAddress }),
      });

      const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(ephemeralKeyPair.getPublicKey());

      console.log('[zkLogin] Requesting ZK proof from prover...');
      
      const proverPayload = {
        jwt,
        extendedEphemeralPublicKey,
        maxEpoch,
        jwtRandomness: randomness,
        salt: saltBigInt.toString(),
        keyClaimName: 'sub',
      };

      let proof: any = null;
      let lastError = '';
      
      for (const proverUrl of SUI_PROVER_URLS) {
        try {
          console.log(`[zkLogin] Trying prover: ${proverUrl}`);
          const proofRes = await fetch(proverUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proverPayload),
          });

          if (proofRes.ok) {
            proof = await proofRes.json();
            console.log('[zkLogin] ZK proof obtained successfully from', proverUrl);
            break;
          } else {
            const errText = await proofRes.text();
            console.warn(`[zkLogin] Prover ${proverUrl} error:`, errText);
            lastError = errText;
          }
        } catch (fetchErr: any) {
          console.warn(`[zkLogin] Prover ${proverUrl} fetch error:`, fetchErr.message);
          lastError = fetchErr.message;
        }
      }

      if (!proof) {
        if (lastError.includes('audience') && lastError.includes('not supported')) {
          throw new Error('Google Client ID not registered with Sui ZK prover. Please contact support to register your app.');
        }
        throw new Error('Failed to generate ZK proof. Please try again later.');
      }

      const sessionData: ZkLoginSession = {
        ephemeralKeyPair: ephemeralKeyPairExport,
        randomness,
        maxEpoch,
        jwt,
        salt,
        address: zkLoginAddress,
        proof,
        provider: iss,
        subject: sub,
        expiresAt: Date.now() + (24 * 60 * 60 * 1000),
      };

      saveSession(sessionData);
      setSession(sessionData);
      setZkLoginAddress(zkLoginAddress);
      setIsLoading(false);

      return zkLoginAddress;
    } catch (err: any) {
      console.error('[zkLogin] Callback error:', err);
      setError(err.message || 'Login failed');
      setIsLoading(false);
      return null;
    }
  }, []);

  const signAndExecuteZkLogin = useCallback(async (tx: Transaction): Promise<{ digest: string; effects?: any }> => {
    if (!session || !isSessionValid()) {
      throw new Error('zkLogin session expired. Please sign in again.');
    }

    try {
      const ephemeralKeyPair = Ed25519Keypair.fromSecretKey(session.ephemeralKeyPair);

      tx.setSender(session.address);
      const txBytes = await tx.build({ client: suiClient });

      const { signature: ephemeralSignature } = await ephemeralKeyPair.signTransaction(txBytes);

      const jwtParts = session.jwt.split('.');
      const payload = JSON.parse(atob(jwtParts[1]));
      const saltBigInt = BigInt('0x' + session.salt);

      const addressSeed = genAddressSeed(
        saltBigInt,
        'sub',
        payload.sub,
        typeof payload.aud === 'string' ? payload.aud : payload.aud[0]
      ).toString();

      const zkLoginSignature = getZkLoginSignature({
        inputs: {
          ...session.proof,
          addressSeed,
        },
        maxEpoch: session.maxEpoch,
        userSignature: ephemeralSignature,
      });

      const result = await suiClient.executeTransactionBlock({
        transactionBlock: txBytes,
        signature: zkLoginSignature,
      });

      console.log('[zkLogin] Transaction executed:', result.digest);
      return { digest: result.digest, effects: result.effects };
    } catch (err: any) {
      console.error('[zkLogin] Transaction error:', err);
      throw new Error(err.message || 'Transaction failed');
    }
  }, [session, isSessionValid]);

  const logout = useCallback(() => {
    console.log('[zkLogin] Logging out');
    sessionStorage.removeItem(SESSION_KEY);
    clearPendingState();
    setSession(null);
    setZkLoginAddress(null);
    setError(null);
  }, []);

  return (
    <ZkLoginContext.Provider
      value={{
        zkLoginAddress,
        isZkLoginActive: !!zkLoginAddress && isSessionValid(),
        isLoading,
        error,
        startGoogleLogin,
        handleOAuthCallback,
        signAndExecuteZkLogin,
        logout,
        isSessionValid,
        googleClientId: runtimeClientId,
      }}
    >
      {children}
    </ZkLoginContext.Provider>
  );
}
