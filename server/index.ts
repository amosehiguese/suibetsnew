import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes-simple"; // Main SuiBets API implementation
import { setupVite, serveStatic, log } from "./vite";
import { initDb, seedDb } from "./db";
import { setupBlockchainAuth } from "./blockchain-auth";
import { blockchainStorage } from "./blockchain-storage";

const app = express();

// CORS configuration for Railway deployment
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.VITE_API_URL,
  'https://suibets.up.railway.app',
  'https://suibets-production.up.railway.app',
  'https://suibets.io',
  'https://www.suibets.io',
  'http://localhost:5000',
  'http://localhost:5173',
].filter(Boolean) as string[];

// Railway dynamic domain patterns
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
    
    // Also allow any Railway domain
    const isRailwayDomain = railwayDomainPatterns.some(pattern => pattern.test(origin));
    
    if (isAllowed || isRailwayDomain) {
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
  // Only set CSP for HTML pages, not API requests
  if (!req.path.startsWith('/api')) {
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
  }
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
