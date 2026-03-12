import express, { Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { ApiSportsService, saveUpcomingSnapshot, getUpcomingSnapshot, saveLiveSnapshot, getLiveSnapshot, withSingleFlight } from "./services/apiSportsService";
const apiSportsService = new ApiSportsService();
import { SettlementService } from "./services/settlementService";
import { AdminService } from "./services/adminService";
import errorHandlingService from "./services/errorHandlingService";
import { EnvValidationService } from "./services/envValidationService";
import monitoringService from "./services/monitoringService";
import notificationService from "./services/notificationService";
import balanceService from "./services/balanceService";
import antiCheatService from "./services/smartContractAntiCheatService";
import zkLoginService from "./services/zkLoginService";
import { getSportsToFetch } from "./sports-config";
import { validateRequest, PlaceBetSchema, ParlaySchema, WithdrawSchema } from "./validation";
import aiRoutes from "./routes-ai";
import { settlementWorker } from "./services/settlementWorker";
import blockchainBetService from "./services/blockchainBetService";
import { promotionService } from "./services/promotionService";
import { treasuryAutoWithdrawService } from "./services/treasuryAutoWithdrawService";
import { freeSportsService } from "./services/freeSportsService";
import { esportsService } from "./services/esportsService";

// SUI BETTING PAUSE - Set to true to pause SUI betting until treasury is funded
// Users can still bet with SBETS
let SUI_BETTING_PAUSED = true;
const SUI_PAUSE_MESSAGE = "SUI betting is temporarily paused while we add funds to the treasury. Please bet with SBETS instead!";

// ANTI-EXPLOIT: Blocked wallet addresses (known exploiters)
const BLOCKED_WALLETS = new Set<string>([
]);

function isWalletBlocked(wallet: string): boolean {
  return BLOCKED_WALLETS.has(wallet.toLowerCase());
}

// ANTI-EXPLOIT: Rate limiting for bet placement
// Database-backed: counts actual bets in DB to survive server restarts
const MAX_BETS_PER_DAY = 7; // Maximum 7 bets per wallet per 24 hours
const MAX_BETS_PER_EVENT = 2;

async function checkBetRateLimitDB(walletAddress: string): Promise<{ allowed: boolean; remaining?: number; message?: string }> {
  const key = walletAddress.toLowerCase();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as bet_count FROM bets 
      WHERE LOWER(wallet_address) = ${key} 
      AND created_at >= ${twentyFourHoursAgo}
      AND status != 'voided'
    `);
    const betCount = Number(result.rows?.[0]?.bet_count || 0);
    
    if (betCount >= MAX_BETS_PER_DAY) {
      return { 
        allowed: false,
        remaining: 0,
        message: `Daily bet limit reached. Maximum ${MAX_BETS_PER_DAY} bets per 24 hours. Try again later.`
      };
    }
    
    return { allowed: true, remaining: MAX_BETS_PER_DAY - betCount };
  } catch (error) {
    console.error('[RateLimit] DB check failed, falling back to allow:', error);
    return { allowed: true, remaining: 1 };
  }
}

// ANTI-EXPLOIT: Bet cooldown - minimum 30 seconds between bets per wallet (DB-backed)
const BET_COOLDOWN_MS = 30 * 1000; // 30 seconds between bets

async function checkBetCooldownDB(walletAddress: string): Promise<{ allowed: boolean; secondsLeft?: number }> {
  const key = walletAddress.toLowerCase();
  
  try {
    const result = await db.execute(sql`
      SELECT created_at FROM bets 
      WHERE LOWER(wallet_address) = ${key}
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (result.rows?.length > 0 && result.rows[0].created_at) {
      const lastBetTime = new Date(result.rows[0].created_at as string).getTime();
      const elapsed = Date.now() - lastBetTime;
      if (elapsed < BET_COOLDOWN_MS) {
        const secondsLeft = Math.ceil((BET_COOLDOWN_MS - elapsed) / 1000);
        return { allowed: false, secondsLeft };
      }
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('[Cooldown] DB check failed, falling back to allow:', error);
    return { allowed: true };
  }
}

// ANTI-EXPLOIT: Max 2 bets per event per wallet (DB-backed)
async function checkEventBetLimitDB(walletAddress: string, eventId: string): Promise<{ allowed: boolean; message?: string }> {
  const key = walletAddress.toLowerCase();
  
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as bet_count FROM bets 
      WHERE LOWER(wallet_address) = ${key} 
      AND event_id = ${Number(eventId)}
      AND status != 'voided'
    `);
    const eventBetCount = Number(result.rows?.[0]?.bet_count || 0);
    
    if (eventBetCount >= MAX_BETS_PER_EVENT) {
      return { 
        allowed: false, 
        message: `Maximum ${MAX_BETS_PER_EVENT} bets per match. Choose a different match.` 
      };
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('[EventLimit] DB check failed, falling back to allow:', error);
    return { allowed: true };
  }
}

export async function registerRoutes(app: express.Express): Promise<Server> {
  // Initialize services
  const adminService = new AdminService();

  // Validate environment on startup
  const envValidation = EnvValidationService.validateEnvironment();
  EnvValidationService.printValidationResults(envValidation);

  // Start the settlement worker for automatic bet settlement
  settlementWorker.start();
  console.log('🔄 Settlement worker started - will automatically settle bets when matches finish');
  
  // Treasury auto-withdraw is DISABLED by default - must be triggered manually via /api/admin/treasury/withdraw
  // treasuryAutoWithdrawService.start(); // DISABLED: Auto-withdraw causes unwanted transactions
  console.log('💰 Treasury auto-withdraw is MANUAL ONLY - use /api/admin/treasury/withdraw to trigger');
  
  // Start background odds prefetcher for 100% real odds coverage
  apiSportsService.startOddsPrefetcher();
  console.log('🎰 Odds prefetcher started - continuously warming odds cache for instant responses');
  
  // Start FREE sports scheduler (basketball, baseball, hockey, MMA, american-football)
  // These use free API tier: fetch once/day morning + results once/day night
  freeSportsService.startSchedulers();
  console.log('🆓 Free sports scheduler started - daily updates for basketball, baseball, hockey, MMA, american-football, AFL, F1, handball, rugby, volleyball');

  esportsService.start();
  console.log('🎮 Esports service started - LoL Esports + Dota 2 pro matches (free APIs)');

  // AUTO-VOID completed: 69 phantom bets voided, 30M+ SBETS liability freed (2026-03-07)
  // Can still be triggered manually via POST /api/admin/void-phantom-sbets if needed

  // Shared guard: prevents both auto-resolve worker and manual endpoint from resolving the same prediction simultaneously
  const resolvingPredictions = new Set<number>();
  // Shared guard: prevents both auto-settle worker and manual endpoint from settling the same challenge simultaneously
  const settlingChallenges = new Set<number>();

  // Auto-resolve expired prediction markets every 2 minutes
  // Majority side (more SBETS wagered) wins and splits the pool
  setInterval(async () => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq, and, lt } = await import('drizzle-orm');
      const now = new Date();
      const expiredPredictions = await db.select().from(socialPredictions)
        .where(and(eq(socialPredictions.status, 'active'), lt(socialPredictions.endDate, now)));
      
      for (const prediction of expiredPredictions) {
        if (resolvingPredictions.has(prediction.id)) {
          console.log(`[AutoResolve] Prediction #${prediction.id} already being resolved, skipping`);
          continue;
        }
        resolvingPredictions.add(prediction.id);
        try {
          const [fresh] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, prediction.id));
          if (!fresh || fresh.status !== 'active') {
            console.log(`[AutoResolve] Prediction #${prediction.id} already resolved, skipping`);
            continue;
          }
          
          const allBets = await db.select().from(socialPredictionBets)
            .where(eq(socialPredictionBets.predictionId, prediction.id));
          
          const yesTotal = allBets.filter(b => b.side === 'yes').reduce((sum, b) => sum + (b.amount || 0), 0);
          const noTotal = allBets.filter(b => b.side === 'no').reduce((sum, b) => sum + (b.amount || 0), 0);
          const totalPool = yesTotal + noTotal;
          
          if (totalPool === 0 || allBets.length === 0) {
            await db.update(socialPredictions)
              .set({ status: 'expired', resolvedAt: now })
              .where(eq(socialPredictions.id, prediction.id));
            console.log(`[AutoResolve] Prediction #${prediction.id} expired with no bets`);
            continue;
          }
          
          const resolution = yesTotal >= noTotal ? 'yes' : 'no';
          const winners = allBets.filter(b => b.side === resolution);
          const winnersTotal = winners.reduce((sum, b) => sum + (b.amount || 0), 0);
          const newStatus = resolution === 'yes' ? 'resolved_yes' : 'resolved_no';
          
          if (winners.length === 0 || winnersTotal === 0) {
            await db.update(socialPredictions)
              .set({ status: newStatus, resolvedOutcome: resolution, resolvedAt: now })
              .where(eq(socialPredictions.id, prediction.id));
            console.log(`[AutoResolve] Prediction #${prediction.id} resolved ${resolution.toUpperCase()} - no winners`);
            continue;
          }
          
          console.log(`[AutoResolve] Prediction #${prediction.id} auto-resolving: YES=${yesTotal} vs NO=${noTotal} → ${resolution.toUpperCase()} wins | Pool: ${totalPool} SBETS`);
          
          let successCount = 0;
          let failCount = 0;
          for (let i = 0; i < winners.length; i++) {
            const winner = winners[i];
            const payout = ((winner.amount || 0) / winnersTotal) * totalPool;
            if (payout <= 0) continue;
            if (i > 0) await new Promise(r => setTimeout(r, 3000));
            try {
              const result = await blockchainBetService.sendSbetsToUser(winner.wallet, payout);
              if (result.success) {
                successCount++;
                console.log(`[AutoResolve] Payout: ${payout.toFixed(0)} SBETS → ${winner.wallet.slice(0,10)}...`);
              } else {
                failCount++;
                console.error(`[AutoResolve] Payout failed: ${winner.wallet.slice(0,10)}... | ${result.error}`);
              }
            } catch (err: any) {
              failCount++;
              console.error(`[AutoResolve] Payout error: ${winner.wallet.slice(0,10)}... | ${err.message}`);
            }
          }
          
          const finalStatus = failCount === 0 ? newStatus : (successCount > 0 ? `${newStatus}_partial` : `${newStatus}_failed`);
          await db.update(socialPredictions)
            .set({ status: finalStatus, resolvedOutcome: resolution, resolvedAt: now })
            .where(eq(socialPredictions.id, prediction.id));
          console.log(`[AutoResolve] Prediction #${prediction.id} settled: ${successCount}/${winners.length} payouts OK`);
        } catch (err: any) {
          console.error(`[AutoResolve] Error resolving prediction #${prediction.id}:`, err.message);
        } finally {
          resolvingPredictions.delete(prediction.id);
        }
      }
    } catch (err: any) {
      console.error('[AutoResolve] Worker error:', err.message);
    }
  }, 2 * 60 * 1000);
  console.log('🎯 Prediction auto-resolve worker started - checks every 2 minutes for expired markets');

  // Auto-settle expired challenges every 2 minutes
  // Refunds all participants their stake when a challenge expires without manual settlement
  setInterval(async () => {
    try {
      const { socialChallenges, socialChallengeParticipants } = await import('@shared/schema');
      const { eq, and, lt } = await import('drizzle-orm');
      const now = new Date();
      const expiredChallenges = await db.select().from(socialChallenges)
        .where(and(eq(socialChallenges.status, 'open'), lt(socialChallenges.expiresAt, now)));

      for (const challenge of expiredChallenges) {
        if (settlingChallenges.has(challenge.id)) {
          console.log(`[AutoSettle] Challenge #${challenge.id} already being settled, skipping`);
          continue;
        }
        settlingChallenges.add(challenge.id);
        try {
          const [fresh] = await db.select().from(socialChallenges).where(eq(socialChallenges.id, challenge.id));
          if (!fresh || fresh.status !== 'open') {
            console.log(`[AutoSettle] Challenge #${challenge.id} already settled, skipping`);
            continue;
          }

          const participants = await db.select().from(socialChallengeParticipants)
            .where(eq(socialChallengeParticipants.challengeId, challenge.id));

          const stakeAmount = challenge.stakeAmount || 0;
          const allWallets = [challenge.creatorWallet!, ...participants.map(p => p.wallet)].filter(Boolean);

          if (allWallets.length === 0 || stakeAmount === 0) {
            await db.update(socialChallenges)
              .set({ status: 'expired' })
              .where(eq(socialChallenges.id, challenge.id));
            console.log(`[AutoSettle] Challenge #${challenge.id} expired with no participants`);
            continue;
          }

          console.log(`[AutoSettle] Challenge #${challenge.id} expired - refunding ${stakeAmount} SBETS to ${allWallets.length} participant(s)`);

          let successCount = 0;
          let failCount = 0;
          for (let i = 0; i < allWallets.length; i++) {
            const w = allWallets[i];
            if (i > 0) await new Promise(r => setTimeout(r, 3000));
            try {
              const result = await blockchainBetService.sendSbetsToUser(w, stakeAmount);
              if (result.success) {
                successCount++;
                console.log(`[AutoSettle] Refund: ${stakeAmount} SBETS -> ${w.slice(0,10)}...`);
              } else {
                failCount++;
                console.error(`[AutoSettle] Refund failed: ${w.slice(0,10)}... | ${result.error}`);
              }
            } catch (err: any) {
              failCount++;
              console.error(`[AutoSettle] Refund error: ${w.slice(0,10)}... | ${err.message}`);
            }
          }

          const finalStatus = failCount === 0 ? 'expired_refunded' : (successCount > 0 ? 'expired_partial_refund' : 'expired_refund_failed');
          await db.update(socialChallenges)
            .set({ status: finalStatus })
            .where(eq(socialChallenges.id, challenge.id));
          console.log(`[AutoSettle] Challenge #${challenge.id} settled: ${successCount}/${allWallets.length} refunds OK | Status: ${finalStatus}`);
        } catch (err: any) {
          console.error(`[AutoSettle] Error settling challenge #${challenge.id}:`, err.message);
        } finally {
          settlingChallenges.delete(challenge.id);
        }
      }
    } catch (err: any) {
      console.error('[AutoSettle] Challenge worker error:', err.message);
    }
  }, 2 * 60 * 1000);
  console.log('🏆 Challenge auto-settle worker started - checks every 2 minutes for expired challenges');

  // Create HTTP server
  const httpServer = createServer(app);

  // Admin session tokens (in-memory with 1 hour expiry)
  const adminSessions = new Map<string, { expiresAt: number }>();
  const SESSION_DURATION = 60 * 60 * 1000; // 1 hour

  const generateSecureToken = () => {
    const array = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  };

  const isValidAdminSession = (token: string): boolean => {
    const session = adminSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      adminSessions.delete(token);
      return false;
    }
    return true;
  };

  // Clean up expired sessions periodically
  setInterval(() => {
    const now = Date.now();
    Array.from(adminSessions.entries()).forEach(([token, session]) => {
      if (now > session.expiresAt) {
        adminSessions.delete(token);
      }
    });
  }, 5 * 60 * 1000); // Every 5 minutes

  // Betting status endpoint - check if SUI betting is paused
  app.get("/api/betting-status", (req: Request, res: Response) => {
    res.json({
      suiBettingPaused: SUI_BETTING_PAUSED,
      sbetsBettingEnabled: true,
      pauseMessage: SUI_BETTING_PAUSED ? SUI_PAUSE_MESSAGE : null
    });
  });

  app.get("/api/config/public", (req: Request, res: Response) => {
    res.json({
      googleClientId: process.env.VITE_GOOGLE_CLIENT_ID || '',
    });
  });

  // Health check endpoint
  app.get("/api/health", async (req: Request, res: Response) => {
    const report = monitoringService.getHealthReport();
    const statusCode = report.status === 'HEALTHY' ? 200 : 503;
    res.status(statusCode).json(report);
  });

  app.get("/api/sports-status", async (req: Request, res: Response) => {
    const rateLimited = apiSportsService.isRateLimited();
    const minutesRemaining = apiSportsService.getRateLimitMinutesRemaining();
    const freeSportsCount = freeSportsService.getUpcomingEvents().length;
    res.json({
      rateLimited,
      minutesRemaining,
      freeSportsEventsCount: freeSportsCount,
      message: rateLimited
        ? `Sports data temporarily unavailable - API quota reached. Will auto-recover in ~${minutesRemaining} minutes.`
        : 'Sports data available'
    });
  });

  // System stats endpoint
  app.get("/api/admin/stats", async (req: Request, res: Response) => {
    try {
      const stats = monitoringService.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Admin force-settle endpoint (supports both token and password auth)
  app.post("/api/admin/settle-bet", async (req: Request, res: Response) => {
    try {
      const { betId, outcome, reason, adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      // Check token-based auth first, then fall back to password auth
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      if (!betId || !outcome) {
        return res.status(400).json({ message: "Missing required fields: betId, outcome" });
      }

      if (!['won', 'lost', 'void'].includes(outcome)) {
        return res.status(400).json({ message: "Invalid outcome - must be 'won', 'lost', or 'void'" });
      }

      // Update bet status directly and handle payouts - ONLY if status update succeeds (prevents double payout)
      const bet = await storage.getBetByStringId(betId);
      
      if (!bet) {
        console.log(`❌ Bet ${betId} not found`);
        return res.status(404).json({ message: "Bet not found" });
      }
      
      const statusUpdated = await storage.updateBetStatus(betId, outcome);
      
      if (statusUpdated) {
        // Map storage field names correctly: stake, potentialWin, currency
        const currency = (bet.currency === 'SBETS' || bet.feeCurrency === 'SBETS') ? 'SBETS' : 'SUI';
        const walletId = bet.walletAddress || String(bet.userId);
        const stake = bet.stake || bet.betAmount || 0;
        const potentialPayout = bet.potentialWin || bet.potentialPayout || 0;
        
        console.log(`🔧 ADMIN SETTLE: Processing bet ${betId} - stake: ${stake}, payout: ${potentialPayout}, currency: ${currency}`);
        
        if (outcome === 'won') {
          // Calculate and record 1% platform fee on winnings (profit only)
          const profit = potentialPayout - stake;
          const platformFee = profit > 0 ? profit * 0.01 : 0;
          const netPayout = potentialPayout - platformFee;
          
          const winningsAdded = await balanceService.addWinnings(walletId, netPayout, currency);
          if (!winningsAdded) {
            // CRITICAL: Revert bet status if balance credit failed
            await storage.updateBetStatus(betId, 'pending');
            console.error(`❌ SETTLEMENT REVERTED: Failed to credit winnings for bet ${betId}`);
            return res.status(500).json({ message: "Failed to credit winnings - settlement reverted" });
          }
          // Record platform fee as revenue
          if (platformFee > 0) {
            await balanceService.addRevenue(platformFee, currency);
          }
          console.log(`💰 ADMIN SETTLE: ${walletId} won ${netPayout} ${currency} (fee: ${platformFee} ${currency})`);
        } else if (outcome === 'lost') {
          // Add full stake to platform revenue
          await balanceService.addRevenue(stake, currency);
          console.log(`📊 ADMIN SETTLE: ${stake} ${currency} added to revenue from lost bet`);
        } else if (outcome === 'void') {
          // VOID: Return stake to treasury (SBETS already in treasury from on-chain transfer)
          // Do NOT refund to user - voided bets release funds back to treasury
          await balanceService.addRevenue(stake, currency);
          console.log(`🔄 ADMIN SETTLE (VOID): ${stake} ${currency} returned to treasury from voided bet ${betId} (wallet: ${walletId})`);
        }
      } else {
        console.log(`⚠️ Bet ${betId} already settled - no payout applied`);
        return res.status(400).json({ message: "Bet already settled" });
      }
      
      const action = {
        id: `admin-settle-${betId}-${Date.now()}`,
        betId,
        outcome,
        reason: reason || 'Admin force settle',
        timestamp: Date.now()
      };
      
      monitoringService.logSettlement({
        settlementId: action.id,
        betId,
        outcome,
        payout: bet?.potentialWin || bet?.potentialPayout || 0,
        timestamp: Date.now(),
        fees: 0
      });
      
      console.log(`✅ ADMIN: Settled bet ${betId} as ${outcome}`);
      res.json({ success: true, action });
    } catch (error: any) {
      console.error("Admin settle error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Admin force on-chain settlement endpoint - retry failed blockchain payouts
  app.post("/api/admin/force-onchain-settlement", async (req: Request, res: Response) => {
    try {
      const { betId, outcome, adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      // Check token-based auth first, then fall back to password auth
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      if (!betId || !outcome) {
        return res.status(400).json({ message: "Missing required fields: betId, outcome" });
      }

      if (!['won', 'lost', 'void'].includes(outcome)) {
        return res.status(400).json({ message: "Invalid outcome - must be 'won', 'lost', or 'void'" });
      }

      console.log(`🔧 ADMIN: Force on-chain settlement for bet ${betId} as ${outcome}`);
      
      const result = await settlementWorker.forceOnChainSettlement(betId, outcome);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `On-chain settlement executed successfully`,
          txHash: result.txHash,
          betId,
          outcome
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: result.error || 'On-chain settlement failed',
          betId,
          outcome
        });
      }
    } catch (error: any) {
      console.error("Admin force on-chain settlement error:", error);
      res.status(500).json({ message: error.message || 'Unknown error' });
    }
  });

  // Admin get bets needing on-chain settlement
  app.get("/api/admin/bets-needing-settlement", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const bets = await settlementWorker.getBetsNeedingOnChainSettlement();
      res.json({ 
        success: true, 
        count: bets.length,
        bets: bets.map(b => ({
          id: b.id,
          betObjectId: b.betObjectId,
          status: b.status,
          walletAddress: b.walletAddress,
          betAmount: b.betAmount,
          potentialPayout: b.potentialPayout,
          currency: b.feeCurrency || 'SUI'
        }))
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin cancel-bet endpoint
  app.post("/api/admin/cancel-bet", async (req: Request, res: Response) => {
    try {
      const { betId, reason, adminPassword } = req.body;
      
      if (!betId || !adminPassword) {
        return res.status(400).json({ message: "Missing required fields: betId, adminPassword" });
      }

      const action = await adminService.cancelBet(betId, reason || 'Admin cancelled', adminPassword);
      
      if (action) {
        monitoringService.logCancelledBet(betId, reason || 'Admin cancelled');
        res.json({ success: true, action });
      } else {
        res.status(401).json({ message: "Unauthorized" });
      }
    } catch (error: any) {
      console.error("Admin cancel error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Admin refund endpoint
  app.post("/api/admin/refund-bet", async (req: Request, res: Response) => {
    try {
      const { betId, amount, reason, adminPassword } = req.body;
      
      if (!betId || amount === undefined || !adminPassword) {
        return res.status(400).json({ message: "Missing required fields: betId, amount, adminPassword" });
      }

      const action = await adminService.refundBet(betId, amount, reason || 'Admin refund', adminPassword);
      
      if (action) {
        res.json({ success: true, action });
      } else {
        res.status(401).json({ message: "Unauthorized" });
      }
    } catch (error: any) {
      console.error("Admin refund error:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Admin logs endpoint
  app.get("/api/admin/logs", async (req: Request, res: Response) => {
    try {
      const logs = monitoringService.getRecentLogs(50);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  // Admin login endpoint
  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      const adminPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      
      if (password === adminPassword) {
        // Generate a secure session token
        const sessionToken = generateSecureToken();
        adminSessions.set(sessionToken, { expiresAt: Date.now() + SESSION_DURATION });
        console.log('✅ ADMIN: Login successful');
        res.json({ success: true, token: sessionToken });
      } else {
        console.warn('❌ ADMIN: Login failed - invalid password');
        res.status(401).json({ success: false, message: "Invalid password" });
      }
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Admin get all bets endpoint
  app.get("/api/admin/all-bets", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { status } = req.query;
      const allBets = await storage.getAllBets(status as string);
      const stats = {
        total: allBets.length,
        pending: allBets.filter(b => b.status === 'pending').length,
        won: allBets.filter(b => b.status === 'won').length,
        lost: allBets.filter(b => b.status === 'lost').length,
        void: allBets.filter(b => b.status === 'void' || b.status === 'cancelled').length,
        totalStake: allBets.reduce((sum, b) => sum + (b.stake || 0), 0),
        totalPotentialWin: allBets.reduce((sum, b) => sum + (b.potentialWin || 0), 0)
      };
      
      res.json({ bets: allBets, stats });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bets" });
    }
  });

  // Admin get legacy bets (without betObjectId - stuck liability)
  app.get("/api/admin/legacy-bets", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Get all bets and filter for those without betObjectId (legacy bets causing stuck liability)
      const allBets = await storage.getAllBets();
      const legacyBets = allBets.filter(b => !b.betObjectId && b.status !== 'pending');
      
      // Calculate stuck liability based on potential payouts
      const stuckLiabilitySui = legacyBets
        .filter(b => b.currency === 'SUI')
        .reduce((sum, b) => sum + (b.potentialWin || 0), 0);
      const stuckLiabilitySbets = legacyBets
        .filter(b => b.currency === 'SBETS')
        .reduce((sum, b) => sum + (b.potentialWin || 0), 0);
      
      res.json({ 
        legacyBets,
        stuckLiabilitySui,
        stuckLiabilitySbets,
        count: legacyBets.length
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch legacy bets" });
    }
  });

  // Admin settle all pending bets endpoint
  app.post("/api/admin/settle-all", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { outcome } = req.body;
      
      if (!['won', 'lost', 'void'].includes(outcome)) {
        return res.status(400).json({ message: "Invalid outcome - must be 'won', 'lost', or 'void'" });
      }
      
      const pendingBets = await storage.getAllBets('pending');
      const results = [];
      
      for (const bet of pendingBets) {
        try {
          const statusUpdated = await storage.updateBetStatus(bet.id, outcome);
          if (statusUpdated) {
            if (outcome === 'won') {
              await balanceService.addWinnings(bet.walletAddress || String(bet.userId), bet.potentialWin || 0, bet.currency === 'SBETS' ? 'SBETS' : 'SUI');
            } else if (outcome === 'lost' || outcome === 'void') {
              await balanceService.addRevenue(bet.stake || 0, bet.currency === 'SBETS' ? 'SBETS' : 'SUI');
            }
            results.push({ betId: bet.id, status: 'settled', outcome });
          } else {
            results.push({ betId: bet.id, status: 'skipped', outcome, reason: 'Already settled' });
          }
        } catch (err) {
          results.push({ betId: bet.id, status: 'error', error: String(err) });
        }
      }
      
      console.log(`✅ ADMIN: Settled ${results.filter(r => r.status === 'settled').length} bets as ${outcome}`);
      res.json({ success: true, settled: results.length, results });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/settle-event", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { eventId, winnerId, winnerName } = req.body;
      
      if (!eventId) {
        return res.status(400).json({ message: "Missing required field: eventId" });
      }
      if (!winnerId && !winnerName) {
        return res.status(400).json({ message: "Must provide winnerId or winnerName" });
      }
      
      const allBets = await storage.getAllBets('pending');
      const eventBets = allBets.filter(b => 
        b.eventId === eventId || 
        b.externalEventId === eventId ||
        String(b.eventId) === String(eventId)
      );
      
      if (eventBets.length === 0) {
        return res.json({ success: true, message: "No pending bets found for this event", settled: 0 });
      }
      
      const results = [];
      for (const bet of eventBets) {
        try {
          const selectedOutcome = (bet.prediction || bet.selectedOutcome || bet.selection || '').trim().toLowerCase();
          const winnerNorm = (winnerName || '').trim().toLowerCase();
          const homeNorm = (bet.homeTeam || '').trim().toLowerCase();
          const awayNorm = (bet.awayTeam || '').trim().toLowerCase();
          
          if (!selectedOutcome) {
            results.push({ betId: bet.id, status: 'skipped', reason: 'empty selection' });
            continue;
          }
          
          const isWinner = winnerId 
            ? (selectedOutcome === winnerId || bet.selectedOutcomeId === winnerId || selectedOutcome === winnerId.toLowerCase())
            : (selectedOutcome === winnerNorm ||
               (homeNorm && homeNorm === winnerNorm && (selectedOutcome.includes('home') || selectedOutcome === homeNorm)) ||
               (awayNorm && awayNorm === winnerNorm && (selectedOutcome.includes('away') || selectedOutcome === awayNorm)) ||
               (homeNorm && selectedOutcome === homeNorm && homeNorm === winnerNorm) ||
               (awayNorm && selectedOutcome === awayNorm && awayNorm === winnerNorm));
          
          const outcome = isWinner ? 'won' : 'lost';
          const statusUpdated = await storage.updateBetStatus(bet.id, outcome);
          
          if (statusUpdated) {
            const currency = (bet.currency === 'SBETS' || bet.feeCurrency === 'SBETS') ? 'SBETS' : 'SUI';
            const walletId = bet.walletAddress || String(bet.userId);
            const stake = bet.stake || bet.betAmount || 0;
            const potentialPayout = bet.potentialWin || bet.potentialPayout || 0;
            
            try {
              if (outcome === 'won') {
                const profit = potentialPayout - stake;
                const platformFee = profit > 0 ? profit * 0.01 : 0;
                const netPayout = potentialPayout - platformFee;
                await balanceService.addWinnings(walletId, netPayout, currency);
                if (platformFee > 0) await balanceService.addRevenue(platformFee, currency);
              } else {
                await balanceService.addRevenue(stake, currency);
              }
            } catch (balanceErr) {
              await storage.updateBetStatus(bet.id, 'pending');
              results.push({ betId: bet.id, status: 'error', error: `Balance update failed, reverted to pending: ${balanceErr}` });
              continue;
            }
            results.push({ betId: bet.id, outcome, selection: selectedOutcome });
          }
        } catch (err) {
          results.push({ betId: bet.id, status: 'error', error: String(err) });
        }
      }
      
      const won = results.filter(r => r.outcome === 'won').length;
      const lost = results.filter(r => r.outcome === 'lost').length;
      console.log(`✅ ADMIN EVENT SETTLE: ${eventId} - ${won} won, ${lost} lost (winner: ${winnerName || winnerId})`);
      res.json({ success: true, eventId, winner: winnerName || winnerId, settled: results.length, won, lost, results });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // API error statistics
  app.get("/api/admin/error-stats", async (req: Request, res: Response) => {
    try {
      const stats = errorHandlingService.getErrorStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch error stats" });
    }
  });

  // Platform revenue endpoint - shows split breakdown
  app.get("/api/admin/revenue", async (req: Request, res: Response) => {
    try {
      const totalRevenue = await balanceService.getPlatformRevenue();
      const holdersRevenue = await storage.getRevenueForHolders();
      const treasuryBuffer = await storage.getTreasuryBuffer();
      const platformProfit = await storage.getPlatformProfit();
      const contractInfo = await blockchainBetService.getPlatformInfo();
      
      res.json({
        // Total accumulated revenue (legacy tracking)
        totalRevenue: {
          sui: totalRevenue.suiBalance,
          sbets: totalRevenue.sbetsBalance
        },
        // Revenue split breakdown (30/40/30)
        revenueSplit: {
          holders: {
            sui: holdersRevenue.suiRevenue,
            sbets: holdersRevenue.sbetsRevenue,
            percentage: 30
          },
          treasuryBuffer: {
            sui: treasuryBuffer.suiBalance,
            sbets: treasuryBuffer.sbetsBalance,
            percentage: 40
          },
          platformProfit: {
            sui: platformProfit.suiBalance,
            sbets: platformProfit.sbetsBalance,
            percentage: 30
          }
        },
        onChainContract: contractInfo || {
          treasuryBalance: 0,
          totalBets: 0,
          totalVolume: 0,
          accruedFees: 0
        },
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error fetching revenue:', error);
      res.status(500).json({ message: "Failed to fetch revenue" });
    }
  });
  
  // Withdraw platform profit (admin only - the 30% owner share)
  app.post("/api/admin/withdraw-profit", async (req: Request, res: Response) => {
    try {
      const { amount, currency, adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount required" });
      }
      
      const tokenCurrency = currency === 'SBETS' ? 'SBETS' : 'SUI';
      const profit = await storage.getPlatformProfit();
      const available = tokenCurrency === 'SBETS' ? profit.sbetsBalance : profit.suiBalance;
      
      if (amount > available) {
        return res.status(400).json({ 
          message: `Insufficient ${tokenCurrency} profit. Available: ${available.toFixed(4)} ${tokenCurrency}` 
        });
      }
      
      // Deduct from profit account
      const profitWallet = 'platform_profit';
      const suiDelta = tokenCurrency === 'SUI' ? -amount : 0;
      const sbetsDelta = tokenCurrency === 'SBETS' ? -amount : 0;
      await storage.updateUserBalance(profitWallet, suiDelta, sbetsDelta);
      
      // Execute on-chain transfer to admin wallet if configured
      const adminWallet = '0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50';
      let txHash = `profit-withdraw-${Date.now()}`;
      
      if (blockchainBetService.isAdminKeyConfigured()) {
        try {
          const payoutResult = tokenCurrency === 'SBETS' 
            ? await blockchainBetService.executePayoutSbetsOnChain(adminWallet, amount)
            : await blockchainBetService.executePayoutOnChain(adminWallet, amount);
          if (payoutResult.success && payoutResult.txHash) {
            txHash = payoutResult.txHash;
          }
        } catch (payoutError) {
          console.warn('On-chain payout failed, profit deducted from DB only:', payoutError);
        }
      }
      
      console.log(`[Admin] Platform profit withdrawn: ${amount} ${tokenCurrency} | TX: ${txHash}`);
      res.json({ success: true, amount, currency: tokenCurrency, txHash });
    } catch (error) {
      console.error('Error withdrawing profit:', error);
      res.status(500).json({ message: "Failed to withdraw profit" });
    }
  });

  // Withdraw fees from contract (admin only)
  app.post("/api/admin/withdraw-fees", async (req: Request, res: Response) => {
    try {
      const { amount, adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      console.log(`[Admin] Withdraw SUI request: amount=${amount}, hasToken=${!!token}, hasPassword=${!!adminPassword}`);
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      // Debug: show password comparison (redacted for security)
      console.log(`[Admin] Auth check: validToken=${hasValidToken}, validPassword=${hasValidPassword}`);
      console.log(`[Admin] Password debug: providedLen=${adminPassword?.length || 0}, expectedLen=${actualPassword.length}`);
      
      if (!hasValidToken && !hasValidPassword) {
        console.log(`[Admin] Unauthorized - no valid token or password`);
        return res.status(401).json({ message: "Unauthorized - provide valid admin password or session token" });
      }
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount required" });
      }
      
      // Check if admin key is configured
      if (!blockchainBetService.isAdminKeyConfigured()) {
        return res.status(400).json({ success: false, error: "ADMIN_PRIVATE_KEY not configured on server" });
      }
      
      console.log(`[Admin] Executing SUI withdrawal: ${amount} SUI`);
      const result = await blockchainBetService.withdrawFeesOnChain(amount);
      if (result.success) {
        console.log(`[Admin] SUI withdrawal successful: ${result.txHash}`);
        res.json({ success: true, txHash: result.txHash, amount });
      } else {
        console.log(`[Admin] SUI withdrawal failed: ${result.error}`);
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error(`[Admin] SUI withdrawal error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  // Withdraw SBETS fees from contract (admin only)
  app.post("/api/admin/withdraw-fees-sbets", async (req: Request, res: Response) => {
    try {
      const { amount, adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      console.log(`[Admin] Withdraw SBETS request: amount=${amount}, hasToken=${!!token}, hasPassword=${!!adminPassword}`);
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      console.log(`[Admin] Auth check: validToken=${hasValidToken}, validPassword=${hasValidPassword}`);
      
      if (!hasValidToken && !hasValidPassword) {
        console.log(`[Admin] Unauthorized - no valid token or password`);
        return res.status(401).json({ message: "Unauthorized - provide valid admin password or session token" });
      }
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount required" });
      }
      
      // Check if admin key is configured
      if (!blockchainBetService.isAdminKeyConfigured()) {
        return res.status(400).json({ success: false, error: "ADMIN_PRIVATE_KEY not configured on server" });
      }
      
      console.log(`[Admin] Executing SBETS withdrawal: ${amount} SBETS`);
      const result = await blockchainBetService.withdrawFeesSbetsOnChain(amount);
      if (result.success) {
        console.log(`[Admin] SBETS withdrawal successful: ${result.txHash}`);
        res.json({ success: true, txHash: result.txHash, amount });
      } else {
        console.log(`[Admin] SBETS withdrawal failed: ${result.error}`);
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error(`[Admin] SBETS withdrawal error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  // Treasury auto-withdraw status and manual trigger (admin only)
  app.get("/api/admin/treasury-status", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const adminPassword = req.headers['x-admin-password'] as string;
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const stats = await treasuryAutoWithdrawService.getTreasuryStats();
      const serviceStatus = treasuryAutoWithdrawService.getStatus();
      
      res.json({
        success: true,
        autoWithdrawService: serviceStatus,
        treasury: stats,
      });
    } catch (error: any) {
      console.error(`[Admin] Treasury status error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/treasury-withdraw-now", async (req: Request, res: Response) => {
    try {
      const { adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      console.log('[Admin] Manual treasury withdraw triggered');
      const result = await treasuryAutoWithdrawService.triggerManual();
      
      res.json({
        success: true,
        suiWithdrawn: result.suiWithdrawn,
        sbetsWithdrawn: result.sbetsWithdrawn,
        suiTxHash: result.suiTxHash,
        sbetsTxHash: result.sbetsTxHash,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error(`[Admin] Manual treasury withdraw error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/withdraw-treasury-sbets", async (req: Request, res: Response) => {
    try {
      const { adminPassword, amount, recipientAddress } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "Amount required" });
      }

      console.log(`[Admin] Treasury SBETS withdrawal: ${amount} SBETS`);
      
      const withdrawResult = await blockchainBetService.withdrawTreasurySbetsOnChain(amount);
      if (!withdrawResult.success) {
        return res.status(500).json({ success: false, message: `Treasury withdraw failed: ${withdrawResult.error}` });
      }

      let sendResult = null;
      if (recipientAddress) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        sendResult = await blockchainBetService.sendSbetsToUser(recipientAddress, amount);
        console.log(`[Admin] Send ${amount} SBETS to ${recipientAddress}: ${sendResult.success ? sendResult.txHash : sendResult.error}`);
      }

      res.json({
        success: true,
        withdrawTxHash: withdrawResult.txHash,
        sendTxHash: sendResult?.txHash,
        sendSuccess: sendResult?.success,
        sendError: sendResult?.error,
        amount,
        recipientAddress,
      });
    } catch (error: any) {
      console.error(`[Admin] Treasury SBETS withdraw error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  // Pay unpaid winners - manually trigger on-chain payouts for bets in 'won' status
  app.post("/api/admin/pay-unpaid-winners", async (req: Request, res: Response) => {
    try {
      const { adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      console.log('[Admin] Pay unpaid winners triggered');
      
      // Find all bets in 'won' status that haven't been paid on-chain
      const unpaidBets = await db.execute(sql`
        SELECT id, wallet_address, bet_amount, potential_payout, currency, status
        FROM bets 
        WHERE status = 'won'
        AND wallet_address != '0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50'
        ORDER BY created_at ASC
      `);
      
      const betsArray = Array.isArray(unpaidBets) ? unpaidBets : (unpaidBets.rows || []);
      
      if (betsArray.length === 0) {
        return res.json({ success: true, message: "No unpaid winners found", paid: 0 });
      }
      
      const results: any[] = [];
      let paidCount = 0;
      let failedCount = 0;
      
      for (const bet of betsArray) {
        const betId = bet.id;
        const wallet = bet.wallet_address;
        const payout = parseFloat(bet.potential_payout);
        const currency = bet.currency || 'SUI';
        
        console.log(`[Admin] Paying bet ${betId}: ${payout} ${currency} to ${wallet.slice(0,10)}...`);
        
        try {
          let payoutResult;
          if (currency === 'SUI') {
            payoutResult = await blockchainBetService.sendSuiToUser(wallet, payout);
          } else if (currency === 'SBETS') {
            payoutResult = await blockchainBetService.sendSbetsToUser(wallet, payout);
          }
          
          if (payoutResult?.success && payoutResult?.txHash) {
            // Update bet status to paid_out with TX hash
            await db.execute(sql`
              UPDATE bets SET status = 'paid_out', settlement_tx_hash = ${payoutResult.txHash}
              WHERE id = ${betId}
            `);
            console.log(`✅ Paid bet ${betId}: ${payout} ${currency} | TX: ${payoutResult.txHash}`);
            results.push({ betId, wallet, payout, currency, success: true, txHash: payoutResult.txHash });
            paidCount++;
          } else {
            console.warn(`⚠️ Failed to pay bet ${betId}: ${payoutResult?.error || 'Unknown error'}`);
            results.push({ betId, wallet, payout, currency, success: false, error: payoutResult?.error });
            failedCount++;
          }
        } catch (error: any) {
          console.error(`❌ Error paying bet ${betId}:`, error.message);
          results.push({ betId, wallet, payout, currency, success: false, error: error.message });
          failedCount++;
        }
      }
      
      res.json({
        success: true,
        message: `Paid ${paidCount}/${betsArray.length} winners, ${failedCount} failed`,
        paid: paidCount,
        failed: failedCount,
        results
      });
    } catch (error: any) {
      console.error(`[Admin] Pay unpaid winners error:`, error);
      res.status(500).json({ message: error.message });
    }
  });

  // Liability reconciliation - compare on-chain vs database liability (admin only)
  app.get("/api/admin/liability-reconciliation", async (req: Request, res: Response) => {
    try {
      // Admin authentication - same as other admin endpoints
      // Accept password via X-Admin-Password header (secure) or Authorization Bearer token
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const adminPassword = req.headers['x-admin-password'] as string;
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized - provide valid X-Admin-Password header or Authorization Bearer token" });
      }

      // Get on-chain platform info
      const platformInfo = await blockchainBetService.getPlatformInfo();
      if (!platformInfo) {
        return res.status(503).json({ success: false, message: "Unable to fetch on-chain platform info" });
      }

      // Get all pending bets from database
      const pendingBets = await storage.getAllBets('pending');
      const confirmedBets = await storage.getAllBets('confirmed');
      const allUnsettledBets = [...pendingBets, ...confirmedBets];

      // Calculate expected liability from database (by currency)
      // IMPORTANT: Only use currency/feeCurrency fields, NOT bet amount heuristics
      let dbSuiLiability = 0;
      let dbSbetsLiability = 0;
      const suiBetsDetails: any[] = [];
      const sbetsBetsDetails: any[] = [];

      for (const bet of allUnsettledBets) {
        // Determine currency: feeCurrency is the accurate field indicating payment token
        // (currency column may have been set incorrectly for old bets)
        const paymentCurrency = bet.feeCurrency || bet.currency || 'SUI';
        const potentialPayout = bet.potentialPayout || (bet.betAmount * bet.odds);
        
        if (paymentCurrency === 'SBETS') {
          dbSbetsLiability += potentialPayout;
          sbetsBetsDetails.push({
            id: bet.id,
            amount: bet.betAmount,
            potentialPayout,
            currency: 'SBETS',
            feeCurrency: bet.feeCurrency,
            hasBetObjectId: !!bet.betObjectId,
            status: bet.status
          });
        } else {
          // Default to SUI for any non-SBETS currency
          dbSuiLiability += potentialPayout;
          suiBetsDetails.push({
            id: bet.id,
            amount: bet.betAmount,
            potentialPayout,
            currency: 'SUI',
            feeCurrency: bet.feeCurrency,
            hasBetObjectId: !!bet.betObjectId,
            status: bet.status
          });
        }
      }

      // Calculate mismatch
      const suiMismatch = platformInfo.totalLiabilitySui - dbSuiLiability;
      const sbetsMismatch = platformInfo.totalLiabilitySbets - dbSbetsLiability;

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        onChain: {
          suiLiability: platformInfo.totalLiabilitySui,
          sbetsLiability: platformInfo.totalLiabilitySbets,
          suiTreasury: platformInfo.treasuryBalanceSui,
          sbetsTreasury: platformInfo.treasuryBalanceSbets,
          totalBets: platformInfo.totalBets
        },
        database: {
          suiLiability: dbSuiLiability,
          sbetsLiability: dbSbetsLiability,
          suiBetsCount: suiBetsDetails.length,
          sbetsBetsCount: sbetsBetsDetails.length,
          suiBetsWithObjectId: suiBetsDetails.filter(b => b.hasBetObjectId).length,
          sbetsBetsWithObjectId: sbetsBetsDetails.filter(b => b.hasBetObjectId).length
        },
        mismatch: {
          sui: suiMismatch,
          sbets: sbetsMismatch,
          suiOrphaned: suiMismatch > 0.001, // More than 0.001 SUI orphaned
          sbetsOrphaned: sbetsMismatch > 1 // More than 1 SBETS orphaned
        },
        details: {
          suiBets: suiBetsDetails,
          sbetsBets: sbetsBetsDetails
        },
        recommendation: suiMismatch > 0.001 || sbetsMismatch > 1 
          ? "On-chain liability is higher than database expects. This may be from old bets without betObjectId that were settled in DB but not on-chain. Contact support to reconcile."
          : "Liability is in sync. No action needed."
      });
    } catch (error: any) {
      console.error('[Admin] Liability reconciliation error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Test all blockchain settlement functions
  app.get("/api/admin/test-settlement-functions", async (req: Request, res: Response) => {
    try {
      const tests: any = {
        timestamp: new Date().toISOString(),
        adminKeyConfigured: false,
        platformInfo: null,
        settlementWorkerStatus: null,
        pendingBets: 0,
        errors: []
      };
      
      // Test 1: Check admin key configuration
      tests.adminKeyConfigured = blockchainBetService.isAdminKeyConfigured();
      
      // Test 2: Get platform info (treasury balances)
      try {
        const platformInfo = await blockchainBetService.getPlatformInfo();
        tests.platformInfo = platformInfo;
      } catch (e: any) {
        tests.errors.push(`Platform info error: ${e.message}`);
      }
      
      // Test 3: Settlement worker status
      tests.settlementWorkerStatus = {
        isRunning: settlementWorker.isRunningNow(),
        settledEventsCount: settlementWorker.getSettledEventsCount(),
        settledBetsCount: settlementWorker.getSettledBetsCount()
      };
      
      // Test 4: Get pending bets count
      try {
        const pendingBets = await storage.getAllBets('pending');
        tests.pendingBets = pendingBets.length;
        tests.pendingBetDetails = pendingBets.map(b => ({
          id: b.id,
          eventId: b.eventId,
          externalEventId: b.externalEventId,
          currency: b.currency,
          stake: b.stake,
          hasBetObjectId: !!b.betObjectId
        }));
      } catch (e: any) {
        tests.errors.push(`Pending bets error: ${e.message}`);
      }
      
      // Overall status
      tests.allSystemsOperational = 
        tests.adminKeyConfigured && 
        tests.platformInfo !== null && 
        tests.settlementWorkerStatus?.isRunning === true &&
        tests.errors.length === 0;
      
      res.json(tests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger auto-settlement manually (admin only)
  app.post("/api/admin/trigger-settlement", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const { adminPassword } = req.body;
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      console.log(`[Admin Trigger Settlement] Auth check: tokenPresent=${!!token}, tokenLen=${token?.length || 0}, validToken=${hasValidToken}, passwordProvided=${!!adminPassword}, tokenPreview=${token?.slice(0, 10) || 'none'}, sessionsCount=${adminSessions.size}`);
      
      if (!hasValidToken && !hasValidPassword) {
        console.log(`[Admin Trigger Settlement] UNAUTHORIZED - token validation failed`);
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Trigger the settlement worker to check for finished matches now
      console.log('🔄 Admin triggered manual settlement check...');
      await settlementWorker.checkAndSettleBets();
      
      res.json({ 
        success: true, 
        message: 'Settlement check triggered. Check server logs for results.',
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Manual settlement trigger failed:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Sync on-chain bets to database (admin only)
  app.post("/api/admin/sync-onchain-bets", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const adminPassword = req.headers['x-admin-password'] as string;
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized - provide valid X-Admin-Password header or Authorization Bearer token" });
      }
      
      console.log('🔄 Admin triggered on-chain bet sync...');
      const syncResult = await blockchainBetService.syncOnChainBetsToDatabase();
      
      res.json({ 
        success: true, 
        message: `Synced ${syncResult.synced} on-chain bets to database`,
        synced: syncResult.synced,
        errors: syncResult.errors,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('On-chain bet sync failed:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/fix-synced-bets", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const adminPassword = req.headers['x-admin-password'] as string || req.body?.adminPassword;
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD;
      const hasValidPassword = actualPassword && adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db: fixDb } = await import('./db');
      const { sql: fixSql, eq: fixEq } = await import('drizzle-orm');
      const { bets: fixBets } = await import('@shared/schema');

      const unknownBets = await fixDb.select().from(fixBets)
        .where(fixSql`(${fixBets.homeTeam} = 'Unknown' OR ${fixBets.awayTeam} = 'Unknown' OR ${fixBets.eventName} = 'Unknown Event') AND ${fixBets.externalEventId} IS NOT NULL`);

      let fixed = 0;
      for (const bet of unknownBets) {
        const refBet = await fixDb.select({
          eventName: fixBets.eventName,
          homeTeam: fixBets.homeTeam,
          awayTeam: fixBets.awayTeam
        }).from(fixBets)
          .where(fixSql`${fixBets.externalEventId} = ${bet.externalEventId} AND ${fixBets.homeTeam} != 'Unknown' AND ${fixBets.awayTeam} != 'Unknown'`)
          .limit(1);

        if (refBet.length > 0) {
          await fixDb.update(fixBets)
            .set({
              eventName: refBet[0].eventName,
              homeTeam: refBet[0].homeTeam,
              awayTeam: refBet[0].awayTeam
            })
            .where(fixEq(fixBets.id, bet.id));
          fixed++;
          console.log(`🔧 Fixed bet ${bet.wurlusBetId || bet.id}: ${refBet[0].eventName}`);
        }
      }

      if (req.body?.betId && req.body?.giftedTo) {
        await fixDb.update(fixBets)
          .set({
            giftedTo: req.body.giftedTo,
            giftedFrom: req.body.giftedFrom || null
          })
          .where(fixEq(fixBets.id, parseInt(req.body.betId)));
        console.log(`🎁 Set gift recipient for bet ${req.body.betId}: ${req.body.giftedTo}`);
      }

      res.json({ success: true, fixed, total: unknownBets.length });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/void-phantom-sbets", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const adminPassword = req.headers['x-admin-password'] as string || req.body?.adminPassword;
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const forceReset = req.body?.forceReset === true;
      
      if (forceReset) {
        blockchainBetService.resetPhantomVoidStatus();
        console.log('🔄 Admin force-reset phantom void status');
      }
      
      const preCheck = blockchainBetService.canStartPhantomVoid();
      if (!preCheck.canStart) {
        const currentStatus = blockchainBetService.getPhantomVoidStatus();
        if (currentStatus?.running) {
          return res.json({ success: true, message: 'Void scan already in progress', status: currentStatus });
        }
        return res.status(400).json({ success: false, message: preCheck.error });
      }

      console.log('🗑️ Admin triggered ALL phantom bet void (SUI + SBETS, background)...');
      blockchainBetService.voidAllPhantomBets().then(result => {
        console.log(`🏁 Background void finished: ${result.voided} voided, ${result.liabilityFreed.toFixed(2)} total freed`);
      }).catch(err => {
        console.error('Background void error:', err);
      });
      
      res.json({ 
        success: true, 
        message: 'Phantom void scan started in background. Poll /api/admin/void-phantom-status for progress.',
        status: blockchainBetService.getPhantomVoidStatus(),
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Phantom SBETS void failed:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/admin/void-phantom-status", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const hasValidToken = token && isValidAdminSession(token);
      if (!hasValidToken) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const status = blockchainBetService.getPhantomVoidStatus();
      if (!status) {
        return res.json({ success: true, status: null, message: 'No void scan has been run yet' });
      }
      res.json({ success: true, status });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/reset-onchain-liability", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const adminPassword = req.headers['x-admin-password'] as string || req.body?.adminPassword;
      
      const hasValidToken = token && isValidAdminSession(token);
      const envPassword = process.env.ADMIN_PASSWORD;
      const hasValidPassword = envPassword && adminPassword === envPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const allBets = await storage.getAllBets();
      const activeBets = allBets.filter((b: any) => 
        b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_play' || b.status === 'open'
      );
      const realLiabilitySui = activeBets
        .filter((b: any) => b.currency === 'SUI')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
      const realLiabilitySbets = activeBets
        .filter((b: any) => b.currency === 'SBETS')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);

      const currency = req.body?.currency || 'SBETS';
      const newLiability = currency === 'SBETS' ? realLiabilitySbets : realLiabilitySui;

      console.log(`🔧 Admin resetting on-chain ${currency} liability to ${newLiability.toFixed(4)} (from DB active bets)`);

      const result = await blockchainBetService.resetOnChainLiability(currency as 'SUI' | 'SBETS', newLiability);

      res.json({
        success: result.success,
        message: result.success 
          ? `Reset ${currency} liability to ${newLiability.toFixed(4)} (matching ${activeBets.filter((b: any) => b.currency === currency).length} active bets)`
          : result.error,
        txHash: result.txHash,
        newLiability,
        activeBetCount: activeBets.filter((b: any) => b.currency === currency).length,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Liability reset failed:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get on-chain bet details including prediction (admin only)
  app.get("/api/admin/onchain-bet/:betObjectId", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const adminPassword = req.headers['x-admin-password'] as string;
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized - provide valid X-Admin-Password header or Authorization Bearer token" });
      }
      
      const { betObjectId } = req.params;
      
      if (!betObjectId || !betObjectId.startsWith('0x')) {
        return res.status(400).json({ success: false, message: "Invalid bet object ID" });
      }
      
      const betInfo = await blockchainBetService.getOnChainBetInfo(betObjectId);
      
      if (!betInfo) {
        return res.status(404).json({ success: false, message: "Bet not found on-chain" });
      }
      
      res.json({ 
        success: true, 
        bet: betInfo
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==================== ADMIN: SUI PAUSE TOGGLE ====================
  app.post("/api/admin/toggle-sui-pause", async (req: Request, res: Response) => {
    try {
      const { adminPassword, paused } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const newState = typeof paused === 'boolean' ? paused : !SUI_BETTING_PAUSED;
      SUI_BETTING_PAUSED = newState;
      console.log(`[Admin] SUI betting ${newState ? 'PAUSED' : 'UNPAUSED'} by admin`);
      
      res.json({ 
        success: true, 
        suiBettingPaused: SUI_BETTING_PAUSED,
        message: `SUI betting ${SUI_BETTING_PAUSED ? 'paused' : 'unpaused'} successfully`
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==================== ADMIN: STAKING MANAGEMENT ====================
  app.get("/api/admin/staking/all", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db } = await import('./db');
      const { wurlusStaking } = await import('@shared/schema');
      
      const allStakes = await db.select().from(wurlusStaking).orderBy(wurlusStaking.id);
      
      const dailyRate = APY_RATE / 365;
      const now = Date.now();
      const enriched = allStakes.map(s => {
        const stakeDate = new Date(s.stakingDate || now);
        const stakedDays = Math.max(0, (now - stakeDate.getTime()) / (1000 * 60 * 60 * 24));
        const principal = s.amountStaked || 0;
        const maxAnnualReward = principal * APY_RATE;
        const liveRewards = Math.min(principal * dailyRate * stakedDays, maxAnnualReward);
        const bestRewards = Math.max(liveRewards, s.accumulatedRewards || 0);
        return {
          ...s,
          stakedDays: Math.floor(stakedDays),
          currentRewards: Math.floor(bestRewards),
          dailyEarning: Math.floor(principal * dailyRate),
          canUnstake: !s.lockedUntil || new Date(s.lockedUntil) <= new Date()
        };
      });
      
      res.json({ success: true, stakes: enriched });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/staking/force-unstake", async (req: Request, res: Response) => {
    try {
      const { stakeId, adminPassword } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword && adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db } = await import('./db');
      const { wurlusStaking } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      
      const [stake] = await db.select().from(wurlusStaking)
        .where(and(eq(wurlusStaking.id, stakeId), eq(wurlusStaking.isActive, true)));
      
      if (!stake) {
        return res.status(404).json({ success: false, message: "Active stake not found" });
      }

      const stakeDate = new Date(stake.stakingDate || Date.now());
      const stakedDays = Math.max(0, (Date.now() - stakeDate.getTime()) / (1000 * 60 * 60 * 24));
      const dailyRate = APY_RATE / 365;
      const principal = stake.amountStaked || 0;
      const maxAnnualReward = principal * APY_RATE;
      const liveRewards = Math.min(principal * dailyRate * stakedDays, maxAnnualReward);
      const totalRewards = Math.max(liveRewards, stake.accumulatedRewards || 0);
      const payoutAmount = Math.floor(principal + totalRewards);

      await db.update(wurlusStaking)
        .set({ isActive: false, unstakingDate: new Date(), accumulatedRewards: Math.floor(totalRewards) })
        .where(eq(wurlusStaking.id, stakeId));

      await storage.updateUserBalance(stake.walletAddress!, 0, payoutAmount);

      console.log(`[Admin] Force unstaked ID ${stakeId}: ${principal} + ${Math.floor(totalRewards)} rewards = ${payoutAmount} SBETS to ${stake.walletAddress?.slice(0, 10)}`);
      
      res.json({ 
        success: true, 
        message: `Force unstaked ${principal.toLocaleString()} SBETS + ${Math.floor(totalRewards).toLocaleString()} rewards`,
        principal,
        rewards: Math.floor(totalRewards),
        total: payoutAmount
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==================== ADMIN: PREDICTIONS MANAGEMENT ====================
  app.get("/api/admin/predictions/all", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db } = await import('./db');
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { desc, sql } = await import('drizzle-orm');
      
      const predictions = await db.select().from(socialPredictions).orderBy(desc(socialPredictions.createdAt));
      
      res.json({ success: true, predictions });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/admin/challenges/all", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { db } = await import('./db');
      const { socialChallenges } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      
      const challenges = await db.select().from(socialChallenges).orderBy(desc(socialChallenges.createdAt));
      
      res.json({ success: true, challenges });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/predictions/resolve", async (req: Request, res: Response) => {
    try {
      const { adminPassword, predictionId, winner } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      if (!predictionId || !winner || !['YES', 'NO'].includes(winner)) {
        return res.status(400).json({ success: false, message: "predictionId and winner (YES/NO) required" });
      }

      const { db } = await import('./db');
      const { socialPredictions } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const [prediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, predictionId));
      if (!prediction) {
        return res.status(404).json({ success: false, message: "Prediction not found" });
      }
      if (prediction.status === 'resolved') {
        return res.status(400).json({ success: false, message: "Already resolved" });
      }

      await db.update(socialPredictions)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(socialPredictions.id, predictionId));
      
      console.log(`[Admin] Force resolved prediction ${predictionId} as ${winner}`);
      res.json({ success: true, message: `Prediction ${predictionId} resolved as ${winner}` });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/predictions/cancel", async (req: Request, res: Response) => {
    try {
      const { adminPassword, predictionId } = req.body;
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      
      const hasValidToken = token && isValidAdminSession(token);
      const actualPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';
      const hasValidPassword = adminPassword === actualPassword;
      
      if (!hasValidToken && !hasValidPassword) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      if (!predictionId) {
        return res.status(400).json({ success: false, message: "predictionId required" });
      }

      const { db } = await import('./db');
      const { socialPredictions } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      await db.update(socialPredictions)
        .set({ status: 'cancelled' })
        .where(eq(socialPredictions.id, predictionId));
      
      console.log(`[Admin] Cancelled prediction ${predictionId}`);
      res.json({ success: true, message: `Prediction ${predictionId} cancelled` });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Notifications endpoints
  app.get("/api/notifications", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || 'user1'; // Default user for demo
      const limit = parseInt(req.query.limit as string) || 20;
      const unreadOnly = req.query.unreadOnly === 'true';
      
      const notifications = notificationService.getUserNotifications(userId, limit, unreadOnly);
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || 'user1';
      const count = notificationService.getUnreadCount(userId);
      res.json({ unreadCount: count });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.post("/api/notifications/mark-as-read", async (req: Request, res: Response) => {
    try {
      const { userId, notificationId } = req.body;
      if (!userId || !notificationId) {
        return res.status(400).json({ message: "Missing userId or notificationId" });
      }
      const notif = notificationService.markAsRead(userId, notificationId);
      res.json({ success: !!notif });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });

  app.post("/api/notifications/mark-all-as-read", async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }
      const count = notificationService.markAllAsRead(userId);
      res.json({ success: true, markedCount: count });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark all as read" });
    }
  });

  // Treasury status endpoint - public check before placing bets
  app.get("/api/treasury/status", async (req: Request, res: Response) => {
    try {
      const platformInfo = await blockchainBetService.getPlatformInfo();
      if (!platformInfo) {
        return res.status(503).json({ 
          success: false, 
          message: "Unable to fetch treasury status" 
        });
      }
      
      const allBets = await storage.getAllBets();
      const activeBets = allBets.filter((b: any) => 
        b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_play' || b.status === 'open'
      );
      const realLiabilitySui = activeBets
        .filter((b: any) => b.currency === 'SUI')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
      const realLiabilitySbets = activeBets
        .filter((b: any) => b.currency === 'SBETS')
        .reduce((sum: number, b: any) => sum + (b.potentialPayout || b.potentialWin || 0), 0);
      
      const suiAvailable = platformInfo.treasuryBalanceSui - realLiabilitySui;
      const sbetsAvailable = platformInfo.treasuryBalanceSbets - realLiabilitySbets;
      
      res.json({
        success: true,
        sui: {
          treasury: platformInfo.treasuryBalanceSui,
          liability: realLiabilitySui,
          available: suiAvailable,
          acceptingBets: true
        },
        sbets: {
          treasury: platformInfo.treasuryBalanceSbets,
          liability: realLiabilitySbets,
          available: sbetsAvailable,
          acceptingBets: true
        },
        paused: platformInfo.paused,
        onChainLiability: {
          sui: platformInfo.totalLiabilitySui,
          sbets: platformInfo.totalLiabilitySbets,
          note: "On-chain liability may be higher due to phantom/legacy bets. Real liability is calculated from active database bets only."
        }
      });
    } catch (error) {
      console.error('Treasury status error:', error);
      res.status(500).json({ success: false, message: "Failed to fetch treasury status" });
    }
  });

  // Sports routes
  app.get("/api/sports", async (req: Request, res: Response) => {
    try {
      const sports = await storage.getSports();
      res.json(sports);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sports" });
    }
  });

  app.get("/api/events/check/:eventId", async (req: Request, res: Response) => {
    try {
      const rawEventId = req.params.eventId;
      const idsToTry: string[] = [rawEventId];
      if (rawEventId.startsWith('sync_')) {
        const cleaned = rawEventId.replace(/^sync_0x[a-fA-F0-9]+_/, '');
        if (cleaned && cleaned !== rawEventId) idsToTry.push(cleaned);
      }
      if (/^\d+$/.test(rawEventId)) {
        const sportPrefixes = ['basketball', 'ice-hockey', 'baseball', 'handball', 'rugby', 'volleyball', 'mma', 'american-football', 'afl', 'formula-1', 'boxing', 'esports', 'cricket', 'wwe'];
        for (const prefix of sportPrefixes) {
          idsToTry.push(`${prefix}_${rawEventId}`);
        }
      }

      for (const eventId of idsToTry) {
        const lookup = apiSportsService.lookupEventSync(eventId);
        if (lookup.found) {
          const isAvailable = lookup.source === 'upcoming' || (lookup.isLive && lookup.minute !== undefined && lookup.minute < 45);
          return res.json({
            available: isAvailable,
            isLive: lookup.isLive,
            source: lookup.source,
            homeTeam: lookup.homeTeam,
            awayTeam: lookup.awayTeam,
            startTime: lookup.startTime,
            shouldBeLive: lookup.shouldBeLive,
          });
        }
        const freeLookup = freeSportsService.lookupEvent(eventId);
        if (freeLookup.found && freeLookup.event) {
          const now = new Date();
          const eventStart = freeLookup.event.startTime ? new Date(freeLookup.event.startTime) : null;
          const hasStarted = eventStart ? eventStart <= now : false;
          return res.json({
            available: !hasStarted,
            isLive: false,
            source: 'free',
            homeTeam: freeLookup.event.homeTeam,
            awayTeam: freeLookup.event.awayTeam,
            startTime: freeLookup.event.startTime,
            shouldBeLive: hasStarted,
          });
        }
        const esportsLookup = esportsService.lookupEvent(eventId);
        if (esportsLookup.found && esportsLookup.event) {
          const now = new Date();
          const eventStart = esportsLookup.event.startTime ? new Date(esportsLookup.event.startTime) : null;
          const hasStarted = eventStart ? eventStart <= now : false;
          return res.json({
            available: !hasStarted,
            isLive: false,
            source: 'esports',
            homeTeam: esportsLookup.event.homeTeam,
            awayTeam: esportsLookup.event.awayTeam,
            startTime: esportsLookup.event.startTime,
            shouldBeLive: hasStarted,
          });
        }
      }
      return res.json({ available: false });
    } catch (error) {
      return res.json({ available: false });
    }
  });

  // Events route with multi-source fallback logic
  app.get("/api/events", async (req: Request, res: Response) => {
    try {
      let reqSportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      const isLive = req.query.isLive ? req.query.isLive === 'true' : undefined;
      
      if (reqSportId === 8) reqSportId = 7;
      
      console.log(`Fetching events for sportId: ${reqSportId}, isLive: ${isLive}`);
      
      // FAST PATH: Esports events (sportId=24) - return directly from cache, no football enrichment needed
      if (reqSportId === 24) {
        const esportsEvents = esportsService.getUpcomingEvents();
        const now = Date.now();
        const filtered = esportsEvents.filter(e => {
          if (!e.startTime) return true;
          return new Date(e.startTime).getTime() > now;
        });
        console.log(`⚡ FAST PATH: Returning ${filtered.length} esports events directly from cache`);
        return res.json(filtered);
      }
      
      // FAST PATH: Free sports (non-football, non-esports) - return from daily cache
      const FREE_SPORT_IDS = [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20];
      if (reqSportId && FREE_SPORT_IDS.includes(reqSportId)) {
        const freeSportsEvents = freeSportsService.getUpcomingEvents();
        const now = Date.now();
        const filtered = freeSportsEvents
          .filter(e => e.sportId === reqSportId)
          .filter(e => {
            if (!e.startTime) return true;
            return new Date(e.startTime).getTime() > now;
          });
        console.log(`⚡ FAST PATH: Returning ${filtered.length} free sport events (sportId=${reqSportId}) from daily cache`);
        return res.json(filtered);
      }
      
      // Get data from API for any sport if it's live - PAID API ONLY, NO FALLBACKS
      if (isLive === true) {
        console.log(`🔴 LIVE EVENTS MODE - Paid API-Sports ONLY (NO fallbacks, NO free alternatives)`);
        
        try {
          // Get configurable sports list
          const sportsToFetch = getSportsToFetch();
          
          const sportPromises = sportsToFetch.map(sport =>
            apiSportsService.getLiveEvents(sport).catch(e => {
              console.log(`❌ API-Sports failed for ${sport}: ${e.message} - NO FALLBACK, returning empty`);
              return [];
            })
          );
          
          const sportResults = await Promise.all(sportPromises);
          const allLiveEventsRaw = sportResults.flat();
          
          // Deduplicate events by ID to prevent repeated matches
          const seenLiveIds = new Set<string>();
          let allLiveEvents = allLiveEventsRaw.filter(event => {
            const eventId = String(event.id);
            if (seenLiveIds.has(eventId)) return false;
            seenLiveIds.add(eventId);
            return true;
          });
          
          console.log(`✅ LIVE: Fetched ${allLiveEvents.length} unique events (${allLiveEventsRaw.length} before dedup, ${sportsToFetch.length} sports)`);
          
          // Enrich events with real odds from API-Sports (football only for now)
          // Pass isLive=true to always fetch fresh odds for live events
          try {
            allLiveEvents = await apiSportsService.enrichEventsWithOdds(allLiveEvents, 'football', true);
            console.log(`✅ LIVE: Enriched events with real odds`);
          } catch (oddsError: any) {
            console.warn(`⚠️ LIVE: Failed to enrich with odds: ${oddsError.message}`);
          }
          
          // Log odds coverage stats but DON'T filter - show all events
          const eventsWithOdds = allLiveEvents.filter(e => (e as any).oddsSource === 'api-sports').length;
          console.log(`✅ LIVE: ${eventsWithOdds}/${allLiveEvents.length} events have real bookmaker odds`);
          
          // CRITICAL: Save successful results to snapshot (before any filtering)
          if (allLiveEvents.length > 0) {
            saveLiveSnapshot(allLiveEvents);
          }
          
          // Sort by startTime (earliest first, events without startTime go to end)
          allLiveEvents.sort((a, b) => {
            const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
            const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
            return timeA - timeB;
          });
          
          // Filter by sport if requested
          if (reqSportId && allLiveEvents.length > 0) {
            const filtered = allLiveEvents.filter(e => e.sportId === reqSportId);
            console.log(`Filtered to ${filtered.length} events for sport ID ${reqSportId}`);
            return res.json(filtered.length > 0 ? filtered : []);
          }
          
          // Return all live events (may be empty if API-Sports fails)
          return res.json(allLiveEvents);
        } catch (error) {
          console.error(`❌ LIVE API fetch failed:`, error);
          // CRITICAL: On error, try to return snapshot instead of empty
          const snapshot = getLiveSnapshot();
          if (snapshot.events.length > 0) {
            const ageSeconds = Math.round((Date.now() - snapshot.timestamp) / 1000);
            console.log(`⚠️ LIVE: Error occurred, using snapshot of ${snapshot.events.length} events (${ageSeconds}s old)`);
            return res.json(snapshot.events);
          }
          return res.json([]);
        }
      }
      
      // UPCOMING EVENTS MODE - PAID API ONLY, NO FALLBACKS
      console.log(`📅 UPCOMING EVENTS MODE - Paid API-Sports ONLY (NO fallbacks, NO free alternatives)`);
      try {
        // CRITICAL: Check for existing snapshot first - if we have data, return it immediately
        // This prevents rate limiting and ensures users always see events
        const existingSnapshot = getUpcomingSnapshot();
        const snapshotAgeMs = Date.now() - existingSnapshot.timestamp;
        const SNAPSHOT_FRESH_DURATION = 10 * 60 * 1000; // 10 minutes (AGGRESSIVE API SAVING)
        
        if (existingSnapshot.events.length > 0 && snapshotAgeMs < SNAPSHOT_FRESH_DURATION) {
          console.log(`📦 Using fresh snapshot (${existingSnapshot.events.length} events, ${Math.round(snapshotAgeMs/1000)}s old)`);
          let allUpcomingEvents = [...existingSnapshot.events];
          
          // CRITICAL: ALWAYS add free sports events from daily cache
          // These are Basketball, Baseball, Hockey, MMA, AFL, Formula 1, Handball, NBA, NFL, Rugby, Volleyball
          try {
            const freeSportsEvents = freeSportsService.getUpcomingEvents();
            if (freeSportsEvents.length > 0) {
              const existingIds = new Set(allUpcomingEvents.map(e => String(e.id)));
              const newFreeSportsEvents = freeSportsEvents.filter(e => !existingIds.has(String(e.id)));
              allUpcomingEvents.push(...newFreeSportsEvents);
              console.log(`📦 Added ${newFreeSportsEvents.length} free sports events (${freeSportsEvents.length} total in cache)`);
            }
          } catch (e) {
            console.log(`📦 Free sports cache empty`);
          }
          
          try {
            const esportsEvents = esportsService.getUpcomingEvents();
            if (esportsEvents.length > 0) {
              const existingIds = new Set(allUpcomingEvents.map(e => String(e.id)));
              const newEsportsEvents = esportsEvents.filter(e => !existingIds.has(String(e.id)));
              allUpcomingEvents.push(...newEsportsEvents);
              console.log(`📦 Added ${newEsportsEvents.length} esports events (LoL + Dota 2)`);
            }
          } catch (e) {
            console.log(`📦 Esports cache empty`);
          }
          
          // CRITICAL: Apply cached odds from prefetcher to snapshot events
          // This ensures odds are updated as the prefetcher warms the cache
          try {
            allUpcomingEvents = await apiSportsService.enrichEventsWithCachedOddsOnly(allUpcomingEvents, 'football');
            const oddsCount = allUpcomingEvents.filter(e => (e as any).oddsSource === 'api-sports').length;
            console.log(`📦 Applied cached odds: ${oddsCount}/${allUpcomingEvents.length} events have odds`);
          } catch (e) {
            console.log(`📦 Could not apply cached odds`);
          }
          
          // Sort by startTime
          allUpcomingEvents.sort((a, b) => {
            const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
            const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
            return timeA - timeB;
          });
          
          // Filter out started events - football moves to live tab, free sports have no live mode so remove them
          const now = Date.now();
          allUpcomingEvents = allUpcomingEvents.filter(e => {
            if (!e.startTime) return true;
            return new Date(e.startTime).getTime() > now;
          });
          
          // Filter by sport if requested
          if (reqSportId && allUpcomingEvents.length > 0) {
            const filtered = allUpcomingEvents.filter(e => e.sportId === reqSportId);
            console.log(`Filtered to ${filtered.length} events for sport ID ${reqSportId}`);
            return res.json(filtered);
          }
          
          return res.json(allUpcomingEvents);
        }
        
        // Fetch football FIRST (main source of events) then others sequentially with delays
        console.log(`📍 Fetching events (football priority, sequential for rate limit protection)`);
        const allUpcomingEventsRaw: any[] = [];
        
        // Football first - this is where 99% of events come from
        try {
          const footballEvents = await apiSportsService.getUpcomingEvents('football');
          allUpcomingEventsRaw.push(...footballEvents);
          console.log(`✅ Football: ${footballEvents.length} events`);
        } catch (e: any) {
          console.log(`❌ Football failed: ${e.message}`);
        }
        
        try {
          const freeSportsEvents = freeSportsService.getUpcomingEvents();
          if (freeSportsEvents.length > 0) {
            allUpcomingEventsRaw.push(...freeSportsEvents);
            console.log(`✅ Free Sports: ${freeSportsEvents.length} events (from daily cache)`);
          }
        } catch (e: any) {
          console.log(`⚠️ Free Sports cache empty or error: ${e.message}`);
        }
        
        try {
          const esportsEvents = esportsService.getUpcomingEvents();
          if (esportsEvents.length > 0) {
            allUpcomingEventsRaw.push(...esportsEvents);
            console.log(`✅ Esports: ${esportsEvents.length} events (LoL + Dota 2)`);
          }
        } catch (e: any) {
          console.log(`⚠️ Esports cache empty or error: ${e.message}`);
        }
        
        // Deduplicate events by ID to prevent repeated matches
        const seenUpcomingIds = new Set<string>();
        let allUpcomingEvents = allUpcomingEventsRaw.filter(event => {
          const eventId = String(event.id);
          if (seenUpcomingIds.has(eventId)) return false;
          seenUpcomingIds.add(eventId);
          return true;
        });
        
        console.log(`✅ UPCOMING: Fetched ${allUpcomingEvents.length} unique events (${allUpcomingEventsRaw.length} before dedup, football only)`);
        
        // FAST PATH: Only apply pre-warmed odds from cache (no blocking API calls)
        // The background prefetcher handles warming the odds cache asynchronously
        try {
          // Use fast mode: only apply odds from cache, don't make new API calls
          allUpcomingEvents = await apiSportsService.enrichEventsWithCachedOddsOnly(allUpcomingEvents, 'football');
          console.log(`✅ UPCOMING: Applied cached odds (fast path)`);
        } catch (oddsError: any) {
          console.warn(`⚠️ UPCOMING: Failed to apply cached odds: ${oddsError.message}`);
        }
        
        // Log odds coverage stats but DON'T filter - show all events
        const eventsWithOdds = allUpcomingEvents.filter(e => (e as any).oddsSource === 'api-sports').length;
        console.log(`✅ UPCOMING: ${eventsWithOdds}/${allUpcomingEvents.length} events have real bookmaker odds`);
        
        // CRITICAL: Save successful results to snapshot (before any filtering)
        if (allUpcomingEvents.length > 0) {
          saveUpcomingSnapshot(allUpcomingEvents);
        } else {
          // If we got 0 events but have a snapshot, use it instead (NEVER return empty)
          const snapshot = getUpcomingSnapshot();
          if (snapshot.events.length > 0) {
            const ageSeconds = Math.round((Date.now() - snapshot.timestamp) / 1000);
            console.log(`⚠️ UPCOMING: Got 0 events, using snapshot of ${snapshot.events.length} events (${ageSeconds}s old)`);
            allUpcomingEvents = snapshot.events;
          }
        }
        
        // Sort by startTime (earliest first, events without startTime go to end)
        allUpcomingEvents.sort((a, b) => {
          const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
          const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
          return timeA - timeB;
        });
        
        // Filter out events that have already started - all sports
        // Football moves to live tab, free sports have no live mode so they disappear
        const now = Date.now();
        const beforeFilter = allUpcomingEvents.length;
        allUpcomingEvents = allUpcomingEvents.filter(e => {
          if (!e.startTime) return true;
          return new Date(e.startTime).getTime() > now;
        });
        if (beforeFilter !== allUpcomingEvents.length) {
          console.log(`📦 Filtered out ${beforeFilter - allUpcomingEvents.length} already-started events from upcoming`);
        }
        
        // Filter by sport if requested
        if (reqSportId && allUpcomingEvents.length > 0) {
          const filtered = allUpcomingEvents.filter(e => e.sportId === reqSportId);
          console.log(`Filtered to ${filtered.length} events for sport ID ${reqSportId}`);
          return res.json(filtered.length > 0 ? filtered : []);
        }
        
        // Return all upcoming events (guaranteed non-empty if we ever had data)
        return res.json(allUpcomingEvents);
      } catch (error) {
        console.error(`❌ UPCOMING API fetch failed:`, error);
        // CRITICAL: On error, try to return snapshot instead of empty
        const snapshot = getUpcomingSnapshot();
        if (snapshot.events.length > 0) {
          const ageSeconds = Math.round((Date.now() - snapshot.timestamp) / 1000);
          console.log(`⚠️ UPCOMING: Error occurred, using snapshot of ${snapshot.events.length} events (${ageSeconds}s old)`);
          return res.json(snapshot.events);
        }
        return res.json([]);
      }
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  
  // Get settled/completed match results with scores
  app.get("/api/events/results", async (req: Request, res: Response) => {
    try {
      const period = req.query.period as string || 'week';
      const sportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      
      // Calculate date range
      let startDate = new Date();
      if (period === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (period === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else if (period === 'month') {
        startDate.setDate(startDate.getDate() - 30);
      }
      
      // Query settled_events table which has actual scores
      const queryResult = await db.execute(sql`
        SELECT 
          id,
          external_event_id,
          home_team,
          away_team,
          home_score,
          away_score,
          winner,
          settled_at,
          bets_settled
        FROM settled_events
        WHERE settled_at >= ${startDate.toISOString()}
        ORDER BY settled_at DESC
        LIMIT 200
      `);
      
      // Handle different result formats from db.execute
      const rows = Array.isArray(queryResult) ? queryResult : (queryResult.rows || []);
      
      const formattedResults = (rows as any[]).map(row => ({
        id: row.id,
        externalEventId: row.external_event_id,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        homeScore: row.home_score,
        awayScore: row.away_score,
        winner: row.winner,
        settledAt: row.settled_at,
        betsSettled: row.bets_settled,
        sportId: 1,
        sport: 'Football',
        status: 'FINAL',
        startTime: row.settled_at,
        league: 'Completed Match'
      }));
      
      console.log(`[results] Returning ${formattedResults.length} settled events`);
      res.json(formattedResults);
    } catch (error) {
      console.error("Error fetching results:", error);
      res.status(500).json({ message: "Failed to fetch results" });
    }
  });

  // FREE SPORTS endpoints (basketball, baseball, hockey, MMA, NFL)
  // These use free API tier - fetched once/day, no live betting
  app.get("/api/free-sports/status", async (req: Request, res: Response) => {
    try {
      const status = freeSportsService.getCacheStatus();
      res.json({
        success: true,
        ...status,
        supportedSports: freeSportsService.getSupportedSports(),
        note: "Free sports update once daily (morning). No live betting available."
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to get free sports status" });
    }
  });

  app.post("/api/admin/free-sports/refresh", async (req: Request, res: Response) => {
    try {
      const { adminPassword } = req.body;
      if (!process.env.ADMIN_PASSWORD || adminPassword !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      console.log('[Admin] Force refreshing free sports data...');
      const events = await freeSportsService.forceRefresh();
      const sportBreakdown: Record<string, number> = {};
      for (const e of events) {
        const prefix = String(e.id).split('_')[0] || 'unknown';
        sportBreakdown[prefix] = (sportBreakdown[prefix] || 0) + 1;
      }
      res.json({ success: true, totalEvents: events.length, sportBreakdown });
    } catch (error: any) {
      console.error('[Admin] Free sports refresh error:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/events/counts", async (req: Request, res: Response) => {
    try {
      const counts: Record<number, number> = {};
      const seen = new Set<string>();
      const now = Date.now();

      const addEvent = (e: any) => {
        if (e.startTime && new Date(e.startTime).getTime() <= now) return;
        const key = String(e.id);
        if (seen.has(key)) return;
        seen.add(key);
        counts[e.sportId] = (counts[e.sportId] || 0) + 1;
      };

      const freeSportsEvents = freeSportsService.getUpcomingEvents();
      freeSportsEvents.forEach(addEvent);

      const esportsEvents = esportsService.getUpcomingEvents();
      esportsEvents.forEach(addEvent);

      const snapshot = getUpcomingSnapshot();
      if (snapshot.events.length > 0) {
        snapshot.events.forEach(addEvent);
      }

      res.json(counts);
    } catch (error) {
      res.json({});
    }
  });

  app.get("/api/free-sports/events", async (req: Request, res: Response) => {
    try {
      const sportSlug = req.query.sport as string | undefined;
      const events = freeSportsService.getUpcomingEvents(sportSlug);
      res.json({
        success: true,
        count: events.length,
        events,
        note: "No live betting for free sports - upcoming matches only"
      });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to get free sports events" });
    }
  });

  app.get("/api/events/cricket", async (req: Request, res: Response) => {
    try {
      const events = freeSportsService.getUpcomingEvents('cricket');
      res.json(events);
    } catch (error) {
      res.status(500).json([]);
    }
  });

  // Redirect /api/events/live to /api/events?isLive=true
  app.get("/api/events/live", async (req: Request, res: Response) => {
    try {
      const sportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      const redirectUrl = `/api/events?isLive=true${sportId ? `&sportId=${sportId}` : ''}`;
      console.log(`Redirecting /api/events/live to ${redirectUrl}`);
      return res.redirect(302, redirectUrl);
    } catch (error) {
      console.error('Error in live events redirect:', error);
      res.status(500).json({ error: 'Failed to fetch live events' });
    }
  });

  // Live events lite endpoint - returns minimal event data for sidebars
  app.get("/api/events/live-lite", async (req: Request, res: Response) => {
    try {
      const sportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      console.log(`[live-lite] Fetching live events (sportId: ${sportId || 'all'})`);
      
      // Use the same logic as the main events endpoint but return lighter data
      const sportsToFetch = getSportsToFetch();
      const allLiveEvents: any[] = [];
      
      await Promise.all(sportsToFetch.map(async (sport) => {
        try {
          const events = await apiSportsService.getLiveEvents(sport);
          if (events && events.length > 0) {
            allLiveEvents.push(...events);
          }
        } catch (err) {
          // Silently skip failed sport fetches
        }
      }));
      
      // Filter by sport if specified
      let filteredEvents = allLiveEvents;
      if (sportId) {
        filteredEvents = allLiveEvents.filter(e => e.sportId === sportId);
      }
      
      // Sort by startTime (earliest first, events without startTime go to end)
      filteredEvents.sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        return timeA - timeB;
      });
      
      // Return minimal data for performance (including startTime)
      const liteEvents = filteredEvents.map(e => ({
        id: e.id,
        sportId: e.sportId,
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
        homeScore: e.homeScore,
        awayScore: e.awayScore,
        status: e.status,
        isLive: e.isLive,
        leagueName: e.leagueName,
        startTime: e.startTime
      }));
      
      res.json(liteEvents);
    } catch (error) {
      console.error('Error in live-lite events:', error);
      res.json([]); // Return empty array instead of error to prevent UI issues
    }
  });
  
  // Get individual event by ID
  app.get("/api/events/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid event ID format" });
      }
      
      const event = await storage.getEvent(id);
      
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Create a copy with markets if needed
      const eventWithMarkets: any = {
        ...event,
        isLive: event.isLive || false,
        status: event.status || 'scheduled',
        name: `${event.homeTeam} vs ${event.awayTeam}`
      };
      
      // Check if event already has markets
      const hasMarkets = typeof eventWithMarkets.markets !== 'undefined' && 
                         Array.isArray(eventWithMarkets.markets) && 
                         eventWithMarkets.markets.length > 0;
      
      if (!hasMarkets) {
        // Add default markets
        eventWithMarkets.markets = [
          {
            id: `market-${event.id}-1`,
            name: 'Match Result',
            status: 'open',
            marketType: '1X2',
            outcomes: [
              { id: `outcome-${event.id}-1-1`, name: event.homeTeam, odds: 1.85, status: 'active' },
              { id: `outcome-${event.id}-1-2`, name: 'Draw', odds: 3.2, status: 'active' },
              { id: `outcome-${event.id}-1-3`, name: event.awayTeam, odds: 2.05, status: 'active' }
            ]
          },
          {
            id: `market-${event.id}-2`,
            name: 'Over/Under 2.5 Goals',
            status: 'open',
            marketType: 'OVER_UNDER',
            outcomes: [
              { id: `outcome-${event.id}-2-1`, name: 'Over 2.5', odds: 1.95, status: 'active' },
              { id: `outcome-${event.id}-2-2`, name: 'Under 2.5', odds: 1.85, status: 'active' }
            ]
          }
        ];
      }
      
      res.json(eventWithMarkets);
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ message: "Failed to fetch event" });
    }
  });
  
  // Return the promotions from storage
  app.get("/api/promotions", async (req: Request, res: Response) => {
    try {
      const promotions = await storage.getPromotions();
      res.json(promotions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch promotions" });
    }
  });

  // Pre-flight validation for bet placement (checks 45-minute cutoff BEFORE on-chain tx)
  app.post("/api/bets/validate", async (req: Request, res: Response) => {
    try {
      const { eventId, isLive } = req.body;
      
      if (!eventId) {
        return res.status(400).json({ message: "Event ID required", code: "MISSING_EVENT_ID" });
      }
      
      const eventIdStr = String(eventId);
      
      // Check free sports events first (basketball_, mma_, baseball_, etc.)
      const freeSportsLookup = freeSportsService.lookupEvent(eventIdStr);
      if (freeSportsLookup.found) {
        if (freeSportsLookup.shouldBeLive) {
          console.log(`[validate] Free sport event ${eventIdStr} rejected: game has already started (startTime: ${freeSportsLookup.event?.startTime})`);
          return res.status(400).json({
            message: "This match has already started. Betting is only available before the game begins.",
            code: "MATCH_STARTED"
          });
        }
        return res.json({
          valid: true,
          eventId: eventIdStr,
          source: 'free_sports'
        });
      }
      
      const esportsValidation = esportsService.lookupEvent(eventIdStr);
      if (esportsValidation.found) {
        const evtStart = esportsValidation.event?.startTime ? new Date(esportsValidation.event.startTime) : null;
        if (evtStart && evtStart <= new Date()) {
          return res.status(400).json({
            message: "This match has already started. Betting is only available before the game begins.",
            code: "MATCH_STARTED"
          });
        }
        return res.json({
          valid: true,
          eventId: eventIdStr,
          source: 'esports'
        });
      }
      
      // SERVER-SIDE VALIDATION: Check event status in paid API cache
      const eventLookup = apiSportsService.lookupEventSync(eventIdStr);
      
      if (!eventLookup.found) {
        return res.status(400).json({ 
          message: "Event not found - please refresh and try again",
          code: "EVENT_NOT_FOUND"
        });
      }
      
      // DYNAMIC CACHE AGE: Strict for live (60s), relaxed for upcoming (15min)
      const MAX_LIVE_CACHE_AGE_MS = 60 * 1000;
      const MAX_UPCOMING_CACHE_AGE_MS = 15 * 60 * 1000;
      const isEventLive = eventLookup.source === 'live';
      const maxCacheAge = isEventLive ? MAX_LIVE_CACHE_AGE_MS : MAX_UPCOMING_CACHE_AGE_MS;
      
      if (eventLookup.cacheAgeMs > maxCacheAge) {
        return res.status(400).json({ 
          message: isEventLive ? "Match data is stale - please refresh" : "Event data is stale - please refresh and try again",
          code: "STALE_EVENT_DATA"
        });
      }
      
      // CRITICAL: 45-minute cutoff for live football matches (users can only bet in first 45 minutes)
      if (eventLookup.source === 'live' && eventLookup.minute !== undefined) {
        if (eventLookup.minute >= 45) {
          console.log(`[validate] Event ${eventId} rejected: ${eventLookup.minute} min >= 45 cutoff`);
          return res.status(400).json({ 
            message: `Betting closed for this match (45+ minute cutoff). Match is at ${eventLookup.minute} minutes.`,
            code: "MATCH_CUTOFF"
          });
        }
      }
      
      // Check if upcoming event SHOULD be live (start time passed but not in live cache)
      if (eventLookup.source === 'upcoming' && eventLookup.shouldBeLive) {
        console.log(`[validate] Event ${eventId} rejected: startTime passed (${eventLookup.startTime}) but not in live cache`);
        return res.status(400).json({ 
          message: "This match has started - please check live matches instead",
          code: "MATCH_STARTED"
        });
      }
      
      // Event is valid for betting
      res.json({ 
        valid: true, 
        eventId,
        matchMinute: eventLookup.minute,
        source: eventLookup.source
      });
    } catch (error: any) {
      console.error("Error validating bet:", error);
      res.status(500).json({ message: "Validation failed", code: "SERVER_ERROR" });
    }
  });

  // Place a single bet
  app.post("/api/bets", async (req: Request, res: Response) => {
    try {
      console.log('📥 Received bet request:', JSON.stringify(req.body, null, 2));
      
      // Validate request
      const validation = validateRequest(PlaceBetSchema, req.body);
      if (!validation.valid) {
        console.log('❌ Validation failed:', validation.errors);
        return res.status(400).json({ 
          message: "Validation failed",
          errors: validation.errors 
        });
      }

      const data = validation.data!;
      // Cast to strings since transform always converts to string
      const userId = String(data.userId);
      const eventId = String(data.eventId);
      const { eventName, homeTeam, awayTeam, marketId, outcomeId, odds, betAmount, currency, prediction, feeCurrency, paymentMethod, txHash, onChainBetId, status, isLive, matchMinute, walletAddress, useBonus, useFreeBet } = data;
      
      // Gift bet: optional recipient wallet (extracted separately to avoid touching validation schema)
      const giftRecipientWallet = typeof req.body.giftRecipientWallet === 'string' && req.body.giftRecipientWallet.startsWith('0x') && req.body.giftRecipientWallet.length >= 64
        ? req.body.giftRecipientWallet.trim()
        : null;
      if (giftRecipientWallet) {
        const senderWallet = walletAddress || userId;
        if (giftRecipientWallet.toLowerCase() === senderWallet.toLowerCase()) {
          return res.status(400).json({ message: "Cannot gift a bet to yourself", code: "GIFT_SELF" });
        }
        console.log(`🎁 GIFT BET: ${senderWallet.slice(0,10)}... → ${giftRecipientWallet.slice(0,10)}...`);
      }
      
      // ANTI-EXPLOIT: Wallet blocklist check
      if (walletAddress && isWalletBlocked(walletAddress)) {
        console.log(`🚫 BLOCKED WALLET: Bet rejected from ${walletAddress.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }

      // ANTI-EXPLOIT: Rate limiting - max 7 bets per 24 hours (DB-backed, survives restarts)
      const rateLimitKey = walletAddress || userId;
      if (rateLimitKey && rateLimitKey.startsWith('0x')) {
        const rateLimitResult = await checkBetRateLimitDB(rateLimitKey);
        if (!rateLimitResult.allowed) {
          console.log(`❌ Daily bet limit hit for ${rateLimitKey.slice(0, 12)}... (7/7 used) [DB-enforced]`);
          return res.status(429).json({
            message: rateLimitResult.message,
            code: "RATE_LIMIT_EXCEEDED",
            dailyLimit: MAX_BETS_PER_DAY,
            remaining: 0
          });
        }
        console.log(`📊 Bet ${MAX_BETS_PER_DAY - (rateLimitResult.remaining || 0)}/${MAX_BETS_PER_DAY} for ${rateLimitKey.slice(0, 12)}... [DB-enforced]`);
      }

      // ANTI-EXPLOIT: Bet cooldown - 30 seconds between bets (DB-backed)
      if (rateLimitKey && rateLimitKey.startsWith('0x')) {
        const cooldownResult = await checkBetCooldownDB(rateLimitKey);
        if (!cooldownResult.allowed) {
          console.log(`❌ Cooldown active for ${rateLimitKey.slice(0, 12)}... (${cooldownResult.secondsLeft}s left)`);
          return res.status(429).json({
            message: `Please wait ${cooldownResult.secondsLeft} seconds before placing another bet.`,
            code: "BET_COOLDOWN"
          });
        }
      }

      // ANTI-EXPLOIT: Max 2 bets per event per wallet (DB-backed)
      if (rateLimitKey && rateLimitKey.startsWith('0x') && eventId) {
        const eventLimitResult = await checkEventBetLimitDB(rateLimitKey, String(eventId));
        if (!eventLimitResult.allowed) {
          console.log(`❌ Event bet limit hit for ${rateLimitKey.slice(0, 12)}... on event ${eventId} [DB-enforced]`);
          return res.status(400).json({
            message: eventLimitResult.message,
            code: "EVENT_BET_LIMIT"
          });
        }
      }
      
      // ANTI-EXPLOIT: Block bets on "Unknown Event" or invalid events
      if (!eventName || eventName === "Unknown Event" || eventName.trim() === "") {
        console.log(`❌ Blocked bet on Unknown Event from ${(walletAddress || userId).slice(0, 12)}...`);
        return res.status(400).json({
          message: "Invalid event. Please select a valid match to bet on.",
          code: "INVALID_EVENT"
        });
      }
      
      // TEAM DATA ENRICHMENT: If homeTeam/awayTeam missing, try to look them up from event cache
      let resolvedHomeTeam = homeTeam;
      let resolvedAwayTeam = awayTeam;
      if (!resolvedHomeTeam || !resolvedAwayTeam || resolvedHomeTeam === "Unknown" || resolvedAwayTeam === "Unknown") {
        try {
          const eventLookup = apiSportsService.lookupEventSync(eventId);
          if (eventLookup.found && eventLookup.homeTeam && eventLookup.awayTeam) {
            resolvedHomeTeam = eventLookup.homeTeam;
            resolvedAwayTeam = eventLookup.awayTeam;
            console.log(`✅ Enriched missing team data from cache: ${resolvedHomeTeam} vs ${resolvedAwayTeam}`);
          } else {
            const freeLookup2 = freeSportsService.lookupEvent(eventId);
            if (freeLookup2.found && freeLookup2.event) {
              resolvedHomeTeam = freeLookup2.event.homeTeam || resolvedHomeTeam;
              resolvedAwayTeam = freeLookup2.event.awayTeam || resolvedAwayTeam;
              console.log(`✅ Enriched missing team data from free sports: ${resolvedHomeTeam} vs ${resolvedAwayTeam}`);
            } else {
              const esportsLookup2 = esportsService.lookupEvent(eventId);
              if (esportsLookup2.found && esportsLookup2.event) {
                resolvedHomeTeam = esportsLookup2.event.homeTeam || resolvedHomeTeam;
                resolvedAwayTeam = esportsLookup2.event.awayTeam || resolvedAwayTeam;
                console.log(`✅ Enriched missing team data from esports: ${resolvedHomeTeam} vs ${resolvedAwayTeam}`);
              }
            }
          }
        } catch (enrichError) {
          console.warn('[Team Enrichment] Failed to lookup teams, continuing with provided data:', enrichError);
        }
      }
      
      // ANTI-EXPLOIT: Validate teams are provided (after enrichment attempt)
      if (!resolvedHomeTeam || !resolvedAwayTeam || resolvedHomeTeam === "Unknown" || resolvedAwayTeam === "Unknown") {
        // For on-chain bets with valid txHash, allow through even without team data
        // The on-chain transaction already happened, blocking here would lose user money
        if (txHash && txHash.startsWith('0x')) {
          console.warn(`⚠️ On-chain bet ${txHash.slice(0, 12)}... missing team data, allowing through to prevent fund loss`);
          resolvedHomeTeam = resolvedHomeTeam || eventName?.split(' vs ')?.[0]?.trim() || 'Team A';
          resolvedAwayTeam = resolvedAwayTeam || eventName?.split(' vs ')?.[1]?.trim() || 'Team B';
        } else {
          console.log(`❌ Blocked bet with unknown teams from ${(walletAddress || userId).slice(0, 12)}...`);
          return res.status(400).json({
            message: "Invalid match data. Please select a valid match to bet on.",
            code: "INVALID_TEAMS"
          });
        }
      }
      
      const freeLookup = freeSportsService.lookupEvent(eventId);
      if (freeLookup.found && freeLookup.shouldBeLive) {
        console.log(`❌ Blocked bet on started free sport event ${eventId} from ${(walletAddress || userId).slice(0, 12)}...`);
        return res.status(400).json({
          message: "This match has already started. Betting is only available before the game begins.",
          code: "MATCH_STARTED"
        });
      }
      const esportsLookupBet = esportsService.lookupEvent(eventId);
      if (esportsLookupBet.found && esportsLookupBet.event?.startTime) {
        if (new Date(esportsLookupBet.event.startTime) <= new Date()) {
          console.log(`❌ Blocked bet on started esports event ${eventId}`);
          return res.status(400).json({
            message: "This match has already started. Betting is only available before the game begins.",
            code: "MATCH_STARTED"
          });
        }
      }
      
      // ANTI-EXPLOIT: Validate event exists in our system (for non-live bets)
      if (!isLive && !freeLookup.found) {
        try {
          const eventCheck = apiSportsService.lookupEventSync(eventId);
          if (!eventCheck) {
            console.log(`❌ Blocked bet on unknown event ${eventId} from ${(walletAddress || userId).slice(0, 12)}...`);
            return res.status(400).json({
              message: "Event not found. Please select a valid match from our system.",
              code: "EVENT_NOT_FOUND"
            });
          }
        } catch (eventCheckError) {
          console.log(`❌ Blocked bet (event check error) on ${eventId} from ${(walletAddress || userId).slice(0, 12)}...`);
          return res.status(400).json({
            message: "Could not verify event. Please try again.",
            code: "EVENT_VERIFICATION_FAILED"
          });
        }
      }
      
      // DUPLICATE BET PREVENTION: Check if user already has a pending/confirmed bet on this exact selection
      try {
        const existingBets = await storage.getUserBets(userId);
        const duplicateBet = existingBets.find((bet: any) => 
          bet.eventId === eventId &&
          bet.marketId === marketId &&
          bet.outcomeId === outcomeId &&
          (bet.status === 'pending' || bet.status === 'confirmed')
        );
        
        if (duplicateBet) {
          console.log(`❌ Duplicate bet blocked: User ${userId.slice(0, 10)}... already has bet on ${eventId}/${marketId}/${outcomeId}`);
          return res.status(400).json({
            message: "You already have an active bet on this selection. Wait for it to settle or choose a different outcome.",
            code: "DUPLICATE_BET"
          });
        }
      } catch (dupCheckError) {
        console.warn('[Duplicate Check] Failed to check for duplicates, allowing bet:', dupCheckError);
        // Continue with bet - don't block if check fails
      }
      
      // ANTI-CHEAT: In live matches, ONLY Match Winner (win/draw/lose) is allowed
      // All other markets (Over/Under, BTTS, Double Chance, etc.) are blocked to prevent exploitation
      if (data.isLive && data.marketId) {
        const marketIdStr = String(data.marketId).toLowerCase();
        const isMatchWinner = marketIdStr.includes('match_winner') || marketIdStr.includes('match-winner') ||
                               marketIdStr.includes('match_result') || marketIdStr.includes('match-result') ||
                               marketIdStr === 'match winner' || marketIdStr === 'match result';
        
        if (!isMatchWinner) {
          console.warn(`[Anti-Cheat] Blocking non-Match-Winner market in live: event ${data.eventId}, market ${data.marketId}`);
          return res.status(400).json({
            success: false,
            message: "MARKET_CLOSED_LIVE",
            details: "Only Match Winner (win/draw/lose) is available for live betting. Other markets are available for upcoming matches."
          });
        }
      }
      
      // Anti-cheat: Block ALL live bets after minute 45 (first half only betting)
      const isFirstHalfMarket = !!data.marketId && (
        String(data.marketId).includes('1st_half') || 
        String(data.marketId).includes('1st-half') ||
        String(data.marketId).includes('first_half') ||
        String(data.marketId).includes('first-half') ||
        String(data.marketId).includes('half_time_result') ||
        String(data.marketId).includes('half-time-result') ||
        String(data.marketId) === "4" // First Half Result market ID
      );

      const currentMinute = data.matchMinute || (data.isLive ? parseInt(String(apiSportsService.lookupEventSync(data.eventId).minute || 0)) : 0);

      if (data.isLive) {
        // Block ALL live bets after 45 minutes (users can only bet in first half)
        if (currentMinute >= 45) {
          console.warn(`[Anti-Cheat] Blocking live bet after first half: event ${data.eventId}, minute ${currentMinute}`);
          return res.status(400).json({ 
            success: false, 
            message: "MATCH_CUTOFF",
            details: "Live betting is only available during the first half (first 45 minutes)."
          });
        }
      }

      // MAX STAKE VALIDATION - Backend enforcement (100 SUI / 10,000 SBETS)
      // Use feeCurrency as primary indicator (client sends this), fallback to currency
      const betCurrency = feeCurrency || currency || 'SUI';
      
      // SUI BETTING PAUSE - Block SUI bets until treasury is funded
      if (SUI_BETTING_PAUSED && betCurrency !== 'SBETS') {
        console.log(`❌ SUI bet blocked - betting paused until treasury funded`);
        return res.status(400).json({
          message: SUI_PAUSE_MESSAGE,
          code: "SUI_BETTING_PAUSED"
        });
      }
      
      const MAX_STAKE_SUI = 100;
      const MAX_STAKE_SBETS = 10000; // 10,000 SBETS max per bet
      const maxStake = betCurrency === 'SBETS' ? MAX_STAKE_SBETS : MAX_STAKE_SUI;
      
      if (betAmount > maxStake) {
        console.log(`❌ Bet rejected (max stake exceeded): ${betAmount} ${betCurrency} > ${maxStake} ${betCurrency}`);
        return res.status(400).json({
          message: `Maximum stake is ${maxStake.toLocaleString()} ${betCurrency}`,
          code: "MAX_STAKE_EXCEEDED"
        });
      }
      
      // USER BETTING LIMITS CHECK (validate only, update after bet success)
      const SUI_PRICE_USD = 1.50;
      const SBETS_PRICE_USD = 0.000001;
      const betUsdValue = betCurrency === 'SBETS' ? betAmount * SBETS_PRICE_USD : betAmount * SUI_PRICE_USD;
      
      // Update promotion tracking
      try {
        await promotionService.trackBetAndAwardBonus(walletAddress || userId, betAmount, betCurrency as 'SUI' | 'SBETS');
      } catch (promoError) {
        console.warn('[PROMO] Failed to track bet for promotion:', promoError);
      }
      
      // Handle FREE BET bonus usage (promotion bonus)
      let bonusUsedAmount = 0;
      if (useBonus) {
        try {
          const promoStatus = await promotionService.getPromotionStatus(walletAddress || userId);
          if (promoStatus.bonusBalance > 0) {
            // Use bonus up to the bet amount (converted to USD)
            const maxBonusToUse = Math.min(promoStatus.bonusBalance, betUsdValue);
            const usedSuccess = await promotionService.useBonusBalance(walletAddress || userId, maxBonusToUse);
            if (usedSuccess) {
              bonusUsedAmount = maxBonusToUse;
              console.log(`🎁 FREE BET: Used $${bonusUsedAmount.toFixed(2)} bonus for ${walletAddress || userId}`);
            }
          }
        } catch (bonusError) {
          console.warn('[BONUS] Failed to use bonus balance:', bonusError);
        }
      }
      
      // Handle FREE SBETS usage (welcome bonus / referral rewards) - ONE TIME ONLY per user lifetime
      let freeSbetsUsed = 0;
      if (useFreeBet && betCurrency === 'SBETS') {
        try {
          const { users, bets } = await import('@shared/schema');
          const { db } = await import('./db');
          const { eq, and, sql: sqlDrizzle } = await import('drizzle-orm');
          
          const userWallet = walletAddress || userId;
          const [user] = await db.select().from(users).where(eq(users.walletAddress, userWallet));
          
          // Check if user has EVER used a free bet before (lifetime one-time only)
          let hasUsedFreeBet = false;
          try {
            const previousFreeBets = await db.select({ count: sqlDrizzle<number>`count(*)` })
              .from(bets)
              .where(and(
                eq(bets.walletAddress, userWallet),
                eq(bets.paymentMethod, 'free_bet')
              ));
            hasUsedFreeBet = (previousFreeBets[0]?.count || 0) > 0;
          } catch (checkErr) {
            console.warn('[FREE BET] Could not check previous free bets:', checkErr);
          }

          if (hasUsedFreeBet) {
            console.log(`❌ FREE BET BLOCKED: ${userWallet.slice(0, 10)}... already used their one-time free bet`);
            return res.status(400).json({
              message: "You have already used your free bet. Each user gets one free bet for life.",
              code: "FREE_BET_ALREADY_USED"
            });
          }

          if (user && (user.freeBetBalance || 0) >= betAmount) {
            const newFreeBetBalance = (user.freeBetBalance || 0) - betAmount;
            await db.update(users)
              .set({ freeBetBalance: newFreeBetBalance })
              .where(eq(users.walletAddress, userWallet));
            
            freeSbetsUsed = betAmount;
            console.log(`🎁 FREE SBETS: Used ${betAmount.toLocaleString()} SBETS (ONE-TIME free bet) for ${userWallet.slice(0, 10)}...`);
          } else {
            console.warn(`[FREE SBETS] Insufficient free balance: have ${user?.freeBetBalance || 0}, need ${betAmount}`);
          }
        } catch (freeBetError) {
          console.warn('[FREE SBETS] Failed to use free bet balance:', freeBetError);
        }
      }
      
      let limitsCheckPassed = false;
      let userWalletForLimits: string | null = null;
      
      try {
        const { userLimits } = await import('@shared/schema');
        const { db } = await import('./db');
        const { eq } = await import('drizzle-orm');
        userWalletForLimits = walletAddress || userId;
        
        if (userWalletForLimits && userWalletForLimits.startsWith('0x')) {
          const [limits] = await db.select().from(userLimits).where(eq(userLimits.walletAddress, userWalletForLimits));
          
          if (limits) {
            const now = new Date();
            
            // Reset spent amounts based on time windows
            let dailySpent = limits.dailySpent || 0;
            let weeklySpent = limits.weeklySpent || 0;
            let monthlySpent = limits.monthlySpent || 0;
            
            // Reset daily if last reset was before today
            if (limits.lastResetDaily) {
              const lastDaily = new Date(limits.lastResetDaily);
              if (lastDaily.toDateString() !== now.toDateString()) {
                dailySpent = 0;
              }
            }
            
            // Reset weekly if last reset was more than 7 days ago
            if (limits.lastResetWeekly) {
              const lastWeekly = new Date(limits.lastResetWeekly);
              if (now.getTime() - lastWeekly.getTime() > 7 * 24 * 60 * 60 * 1000) {
                weeklySpent = 0;
              }
            }
            
            // Reset monthly if last reset was in a different month
            if (limits.lastResetMonthly) {
              const lastMonthly = new Date(limits.lastResetMonthly);
              if (lastMonthly.getMonth() !== now.getMonth() || lastMonthly.getFullYear() !== now.getFullYear()) {
                monthlySpent = 0;
              }
            }
            
            // Check self-exclusion
            if (limits.selfExclusionUntil && new Date(limits.selfExclusionUntil) > now) {
              return res.status(403).json({ message: 'Self-exclusion active', code: 'SELF_EXCLUDED' });
            }
            
            // Check limits (validation only, no update yet)
            if (limits.dailyLimit && dailySpent + betUsdValue > limits.dailyLimit) {
              return res.status(403).json({ message: `Daily limit of $${limits.dailyLimit} reached`, code: 'DAILY_LIMIT_EXCEEDED' });
            }
            if (limits.weeklyLimit && weeklySpent + betUsdValue > limits.weeklyLimit) {
              return res.status(403).json({ message: `Weekly limit of $${limits.weeklyLimit} reached`, code: 'WEEKLY_LIMIT_EXCEEDED' });
            }
            if (limits.monthlyLimit && monthlySpent + betUsdValue > limits.monthlyLimit) {
              return res.status(403).json({ message: `Monthly limit of $${limits.monthlyLimit} reached`, code: 'MONTHLY_LIMIT_EXCEEDED' });
            }
            
            limitsCheckPassed = true;
          }
        }
      } catch (limitsError) {
        console.log('Limits check skipped:', limitsError);
      }
      
      // SERVER-SIDE VALIDATION: Unified event registry lookup
      // CRITICAL: Server is authoritative about event status - never trust client isLive/matchMinute
      // Security: FAIL-CLOSED - Event must exist in server cache (live or upcoming) to accept bet
      // EXCEPTION: On-chain confirmed bets (with txHash) bypass cache validation since they already exist on blockchain
      const isOnChainConfirmed = !!(txHash && onChainBetId);
      const MAX_LIVE_CACHE_AGE_MS = 90 * 1000; // Reject stale cache (>90 seconds) for live events - increased from 60s to reduce false rejections
      const MAX_UPCOMING_CACHE_AGE_MS = 15 * 60 * 1000; // 15 minutes for upcoming (pre-match) events - match hasn't started, status is stable
      
      try {
        // Unified lookup: checks BOTH live and upcoming event caches
        const eventLookup = apiSportsService.lookupEventSync(eventId);
        
        if (!eventLookup.found) {
          if (isOnChainConfirmed) {
            console.log(`⚠️ On-chain bet ${onChainBetId?.slice(0, 12)}... event ${eventId} not in cache but TX confirmed - recording anyway`);
          } else {
            console.log(`❌ Bet rejected (unknown event): Event ${eventId} not in live or upcoming cache, client isLive: ${isLive}`);
            return res.status(400).json({ 
              message: "Event not found - please refresh and try again",
              code: "EVENT_NOT_FOUND"
            });
          }
        }
        
        if (eventLookup.found && !isOnChainConfirmed) {
        // DYNAMIC CACHE AGE CHECK: Different thresholds for live vs upcoming events
        // Live events need strict freshness (60s) because match state changes rapidly
        // Upcoming events can have relaxed threshold (15min) because match hasn't started
        const isEventLive = eventLookup.source === 'live';
        const maxCacheAge = isEventLive ? MAX_LIVE_CACHE_AGE_MS : MAX_UPCOMING_CACHE_AGE_MS;
        
        if (eventLookup.cacheAgeMs > maxCacheAge) {
          console.log(`❌ Bet rejected (stale cache): Cache is ${Math.round(eventLookup.cacheAgeMs/1000)}s old (max ${maxCacheAge/1000}s), eventId: ${eventId}, source: ${eventLookup.source}`);
          return res.status(400).json({ 
            message: isEventLive ? "Match data is stale - please refresh" : "Event data is stale - please refresh and try again",
            code: "STALE_EVENT_DATA"
          });
        }
        
        // Event found with fresh cache - check if it's live (server determines this, not client)
        if (eventLookup.source === 'live') {
          // FAIL-CLOSED: If we have no minute data for a live match, we cannot verify it's under 45 min
          // API-Sports may omit minute during halftime, glitches, or for non-football sports
          if (eventLookup.minute === undefined || eventLookup.minute === null) {
            console.log(`❌ Bet rejected (unverifiable minute): Live match has no minute data, eventId: ${eventId}, cannot verify < 45 min cutoff`);
            return res.status(400).json({ 
              message: "Cannot verify match time - please try again shortly",
              code: "UNVERIFIABLE_MATCH_TIME"
            });
          }
          
        // Check trusted minute against 45-minute cutoff (users can only bet in first half)
        if (eventLookup.minute >= 45) {
          console.log(`❌ Bet rejected (server-verified): Live match at ${eventLookup.minute} minutes (>= 45 min cutoff), eventId: ${eventId}, client claimed isLive: ${isLive}`);
          return res.status(400).json({ 
            message: "Live betting is only available during the first half (first 45 minutes)",
            code: "MATCH_TIME_EXCEEDED",
            serverVerified: true
          });
        }

        // ANTI-CHEAT: Market-specific time validation
        const marketLower = marketId.toLowerCase();
        const firstHalfMarkets = ['half_time_result', 'ht_ft', '1st_half_goals', 'first_half_winner', 'half-time-result', '1st-half-goals'];
        const isFirstHalfMarket = firstHalfMarkets.includes(marketLower) || 
                                marketLower.includes('1st_half') || 
                                marketLower.includes('1st-half') ||
                                marketLower.includes('first_half') ||
                                marketLower.includes('first-half');
        
        if (isFirstHalfMarket && eventLookup.minute > 45) {
          console.log(`❌ Bet rejected (anti-cheat): First half market ${marketId} selected at minute ${eventLookup.minute}`);
          return res.status(400).json({
            message: "This market is closed (First half has ended)",
            code: "MARKET_CLOSED_HALF_TIME"
          });
        }
        
        // ANTI-CHEAT: Score-based odds validation for MATCH WINNER markets only
        // IMPORTANT: Only applies to match_winner/moneyline markets - NOT totals, handicaps, or props
        const homeScore = eventLookup.homeScore;
        const awayScore = eventLookup.awayScore;
        const minute = eventLookup.minute ?? 0;
        
        // Check if this is a match winner market (only apply anti-cheat to these)
        const marketIdLower = (marketId || '').toLowerCase();
        const isMatchWinnerMarket = marketIdLower.includes('winner') || 
                                     marketIdLower.includes('match_result') ||
                                     marketIdLower.includes('match-result') ||
                                     marketIdLower.includes('1x2') ||
                                     marketIdLower === 'match_winner' ||
                                     marketIdLower === 'full_time_result' ||
                                     marketIdLower === 'moneyline';
        
        // Only run anti-cheat on match winner markets with verified score data
        const hasScoreData = homeScore !== undefined && homeScore !== null && 
                             awayScore !== undefined && awayScore !== null;
        
        if (isMatchWinnerMarket && hasScoreData) {
          const scoreDiff = Math.abs(homeScore - awayScore);
          const homeWinning = homeScore > awayScore;
          const awayWinning = awayScore > homeScore;
          
          // Robust outcome detection
          const outcomeIdLower = (outcomeId || '').toLowerCase();
          const predLower = (prediction || '').toLowerCase();
          const homeTeamLower = (eventLookup.homeTeam || '').toLowerCase().trim();
          const awayTeamLower = (eventLookup.awayTeam || '').toLowerCase().trim();
          
          // Comprehensive patterns for outcome detection
          const homePatterns = ['home', 'h', '1', 'home_team', 'hometeam', 'home-win', 'homewin'];
          const awayPatterns = ['away', 'a', '2', 'away_team', 'awayteam', 'away-win', 'awaywin'];
          
          const bettingOnHome = homePatterns.some(p => outcomeIdLower === p || outcomeIdLower.startsWith(p + '_')) ||
                                (homeTeamLower.length > 2 && predLower.includes(homeTeamLower));
          const bettingOnAway = awayPatterns.some(p => outcomeIdLower === p || outcomeIdLower.startsWith(p + '_')) ||
                                (awayTeamLower.length > 2 && predLower.includes(awayTeamLower));
          
          // Determine if betting on winning team or losing team
          const bettingOnWinningTeam = (homeWinning && bettingOnHome) || (awayWinning && bettingOnAway);
          const bettingOnLosingTeam = (homeWinning && bettingOnAway) || (awayWinning && bettingOnHome);
          
          // TARGETED BLOCK: Block bets on winning team with stale high odds
          // Only applies when: 2+ goal lead, 45+ minutes, betting on winning team
          if (scoreDiff >= 2 && minute >= 45 && bettingOnWinningTeam) {
            // Stricter threshold later in match
            const suspiciousThreshold = minute >= 60 ? 1.5 : 1.8;
            
            if (odds > suspiciousThreshold) {
              console.log(`❌ Bet rejected (anti-cheat): Winning team ${outcomeId} with odds ${odds} at ${minute}min, score ${homeScore}-${awayScore}`);
              return res.status(400).json({
                message: "Betting suspended - odds may not reflect current score",
                code: "SUSPICIOUS_ODDS_DETECTED"
              });
            }
          }
          
          // Log for monitoring but allow all other bets
          if (scoreDiff >= 2 && minute >= 60) {
            console.log(`[anti-cheat] Allowing bet: market=${marketId}, outcome=${outcomeId}, odds=${odds}, score=${homeScore}-${awayScore}, min=${minute}, losingTeam=${bettingOnLosingTeam}`);
          }
        }
        
        // Live match under 45 minutes with fresh cache and verified minute - allow bet to proceed
        console.log(`✅ Live bet allowed: eventId ${eventId}, minute: ${eventLookup.minute}, cache age: ${Math.round(eventLookup.cacheAgeMs/1000)}s`);
        } else if (eventLookup.source === 'upcoming') {
          // Event found in upcoming cache - but check if it SHOULD be live based on start time
          if (eventLookup.shouldBeLive) {
            // START TIME HAS PASSED - match should be live but isn't in live cache
            // This is the critical bypass scenario: match could be at 45+ minutes
            // FAIL-CLOSED: Reject - we can't verify the match state
            console.log(`❌ Bet rejected (should be live): Event ${eventId} startTime has passed (${eventLookup.startTime}) but not in live cache, client isLive: ${isLive}`);
            return res.status(400).json({ 
              message: "Match may have started - cannot verify status, please refresh",
              code: "EVENT_STATUS_UNCERTAIN"
            });
          }
          // Event truly upcoming (start time in future) - allow bet
          console.log(`✅ Upcoming bet allowed: eventId ${eventId}, startTime: ${eventLookup.startTime}, cache age: ${Math.round(eventLookup.cacheAgeMs/1000)}s`);
        }
        }
      } catch (lookupError) {
        if (isOnChainConfirmed) {
          console.log(`⚠️ On-chain bet ${onChainBetId?.slice(0, 12)}... cache error but TX confirmed - recording anyway`);
        } else {
          console.log(`❌ Bet rejected (cache error): Cannot verify event, eventId: ${eventId}, error: ${lookupError}`);
          return res.status(400).json({ 
            message: "Cannot verify event status - please try again",
            code: "EVENT_VERIFICATION_ERROR"
          });
        }
      }
      
      // Currency already extracted from validation (defaults to SUI)
      const platformFee = betAmount * 0.01; // 1% platform fee
      const totalDebit = betAmount + platformFee;

      // SIMPLIFIED OFF-CHAIN BETTING - No balance check required
      // Bets are recorded directly and settled when events complete
      // Settlement adds winnings to user's platform balance
      console.log(`🎲 OFF-CHAIN BET: Recording bet for ${userId} - ${betAmount} ${currency}`);
      
      if (txHash) {
        console.log(`📦 With txHash: ${txHash}, betObjectId: ${onChainBetId}`);
        // CRITICAL WARNING: On-chain bets should always have betObjectId for proper settlement
        if (!onChainBetId) {
          console.warn(`⚠️ MISSING betObjectId: On-chain bet (tx: ${txHash}) has no betObjectId - settlement will use OFF-CHAIN fallback!`);
          console.warn(`   This indicates frontend extraction failed or wallet didn't return objectChanges`);
        }
      }

      const betId = onChainBetId || `bet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const potentialPayout = Math.round(betAmount * odds * 100) / 100;

      const bet = {
        id: betId,
        userId,
        eventId,
        eventName: eventName || 'Sports Event',
        homeTeam: resolvedHomeTeam || '', // Store for settlement matching
        awayTeam: resolvedAwayTeam || '', // Store for settlement matching
        marketId,
        outcomeId,
        odds,
        betAmount,
        currency: betCurrency, // Use computed betCurrency (from feeCurrency || currency || 'SUI')
        status: (paymentMethod === 'wallet' ? 'confirmed' : 'pending') as 'pending' | 'confirmed',
        prediction,
        placedAt: Date.now(),
        potentialPayout,
        platformFee: paymentMethod === 'wallet' ? 0 : platformFee, // No platform fee for on-chain bets (paid in gas)
        totalDebit: paymentMethod === 'wallet' ? betAmount : totalDebit,
        txHash: txHash || undefined,
        onChainBetId: onChainBetId || undefined,
        paymentMethod,
        giftedTo: giftRecipientWallet || undefined,
        giftedFrom: giftRecipientWallet ? (walletAddress || userId) : undefined
      };

      // Store bet in storage
      const storedBet = await storage.createBet(bet);

      // WALRUS: Store bet receipt on decentralized storage (non-blocking)
      (async () => {
        try {
          const { storeBetReceipt } = await import('./services/walrusStorageService');
          const walrusResult = await storeBetReceipt({
            betId,
            walletAddress: walletAddress || userId,
            eventId: String(eventId),
            eventName: eventName || 'Sports Event',
            homeTeam: resolvedHomeTeam || '',
            awayTeam: resolvedAwayTeam || '',
            prediction,
            odds,
            stake: betAmount,
            currency: betCurrency,
            potentialPayout,
            txHash: txHash || undefined,
            betObjectId: onChainBetId || undefined,
            placedAt: Date.now(),
          });
          const { bets: betsTable } = await import('@shared/schema');
          const { db: walrusDb } = await import('./db');
          const { eq: walrusEq } = await import('drizzle-orm');
          const updateFields: any = { walrusReceiptData: walrusResult.receiptJson };
          if (walrusResult.blobId) {
            updateFields.walrusBlobId = walrusResult.blobId;
          } else {
            updateFields.walrusBlobId = `local_${walrusResult.receiptHash}`;
          }
          await walrusDb.update(betsTable)
            .set(updateFields)
            .where(walrusEq(betsTable.wurlusBetId, betId));
          console.log(`🐋 Receipt saved for bet ${betId}: ${updateFields.walrusBlobId}`);
        } catch (walrusErr: any) {
          console.warn(`[Walrus] Non-blocking store failed: ${walrusErr.message}`);
        }
      })();
      
      // UPDATE LIMITS AFTER SUCCESSFUL BET PLACEMENT
      if (limitsCheckPassed && userWalletForLimits) {
        try {
          const { userLimits: userLimitsTable } = await import('@shared/schema');
          const { db: dbInstance } = await import('./db');
          const { eq: eqOp } = await import('drizzle-orm');
          const now = new Date();
          
          const [currentLimits] = await dbInstance.select().from(userLimitsTable).where(eqOp(userLimitsTable.walletAddress, userWalletForLimits));
          if (currentLimits) {
            // Calculate spent with time-window resets
            let dailySpent = currentLimits.dailySpent || 0;
            let weeklySpent = currentLimits.weeklySpent || 0;
            let monthlySpent = currentLimits.monthlySpent || 0;
            let lastResetDaily = currentLimits.lastResetDaily;
            let lastResetWeekly = currentLimits.lastResetWeekly;
            let lastResetMonthly = currentLimits.lastResetMonthly;
            
            if (lastResetDaily && new Date(lastResetDaily).toDateString() !== now.toDateString()) {
              dailySpent = 0;
              lastResetDaily = now;
            }
            if (lastResetWeekly && now.getTime() - new Date(lastResetWeekly).getTime() > 7 * 24 * 60 * 60 * 1000) {
              weeklySpent = 0;
              lastResetWeekly = now;
            }
            if (lastResetMonthly) {
              const lm = new Date(lastResetMonthly);
              if (lm.getMonth() !== now.getMonth() || lm.getFullYear() !== now.getFullYear()) {
                monthlySpent = 0;
                lastResetMonthly = now;
              }
            }
            
            await dbInstance.update(userLimitsTable).set({
              dailySpent: dailySpent + betUsdValue,
              weeklySpent: weeklySpent + betUsdValue,
              monthlySpent: monthlySpent + betUsdValue,
              lastResetDaily,
              lastResetWeekly,
              lastResetMonthly,
              updatedAt: now
            }).where(eqOp(userLimitsTable.walletAddress, userWalletForLimits));
          }
        } catch (updateError) {
          console.log('Limits update after bet failed:', updateError);
        }
      }

      // Record bet on blockchain for verification (platform bets only)
      let onChainBet = null;
      if (paymentMethod === 'platform') {
        onChainBet = await blockchainBetService.recordBetOnChain({
          betId,
          walletAddress: userId,
          eventId: String(eventId),
          prediction,
          betAmount,
          odds,
          txHash: storedBet?.txHash || ''
        });
      }

      // Notify user of bet placement
      notificationService.notifyBetPlaced(userId, {
        ...bet,
        homeTeam: resolvedHomeTeam || 'Home Team',
        awayTeam: resolvedAwayTeam || 'Away Team'
      });


      // Log to monitoring
      monitoringService.logBet({
        betId,
        userId,
        eventId,
        odds,
        amount: betAmount,
        timestamp: Date.now(),
        status: 'pending'
      });

      console.log(`✅ BET PLACED (${paymentMethod}): ${betId} - ${prediction} @ ${odds} odds, Stake: ${betAmount} ${currency}, Potential: ${potentialPayout} ${currency}`);

      // LOYALTY PROGRAM: Award points based on USD value wagered (1 point per $1)
      try {
        const loyaltyWallet = walletAddress || userId;
        if (loyaltyWallet && loyaltyWallet.startsWith('0x')) {
          const pointsEarned = Math.floor(betUsdValue); // 1 point per $1 wagered
          if (pointsEarned > 0) {
            const { users: usersTable } = await import('@shared/schema');
            const { db: loyaltyDb } = await import('./db');
            const { eq: loyaltyEq, sql: loyaltySql } = await import('drizzle-orm');
            
            await loyaltyDb.update(usersTable)
              .set({
                loyaltyPoints: loyaltySql`COALESCE(${usersTable.loyaltyPoints}, 0) + ${pointsEarned}`,
                totalBetVolume: loyaltySql`COALESCE(${usersTable.totalBetVolume}, 0) + ${betUsdValue}`
              })
              .where(loyaltyEq(usersTable.walletAddress, loyaltyWallet));
            
            console.log(`⭐ LOYALTY: +${pointsEarned} points for ${loyaltyWallet.slice(0, 10)}... ($${betUsdValue.toFixed(2)} wagered)`);
          }
        }
      } catch (loyaltyError) {
        console.warn('[LOYALTY] Failed to award points:', loyaltyError);
      }

      // Track bet for promotion (only for on-chain bets with txHash)
      let promotionBonus = { bonusAwarded: false, bonusAmount: 0, newBonusBalance: 0 };
      if (txHash && walletAddress) {
        try {
          promotionBonus = await promotionService.trackBetAndAwardBonus(
            walletAddress,
            betAmount,
            currency as 'SUI' | 'SBETS'
          );
          if (promotionBonus.bonusAwarded) {
            console.log(`🎁 BONUS AWARDED: ${walletAddress.slice(0, 10)}... got $${promotionBonus.bonusAmount} bonus!`);
          }
        } catch (promoError) {
          console.error('Promotion tracking error:', promoError);
        }
      }

      // REFERRAL REWARD: Check if this is user's first bet and they were referred
      const betWallet = walletAddress || userId;
      if (betWallet && betWallet.startsWith('0x')) {
        try {
          const { referrals, bets: betsTable } = await import('@shared/schema');
          const { db: refDb } = await import('./db');
          const { eq: refEq, and: refAnd } = await import('drizzle-orm');
          
          // Check if user was referred and referral is still pending
          const [referral] = await refDb.select().from(referrals)
            .where(refAnd(
              refEq(referrals.referredWallet, betWallet),
              refEq(referrals.status, 'pending')
            ));
          
          if (referral) {
            // This is their first bet - award the referral bonus to the referrer
            const REFERRAL_REWARD_SBETS = 1000;
            
            // Add SBETS to referrer's balance
            await storage.updateUserBalance(referral.referrerWallet, 0, REFERRAL_REWARD_SBETS);
            
            // Update referral status to rewarded
            await refDb.update(referrals)
              .set({ 
                status: 'rewarded',
                rewardAmount: REFERRAL_REWARD_SBETS,
                rewardCurrency: 'SBETS',
                rewardedAt: new Date()
              })
              .where(refEq(referrals.id, referral.id));
            
            console.log(`🎁 REFERRAL REWARD: ${REFERRAL_REWARD_SBETS} SBETS awarded to referrer ${referral.referrerWallet.slice(0, 10)}... (user ${betWallet.slice(0, 10)}... placed first bet)`);
          }
        } catch (referralError) {
          console.warn('[REFERRAL] Award error (non-critical):', referralError);
        }
      }

      res.json({
        success: true,
        bet: storedBet || bet,
        paymentMethod,
        calculations: {
          betAmount,
          platformFee: paymentMethod === 'wallet' ? 0 : platformFee,
          totalDebit: paymentMethod === 'wallet' ? betAmount : totalDebit,
          potentialPayout,
          odds
        },
        onChain: {
          status: paymentMethod === 'wallet' ? 'confirmed' : (onChainBet?.status || 'pending'),
          txHash: txHash || storedBet?.txHash,
          betObjectId: onChainBetId,
          packageId: blockchainBetService.getPackageId()
        },
        promotion: promotionBonus.bonusAwarded ? {
          bonusAwarded: true,
          bonusAmount: promotionBonus.bonusAmount,
          newBonusBalance: promotionBonus.newBonusBalance,
          message: `You earned $${promotionBonus.bonusAmount} bonus! Total bonus: $${promotionBonus.newBonusBalance}`
        } : undefined
      });
    } catch (error: any) {
      console.error("Bet placement error:", error);
      res.status(500).json({ message: error.message || "Failed to place bet" });
    }
  });

  // Build transaction payload for frontend wallet signing
  app.post("/api/bets/build-transaction", async (req: Request, res: Response) => {
    try {
      const { eventId, prediction, betAmount, odds, marketId } = req.body;

      if (!eventId || !prediction || !betAmount || !odds) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const betAmountMist = Math.floor(betAmount * 1e9);
      
      const txPayload = blockchainBetService.buildClientTransaction(
        eventId,
        prediction,
        betAmountMist,
        odds,
        marketId || 'match_winner',
        ''
      );

      res.json({
        success: true,
        transaction: txPayload,
        network: process.env.SUI_NETWORK || 'mainnet',
        instructions: 'Use this payload with your Sui wallet to sign and submit the transaction'
      });
    } catch (error: any) {
      console.error("Transaction build error:", error);
      res.status(500).json({ message: error.message || "Failed to build transaction" });
    }
  });

  // Get contract info for frontend
  app.get("/api/contract/info", async (_req: Request, res: Response) => {
    res.json({
      packageId: blockchainBetService.getBettingPackageId(),
      platformId: blockchainBetService.getBettingPlatformId(),
      network: process.env.SUI_NETWORK || 'mainnet',
      revenueWallet: blockchainBetService.getRevenueWallet(),
      adminWallet: blockchainBetService.getAdminWallet(),
      sbetsTokenPackage: blockchainBetService.getPackageId()
    });
  });

  // Get settlement worker status
  app.get("/api/settlement/status", async (_req: Request, res: Response) => {
    const status = settlementWorker.getStatus();
    res.json({
      success: true,
      ...status,
      message: status.isRunning ? 'Settlement worker is active and monitoring for finished matches' : 'Settlement worker is not running'
    });
  });

  // Place a parlay bet (multiple selections)
  app.post("/api/bets/parlay", async (req: Request, res: Response) => {
    try {
      // Validate request
      const validation = validateRequest(ParlaySchema, req.body);
      if (!validation.valid) {
        return res.status(400).json({ 
          message: "Validation failed",
          errors: validation.errors 
        });
      }

      const { userId, selections, betAmount, feeCurrency } = validation.data!;
      const userIdStr = String(userId);

      // ANTI-EXPLOIT: Wallet blocklist check
      if (userIdStr.startsWith('0x') && isWalletBlocked(userIdStr)) {
        console.log(`🚫 BLOCKED WALLET: Parlay rejected from ${userIdStr.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }
      
      const eventIds = selections.map((s: any) => s.eventId);
      const uniqueEventIds = new Set(eventIds);
      if (uniqueEventIds.size < eventIds.length) {
        console.log(`🚫 EXPLOIT BLOCKED: Parlay with duplicate events from ${userIdStr} - ${eventIds.join(', ')}`);
        return res.status(400).json({
          message: "Cannot place parlay with multiple selections from the same match",
          code: "DUPLICATE_EVENT_IN_PARLAY"
        });
      }

      // ANTI-EXPLOIT: Validate all parlay selections reference real events AND check free sports cutoff
      for (const sel of selections) {
        const selEventId = String(sel.eventId);
        const eventLookup = apiSportsService.lookupEventSync(selEventId);
        if (!eventLookup.found) {
          const { freeSportsService } = await import('./services/freeSportsService');
          const freeLookup = freeSportsService.lookupEvent(selEventId);
          if (!freeLookup.found) {
            const esLookup = esportsService.lookupEvent(selEventId);
            if (!esLookup.found) {
              console.log(`🚫 EXPLOIT BLOCKED: Parlay selection references unknown event ${selEventId} from ${userIdStr.slice(0, 12)}...`);
              return res.status(400).json({
                message: "One or more selections reference invalid events. Please refresh and try again.",
                code: "INVALID_PARLAY_EVENT"
              });
            }
            if (esLookup.event?.startTime && new Date(esLookup.event.startTime) <= new Date()) {
              return res.status(400).json({
                message: "One or more selections have already started. Betting is only available before the game begins.",
                code: "MATCH_STARTED"
              });
            }
          } else if (freeLookup.shouldBeLive) {
            console.log(`🚫 EXPLOIT BLOCKED: Parlay includes started free sport event ${selEventId} from ${userIdStr.slice(0, 12)}...`);
            return res.status(400).json({
              message: "One or more selections have already started. Betting is only available before the game begins.",
              code: "MATCH_STARTED"
            });
          }
        }
        if (eventLookup.found && eventLookup.source === 'upcoming' && eventLookup.shouldBeLive) {
          console.log(`🚫 EXPLOIT BLOCKED: Parlay includes started event ${selEventId} from ${userIdStr.slice(0, 12)}...`);
          return res.status(400).json({
            message: "One or more selections have already started. Please refresh and try again.",
            code: "MATCH_STARTED"
          });
        }
      }
      
      const currency: 'SUI' | 'SBETS' = feeCurrency === 'SBETS' ? 'SBETS' : 'SUI';
      
      if (SUI_BETTING_PAUSED && currency !== 'SBETS') {
        console.log(`❌ SUI parlay blocked - betting paused until treasury funded`);
        return res.status(400).json({
          message: SUI_PAUSE_MESSAGE,
          code: "SUI_BETTING_PAUSED"
        });
      }
      
      // MAX STAKE VALIDATION - Backend enforcement (100 SUI / 10,000 SBETS)
      const MAX_STAKE_SUI = 100;
      const MAX_STAKE_SBETS = 10000; // 10,000 SBETS max per parlay
      const maxStake = currency === 'SBETS' ? MAX_STAKE_SBETS : MAX_STAKE_SUI;
      
      if (betAmount > maxStake) {
        console.log(`❌ Parlay rejected (max stake exceeded): ${betAmount} ${currency} > ${maxStake} ${currency}`);
        return res.status(400).json({
          message: `Maximum stake is ${maxStake.toLocaleString()} ${currency}`,
          code: "MAX_STAKE_EXCEEDED"
        });
      }

      // Check user balance (using async for accurate DB read)
      const balance = await balanceService.getBalanceAsync(userIdStr);
      
      // Calculate parlay odds (multiply all odds)
      const parlayOdds = selections.reduce((acc: number, sel: any) => acc * sel.odds, 1);
      
      if (!isFinite(parlayOdds) || parlayOdds <= 0) {
        return res.status(400).json({ message: "Invalid parlay odds calculation" });
      }

      const platformFee = betAmount * 0.01; // 1% platform fee
      const totalDebit = betAmount + platformFee;

      const availableBalance = currency === 'SBETS' ? balance.sbetsBalance : balance.suiBalance;
      if (availableBalance < totalDebit) {
        return res.status(400).json({ 
          message: `Insufficient balance. Required: ${totalDebit} ${currency}, Available: ${availableBalance} ${currency}`
        });
      }

      // Deduct bet from balance (with currency support)
      const deductSuccess = await balanceService.deductForBet(userIdStr, betAmount, platformFee, currency);
      if (!deductSuccess) {
        return res.status(400).json({ message: "Failed to deduct bet amount from balance" });
      }

      const potentialPayout = Math.round(betAmount * parlayOdds * 100) / 100;

      const parlayId = `parlay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const parlay = {
        id: parlayId,
        userId: userIdStr,
        selections,
        odds: parlayOdds,
        betAmount,
        currency,
        status: 'pending' as const,
        placedAt: Date.now(),
        potentialPayout,
        platformFee,
        totalDebit,
        selectionCount: selections.length
      };

      // Store parlay in storage
      const storedParlay = await storage.createParlay(parlay);

      // Notify user
      notificationService.createNotification(
        userIdStr,
        'bet_placed',
        `Parlay Placed: ${selections.length} Selections`,
        `${selections.length}-leg parlay @ ${parlayOdds.toFixed(2)} odds. Stake: ${betAmount} ${currency}, Potential: ${potentialPayout} ${currency}`,
        parlay
      );


      // Log to monitoring
      monitoringService.logBet({
        betId: parlayId,
        userId: userIdStr,
        eventId: 'parlay',
        odds: parlayOdds,
        amount: betAmount,
        timestamp: Date.now(),
        status: 'pending'
      });

      console.log(`🔥 PARLAY PLACED: ${parlayId} - ${selections.length} selections @ ${parlayOdds.toFixed(2)} odds, Stake: ${betAmount} ${currency}, Potential: ${potentialPayout} ${currency}`);

      (async () => {
        try {
          const { storeBetReceipt } = await import('./services/walrusStorageService');
          const parlayLegsStr = selections.map((s: any) => `${s.eventName || s.eventId}: ${s.selection || s.prediction}`).join(' | ');
          const walrusResult = await storeBetReceipt({
            betId: parlayId,
            walletAddress: userIdStr,
            eventId: selections.map((s: any) => s.eventId).join(','),
            eventName: `Parlay (${selections.length} legs): ${parlayLegsStr}`,
            homeTeam: selections[0]?.homeTeam || '',
            awayTeam: selections[0]?.awayTeam || '',
            prediction: parlayLegsStr,
            odds: parlayOdds,
            stake: betAmount,
            currency,
            potentialPayout,
            placedAt: Date.now(),
          });
          const { bets: betsTable } = await import('@shared/schema');
          const { db: walrusDb } = await import('./db');
          const { eq: walrusEq } = await import('drizzle-orm');
          const updateFields: any = { walrusReceiptData: walrusResult.receiptJson };
          if (walrusResult.blobId) {
            updateFields.walrusBlobId = walrusResult.blobId;
          } else {
            updateFields.walrusBlobId = `local_${walrusResult.receiptHash}`;
          }
          const walrusUpdateResult = await walrusDb.update(betsTable)
            .set(updateFields)
            .where(walrusEq(betsTable.wurlusBetId, parlayId))
            .returning({ id: betsTable.id });
          console.log(`🐋 Parlay receipt saved: ${parlayId}: ${updateFields.walrusBlobId} (${walrusUpdateResult.length} rows updated)`);
        } catch (walrusErr: any) {
          console.warn(`[Walrus] Parlay receipt failed: ${walrusErr.message}`);
        }
      })();

      res.json({
        success: true,
        parlay: storedParlay || parlay,
        calculations: {
          betAmount,
          platformFee,
          totalDebit,
          potentialPayout,
          parlayOdds,
          legCount: selections.length
        }
      });
    } catch (error: any) {
      console.error("Parlay placement error:", error);
      res.status(500).json({ message: error.message || "Failed to place parlay" });
    }
  });

  // On-chain parlay endpoint - called from frontend after successful on-chain transaction
  // This stores the on-chain bet object ID for settlement
  app.post("/api/parlays", async (req: Request, res: Response) => {
    try {
      const { 
        userId, 
        walletAddress, 
        totalOdds, 
        betAmount, 
        potentialPayout, 
        feeCurrency, 
        txHash, 
        onChainBetId, 
        status, 
        legs 
      } = req.body;

      // ANTI-EXPLOIT: Wallet blocklist check (check both walletAddress and userId)
      const parlayWallet = walletAddress || userId;
      if (parlayWallet && isWalletBlocked(parlayWallet)) {
        console.log(`🚫 BLOCKED WALLET: On-chain parlay rejected from ${parlayWallet.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }
      if (walletAddress && userId && walletAddress !== userId && isWalletBlocked(userId)) {
        console.log(`🚫 BLOCKED WALLET: On-chain parlay rejected (userId) from ${userId.slice(0, 12)}...`);
        return res.status(403).json({
          message: "This wallet has been suspended due to policy violations.",
          code: "WALLET_BLOCKED"
        });
      }

      // ANTI-EXPLOIT: Require walletAddress for on-chain parlays
      if (!walletAddress) {
        return res.status(400).json({
          message: "Wallet address is required for on-chain parlays.",
          code: "MISSING_WALLET"
        });
      }

      const currency: 'SUI' | 'SBETS' = feeCurrency === 'SBETS' ? 'SBETS' : 'SUI';

      // MAX STAKE VALIDATION
      const MAX_STAKE_SUI = 100;
      const MAX_STAKE_SBETS = 10000;
      const maxStake = currency === 'SBETS' ? MAX_STAKE_SBETS : MAX_STAKE_SUI;
      if (betAmount > maxStake) {
        console.log(`❌ On-chain parlay rejected (max stake exceeded): ${betAmount} ${currency} > ${maxStake} ${currency}`);
        return res.status(400).json({
          message: `Maximum stake is ${maxStake.toLocaleString()} ${currency}`,
          code: "MAX_STAKE_EXCEEDED"
        });
      }
      
      if (legs && Array.isArray(legs) && legs.length > 1) {
        const legEventIds = legs.map((l: any) => l.eventId);
        const uniqueLegEventIds = new Set(legEventIds);
        if (uniqueLegEventIds.size < legEventIds.length) {
          console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay with duplicate events from ${walletAddress} - ${legEventIds.join(', ')}`);
          return res.status(400).json({
            message: "Cannot place parlay with multiple selections from the same match",
            code: "DUPLICATE_EVENT_IN_PARLAY"
          });
        }
      }

      // ANTI-EXPLOIT: Validate all parlay legs reference real events AND check free sports cutoff
      if (legs && Array.isArray(legs)) {
        for (const leg of legs) {
          const legEventId = String(leg.eventId || '');
          if (!legEventId) {
            console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay has leg with no event ID from ${walletAddress}`);
            return res.status(400).json({
              message: "Invalid parlay - all selections must reference valid events.",
              code: "INVALID_PARLAY_EVENT"
            });
          }
          const eventLookup = apiSportsService.lookupEventSync(legEventId);
          if (!eventLookup.found) {
            const { freeSportsService } = await import('./services/freeSportsService');
            const freeLookup = freeSportsService.lookupEvent(legEventId);
            if (!freeLookup.found) {
              const esLookup2 = esportsService.lookupEvent(legEventId);
              if (!esLookup2.found) {
                console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay leg references unknown event ${legEventId} from ${walletAddress}`);
                return res.status(400).json({
                  message: "One or more selections reference invalid events.",
                  code: "INVALID_PARLAY_EVENT"
                });
              }
              if (esLookup2.event?.startTime && new Date(esLookup2.event.startTime) <= new Date()) {
                return res.status(400).json({
                  message: "One or more selections have already started. Betting is only available before the game begins.",
                  code: "MATCH_STARTED"
                });
              }
            } else if (freeLookup.shouldBeLive) {
              console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay includes started free sport event ${legEventId} from ${walletAddress}`);
              return res.status(400).json({
                message: "One or more selections have already started. Betting is only available before the game begins.",
                code: "MATCH_STARTED"
              });
            }
          }
          if (eventLookup.found && eventLookup.source === 'upcoming' && eventLookup.shouldBeLive) {
            console.log(`🚫 EXPLOIT BLOCKED: On-chain parlay includes started event ${legEventId} from ${walletAddress}`);
            return res.status(400).json({
              message: "One or more selections have already started. Please refresh and try again.",
              code: "MATCH_STARTED"
            });
          }
        }
      }
      
      const parlayId = onChainBetId || `parlay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      console.log(`📦 ON-CHAIN PARLAY: ${parlayId} from ${walletAddress}`);
      console.log(`📦 Legs: ${legs?.length || 0}, Odds: ${totalOdds}, Stake: ${betAmount} ${currency}`);
      console.log(`📦 txHash: ${txHash}, betObjectId: ${onChainBetId}`);

      const parlay = {
        id: parlayId,
        userId: walletAddress || userId,
        selections: legs || [],
        combinedOdds: totalOdds,
        totalStake: betAmount,
        potentialPayout: potentialPayout || (betAmount * totalOdds),
        currency,
        status: status || 'pending',
        txHash,
        onChainBetId, // CRITICAL: Pass betObjectId for on-chain settlement
        platformFee: betAmount * 0.01,
        networkFee: 0,
      };

      const storedParlay = await storage.createParlay(parlay);

      console.log(`✅ ON-CHAIN PARLAY STORED: ${parlayId} with betObjectId: ${onChainBetId}`);

      (async () => {
        try {
          const { storeBetReceipt } = await import('./services/walrusStorageService');
          const parlayLegsStr = (legs || []).map((l: any) => `${l.eventName || l.eventId}: ${l.selection || l.prediction}`).join(' | ');
          const walrusResult = await storeBetReceipt({
            betId: parlayId,
            walletAddress: walletAddress || userId,
            eventId: (legs || []).map((l: any) => l.eventId).join(','),
            eventName: `Parlay (${legs?.length || 0} legs): ${parlayLegsStr}`,
            homeTeam: legs?.[0]?.homeTeam || '',
            awayTeam: legs?.[0]?.awayTeam || '',
            prediction: parlayLegsStr,
            odds: totalOdds,
            stake: betAmount,
            currency,
            potentialPayout: potentialPayout || (betAmount * totalOdds),
            txHash: txHash || undefined,
            betObjectId: onChainBetId || undefined,
            placedAt: Date.now(),
          });
          const { bets: betsTable } = await import('@shared/schema');
          const { db: walrusDb } = await import('./db');
          const { eq: walrusEq } = await import('drizzle-orm');
          const updateFields: any = { walrusReceiptData: walrusResult.receiptJson };
          if (walrusResult.blobId) {
            updateFields.walrusBlobId = walrusResult.blobId;
          } else {
            updateFields.walrusBlobId = `local_${walrusResult.receiptHash}`;
          }
          const walrusUpdateResult = await walrusDb.update(betsTable)
            .set(updateFields)
            .where(walrusEq(betsTable.wurlusBetId, parlayId))
            .returning({ id: betsTable.id });
          console.log(`🐋 On-chain parlay receipt saved: ${parlayId}: ${updateFields.walrusBlobId} (${walrusUpdateResult.length} rows updated)`);
        } catch (walrusErr: any) {
          console.warn(`[Walrus] On-chain parlay receipt failed: ${walrusErr.message}`);
        }
      })();

      res.json({
        success: true,
        parlay: storedParlay,
        bet: storedParlay
      });
    } catch (error: any) {
      console.error("On-chain parlay storage error:", error);
      res.status(500).json({ message: error.message || "Failed to store parlay" });
    }
  });

  // Get user's bets - requires wallet address, returns empty if not provided
  app.get("/api/bets", async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      const userId = req.query.userId as string;
      const status = req.query.status as string | undefined;
      
      // No mock data - require a wallet or userId
      if (!wallet && !userId) {
        return res.json([]);
      }
      
      const lookupId = wallet || userId;
      const bets = await storage.getUserBets(lookupId);
      const filtered = status ? bets.filter(b => b.status === status) : bets;
      
      // Storage already provides currency field properly mapped
      res.json(filtered);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bets" });
    }
  });

  // Get a specific bet
  app.get("/api/bets/:id", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      let bet = await storage.getBet(betId);
      
      if (!bet && /^\d+$/.test(betId)) {
        bet = await storage.getBet(parseInt(betId));
      }
      
      if (!bet) {
        return res.status(404).json({ message: "Bet not found" });
      }
      
      res.json(bet);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bet" });
    }
  });

  // Verify bet in database and on-chain
  app.get("/api/bets/:id/verify", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      
      // Get bet from database
      const bet = await storage.getBet(betId);
      if (!bet) {
        return res.status(404).json({ message: "Bet not found" });
      }

      // Verify on-chain if txHash exists
      let onChainVerification: { confirmed: boolean; blockHeight: number } = { confirmed: false, blockHeight: 0 };
      if (bet.txHash) {
        const verification = await blockchainBetService.verifyTransaction(bet.txHash);
        onChainVerification = { 
          confirmed: verification.confirmed, 
          blockHeight: verification.blockHeight || 0 
        };
      }

      res.json({
        betId,
        database: {
          found: true,
          status: bet.status,
          txHash: bet.txHash
        },
        onChain: {
          verified: onChainVerification.confirmed,
          blockHeight: onChainVerification.blockHeight
        },
        packageId: blockchainBetService.getPackageId()
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to verify bet" });
    }
  });

  // Settlement endpoint - Auto-settle bets based on event results
  app.post("/api/bets/:id/settle", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      const { eventResult } = req.body;

      if (!eventResult) {
        return res.status(400).json({ message: "Event result required" });
      }

      // Fetch actual bet from storage
      const storedBet = await storage.getBet(betId);
      
      // Use stored bet or fallback to mock for testing
      const bet = storedBet ? {
        id: storedBet.id,
        userId: storedBet.userId || 'user1',
        eventId: storedBet.eventId,
        marketId: storedBet.marketId || 'match-winner',
        outcomeId: storedBet.outcomeId || 'home',
        odds: storedBet.odds || 2.0,
        betAmount: storedBet.betAmount || 100,
        currency: (storedBet as any).currency || 'SUI' as 'SUI' | 'SBETS',
        status: 'pending' as const,
        prediction: storedBet.prediction || eventResult.result || 'home',
        placedAt: storedBet.placedAt || Date.now(),
        potentialPayout: storedBet.potentialPayout || (storedBet.betAmount || 100) * (storedBet.odds || 2.0)
      } : {
        id: betId,
        userId: 'user1',
        eventId: eventResult.eventId || '1',
        marketId: 'match-winner',
        outcomeId: 'home',
        odds: 2.0,
        betAmount: 100,
        currency: 'SUI' as 'SUI' | 'SBETS',
        status: 'pending' as const,
        prediction: eventResult.result || 'home',
        placedAt: Date.now(),
        potentialPayout: 200
      };

      const settlement = SettlementService.settleBet(bet, eventResult);
      const platformFee = settlement.payout > 0 ? settlement.payout * 0.01 : 0;
      const netPayout = settlement.payout - platformFee;
      
      // ANTI-CHEAT: Sign settlement with oracle key
      const outcome = settlement.status === 'won' ? 'won' : settlement.status === 'lost' ? 'lost' : 'void';
      const settlementData = {
        betId,
        eventId: bet.eventId,
        outcome: outcome as 'won' | 'lost' | 'void',
        payout: settlement.payout,
        timestamp: Date.now()
      };

      // Validate settlement logic to detect manipulation
      const validationCheck = antiCheatService.validateSettlementLogic(settlementData, eventResult);
      if (!validationCheck.valid) {
        console.error(`🚨 ANTI-CHEAT REJECTION: ${validationCheck.reason}`);
        return res.status(400).json({ message: `Settlement validation failed: ${validationCheck.reason}` });
      }

      // Sign settlement data cryptographically
      const signedSettlement = antiCheatService.signSettlementData(settlementData);
      const onChainProof = antiCheatService.generateOnChainProof(signedSettlement);

      // Update bet status - ONLY process payouts if status update succeeds (prevents double payout)
      const statusUpdated = await storage.updateBetStatus(betId, settlement.status, settlement.payout);
      
      if (statusUpdated) {
        // AUTO-PAYOUT: Add winnings to user balance using the bet's currency
        if (settlement.status === 'won' && netPayout > 0) {
          const winningsAdded = await balanceService.addWinnings(bet.userId, netPayout, bet.currency);
          if (!winningsAdded) {
            // CRITICAL: Revert bet status if balance credit failed - user keeps their bet
            await storage.updateBetStatus(betId, 'pending');
            console.error(`❌ SETTLEMENT REVERTED: Failed to credit winnings for bet ${betId}`);
            return res.status(500).json({ message: "Failed to credit winnings - settlement reverted" });
          }
          // CRITICAL: Record 1% platform fee as revenue (was missing!)
          await balanceService.addRevenue(platformFee, bet.currency);
          console.log(`💰 AUTO-PAYOUT (DB): ${bet.userId} received ${netPayout} ${bet.currency} (fee: ${platformFee} ${bet.currency} -> revenue)`);
        } else if (settlement.status === 'void') {
          // VOID: Return stake to treasury (SBETS already in treasury from on-chain transfer)
          await balanceService.addRevenue(bet.betAmount, bet.currency);
          console.log(`🔄 VOID -> TREASURY: ${bet.betAmount} ${bet.currency} returned to treasury from voided bet ${betId}`);
        } else if (settlement.status === 'lost') {
          // Add lost bet stake to platform revenue
          await balanceService.addRevenue(bet.betAmount, bet.currency);
          console.log(`📊 REVENUE (DB): ${bet.betAmount} ${bet.currency} added to platform revenue from lost bet`);
        }
      } else {
        console.log(`⚠️ DUPLICATE SETTLEMENT PREVENTED: Bet ${betId} already settled - no payout applied`);
        return res.status(400).json({ message: "Bet already settled - duplicate settlement prevented" });
      }

      // Notify user of settlement with proof
      notificationService.notifyBetSettled(bet.userId, bet, outcome);


      // Log settlement
      monitoringService.logSettlement({
        settlementId: `settlement-${betId}`,
        betId,
        outcome: settlement.status,
        payout: settlement.payout,
        timestamp: Date.now(),
        fees: platformFee
      });

      console.log(`✅ BET SETTLED: ${betId} - Status: ${settlement.status}, Payout: ${settlement.payout} ${bet.currency}, Fee: ${platformFee} ${bet.currency}, Net: ${netPayout} ${bet.currency}`);
      
      res.json({
        success: true,
        betId,
        settlement: {
          status: settlement.status,
          payout: settlement.payout,
          platformFee: platformFee,
          netPayout: netPayout,
          settledAt: Date.now()
        },
        antiCheat: {
          signed: true,
          signature: onChainProof.signature,
          dataHash: onChainProof.dataHash,
          oraclePublicKey: onChainProof.oraclePublicKey,
          message: 'Settlement cryptographically verified and ready for Sui Move contract verification'
        }
      });
    } catch (error) {
      console.error("Settlement error:", error);
      res.status(500).json({ message: "Failed to settle bet" });
    }
  });

  // ============================================
  // zkLogin Salt Management
  // ============================================
  app.post("/api/zklogin/salt", async (req: Request, res: Response) => {
    try {
      const { zkloginSalts } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { provider, subject } = req.body;

      if (!provider || !subject) {
        return res.status(400).json({ error: 'Provider and subject are required' });
      }

      const existing = await db.select().from(zkloginSalts)
        .where(and(eq(zkloginSalts.provider, provider), eq(zkloginSalts.subject, subject)));

      if (existing.length > 0) {
        console.log(`[zkLogin] Salt retrieved for ${provider}:${subject.substring(0, 8)}...`);
        return res.json({ salt: existing[0].salt });
      }

      const crypto = await import('crypto');
      const newSalt = crypto.randomBytes(16).toString('hex');

      await db.insert(zkloginSalts).values({
        provider,
        subject,
        salt: newSalt
      });

      console.log(`[zkLogin] New salt created for ${provider}:${subject.substring(0, 8)}...`);
      res.json({ salt: newSalt });
    } catch (error: any) {
      console.error('[zkLogin] Salt error:', error.message);
      res.status(500).json({ error: 'Failed to get salt' });
    }
  });

  app.post("/api/zklogin/save-address", async (req: Request, res: Response) => {
    try {
      const { zkloginSalts } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { provider, subject, suiAddress } = req.body;

      if (!provider || !subject || !suiAddress) {
        return res.status(400).json({ error: 'Provider, subject, and suiAddress required' });
      }

      await db.update(zkloginSalts)
        .set({ suiAddress: suiAddress.toLowerCase() })
        .where(and(eq(zkloginSalts.provider, provider), eq(zkloginSalts.subject, subject)));

      console.log(`[zkLogin] Address saved: ${suiAddress.substring(0, 10)}... for ${provider}:${subject.substring(0, 8)}...`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[zkLogin] Save address error:', error.message);
      res.status(500).json({ error: 'Failed to save address' });
    }
  });

  // Wallet connect endpoint - registers/retrieves user by wallet address
  app.post("/api/wallet/connect", async (req: Request, res: Response) => {
    try {
      const { address, walletType } = req.body;
      
      if (!address) {
        return res.status(400).json({ message: "Wallet address is required" });
      }
      
      // CRITICAL: Normalize wallet address to lowercase for consistent storage/retrieval
      const normalizedAddress = address.toLowerCase();
      console.log(`[Wallet Connect] Processing connection for: ${normalizedAddress.substring(0, 10)}...`);
      
      let user;
      let userId = 0;
      let username = normalizedAddress.substring(0, 8);
      let createdAt = new Date().toISOString();
      
      try {
        // Check if user exists with this wallet address
        user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (!user) {
          // Create new user with wallet address (password required by schema, use placeholder for wallet-based auth)
          const placeholderPassword = `wallet_${Date.now()}_${Math.random().toString(36).substring(2)}`;
          user = await storage.createUser({
            username: normalizedAddress.substring(0, 8),
            password: placeholderPassword,
            walletAddress: normalizedAddress,
            walletType: walletType || 'sui'
          });
          console.log(`[Wallet Connect] Created new user for wallet: ${normalizedAddress.substring(0, 10)}...`);
        } else {
          console.log(`[Wallet Connect] Found existing user for wallet: ${normalizedAddress.substring(0, 10)}...`);
        }
        userId = user.id;
        username = user.username;
        createdAt = user.createdAt?.toISOString?.() || user.createdAt || createdAt;
      } catch (dbError: any) {
        // Handle schema mismatch gracefully (e.g., missing free_bet_balance column)
        console.warn(`[Wallet Connect] DB error (schema may be out of sync): ${dbError.message}`);
        // Still allow connection with basic info
      }
      
      // Get balance for user using normalized address
      const balance = await balanceService.getBalanceAsync(normalizedAddress);
      console.log(`[Wallet Connect] Balance retrieved:`, balance);
      
      res.json({
        id: userId || user?.id || 0,
        username: username || user?.username || normalizedAddress.substring(0, 8),
        walletAddress: user?.walletAddress || normalizedAddress,
        walletType: user?.walletType || walletType || 'sui',
        createdAt: createdAt,
        suiBalance: balance.suiBalance || 0,
        sbetsBalance: balance.sbetsBalance || 0,
        balance: {
          SUI: balance.suiBalance || 0,
          SBETS: balance.sbetsBalance || 0
        }
      });
    } catch (error: any) {
      console.error("Wallet connect error:", error?.message || error);
      res.status(500).json({ message: "Failed to connect wallet", error: error?.message || "Unknown error" });
    }
  });

  // Auth wallet connect endpoint (alias for /api/wallet/connect for client compatibility)
  app.post("/api/auth/wallet-connect", async (req: Request, res: Response) => {
    try {
      const { walletAddress, walletType } = req.body;
      
      if (!walletAddress) {
        return res.status(400).json({ success: false, message: "Wallet address is required" });
      }
      
      const normalizedAddress = walletAddress.toLowerCase();
      console.log(`[Auth Wallet Connect] Processing: ${normalizedAddress.substring(0, 10)}...`);
      
      let user;
      let userId = 0;
      let username = normalizedAddress.substring(0, 8);
      
      try {
        user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (!user) {
          const placeholderPassword = `wallet_${Date.now()}_${Math.random().toString(36).substring(2)}`;
          user = await storage.createUser({
            username: normalizedAddress.substring(0, 8),
            password: placeholderPassword,
            walletAddress: normalizedAddress,
            walletType: walletType || 'sui'
          });
          console.log(`[Auth Wallet Connect] Created new user: ${normalizedAddress.substring(0, 10)}...`);
        }
        userId = user.id;
        username = user.username;
      } catch (dbError: any) {
        // Handle schema mismatch gracefully (e.g., missing free_bet_balance column)
        console.warn(`[Auth Wallet Connect] DB error (schema may be out of sync): ${dbError.message}`);
        // Still allow connection with basic info
      }
      
      const balance = await balanceService.getBalanceAsync(normalizedAddress);
      
      res.json({
        success: true,
        user: {
          id: userId || user?.id || 0,
          username: username || user?.username || normalizedAddress.substring(0, 8),
          walletAddress: user?.walletAddress || normalizedAddress,
          walletType: user?.walletType || walletType || 'sui',
          suiBalance: balance.suiBalance || 0,
          sbetsBalance: balance.sbetsBalance || 0,
          balance: {
            SUI: balance.suiBalance || 0,
            SBETS: balance.sbetsBalance || 0
          }
        }
      });
    } catch (error: any) {
      console.error("Auth wallet connect error:", error?.message || error);
      console.error("Auth wallet connect full error:", error);
      // Include more details for debugging
      res.status(500).json({ 
        success: false, 
        message: `Failed to connect wallet: ${error?.message || 'Unknown error'}`
      });
    }
  });

  // Auth wallet disconnect endpoint
  app.post("/api/auth/wallet-disconnect", async (req: Request, res: Response) => {
    res.json({ success: true, message: "Wallet disconnected" });
  });

  // Auth wallet status endpoint
  app.get("/api/auth/wallet-status", async (req: Request, res: Response) => {
    try {
      // Check if wallet is connected based on session or query param
      const walletAddress = req.query.walletAddress as string;
      
      if (walletAddress) {
        const normalizedAddress = walletAddress.toLowerCase();
        const user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (user) {
          const balance = await balanceService.getBalanceAsync(normalizedAddress);
          return res.json({
            authenticated: true,
            walletAddress: user.walletAddress,
            walletType: user.walletType,
            balance: balance
          });
        }
      }
      
      res.json({ authenticated: false });
    } catch (error) {
      res.json({ authenticated: false });
    }
  });

  // Auth profile endpoint
  app.get("/api/auth/profile", async (req: Request, res: Response) => {
    try {
      const walletAddress = req.query.walletAddress as string;
      
      if (walletAddress) {
        const normalizedAddress = walletAddress.toLowerCase();
        const user = await storage.getUserByWalletAddress(normalizedAddress);
        
        if (user) {
          const balance = await balanceService.getBalanceAsync(normalizedAddress);
          return res.json({
            success: true,
            profile: {
              id: user.id,
              username: user.username,
              walletAddress: user.walletAddress,
              walletType: user.walletType,
              suiBalance: balance?.suiBalance || 0,
              sbetsBalance: balance?.sbetsBalance || 0
            }
          });
        }
      }
      
      res.json({ success: false, profile: null });
    } catch (error) {
      res.json({ success: false, profile: null });
    }
  });

  // Get user balance - fetches BOTH on-chain wallet balance AND platform database balance
  app.get("/api/user/balance", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      
      // Always get database platform balance (for withdrawals of deposited funds)
      const dbBalance = await balanceService.getBalanceAsync(userId || 'user1');
      
      // If userId looks like a wallet address (starts with 0x), also fetch on-chain balance
      if (userId && userId.startsWith('0x')) {
        try {
          const onChainBalance = await blockchainBetService.getWalletBalance(userId);
          // Get promotion bonus balance
          let promotionBonus = 0;
          try {
            const promoStatus = await promotionService.getPromotionStatus(userId);
            promotionBonus = promoStatus.bonusBalance || 0;
          } catch (promoError) {
            console.warn('Promotion status fetch error:', promoError);
          }
          return res.json({
            // On-chain wallet balance (what user has in their Sui wallet for betting)
            SUI: onChainBalance.sui || 0,
            SBETS: onChainBalance.sbets || 0,
            suiBalance: onChainBalance.sui || 0,
            sbetsBalance: onChainBalance.sbets || 0,
            // Platform/database balance (for off-chain deposits - withdrawable)
            platformSuiBalance: dbBalance.suiBalance || 0,
            platformSbetsBalance: dbBalance.sbetsBalance || 0,
            // Promotion bonus balance (virtual USD for betting)
            promotionBonusUsd: promotionBonus,
            source: 'combined'
          });
        } catch (chainError) {
          console.warn(`Failed to fetch on-chain balance for ${userId}:`, chainError);
          // Fall back to database only
        }
      }
      
      // Fallback to database balance
      res.json({
        SUI: dbBalance.suiBalance || 0,
        SBETS: dbBalance.sbetsBalance || 0,
        suiBalance: dbBalance.suiBalance || 0,
        sbetsBalance: dbBalance.sbetsBalance || 0,
        platformSuiBalance: dbBalance.suiBalance || 0,
        platformSbetsBalance: dbBalance.sbetsBalance || 0,
        source: 'database'
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch balance" });
    }
  });

  // Get promotion status for user
  app.get("/api/promotion/status", async (req: Request, res: Response) => {
    try {
      const walletAddress = req.query.wallet as string;
      
      if (!walletAddress || !walletAddress.startsWith('0x')) {
        return res.status(400).json({ message: "Valid wallet address required" });
      }
      
      const status = await promotionService.getPromotionStatus(walletAddress);
      res.json({
        success: true,
        promotion: {
          isActive: status.isActive,
          totalBetUsd: status.totalBetUsd,
          bonusesAwarded: status.bonusesAwarded,
          bonusBalance: status.bonusBalance,
          nextBonusAt: status.nextBonusAt,
          promotionEnd: status.promotionEnd,
          thresholdUsd: status.thresholdUsd,
          bonusUsd: status.bonusUsd,
          progressPercent: Math.min(100, ((status.totalBetUsd % status.thresholdUsd) / status.thresholdUsd) * 100)
        }
      });
    } catch (error: any) {
      console.error('Promotion status error:', error);
      res.status(500).json({ message: error.message || "Failed to get promotion status" });
    }
  });

  // Deposit SUI to account (for on-chain wallet deposits)
  app.post("/api/user/deposit", async (req: Request, res: Response) => {
    try {
      const { userId, amount, txHash, currency = 'SUI', skipVerification = false } = req.body;
      
      if (!userId || !amount) {
        return res.status(400).json({ message: "Missing required fields: userId, amount" });
      }
      
      if (amount <= 0) {
        return res.status(400).json({ message: "Amount must be positive" });
      }

      if (!txHash) {
        return res.status(400).json({ message: "Transaction hash is required for deposits" });
      }
      
      // VERIFY TRANSACTION ON-CHAIN (unless explicitly skipped for testing)
      if (!skipVerification) {
        try {
          const verification = await blockchainBetService.verifyTransaction(txHash);
          if (!verification.confirmed) {
            console.warn(`⚠️ DEPOSIT TX NOT CONFIRMED: ${txHash}`);
            return res.status(400).json({ 
              message: "Transaction not confirmed on-chain. Please wait for confirmation and try again.",
              txHash,
              verified: false
            });
          }
          console.log(`✅ DEPOSIT TX VERIFIED: ${txHash} (block: ${verification.blockHeight})`);
        } catch (verifyError) {
          console.warn(`⚠️ Could not verify tx ${txHash}:`, verifyError);
          // Continue with deposit if verification fails (graceful degradation)
        }
      }
      
      // DUPLICATE PREVENTION: Use txHash deduplication in balanceService
      const depositResult = await balanceService.deposit(userId, amount, txHash, 'Wallet deposit', currency as 'SUI' | 'SBETS');
      
      if (!depositResult.success) {
        console.warn(`⚠️ DUPLICATE DEPOSIT BLOCKED: ${txHash} for ${userId}`);
        return res.status(409).json({ 
          success: false, 
          message: depositResult.message,
          duplicate: true
        });
      }
      
      // Notify user of deposit
      notificationService.createNotification(
        userId,
        'deposit',
        '💰 Deposit Received',
        `Successfully deposited ${amount} ${currency} to your account`,
        { amount, currency, txHash }
      );

      console.log(`✅ DEPOSIT PROCESSED: ${userId} - ${amount} ${currency} (tx: ${txHash})`);
      
      res.json({
        success: true,
        deposit: {
          amount,
          currency,
          txHash,
          status: 'completed',
          timestamp: Date.now()
        },
        newBalance: await balanceService.getBalanceAsync(userId)
      });
    } catch (error: any) {
      console.error("Deposit error:", error);
      res.status(500).json({ message: error.message || "Failed to process deposit" });
    }
  });

  // Withdraw SUI or SBETS to wallet
  app.post("/api/user/withdraw", async (req: Request, res: Response) => {
    try {
      // Validate request
      const validation = validateRequest(WithdrawSchema, req.body);
      if (!validation.valid) {
        return res.status(400).json({ 
          message: "Validation failed",
          errors: validation.errors 
        });
      }

      const { userId, amount } = validation.data!;
      const userIdStr = String(userId);
      const executeOnChain = req.body.executeOnChain === true;
      const currency: 'SUI' | 'SBETS' = req.body.currency === 'SBETS' ? 'SBETS' : 'SUI';
      
      const result = await balanceService.withdraw(userIdStr, amount, executeOnChain, currency);

      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      // Notify user based on withdrawal status
      if (result.status === 'completed') {
        notificationService.notifyWithdrawal(userIdStr, amount, 'completed');
        console.log(`Withdrawal completed: ${userIdStr} - ${amount} ${currency} | TX: ${result.txHash}`);
      } else {
        notificationService.createNotification(
          userIdStr,
          'withdrawal',
          `Withdrawal Queued`,
          `Your withdrawal of ${amount} ${currency} is being processed`,
          { amount, currency, status: 'pending_admin' }
        );
        console.log(`Withdrawal queued: ${userIdStr} - ${amount} ${currency}`);
      }

      res.json({
        success: true,
        withdrawal: {
          amount,
          currency,
          txHash: result.txHash,
          status: result.status,
          timestamp: Date.now(),
          onChainEnabled: blockchainBetService.isAdminKeyConfigured()
        }
      });
    } catch (error: any) {
      console.error("Withdrawal error:", error);
      res.status(500).json({ message: error.message || "Failed to process withdrawal" });
    }
  });

  // Get transaction history
  app.get("/api/user/transactions", async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || 'user1';
      const limit = parseInt(req.query.limit as string) || 50;
      const transactions = await balanceService.getTransactionHistory(userId, limit);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Cash-out endpoint - Allow early cash-out of pending bets
  app.post("/api/bets/:id/cash-out", async (req: Request, res: Response) => {
    try {
      const betId = req.params.id;
      const { currentOdds = 2.0, percentageWinning = 0.8 } = req.body;

      if (!currentOdds || !percentageWinning) {
        return res.status(400).json({ message: "Current odds and percentage winning required" });
  
      }

      // Fetch actual bet from storage
      const storedBet = await storage.getBet(betId);
      
      if (!storedBet) {
        return res.status(404).json({ message: "Bet not found" });
      }
      
      const bet = {
        id: storedBet.id,
        userId: storedBet.userId || 'user1',
        eventId: storedBet.eventId,
        marketId: storedBet.marketId || 'match-winner',
        outcomeId: storedBet.outcomeId || 'home',
        odds: storedBet.odds || 2.0,
        betAmount: storedBet.betAmount || 100,
        currency: (storedBet as any).currency || 'SUI' as 'SUI' | 'SBETS',
        status: storedBet.status as 'pending' | 'won' | 'lost' | 'void' | 'cashed_out',
        prediction: storedBet.prediction || 'home',
        placedAt: storedBet.placedAt || Date.now(),
        potentialPayout: storedBet.potentialPayout || (storedBet.betAmount || 100) * (storedBet.odds || 2.0)
      };
      
      if (bet.status !== 'pending') {
        return res.status(400).json({ message: "Only pending bets can be cashed out" });
      }

      const cashOutValue = SettlementService.calculateCashOut(bet, currentOdds, percentageWinning);
      const platformFee = cashOutValue * 0.01; // 1% cash-out fee
      const netCashOut = cashOutValue - platformFee;

      // Update bet status FIRST - only add winnings if status update succeeds (prevents double cash-out)
      const statusUpdated = await storage.updateBetStatus(betId, 'cashed_out', netCashOut);
      
      if (!statusUpdated) {
        console.log(`⚠️ DUPLICATE CASH-OUT PREVENTED: Bet ${betId} already cashed out or settled`);
        return res.status(400).json({ message: "Bet already cashed out or settled - duplicate cash-out prevented" });
      }
      
      // Add cash out amount to user balance in the correct currency
      await balanceService.addWinnings(bet.userId, netCashOut, bet.currency);

      console.log(`💸 CASH OUT: ${betId} - Value: ${cashOutValue} ${bet.currency}, Fee: ${platformFee} ${bet.currency}, Net: ${netCashOut} ${bet.currency}`);

      res.json({
        success: true,
        betId,
        cashOut: {
          originalStake: bet.betAmount,
          currency: bet.currency,
          cashOutValue: cashOutValue,
          platformFee: platformFee,
          netAmount: netCashOut,
          cashOutAt: Date.now(),
          status: 'cashed_out'
        }
      });
    } catch (error) {
      console.error("Cash-out error:", error);
      res.status(500).json({ message: "Failed to process cash-out" });
    }
  });

  // Register AI betting routes
  app.use(aiRoutes);

  // =====================================================
  // REVENUE SHARING API - SBETS Holder Revenue Distribution
  // =====================================================
  
  const SBETS_TOKEN_TYPE = '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS';
  const REVENUE_SHARE_PERCENTAGE = 0.30; // 30% of platform revenue goes to SBETS holders (was 10% + 20% liquidity, now combined)
  
  // Contract deployment date - only count revenue from bets placed after this date
  // This prevents old test bets from inflating revenue statistics
  // Using 12:00 UTC to exclude synced legacy bets that were imported earlier in the day
  const CONTRACT_DEPLOYMENT_DATE = new Date('2026-01-29T12:00:00Z');
  
  // Helper to get settled bets (only from new contract period)
  async function getSettledBetsForRevenue(): Promise<any[]> {
    const allBets = await storage.getAllBets();
    // Include 'paid_out' status - these are winning bets that have been paid (1% fee = revenue)
    // Filter by contract deployment date to exclude old test bets
    return allBets.filter((bet: any) => {
      if (bet.status !== 'won' && bet.status !== 'lost' && bet.status !== 'paid_out') return false;
      const betDate = new Date(bet.placedAt || bet.createdAt || 0);
      return betDate >= CONTRACT_DEPLOYMENT_DATE;
    });
  }
  
  // Helper to get claims from database
  async function getRevenueClaims(walletAddress: string): Promise<Array<{ amount: number; amountSbets: number; timestamp: number; txHash: string; txHashSbets: string | null; weekStart: Date }>> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { db } = await import('./db');
      
      const claims = await db.select().from(revenueClaims).where(eq(revenueClaims.walletAddress, walletAddress));
      return claims.map((c: any) => ({
        amount: c.claimAmount,
        amountSbets: c.claimAmountSbets || 0,
        timestamp: new Date(c.claimedAt).getTime(),
        txHash: c.txHash,
        txHashSbets: c.txHashSbets || null,
        weekStart: new Date(c.weekStart)
      }));
    } catch (error) {
      console.error('Error fetching revenue claims:', error);
      return [];
    }
  }
  
  // Helper to save a claim to database
  async function saveRevenueClaim(walletAddress: string, weekStart: Date, sbetsBalance: number, sharePercentage: number, claimAmount: number, claimAmountSbets: number, txHash: string, txHashSbets: string | null): Promise<boolean> {
    try {
      const { revenueClaims } = await import('@shared/schema');
      const { db } = await import('./db');
      
      await db.insert(revenueClaims).values({
        walletAddress,
        weekStart,
        sbetsBalance,
        sharePercentage,
        claimAmount,
        claimAmountSbets,
        txHash,
        txHashSbets
      });
      return true;
    } catch (error) {
      console.error('Error saving revenue claim:', error);
      return false;
    }
  }
  
  // Get SBETS holders from blockchain
  app.get("/api/revenue/holders", async (req: Request, res: Response) => {
    try {
      const coinType = SBETS_TOKEN_TYPE;
      const holdersData = await fetchSbetsHolders();
      
      res.json({
        success: true,
        tokenType: coinType,
        totalSupply: holdersData.totalSupply,
        holderCount: holdersData.holders.length,
        holders: holdersData.holders.slice(0, 100),
        lastUpdated: Date.now()
      });
    } catch (error: any) {
      console.error('Error fetching SBETS holders:', error);
      res.status(500).json({ message: 'Failed to fetch holders', error: error.message });
    }
  });
  
  // Get platform revenue data for distribution
  app.get("/api/revenue/stats", async (req: Request, res: Response) => {
    try {
      const platformInfo = await blockchainBetService.getPlatformInfo();
      const settledBets = await getSettledBetsForRevenue();
      
      // Get current week dates
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      
      // Filter bets for this week (use placedAt from storage, not createdAt)
      const weeklyBets = settledBets.filter((bet: any) => {
        const betDate = new Date(bet.placedAt || bet.createdAt || 0);
        return betDate >= startOfWeek && betDate <= endOfWeek;
      });
      
      // Price conversion: Convert all revenue to SUI equivalent for display
      // Updated January 27, 2026 - SUI trading at ~$1.50
      const SUI_PRICE_USD = 1.50;
      const SBETS_PRICE_USD = 0.000001;
      const sbetsToSuiRatio = SBETS_PRICE_USD / SUI_PRICE_USD; // ~0.000000667
      
      // Track SUI and SBETS revenue separately
      const weeklyRevenueSui = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SUI') return sum;
        let revenue = 0;
        if (bet.status === 'lost') {
          revenue = bet.betAmount || bet.stake || 0;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const payout = bet.potentialPayout || bet.potentialWin;
          const stake = bet.betAmount || bet.stake || 0;
          const profit = payout - stake;
          revenue = profit * 0.01; // 1% fee on profit
        }
        return sum + revenue;
      }, 0);
      
      const weeklyRevenueSbets = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SBETS') return sum;
        let revenue = 0;
        if (bet.status === 'lost') {
          revenue = bet.betAmount || bet.stake || 0;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const payout = bet.potentialPayout || bet.potentialWin;
          const stake = bet.betAmount || bet.stake || 0;
          const profit = payout - stake;
          revenue = profit * 0.01; // 1% fee on profit
        }
        return sum + revenue;
      }, 0);
      
      // Combined for backward compatibility (in SUI equivalent)
      const weeklyRevenue = weeklyRevenueSui + (weeklyRevenueSbets * sbetsToSuiRatio);
      
      // Calculate all-time total revenue - track separately
      const REVENUE_START_DATE = new Date('2026-01-27T00:00:00Z');
      const allTimeBets = settledBets.filter((bet: any) => new Date(bet.placedAt || bet.createdAt || 0) >= REVENUE_START_DATE);
      
      const allTimeRevenueSui = allTimeBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SUI') return sum;
        let revenue = 0;
        if (bet.status === 'lost') {
          revenue = bet.betAmount || bet.stake || 0;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const payout = bet.potentialPayout || bet.potentialWin;
          const stake = bet.betAmount || bet.stake || 0;
          const profit = payout - stake;
          revenue = profit * 0.01; // 1% fee on profit
        }
        return sum + revenue;
      }, 0);
      
      const allTimeRevenueSbets = allTimeBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SBETS') return sum;
        let revenue = 0;
        if (bet.status === 'lost') {
          revenue = bet.betAmount || bet.stake || 0;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const payout = bet.potentialPayout || bet.potentialWin;
          const stake = bet.betAmount || bet.stake || 0;
          const profit = payout - stake;
          revenue = profit * 0.01; // 1% fee on profit
        }
        return sum + revenue;
      }, 0);
      
      const allTimeRevenue = allTimeRevenueSui + (allTimeRevenueSbets * sbetsToSuiRatio);
      
      // Calculate distribution for each currency
      const holderShareSui = weeklyRevenueSui * 0.30;
      const holderShareSbets = weeklyRevenueSbets * 0.30;
      const treasuryShareSui = weeklyRevenueSui * 0.40;
      const treasuryShareSbets = weeklyRevenueSbets * 0.40;
      const profitShareSui = weeklyRevenueSui * 0.30;
      const profitShareSbets = weeklyRevenueSbets * 0.30;
      
      res.json({
        success: true,
        weekStart: startOfWeek.toISOString(),
        weekEnd: endOfWeek.toISOString(),
        // Legacy combined values (SUI equivalent)
        totalRevenue: weeklyRevenue,
        allTimeRevenue: allTimeRevenue,
        // New separate values for SUI and SBETS
        totalRevenueSui: weeklyRevenueSui,
        totalRevenueSbets: weeklyRevenueSbets,
        allTimeRevenueSui: allTimeRevenueSui,
        allTimeRevenueSbets: allTimeRevenueSbets,
        distribution: {
          holders: { 
            percentage: 30, 
            amount: holderShareSui + (holderShareSbets * sbetsToSuiRatio),
            sui: holderShareSui,
            sbets: holderShareSbets
          },
          treasury: { 
            percentage: 40, 
            amount: treasuryShareSui + (treasuryShareSbets * sbetsToSuiRatio),
            sui: treasuryShareSui,
            sbets: treasuryShareSbets
          },
          liquidity: { 
            percentage: 30, 
            amount: profitShareSui + (profitShareSbets * sbetsToSuiRatio),
            sui: profitShareSui,
            sbets: profitShareSbets
          }
        },
        onChainData: {
          treasuryBalance: platformInfo?.treasuryBalanceSui || 0,
          treasuryBalanceSbets: platformInfo?.treasuryBalanceSbets || 0,
          totalBets: platformInfo?.totalBets || 0,
          totalVolume: platformInfo?.totalVolumeSui || 0,
          accruedFees: platformInfo?.accruedFeesSui || 0
        },
        historicalRevenue: await getWeeklyRevenueHistory(),
        lastUpdated: Date.now()
      });
    } catch (error: any) {
      console.error('Error fetching revenue stats:', error);
      res.status(500).json({ message: 'Failed to fetch revenue stats', error: error.message });
    }
  });
  
  // Get user's claimable revenue  
  app.get("/api/revenue/claimable/:walletAddress", async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.params;
      
      if (!walletAddress) {
        return res.status(400).json({ message: 'Wallet address required' });
      }
      
      // Get user's SBETS balance from blockchain (real-time)
      const userBalance = await blockchainBetService.getWalletBalance(walletAddress);
      const userSbets = userBalance.sbets;
      
      // CRITICAL: Get all known holders to calculate fair share
      // User's share = their SBETS / circulating SBETS held by ALL non-platform holders
      const holdersData = await fetchSbetsHolders();
      const totalCirculating = holdersData.circulatingSupply > 0 ? holdersData.circulatingSupply : holdersData.totalSupply;
      const sharePercentage = totalCirculating > 0 ? Math.min((userSbets / totalCirculating) * 100, 100) : 0;
      
      console.log(`[Revenue] User ${walletAddress.slice(0,10)}... has ${userSbets} SBETS = ${sharePercentage.toFixed(4)}% share`);
      
      const settledBets = await getSettledBetsForRevenue();
      
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1);
      startOfWeek.setHours(0, 0, 0, 0);
      
      const weeklyBets = settledBets.filter((bet: any) => {
        const betDate = new Date(bet.placedAt || bet.createdAt || 0);
        return betDate >= startOfWeek;
      });
      
      // Track revenue separately for SUI and SBETS
      // FIXED: Include 'paid_out' status (winners that have been paid)
      const weeklyRevenueSui = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SUI') return sum;
        let revenue = 0;
        if (bet.status === 'lost') {
          revenue = bet.betAmount || bet.stake || 0;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const payout = bet.potentialPayout || bet.potentialWin;
          const stake = bet.betAmount || bet.stake || 0;
          const profit = payout - stake;
          revenue = profit * 0.01; // 1% fee on profit
        }
        return sum + revenue;
      }, 0);
      
      const weeklyRevenueSbets = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SBETS') return sum;
        let revenue = 0;
        if (bet.status === 'lost') {
          revenue = bet.betAmount || bet.stake || 0;
        } else if ((bet.status === 'won' || bet.status === 'paid_out') && (bet.potentialPayout || bet.potentialWin)) {
          const payout = bet.potentialPayout || bet.potentialWin;
          const stake = bet.betAmount || bet.stake || 0;
          const profit = payout - stake;
          revenue = profit * 0.01; // 1% fee on profit
        }
        return sum + revenue;
      }, 0);
      
      // Calculate holder pools for each currency (30% to holders)
      const holderPoolSui = weeklyRevenueSui * REVENUE_SHARE_PERCENTAGE;
      const holderPoolSbets = weeklyRevenueSbets * REVENUE_SHARE_PERCENTAGE;
      
      // Calculate user's share based on their SBETS holdings (capped at 100%)
      const userShareRatio = totalCirculating > 0 ? Math.min(userSbets / totalCirculating, 1.0) : 0;
      const userClaimableSui = holderPoolSui * userShareRatio;
      const userClaimableSbets = holderPoolSbets * userShareRatio;
      
      const userClaims = await getRevenueClaims(walletAddress);
      const thisWeekClaim = userClaims.find(c => c.weekStart >= startOfWeek);
      
      res.json({
        success: true,
        walletAddress,
        sbetsBalance: userSbets,
        sharePercentage: sharePercentage.toFixed(4),
        // Legacy field for backward compatibility (SUI equivalent)
        weeklyRevenuePool: holderPoolSui + (holderPoolSbets * 0.000001 / 1.50),
        claimableAmount: thisWeekClaim ? 0 : userClaimableSui,
        // New separate fields for SUI and SBETS
        weeklyRevenuePoolSui: holderPoolSui,
        weeklyRevenuePoolSbets: holderPoolSbets,
        claimableSui: thisWeekClaim ? 0 : userClaimableSui,
        claimableSbets: thisWeekClaim ? 0 : userClaimableSbets,
        alreadyClaimed: !!thisWeekClaim,
        lastClaimTxHash: thisWeekClaim?.txHash || null,
        claimHistory: userClaims.map(c => ({ 
          amountSui: c.amount, 
          amountSbets: c.amountSbets || 0,
          timestamp: c.timestamp, 
          txHash: c.txHash,
          txHashSbets: c.txHashSbets
        })),
        lastUpdated: Date.now()
      });
    } catch (error: any) {
      console.error('Error fetching claimable revenue:', error);
      res.status(500).json({ message: 'Failed to fetch claimable amount', error: error.message });
    }
  });
  
  // Claim revenue rewards
  app.post("/api/revenue/claim", async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.body;
      
      if (!walletAddress) {
        return res.status(400).json({ message: 'Wallet address required' });
      }
      
      if (!blockchainBetService.isAdminKeyConfigured()) {
        return res.status(400).json({ message: 'Server not configured for payouts' });
      }
      
      const userBalance = await blockchainBetService.getWalletBalance(walletAddress);
      const userSbets = userBalance.sbets;
      
      if (userSbets <= 0) {
        return res.status(400).json({ message: 'You must hold SBETS tokens to claim revenue' });
      }
      
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1);
      startOfWeek.setHours(0, 0, 0, 0);
      
      const userClaims = await getRevenueClaims(walletAddress);
      const thisWeekClaim = userClaims.find(c => c.weekStart >= startOfWeek);
      
      if (thisWeekClaim) {
        return res.status(400).json({ message: 'Already claimed this week', txHash: thisWeekClaim.txHash });
      }
      
      const holdersData = await fetchSbetsHolders();
      const totalCirculating = holdersData.circulatingSupply > 0 ? holdersData.circulatingSupply : holdersData.totalSupply;
      
      const settledBets = await getSettledBetsForRevenue();
      const weeklyBets = settledBets.filter((bet: any) => {
        const betDate = new Date(bet.createdAt || 0);
        return betDate >= startOfWeek;
      });
      
      // Calculate SUI and SBETS revenue separately - pay out in same currency
      const weeklyRevenueSui = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SUI') return sum;
        if (bet.status === 'lost') {
          return sum + (bet.betAmount || 0);
        } else if (bet.status === 'won' && bet.potentialWin) {
          const profit = bet.potentialWin - bet.betAmount;
          return sum + (profit * 0.01);
        }
        return sum;
      }, 0);
      
      const weeklyRevenueSbets = weeklyBets.reduce((sum: number, bet: any) => {
        if (bet.currency !== 'SBETS') return sum;
        if (bet.status === 'lost') {
          return sum + (bet.betAmount || 0);
        } else if (bet.status === 'won' && bet.potentialWin) {
          const profit = bet.potentialWin - bet.betAmount;
          return sum + (profit * 0.01);
        }
        return sum;
      }, 0);
      
      const holderPoolSui = weeklyRevenueSui * REVENUE_SHARE_PERCENTAGE;
      const holderPoolSbets = weeklyRevenueSbets * REVENUE_SHARE_PERCENTAGE;
      const userShareRatio = totalCirculating > 0 ? Math.min(userSbets / totalCirculating, 1.0) : 0;
      const claimSui = holderPoolSui * userShareRatio;
      const claimSbets = holderPoolSbets * userShareRatio;
      
      // Minimum claim threshold to avoid dust transactions (gas would cost more than claim)
      const MIN_CLAIM_SUI = 0.001;
      const MIN_CLAIM_SBETS = 1;
      
      if (claimSui < MIN_CLAIM_SUI && claimSbets < MIN_CLAIM_SBETS) {
        const sharePercent = (userShareRatio * 100).toFixed(6);
        return res.status(400).json({ 
          message: `Your claimable amount is too small (${claimSui.toFixed(6)} SUI + ${claimSbets.toFixed(4)} SBETS). You hold ${sharePercent}% of total SBETS supply. Accumulate more SBETS tokens to increase your share.`,
          claimableSui: claimSui,
          claimableSbets: claimSbets,
          sharePercentage: sharePercent,
          minimumRequired: { sui: MIN_CLAIM_SUI, sbets: MIN_CLAIM_SBETS }
        });
      }
      
      console.log(`[Revenue] Processing claim: ${walletAddress} claiming ${claimSui} SUI + ${claimSbets} SBETS`);
      
      // Execute on-chain payouts for both currencies
      let suiTxHash = null;
      let sbetsTxHash = null;
      
      if (claimSui >= MIN_CLAIM_SUI) {
        const suiPayoutResult = await blockchainBetService.sendSuiToUser(walletAddress, claimSui);
        if (!suiPayoutResult.success) {
          console.error(`[Revenue] SUI claim failed: ${suiPayoutResult.error}`);
          return res.status(400).json({ message: suiPayoutResult.error || 'Failed to send SUI payout' });
        }
        suiTxHash = suiPayoutResult.txHash;
        console.log(`[Revenue] SUI payout successful: ${claimSui} SUI | TX: ${suiTxHash}`);
      }
      
      if (claimSbets >= MIN_CLAIM_SBETS) {
        const sbetsPayoutResult = await blockchainBetService.sendSbetsToUser(walletAddress, claimSbets);
        if (!sbetsPayoutResult.success) {
          console.error(`[Revenue] SBETS claim failed: ${sbetsPayoutResult.error}`);
          if (suiTxHash) {
            console.log(`[Revenue] Partial success: SUI sent but SBETS failed`);
          }
          return res.status(400).json({ message: sbetsPayoutResult.error || 'Failed to send SBETS payout', partialSuccess: !!suiTxHash, suiTxHash });
        }
        sbetsTxHash = sbetsPayoutResult.txHash;
        console.log(`[Revenue] SBETS payout successful: ${claimSbets} SBETS | TX: ${sbetsTxHash}`);
      }
      
      // Save claim to database for persistence across server restarts
      const sharePercentage = totalCirculating > 0 ? Math.min((userSbets / totalCirculating) * 100, 100) : 0;
      const saved = await saveRevenueClaim(walletAddress, startOfWeek, userSbets, sharePercentage, claimSui, claimSbets, suiTxHash || '', sbetsTxHash || null);
      
      if (!saved) {
        console.warn('[Revenue] Failed to persist claim to database - claim may be counted again');
      }
      
      console.log(`[Revenue] Claim successful: ${walletAddress} received ${claimSui} SUI + ${claimSbets} SBETS`);
      
      res.json({
        success: true,
        walletAddress,
        claimedAmount: claimSui, // Legacy field
        claimedSui: claimSui,
        claimedSbets: claimSbets,
        txHash: suiTxHash, // Legacy field
        suiTxHash,
        sbetsTxHash,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error('Error processing claim:', error);
      res.status(500).json({ message: 'Failed to process claim', error: error.message });
    }
  });
  
  // Helper function to fetch SBETS holders
  // Cache for SBETS holders data (refresh every 5 minutes)
  let sbetsHoldersCache: { totalSupply: number; circulatingSupply: number; holders: Array<{ address: string; balance: number; percentage: number }>; lastUpdated: number } | null = null;
  const SBETS_HOLDERS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  // Platform wallets to EXCLUDE from revenue distribution (these are platform-owned, not circulating)
  const PLATFORM_WALLETS = [
    '0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50', // Admin wallet (platform treasury)
  ];
  
  // Known SBETS holder wallets to check for balances
  const KNOWN_SBETS_WALLETS = [
    '0x798e8bb6db3f9c0233ca3521a7b5431af39350b3092144c74be033b468e48426', // Known user
  ];
  
  async function fetchSbetsHolders(): Promise<{ totalSupply: number; circulatingSupply: number; holders: Array<{ address: string; balance: number; percentage: number }> }> {
    // Return cached data if still fresh
    if (sbetsHoldersCache && (Date.now() - sbetsHoldersCache.lastUpdated) < SBETS_HOLDERS_CACHE_TTL) {
      return { totalSupply: sbetsHoldersCache.totalSupply, circulatingSupply: sbetsHoldersCache.circulatingSupply || sbetsHoldersCache.totalSupply, holders: sbetsHoldersCache.holders };
    }
    
    try {
      const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
      const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
      
      const coinType = SBETS_TOKEN_TYPE;
      let totalSupply = 50_000_000_000; // Default 50 BILLION SBETS (actual minted amount)
      
      // Get actual total supply from blockchain - this is what we use for share calculation
      try {
        const supplyInfo = await suiClient.getTotalSupply({ coinType });
        totalSupply = parseInt(supplyInfo.value) / 1e9;
        console.log(`[Revenue] SBETS total supply from chain: ${totalSupply.toLocaleString()}`);
      } catch (e) {
        console.log('[Revenue] Using default SBETS supply: 50B');
      }
      
      const holders: Array<{ address: string; balance: number; percentage: number }> = [];
      let circulatingSupply = 0;
      
      // METHOD 1: Try BlockVision API to get ALL on-chain token holders
      const blockvisionKey = process.env.BLOCKVISION_API_KEY;
      if (blockvisionKey) {
        try {
          console.log('[Revenue] Fetching ALL SBETS holders from BlockVision API...');
          let cursor: string | null = null;
          let page = 0;
          
          do {
            const params = new URLSearchParams({ coinType, limit: '50' });
            if (cursor) params.append('cursor', cursor);
            
            const response = await fetch(
              `https://api.blockvision.org/v2/sui/coin/holders?${params}`,
              { 
                headers: { 
                  'accept': 'application/json',
                  'x-api-key': blockvisionKey 
                } 
              }
            );
            
            if (!response.ok) {
              const errorText = await response.text();
              console.warn(`[Revenue] BlockVision API error: ${response.status} - ${errorText}`);
              // If we hit rate limit but have some holders, keep them
              if (holders.length > 0) {
                console.log(`[Revenue] Rate limited but keeping ${holders.length} holders already fetched`);
              }
              break;
            }
            
            const data = await response.json();
            console.log(`[Revenue] BlockVision response page ${page}: code=${data.code}, total=${data.result?.total || 0}, items=${data.result?.data?.length || 0}`);
            
            // Handle the nested result structure
            const holderData = data.result?.data || data.data || [];
            if (Array.isArray(holderData)) {
              for (const h of holderData) {
                const address = h.account || h.address || h.owner;
                if (!address || PLATFORM_WALLETS.includes(address)) continue;
                
                const balance = parseFloat(h.balance || h.quantity || '0');
                if (balance > 0) {
                  holders.push({ address, balance, percentage: 0 });
                  circulatingSupply += balance;
                }
              }
            }
            
            cursor = data.result?.nextPageCursor || data.nextPageCursor || null;
            page++;
            
            // Safety limit: max 20 pages (1000 holders)
            if (page >= 20) break;
            
            // Add delay between requests to avoid rate limiting (1.5 seconds)
            if (cursor) {
              await new Promise(resolve => setTimeout(resolve, 1500));
            }
            
          } while (cursor);
          
          console.log(`[Revenue] BlockVision: Found ${holders.length} SBETS holders across ${page} pages`);
        } catch (apiError) {
          console.warn('[Revenue] BlockVision API failed, falling back to database:', apiError);
        }
      }
      
      // METHOD 2: Fallback - check wallets from database if BlockVision didn't work
      if (holders.length === 0) {
        console.log('[Revenue] Using fallback: checking database wallets for SBETS balances...');
        
        const uniqueWallets = new Set<string>();
        KNOWN_SBETS_WALLETS.forEach(w => uniqueWallets.add(w));
        
        const allBets = await storage.getAllBets();
        allBets.forEach((bet: any) => {
          if (bet.walletAddress?.startsWith('0x')) uniqueWallets.add(bet.walletAddress);
          if (bet.userId?.startsWith('0x')) uniqueWallets.add(bet.userId);
        });
        
        try {
          const { users } = await import('@shared/schema');
          const { db } = await import('./db');
          const allUsers = await db.select().from(users);
          allUsers.forEach((u: any) => {
            if (u.walletAddress?.startsWith('0x')) uniqueWallets.add(u.walletAddress);
          });
        } catch (e) {}
        
        console.log(`[Revenue] Checking SBETS balance for ${uniqueWallets.size} database wallets`);
        
        for (const wallet of Array.from(uniqueWallets).slice(0, 200)) {
          if (PLATFORM_WALLETS.includes(wallet)) continue;
          
          try {
            const balance = await suiClient.getBalance({ owner: wallet, coinType });
            const sbetsBalance = parseInt(balance.totalBalance) / 1e9;
            if (sbetsBalance > 0) {
              holders.push({ address: wallet, balance: sbetsBalance, percentage: 0 });
              circulatingSupply += sbetsBalance;
            }
          } catch (e) {}
        }
      }
      
      // Calculate percentages based on TOTAL supply (not just known holders)
      for (const holder of holders) {
        holder.percentage = totalSupply > 0 ? (holder.balance / totalSupply) * 100 : 0;
      }
      
      holders.sort((a, b) => b.balance - a.balance);
      
      console.log(`[Revenue] Found ${holders.length} SBETS holders with ${circulatingSupply.toLocaleString()} known SBETS out of ${totalSupply.toLocaleString()} total supply`);
      
      sbetsHoldersCache = { 
        totalSupply,  // ALWAYS use on-chain total supply for share calculation
        circulatingSupply: circulatingSupply > 0 ? circulatingSupply : totalSupply,
        holders, 
        lastUpdated: Date.now() 
      };
      
      return { totalSupply: sbetsHoldersCache.totalSupply, circulatingSupply: sbetsHoldersCache.circulatingSupply, holders };
    } catch (error) {
      console.error('Error fetching SBETS holders:', error);
      return { totalSupply: 50_000_000_000, circulatingSupply: 50_000_000_000, holders: [] };
    }
  }
  
  // Helper function to get weekly revenue history
  async function getWeeklyRevenueHistory(): Promise<Array<{ week: string; revenue: number }>> {
    try {
      const settledBets = await getSettledBetsForRevenue();
      const weeklyData: Map<string, number> = new Map();
      
      // Price conversion: Convert all revenue to SUI equivalent for consistency
      const SUI_PRICE_USD = 1.50;
      const SBETS_PRICE_USD = 0.000001;
      const sbetsToSuiRatio = SBETS_PRICE_USD / SUI_PRICE_USD;
      
      for (const bet of settledBets) {
        const betDate = new Date(bet.createdAt || 0);
        const weekStart = new Date(betDate);
        weekStart.setDate(betDate.getDate() - betDate.getDay() + 1);
        weekStart.setHours(0, 0, 0, 0);
        const weekKey = weekStart.toISOString().split('T')[0];
        
        let revenue = 0;
        if (bet.status === 'lost') {
          revenue = bet.betAmount || 0;
        } else if (bet.status === 'won' && bet.potentialWin) {
          const profit = bet.potentialWin - bet.betAmount;
          revenue = profit * 0.01;
        }
        // Convert SBETS to SUI equivalent
        if (bet.currency === 'SBETS') {
          revenue = revenue * sbetsToSuiRatio;
        }
        
        weeklyData.set(weekKey, (weeklyData.get(weekKey) || 0) + revenue);
      }
      
      return Array.from(weeklyData.entries())
        .map(([week, revenue]) => ({ week, revenue }))
        .sort((a, b) => b.week.localeCompare(a.week))
        .slice(0, 8);
    } catch (error) {
      console.error('Error getting revenue history:', error);
      return [];
    }
  }

  // =====================================================
  // SUINS NAME RESOLUTION ROUTES
  // =====================================================

  app.post('/api/suins/resolve', async (req: Request, res: Response) => {
    try {
      const { addresses } = req.body;
      if (!addresses || !Array.isArray(addresses)) {
        return res.json({ names: {} });
      }
      const limited = addresses.slice(0, 50);
      const { batchResolveSuiNSNames } = await import('./services/suinsService');
      const names = await batchResolveSuiNSNames(limited);
      res.json({ names });
    } catch (error) {
      console.error('[SuiNS] Batch resolve error:', error);
      res.json({ names: {} });
    }
  });

  app.get('/api/suins/resolve', async (req: Request, res: Response) => {
    try {
      const address = req.query.address as string;
      if (!address || !address.startsWith('0x')) {
        return res.json({ name: null });
      }
      const { resolveSuiNSName } = await import('./services/suinsService');
      const name = await resolveSuiNSName(address);
      res.json({ name });
    } catch (error) {
      console.error('[SuiNS] Resolve error:', error);
      res.json({ name: null });
    }
  });

  // =====================================================
  // LEADERBOARD ROUTES
  // =====================================================
  
  app.get('/api/leaderboard', async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as string) || 'weekly';
      const allBets = await storage.getAllBets();
      
      // Calculate date range
      const now = new Date();
      let startDate: Date;
      if (period === 'weekly') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === 'monthly') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        startDate = new Date(0);
      }
      
      // Track SUI and SBETS profits separately per wallet
      const walletStats: Record<string, { 
        suiProfit: number; 
        sbetsProfit: number; 
        suiBets: number;
        sbetsBets: number;
        suiWins: number;
        sbetsWins: number;
        totalBets: number; 
        wins: number;
      }> = {};
      
      for (const bet of allBets) {
        if (!bet.walletAddress && !bet.userId) continue;
        const wallet = bet.walletAddress || String(bet.userId);
        const betDate = new Date(bet.placedAt || bet.createdAt || 0);
        if (betDate < startDate) continue;
        
        if (!walletStats[wallet]) {
          walletStats[wallet] = { 
            suiProfit: 0, sbetsProfit: 0, 
            suiBets: 0, sbetsBets: 0,
            suiWins: 0, sbetsWins: 0,
            totalBets: 0, wins: 0 
          };
        }
        
        const currency = (bet.currency || 'SUI').toUpperCase();
        const isSbets = currency === 'SBETS';
        
        walletStats[wallet].totalBets++;
        if (isSbets) {
          walletStats[wallet].sbetsBets++;
        } else {
          walletStats[wallet].suiBets++;
        }
        
        if (bet.status === 'won' || bet.status === 'paid_out') {
          const payout = bet.payout || bet.potentialWin || 0;
          const profit = payout - (bet.betAmount || 0);
          walletStats[wallet].wins++;
          
          if (isSbets) {
            walletStats[wallet].sbetsProfit += profit;
            walletStats[wallet].sbetsWins++;
          } else {
            walletStats[wallet].suiProfit += profit;
            walletStats[wallet].suiWins++;
          }
        } else if (bet.status === 'lost') {
          if (isSbets) {
            walletStats[wallet].sbetsProfit -= bet.betAmount || 0;
          } else {
            walletStats[wallet].suiProfit -= bet.betAmount || 0;
          }
        }
      }
      
      // Convert SUI and SBETS to USD equivalent for ranking (SUI = $3.50, SBETS = $0.000001)
      const SUI_USD = 3.50;
      const SBETS_USD = 0.000001;
      
      // Convert to array and sort by total USD value profit
      const leaderboardBase = Object.entries(walletStats)
        .filter(([_, stats]) => stats.totalBets >= 1)
        .map(([wallet, stats]) => {
          const totalProfitUsd = (stats.suiProfit * SUI_USD) + (stats.sbetsProfit * SBETS_USD);
          return {
            rank: 0,
            wallet,
            suiProfit: stats.suiProfit,
            sbetsProfit: stats.sbetsProfit,
            totalProfitUsd,
            totalBets: stats.totalBets,
            suiBets: stats.suiBets,
            sbetsBets: stats.sbetsBets,
            winRate: stats.totalBets > 0 ? (stats.wins / stats.totalBets) * 100 : 0
          };
        })
        .sort((a, b) => b.totalProfitUsd - a.totalProfitUsd)
        .slice(0, 50)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      
      // Add loyalty points to leaderboard entries
      const leaderboard = await Promise.all(leaderboardBase.map(async (entry) => {
        try {
          const user = await storage.getUserByWalletAddress(entry.wallet);
          const pts = user?.loyaltyPoints || 0;
          return {
            ...entry,
            loyaltyPoints: pts,
            loyaltyTier: getLoyaltyTier(pts)
          };
        } catch {
          return { ...entry, loyaltyPoints: 0, loyaltyTier: 'Bronze' };
        }
      }));
      
      res.json({ leaderboard });
    } catch (error) {
      console.error('Leaderboard error:', error);
      res.status(500).json({ error: 'Failed to get leaderboard' });
    }
  });

  // =====================================================
  // USER LIMITS ROUTES
  // =====================================================
  
  app.get('/api/user/limits', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const { userLimits } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const [limits] = await db.select().from(userLimits).where(eq(userLimits.walletAddress, wallet));
      
      if (!limits) {
        return res.json({ limits: {
          dailyLimit: null,
          weeklyLimit: null,
          monthlyLimit: null,
          dailySpent: 0,
          weeklySpent: 0,
          monthlySpent: 0,
          sessionReminderMinutes: 60,
          selfExclusionUntil: null
        }});
      }
      
      res.json({ limits });
    } catch (error) {
      console.error('Get limits error:', error);
      res.status(500).json({ error: 'Failed to get limits' });
    }
  });
  
  app.post('/api/user/limits', async (req: Request, res: Response) => {
    try {
      const { wallet, dailyLimit, weeklyLimit, monthlyLimit, sessionReminderMinutes } = req.body;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const { userLimits } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const [existing] = await db.select().from(userLimits).where(eq(userLimits.walletAddress, wallet));
      
      if (existing) {
        await db.update(userLimits)
          .set({
            dailyLimit,
            weeklyLimit,
            monthlyLimit,
            sessionReminderMinutes: sessionReminderMinutes || 60,
            updatedAt: new Date()
          })
          .where(eq(userLimits.walletAddress, wallet));
      } else {
        await db.insert(userLimits).values({
          walletAddress: wallet,
          dailyLimit,
          weeklyLimit,
          monthlyLimit,
          sessionReminderMinutes: sessionReminderMinutes || 60
        });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Set limits error:', error);
      res.status(500).json({ error: 'Failed to set limits' });
    }
  });

  // =====================================================
  // REFERRAL ROUTES
  // =====================================================
  
  // In-memory referral code mapping (code -> wallet)
  const referralCodeMap: Record<string, string> = {};
  
  app.get('/api/referral/code', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const code = wallet.slice(2, 10).toUpperCase();
      referralCodeMap[code] = wallet;
      
      const { referrals } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const userReferrals = await db.select().from(referrals).where(eq(referrals.referrerWallet, wallet));
      const totalReferrals = userReferrals.length;
      const qualifiedReferrals = userReferrals.filter((r: any) => r.status === 'qualified' || r.status === 'rewarded').length;
      const pendingReferrals = userReferrals.filter((r: any) => r.status === 'pending').length;
      const totalEarned = userReferrals.reduce((sum: number, r: any) => sum + (r.rewardAmount || 0), 0);
      
      res.json({ 
        code, 
        link: `https://www.suibets.com/?ref=${code}`,
        totalReferrals,
        qualifiedReferrals,
        pendingReferrals,
        totalEarned
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate referral code' });
    }
  });
  
  app.get('/api/referral/stats', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const { referrals } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq } = await import('drizzle-orm');
      
      const userReferrals = await db.select().from(referrals).where(eq(referrals.referrerWallet, wallet));
      
      const totalReferrals = userReferrals.length;
      const qualifiedReferrals = userReferrals.filter((r: any) => r.status === 'qualified' || r.status === 'rewarded').length;
      const pendingReferrals = userReferrals.filter((r: any) => r.status === 'pending').length;
      const totalEarned = userReferrals.reduce((sum: number, r: any) => sum + (r.rewardAmount || 0), 0);
      
      // $10 bonus for every 100 invites
      const bonusesEarned = Math.floor(totalReferrals / 100);
      const progressToNext = totalReferrals % 100;
      
      res.json({
        totalReferrals,
        qualifiedReferrals,
        pendingReferrals,
        totalEarned,
        bonusesEarned,
        bonusAmount: bonusesEarned * 10,
        progressToNext,
        nextBonusAt: 100 - progressToNext
      });
    } catch (error) {
      console.error('Referral stats error:', error);
      res.status(500).json({ error: 'Failed to get referral stats' });
    }
  });
  
  app.post('/api/referral/track', async (req: Request, res: Response) => {
    try {
      const { referralCode, referredWallet } = req.body;
      if (!referralCode || !referredWallet) {
        return res.status(400).json({ error: 'Referral code and wallet required' });
      }
      
      const { referrals, users } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq, like } = await import('drizzle-orm');
      
      const code = referralCode.toUpperCase();
      
      let referrerWallet = referralCodeMap[code];
      
      if (!referrerWallet) {
        const [existingRef] = await db.select().from(referrals)
          .where(eq(referrals.referralCode, code));
        if (existingRef) {
          referrerWallet = existingRef.referrerWallet;
        }
      }
      
      if (!referrerWallet) {
        const allUsers = await db.select({ walletAddress: users.walletAddress }).from(users);
        for (const u of allUsers) {
          if (u.walletAddress && u.walletAddress.startsWith('0x') && u.walletAddress.slice(2, 10).toUpperCase() === code) {
            referrerWallet = u.walletAddress;
            referralCodeMap[code] = referrerWallet;
            console.log(`[REFERRAL] Resolved code ${code} to wallet ${referrerWallet.slice(0, 10)}... via users table`);
            break;
          }
        }
      }
      
      if (!referrerWallet) {
        console.warn(`[REFERRAL] Could not resolve referral code: ${code}`);
        return res.status(400).json({ error: 'Invalid referral code' });
      }
      
      if (referrerWallet.toLowerCase() === referredWallet.toLowerCase()) {
        return res.json({ success: false, message: 'Cannot refer yourself' });
      }
      
      const [existing] = await db.select().from(referrals)
        .where(eq(referrals.referredWallet, referredWallet));
      
      if (existing) {
        return res.json({ success: false, message: 'Already referred' });
      }
      
      await db.insert(referrals).values({
        referrerWallet,
        referredWallet,
        referralCode: code,
        status: 'pending'
      });
      
      console.log(`[REFERRAL] ✅ Tracked: ${referredWallet.slice(0, 10)}... referred by ${referrerWallet.slice(0, 10)}... (code: ${code})`);
      res.json({ success: true });
    } catch (error) {
      console.error('Track referral error:', error);
      res.status(500).json({ error: 'Failed to track referral' });
    }
  });

  // ==================== FREE BET SYSTEM ====================
  
  // Get free bet status for a wallet
  app.get('/api/free-bet/status', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      let user;
      try {
        user = await storage.getUserByWalletAddress(wallet);
      } catch (dbError: any) {
        // Handle case where free_bet_balance column might not exist (schema sync issue)
        console.warn('Free bet status DB error (may be missing column):', dbError.message);
        return res.json({ 
          freeBetBalance: 0, 
          welcomeBonusClaimed: false,
          welcomeBonusAmount: 1000,
          welcomeBonusCurrency: 'SBETS',
          loyaltyPoints: 0
        });
      }
      
      if (!user) {
        return res.json({ 
          freeBetBalance: 0, 
          welcomeBonusClaimed: false,
          welcomeBonusAmount: 1000, // 1000 SBETS welcome bonus
          welcomeBonusCurrency: 'SBETS',
          loyaltyPoints: 0
        });
      }
      
      const freeBetUsed = user.welcomeBonusClaimed || false;

      res.json({
        freeBetBalance: freeBetUsed ? 0 : (user.freeBetBalance || 0),
        freeBetUsed,
        welcomeBonusClaimed: user.welcomeBonusClaimed || false,
        welcomeBonusAmount: 1000,
        welcomeBonusCurrency: 'SBETS',
        loyaltyPoints: user.loyaltyPoints || 0
      });
    } catch (error) {
      console.error('Free bet status error:', error);
      res.json({ 
        freeBetBalance: 0, 
        freeBetUsed: false,
        welcomeBonusClaimed: false,
        welcomeBonusAmount: 1000,
        welcomeBonusCurrency: 'SBETS',
        loyaltyPoints: 0
      });
    }
  });
  
  // Claim welcome bonus (1000 SBETS - one time only per wallet)
  app.post('/api/free-bet/claim-welcome', async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const { users } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq, sql } = await import('drizzle-orm');
      
      const WELCOME_BONUS_SBETS = 1000;
      
      // Try to check and claim with full schema first
      try {
        const [user] = await db.select().from(users).where(eq(users.walletAddress, walletAddress));
        
        if (!user) {
          return res.status(404).json({ error: 'User not found. Please connect wallet first.' });
        }
        
        if (user.welcomeBonusClaimed) {
          return res.status(400).json({ error: 'Welcome bonus already claimed. Each wallet can only claim once.' });
        }
        
        await db.update(users)
          .set({ 
            freeBetBalance: (user.freeBetBalance || 0) + WELCOME_BONUS_SBETS,
            welcomeBonusClaimed: true
          })
          .where(eq(users.walletAddress, walletAddress));
        
        console.log(`[FREE BET] Welcome bonus claimed: ${walletAddress.slice(0, 10)}... received ${WELCOME_BONUS_SBETS} SBETS (one-time)`);
        
        res.json({ 
          success: true, 
          freeBetBalance: (user.freeBetBalance || 0) + WELCOME_BONUS_SBETS,
          message: `Congratulations! You received ${WELCOME_BONUS_SBETS} SBETS welcome bonus!`
        });
      } catch (dbError: any) {
        // Handle case where columns might not exist (schema mismatch on Railway)
        console.warn('[FREE BET] DB schema issue, trying raw SQL fallback:', dbError.message);
        
        // Fallback: Try raw SQL to check if user exists and add columns if needed
        try {
          // First, try to add the columns if they don't exist
          await db.execute(sql`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS free_bet_balance REAL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS welcome_bonus_claimed BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS loyalty_points REAL DEFAULT 0
          `);
          
          // Now try the claim again
          const [user] = await db.select().from(users).where(eq(users.walletAddress, walletAddress));
          
          if (!user) {
            return res.status(404).json({ error: 'User not found. Please connect wallet first.' });
          }
          
          if (user.welcomeBonusClaimed) {
            return res.status(400).json({ error: 'Welcome bonus already claimed.' });
          }
          
          await db.update(users)
            .set({ 
              freeBetBalance: (user.freeBetBalance || 0) + WELCOME_BONUS_SBETS,
              welcomeBonusClaimed: true
            })
            .where(eq(users.walletAddress, walletAddress));
          
          console.log(`[FREE BET] Welcome bonus claimed (after schema fix): ${walletAddress.slice(0, 10)}...`);
          
          res.json({ 
            success: true, 
            freeBetBalance: WELCOME_BONUS_SBETS,
            message: `Congratulations! You received ${WELCOME_BONUS_SBETS} SBETS welcome bonus!`
          });
        } catch (sqlError: any) {
          console.error('[FREE BET] Raw SQL fallback failed:', sqlError.message);
          return res.status(500).json({ error: 'Database schema issue. Please contact support.' });
        }
      }
    } catch (error) {
      console.error('Claim welcome bonus error:', error);
      res.status(500).json({ error: 'Failed to claim welcome bonus' });
    }
  });

  // ==================== LOYALTY PROGRAM ====================
  
  // Get loyalty status
  app.get('/api/loyalty/status', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const user = await storage.getUserByWalletAddress(wallet);
      const points = user?.loyaltyPoints || 0;
      const totalVolume = user?.totalBetVolume || 0;
      
      // Loyalty tiers based on points
      let tier = 'Bronze';
      let nextTier = 'Silver';
      let pointsToNext = 1000 - points;
      
      if (points >= 10000) {
        tier = 'Diamond';
        nextTier = 'Diamond';
        pointsToNext = 0;
      } else if (points >= 5000) {
        tier = 'Platinum';
        nextTier = 'Diamond';
        pointsToNext = 10000 - points;
      } else if (points >= 2500) {
        tier = 'Gold';
        nextTier = 'Platinum';
        pointsToNext = 5000 - points;
      } else if (points >= 1000) {
        tier = 'Silver';
        nextTier = 'Gold';
        pointsToNext = 2500 - points;
      }
      
      res.json({
        points,
        tier,
        nextTier,
        pointsToNext: Math.max(0, pointsToNext),
        totalVolume,
        perks: getLoyaltyPerks(tier)
      });
    } catch (error) {
      console.error('Loyalty status error:', error);
      res.status(500).json({ error: 'Failed to get loyalty status' });
    }
  });
  
  function getLoyaltyPerks(tier: string): string[] {
    const perks: Record<string, string[]> = {
      'Bronze': ['1 point per $1 wagered', 'Access to promotions'],
      'Silver': ['1.25x points multiplier', 'Priority support', 'Weekly bonuses'],
      'Gold': ['1.5x points multiplier', 'Exclusive promotions', 'Monthly free bets'],
      'Platinum': ['2x points multiplier', 'VIP support', 'Higher betting limits'],
      'Diamond': ['3x points multiplier', 'Personal account manager', 'Exclusive events']
    };
    return perks[tier] || perks['Bronze'];
  }
  
  function getLoyaltyTier(points: number): string {
    if (points >= 10000) return 'Diamond';
    if (points >= 5000) return 'Platinum';
    if (points >= 2500) return 'Gold';
    if (points >= 1000) return 'Silver';
    return 'Bronze';
  }

  // ==================== SBETS STAKING (8% APY from Treasury) ====================
  
  const APY_RATE = 0.08; // 8% APY
  const MIN_STAKE_SBETS = 100000; // 100K SBETS minimum
  const STAKING_PLANS = {
    '1week': { days: 7, apyRate: 0.05, label: '1 Week' },
    '3month': { days: 90, apyRate: 0.08, label: '3 Months' }
  } as const;
  type StakingPlanKey = keyof typeof STAKING_PLANS;

  // AUTOMATED REWARD ACCRUAL WORKER - runs every hour to update accumulated_rewards
  async function accrueStakingRewards() {
    try {
      const { db } = await import('./db');
      const { wurlusStaking } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const activeStakes = await db.select().from(wurlusStaking).where(eq(wurlusStaking.isActive, true));
      if (activeStakes.length === 0) return;

      const now = Date.now();
      let totalAccrued = 0;
      let stakesUpdated = 0;

      for (const stake of activeStakes) {
        const stakeDate = new Date(stake.stakingDate || now);
        const stakedDays = Math.max(0, (now - stakeDate.getTime()) / (1000 * 60 * 60 * 24));
        const principal = stake.amountStaked || 0;
        const stakeApyRate = stake.rewardRate || APY_RATE;
        const dailyRate = stakeApyRate / 365;
        const maxAnnualReward = principal * stakeApyRate;
        const calculatedRewards = principal * dailyRate * stakedDays;
        const newAccumulated = Math.min(calculatedRewards, maxAnnualReward);

        if (Math.floor(newAccumulated) > Math.floor(stake.accumulatedRewards || 0)) {
          await db.update(wurlusStaking)
            .set({ accumulatedRewards: Math.floor(newAccumulated) })
            .where(eq(wurlusStaking.id, stake.id));
          totalAccrued += Math.floor(newAccumulated) - Math.floor(stake.accumulatedRewards || 0);
          stakesUpdated++;
        }
      }

      if (stakesUpdated > 0) {
        console.log(`[STAKING WORKER] Accrued rewards for ${stakesUpdated}/${activeStakes.length} stakes | +${totalAccrued.toLocaleString()} SBETS total`);
      }
    } catch (error) {
      console.error('[STAKING WORKER] Reward accrual error:', error);
    }
  }

  // Run immediately on startup, then every hour
  accrueStakingRewards();
  setInterval(accrueStakingRewards, 60 * 60 * 1000);
  console.log('📈 Staking reward accrual worker started - updates every hour');
  
  // Get staking info
  app.get('/api/staking/info', async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      const { db } = await import('./db');
      const { wurlusStaking } = await import('@shared/schema');
      const { eq, and, sum } = await import('drizzle-orm');
      
      // Get total staked from all active stakes
      const allStakes = await db.select().from(wurlusStaking).where(eq(wurlusStaking.isActive, true));
      const totalStaked = allStakes.reduce((acc, s) => acc + (s.amountStaked || 0), 0);
      
      let userStaked = 0;
      let userRewards = 0;
      let userStakes: any[] = [];
      
      if (wallet) {
        const stakes = await db.select().from(wurlusStaking)
          .where(and(eq(wurlusStaking.walletAddress, wallet), eq(wurlusStaking.isActive, true)));
        
        userStakes = stakes.map(s => {
          const stakeDate = new Date(s.stakingDate || Date.now());
          const stakedDays = Math.max(0, (Date.now() - stakeDate.getTime()) / (1000 * 60 * 60 * 24));
          const stakeApyRate = s.rewardRate || APY_RATE;
          const dailyRate = stakeApyRate / 365;
          const principal = s.amountStaked || 0;
          const maxAnnualReward = principal * stakeApyRate;
          const liveRewards = Math.min(principal * dailyRate * stakedDays, maxAnnualReward);
          const bestRewards = Math.max(liveRewards, s.accumulatedRewards || 0);
          const lockDays = (s.lockedUntil && s.stakingDate) 
            ? Math.round((new Date(s.lockedUntil).getTime() - new Date(s.stakingDate).getTime()) / (1000 * 60 * 60 * 24))
            : 90;
          return {
            id: s.id,
            amount: s.amountStaked,
            stakedAt: s.stakingDate,
            lockedUntil: s.lockedUntil,
            accumulatedRewards: bestRewards,
            dailyEarning: Math.floor(principal * dailyRate),
            stakedDays: Math.floor(stakedDays),
            canUnstake: !s.lockedUntil || new Date(s.lockedUntil) <= new Date(),
            lockDays,
            apyRate: stakeApyRate * 100,
            planLabel: lockDays <= 7 ? '1 Week' : '3 Months'
          };
        });
        
        userStaked = stakes.reduce((acc, s) => acc + (s.amountStaked || 0), 0);
        userRewards = userStakes.reduce((acc, s) => acc + s.accumulatedRewards, 0);
      }
      
      res.json({
        treasuryPool: 50000000000,
        totalStaked,
        apyRate: APY_RATE * 100,
        userStaked,
        userRewards,
        userStakes,
        minStake: MIN_STAKE_SBETS,
        plans: STAKING_PLANS
      });
    } catch (error) {
      console.error('Staking info error:', error);
      res.status(500).json({ error: 'Failed to get staking info' });
    }
  });
  
  // Stake SBETS tokens (requires on-chain transfer first)
  app.post('/api/staking/stake', async (req: Request, res: Response) => {
    try {
      const { walletAddress, amount, txHash, lockPeriod } = req.body;
      if (!walletAddress || !amount) {
        return res.status(400).json({ error: 'Wallet address and amount required' });
      }
      
      if (!txHash) {
        return res.status(400).json({ error: 'Transaction hash required - SBETS must be transferred on-chain first' });
      }
      
      if (lockPeriod && lockPeriod !== '1week' && lockPeriod !== '3month') {
        return res.status(400).json({ error: 'Invalid lock period. Choose "1week" or "3month"' });
      }
      const planKey: StakingPlanKey = (lockPeriod === '1week') ? '1week' : '3month';
      const plan = STAKING_PLANS[planKey];
      
      if (amount < MIN_STAKE_SBETS) {
        return res.status(400).json({ error: `Minimum stake is ${MIN_STAKE_SBETS.toLocaleString()} SBETS` });
      }
      
      // Check user exists
      const user = await storage.getUserByWalletAddress(walletAddress);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const { db } = await import('./db');
      const { wurlusStaking } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      // DUPLICATE TX HASH PREVENTION: Block reuse of same transaction
      const [existingStake] = await db.select().from(wurlusStaking)
        .where(eq(wurlusStaking.txHash, txHash));
      if (existingStake) {
        console.warn(`[STAKING] DUPLICATE TX BLOCKED: ${txHash} already used for stake ID ${existingStake.id}`);
        return res.status(400).json({ error: 'This transaction has already been used for staking' });
      }
      
      // Verify the transaction was successful on-chain and sent to admin wallet (staking treasury)
      const STAKING_WALLET = blockchainBetService.getAdminWallet().toLowerCase();
      try {
        const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
        const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
        
        const txResponse = await suiClient.getTransactionBlock({
          digest: txHash,
          options: { showEffects: true, showBalanceChanges: true }
        });
        
        if (txResponse.effects?.status?.status !== 'success') {
          return res.status(400).json({ error: 'Transaction failed on-chain' });
        }
        
        // Verify SBETS were sent to admin wallet
        const balanceChanges = (txResponse as any).balanceChanges || [];
        const sbetsReceived = balanceChanges.find((bc: any) => 
          bc.owner?.AddressOwner?.toLowerCase() === STAKING_WALLET &&
          bc.coinType?.includes('sbets::SBETS') &&
          BigInt(bc.amount) > 0
        );
        
        if (sbetsReceived) {
          console.log(`[STAKING] ✅ Verified on-chain SBETS transfer to admin wallet: ${txHash}`);
        } else {
          console.warn(`[STAKING] ⚠️ TX ${txHash.slice(0, 12)} SBETS not sent to admin wallet - proceeding anyway`);
        }
      } catch (txError) {
        console.warn('[STAKING] Could not verify tx, proceeding anyway:', txError);
      }
      
      const lockedUntil = new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000);
      
      const [stake] = await db.insert(wurlusStaking).values({
        walletAddress,
        amountStaked: amount,
        stakingDate: new Date(),
        isActive: true,
        txHash,
        lockedUntil,
        rewardRate: plan.apyRate,
        accumulatedRewards: 0
      }).returning();
      
      console.log(`[STAKING] User ${walletAddress.slice(0, 10)}... staked ${amount.toLocaleString()} SBETS (${plan.label}, ${plan.apyRate * 100}% APY, ID: ${stake.id}) - TX: ${txHash.slice(0, 12)}...`);
      
      res.json({ 
        success: true, 
        message: `Successfully staked ${amount.toLocaleString()} SBETS for ${plan.label}`,
        stakeId: stake.id,
        stakedAmount: amount,
        lockedUntil,
        txHash,
        estimatedApy: plan.apyRate * 100,
        plan: planKey
      });
    } catch (error) {
      console.error('Staking error:', error);
      res.status(500).json({ error: 'Failed to stake tokens' });
    }
  });
  
  // In-memory lock to prevent concurrent claim/unstake race conditions
  const stakingLocks = new Set<string>();
  
  // Unstake SBETS tokens
  app.post('/api/staking/unstake', async (req: Request, res: Response) => {
    try {
      const { walletAddress, stakeId } = req.body;
      if (!walletAddress || !stakeId) {
        return res.status(400).json({ error: 'Wallet address and stake ID required' });
      }
      
      // Prevent concurrent unstake for same wallet
      const lockKey = `unstake:${walletAddress}:${stakeId}`;
      if (stakingLocks.has(lockKey)) {
        return res.status(429).json({ error: 'Unstake already in progress, please wait' });
      }
      stakingLocks.add(lockKey);
      
      try {
      const { db } = await import('./db');
      const { wurlusStaking } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      
      // Get the stake - must be active and owned by user
      const [stake] = await db.select().from(wurlusStaking)
        .where(and(
          eq(wurlusStaking.id, stakeId), 
          eq(wurlusStaking.walletAddress, walletAddress),
          eq(wurlusStaking.isActive, true)
        ));
      
      if (!stake) {
        return res.status(404).json({ error: 'Active stake not found or already unstaked' });
      }
      
      // Check lock period strictly
      const now = new Date();
      if (stake.lockedUntil && new Date(stake.lockedUntil) > now) {
        const remainingDays = Math.ceil((new Date(stake.lockedUntil).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return res.status(400).json({ error: `Stake is locked for ${remainingDays} more days` });
      }
      
      const stakeDate = new Date(stake.stakingDate || now);
      const stakedMs = now.getTime() - stakeDate.getTime();
      const stakedDays = Math.max(0, stakedMs / (1000 * 60 * 60 * 24));
      const stakeApyRate = stake.rewardRate || APY_RATE;
      const dailyRate = stakeApyRate / 365;
      const principal = stake.amountStaked || 0;
      
      const maxAnnualReward = principal * stakeApyRate;
      const liveRewards = Math.min(principal * dailyRate * stakedDays, maxAnnualReward);
      const workerAccumulated = stake.accumulatedRewards || 0;
      const totalRewards = Math.max(liveRewards, workerAccumulated);
      
      console.log(`[STAKING] Unstake calculation for ${walletAddress.slice(0, 10)}:`, {
        stakeId,
        principal,
        stakedDays: stakedDays.toFixed(4),
        liveRewards: liveRewards.toFixed(2),
        workerAccumulated: workerAccumulated.toFixed(2),
        totalRewards: totalRewards.toFixed(2),
        maxAnnualReward
      });
      
      // Atomically mark as inactive - double-check isActive to prevent race conditions
      const updateResult = await db.update(wurlusStaking)
        .set({ 
          isActive: false, 
          unstakingDate: now,
          accumulatedRewards: Math.floor(totalRewards)
        })
        .where(and(
          eq(wurlusStaking.id, stakeId),
          eq(wurlusStaking.isActive, true) // Ensures atomicity
        ));
      
      const totalReturn = principal + totalRewards;
      const payoutAmount = Math.floor(totalReturn);
      
      await storage.updateUserBalance(walletAddress, 0, payoutAmount);
      console.log(`[STAKING] ✅ User ${walletAddress.slice(0, 10)}... unstaked ${stake.amountStaked?.toLocaleString()} SBETS + ${Math.floor(totalRewards).toLocaleString()} rewards = ${payoutAmount.toLocaleString()} SBETS - ADDED to DB balance`);
      
      res.json({ 
        success: true, 
        message: `Successfully unstaked ${stake.amountStaked?.toLocaleString()} SBETS`,
        principal: stake.amountStaked,
        rewards: Math.floor(totalRewards),
        total: payoutAmount
      });
      } finally {
        stakingLocks.delete(lockKey);
      }
    } catch (error) {
      const lk = `unstake:${req.body?.walletAddress}:${req.body?.stakeId}`;
      stakingLocks.delete(lk);
      console.error('Unstaking error:', error);
      res.status(500).json({ error: 'Failed to unstake tokens' });
    }
  });
  
  // Claim staking rewards without unstaking
  app.post('/api/staking/claim-rewards', async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      // Prevent concurrent claims for same wallet
      if (stakingLocks.has(walletAddress)) {
        return res.status(429).json({ error: 'Claim already in progress, please wait' });
      }
      stakingLocks.add(walletAddress);
      
      try {
      const { db } = await import('./db');
      const { wurlusStaking } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      
      // Get all active stakes
      const stakes = await db.select().from(wurlusStaking)
        .where(and(eq(wurlusStaking.walletAddress, walletAddress), eq(wurlusStaking.isActive, true)));
      
      if (stakes.length === 0) {
        return res.status(400).json({ error: 'No active stakes found' });
      }
      
      let totalClaimed = 0;
      const claimDetails: { stakeId: number; principal: number; days: number; rewards: number; maxPossible: number }[] = [];
      const claimTimestamp = new Date();
      
      for (const stake of stakes) {
        const stakeDate = new Date(stake.stakingDate || Date.now());
        const stakedMs = claimTimestamp.getTime() - stakeDate.getTime();
        const stakedDays = Math.max(0, stakedMs / (1000 * 60 * 60 * 24));
        const stakeApyRate = stake.rewardRate || APY_RATE;
        const dailyRate = stakeApyRate / 365;
        const principal = stake.amountStaked || 0;
        
        const maxAnnualReward = principal * stakeApyRate;
        const liveRewards = Math.min(principal * dailyRate * stakedDays, maxAnnualReward);
        const workerAccumulated = stake.accumulatedRewards || 0;
        const totalRewards = Math.max(liveRewards, workerAccumulated);
        
        claimDetails.push({
          stakeId: stake.id,
          principal,
          days: stakedDays,
          rewards: totalRewards,
          maxPossible: maxAnnualReward
        });
        
        totalClaimed += totalRewards;
        
        // Reset staking date and rewards atomically
        await db.update(wurlusStaking)
          .set({ 
            accumulatedRewards: 0,
            stakingDate: claimTimestamp
          })
          .where(and(
            eq(wurlusStaking.id, stake.id),
            eq(wurlusStaking.isActive, true)
          ));
      }
      
      console.log(`[STAKING] Claim calculation for ${walletAddress.slice(0, 10)}:`, JSON.stringify(claimDetails));
      
      const claimAmount = Math.floor(totalClaimed);
      
      if (claimAmount <= 0) {
        return res.json({
          success: true,
          message: 'No rewards to claim yet',
          claimedAmount: 0
        });
      }
      
      let txHash = '';
      let onChainSuccess = false;
      
      if (blockchainBetService.isAdminKeyConfigured()) {
        try {
          console.log(`[STAKING] Claim Step 1: Withdrawing ${claimAmount.toLocaleString()} SBETS from treasury...`);
          const withdrawResult = await blockchainBetService.withdrawTreasurySbetsOnChain(claimAmount);
          if (!withdrawResult.success) {
            throw new Error(`Treasury withdrawal failed: ${withdrawResult.error}`);
          }
          console.log(`[STAKING] Claim Step 1 ✅: Treasury withdrawal complete | TX: ${withdrawResult.txHash}`);
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          console.log(`[STAKING] Claim Step 2: Sending ${claimAmount.toLocaleString()} SBETS to user ${walletAddress.slice(0, 10)}...`);
          const payoutResult = await blockchainBetService.sendSbetsToUser(walletAddress, claimAmount);
          if (payoutResult.success && payoutResult.txHash) {
            txHash = payoutResult.txHash;
            onChainSuccess = true;
            console.log(`[STAKING] Claim Step 2 ✅: On-chain rewards payout complete | TX: ${txHash}`);
          } else {
            throw new Error(`Send to user failed: ${payoutResult.error}`);
          }
        } catch (payoutError: any) {
          console.warn('[STAKING] On-chain rewards payout failed, falling back to DB balance:', payoutError.message);
        }
      }
      
      if (!onChainSuccess) {
        await storage.updateUserBalance(walletAddress, 0, claimAmount);
        console.log(`[STAKING] ✅ User ${walletAddress.slice(0, 10)}... claimed ${claimAmount.toLocaleString()} SBETS rewards - ADDED to DB balance (on-chain unavailable)`);
      }
      
      res.json({ 
        success: true, 
        message: `Successfully claimed ${claimAmount.toLocaleString()} SBETS rewards`,
        claimedAmount: claimAmount,
        txHash: txHash || undefined,
        onChain: onChainSuccess
      });
      } finally {
        stakingLocks.delete(walletAddress);
      }
    } catch (error) {
      stakingLocks.delete(req.body?.walletAddress);
      console.error('Claim rewards error:', error);
      res.status(500).json({ error: 'Failed to claim rewards' });
    }
  });

  // ==================== REFERRAL REWARD (1000 SBETS) ====================
  
  // Award referral bonus (called when referred user places first bet)
  app.post('/api/referral/award', async (req: Request, res: Response) => {
    try {
      const { referredWallet } = req.body;
      if (!referredWallet) {
        return res.status(400).json({ error: 'Wallet address required' });
      }
      
      const { referrals } = await import('@shared/schema');
      const { db } = await import('./db');
      const { eq, and } = await import('drizzle-orm');
      
      // Find the referral record
      const [referral] = await db.select().from(referrals)
        .where(eq(referrals.referredWallet, referredWallet));
      
      if (!referral) {
        return res.json({ success: false, message: 'No referral found' });
      }
      
      if (referral.status === 'rewarded') {
        return res.json({ success: false, message: 'Referral already rewarded' });
      }
      
      // Award 1000 SBETS to referrer
      const REFERRAL_REWARD_SBETS = 1000;
      
      // Actually add SBETS to referrer's balance
      await storage.updateUserBalance(referral.referrerWallet, 0, REFERRAL_REWARD_SBETS);
      
      await db.update(referrals)
        .set({ 
          status: 'rewarded',
          rewardAmount: REFERRAL_REWARD_SBETS,
          rewardCurrency: 'SBETS',
          rewardedAt: new Date()
        })
        .where(eq(referrals.id, referral.id));
      
      console.log(`[REFERRAL] ✅ Awarded ${REFERRAL_REWARD_SBETS} SBETS to referrer ${referral.referrerWallet.slice(0, 10)}... - ADDED to balance`);
      
      res.json({ 
        success: true, 
        rewardAmount: REFERRAL_REWARD_SBETS,
        rewardCurrency: 'SBETS',
        referrerWallet: referral.referrerWallet
      });
    } catch (error) {
      console.error('Award referral error:', error);
      res.status(500).json({ error: 'Failed to award referral bonus' });
    }
  });

  // ============================================
  // Social / Network Effect Engine API Routes
  // ============================================

  app.get("/api/social/predictions", async (req: Request, res: Response) => {
    try {
      const { socialPredictions } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      const category = req.query.category as string;
      let query = db.select().from(socialPredictions).orderBy(desc(socialPredictions.createdAt)).limit(50);
      const predictions = await query;
      const filtered = category && category !== 'all' 
        ? predictions.filter(p => p.category === category)
        : predictions;
      res.json(filtered);
    } catch (error) {
      console.error('Social predictions fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch predictions' });
    }
  });

  app.post("/api/social/predictions", async (req: Request, res: Response) => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq, sql } = await import('drizzle-orm');
      const { title, description, category, endDate, wallet, initialAmount, initialSide, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 200) {
        return res.status(400).json({ error: 'Title must be 5-200 characters' });
      }
      if (!endDate) {
        return res.status(400).json({ error: 'End date required' });
      }
      const end = new Date(endDate);
      if (isNaN(end.getTime()) || end <= new Date()) {
        return res.status(400).json({ error: 'End date must be in the future' });
      }
      const maxEnd = new Date();
      maxEnd.setDate(maxEnd.getDate() + 90);
      if (end > maxEnd) {
        return res.status(400).json({ error: 'End date cannot be more than 90 days from now' });
      }
      const VALID_CATEGORIES = ['crypto', 'sports', 'politics', 'entertainment', 'gaming', 'tech', 'other'];
      const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'other';
      const safeTitle = title.trim().slice(0, 200);
      const safeDescription = (description || '').trim().slice(0, 1000);
      const walletLower = wallet.toLowerCase();

      const parsedInitial = initialAmount ? parseFloat(initialAmount) : 0;
      const validSide = initialSide === 'no' ? 'no' : 'yes';

      if (parsedInitial > 0) {
        if (parsedInitial < 100) return res.status(400).json({ error: 'Minimum initial bet is 100 SBETS' });
        if (parsedInitial > 1000000) return res.status(400).json({ error: 'Maximum initial bet is 1,000,000 SBETS' });
        if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
          return res.status(400).json({ error: 'On-chain transaction hash required for initial bet' });
        }
        if (usedTxHashes.has(txHash)) {
          return res.status(400).json({ error: 'Transaction already used' });
        }
        const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, parsedInitial);
        if (!verification.verified) {
          return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
        }
        usedTxHashes.add(txHash);
      }

      const [prediction] = await db.insert(socialPredictions).values({
        creatorWallet: walletLower,
        title: safeTitle,
        description: safeDescription,
        category: safeCategory,
        endDate: end,
        status: 'active',
        totalYesAmount: 0,
        totalNoAmount: 0,
        totalParticipants: 0
      }).returning();

      if (parsedInitial > 0) {
        try {
          await db.insert(socialPredictionBets).values({
            predictionId: prediction.id,
            wallet: walletLower,
            side: validSide,
            amount: parsedInitial,
            currency: 'SBETS',
            txId: txHash
          });
          const yesIncrement = validSide === 'yes' ? parsedInitial : 0;
          const noIncrement = validSide === 'no' ? parsedInitial : 0;
          await db.update(socialPredictions)
            .set({
              totalYesAmount: sql`COALESCE(${socialPredictions.totalYesAmount}, 0) + ${yesIncrement}`,
              totalNoAmount: sql`COALESCE(${socialPredictions.totalNoAmount}, 0) + ${noIncrement}`,
              totalParticipants: sql`COALESCE(${socialPredictions.totalParticipants}, 0) + 1`
            })
            .where(eq(socialPredictions.id, prediction.id));
          console.log(`[Social] Prediction created WITH initial bet: #${prediction.id} "${safeTitle}" by ${walletLower.slice(0,10)}... | ${parsedInitial} SBETS on ${validSide.toUpperCase()} | TX: ${txHash} | VERIFIED`);
        } catch (betErr: any) {
          console.error(`[Social] Initial bet insert failed for prediction #${prediction.id}:`, betErr.message);
        }
      } else {
        console.log(`[Social] Prediction created: #${prediction.id} "${safeTitle}" by ${walletLower.slice(0,10)}... | Ends: ${end.toISOString()}`);
      }

      const [finalPrediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, prediction.id));
      res.json(finalPrediction || prediction);
    } catch (error) {
      console.error('Create prediction error:', error);
      res.status(500).json({ error: 'Failed to create prediction' });
    }
  });

  app.get("/api/social/treasury-wallet", async (_req: Request, res: Response) => {
    res.json({ wallet: blockchainBetService.getAdminWallet() });
  });

  const socialBetRateLimits = new Map<string, { count: number; resetAt: number }>();
  const SOCIAL_BET_LIMIT = 20;
  const SOCIAL_BET_WINDOW = 60 * 60 * 1000;
  const usedTxHashes = new Set<string>();

  app.post("/api/social/predictions/:id/bet", async (req: Request, res: Response) => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq, sql } = await import('drizzle-orm');
      const predictionId = parseInt(req.params.id);
      if (isNaN(predictionId) || predictionId <= 0) {
        return res.status(400).json({ error: 'Invalid prediction ID' });
      }
      const { wallet, side, amount, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!side || !['yes', 'no'].includes(side)) {
        return res.status(400).json({ error: 'Side must be "yes" or "no"' });
      }
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount < 100 || parsedAmount > 10000) {
        return res.status(400).json({ error: 'Amount must be between 100 and 10,000 SBETS' });
      }
      const VALID_AMOUNTS = [100, 500, 1000, 5000, 10000];
      if (!VALID_AMOUNTS.includes(parsedAmount)) {
        return res.status(400).json({ error: 'Amount must be 100, 500, 1000, 5000, or 10000 SBETS' });
      }
      if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
        return res.status(400).json({ error: 'On-chain transaction hash required. Send SBETS to treasury first.' });
      }
      if (usedTxHashes.has(txHash)) {
        return res.status(400).json({ error: 'Transaction already used for a bet - each bet requires a new transaction' });
      }
      const walletLower = wallet.toLowerCase();
      const now = Date.now();
      const rateKey = walletLower;
      const rateData = socialBetRateLimits.get(rateKey);
      if (rateData && rateData.resetAt > now) {
        if (rateData.count >= SOCIAL_BET_LIMIT) {
          return res.status(429).json({ error: `Rate limit: max ${SOCIAL_BET_LIMIT} prediction bets per hour` });
        }
        rateData.count++;
      } else {
        socialBetRateLimits.set(rateKey, { count: 1, resetAt: now + SOCIAL_BET_WINDOW });
      }
      const [prediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, predictionId));
      if (!prediction) {
        return res.status(404).json({ error: 'Prediction not found' });
      }
      if (prediction.status !== 'active') {
        return res.status(400).json({ error: 'Prediction is no longer active' });
      }
      if (prediction.endDate && new Date(prediction.endDate) < new Date()) {
        return res.status(400).json({ error: 'Prediction has expired - betting is closed' });
      }
      if (walletLower === prediction.creatorWallet?.toLowerCase()) {
        return res.status(403).json({ error: 'Creator cannot bet on their own prediction' });
      }
      const existingBet = await db.select().from(socialPredictionBets).where(eq(socialPredictionBets.txId, txHash));
      if (existingBet.length > 0) {
        return res.status(400).json({ error: 'Transaction already used for a bet' });
      }
      const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, parsedAmount);
      if (!verification.verified) {
        console.error(`[Social] On-chain verification FAILED for bet: ${verification.error} | TX: ${txHash} | Wallet: ${walletLower.slice(0,10)}...`);
        return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
      }
      usedTxHashes.add(txHash);
      const [bet] = await db.insert(socialPredictionBets).values({
        predictionId,
        wallet: walletLower,
        side,
        amount: parsedAmount,
        currency: 'SBETS',
        txId: txHash
      }).returning();
      const yesInc = side === 'yes' ? parsedAmount : 0;
      const noInc = side === 'no' ? parsedAmount : 0;
      await db.update(socialPredictions)
        .set({
          totalYesAmount: sql`COALESCE(${socialPredictions.totalYesAmount}, 0) + ${yesInc}`,
          totalNoAmount: sql`COALESCE(${socialPredictions.totalNoAmount}, 0) + ${noInc}`,
          totalParticipants: sql`COALESCE(${socialPredictions.totalParticipants}, 0) + 1`
        })
        .where(eq(socialPredictions.id, predictionId));
      console.log(`[Social] ON-CHAIN prediction bet: ${walletLower.slice(0,10)}... | ${side.toUpperCase()} ${parsedAmount} SBETS on #${predictionId} | TX: ${txHash} | VERIFIED`);
      res.json({ success: true, txId: txHash, betId: bet.id, verified: true });
    } catch (error) {
      console.error('Prediction bet error:', error);
      res.status(500).json({ error: 'Failed to place prediction bet' });
    }
  });

  app.get("/api/social/challenges", async (req: Request, res: Response) => {
    try {
      const { socialChallenges } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      const challenges = await db.select().from(socialChallenges).orderBy(desc(socialChallenges.createdAt)).limit(50);
      res.json(challenges);
    } catch (error) {
      console.error('Social challenges fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch challenges' });
    }
  });

  app.post("/api/social/challenges", async (req: Request, res: Response) => {
    try {
      const { socialChallenges } = await import('@shared/schema');
      const { title, description, stakeAmount, maxParticipants, expiresAt, wallet, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 200) {
        return res.status(400).json({ error: 'Title must be 5-200 characters' });
      }
      const parsedStake = parseFloat(stakeAmount);
      if (isNaN(parsedStake) || parsedStake < 100 || parsedStake > 10000) {
        return res.status(400).json({ error: 'Stake must be between 100 and 10,000 SBETS' });
      }
      if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
        return res.status(400).json({ error: 'On-chain transaction hash required. Send SBETS stake to treasury first.' });
      }
      if (usedTxHashes.has(txHash)) {
        return res.status(400).json({ error: 'Transaction already used - each challenge requires a new transaction' });
      }
      if (!expiresAt) {
        return res.status(400).json({ error: 'Expiry date required' });
      }
      const expiry = new Date(expiresAt);
      if (isNaN(expiry.getTime()) || expiry <= new Date()) {
        return res.status(400).json({ error: 'Expiry must be in the future' });
      }
      const maxExpiry = new Date();
      maxExpiry.setDate(maxExpiry.getDate() + 30);
      if (expiry > maxExpiry) {
        return res.status(400).json({ error: 'Expiry cannot be more than 30 days from now' });
      }
      const walletLower = wallet.toLowerCase();
      const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, parsedStake);
      if (!verification.verified) {
        console.error(`[Social] Challenge creation verification FAILED: ${verification.error} | TX: ${txHash}`);
        return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
      }
      usedTxHashes.add(txHash);
      const safeParts = Math.min(Math.max(parseInt(maxParticipants) || 10, 2), 100);
      const [challenge] = await db.insert(socialChallenges).values({
        creatorWallet: walletLower,
        title: title.trim().slice(0, 200),
        description: (description || '').trim().slice(0, 1000),
        stakeAmount: parsedStake,
        currency: 'SBETS',
        maxParticipants: safeParts,
        currentParticipants: 1,
        status: 'open',
        expiresAt: expiry
      }).returning();
      console.log(`[Social] ON-CHAIN challenge created: #${challenge.id} "${title.trim().slice(0,50)}" by ${walletLower.slice(0,10)}... | Stake: ${parsedStake} SBETS | TX: ${txHash} | VERIFIED`);
      res.json(challenge);
    } catch (error: any) {
      console.error('Create challenge error:', error?.message || error);
      res.status(500).json({ error: error?.message?.includes('verify') || error?.message?.includes('Sui') 
        ? 'Blockchain verification failed - please try again' 
        : 'Failed to create challenge' });
    }
  });

  app.post("/api/social/challenges/:id/join", async (req: Request, res: Response) => {
    try {
      const { socialChallenges, socialChallengeParticipants } = await import('@shared/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      const challengeId = parseInt(req.params.id);
      if (isNaN(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: 'Invalid challenge ID' });
      }
      const { wallet, side, txHash } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (side && !['for', 'against'].includes(side)) {
        return res.status(400).json({ error: 'Side must be "for" or "against"' });
      }
      const walletLower = wallet.toLowerCase();
      const [challenge] = await db.select().from(socialChallenges).where(eq(socialChallenges.id, challengeId));
      if (!challenge || challenge.status !== 'open') {
        return res.status(400).json({ error: 'Challenge not found or not open' });
      }
      if (walletLower === challenge.creatorWallet?.toLowerCase()) {
        return res.status(400).json({ error: 'Cannot join your own challenge' });
      }
      if ((challenge.currentParticipants || 0) >= (challenge.maxParticipants || 10)) {
        return res.status(400).json({ error: 'Challenge is full' });
      }
      if (challenge.expiresAt && new Date(challenge.expiresAt) < new Date()) {
        return res.status(400).json({ error: 'Challenge has expired' });
      }
      const existingParticipant = await db.select().from(socialChallengeParticipants).where(
        and(
          eq(socialChallengeParticipants.challengeId, challengeId),
          eq(socialChallengeParticipants.wallet, walletLower)
        )
      );
      if (existingParticipant.length > 0) {
        return res.status(400).json({ error: 'You have already joined this challenge' });
      }
      if (!txHash || typeof txHash !== 'string' || txHash.length < 20) {
        return res.status(400).json({ error: 'On-chain transaction hash required. Send SBETS stake to treasury first.' });
      }
      if (usedTxHashes.has(txHash)) {
        return res.status(400).json({ error: 'Transaction already used - each join requires a new transaction' });
      }
      const existingTx = await db.select().from(socialChallengeParticipants).where(eq(socialChallengeParticipants.txHash, txHash));
      if (existingTx.length > 0) {
        return res.status(400).json({ error: 'Transaction already used for a challenge join' });
      }
      const stakeAmount = challenge.stakeAmount || 0;
      if (stakeAmount <= 0) {
        return res.status(400).json({ error: 'Challenge has invalid stake amount' });
      }
      const verification = await blockchainBetService.verifySbetsTransfer(txHash, walletLower, stakeAmount);
      if (!verification.verified) {
        console.error(`[Social] Challenge join verification FAILED: ${verification.error} | TX: ${txHash}`);
        return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
      }
      usedTxHashes.add(txHash);
      await db.insert(socialChallengeParticipants).values({
        challengeId,
        wallet: walletLower,
        side: side || 'against',
        txHash
      });
      await db.update(socialChallenges)
        .set({ currentParticipants: sql`COALESCE(${socialChallenges.currentParticipants}, 0) + 1` })
        .where(eq(socialChallenges.id, challengeId));
      console.log(`[Social] ON-CHAIN challenge join: ${walletLower.slice(0,10)}... joined #${challengeId} | Stake: ${stakeAmount} SBETS | TX: ${txHash} | VERIFIED`);
      res.json({ success: true, verified: true });
    } catch (error) {
      console.error('Join challenge error:', error);
      res.status(500).json({ error: 'Failed to join challenge' });
    }
  });

  app.post("/api/social/follow", async (req: Request, res: Response) => {
    try {
      const { socialFollows } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { followerWallet, followingWallet } = req.body;
      if (!followerWallet || !followingWallet) {
        return res.status(400).json({ error: 'Both wallets required' });
      }
      if (followerWallet.toLowerCase() === followingWallet.toLowerCase()) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
      }
      const existing = await db.select().from(socialFollows).where(
        and(
          eq(socialFollows.followerWallet, followerWallet.toLowerCase()),
          eq(socialFollows.followingWallet, followingWallet.toLowerCase())
        )
      );
      if (existing.length > 0) {
        await db.delete(socialFollows).where(
          and(
            eq(socialFollows.followerWallet, followerWallet.toLowerCase()),
            eq(socialFollows.followingWallet, followingWallet.toLowerCase())
          )
        );
        return res.json({ success: true, action: 'unfollowed' });
      }
      await db.insert(socialFollows).values({
        followerWallet: followerWallet.toLowerCase(),
        followingWallet: followingWallet.toLowerCase()
      });
      res.json({ success: true, action: 'followed' });
    } catch (error) {
      console.error('Follow error:', error);
      res.status(500).json({ error: 'Failed to follow/unfollow' });
    }
  });

  app.get("/api/social/following", async (req: Request, res: Response) => {
    try {
      const { socialFollows } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const wallet = req.query.wallet as string;
      if (!wallet) return res.json([]);
      const follows = await db.select().from(socialFollows).where(
        eq(socialFollows.followerWallet, wallet.toLowerCase())
      );
      res.json(follows.map(f => f.followingWallet));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch following list' });
    }
  });

  app.get("/api/social/followers-count/:wallet", async (req: Request, res: Response) => {
    try {
      const { socialFollows } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const wallet = req.params.wallet.toLowerCase();
      const followers = await db.select().from(socialFollows).where(
        eq(socialFollows.followingWallet, wallet)
      );
      const following = await db.select().from(socialFollows).where(
        eq(socialFollows.followerWallet, wallet)
      );
      res.json({ followers: followers.length, following: following.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch follower counts' });
    }
  });

  app.get("/api/social/profile/:wallet", async (req: Request, res: Response) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const userBets = await storage.getUserBets(wallet);
      const totalBets = userBets.length;
      const wonBets = userBets.filter(b => b.status === 'won' || b.status === 'paid_out');
      const lostBets = userBets.filter(b => b.status === 'lost');
      const settledBets = wonBets.length + lostBets.length;
      const winRate = settledBets > 0 ? (wonBets.length / settledBets) * 100 : 0;
      const totalStaked = userBets.reduce((sum, b) => sum + (b.stake || b.betAmount || 0), 0);
      const totalWinnings = wonBets.reduce((sum, b) => sum + (b.potentialPayout || 0), 0);
      const totalLost = lostBets.reduce((sum, b) => sum + (b.stake || b.betAmount || 0), 0);
      const profit = totalWinnings - totalStaked;
      const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
      const biggestWin = wonBets.length > 0 
        ? Math.max(...wonBets.map(b => (b.potentialPayout || 0) - (b.stake || b.betAmount || 0)))
        : 0;
      const sportCounts: Record<string, number> = {};
      userBets.forEach(b => {
        const sid = b.sportId?.toString() || 'unknown';
        sportCounts[sid] = (sportCounts[sid] || 0) + 1;
      });
      const favoriteSport = Object.entries(sportCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const recentBets = userBets
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 10)
        .map(b => ({
          id: b.id,
          event: b.eventName || b.externalEventId || 'Unknown',
          prediction: b.prediction,
          odds: b.odds,
          stake: b.stake || b.betAmount,
          status: b.status,
          potentialPayout: b.potentialPayout,
          createdAt: b.createdAt
        }));
      const { socialFollows } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const followers = await db.select().from(socialFollows).where(eq(socialFollows.followingWallet, wallet));
      const following = await db.select().from(socialFollows).where(eq(socialFollows.followerWallet, wallet));

      res.json({
        wallet,
        totalBets,
        winRate: Math.round(winRate * 10) / 10,
        roi: Math.round(roi * 10) / 10,
        profit: Math.round(profit * 1000) / 1000,
        biggestWin: Math.round(biggestWin * 1000) / 1000,
        totalStaked: Math.round(totalStaked * 1000) / 1000,
        favoriteSport,
        followers: followers.length,
        following: following.length,
        recentBets
      });
    } catch (error) {
      console.error('Social profile error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  app.post("/api/social/predictions/:id/resolve", async (req: Request, res: Response) => {
    try {
      const { socialPredictions, socialPredictionBets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const predictionId = parseInt(req.params.id);
      if (isNaN(predictionId) || predictionId <= 0) {
        return res.status(400).json({ error: 'Invalid prediction ID' });
      }
      const { resolverWallet } = req.body;
      if (!resolverWallet || typeof resolverWallet !== 'string' || !resolverWallet.startsWith('0x')) {
        return res.status(400).json({ error: 'Valid wallet required' });
      }
      if (resolvingPredictions.has(predictionId)) {
        return res.status(409).json({ error: 'Prediction is already being resolved' });
      }
      resolvingPredictions.add(predictionId);
      try {
        const [prediction] = await db.select().from(socialPredictions).where(eq(socialPredictions.id, predictionId));
        if (!prediction) {
          return res.status(404).json({ error: 'Prediction not found' });
        }
        if (prediction.status !== 'active') {
          return res.status(400).json({ error: 'Prediction is not active - may already be resolved' });
        }
        if (prediction.endDate && new Date(prediction.endDate) > new Date()) {
          return res.status(400).json({ error: 'Cannot resolve before end date' });
        }
        const allBets = await db.select().from(socialPredictionBets).where(eq(socialPredictionBets.predictionId, predictionId));
        const yesTotal = allBets.filter(b => b.side === 'yes').reduce((sum, b) => sum + (b.amount || 0), 0);
        const noTotal = allBets.filter(b => b.side === 'no').reduce((sum, b) => sum + (b.amount || 0), 0);
        const totalPool = yesTotal + noTotal;
        const resolution = yesTotal >= noTotal ? 'yes' : 'no';
        const winners = allBets.filter(b => b.side === resolution);
        const losers = allBets.filter(b => b.side !== resolution);
        const winnersTotal = winners.reduce((sum, b) => sum + (b.amount || 0), 0);
        const newStatus = resolution === 'yes' ? 'resolved_yes' : 'resolved_no';
        if (totalPool === 0 || winners.length === 0) {
          await db.update(socialPredictions)
            .set({ status: newStatus, resolvedOutcome: resolution, resolvedAt: new Date() })
            .where(eq(socialPredictions.id, predictionId));
          console.log(`[Social] Prediction #${predictionId} resolved ${resolution.toUpperCase()} (majority) - no winners to pay (pool: ${totalPool} SBETS)`);
          return res.json({
            success: true,
            resolution: newStatus,
            totalPool,
            winnersCount: 0,
            losersCount: losers.length,
            winningSide: resolution,
            yesTotal,
            noTotal,
            payouts: [],
            payoutStatus: winners.length === 0 ? 'no_winners' : 'empty_pool'
          });
        }
        const payouts = winners.map(w => ({
          wallet: w.wallet,
          betAmount: w.amount,
          payout: winnersTotal > 0 ? ((w.amount || 0) / winnersTotal) * totalPool : 0
        }));
        console.log(`[Social] Prediction #${predictionId} resolving by majority: YES=${yesTotal} vs NO=${noTotal} → ${resolution.toUpperCase()} wins | Pool: ${totalPool} SBETS | Winners: ${winners.length}`);
        const payoutResults: { wallet: string; amount: number; txHash?: string; error?: string }[] = [];
        for (let i = 0; i < payouts.length; i++) {
          const payout = payouts[i];
          if (payout.payout <= 0) continue;
          if (i > 0) await new Promise(r => setTimeout(r, 3000));
          try {
            const result = await blockchainBetService.sendSbetsToUser(payout.wallet, payout.payout);
            if (result.success) {
              console.log(`[Social] Payout sent: ${payout.payout.toFixed(0)} SBETS -> ${payout.wallet.slice(0,10)}... | TX: ${result.txHash}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, txHash: result.txHash });
            } else {
              console.error(`[Social] Payout failed for ${payout.wallet.slice(0,10)}...: ${result.error}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: result.error });
            }
          } catch (payoutError: any) {
            console.error(`[Social] Payout error for ${payout.wallet.slice(0,10)}...:`, payoutError.message);
            payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: payoutError.message });
          }
        }
        const successfulPayouts = payoutResults.filter(p => p.txHash);
        const failedPayouts = payoutResults.filter(p => p.error);
        const finalStatus = failedPayouts.length === 0 ? newStatus : (successfulPayouts.length > 0 ? `${newStatus}_partial` : `${newStatus}_failed`);
        await db.update(socialPredictions)
          .set({ status: finalStatus, resolvedOutcome: resolution, resolvedAt: new Date() })
          .where(eq(socialPredictions.id, predictionId));
        console.log(`[Social] Settlement complete: ${successfulPayouts.length}/${payoutResults.length} payouts successful | Status: ${finalStatus}`);
        res.json({
          success: true,
          resolution: finalStatus,
          totalPool,
          winnersCount: winners.length,
          losersCount: losers.length,
          winningSide: resolution,
          yesTotal,
          noTotal,
          payouts,
          payoutResults: {
            successful: successfulPayouts.length,
            failed: failedPayouts.length,
            details: payoutResults
          }
        });
      } finally {
        resolvingPredictions.delete(predictionId);
      }
    } catch (error) {
      console.error('Resolve prediction error:', error);
      const pid = parseInt(req.params.id);
      if (!isNaN(pid)) resolvingPredictions.delete(pid);
      res.status(500).json({ error: 'Failed to resolve prediction' });
    }
  });

  app.post("/api/social/challenges/:id/settle", async (req: Request, res: Response) => {
    try {
      const { socialChallenges, socialChallengeParticipants } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const challengeId = parseInt(req.params.id);
      if (isNaN(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: 'Invalid challenge ID' });
      }
      const { winner, settlerWallet } = req.body;
      if (!winner || !['creator', 'challengers'].includes(winner)) {
        return res.status(400).json({ error: 'Winner must be "creator" or "challengers"' });
      }
      if (!settlerWallet || typeof settlerWallet !== 'string' || !settlerWallet.startsWith('0x')) {
        return res.status(400).json({ error: 'Valid settler wallet required' });
      }
      if (settlingChallenges.has(challengeId)) {
        return res.status(409).json({ error: 'Challenge is already being settled' });
      }
      settlingChallenges.add(challengeId);
      try {
        const [challenge] = await db.select().from(socialChallenges).where(eq(socialChallenges.id, challengeId));
        if (!challenge) {
          return res.status(404).json({ error: 'Challenge not found' });
        }
        if (challenge.status !== 'open') {
          return res.status(400).json({ error: 'Challenge is not open - may already be settled' });
        }
        if (settlerWallet.toLowerCase() !== challenge.creatorWallet?.toLowerCase()) {
          return res.status(403).json({ error: 'Only the creator can settle this challenge' });
        }
        if (challenge.expiresAt && new Date(challenge.expiresAt) > new Date()) {
          return res.status(400).json({ error: 'Cannot settle before expiry date' });
        }
        const participants = await db.select().from(socialChallengeParticipants).where(eq(socialChallengeParticipants.challengeId, challengeId));
        const totalPool = (challenge.stakeAmount || 0) * ((challenge.currentParticipants || 1));
        let payouts: { wallet: string; payout: number }[] = [];
        if (winner === 'creator') {
          const forParticipants = participants.filter(p => p.side === 'for');
          const winnerCount = 1 + forParticipants.length;
          const perPerson = totalPool / winnerCount;
          payouts = [
            { wallet: challenge.creatorWallet!, payout: perPerson },
            ...forParticipants.map(p => ({ wallet: p.wallet, payout: perPerson }))
          ];
        } else {
          const challengers = participants.filter(p => p.side === 'against');
          if (challengers.length === 0) {
            return res.status(400).json({ error: 'No challengers to pay - cannot settle as challengers win' });
          }
          const perPerson = totalPool / challengers.length;
          payouts = challengers.map(p => ({ wallet: p.wallet, payout: perPerson }));
        }
        console.log(`[Social] Challenge #${challengeId} settling: ${winner} wins | Pool: ${totalPool} SBETS | Payouts: ${payouts.length}`);
        const payoutResults: { wallet: string; amount: number; txHash?: string; error?: string }[] = [];
        for (let i = 0; i < payouts.length; i++) {
          const payout = payouts[i];
          if (payout.payout <= 0) continue;
          if (i > 0) await new Promise(r => setTimeout(r, 3000));
          try {
            const result = await blockchainBetService.sendSbetsToUser(payout.wallet, payout.payout);
            if (result.success) {
              console.log(`[Social] Challenge payout: ${payout.payout.toFixed(0)} SBETS -> ${payout.wallet.slice(0,10)}... | TX: ${result.txHash}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, txHash: result.txHash });
            } else {
              console.error(`[Social] Challenge payout failed: ${payout.wallet.slice(0,10)}... | ${result.error}`);
              payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: result.error });
            }
          } catch (payoutError: any) {
            console.error(`[Social] Challenge payout error: ${payout.wallet.slice(0,10)}... | ${payoutError.message}`);
            payoutResults.push({ wallet: payout.wallet, amount: payout.payout, error: payoutError.message });
          }
        }
        const successfulPayouts = payoutResults.filter(p => p.txHash);
        const failedPayouts = payoutResults.filter(p => p.error);
        const finalStatus = failedPayouts.length === 0 ? 'settled' : (successfulPayouts.length > 0 ? 'settled_partial' : 'settled_failed');
        await db.update(socialChallenges)
          .set({ status: finalStatus })
          .where(eq(socialChallenges.id, challengeId));
        console.log(`[Social] Challenge settlement complete: ${successfulPayouts.length}/${payoutResults.length} payouts successful | Status: ${finalStatus}`);
        res.json({
          success: true,
          winner,
          totalPool,
          payouts,
          payoutResults: {
            successful: successfulPayouts.length,
            failed: failedPayouts.length,
            details: payoutResults
          }
        });
      } finally {
        settlingChallenges.delete(challengeId);
      }
    } catch (error) {
      console.error('Settle challenge error:', error);
      const cid = parseInt(req.params.id);
      if (!isNaN(cid)) settlingChallenges.delete(cid);
      res.status(500).json({ error: 'Failed to settle challenge' });
    }
  });

  app.get("/api/social/chat", async (req: Request, res: Response) => {
    try {
      const { socialChatMessages } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      const messages = await db.select().from(socialChatMessages).orderBy(desc(socialChatMessages.createdAt)).limit(100);
      res.json(messages.reverse());
    } catch (error) {
      console.error('Chat fetch error:', error);
      res.json([]);
    }
  });

  const chatRateLimits = new Map<string, { count: number; resetAt: number }>();
  const CHAT_LIMIT = 30;
  const CHAT_WINDOW = 60 * 1000;

  app.post("/api/social/chat", async (req: Request, res: Response) => {
    try {
      const { socialChatMessages } = await import('@shared/schema');
      const { wallet, message } = req.body;
      if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('0x') || wallet.length < 10) {
        return res.status(400).json({ error: 'Valid wallet address required' });
      }
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message required' });
      }
      const trimmed = message.trim().slice(0, 500);
      if (!trimmed || trimmed.length < 1) {
        return res.status(400).json({ error: 'Message cannot be empty' });
      }
      const walletLower = wallet.toLowerCase();
      const now = Date.now();
      const rateData = chatRateLimits.get(walletLower);
      if (rateData && rateData.resetAt > now) {
        if (rateData.count >= CHAT_LIMIT) {
          return res.status(429).json({ error: 'Slow down - max 30 messages per minute' });
        }
        rateData.count++;
      } else {
        chatRateLimits.set(walletLower, { count: 1, resetAt: now + CHAT_WINDOW });
      }
      const [chatMsg] = await db.insert(socialChatMessages).values({
        wallet: walletLower,
        message: trimmed
      }).returning();
      res.json(chatMsg);
    } catch (error) {
      console.error('Chat send error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  app.get("/api/social/predictions/bets", async (req: Request, res: Response) => {
    try {
      const { socialPredictionBets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const wallet = (req.query.wallet as string || '').toLowerCase();
      if (!wallet) return res.json([]);
      const bets = await db.select().from(socialPredictionBets).where(
        eq(socialPredictionBets.wallet, wallet)
      );
      res.json(bets);
    } catch (error) {
      res.json([]);
    }
  });

  // ==========================================
  // STREAMING API PROXY (streamed.pk)
  // ==========================================
  
  app.get("/api/streaming/football", async (_req: Request, res: Response) => {
    try {
      const response = await fetch("https://streamed.pk/api/matches/football");
      if (!response.ok) throw new Error(`Streaming API error: ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Streaming] Football matches error:", error.message);
      res.json([]);
    }
  });

  app.get("/api/streaming/live", async (_req: Request, res: Response) => {
    try {
      const response = await fetch("https://streamed.pk/api/matches/live");
      if (!response.ok) throw new Error(`Streaming API error: ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Streaming] Live matches error:", error.message);
      res.json([]);
    }
  });

  app.get("/api/streaming/stream/:source/:id", async (req: Request, res: Response) => {
    try {
      const { source, id } = req.params;
      const response = await fetch(`https://streamed.pk/api/stream/${source}/${id}`);
      if (!response.ok) throw new Error(`Stream source error: ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Streaming] Stream source error:", error.message);
      res.json([]);
    }
  });

  // Full-page stream viewer with iframe to embedsports.top
  app.get("/watch/:source/:id/:streamNo?", async (req: Request, res: Response) => {
    try {
      const { source, id, streamNo } = req.params;
      const num = streamNo || '1';
      const embedUrl = `https://embedsports.top/embed/${source}/${id}/${num}`;
      const matchTitle = id.replace(/-/g, ' ').replace(/vs/gi, ' vs ').replace(/\s+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).trim();

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${matchTitle} - SuiBets Live</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;width:100%;overflow:hidden;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
#bar{position:fixed;top:0;left:0;right:0;z-index:999999;background:rgba(10,15,30,0.95);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid rgba(6,182,212,0.3);gap:8px;}
#bar a{color:#06b6d4;text-decoration:none;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;white-space:nowrap;}
#bar a:hover{color:#22d3ee;}
.mt{color:#e2e8f0;font-size:13px;font-weight:500;text-align:center;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lb{color:#06b6d4;font-size:11px;background:rgba(6,182,212,0.15);padding:3px 8px;border-radius:4px;white-space:nowrap;font-weight:600;}
#sf{position:fixed;top:44px;left:0;right:0;bottom:0;width:100%;height:calc(100vh - 44px);border:none;background:#000;}
.lo{position:fixed;top:44px;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;z-index:10;transition:opacity 0.5s;}
.lo.h{opacity:0;pointer-events:none;}
.sp{width:40px;height:40px;border:3px solid rgba(6,182,212,0.2);border-top-color:#06b6d4;border-radius:50%;animation:spin 0.8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.lt{color:#94a3b8;font-size:14px;margin-top:16px;}
</style>
</head>
<body>
<div id="bar">
  <a href="/streaming">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    Back to SuiBets
  </a>
  <span class="mt">${matchTitle}</span>
  <span class="lb">LIVE</span>
</div>
<div class="lo" id="lo">
  <div class="sp"></div>
  <div class="lt">Loading stream...</div>
</div>
<iframe id="sf" src="${embedUrl}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="no-referrer"></iframe>
<script>
var f=document.getElementById('sf'),l=document.getElementById('lo');
f.addEventListener('load',function(){setTimeout(function(){l.classList.add('h');},800);});
setTimeout(function(){l.classList.add('h');},6000);
</script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(html);
    } catch (error: any) {
      console.error("[Streaming] Watch page error:", error.message);
      res.redirect('/streaming');
    }
  });

  // Proxy JS/CSS assets from embedsports.top to avoid CSP restrictions
  // Also patches the iframe/sandbox detection in the player scripts
  const jsCache = new Map<string, { content: string; time: number }>();
  app.get("/api/streaming/js/:filename", async (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      
      // Check cache (1 hour)
      const cached = jsCache.get(filename);
      if (cached && Date.now() - cached.time < 3600000) {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(cached.content);
      }

      const url = `https://embedsports.top/js/${filename}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
          'Referer': 'https://embedsports.top/',
        },
      });
      if (!response.ok) throw new Error(`${response.status}`);
      let content = await response.text();

      // Patch iframe/sandbox detection in bundle-jw.js and bundle-clappr.js
      // The player checks: r._iframe = window.top !== window.self
      // We replace it so it always returns false (not in iframe)
      content = content.replace(/window\.top\s*!==\s*window\.self/g, 'false');
      content = content.replace(/window\.top\s*!=\s*window\.self/g, 'false');
      content = content.replace(/window\.self\s*!==\s*window\.top/g, 'false');
      content = content.replace(/window\.self\s*!=\s*window\.top/g, 'false');

      // For the fake jquery.min.js - also patch any plugin/PDF detection
      if (filename === 'jquery.min.js') {
        content = content.replace(/data:application\/pdf/g, 'data:text/plain');
      }

      jsCache.set(filename, { content, time: Date.now() });

      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(content);
    } catch (error: any) {
      console.error(`[Streaming] JS proxy error for ${req.params.filename}:`, error.message);
      res.status(502).send('');
    }
  });

  // === WALRUS DECENTRALIZED STORAGE ENDPOINTS ===
  app.get("/api/walrus/receipt/:blobId", async (req: Request, res: Response) => {
    try {
      const { blobId } = req.params;
      if (!blobId) {
        return res.status(400).json({ message: "Missing blobId" });
      }

      if (blobId.startsWith('local_')) {
        const { bets: betsTable } = await import('@shared/schema');
        const { db: receiptDb } = await import('./db');
        const { eq: receiptEq } = await import('drizzle-orm');
        const rows = await receiptDb.select({ walrusReceiptData: betsTable.walrusReceiptData })
          .from(betsTable)
          .where(receiptEq(betsTable.walrusBlobId, blobId))
          .limit(1);
        if (rows.length > 0 && rows[0].walrusReceiptData) {
          const receipt = JSON.parse(rows[0].walrusReceiptData);
          return res.json({ receipt, source: 'local', verified: true });
        }
        return res.status(404).json({ message: "Receipt not found" });
      }

      const { getBetReceipt, getWalrusAggregatorUrl } = await import('./services/walrusStorageService');
      const receipt = await getBetReceipt(blobId);
      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found on Walrus" });
      }
      res.json({ receipt, aggregatorUrl: getWalrusAggregatorUrl(blobId), source: 'walrus', verified: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch receipt" });
    }
  });

  return httpServer;
}