import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, WalletIcon, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  useCurrentAccount, 
  useConnectWallet,
  useWallets,
} from '@mysten/dapp-kit';
import { getWallets } from '@wallet-standard/app';
import { useZkLogin } from '@/context/ZkLoginContext';
import { SiGoogle } from 'react-icons/si';

interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface WalletInfo {
  name: string;
  icon?: string;
  wallet: any;
  source: 'standard' | 'dappkit' | 'direct';
}

export function ConnectWalletModal({ isOpen, onClose }: ConnectWalletModalProps) {
  const { toast } = useToast();
  const { startGoogleLogin, isLoading: zkLoading, googleClientId } = useZkLogin();
  const [connecting, setConnecting] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allWallets, setAllWallets] = useState<WalletInfo[]>([]);
  
  // Single ref to track connection completion - prevents duplicate processing
  const connectionHandledRef = useRef(false);
  const lastProcessedAddressRef = useRef<string | null>(null);

  const currentAccount = useCurrentAccount();
  const dappkitWallets = useWallets();
  const { mutate: connectDappKit } = useConnectWallet();

  // Unified connection finalization - ONLY place that shows toast and closes modal
  // AuthContext automatically syncs with dapp-kit's currentAccount
  const handleConnectionSuccess = useCallback(async (address: string, walletName: string) => {
    // Prevent duplicate handling
    if (connectionHandledRef.current || lastProcessedAddressRef.current === address) {
      console.log('Connection already handled for:', address);
      return;
    }
    
    connectionHandledRef.current = true;
    lastProcessedAddressRef.current = address;
    
    console.log('=== CONNECTION SUCCESS ===');
    console.log('Address:', address);
    console.log('Wallet:', walletName);
    
    // Show single success toast
    toast({
      title: "Wallet Connected",
      description: `Connected: ${address.substring(0, 8)}...${address.slice(-6)}`,
    });
    
    // Clean up UI state
    setConnecting(false);
    setConnectingWallet(null);
    setError(null);
    
    // Close modal - AuthContext will auto-sync via useCurrentAccount
    onClose();
  }, [toast, onClose]);

  // Detect all available wallets
  const detectAllWallets = useCallback(() => {
    const walletMap = new Map<string, WalletInfo>();
    
    // 1. Check dapp-kit wallets first (most reliable)
    dappkitWallets.forEach((wallet) => {
      console.log('Dapp-kit wallet found:', wallet.name);
      walletMap.set(wallet.name, {
        name: wallet.name,
        icon: wallet.icon,
        wallet: wallet,
        source: 'dappkit'
      });
    });
    
    // 2. Check wallet-standard API
    try {
      const walletsApi = getWallets();
      const registeredWallets = walletsApi.get();
      
      registeredWallets.forEach((wallet: any) => {
        if (walletMap.has(wallet.name)) return; // Skip if already added via dapp-kit
        
        const hasSuiFeature = wallet.features?.['sui:signAndExecuteTransactionBlock'] || 
                              wallet.features?.['sui:signTransactionBlock'] ||
                              wallet.features?.['standard:connect'] ||
                              wallet.chains?.some((c: string) => c.includes('sui'));
        
        const isKnownWallet = ['slush', 'nightly', 'suiet', 'ethos', 'martian', 'solflare'].some(n => 
          wallet.name?.toLowerCase().includes(n));
        
        if (hasSuiFeature || isKnownWallet) {
          console.log('Wallet-standard wallet found:', wallet.name);
          walletMap.set(wallet.name, {
            name: wallet.name,
            icon: wallet.icon,
            wallet: wallet,
            source: 'standard'
          });
        }
      });
    } catch (e) {
      console.log('Wallet-standard API not available');
    }
    
    // 3. Check window globals as fallback - comprehensive Nightly detection
    const win = window as any;
    const directWallets = [
      { check: () => win.slush, name: 'Slush' },
      { check: () => win.suiWallet, name: 'Sui Wallet' },
      { check: () => win.nightly?.sui || win.nightly?.wallets?.sui || win.nightly?.wallets?.SUI || win.nightly, name: 'Nightly' },
      { check: () => win.suiet, name: 'Suiet' },
      { check: () => win.ethos, name: 'Ethos Wallet' },
      { check: () => win.martian?.sui || win.martian, name: 'Martian Sui Wallet' },
      { check: () => win.solflare?.sui || win.solflare, name: 'Solflare' },
    ];
    
    directWallets.forEach(({ check, name }) => {
      try {
        const walletObj = check();
        if (walletObj && !walletMap.has(name)) {
          console.log('Window wallet found:', name);
          walletMap.set(name, {
            name: name,
            wallet: walletObj,
            source: 'direct'
          });
        }
      } catch {}
    });
    
    const walletList = Array.from(walletMap.values());
    console.log('Total wallets detected:', walletList.length, walletList.map(w => w.name));
    setAllWallets(walletList);
    return walletList;
  }, [dappkitWallets]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Reset refs when modal opens to allow new connections
      connectionHandledRef.current = false;
      lastProcessedAddressRef.current = null;
      setError(null);
      setConnecting(false);
      setConnectingWallet(null);
      
      // Detect wallets
      detectAllWallets();
      
      // Re-detect after delays to catch late-loading extensions
      const timers = [200, 800, 1500].map(delay => 
        setTimeout(detectAllWallets, delay)
      );
      
      // Listen for new wallet registrations
      try {
        const walletsApi = getWallets();
        const unsubscribe = walletsApi.on('register', detectAllWallets);
        return () => {
          timers.forEach(clearTimeout);
          unsubscribe();
        };
      } catch {
        return () => timers.forEach(clearTimeout);
      }
    }
  }, [isOpen, detectAllWallets]);

  // Watch for dapp-kit connection changes - this handles connections made via dapp-kit
  useEffect(() => {
    if (!isOpen) return;
    
    const address = currentAccount?.address;
    if (!address) return;
    
    // Check if we should handle this connection
    if (connectionHandledRef.current || lastProcessedAddressRef.current === address) {
      return;
    }
    
    // Dapp-kit connected successfully
    console.log('Dapp-kit currentAccount changed:', address);
    handleConnectionSuccess(address, connectingWallet || 'sui');
  }, [currentAccount?.address, isOpen, connectingWallet, handleConnectionSuccess]);

  // Main connection function
  const connectToWallet = async (walletInfo: WalletInfo) => {
    if (connecting) return;
    
    setConnecting(true);
    setConnectingWallet(walletInfo.name);
    setError(null);
    
    console.log('Attempting to connect:', walletInfo.name, 'source:', walletInfo.source);
    
    try {
      // METHOD 1: Use dapp-kit if wallet is available there
      const dappkitWallet = dappkitWallets.find(w => 
        w.name === walletInfo.name || 
        w.name.toLowerCase().includes(walletInfo.name.toLowerCase())
      );
      
      if (dappkitWallet) {
        console.log('Connecting via dapp-kit...');
        connectDappKit({ wallet: dappkitWallet }, {
          onSuccess: () => {
            console.log('Dapp-kit connect mutation succeeded');
            // The useEffect watching currentAccount will handle the rest
          },
          onError: (err) => {
            console.error('Dapp-kit connect failed:', err);
            // Try direct connection as fallback
            tryDirectConnection(walletInfo);
          }
        });
        return;
      }
      
      // METHOD 2: Use wallet-standard connect
      if (walletInfo.source === 'standard' && walletInfo.wallet?.features?.['standard:connect']) {
        console.log('Connecting via wallet-standard...');
        try {
          const result = await walletInfo.wallet.features['standard:connect'].connect();
          const address = result?.accounts?.[0]?.address;
          if (address) {
            await handleConnectionSuccess(address, walletInfo.name);
            return;
          }
        } catch (e) {
          console.error('Wallet-standard connect failed:', e);
        }
      }
      
      // METHOD 3: Direct window connection
      await tryDirectConnection(walletInfo);
      
    } catch (err: any) {
      console.error('Connection error:', err);
      setError(err?.message || "Connection failed. Please try again.");
      setConnecting(false);
      setConnectingWallet(null);
    }
  };
  
  // Direct connection via window globals
  const tryDirectConnection = async (walletInfo: WalletInfo) => {
    const win = window as any;
    const name = walletInfo.name.toLowerCase();
    
    console.log('Trying direct connection for:', name);
    
    try {
      let address: string | null = null;
      
      // Slush / Sui Wallet
      if (name.includes('slush') || name.includes('sui wallet')) {
        const wallet = win.slush || win.suiWallet;
        if (wallet) {
          try { await wallet.requestPermissions?.(); } catch {}
          const accounts = await wallet.getAccounts?.() || [];
          if (accounts.length > 0) {
            address = accounts[0];
          } else {
            const result = await wallet.connect?.();
            address = result?.accounts?.[0]?.address;
          }
        }
      }
      // Nightly - comprehensive detection
      else if (name.includes('nightly')) {
        const nightly = win.nightly;
        if (nightly) {
          // Try multiple Nightly connection methods
          const suiWallet = nightly.sui || nightly.wallets?.sui || nightly.wallets?.SUI;
          if (suiWallet) {
            try {
              const result = await suiWallet.connect();
              address = result?.accounts?.[0]?.address || result?.publicKey;
            } catch (e) {
              console.log('Nightly sui.connect failed, trying alternatives');
            }
          }
          // Fallback to generic nightly.connect
          if (!address && nightly.connect) {
            try {
              const result = await nightly.connect({ network: 'sui' });
              address = result?.accounts?.[0]?.address || result?.publicKey || result?.address;
            } catch (e) {
              console.log('Nightly generic connect failed:', e);
            }
          }
        }
      }
      // Suiet
      else if (name.includes('suiet')) {
        const wallet = win.suiet;
        if (wallet) {
          try { await wallet.requestPermissions?.(); } catch {}
          const result = await wallet.connect?.();
          address = result?.accounts?.[0]?.address || (await wallet.getAccounts?.())?.[0];
        }
      }
      // Ethos
      else if (name.includes('ethos')) {
        const wallet = win.ethos;
        if (wallet) {
          const result = await wallet.connect?.();
          address = result?.accounts?.[0]?.address || result?.address;
        }
      }
      // Martian
      else if (name.includes('martian')) {
        const wallet = win.martian?.sui || win.martian;
        if (wallet) {
          const result = await wallet.connect?.();
          address = result?.accounts?.[0]?.address || result?.address;
        }
      }
      // Solflare
      else if (name.includes('solflare')) {
        const wallet = win.solflare;
        if (wallet?.sui) {
          const result = await wallet.sui.connect?.();
          address = result?.accounts?.[0]?.address;
        } else if (wallet) {
          await wallet.connect?.();
          address = wallet.publicKey?.toString?.();
        }
      }
      
      if (address) {
        await handleConnectionSuccess(address, walletInfo.name);
      } else {
        throw new Error(`Could not get address from ${walletInfo.name}`);
      }
    } catch (err: any) {
      console.error('Direct connection failed:', err);
      setError(err?.message || `Failed to connect to ${walletInfo.name}`);
      setConnecting(false);
      setConnectingWallet(null);
    }
  };

  // Quick connect - auto-select best wallet
  const handleQuickConnect = async () => {
    const wallets = detectAllWallets();
    
    if (wallets.length === 0) {
      setError("No wallet found. Please install Slush, Nightly, or Suiet wallet extension.");
      return;
    }
    
    // Priority order
    const priority = ['slush', 'sui wallet', 'nightly', 'suiet'];
    const bestWallet = wallets.find(w => 
      priority.some(p => w.name.toLowerCase().includes(p))
    ) || wallets[0];
    
    await connectToWallet(bestWallet);
  };

  const displayWallets = allWallets.filter(w => 
    w.name !== 'Stashed' && !w.name.toLowerCase().includes('stashed')
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Connect Wallet</DialogTitle>
          <DialogDescription>
            Connect your Sui wallet to continue
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="w-full p-4 bg-gradient-to-r from-cyan-900/30 to-blue-900/30 rounded-lg border border-cyan-500/30">
            <h3 className="text-lg font-bold mb-3 text-center text-[#00FFFF]">
              Quick Connect
            </h3>
            <Button
              onClick={handleQuickConnect}
              disabled={connecting}
              className="w-full bg-[#00FFFF] hover:bg-[#00DDDD] text-black font-bold py-4 text-lg"
              data-testid="button-quick-connect"
            >
              {connecting && !connectingWallet ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <WalletIcon className="mr-2 h-5 w-5" />
                  Connect Wallet
                </>
              )}
            </Button>
          </div>

          {googleClientId && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-700" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-[#0d1b1e] px-2 text-gray-500">or sign in with</span>
              </div>
            </div>
          )}

          {googleClientId && (
            <Button
              variant="outline"
              className="w-full py-3 hover:bg-cyan-900/20 hover:border-cyan-500/50 border-gray-700"
              onClick={async () => {
                try {
                  await startGoogleLogin();
                } catch (err: any) {
                  setError(err.message || 'Failed to start Google login');
                }
              }}
              disabled={zkLoading || connecting}
              data-testid="button-google-zklogin"
            >
              {zkLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <SiGoogle className="mr-2 h-5 w-5 text-white" />
                  <span className="text-white">Continue with Google</span>
                  <span className="ml-auto text-xs text-cyan-400">zkLogin</span>
                </>
              )}
            </Button>
          )}

          {displayWallets.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 text-center">
                Detected wallets ({displayWallets.length}):
              </p>
              {displayWallets.map((walletInfo) => (
                <Button
                  key={walletInfo.name}
                  variant="outline"
                  className="w-full justify-start py-3 hover:bg-cyan-900/20 hover:border-cyan-500/50"
                  onClick={() => connectToWallet(walletInfo)}
                  disabled={connecting}
                  data-testid={`wallet-${walletInfo.name.toLowerCase().replace(/\s/g, '-')}`}
                >
                  {connectingWallet === walletInfo.name ? (
                    <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                  ) : walletInfo.icon ? (
                    <img 
                      src={walletInfo.icon} 
                      alt={walletInfo.name} 
                      className="w-6 h-6 mr-3 rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <WalletIcon className="w-6 h-6 mr-3" />
                  )}
                  <span className="text-white">{walletInfo.name}</span>
                  <span className="ml-auto text-xs text-green-400">Detected</span>
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-amber-400 text-sm mb-3">
                Checking for wallet extensions...
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={detectAllWallets}
                className="text-cyan-400 border-cyan-500/50"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Check Again
              </Button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg">
              <p className="text-red-400 text-sm flex items-center">
                <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                {error}
              </p>
            </div>
          )}

          <div className="text-center text-xs text-gray-500 pt-2 border-t border-gray-700">
            <p className="mb-2">
              Don't have a wallet? Install one:
            </p>
            <div className="flex justify-center gap-3">
              <a href="https://slush.dev" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">Slush</a>
              <a href="https://nightly.app" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">Nightly</a>
              <a href="https://suiet.app" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">Suiet</a>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
