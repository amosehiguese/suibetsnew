# SuiBets Platform - Crypto Sports Betting Platform

## Overview
SuiBets is a crypto sports betting platform built on the Sui blockchain, offering real-time betting across 30+ sports. It integrates multiple sports APIs for live scores and automated event tracking, utilizing blockchain for secure transactions and PostgreSQL for data persistence. The platform aims to provide a comprehensive and robust betting experience with a focus on real-time odds, secure on-chain betting, and a user-friendly interface.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion
- **UI Components**: Radix UI
- **Data Fetching**: TanStack Query
- **Routing**: Wouter
- **UI/UX Decisions**: Redesigned event cards with inline odds buttons, collapsible league sections, major leagues prioritized and first 3 expanded by default, quick bet functionality directly from event cards.

### Backend
- **Framework**: Express.js with TypeScript
- **API**: RESTful design
- **Real-time**: WebSocket for live score updates
- **Data Aggregation**: Multi-API with resilience and fallback
- **Authentication**: Session-based with optional blockchain authentication
- **Security**: Server-authoritative 80-minute betting cutoff for all bets, rejecting uncertain or stale event data.

### Data Storage
- **Primary Database**: PostgreSQL with Drizzle ORM
- **Caching**: In-memory for performance, with specific strategies for odds and event data.
- **Odds Fetching**: Fetches odds for ALL fixtures (not just mapping) with batch rate limiting (5 requests/batch, 1.5s delay) to avoid 429 errors.

### Key Features
- **Sports Data Integration**: Aggregates data from multiple providers for real-time scores and odds, with event tracking and API resilience.
- **Blockchain Integration**: Utilizes Sui for secure transactions, supports SBETS token, and employs Move smart contracts for betting operations and automated payouts.
- **Betting System**: Provides real-time odds, multiple market types, live betting via WebSockets, betting slip management, and automated on-chain payout.
- **Parlay Support**: Multi-leg parlay betting with combined odds calculation (multiply all legs). Single bets route to `/api/bets`, parlays (2+ legs) route to `/api/parlays`. Full metadata preserved (marketId, outcomeId, homeTeam, awayTeam, isLive) for settlement matching.
- **User Management**: Wallet-based authentication, user profiles, and balance management for SUI and SBETS tokens.
- **On-Chain Fund Flow**: Supports a full on-chain dual-token system where SUI and SBETS bets are placed and settled directly via smart contracts, with transparent treasury management and fee accrual.

### Architecture Model
- **Full On-Chain Model**: Bets are placed directly on the smart contract, tracked in PostgreSQL for UI, and settlements are automated on-chain.
- **Capability-Based Security**: Smart contracts use AdminCap and OracleCap for access control, enhancing security and operational management.

## External Dependencies

### Sports Data Providers
- **API-Sports**: Primary sports data provider.
- **SportsData API**: Secondary data source.

### Blockchain Services
- **Sui Network**: Layer 1 blockchain.
- **Move Language**: For smart contract development.
- **SBETS Token (Mainnet)**: `0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS`
- **Deployed Contract (Mainnet)**:
    - Package ID: `0xfaf371c3c9fe2544cc1ce9a40b07621503b300bf3a65b8fab0dba134636e8b32`
    - BettingPlatform (Shared): `0xae1b0dfed589c6ce5b7dafdb7477954670f0f73530668b5476e3a429b64099b3`
    - AdminCap: `0xaec276da96bc9fb7781213f3aedb18eacf30af1932dc577abbe5529583251827`
    - Admin Wallet (owns AdminCap): `0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50`

### Payment Integration
- **Stripe**: Optional fiat payment processing.

### Infrastructure
- **PostgreSQL**: Primary database.
- **WebSocket**: Real-time communication.
- **Railway**: Hosting for PostgreSQL and deployment.
- **Vercel**: Alternative for serverless functions and static assets.