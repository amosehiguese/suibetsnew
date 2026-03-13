import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes-simple"; // Main SuiBets API implementation
import { setupVite, serveStatic, log } from "./vite";
import { initDb, seedDb } from "./db";
import { setupBlockchainAuth } from "./blockchain-auth";
import { blockchainStorage } from "./blockchain-storage";

const app = express();

app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  if (req.headers.accept?.includes('text/html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// CORS configuration for Railway deployment
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.VITE_API_URL,
  'https://suibets.up.railway.app',
  'https://suibets-production.up.railway.app',
  'https://suibets.io',
  'https://www.suibets.io',
  'https://www.suibets.com',
  'https://suibets.com',
  'https://suibets.wal.app',
  'https://suibets.walrus.site',
  'http://localhost:5000',
  'http://localhost:5173',
].filter(Boolean) as string[];

const walrusDomainPatterns = [
  /^https:\/\/.*\.walrus\.site$/,
  /^https:\/\/.*\.wal\.app$/,
];

const railwayDomainPatterns = [
  /^https:\/\/.*\.up\.railway\.app$/,
  /^https:\/\/.*\.railway\.app$/,
];

const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all origins in development
    if (!isProduction) return callback(null, true);
    
    // Allow wallet browser extensions (chrome-extension://, moz-extension://, etc.)
    if (origin.includes('-extension://')) {
      return callback(null, true);
    }
    
    // Production: Check against allowed origins
    const isAllowed = allowedOrigins.some(allowed => 
      origin === allowed || origin.startsWith(allowed)
    );
    
    const isRailwayDomain = railwayDomainPatterns.some(pattern => pattern.test(origin));
    const isWalrusDomain = walrusDomainPatterns.some(pattern => pattern.test(origin));
    
    if (isAllowed || isRailwayDomain || isWalrusDomain) {
      return callback(null, true);
    }
    
    // Log rejected origins for debugging
    console.log(`[CORS] Origin rejected: ${origin}`);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Content Security Policy headers for Railway deployment
// Allow inline scripts and eval for Vite/React/Sui wallet libraries
app.use((req, res, next) => {
  // Skip CSP for API requests
  if (req.path.startsWith('/api')) return next();
  
  // Relaxed CSP for streaming watch pages (player needs data: URIs, media sources, etc.)
  if (req.path.startsWith('/watch/')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; " +
      "script-src * 'unsafe-inline' 'unsafe-eval' blob:; " +
      "style-src * 'unsafe-inline'; " +
      "img-src * data: blob:; " +
      "media-src * data: blob:; " +
      "connect-src * data: blob:; " +
      "object-src * data:; " +
      "frame-src * data: blob:;"
    );
    return next();
  }

  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://replit.com https://*.replit.com blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https: http:; " +
    "connect-src 'self' https: wss: ws: http:; " +
    "frame-src 'self' https:; " +
    "worker-src 'self' blob:; " +
    "child-src 'self' blob:;"
  );
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    // Initialize the database and run migrations
    await initDb();
    
    // Seed the database with initial data
    await seedDb();
    
    log('Database initialized and seeded successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    log('Continuing with blockchain-based authentication and storage');
  }

  // WALRUS BACKFILL: Patch any bets missing a walrus_blob_id (self-healing on restart)
  try {
    const { db: backfillDb } = await import('./db');
    const { bets: backfillBets } = await import('@shared/schema');
    const { isNull: backfillIsNull, eq: backfillEq } = await import('drizzle-orm');
    const { createHash } = await import('crypto');
    const missing = await backfillDb.select().from(backfillBets).where(backfillIsNull(backfillBets.walrusBlobId));
    if (missing.length > 0) {
      log(`🐋 Backfilling ${missing.length} bet(s) missing Walrus blob IDs...`);
      const storedAt = Date.now();
      for (const row of missing) {
        const betId = row.wurlusBetId || String(row.id);
        const currency = (row as any).currency || row.feeCurrency || 'SUI';
        const placedAt = row.createdAt?.getTime() || storedAt;
        const blobId = `local_${createHash('sha256').update(betId + placedAt).digest('hex').slice(0, 16)}`;

        const verificationPayload = JSON.stringify({
          betId,
          walletAddress: row.walletAddress,
          eventId: String(row.eventId || ''),
          prediction: row.prediction,
          odds: row.odds,
          stake: row.betAmount,
          currency,
          placedAt,
        });

        const receiptData = JSON.stringify({
          platform: 'SuiBets',
          version: '2.0',
          type: 'bet_receipt',
          branding: {
            name: 'SuiBets',
            tagline: 'Decentralized Sports Betting on Sui',
            website: 'https://www.suibets.com',
            walrusSite: 'https://suibets.wal.app',
            colors: {
              primary: '#06b6d4',
              secondary: '#8b5cf6',
              accent: '#f59e0b',
              background: '#0a0e1a',
              surface: '#111827',
              success: '#10b981',
              error: '#ef4444',
            },
            logo: 'https://www.suibets.com/suibets-logo.png',
          },
          bet: {
            id: betId,
            walletAddress: row.walletAddress || null,
            eventId: String(row.eventId || ''),
            eventName: row.eventName || 'Unknown Event',
            homeTeam: row.homeTeam || null,
            awayTeam: row.awayTeam || null,
            prediction: row.prediction,
            odds: row.odds,
            stake: row.betAmount,
            currency,
            potentialPayout: row.potentialPayout,
            sportName: null,
            marketType: row.marketType || 'match_winner',
          },
          blockchain: {
            chain: 'sui:mainnet',
            network: 'mainnet',
            txHash: row.txHash || null,
            betObjectId: row.betObjectId || null,
            token: currency === 'SBETS'
              ? '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS'
              : '0x2::sui::SUI',
            contract: '0x737324ddac9fb96e3d7ffab524f5489c1a0b3e5b4bffa2f244303005001b4ada',
            platform: '0x5fc1073c9533c6737fa3a0882055d1778602681df70bdabde96b0127b588f082',
          },
          storage: {
            protocol: 'walrus',
            network: 'mainnet',
            blobId,
            local: true,
            backfilled: true,
            storedVia: 'local-backfill',
            storedAt,
            placedAt,
            storageEpoch: null,
            endEpoch: null,
            walCost: null,
          },
          verification: {
            receiptHash: createHash('sha256').update(verificationPayload).digest('hex'),
            algorithm: 'sha256',
            fields: ['betId', 'walletAddress', 'eventId', 'prediction', 'odds', 'stake', 'currency', 'placedAt'],
          },
        }, null, 2);

        await backfillDb.update(backfillBets)
          .set({ walrusBlobId: blobId, walrusReceiptData: receiptData })
          .where(backfillEq(backfillBets.id, row.id));
      }
      log(`🐋 Walrus backfill complete: ${missing.length} bet(s) patched`);
    }
  } catch (backfillErr: any) {
    console.warn('[Walrus backfill] Failed:', backfillErr.message);
  }
  
  // Setup blockchain-based authentication
  const { requireWalletAuth } = setupBlockchainAuth(app);
  log('Blockchain-based authentication system initialized');
  
  // Use blockchain-based storage for the app
  log('Blockchain-based storage system initialized');
  
  // Register all SuiBets routes
  log('Registering SuiBets API routes...');
  
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error('Server error:', err);
    
    // Check if the response has already been sent
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Use PORT from environment (Railway sets this automatically)
  // Default to 5000 for local development
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.env.HOST || '0.0.0.0';
  
  server.listen(port, host, () => {
    log(`🚀 Server running on ${host}:${port} (NODE_ENV: ${process.env.NODE_ENV || 'development'})`);
  });
})();
