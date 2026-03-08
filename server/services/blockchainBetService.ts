import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const SBETS_PACKAGE_ID = process.env.SBETS_TOKEN_ADDRESS?.split('::')[0] || '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285';
const SBETS_COIN_TYPE = process.env.SBETS_TOKEN_ADDRESS || `${SBETS_PACKAGE_ID}::sbets::SBETS`;
// Contract addresses - redeployed January 29, 2026 with SHARED OBJECT fix for settlements
const BETTING_PACKAGE_ID = process.env.BETTING_PACKAGE_ID || '0x737324ddac9fb96e3d7ffab524f5489c1a0b3e5b4bffa2f244303005001b4ada';
const BETTING_PLATFORM_ID = process.env.BETTING_PLATFORM_ID || '0x5fc1073c9533c6737fa3a0882055d1778602681df70bdabde96b0127b588f082';
const ADMIN_CAP_ID = process.env.ADMIN_CAP_ID || '0xf51a04becf8c215dee71c9b92a063e4c5ef1ebc2fc3fad0797196895f8589296';
// Admin wallet that owns AdminCap - MUST match the wallet that deployed the contract
const ADMIN_WALLET = process.env.ADMIN_WALLET_ADDRESS || '0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50';
const PLATFORM_REVENUE_WALLET = process.env.PLATFORM_REVENUE_WALLET || ADMIN_WALLET;
const REVENUE_WALLET = process.env.REVENUE_WALLET_ADDRESS || ADMIN_WALLET;
// SECURITY: ADMIN_PRIVATE_KEY must be stored as encrypted secret on Railway/production
// NEVER log, expose, or commit this value. Used only for on-chain payouts.
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

// Validate configuration on startup
if (!BETTING_PACKAGE_ID || !BETTING_PLATFORM_ID) {
  console.warn('⚠️ BETTING_PACKAGE_ID or BETTING_PLATFORM_ID not set - on-chain betting disabled');
}
console.log(`📦 Betting Package ID: ${BETTING_PACKAGE_ID}`);
console.log(`🏛️ Platform Object ID: ${BETTING_PLATFORM_ID}`);
console.log(`🎫 Admin Cap ID: ${ADMIN_CAP_ID || 'NOT SET'}`);
console.log(`👤 Admin Wallet: ${ADMIN_WALLET}`);

// SECURITY: Only log existence, never the key itself
if (ADMIN_PRIVATE_KEY) {
  console.log(`🔐 Admin Private Key: CONFIGURED (length: ${ADMIN_PRIVATE_KEY.length})`);
} else {
  console.warn('⚠️ ADMIN_PRIVATE_KEY not set - on-chain payouts/withdrawals will be disabled');
  console.warn('   To enable: Add ADMIN_PRIVATE_KEY as a secret on Railway');
}

export interface OnChainBet {
  betId: string;
  walletAddress: string;
  eventId: string;
  prediction: string;
  betAmount: number;
  odds: number;
  potentialPayout: number;
  txHash: string;
  blockHeight?: number;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'settled' | 'failed';
}

export interface TransactionPayload {
  target: string;
  arguments: any[];
  typeArguments?: string[];
}

const rejectedOnChainBets = new Set<string>();

export class BlockchainBetService {
  private client: SuiClient;
  private network: 'mainnet' | 'testnet' | 'devnet';

  private static readonly KNOWN_SPORT_SLUGS = new Set([
    'basketball', 'baseball', 'ice-hockey', 'mma', 'american-football',
    'afl', 'formula-1', 'handball', 'nfl', 'rugby', 'volleyball',
    'tennis', 'boxing', 'horse-racing'
  ]);

  constructor() {
    this.network = (process.env.SUI_NETWORK as 'mainnet' | 'testnet' | 'devnet') || 'mainnet';
    this.client = new SuiClient({ url: getFullnodeUrl(this.network) });
    console.log(`BlockchainBetService initialized on ${this.network}`);
  }

  private extractParlayLegIds(extId: string): string[] {
    const parts = extId.split('_');
    const remaining = parts.slice(2);
    const eventIds: string[] = [];
    let i = 0;

    while (i < remaining.length) {
      const current = remaining[i];

      if (BlockchainBetService.KNOWN_SPORT_SLUGS.has(current) && i + 1 < remaining.length) {
        eventIds.push(`${current}_${remaining[i + 1]}`);
        i += 2;
      } else if (i + 1 < remaining.length) {
        const hyphenated = `${current}-${remaining[i + 1]}`;
        if (BlockchainBetService.KNOWN_SPORT_SLUGS.has(hyphenated) && i + 2 < remaining.length) {
          eventIds.push(`${hyphenated}_${remaining[i + 2]}`);
          i += 3;
        } else {
          eventIds.push(current);
          i += 1;
        }
      } else {
        eventIds.push(current);
        i += 1;
      }
    }

    return eventIds;
  }

  async buildBetTransaction(
    walletAddress: string,
    eventId: string,
    prediction: string,
    betAmount: number,
    odds: number,
    marketId: string = 'match_winner',
    walrusBlobId: string = ''
  ): Promise<TransactionPayload> {
    const oddsInBps = Math.floor(odds * 100);

    // Full contract signature: place_bet(platform, payment, event_id, market_id, prediction, odds, walrus_blob_id, clock)
    // Note: payment coin must be constructed by caller, clock is 0x6
    return {
      target: `${BETTING_PACKAGE_ID}::betting::place_bet`,
      arguments: [
        BETTING_PLATFORM_ID,
        // payment coin must be added by caller
        Array.from(new TextEncoder().encode(eventId)),
        Array.from(new TextEncoder().encode(marketId)),
        Array.from(new TextEncoder().encode(prediction)),
        oddsInBps,
        Array.from(new TextEncoder().encode(walrusBlobId)),
        '0x6', // clock object
      ],
      typeArguments: []
    };
  }

  buildClientTransaction(
    eventId: string,
    prediction: string,
    betAmountMist: number,
    odds: number,
    marketId: string,
    walrusBlobId: string
  ): {
    packageId: string;
    module: string;
    function: string;
    platformId: string;
    betAmountMist: number;
    clockObjectId: string;
    moveCallArgs: {
      platform: string;
      eventId: number[];
      marketId: number[];
      prediction: number[];
      oddsBps: number;
      walrusBlobId: number[];
    };
    instructions: string;
  } {
    return {
      packageId: BETTING_PACKAGE_ID,
      module: 'betting',
      function: 'place_bet',
      platformId: BETTING_PLATFORM_ID,
      betAmountMist,
      clockObjectId: '0x6',
      moveCallArgs: {
        platform: BETTING_PLATFORM_ID,
        eventId: Array.from(new TextEncoder().encode(eventId)),
        marketId: Array.from(new TextEncoder().encode(marketId)),
        prediction: Array.from(new TextEncoder().encode(prediction)),
        oddsBps: Math.floor(odds * 100),
        walrusBlobId: Array.from(new TextEncoder().encode(walrusBlobId)),
      },
      instructions: `
        1. Split ${betAmountMist} MIST from your SUI coins
        2. Call ${BETTING_PACKAGE_ID}::betting::place_bet with:
           - platform: ${BETTING_PLATFORM_ID} (shared object)
           - payment: [split coin]
           - event_id: [encoded bytes]
           - market_id: [encoded bytes]
           - prediction: [encoded bytes]
           - odds: ${Math.floor(odds * 100)} (in basis points)
           - walrus_blob_id: [encoded bytes]
           - clock: 0x6
      `.trim()
    };
  }

  async buildSettlementTransaction(
    betId: string,
    betObjectId: string,
    won: boolean
  ): Promise<TransactionPayload> {
    // Full contract signature: settle_bet_admin(admin_cap, platform, bet, won, clock)
    return {
      target: `${BETTING_PACKAGE_ID}::betting::settle_bet_admin`,
      arguments: [
        BETTING_PLATFORM_ID,
        betObjectId,
        won,
        '0x6', // clock object
      ],
      typeArguments: []
    };
  }

  getBettingPlatformId(): string {
    return BETTING_PLATFORM_ID;
  }

  async verifyTransaction(txHash: string): Promise<{
    confirmed: boolean;
    blockHeight?: number;
    timestamp?: number;
    effects?: any;
  }> {
    try {
      const txResponse = await this.client.getTransactionBlock({
        digest: txHash,
        options: {
          showEffects: true,
          showEvents: true
        }
      });

      if (txResponse && txResponse.effects) {
        return {
          confirmed: txResponse.effects.status?.status === 'success',
          blockHeight: parseInt(txResponse.checkpoint || '0'),
          timestamp: parseInt(txResponse.timestampMs || '0'),
          effects: txResponse.effects
        };
      }

      return { confirmed: false };
    } catch (error) {
      console.error('Error verifying transaction:', error);
      return { confirmed: false };
    }
  }

  async verifySbetsTransfer(txHash: string, expectedSender: string, expectedAmount: number): Promise<{
    verified: boolean;
    sender?: string;
    recipient?: string;
    amount?: number;
    error?: string;
  }> {
    if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
      return { verified: false, error: 'Invalid transaction hash' };
    }

    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 3000, 4000, 5000, 6000];
    let lastError = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1] || 6000;
          console.log(`[Verify] Retry ${attempt}/${MAX_RETRIES - 1} for TX ${txHash.slice(0, 12)}... (waiting ${delay}ms for indexing)`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const fetchOptions = {
          showEffects: true,
          showBalanceChanges: true,
          showInput: true,
          showObjectChanges: true,
        };

        let txResponse;
        try {
          txResponse = await this.client.waitForTransaction({
            digest: txHash,
            timeout: 10000,
            pollInterval: 1500,
            options: fetchOptions,
          });
        } catch (waitErr: any) {
          txResponse = await this.client.getTransactionBlock({
            digest: txHash,
            options: fetchOptions,
          });
        }

        if (!txResponse) {
          lastError = 'Transaction not found on-chain';
          continue;
        }

        if (txResponse.effects?.status?.status !== 'success') {
          return { verified: false, error: 'Transaction failed on-chain' };
        }

        const sender = txResponse.transaction?.data?.sender;
        if (!sender || sender.toLowerCase() !== expectedSender.toLowerCase()) {
          return { verified: false, error: `Sender mismatch: expected ${expectedSender.slice(0,10)}..., got ${sender?.slice(0,10)}...` };
        }

        const balanceChanges = txResponse.balanceChanges || [];
        console.log(`[Verify] TX ${txHash.slice(0, 12)}... balance changes (attempt ${attempt + 1}):`, JSON.stringify(balanceChanges.map((bc: any) => ({ coinType: bc.coinType, amount: bc.amount, owner: bc.owner }))));

        const sbetsChanges = balanceChanges.filter((bc: any) =>
          bc.coinType && bc.coinType.includes('::sbets::SBETS')
        );

        if (sbetsChanges.length > 0) {
          const adminWallet = ADMIN_WALLET.toLowerCase();
          const adminReceive = sbetsChanges.find((bc: any) =>
            bc.owner?.AddressOwner?.toLowerCase() === adminWallet &&
            BigInt(bc.amount) > 0
          );

          if (!adminReceive) {
            const recipients = sbetsChanges.filter((bc: any) => BigInt(bc.amount) > 0).map((bc: any) => bc.owner?.AddressOwner?.slice(0, 10) || 'unknown');
            return { verified: false, error: `SBETS not sent to platform treasury wallet (sent to: ${recipients.join(', ')})` };
          }

          const receivedAmount = Number(BigInt(adminReceive.amount)) / 1_000_000_000;
          if (receivedAmount < expectedAmount) {
            return { verified: false, error: `Amount too low: expected ${expectedAmount} SBETS, received ${receivedAmount} SBETS` };
          }
          if (receivedAmount > expectedAmount * 1.5) {
            return { verified: false, error: `Amount suspiciously high: expected ${expectedAmount} SBETS, received ${receivedAmount} SBETS` };
          }

          console.log(`[Verify] SBETS transfer verified via balanceChanges: ${sender.slice(0,10)}... -> treasury | ${receivedAmount} SBETS | TX: ${txHash}`);
          return {
            verified: true,
            sender,
            recipient: adminWallet,
            amount: receivedAmount
          };
        }

        const objectChanges = txResponse.objectChanges || [];
        const sbetsObjectChanges = objectChanges.filter((oc: any) =>
          oc.objectType && oc.objectType.includes('::sbets::SBETS') ||
          oc.type === 'created' && oc.objectType?.includes('0x2::coin::Coin') && oc.objectType?.includes('sbets')
        );

        if (sbetsObjectChanges.length > 0) {
          console.log(`[Verify] TX ${txHash.slice(0, 12)}... SBETS object changes found:`, JSON.stringify(sbetsObjectChanges.map((oc: any) => ({ type: oc.type, objectType: oc.objectType, owner: oc.owner }))));

          const adminWallet = ADMIN_WALLET.toLowerCase();
          const createdForAdmin = sbetsObjectChanges.find((oc: any) =>
            (oc.type === 'created' || oc.type === 'mutated') &&
            oc.owner?.AddressOwner?.toLowerCase() === adminWallet
          );

          if (createdForAdmin) {
            console.log(`[Verify] SBETS transfer verified via objectChanges (coin object created/mutated for treasury): ${sender.slice(0,10)}... -> treasury | TX: ${txHash}`);
            return {
              verified: true,
              sender,
              recipient: adminWallet,
              amount: expectedAmount
            };
          }
        }

        const effects = txResponse.effects;
        if (effects?.created || effects?.mutated) {
          const allAffected = [...(effects.created || []), ...(effects.mutated || [])];
          const adminOwned = allAffected.filter((obj: any) =>
            obj.owner?.AddressOwner?.toLowerCase() === ADMIN_WALLET.toLowerCase()
          );

          if (adminOwned.length > 0 && attempt >= 2) {
            const senderSent = sbetsChanges.length === 0 && balanceChanges.some((bc: any) =>
              bc.coinType?.includes('SUI') && BigInt(bc.amount) < 0
            );

            if (senderSent || adminOwned.length > 0) {
              try {
                for (const obj of adminOwned) {
                  const objectId = obj.reference?.objectId;
                  if (!objectId) continue;
                  const objData = await this.client.getObject({
                    id: objectId,
                    options: { showType: true }
                  });
                  if (objData?.data?.type?.includes('::sbets::SBETS')) {
                    console.log(`[Verify] SBETS transfer verified via object inspection: Object ${objectId} is SBETS coin owned by treasury | TX: ${txHash}`);
                    return {
                      verified: true,
                      sender,
                      recipient: ADMIN_WALLET.toLowerCase(),
                      amount: expectedAmount
                    };
                  }
                }
              } catch (objErr: any) {
                console.error(`[Verify] Object inspection failed: ${objErr.message}`);
              }
            }
          }
        }

        lastError = `No SBETS transfer found in transaction (${balanceChanges.length} balance changes found, types: ${balanceChanges.map((bc: any) => bc.coinType?.split('::').pop() || 'unknown').join(', ') || 'none'})`;
        if (attempt < MAX_RETRIES - 1) continue;
        return { verified: false, error: lastError };
      } catch (error: any) {
        lastError = error.message;
        console.error(`[Verify] Attempt ${attempt + 1}/${MAX_RETRIES} failed for TX ${txHash.slice(0, 12)}...: ${error.message}`);
        if (attempt === MAX_RETRIES - 1) {
          return { verified: false, error: `Verification failed after ${MAX_RETRIES} attempts: ${lastError}` };
        }
      }
    }
    return { verified: false, error: `Verification failed: ${lastError}` };
  }

  async getWalletBalance(walletAddress: string): Promise<{
    sui: number;
    sbets: number;
  }> {
    try {
      const suiBalance = await this.client.getBalance({
        owner: walletAddress,
        coinType: '0x2::sui::SUI'
      });

      let sbetsBalance = { totalBalance: '0' };
      try {
        sbetsBalance = await this.client.getBalance({
          owner: walletAddress,
          coinType: `${SBETS_PACKAGE_ID}::sbets::SBETS`
        });
      } catch (e) {
      }

      return {
        sui: parseInt(suiBalance.totalBalance) / 1e9,
        sbets: parseInt(sbetsBalance.totalBalance) / 1e9
      };
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      return { sui: 0, sbets: 0 };
    }
  }

  async recordBetOnChain(bet: {
    betId: string;
    walletAddress: string;
    eventId: string;
    prediction: string;
    betAmount: number;
    odds: number;
    txHash: string;
  }): Promise<OnChainBet> {
    const onChainBet: OnChainBet = {
      betId: bet.betId,
      walletAddress: bet.walletAddress,
      eventId: bet.eventId,
      prediction: bet.prediction,
      betAmount: bet.betAmount,
      odds: bet.odds,
      potentialPayout: bet.betAmount * bet.odds,
      txHash: bet.txHash,
      timestamp: Date.now(),
      status: 'pending'
    };

    if (bet.txHash && bet.txHash.startsWith('0x') && bet.txHash.length > 10) {
      const verification = await this.verifyTransaction(bet.txHash);
      if (verification.confirmed) {
        onChainBet.status = 'confirmed';
        onChainBet.blockHeight = verification.blockHeight;
      }
    }

    console.log(`📦 ON-CHAIN BET RECORDED: ${bet.betId} | ${bet.walletAddress.slice(0, 8)}... | ${bet.betAmount} SUI @ ${bet.odds}x`);

    return onChainBet;
  }

  async getOnChainBetStatus(txHash: string): Promise<'pending' | 'confirmed' | 'failed'> {
    const verification = await this.verifyTransaction(txHash);
    if (verification.confirmed) {
      return 'confirmed';
    }
    return 'pending';
  }

  getPackageId(): string {
    return SBETS_PACKAGE_ID;
  }

  getBettingPackageId(): string {
    return BETTING_PACKAGE_ID;
  }

  getRevenueWallet(): string {
    return REVENUE_WALLET;
  }

  getAdminWallet(): string {
    return ADMIN_WALLET;
  }

  // Check if admin key is configured for on-chain payouts
  isAdminKeyConfigured(): boolean {
    return !!ADMIN_PRIVATE_KEY && ADMIN_PRIVATE_KEY.length > 0;
  }

  getAdminKeypair(): Ed25519Keypair | null {
    if (!ADMIN_PRIVATE_KEY) {
      console.warn('⚠️ ADMIN_PRIVATE_KEY not configured - on-chain payouts disabled');
      return null;
    }
    
    try {
      let keyBytes: Uint8Array;
      
      // Support multiple formats: hex, base64, or Sui bech32 format
      if (ADMIN_PRIVATE_KEY.startsWith('suiprivkey')) {
        // Sui bech32 format - use decodeSuiPrivateKey
        try {
          const decoded = decodeSuiPrivateKey(ADMIN_PRIVATE_KEY);
          return Ed25519Keypair.fromSecretKey(decoded.secretKey);
        } catch (e) {
          console.error('❌ Failed to parse Sui bech32 private key:', e);
          return null;
        }
      } else if (ADMIN_PRIVATE_KEY.startsWith('0x')) {
        // Hex format
        const hexKey = ADMIN_PRIVATE_KEY.slice(2);
        keyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
      } else {
        // Assume base64 encoding
        keyBytes = new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));
      }
      
      // Handle different key formats:
      // - 32 bytes: raw secret seed (ready to use)
      // - 33 bytes: 1 scheme byte + 32 secret seed (strip scheme)
      // - 64 bytes: 32 secret + 32 public (use first 32)
      // - 65 bytes: 1 scheme + 32 secret + 32 public (strip scheme, use first 32)
      
      if (keyBytes.length === 33 && keyBytes[0] === 0) {
        // Strip the scheme byte prefix (0x00 for Ed25519)
        keyBytes = keyBytes.slice(1);
      } else if (keyBytes.length === 65 && keyBytes[0] === 0) {
        // Strip scheme byte and take first 32 bytes (secret seed)
        keyBytes = keyBytes.slice(1, 33);
      } else if (keyBytes.length === 64) {
        // Full keypair format (secret + public), take only first 32 bytes
        keyBytes = keyBytes.slice(0, 32);
      }
      
      if (keyBytes.length !== 32) {
        console.error(`❌ Invalid private key length: ${keyBytes.length} (expected 32 bytes)`);
        console.error('   Supported formats: 32-byte raw seed, 33-byte with scheme prefix, or suiprivkey bech32');
        return null;
      }
      
      const keypair = Ed25519Keypair.fromSecretKey(keyBytes);
      console.log(`✅ Admin keypair loaded: ${keypair.toSuiAddress().slice(0, 12)}...`);
      return keypair;
    } catch (error) {
      console.error('❌ Failed to parse ADMIN_PRIVATE_KEY:', error);
      return null;
    }
  }

  // Execute on-chain SUI payout to user (for withdrawals)
  // Returns explicit error if keypair loading fails
  async executePayoutOnChain(
    recipientAddress: string,
    amountSui: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amountSui || amountSui <= 0) {
      console.warn(`⚠️ PAYOUT SKIPPED: Zero or negative amount (${amountSui} SUI) to ${recipientAddress}`);
      return { success: false, error: 'Amount must be positive - skipping zero-value transaction' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured or invalid format';
      console.error(`❌ PAYOUT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const amountMist = Math.floor(amountSui * 1e9);
      
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [amountMist]);
      tx.transferObjects([coin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN PAYOUT: ${amountSui} SUI to ${recipientAddress} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        console.error(`❌ PAYOUT FAILED: ${result.effects?.status?.error || 'Unknown error'}`);
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error('❌ Payout execution error:', error);
      return { success: false, error: error.message || 'Failed to execute payout' };
    }
  }

  /**
   * Execute on-chain SBETS payout to recipient
   * Requires admin wallet to have SBETS tokens
   */
  async executePayoutSbetsOnChain(
    recipientAddress: string,
    amountSbets: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amountSbets || amountSbets <= 0) {
      console.warn(`⚠️ SBETS PAYOUT SKIPPED: Zero or negative amount (${amountSbets} SBETS) to ${recipientAddress}`);
      return { success: false, error: 'Amount must be positive - skipping zero-value transaction' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured or invalid format';
      console.error(`❌ SBETS PAYOUT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const amountMist = Math.floor(amountSbets * 1e9);
      const adminAddress = keypair.toSuiAddress();
      
      // Get admin's SBETS coins
      const sbetsCoins = await this.client.getCoins({
        owner: adminAddress,
        coinType: SBETS_COIN_TYPE,
      });

      if (!sbetsCoins.data || sbetsCoins.data.length === 0) {
        return { success: false, error: 'No SBETS coins available in admin wallet' };
      }

      const tx = new Transaction();
      
      // Merge all SBETS coins if multiple exist
      if (sbetsCoins.data.length > 1) {
        const primaryCoin = tx.object(sbetsCoins.data[0].coinObjectId);
        const coinsToMerge = sbetsCoins.data.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(primaryCoin, coinsToMerge);
        const [splitCoin] = tx.splitCoins(primaryCoin, [amountMist]);
        tx.transferObjects([splitCoin], recipientAddress);
      } else {
        const primaryCoin = tx.object(sbetsCoins.data[0].coinObjectId);
        const [splitCoin] = tx.splitCoins(primaryCoin, [amountMist]);
        tx.transferObjects([splitCoin], recipientAddress);
      }

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN SBETS PAYOUT: ${amountSbets} SBETS to ${recipientAddress} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        console.error(`❌ SBETS PAYOUT FAILED: ${result.effects?.status?.error || 'Unknown error'}`);
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error('❌ SBETS Payout execution error:', error);
      return { success: false, error: error.message || 'Failed to execute SBETS payout' };
    }
  }

  private sbetsTokenType = "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS";

  // Get treasury balance (admin wallet balance)
  async getTreasuryBalance(): Promise<{ sui: number; sbets: number }> {
    return this.getWalletBalance(PLATFORM_REVENUE_WALLET);
  }

  /**
   * Execute on-chain bet settlement via smart contract
   * Calls the settle_bet function which pays winners directly from contract treasury
   * @param betObjectId - The on-chain Bet object ID
   * @param won - Whether the bet won or lost
   * @returns Transaction result with hash or error
   */
  async executeSettleBetOnChain(
    betObjectId: string,
    won: boolean
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured - cannot execute on-chain settlement';
      console.error(`❌ SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    if (!ADMIN_CAP_ID) {
      const error = 'ADMIN_CAP_ID not configured - cannot execute on-chain settlement with capability pattern';
      console.error(`❌ SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const betObj = await this.client.getObject({ id: betObjectId, options: { showOwner: true } });
      const owner = betObj.data?.owner;
      if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
        return { success: false, error: `Bet object is owned by ${(owner as any).AddressOwner.slice(0,12)}... - cannot settle owned objects` };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Admin wallet too low for gas: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::settle_bet_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.pure.bool(won),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        const outcome = won ? 'WON (payout sent)' : 'LOST (stake kept in treasury)';
        console.log(`✅ ON-CHAIN SETTLEMENT: Bet ${betObjectId.slice(0, 12)}... ${outcome} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const errorMsg = result.effects?.status?.error || 'Unknown error';
        console.error(`❌ ON-CHAIN SETTLEMENT FAILED: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      console.error('❌ Settlement execution error:', error);
      return { success: false, error: error.message || 'Failed to execute on-chain settlement' };
    }
  }

  /**
   * Execute on-chain bet void via smart contract
   * Calls the void_bet function which refunds the bettor
   * @param betObjectId - The on-chain Bet object ID
   * @returns Transaction result with hash or error
   */
  async executeVoidBetOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured - cannot execute on-chain void';
      console.error(`❌ VOID BLOCKED: ${error}`);
      return { success: false, error };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_bet`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap
          tx.object(BETTING_PLATFORM_ID),   // platform: &mut BettingPlatform
          tx.object(betObjectId),           // bet: &mut Bet
          tx.object('0x6'),                 // clock: &Clock
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN VOID: Bet ${betObjectId.slice(0, 12)}... refunded | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const errorMsg = result.effects?.status?.error || 'Unknown error';
        console.error(`❌ ON-CHAIN VOID FAILED: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      console.error('❌ Void execution error:', error);
      return { success: false, error: error.message || 'Failed to execute on-chain void' };
    }
  }

  /**
   * Withdraw accrued fees from contract to admin wallet
   * @param amountSui - Amount of SUI to withdraw
   * @returns Transaction result
   */
  async withdrawFeesOnChain(
    amountSui: number,
    recipientAddress?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amountSui || amountSui <= 0) {
      console.warn(`⚠️ FEE WITHDRAW SKIPPED: Zero or negative amount (${amountSui} SUI)`);
      return { success: false, error: 'Amount must be positive - skipping zero-value withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const amountMist = Math.floor(amountSui * 1e9);
      const tx = new Transaction();
      
      // withdraw_fees signature: (admin_cap, platform, amount, clock)
      // Fees go to tx sender (the admin keypair) automatically
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::withdraw_fees`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap
          tx.object(BETTING_PLATFORM_ID),   // platform: &mut BettingPlatform
          tx.pure.u64(amountMist),          // amount: u64
          tx.object('0x6'),                 // clock: &Clock
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ FEES WITHDRAWN: ${amountSui} SUI | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute on-chain SBETS bet settlement via smart contract
   * Calls the settle_bet_sbets function for SBETS bets
   * @param betObjectId - The on-chain Bet object ID
   * @param won - Whether the bet won or lost
   * @returns Transaction result with hash or error
   */
  async executeSettleBetSbetsOnChain(
    betObjectId: string,
    won: boolean
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      const error = 'Admin private key not configured - cannot execute on-chain SBETS settlement';
      console.error(`❌ SBETS SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    if (!ADMIN_CAP_ID) {
      const error = 'ADMIN_CAP_ID not configured - cannot execute on-chain SBETS settlement';
      console.error(`❌ SBETS SETTLEMENT BLOCKED: ${error}`);
      return { success: false, error };
    }

    try {
      const betObj = await this.client.getObject({ id: betObjectId, options: { showOwner: true } });
      const owner = betObj.data?.owner;
      if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
        return { success: false, error: `Bet object is owned by ${(owner as any).AddressOwner.slice(0,12)}... - cannot settle owned objects` };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Admin wallet too low for gas: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::settle_bet_sbets_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.pure.bool(won),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === 'success') {
        const outcome = won ? 'WON (SBETS payout sent)' : 'LOST (SBETS stake kept in treasury)';
        console.log(`✅ ON-CHAIN SBETS SETTLEMENT: Bet ${betObjectId.slice(0, 12)}... ${outcome} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const errorMsg = result.effects?.status?.error || 'Unknown error';
        console.error(`❌ ON-CHAIN SBETS SETTLEMENT FAILED: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      console.error('❌ SBETS Settlement execution error:', error);
      return { success: false, error: error.message || 'Failed to execute on-chain SBETS settlement' };
    }
  }

  /**
   * Execute on-chain SBETS bet void via smart contract
   * @param betObjectId - The on-chain Bet object ID
   * @returns Transaction result with hash or error
   */
  async executeVoidBetSbetsOnChain(
    betObjectId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::void_bet_sbets_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap
          tx.object(BETTING_PLATFORM_ID),
          tx.object(betObjectId),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ ON-CHAIN SBETS VOID: Bet ${betObjectId.slice(0, 12)}... refunded | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Withdraw SBETS fees from contract to admin wallet
   * @param amount - Amount of SBETS to withdraw
   * @returns Transaction result
   */
  async withdrawFeesSbetsOnChain(
    amount: number,
    recipientAddress?: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      console.warn(`⚠️ SBETS FEE WITHDRAW SKIPPED: Zero or negative amount (${amount} SBETS)`);
      return { success: false, error: 'Amount must be positive - skipping zero-value withdrawal' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const amountMist = Math.floor(amount * 1e9);
      const tx = new Transaction();
      
      // withdraw_fees_sbets signature: (admin_cap, platform, amount, clock)
      // Fees go to tx sender (the admin keypair) automatically
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::withdraw_fees_sbets`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap
          tx.object(BETTING_PLATFORM_ID),   // platform: &mut BettingPlatform
          tx.pure.u64(amountMist),          // amount: u64
          tx.object('0x6'),                 // clock: &Clock
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ SBETS FEES WITHDRAWN: ${amount} SBETS | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async withdrawTreasurySbetsOnChain(
    amount: number,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!amount || amount <= 0) {
      return { success: false, error: 'Amount must be positive' };
    }

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    if (!ADMIN_CAP_ID) {
      return { success: false, error: 'ADMIN_CAP_ID not configured' };
    }

    try {
      const amountMist = Math.floor(amount * 1e9);
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::withdraw_treasury_sbets`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.u64(amountMist),
          tx.object('0x6'),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`✅ TREASURY SBETS WITHDRAWN: ${amount} SBETS | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Failed' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SUI directly from admin wallet (funded from treasury) to user's wallet
   * Used for DB settlement payouts when on-chain settlement isn't possible
   * Admin wallet should be funded via treasury withdrawals
   * @param recipientAddress - User's wallet address
   * @param amount - Amount in SUI (not MIST)
   * @returns Transaction result
   */
  async sendSuiToUser(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const keypair = this.getAdminKeypair();
      if (!keypair) {
        return { success: false, error: 'Admin keypair not configured' };
      }

      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      const minGas = 0.01;
      if (adminBalance.sui < amount + minGas) {
        return { success: false, error: `Insufficient admin balance: ${adminBalance.sui.toFixed(4)} SUI < ${amount} + ${minGas} gas` };
      }

      const amountInMist = BigInt(Math.floor(amount * 1e9));
      const tx = new Transaction();
      
      // Split SUI from admin wallet (treasury-funded) and transfer to user
      const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
      tx.transferObjects([coin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`💸 SUI PAYOUT (from treasury funds): ${amount} SUI -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send SUI payout:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SBETS directly from admin wallet (funded from treasury) to user's wallet
   * Used for DB settlement payouts when on-chain settlement isn't possible
   * Admin wallet should be funded via treasury withdrawals
   * @param recipientAddress - User's wallet address  
   * @param amount - Amount in SBETS (not smallest unit)
   * @returns Transaction result
   */
  async sendSbetsToUser(recipientAddress: string, amount: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const keypair = this.getAdminKeypair();
      if (!keypair) {
        return { success: false, error: 'Admin keypair not configured' };
      }

      if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
      }

      const adminBalance = await this.getWalletBalance(keypair.toSuiAddress());
      if (adminBalance.sui < 0.01) {
        return { success: false, error: `Insufficient gas for SBETS transfer: ${adminBalance.sui.toFixed(4)} SUI` };
      }

      const amountInSmallest = BigInt(Math.floor(amount * 1_000_000_000));
      const tx = new Transaction();

      // Get admin's SBETS coins (funded from treasury)
      const coins = await this.client.getCoins({
        owner: keypair.toSuiAddress(),
        coinType: this.sbetsTokenType,
      });

      if (!coins.data || coins.data.length === 0) {
        return { success: false, error: 'No SBETS in admin wallet - needs treasury funding' };
      }

      // Check total balance
      const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient SBETS in admin wallet: ${Number(totalBalance) / 1_000_000_000} < ${amount}` };
      }

      // Merge all SBETS coins if needed
      const coinIds = coins.data.map(c => c.coinObjectId);
      if (coinIds.length > 1) {
        tx.mergeCoins(coinIds[0], coinIds.slice(1));
      }

      // Split and transfer
      const [paymentCoin] = tx.splitCoins(coinIds[0], [amountInSmallest]);
      tx.transferObjects([paymentCoin], recipientAddress);

      const result = await this.client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        console.log(`💸 SBETS PAYOUT (from treasury funds): ${amount} SBETS -> ${recipientAddress.slice(0,10)}... | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        return { success: false, error: result.effects?.status?.error || 'Transaction failed' };
      }
    } catch (error: any) {
      console.error(`❌ Failed to send SBETS payout:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check on-chain bet status to avoid settling already-settled bets
   * Returns the bet status from the blockchain, or null if bet not found
   * @param betObjectId - The on-chain Bet object ID
   * @returns Bet status info or null
   */
  async getOnChainBetInfo(betObjectId: string): Promise<{
    settled: boolean;
    status: string;
    amount: number;
    potentialPayout: number;
    eventId?: string;
    marketId?: string;
    prediction?: string;
    odds?: number;
    bettor?: string;
    coinType?: string;
    placedAt?: number;
    settledAt?: number;
    platformFee?: number;
  } | null> {
    try {
      const betObj = await this.client.getObject({
        id: betObjectId,
        options: { showContent: true },
      });

      if (betObj.data?.content?.dataType === 'moveObject') {
        const fields = (betObj.data.content as any).fields;
        
        // Check the 'status' field in the bet object (0=pending, 1=won, 2=lost, 3=void)
        const statusCode = parseInt(fields.status || '0');
        const settled = statusCode !== 0; // Any non-pending status means settled
        const status = statusCode === 0 ? 'pending' : statusCode === 1 ? 'won' : statusCode === 2 ? 'lost' : 'void';
        const amount = parseInt(fields.amount || fields.stake || '0') / 1e9;
        const potentialPayout = parseInt(fields.potential_payout || '0') / 1e9;
        
        // Decode vector<u8> fields to strings
        const decodeVectorToString = (arr: number[] | undefined): string | undefined => {
          if (!arr || !Array.isArray(arr)) return undefined;
          try {
            return String.fromCharCode(...arr);
          } catch {
            return undefined;
          }
        };
        
        const eventId = decodeVectorToString(fields.event_id);
        const marketId = decodeVectorToString(fields.market_id);
        const prediction = decodeVectorToString(fields.prediction);
        const odds = fields.odds ? parseInt(fields.odds) / 100 : undefined; // Convert from basis points
        const bettor = fields.bettor;
        const coinTypeCode = parseInt(fields.coin_type || '0');
        const coinType = coinTypeCode === 0 ? 'SUI' : 'SBETS';
        const placedAt = fields.placed_at ? parseInt(fields.placed_at) : undefined;
        const settledAt = fields.settled_at ? parseInt(fields.settled_at) : undefined;
        const platformFee = fields.platform_fee ? parseInt(fields.platform_fee) / 1e9 : undefined;
        
        console.log(`[OnChainBet] ${betObjectId.slice(0, 12)}... status=${status} (code=${statusCode}), settled=${settled}, amount=${amount}, prediction=${prediction}`);
        
        return {
          settled,
          status,
          amount,
          potentialPayout,
          eventId,
          marketId,
          prediction,
          odds,
          bettor,
          coinType,
          placedAt,
          settledAt,
          platformFee
        };
      }
      
      console.warn(`[OnChainBet] ${betObjectId.slice(0, 12)}... not found or not a move object`);
      return null;
    } catch (error: any) {
      console.error(`[OnChainBet] Error fetching bet ${betObjectId}:`, error.message);
      return null;
    }
  }

  /**
   * Get platform contract info (treasury balance, stats) - dual treasury
   */
  async getPlatformInfo(): Promise<{
    treasuryBalanceSui: number;
    treasuryBalanceSbets: number;
    totalBets: number;
    totalVolumeSui: number;
    totalVolumeSbets: number;
    totalLiabilitySui: number;
    totalLiabilitySbets: number;
    accruedFeesSui: number;
    accruedFeesSbets: number;
    paused: boolean;
  } | null> {
    try {
      const platformObj = await this.client.getObject({
        id: BETTING_PLATFORM_ID,
        options: { showContent: true },
      });

      if (platformObj.data?.content?.dataType === 'moveObject') {
        const fields = (platformObj.data.content as any).fields;
        
        // Debug: log the raw fields structure
        console.log('[BlockchainBetService] Platform fields treasury_sui:', fields.treasury_sui);
        console.log('[BlockchainBetService] Platform fields treasury_sbets:', fields.treasury_sbets);
        
        // Balance objects in Sui can be stored as direct numbers or nested in .fields.value
        // Try both formats for compatibility
        const getTreasuryValue = (field: any): number => {
          if (!field) return 0;
          // Direct number format
          if (typeof field === 'string' || typeof field === 'number') {
            return parseInt(String(field)) / 1e9;
          }
          // Nested .fields.value format (Balance object)
          if (field?.fields?.value) {
            return parseInt(field.fields.value) / 1e9;
          }
          return 0;
        };
        
        return {
          treasuryBalanceSui: getTreasuryValue(fields.treasury_sui),
          treasuryBalanceSbets: getTreasuryValue(fields.treasury_sbets),
          totalBets: parseInt(fields.total_bets || '0'),
          totalVolumeSui: parseInt(fields.total_volume_sui || '0') / 1e9,
          totalVolumeSbets: parseInt(fields.total_volume_sbets || '0') / 1e9,
          totalLiabilitySui: parseInt(fields.total_potential_liability_sui || '0') / 1e9,
          totalLiabilitySbets: parseInt(fields.total_potential_liability_sbets || '0') / 1e9,
          accruedFeesSui: parseInt(fields.accrued_fees_sui || '0') / 1e9,
          accruedFeesSbets: parseInt(fields.accrued_fees_sbets || '0') / 1e9,
          paused: fields.paused || false,
        };
      }
      return null;
    } catch (error) {
      console.error('Failed to get platform info:', error);
      return null;
    }
  }

  /**
   * Sync on-chain bets to database - finds bets placed directly on contract that aren't tracked
   */
  async syncOnChainBetsToDatabase(): Promise<{ synced: number; errors: string[] }> {
    const errors: string[] = [];
    let synced = 0;

    try {
      console.log('🔄 Starting on-chain bet sync...');

      // Query all BetPlaced events from the smart contract
      const eventsResponse = await this.client.queryEvents({
        query: {
          MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced`
        },
        limit: 100,
        order: 'descending'
      });

      console.log(`📊 Found ${eventsResponse.data.length} BetPlaced events on-chain`);

      let skippedVoided = 0;
      let skippedRejected = 0;

      for (const event of eventsResponse.data) {
        try {
          const parsed = event.parsedJson as any;
          const betObjectId = parsed.bet_id;

          if (rejectedOnChainBets.has(betObjectId)) {
            skippedRejected++;
            continue;
          }

          try {
            const betObjCheck = await this.client.getObject({ id: betObjectId, options: { showContent: true } });
            if (betObjCheck.data?.content && betObjCheck.data.content.dataType === 'moveObject') {
              const betFields = (betObjCheck.data.content as any).fields;
              const betStatus = parseInt(betFields.status || '0');
              if (betStatus !== 0) {
                rejectedOnChainBets.add(betObjectId);
                skippedVoided++;
                continue;
              }
            } else if (!betObjCheck.data) {
              rejectedOnChainBets.add(betObjectId);
              skippedVoided++;
              continue;
            }
          } catch (objErr) {
            rejectedOnChainBets.add(betObjectId);
            skippedVoided++;
            continue;
          }

          const bettor = parsed.bettor;
          const stake = parseInt(parsed.stake) / 1e9;
          const odds = parseInt(parsed.odds) / 100;
          const potentialPayout = parseInt(parsed.potential_payout) / 1e9;
          const coinType = parsed.coin_type === 0 ? 'SUI' : 'SBETS';
          const timestamp = parseInt(parsed.timestamp);
          
          const decodeBytes = (arr: number[] | undefined): string => {
            if (!arr || !Array.isArray(arr)) return 'Unknown';
            try {
              return Buffer.from(arr).toString('utf8');
            } catch (e) {
              return 'Error decoding';
            }
          };

          const prediction = decodeBytes(parsed.prediction);
          const market = decodeBytes(parsed.market);
          
          let eventName = "Unknown Event";
          let homeTeam = "Unknown";
          let awayTeam = "Unknown";
          
          // Improved extraction logic for synchronized bets
          if (prediction && prediction.includes(" vs ")) {
            const parts = prediction.split(":");
            eventName = parts[0].trim();
            const teams = eventName.split(" vs ");
            homeTeam = teams[0]?.trim() || "Unknown";
            awayTeam = teams[1]?.trim() || "Unknown";
          } else if (market && market.includes(" vs ")) {
            eventName = market.split(":")[0].trim();
            const teams = eventName.split(" vs ");
            homeTeam = teams[0]?.trim() || "Unknown";
            awayTeam = teams[1]?.trim() || "Unknown";
          }
          
          // Decode event_id from byte arrays
          const eventId = decodeBytes(parsed.event_id as number[]);

          // Check if this bet already exists in database by bet_object_id
          const { storage } = await import('../storage');
          const existingBets = await storage.getBetsByBetObjectId(betObjectId);
          
          if (existingBets && existingBets.length > 0) {
            continue; // Already tracked
          }

          // ANTI-EXPLOIT: Blocked wallet check
          const BLOCKED_WALLETS = new Set<string>([
          ]);
          if (BLOCKED_WALLETS.has(bettor?.toLowerCase())) {
            rejectedOnChainBets.add(betObjectId);
            console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... from blocked wallet ${bettor.slice(0, 12)}...`);
            continue;
          }

          if (eventName === "Unknown Event" || homeTeam === "Unknown" || awayTeam === "Unknown") {
            try {
              const apiSvc = (await import('./apiSportsService')).default;
              const { freeSportsService: fsSvc } = await import('./freeSportsService');
              const lookup = apiSvc.lookupEventSync(eventId);
              if (lookup.found && lookup.homeTeam && lookup.awayTeam) {
                eventName = `${lookup.homeTeam} vs ${lookup.awayTeam}`;
                homeTeam = lookup.homeTeam;
                awayTeam = lookup.awayTeam;
                console.log(`✅ On-chain sync: Recovered event data for ${betObjectId.slice(0, 12)}... via cache: ${eventName}`);
              } else {
                const fsLookup = fsSvc.lookupEvent(eventId);
                if (fsLookup.found && fsLookup.event?.homeTeam && fsLookup.event?.awayTeam) {
                  eventName = `${fsLookup.event.homeTeam} vs ${fsLookup.event.awayTeam}`;
                  homeTeam = fsLookup.event.homeTeam;
                  awayTeam = fsLookup.event.awayTeam;
                  console.log(`✅ On-chain sync: Recovered event data for ${betObjectId.slice(0, 12)}... via free sports: ${eventName}`);
                }
              }
            } catch (lookupErr) {}

            if (eventName === "Unknown Event" || homeTeam === "Unknown" || awayTeam === "Unknown") {
              try {
                const { db: lookupDb } = await import('../db');
                const { sql: lookupSql } = await import('drizzle-orm');
                const { bets: betsLookup } = await import('@shared/schema');
                const dbMatch = await lookupDb.select({
                  eventName: betsLookup.eventName,
                  homeTeam: betsLookup.homeTeam,
                  awayTeam: betsLookup.awayTeam
                }).from(betsLookup)
                  .where(lookupSql`${betsLookup.externalEventId} = ${eventId}`)
                  .limit(1);
                if (dbMatch.length > 0 && dbMatch[0].eventName && dbMatch[0].homeTeam && dbMatch[0].awayTeam) {
                  eventName = dbMatch[0].eventName;
                  homeTeam = dbMatch[0].homeTeam;
                  awayTeam = dbMatch[0].awayTeam;
                  console.log(`✅ On-chain sync: Recovered event data for ${betObjectId.slice(0, 12)}... via DB: ${eventName}`);
                }
              } catch (dbLookupErr) {}
            }

            if (eventName === "Unknown Event" || homeTeam === "Unknown" || awayTeam === "Unknown") {
              rejectedOnChainBets.add(betObjectId);
              console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Unknown Event (likely fake/exploitative bet)`);
              continue;
            }
          }
          
          // ANTI-EXPLOIT: Validate event ID is a real event in our system
          try {
            const apiSportsService = (await import('./apiSportsService')).default;
            const { freeSportsService } = await import('./freeSportsService');
            
            // Check paid API sports first
            const eventData = apiSportsService.lookupEventSync(eventId);
            if (eventData && eventData.found && (eventData.homeTeam || eventData.awayTeam)) {
              homeTeam = eventData.homeTeam || homeTeam;
              awayTeam = eventData.awayTeam || awayTeam;
              eventName = `${homeTeam} vs ${awayTeam}`;
            } else {
              // Check free sports events (basketball_, mma_, baseball_, etc.)
              const freeLookup = freeSportsService.lookupEvent(eventId);
              if (freeLookup.found && freeLookup.event) {
                homeTeam = freeLookup.event.homeTeam || homeTeam;
                awayTeam = freeLookup.event.awayTeam || awayTeam;
                eventName = `${homeTeam} vs ${awayTeam}`;
                console.log(`✅ Free sport event verified: ${eventId} (${eventName})`);
              } else if (eventId.startsWith('parlay_')) {
                const legEventIds = this.extractParlayLegIds(eventId);
                let allLegsValid = true;
                for (const fullLegId of legEventIds) {
                  const legCheck = apiSportsService.lookupEventSync(fullLegId);
                  const freeLegCheck = freeSportsService.lookupEvent(fullLegId);
                  if (!legCheck.found && !freeLegCheck.found) {
                    const numericOnly = fullLegId.replace(/^[a-z-]+_/, '');
                    if (numericOnly !== fullLegId) {
                      const numericCheck = apiSportsService.lookupEventSync(numericOnly);
                      if (!numericCheck.found) {
                        allLegsValid = false;
                      }
                    } else {
                      allLegsValid = false;
                    }
                  }
                }
                if (!allLegsValid) {
                  rejectedOnChainBets.add(betObjectId);
                  console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Event ${eventId} not found in our system`);
                  continue;
                }
              } else {
                let dbVerified = false;
                try {
                  const { db: verifyDb } = await import('../db');
                  const { sql: verifySql } = await import('drizzle-orm');
                  const { bets: betsVerify } = await import('@shared/schema');
                  const dbCheck = await verifyDb.select({ id: betsVerify.id })
                    .from(betsVerify)
                    .where(verifySql`${betsVerify.externalEventId} = ${eventId}`)
                    .limit(1);
                  if (dbCheck.length > 0) {
                    dbVerified = true;
                    console.log(`✅ On-chain sync: Event ${eventId} verified via existing DB bets`);
                  }
                } catch (dbVerifyErr) {}
                if (!dbVerified) {
                  rejectedOnChainBets.add(betObjectId);
                  console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Event ${eventId} not found in our system`);
                  continue;
                }
              }
            }
          } catch (eventCheckError) {
            rejectedOnChainBets.add(betObjectId);
            console.warn(`🚫 EXPLOIT BLOCKED: Rejecting bet ${betObjectId.slice(0, 12)}... - Could not verify event ${eventId}`);
            continue; // Don't sync bets for unverifiable events
          }
          
          // CRITICAL: Check if bet object is SHARED (new contract) or OWNED (legacy contract)
          // Legacy bets from before Jan 27, 2026 are owned objects and cannot be settled by admin
          try {
            const betObj = await this.client.getObject({
              id: betObjectId,
              options: { showOwner: true }
            });
            
            const owner = betObj.data?.owner;
            // If owner is an address (not "Shared"), this is a legacy owned bet - skip it
            if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
              console.log(`⚠️ SKIPPING legacy owned bet ${betObjectId.slice(0, 12)}... (owned by ${(owner as any).AddressOwner.slice(0, 12)}...)`);
              continue; // Skip legacy owned bets - they cannot be settled
            }
          } catch (ownerCheckError) {
            console.warn(`⚠️ Could not verify bet ownership for ${betObjectId.slice(0, 12)}..., skipping`);
            continue;
          }

          // Get current on-chain status and additional data
          const onChainInfo = await this.getOnChainBetInfo(betObjectId);
          const onChainStatus = onChainInfo?.status || 'pending';
          const marketId = onChainInfo?.marketId || 'match_winner';
          
          // Use prediction from on-chain bet object if event didn't have it
          const finalPrediction = prediction !== 'Unknown' ? prediction : (onChainInfo?.prediction || 'Unknown');

          // Create bet record in database
          const betId = `sync_${betObjectId.slice(0, 16)}_${Date.now()}`;
          const newBet = {
            id: betId,
            oddsId: `onchain_${eventId}`,
            oddsValue: odds,
            eventId: eventId,
            externalEventId: eventId,
            homeTeam: homeTeam || 'Unknown',
            awayTeam: awayTeam || 'Unknown',
            eventName: eventName !== 'Unknown Event' ? eventName : undefined,
            marketId: marketId,
            outcomeId: finalPrediction.toLowerCase().replace(/\s+/g, '_'),
            odds: odds,
            betAmount: stake,
            currency: coinType,
            status: onChainStatus === 'won' ? 'won' : onChainStatus === 'lost' ? 'lost' : 'confirmed',
            prediction: finalPrediction,
            placedAt: timestamp,
            potentialPayout: potentialPayout,
            platformFee: onChainInfo?.platformFee || 0,
            totalDebit: stake,
            paymentMethod: 'wallet' as const,
            onChainBetId: betObjectId,
            userId: bettor,
          };

          await storage.createBet(newBet);
          synced++;
          console.log(`✅ Synced bet ${betObjectId.slice(0, 12)}... from ${bettor.slice(0, 12)}... (${stake} ${coinType}, prediction=${finalPrediction})`);
        } catch (betError: any) {
          errors.push(`Bet sync error: ${betError.message}`);
        }
      }

      if (skippedVoided > 0 || skippedRejected > 0) {
        console.log(`🔄 On-chain sync complete: ${synced} synced, ${skippedVoided} voided/settled skipped, ${skippedRejected} cached-rejected skipped`);
      } else {
        console.log(`🔄 On-chain sync complete: ${synced} bets synced, ${errors.length} errors`);
      }
      return { synced, errors };
    } catch (error: any) {
      console.error('❌ On-chain bet sync failed:', error);
      errors.push(`Sync failed: ${error.message}`);
      return { synced, errors };
    }
  }

  private phantomVoidStatus: { running: boolean; voided: number; skipped: number; errors: string[]; liabilityFreed: number; scanned: number; total: number; startedAt: number; completedAt?: number } | null = null;

  getPhantomVoidStatus() {
    return this.phantomVoidStatus;
  }

  canStartPhantomVoid(): { canStart: boolean; error?: string } {
    if (this.phantomVoidStatus?.running) {
      return { canStart: false, error: 'Void scan already in progress' };
    }
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { canStart: false, error: 'Admin private key not configured' };
    }
    return { canStart: true };
  }

  async voidPhantomSbetsBets(): Promise<{ voided: number; errors: string[]; skipped: number; liabilityFreed: number }> {
    if (this.phantomVoidStatus?.running) {
      return { voided: 0, errors: ['Void scan already in progress'], skipped: 0, liabilityFreed: 0 };
    }

    this.phantomVoidStatus = { running: true, voided: 0, skipped: 0, errors: [], liabilityFreed: 0, scanned: 0, total: 0, startedAt: Date.now() };

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      this.phantomVoidStatus = { ...this.phantomVoidStatus, running: false, errors: ['Admin private key not configured'], completedAt: Date.now() };
      return { voided: 0, errors: ['Admin private key not configured'], skipped: 0, liabilityFreed: 0 };
    }

    try {
      console.log('🔍 Scanning for phantom SBETS bets to void...');

      const sbetsBetObjects: { id: string; stake: number; potentialPayout: number }[] = [];
      const seenIds = new Set<string>();
      let cursor: any = null;
      let hasMore = true;
      let totalEvents = 0;

      while (hasMore) {
        const queryParams: any = {
          query: { MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced` },
          limit: 50,
          order: 'descending' as const
        };
        if (cursor) queryParams.cursor = cursor;

        const eventsResponse = await this.client.queryEvents(queryParams);
        totalEvents += eventsResponse.data.length;

        for (const event of eventsResponse.data) {
          const parsed = event.parsedJson as any;
          const betObjectId = parsed.bet_id;
          if (parsed.coin_type !== 1) continue;
          if (seenIds.has(betObjectId)) continue;
          seenIds.add(betObjectId);

          sbetsBetObjects.push({
            id: betObjectId,
            stake: parseInt(parsed.stake) / 1e9,
            potentialPayout: parseInt(parsed.potential_payout) / 1e9,
          });
        }

        hasMore = eventsResponse.hasNextPage && eventsResponse.data.length > 0;
        cursor = eventsResponse.nextCursor;
      }

      console.log(`📊 Scanned ${totalEvents} BetPlaced events total`);
      console.log(`🎯 Found ${sbetsBetObjects.length} unique SBETS bet objects to check`);
      this.phantomVoidStatus.total = sbetsBetObjects.length;

      for (const betObj of sbetsBetObjects) {
        this.phantomVoidStatus.scanned++;
        try {
          const obj = await this.client.getObject({
            id: betObj.id,
            options: { showContent: true },
          });

          if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const fields = (obj.data.content as any).fields;
          const status = parseInt(fields.status || '0');

          if (status !== 0) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const ownerInfo = obj.data.owner;
          const isObjectOwned = typeof ownerInfo === 'object' && ownerInfo !== null && 'AddressOwner' in ownerInfo;
          
          if (isObjectOwned) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          console.log(`🗑️ Voiding phantom SBETS bet ${betObj.id.slice(0, 12)}... (liability: ${betObj.potentialPayout.toFixed(2)} SBETS)`);

          const result = await this.executeVoidBetSbetsOnChain(betObj.id);
          if (result.success) {
            this.phantomVoidStatus.voided++;
            this.phantomVoidStatus.liabilityFreed += betObj.potentialPayout;
            console.log(`✅ Voided: ${betObj.id.slice(0, 12)}... freed ${betObj.potentialPayout.toFixed(2)} SBETS liability | TX: ${result.txHash}`);
          } else {
            this.phantomVoidStatus.errors.push(`Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
            console.warn(`❌ Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          this.phantomVoidStatus.errors.push(`Error processing ${betObj.id.slice(0, 12)}...: ${err.message}`);
        }
      }

      const { voided, skipped, errors, liabilityFreed } = this.phantomVoidStatus;
      console.log(`🏁 Phantom void complete: ${voided} voided, ${skipped} skipped, ${errors.length} errors, ${liabilityFreed.toFixed(2)} SBETS freed`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided, errors: [...errors], skipped, liabilityFreed };
    } catch (error: any) {
      console.error('❌ Phantom void scan failed:', error);
      this.phantomVoidStatus.errors.push(`Scan failed: ${error.message}`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided: this.phantomVoidStatus.voided, errors: [...this.phantomVoidStatus.errors], skipped: this.phantomVoidStatus.skipped, liabilityFreed: this.phantomVoidStatus.liabilityFreed };
    }
  }

  async voidAllPhantomBets(): Promise<{ voided: number; errors: string[]; skipped: number; liabilityFreed: number }> {
    if (this.phantomVoidStatus?.running) {
      return { voided: 0, errors: ['Void scan already in progress'], skipped: 0, liabilityFreed: 0 };
    }

    this.phantomVoidStatus = { running: true, voided: 0, skipped: 0, errors: [], liabilityFreed: 0, scanned: 0, total: 0, startedAt: Date.now() };

    const keypair = this.getAdminKeypair();
    if (!keypair) {
      this.phantomVoidStatus = { ...this.phantomVoidStatus, running: false, errors: ['Admin private key not configured'], completedAt: Date.now() };
      return { voided: 0, errors: ['Admin private key not configured'], skipped: 0, liabilityFreed: 0 };
    }

    try {
      console.log('🔍 Scanning ALL phantom bets (SUI + SBETS) to void...');

      const allBetObjects: { id: string; stake: number; potentialPayout: number; coinType: number }[] = [];
      const seenIds = new Set<string>();
      let cursor: any = null;
      let hasMore = true;
      let totalEvents = 0;

      while (hasMore) {
        const queryParams: any = {
          query: { MoveEventType: `${BETTING_PACKAGE_ID}::betting::BetPlaced` },
          limit: 50,
          order: 'descending' as const
        };
        if (cursor) queryParams.cursor = cursor;

        const eventsResponse = await this.client.queryEvents(queryParams);
        totalEvents += eventsResponse.data.length;

        for (const event of eventsResponse.data) {
          const parsed = event.parsedJson as any;
          const betObjectId = parsed.bet_id;
          if (seenIds.has(betObjectId)) continue;
          seenIds.add(betObjectId);

          allBetObjects.push({
            id: betObjectId,
            stake: parseInt(parsed.stake) / 1e9,
            potentialPayout: parseInt(parsed.potential_payout) / 1e9,
            coinType: parsed.coin_type,
          });
        }

        hasMore = eventsResponse.hasNextPage && eventsResponse.data.length > 0;
        cursor = eventsResponse.nextCursor;
      }

      console.log(`📊 Scanned ${totalEvents} BetPlaced events, found ${allBetObjects.length} unique bet objects`);
      this.phantomVoidStatus.total = allBetObjects.length;

      const { db } = await import('../db');
      const { sql } = await import('drizzle-orm');
      const { bets } = await import('@shared/schema');

      for (const betObj of allBetObjects) {
        this.phantomVoidStatus.scanned++;
        try {
          const obj = await this.client.getObject({
            id: betObj.id,
            options: { showContent: true },
          });

          if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const fields = (obj.data.content as any).fields;
          const status = parseInt(fields.status || '0');

          if (status !== 0) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const ownerInfo = obj.data.owner;
          const isObjectOwned = typeof ownerInfo === 'object' && ownerInfo !== null && 'AddressOwner' in ownerInfo;

          if (isObjectOwned) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const dbCheck = await db.select({ id: bets.id }).from(bets)
            .where(sql`${bets.betObjectId} = ${betObj.id} AND ${bets.status} IN ('pending', 'confirmed')`)
            .limit(1);

          if (dbCheck.length > 0) {
            this.phantomVoidStatus.skipped++;
            continue;
          }

          const coinLabel = betObj.coinType === 1 ? 'SBETS' : 'SUI';
          console.log(`🗑️ Voiding phantom ${coinLabel} bet ${betObj.id.slice(0, 12)}... (liability: ${betObj.potentialPayout.toFixed(2)} ${coinLabel})`);

          let result;
          if (betObj.coinType === 1) {
            result = await this.executeVoidBetSbetsOnChain(betObj.id);
          } else {
            result = await this.executeVoidBetOnChain(betObj.id);
          }

          if (result.success) {
            this.phantomVoidStatus.voided++;
            this.phantomVoidStatus.liabilityFreed += betObj.potentialPayout;
            rejectedOnChainBets.add(betObj.id);
            console.log(`✅ Voided: ${betObj.id.slice(0, 12)}... freed ${betObj.potentialPayout.toFixed(2)} ${coinLabel} liability | TX: ${result.txHash}`);
          } else {
            this.phantomVoidStatus.errors.push(`Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
            console.warn(`❌ Failed to void ${betObj.id.slice(0, 12)}...: ${result.error}`);
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err: any) {
          this.phantomVoidStatus.errors.push(`Error processing ${betObj.id.slice(0, 12)}...: ${err.message}`);
        }
      }

      const { voided, skipped, errors, liabilityFreed } = this.phantomVoidStatus;
      console.log(`🏁 All phantom void complete: ${voided} voided, ${skipped} skipped, ${errors.length} errors, ${liabilityFreed.toFixed(2)} total liability freed`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided, errors: [...errors], skipped, liabilityFreed };
    } catch (error: any) {
      console.error('❌ All phantom void scan failed:', error);
      this.phantomVoidStatus.errors.push(`Scan failed: ${error.message}`);
      this.phantomVoidStatus.running = false;
      this.phantomVoidStatus.completedAt = Date.now();
      return { voided: this.phantomVoidStatus.voided, errors: [...this.phantomVoidStatus.errors], skipped: this.phantomVoidStatus.skipped, liabilityFreed: this.phantomVoidStatus.liabilityFreed };
    }
  }

  async depositLiquiditySbets(amount: number): Promise<{ success: boolean; txHash?: string; error?: string; deposited?: number }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      const adminCapId = await this.findAdminCap(keypair.toSuiAddress());
      if (!adminCapId) {
        return { success: false, error: 'AdminCap not found for admin wallet' };
      }

      const amountInSmallest = BigInt(Math.floor(amount * 1_000_000_000));
      const SBETS_TYPE = '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS';

      const coins = await this.suiClient.getCoins({
        owner: keypair.toSuiAddress(),
        coinType: SBETS_TYPE,
      });

      if (!coins.data || coins.data.length === 0) {
        return { success: false, error: 'No SBETS coins found in admin wallet. Send SBETS to admin wallet first.' };
      }

      const totalBalance = coins.data.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < amountInSmallest) {
        return { success: false, error: `Insufficient SBETS in admin wallet: ${Number(totalBalance) / 1e9} < ${amount}. Send more SBETS to admin wallet.` };
      }

      const tx = new Transaction();
      const coinIds = coins.data.map(c => c.coinObjectId);
      
      let paymentCoin;
      if (coinIds.length > 1) {
        tx.mergeCoins(tx.object(coinIds[0]), coinIds.slice(1).map(id => tx.object(id)));
      }
      [paymentCoin] = tx.splitCoins(tx.object(coinIds[0]), [amountInSmallest]);

      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity_sbets`,
        arguments: [
          tx.object(adminCapId),
          tx.object(BETTING_PLATFORM_ID),
          paymentCoin,
          tx.object('0x6'),
        ],
      });

      const result = await this.suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
      });

      const status = result.effects?.status?.status;
      if (status === 'success') {
        console.log(`✅ Deposited ${amount} SBETS to treasury | TX: ${result.digest}`);
        return { success: true, txHash: result.digest, deposited: amount };
      } else {
        const error = result.effects?.status?.error || 'Transaction failed';
        return { success: false, error };
      }
    } catch (error: any) {
      console.error('❌ SBETS deposit error:', error);
      return { success: false, error: error.message };
    }
  }

  async resetOnChainLiability(currency: 'SUI' | 'SBETS', newLiability: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const keypair = this.getAdminKeypair();
    if (!keypair) {
      return { success: false, error: 'Admin private key not configured' };
    }

    try {
      const adminCapId = await this.findAdminCap(keypair.toSuiAddress());
      if (!adminCapId) {
        return { success: false, error: 'AdminCap not found for admin wallet' };
      }

      const functionName = currency === 'SBETS' ? 'admin_reset_liability_sbets' : 'admin_reset_liability_sui';
      const liabilityValue = BigInt(Math.floor(newLiability * 1_000_000_000));

      const tx = new Transaction();
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::${functionName}`,
        arguments: [
          tx.object(adminCapId),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.u64(liabilityValue),
        ],
      });

      const result = await this.suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEffects: true },
      });

      const status = result.effects?.status?.status;
      if (status === 'success') {
        console.log(`✅ On-chain ${currency} liability reset to ${newLiability} | TX: ${result.digest}`);
        return { success: true, txHash: result.digest };
      } else {
        const error = result.effects?.status?.error || 'Transaction failed';
        console.error(`❌ Liability reset failed: ${error}`);
        return { success: false, error };
      }
    } catch (error: any) {
      console.error(`❌ Liability reset error:`, error);
      return { success: false, error: error.message };
    }
  }
}

export const blockchainBetService = new BlockchainBetService();
export default blockchainBetService;
