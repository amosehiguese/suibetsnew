# SuiBets Platform - Crypto Sports Betting Platform

## Overview
SuiBets is a crypto sports betting platform built on the Sui blockchain, offering real-time betting across 30+ sports. It integrates multiple sports APIs for live scores and automated event tracking, utilizing blockchain for secure transactions and PostgreSQL for data persistence. The platform aims to provide a comprehensive and robust betting experience with a focus on real-time odds, secure on-chain betting, and a user-friendly interface, with the ambition to be a leading platform in the crypto sports betting market.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Frameworks**: React 18 (TypeScript), Vite
- **Styling & UI**: Tailwind CSS, Framer Motion for animations, Radix UI for components
- **Data & Routing**: TanStack Query for data fetching, Wouter for routing
- **UI/UX Decisions**: Redesigned event cards with inline odds buttons, collapsible league sections, major leagues prioritized and expanded by default, quick bet functionality.

### Backend
- **Framework**: Express.js (TypeScript)
- **API**: RESTful design
- **Real-time**: WebSocket for live score updates
- **Data Aggregation**: Multi-API with resilience and fallback mechanisms
- **Authentication**: Session-based with optional blockchain authentication
- **Security**: Server-authoritative betting cutoff, rejection of stale event data, anti-exploit protections (rate limiting, cooldowns, max bets per event, event validation, settlement blocking).

### Data Storage
- **Primary Database**: PostgreSQL with Drizzle ORM
- **Caching**: In-memory caching for odds and event data.

### Key Features
- **Sports Data Integration**: Aggregates real-time scores and odds from multiple providers.
- **Blockchain Integration**: Sui blockchain for secure transactions, SBETS token support, and Move smart contracts for betting and automated payouts.
- **Betting System**: Real-time odds, multiple market types, live betting via WebSockets, betting slip management, automated on-chain payouts, multi-leg parlay betting, gift bets (send bet winnings to another wallet). Esports betting (LoL + Dota 2, sportId 24).
- **User Management**: Wallet-based authentication, user profiles, SUI and SBETS token balance management, user betting limits, referral system.
- **On-Chain Fund Flow**: Full on-chain dual-token system for bets and settlements via smart contracts, transparent treasury management, and fee accrual.
- **Liability Tracking**: Explicit currency tracking, maximum stake limits, treasury pre-checks, on-chain bet synchronization.
- **Social Network Effect Engine ("Predict Anything")**: Standalone /network page with custom prediction markets, viral challenges, public profiles, live chat, follow system, and leaderboard integration. Features on-chain prediction bets and challenge stakes, atomic pool updates, and automated resolution/settlement with anti-exploit security.
- **Live Streaming Section**: Proxies `streamed.pk` API for live and upcoming football matches with embedded playback.
- **zkLogin (Google OAuth)**: Full Sui zkLogin implementation for seedless wallet login via Google, integrated with on-chain betting.
- **Walrus Decentralized Storage**: Stores bet receipts on Walrus Protocol (mainnet) with multi-publisher fallback (publisher.walrus-mainnet.walrus.space, walrus-publisher.nodes.guru, publisher.walrus.space). Service: `server/services/walrusStorageService.ts`. Aggregators: aggregator.walrus-mainnet.walrus.space, aggregator.walrus.space. Receipt format v2.0 includes SuiBets branding (colors, logo, website links), bet details, blockchain info, and SHA-256 verification hash. Each bet receipt gets a Walrus blob ID stored in `bets.walrus_blob_id`. Receipt JSON cached in `bets.walrus_receipt_data`. Frontend shows "Verify on Walrus" link. Receipt viewer at `/api/walrus/receipt/:blobId` serves branded HTML page (XSS-safe) or JSON with `?json=true`. DNS for Walrus publishers doesn't resolve from Replit — works on Railway (production). Non-blocking: if all publishers fail, bet uses `local_<hash>` fallback.
- **SuiNS Integration**: Resolves wallet addresses to `.sui` domain names for enhanced UI.

### Architecture Model
- **Full On-Chain Model**: Bets placed directly on smart contracts, tracked in PostgreSQL for UI, settlements automated on-chain.
- **Capability-Based Security**: Smart contracts use AdminCap and OracleCap for access control.

## External Dependencies

### Sports Data Providers
- **API-Sports**: Primary data source for Football (paid tier, live betting).
- **Free Sports API**: Provides data for Basketball, Baseball, Ice Hockey, MMA, American Football, AFL, Handball, Rugby, Volleyball (upcoming only, no live betting for free sports). Each sport API has independent 100/day request limit on free tier. Data fetched daily at 6 AM UTC, results at 11 PM UTC. Admin force-refresh: POST `/api/admin/free-sports/refresh`. NFL and Tennis API hostnames don't exist — removed from config.
- **Curated Sports Schedules**: Real verified 2026 schedules for sports where free APIs lack coverage. F1 (sportId=11): full 24-race 2026 calendar with 22-driver grid (Cadillac, Audi, Racing Bulls). MotoGP (sportId=19): 21-round 2026 calendar from official MotoGP.com. UFC/MMA (sportId=7): confirmed fight cards through May 2026 (UFC 327 Kaseya Center Miami, UFC 328 Prudential Center Newark). Boxing (sportId=17): 18 verified bouts (Fury vs Makhmudov, Wilder vs Chisora, Fundora vs Thurman). Tennis (sportId=3): ATP calendar (Indian Wells, Monte-Carlo, Roland-Garros, Wimbledon, US Open). All use real athlete names, venues, and dates; only odds are generated.
- **Horse Racing (The Racing API via RapidAPI)**: `the-racing-api1.p.rapidapi.com` — real racecards with all runners per race as bet outcomes (horse name, jockey, number, odds). Sport ID 17. Free tier: today/tomorrow only. Response uses `racecards` key, start times from `off_dt` field.
- **Cricket (Cricket API Free Data via RapidAPI)**: `cricket-api-free-data.p.rapidapi.com/cricket-schedule` — real upcoming matches (TEST, ODI, T20). Sport ID 18. TEST/ODI matches include Draw outcome. T20/ODI have Total Runs market. Boxing auto-detected from MMA feed (Sport ID 8).
- **WWE Entertainment**: Real WWE PLE schedule (WrestleMania 42 at Allegiant Stadium Apr 18-19, Backlash May 3 Tampa, Clash in Italy May 31 Turin, SummerSlam Aug 1-2 Minneapolis, MITB Sep 6 New Orleans, Survivor Series Nov 29 Pechanga Arena San Diego) plus dynamically generated weekly Raw (Monday 01:00 UTC) and SmackDown (Friday 01:00 UTC) shows for the next 8 weeks. Sport ID 20. Odds modeled on sportsbook-style wrestling odds. Weekly shows use `generateWeeklyWWEShows()` with rotating matchups and venues, computed in UTC to avoid timezone drift. Events include 21 PLEs + ~112 weekly shows.
- **Horse Racing Fallback**: When The Racing API returns 429 (rate limit), `generateFallbackHorseRacing()` generates realistic UK/US race cards for today+tomorrow from 8 courses (Cheltenham, Ascot, Newmarket, Aqueduct, Santa Anita, etc.) with proper runner data (horse names, jockeys, trainers, odds).
- **Admin Event Settlement**: POST `/api/admin/settle-event` settles all bets for a specific event by providing `eventId` and `winnerId` or `winnerName`. Uses exact name matching (not substring) for safety. Works for all generated sports (WWE, F1, UFC, Horse Racing, MotoGP, Boxing).

### Blockchain Services
- **Sui Network**: Layer 1 blockchain.
- **Move Language**: Smart contract development.
- **SBETS Token (Mainnet)**: `0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS`
- **SuiBettingPlatform Contract (Mainnet)**: Deployed at `0x737324ddac9fb96e3d7ffab524f5489c1a0b3e5b4bffa2f244303005001b4ada` (Package ID) and `0x5fc1073c9533c6737fa3a0882055d1778602681df70bdabde96b0127b588f082` (Shared object).

### Promotions System
- **Welcome Bonus**: 1,000 SBETS for new users.
- **Referral System**: 1,000 SBETS reward per qualified referral.
- **Loyalty Program**: Tier-based system with points earned per wager.
- **SBETS Staking**: 1-Week and 3-Month lock plans with APY, daily reward withdrawals, and hourly accrual. Force unstake and claim-rewards have atomic deactivation-before-credit with rollback on failure to prevent fund loss or double-pay.

### Payment Integration
- **Stripe**: Optional fiat payment processing.

### Infrastructure
- **PostgreSQL**: Primary database.
- **WebSocket**: Real-time communication.
- **Railway**: Hosting for PostgreSQL and backend deployment.
- **Walrus Sites**: Frontend deployed to Walrus decentralized storage (mainnet). Site Object ID: `0x7a538ca8c822a006210105b7a804842ba62a56510f35a2cf1a67a5e04fec5aba`. SuiNS name `suibets.sui` (NFT object `0x37bef7ac855aa1ff3d33cf59bb7dd4ca30d8aad557866d7075ad907fd8ca4f07`) linked to site via TWO SuiNS calls on V2 controller (`0x71af035413ed499710980ed8adb010bbf2cc5cacf4ab37c7710a4bb87eb58ba5`): (1) `set_target_address` sets the generic target, (2) `set_user_data` with key `walrus_site_id` and value = Site Object ID — this is the **critical** field the wal.app portal reads via `@mysten/suins` `getNameRecord().walrusSiteId`. Without `set_user_data`, the portal returns 404 even if `set_target_address` is correct. Registry: `0x6e0ddefc0ad98889c04bab9639e512c21766c5e6366f89e696956d9be6952871`. RegistryTableId (for SDK lookups): `0xe64cd9db9f829c6cc405d9790bd71567ae07259855f4fba6f02c84f52298c106`. Browsable at `https://suibets.wal.app`. Built with `VITE_API_BASE_URL=https://www.suibets.com` so frontend API calls route to the Railway backend. Site-builder config: `walrus-sites-config.yaml`. Walrus CLI config: `~/.config/walrus/client_config.yaml`. To update: `VITE_API_BASE_URL=https://www.suibets.com npx vite build && /home/runner/.local/bin/site-builder --config walrus-sites-config.yaml update --epochs 5 0x7a538ca8c822a006210105b7a804842ba62a56510f35a2cf1a67a5e04fec5aba dist/public`.
- **Vercel**: Alternative for serverless functions and static assets.
- **API Base URL**: Frontend uses `VITE_API_BASE_URL` env var (empty in dev for same-origin, set to `https://www.suibets.com` for Walrus Sites build). A global fetch interceptor in `queryClient.ts` prefixes all `/api/` calls with this base URL.
- **CORS**: Backend allows Walrus Sites domains (`*.walrus.site`, `*.wal.app`), Railway domains, and `suibets.com`/`suibets.io`.
- **Runtime Config**: GET `/api/config/public` serves Google Client ID at runtime (for Railway/Walrus deployments where build-time env vars may not be set).