# SuiBets Platform - Crypto Sports Betting Platform

## Overview
SuiBets is a crypto sports betting platform built on the Sui blockchain, offering real-time betting across 30+ sports. It integrates multiple sports APIs for live scores and automated event tracking, utilizing blockchain for secure transactions and PostgreSQL for data persistence. The platform aims to provide a comprehensive and robust betting experience.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS (custom themed)
- **Animations**: Framer Motion
- **UI Components**: Radix UI
- **Data Fetching**: TanStack Query
- **Routing**: Wouter

### Backend
- **Framework**: Express.js with TypeScript
- **API**: RESTful design with sport-specific modules
- **Real-time**: WebSocket for live score updates
- **Data Aggregation**: Multi-API with resilience and fallback
- **Authentication**: Session-based with optional blockchain authentication

### Data Storage
- **Primary Database**: PostgreSQL with Drizzle ORM (Railway hosted)
- **Caching**: In-memory for performance
- **Authentication State**: Session storage

### Key Features
- **Sports Data Integration**: Aggregates data from API-Sports and SportsData API across various sports with an event tracking service and API resilience.
- **Blockchain Integration**: Utilizes the Sui blockchain for secure transactions, supports SBETS token, and employs Move smart contracts for betting operations, with multiple wallet support.
- **Betting System**: Provides real-time odds, multiple market types, live betting via WebSockets, betting slip management, and automated payout through smart contracts.
- **User Management**: Features wallet-based authentication, user profiles, balance management for SUI and SBETS tokens, and secure session handling.

### Data Flow
- **Event Data Pipeline**: Involves data aggregation, normalization, event tracking, real-time updates via WebSocket, and caching.
- **Betting Flow (On-Chain)**: Users select markets, odds are calculated, bets are placed via Sui smart contracts (user signs `place_bet` transaction), confirmed transactions are recorded in PostgreSQL, and settlements are automated.
- **Authentication Flow**: Wallet connection, address verification, session creation, balance synchronization from blockchain, and transaction authorization.

### Architecture Model
- **Full On-Chain Model**: Users place bets directly on the smart contract. Bets are tracked in PostgreSQL for UI, and settlements are automated on-chain. Revenue is withdrawn by admin.
  - **Admin Wallet (owns AdminCap)**: `0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50`
  - **Treasury**: Managed by smart contract at BettingPlatform shared object

#### Fund Flow - FULL ON-CHAIN DUAL TOKEN SYSTEM

**SUI Bets (On-Chain via Smart Contract):**
1. **User places bet** → `place_bet` - SUI goes directly to contract treasury_sui
2. **If Bet WON** → `settle_bet` pays user from contract treasury (1% fee on profit)
3. **If Bet LOST** → Stake stays in contract treasury (added to `accrued_fees_sui`)
4. **Admin can** → Call `withdraw_fees` to withdraw SUI platform revenue

**SBETS Bets (On-Chain via Smart Contract):**
1. **User places bet** → `place_bet_sbets` - SBETS goes directly to contract treasury_sbets
2. **If Bet WON** → `settle_bet_sbets` pays user from SBETS treasury (1% fee on profit)
3. **If Bet LOST** → Stake stays in SBETS treasury (added to `accrued_fees_sbets`)
4. **Admin can** → Call `withdraw_fees_sbets` to withdraw SBETS platform revenue

- **Key Point**: BOTH SUI and SBETS use smart contract for settlements (full on-chain).
- **Gas Payment**: Users pay gas for bets. Platform pays gas for on-chain settlements.
- **Dual Treasury**: Contract maintains separate treasuries and liability tracking for SUI and SBETS.

### Monitoring Endpoints
- `/api/contract/info`: Provides blockchain contract details.
- `/api/settlement/status`: Reports on the settlement worker's status.
- `/api/user/balance?userId=<wallet>`: Fetches user SUI and SBETS balances.

### Deployment Strategy
- **Railway Deployment**: Recommended, requires specific environment variables for database, blockchain configuration, on-chain payouts (optional `ADMIN_PRIVATE_KEY` for automated withdrawals), sports data, and session security.
- **Vercel Compatibility**: Alternative for serverless functions and static asset optimization.
- **Configuration Management**: Uses environment variables for secrets, network configuration, fee structure, and wallet addresses.

## External Dependencies

### Sports Data Providers
- **API-Sports**: Primary sports data provider (`api-sports.io`).
- **SportsData API**: Secondary data source.
- **Fixed API Key**: `3ec255b133882788e32f6349eff77b21`

### Blockchain Services
- **Sui Network**: Layer 1 blockchain (mainnet).
- **Move Language**: For smart contract development.
- **SBETS Token (Mainnet)**: `0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS`
- **Contract Source**: `sources/betting.move` (capability-based dual-token contract with OTW)
- **Security Model**: Capability-based access control using One-Time Witness (OTW) pattern
    - **AdminCap**: Single capability minted at deployment, required for all admin operations
    - **OracleCap**: Can be minted by admin for settlement oracles
- **Deployed Contract (Mainnet)** - REDEPLOYED January 5, 2026:
    - Package ID: `0xfaf371c3c9fe2544cc1ce9a40b07621503b300bf3a65b8fab0dba134636e8b32`
    - BettingPlatform (Shared): `0xae1b0dfed589c6ce5b7dafdb7477954670f0f73530668b5476e3a429b64099b3`
    - AdminCap: `0xaec276da96bc9fb7781213f3aedb18eacf30af1932dc577abbe5529583251827`
    - Admin Wallet (owns AdminCap): `0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50`
    - Module: `betting`
    - **Separate Bet Limits**: SUI (min 0.05, max 400) | SBETS (min 1000, max 50,000,000)
    - **All frontend/backend code updated to use these addresses**
- **DEPRECATED Old Contract** (DO NOT USE - funds locked):
    - Old Package: `0x9ca7d3b57c018fb171724dc808a542d2ec27354f6526b75e968d308d29bb6626`
    - Note: Contains locked funds (~4.23 SUI, ~4.1M SBETS) that cannot be recovered due to contract design (no emergency_withdraw function)
- **SUI Betting Functions**:
    - `place_bet` - Place bet with SUI (any user)
    - `settle_bet` / `settle_bet_admin` - Settle SUI bet (OracleCap / AdminCap)
    - `void_bet` / `void_bet_admin` - Void SUI bet (OracleCap / AdminCap)
    - `withdraw_fees` - Extract SUI revenue (AdminCap)
    - `deposit_liquidity` - Add SUI to treasury (AdminCap)
- **SBETS Betting Functions**:
    - `place_bet_sbets` - Place bet with SBETS (any user)
    - `settle_bet_sbets` / `settle_bet_sbets_admin` - Settle SBETS bet (OracleCap / AdminCap)
    - `void_bet_sbets` / `void_bet_sbets_admin` - Void SBETS bet (OracleCap / AdminCap)
    - `withdraw_fees_sbets` - Extract SBETS revenue (AdminCap)
    - `deposit_liquidity_sbets` - Add SBETS to treasury (AdminCap)
- **Admin Functions (all require AdminCap)**:
    - `mint_oracle_cap` / `revoke_oracle_cap` - Manage oracle capabilities
    - `set_pause` - Pause/unpause platform
    - `update_fee` - Change fee percentage
    - `update_limits` - Change min/max bet
    - `emergency_withdraw` / `emergency_withdraw_sbets` - Emergency withdrawal (paused only)
- **Deployment Guide**: See `DEPLOY_CONTRACT.md` for deployment instructions
- **Environment Variables** (update after deployment):
    - `BETTING_PACKAGE_ID` / `VITE_BETTING_PACKAGE_ID` - New package ID
    - `BETTING_PLATFORM_ID` / `VITE_BETTING_PLATFORM_ID` - New platform object ID
    - `ADMIN_CAP_ID` - AdminCap object ID (for backend settlement)

### Payment Integration
- **Stripe**: Optional fiat payment processing.
- **Native Crypto**: Preferred direct blockchain transactions.

### Infrastructure
- **PostgreSQL**: Primary database.
- **WebSocket**: Real-time communication.
- **Session Store**: User session management.

## Recent Changes (January 6, 2026)

### Odds Enrichment Fix
- **Issue**: Date-based bulk odds fetch returned different fixture IDs than the events API, causing 0% odds match rate
- **Solution**: Implemented fixture ID-based direct odds fetching via `getOddsForFixtures()` function
- **Result**: Now enriching ~25-30% of events with real API odds (fixtures without odds are smaller leagues without bookmaker coverage)
- **Caching**: Successful odds cached per fixture ID for 2 minutes; null results not cached to allow retries
- **Coverage**: Fetches odds for first 100 fixtures (5 batches of 20) per request to balance coverage vs API costs