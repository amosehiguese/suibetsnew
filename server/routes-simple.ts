import express, { Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ApiSportsService } from "./services/apiSportsService";
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

export async function registerRoutes(app: express.Express): Promise<Server> {
  // Initialize services
  const adminService = new AdminService();

  // Validate environment on startup
  const envValidation = EnvValidationService.validateEnvironment();
  EnvValidationService.printValidationResults(envValidation);

  // Start the settlement worker for automatic bet settlement
  settlementWorker.start();
  console.log('🔄 Settlement worker started - will automatically settle bets when matches finish');
  
  // Start background odds prefetcher for 100% real odds coverage
  apiSportsService.startOddsPrefetcher();
  console.log('🎰 Odds prefetcher started - continuously warming odds cache for instant responses');

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

  // Health check endpoint
  app.get("/api/health", async (req: Request, res: Response) => {
    const report = monitoringService.getHealthReport();
    const statusCode = report.status === 'HEALTHY' ? 200 : 503;
    res.status(statusCode).json(report);
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
          // Refund stake on void
          const refundSuccess = await balanceService.addWinnings(walletId, stake, currency);
          if (!refundSuccess) {
            await storage.updateBetStatus(betId, 'pending');
            console.error(`❌ SETTLEMENT REVERTED: Failed to refund stake for voided bet ${betId}`);
            return res.status(500).json({ message: "Failed to refund stake - settlement reverted" });
          }
          console.log(`🔄 ADMIN SETTLE: ${walletId} refunded ${stake} ${currency} (void)`);
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
            } else if (outcome === 'lost') {
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

  // API error statistics
  app.get("/api/admin/error-stats", async (req: Request, res: Response) => {
    try {
      const stats = errorHandlingService.getErrorStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch error stats" });
    }
  });

  // Platform revenue endpoint
  app.get("/api/admin/revenue", async (req: Request, res: Response) => {
    try {
      const revenue = await balanceService.getPlatformRevenue();
      const contractInfo = await blockchainBetService.getPlatformInfo();
      res.json({
        offChainRevenue: {
          sui: revenue.suiBalance,
          sbets: revenue.sbetsBalance
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
      res.status(500).json({ message: "Failed to fetch revenue" });
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
      
      if (!hasValidToken && !hasValidPassword) {
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

  // Sports routes
  app.get("/api/sports", async (req: Request, res: Response) => {
    try {
      const sports = await storage.getSports();
      res.json(sports);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sports" });
    }
  });

  // Events route with multi-source fallback logic
  app.get("/api/events", async (req: Request, res: Response) => {
    try {
      const reqSportId = req.query.sportId ? Number(req.query.sportId) : undefined;
      const isLive = req.query.isLive ? req.query.isLive === 'true' : undefined;
      
      console.log(`Fetching events for sportId: ${reqSportId}, isLive: ${isLive}`);
      
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
          try {
            allLiveEvents = await apiSportsService.enrichEventsWithOdds(allLiveEvents, 'football');
            console.log(`✅ LIVE: Enriched events with real odds`);
          } catch (oddsError: any) {
            console.warn(`⚠️ LIVE: Failed to enrich with odds: ${oddsError.message}`);
          }
          
          // CRITICAL: Filter to only show events with REAL odds from API (100% real odds requirement)
          const liveBeforeFilter = allLiveEvents.length;
          allLiveEvents = allLiveEvents.filter(e => e.oddsSource === 'api-sports');
          console.log(`✅ LIVE: Filtered to ${allLiveEvents.length}/${liveBeforeFilter} events with REAL API odds`);
          
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
          return res.json([]);
        }
      }
      
      // UPCOMING EVENTS MODE - PAID API ONLY, NO FALLBACKS
      console.log(`📅 UPCOMING EVENTS MODE - Paid API-Sports ONLY (NO fallbacks, NO free alternatives)`);
      try {
        // Get configurable sports list
        const sportsToFetch = getSportsToFetch();
        
        const sportPromises = sportsToFetch.map(sport =>
          apiSportsService.getUpcomingEvents(sport).catch(e => {
            console.log(`❌ API-Sports failed for ${sport}: ${e.message} - NO FALLBACK, returning empty`);
            return [];
          })
        );
        
        const sportResults = await Promise.all(sportPromises);
        const allUpcomingEventsRaw = sportResults.flat();
        
        // Deduplicate events by ID to prevent repeated matches
        const seenUpcomingIds = new Set<string>();
        let allUpcomingEvents = allUpcomingEventsRaw.filter(event => {
          const eventId = String(event.id);
          if (seenUpcomingIds.has(eventId)) return false;
          seenUpcomingIds.add(eventId);
          return true;
        });
        
        console.log(`✅ UPCOMING: Fetched ${allUpcomingEvents.length} unique events (${allUpcomingEventsRaw.length} before dedup, ${sportsToFetch.length} sports)`);
        
        // Enrich events with real odds from API-Sports (football only for now)
        try {
          allUpcomingEvents = await apiSportsService.enrichEventsWithOdds(allUpcomingEvents, 'football');
          console.log(`✅ UPCOMING: Enriched events with real odds`);
        } catch (oddsError: any) {
          console.warn(`⚠️ UPCOMING: Failed to enrich with odds: ${oddsError.message}`);
        }
        
        // CRITICAL: Filter to only show events with REAL odds from API (100% real odds requirement)
        const upcomingBeforeFilter = allUpcomingEvents.length;
        allUpcomingEvents = allUpcomingEvents.filter(e => e.oddsSource === 'api-sports');
        console.log(`✅ UPCOMING: Filtered to ${allUpcomingEvents.length}/${upcomingBeforeFilter} events with REAL API odds`);
        
        // Sort by startTime (earliest first, events without startTime go to end)
        allUpcomingEvents.sort((a, b) => {
          const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
          const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
          return timeA - timeB;
        });
        
        // Filter by sport if requested
        if (reqSportId && allUpcomingEvents.length > 0) {
          const filtered = allUpcomingEvents.filter(e => e.sportId === reqSportId);
          console.log(`Filtered to ${filtered.length} events for sport ID ${reqSportId}`);
          return res.json(filtered.length > 0 ? filtered : []);
        }
        
        // Return all upcoming events (may be empty if API-Sports fails)
        return res.json(allUpcomingEvents);
      } catch (error) {
        console.error(`❌ UPCOMING API fetch failed:`, error);
        return res.json([]);
      }
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ message: "Failed to fetch events" });
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
      const { eventName, homeTeam, awayTeam, marketId, outcomeId, odds, betAmount, prediction, feeCurrency, paymentMethod, txHash, onChainBetId, status, isLive, matchMinute } = data;
      
      // SERVER-SIDE VALIDATION: Unified event registry lookup
      // CRITICAL: Server is authoritative about event status - never trust client isLive/matchMinute
      // Security: FAIL-CLOSED - Event must exist in server cache (live or upcoming) to accept bet
      const MAX_CACHE_AGE_MS = 60 * 1000; // Reject stale cache (>60 seconds) for live events
      
      try {
        // Unified lookup: checks BOTH live and upcoming event caches
        const eventLookup = apiSportsService.lookupEventSync(eventId);
        // Maximum cache age for ANY bet - after this, cache is too stale to trust
        const MAX_UNIVERSAL_CACHE_AGE_MS = 2 * 60 * 1000; // 2 minutes - reject ALL stale cache bets
        
        if (!eventLookup.found) {
          // FAIL-CLOSED: Event not found in ANY cache - reject bet
          console.log(`❌ Bet rejected (unknown event): Event ${eventId} not in live or upcoming cache, client isLive: ${isLive}`);
          return res.status(400).json({ 
            message: "Event not found - please refresh and try again",
            code: "EVENT_NOT_FOUND"
          });
        }
        
        // UNIVERSAL STALE CHECK: Reject ANY bet with stale cache, regardless of source or client claims
        // This prevents bypass via stale upcoming cache + isLive=false manipulation
        if (eventLookup.cacheAgeMs > MAX_UNIVERSAL_CACHE_AGE_MS) {
          console.log(`❌ Bet rejected (stale cache): Cache is ${Math.round(eventLookup.cacheAgeMs/1000)}s old (max ${MAX_UNIVERSAL_CACHE_AGE_MS/1000}s), eventId: ${eventId}, source: ${eventLookup.source}`);
          return res.status(400).json({ 
            message: "Event data is stale - please refresh and try again",
            code: "STALE_EVENT_DATA"
          });
        }
        
        // Event found with fresh cache - check if it's live (server determines this, not client)
        if (eventLookup.source === 'live') {
          // Event is LIVE according to server cache - additional freshness check for live events
          if (eventLookup.cacheAgeMs > MAX_CACHE_AGE_MS) {
            console.log(`❌ Bet rejected (stale live cache): Cache is ${Math.round(eventLookup.cacheAgeMs/1000)}s old, eventId: ${eventId}, cached minute: ${eventLookup.minute}`);
            return res.status(400).json({ 
              message: "Match data is stale - please refresh and try again",
              code: "STALE_MATCH_DATA"
            });
          }
          
          // FAIL-CLOSED: If we have no minute data for a live match, we cannot verify it's under 80 min
          // API-Sports may omit minute during halftime, glitches, or for non-football sports
          if (eventLookup.minute === undefined || eventLookup.minute === null) {
            console.log(`❌ Bet rejected (unverifiable minute): Live match has no minute data, eventId: ${eventId}, cannot verify < 80 min cutoff`);
            return res.status(400).json({ 
              message: "Cannot verify match time - please try again shortly",
              code: "UNVERIFIABLE_MATCH_TIME"
            });
          }
          
          // Check trusted minute against 80-minute cutoff
          if (eventLookup.minute >= 80) {
            console.log(`❌ Bet rejected (server-verified): Live match at ${eventLookup.minute} minutes (>= 80 min cutoff), eventId: ${eventId}, client claimed isLive: ${isLive}`);
            return res.status(400).json({ 
              message: "Betting closed for this match (80+ minutes played)",
              code: "MATCH_TIME_EXCEEDED",
              serverVerified: true
            });
          }
          // Live match under 80 minutes with fresh cache and verified minute - allow bet to proceed
          console.log(`✅ Live bet allowed: eventId ${eventId}, minute: ${eventLookup.minute}, cache age: ${Math.round(eventLookup.cacheAgeMs/1000)}s`);
        } else if (eventLookup.source === 'upcoming') {
          // Event found in upcoming cache - but check if it SHOULD be live based on start time
          if (eventLookup.shouldBeLive) {
            // START TIME HAS PASSED - match should be live but isn't in live cache
            // This is the critical bypass scenario: match could be at 80+ minutes
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
      } catch (lookupError) {
        // Cache access failed - FAIL-CLOSED: Reject ALL bets
        console.log(`❌ Bet rejected (cache error): Cannot verify event, eventId: ${eventId}, error: ${lookupError}`);
        return res.status(400).json({ 
          message: "Cannot verify event status - please try again",
          code: "EVENT_VERIFICATION_ERROR"
        });
      }
      
      // Determine currency (default to SUI)
      const currency: 'SUI' | 'SBETS' = feeCurrency === 'SBETS' ? 'SBETS' : 'SUI';
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
        homeTeam: homeTeam || '', // Store for settlement matching
        awayTeam: awayTeam || '', // Store for settlement matching
        marketId,
        outcomeId,
        odds,
        betAmount,
        currency,
        status: (paymentMethod === 'wallet' ? 'confirmed' : 'pending') as 'pending' | 'confirmed',
        prediction,
        placedAt: Date.now(),
        potentialPayout,
        platformFee: paymentMethod === 'wallet' ? 0 : platformFee, // No platform fee for on-chain bets (paid in gas)
        totalDebit: paymentMethod === 'wallet' ? betAmount : totalDebit,
        txHash: txHash || undefined,
        onChainBetId: onChainBetId || undefined,
        paymentMethod
      };

      // Store bet in storage
      const storedBet = await storage.createBet(bet);

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
        homeTeam: homeTeam || 'Home Team',
        awayTeam: awayTeam || 'Away Team'
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
        }
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
      
      // Determine currency (default to SUI)
      const currency: 'SUI' | 'SBETS' = feeCurrency === 'SBETS' ? 'SBETS' : 'SUI';

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

      const currency: 'SUI' | 'SBETS' = feeCurrency === 'SBETS' ? 'SBETS' : 'SUI';
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
      const bet = await storage.getBet(betId);
      
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
          // Refund stake on void using the bet's currency
          const refundSuccess = await balanceService.addWinnings(bet.userId, settlement.payout, bet.currency);
          if (!refundSuccess) {
            await storage.updateBetStatus(betId, 'pending');
            console.error(`❌ SETTLEMENT REVERTED: Failed to refund stake for voided bet ${betId}`);
            return res.status(500).json({ message: "Failed to refund stake - settlement reverted" });
          }
          console.log(`🔄 STAKE REFUNDED (DB): ${bet.userId} received ${settlement.payout} ${bet.currency} back`);
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
      
      // Check if user exists with this wallet address
      let user = await storage.getUserByWalletAddress(normalizedAddress);
      
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
      
      // Get balance for user using normalized address
      const balance = await balanceService.getBalanceAsync(normalizedAddress);
      console.log(`[Wallet Connect] Balance retrieved:`, balance);
      
      res.json({
        id: user.id,
        username: user.username,
        walletAddress: user.walletAddress,
        walletType: user.walletType || walletType || 'sui',
        createdAt: user.createdAt,
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
      
      let user = await storage.getUserByWalletAddress(normalizedAddress);
      
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
      
      const balance = await balanceService.getBalanceAsync(normalizedAddress);
      
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          walletAddress: user.walletAddress,
          walletType: user.walletType || walletType || 'sui',
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
          return res.json({
            // On-chain wallet balance (what user has in their Sui wallet for betting)
            SUI: onChainBalance.sui || 0,
            SBETS: onChainBalance.sbets || 0,
            suiBalance: onChainBalance.sui || 0,
            sbetsBalance: onChainBalance.sbets || 0,
            // Platform/database balance (for off-chain deposits - withdrawable)
            platformSuiBalance: dbBalance.suiBalance || 0,
            platformSbetsBalance: dbBalance.sbetsBalance || 0,
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

  return httpServer;
}