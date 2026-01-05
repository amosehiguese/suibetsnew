import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const SBETS_PACKAGE_ID = process.env.SBETS_TOKEN_ADDRESS?.split('::')[0] || '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285';
// Contract addresses - deployed January 4, 2026
const BETTING_PACKAGE_ID = process.env.BETTING_PACKAGE_ID || '0x9ca7d3b57c018fb171724dc808a542d2ec27354f6526b75e968d308d29bb6626';
const BETTING_PLATFORM_ID = process.env.BETTING_PLATFORM_ID || '0xfb946f078082f42c93b7c1db30365f590338fd477ac20c564498d9315ca89e9c';
const ADMIN_CAP_ID = process.env.ADMIN_CAP_ID || '0x49bee21bdf21522f401d5a3d6677604f0738bbd20f9bffef97d2223bdf2a1cb5';
const PLATFORM_REVENUE_WALLET = process.env.PLATFORM_REVENUE_WALLET || '0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50';
const ADMIN_WALLET = process.env.ADMIN_WALLET_ADDRESS || '0x747c44940ec9f0136e3accdd81f37d5b3cc1d62d7747968d633cabb6aa5aa45f';
const REVENUE_WALLET = process.env.REVENUE_WALLET_ADDRESS || PLATFORM_REVENUE_WALLET;
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

export class BlockchainBetService {
  private client: SuiClient;
  private network: 'mainnet' | 'testnet' | 'devnet';

  constructor() {
    this.network = (process.env.SUI_NETWORK as 'mainnet' | 'testnet' | 'devnet') || 'mainnet';
    this.client = new SuiClient({ url: getFullnodeUrl(this.network) });
    console.log(`BlockchainBetService initialized on ${this.network}`);
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
    // Full contract signature: settle_bet(platform, bet, won, clock)
    return {
      target: `${BETTING_PACKAGE_ID}::betting::settle_bet`,
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

  // Get admin keypair from private key (for on-chain transactions)
  // Sui SDK's Ed25519Keypair.fromSecretKey expects the 32-byte secret seed
  private getAdminKeypair(): Ed25519Keypair | null {
    if (!ADMIN_PRIVATE_KEY) {
      console.warn('⚠️ ADMIN_PRIVATE_KEY not configured - on-chain payouts disabled');
      return null;
    }
    
    try {
      let keyBytes: Uint8Array;
      
      // Support multiple formats: hex, base64, or Sui bech32 format
      if (ADMIN_PRIVATE_KEY.startsWith('suiprivkey')) {
        // Sui bech32 format - use decodeSuiPrivateKey if available
        try {
          // Try importing the decode function
          const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
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
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::settle_bet_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap (owned by signer)
          tx.object(BETTING_PLATFORM_ID),   // platform: &mut Platform
          tx.object(betObjectId),           // bet: &mut Bet
          tx.pure.bool(won),                // won: bool
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
        target: `${BETTING_PACKAGE_ID}::betting::void_bet_admin`,
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
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::settle_bet_sbets_admin`,
        arguments: [
          tx.object(ADMIN_CAP_ID),          // admin_cap: &AdminCap
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
        return {
          treasuryBalanceSui: parseInt(fields.treasury_sui?.fields?.value || '0') / 1e9,
          treasuryBalanceSbets: parseInt(fields.treasury_sbets?.fields?.value || '0') / 1e9,
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
}

export const blockchainBetService = new BlockchainBetService();
export default blockchainBetService;
