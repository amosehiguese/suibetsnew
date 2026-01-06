import { ReactNode } from 'react';

// Base Event type
export interface Event {
  id: number | string; // Support both numeric and string IDs
  sportId: number;
  leagueName: string;
  leagueSlug?: string; // Added to support league-based URL routes
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  endTime?: string;
  isLive: boolean;
  score?: string;
  status: 'upcoming' | 'live' | 'finished' | 'cancelled';
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  markets?: Market[];
  // Cricket-specific fields
  venue?: string;
  format?: string;
}

// Market type for betting options
export interface Market {
  id: number;
  name: string;
  type: string;
  status: 'open' | 'suspended' | 'closed' | 'settled';
  outcomes: Outcome[];
}

// Outcome type for each betting option
export interface Outcome {
  id: string;
  name: string;
  odds: number;
  status: 'active' | 'suspended' | 'settled';
  probability?: number;
  isWinner?: boolean;
}

// Selected bet for the betting slip
export interface SelectedBet {
  id: string; // Unique identifier for this bet
  eventId: string; // Changed to string to handle API-Sports IDs which are strings
  eventName: string;
  selectionName: string;
  odds: number;
  stake: number;
  market: string;
  marketId?: number;
  outcomeId?: string | number; // Allow string or number for outcome IDs
  isLive?: boolean; // Indicates if this is a live betting event
  matchMinute?: number; // Current match minute for live events (betting blocked >= 80)
  currency?: 'SUI' | 'SBETS'; // Currency for this specific bet
  uniqueId?: string; // Optional unique identifier to prevent duplicates
}

// Betting context interface
export interface BettingContextType {
  selectedBets: SelectedBet[];
  addBet: (bet: SelectedBet) => void;
  removeBet: (id: string) => void;
  clearBets: () => void;
  placeBet: (betAmount: number, options?: PlaceBetOptions) => Promise<boolean>;
  totalStake: number;
  potentialWinnings: number;
  updateStake: (id: string, stake: number) => void;
}

// Options for placing bets
export interface PlaceBetOptions {
  betType?: 'single' | 'parlay';
  currency?: 'SUI' | 'SBETS';
  acceptOddsChange?: boolean;
}

// Bet history entry
export interface BetHistoryEntry {
  id: number;
  eventId: number;
  marketId: number;
  betAmount: number;
  odds: number;
  prediction: string;
  potentialPayout: number;
  status: 'pending' | 'won' | 'lost' | 'cashed_out';
  result: string | null;
  payout: number | null;
  createdAt: string;
  settledAt: string | null;
  betType: 'single' | 'parlay';
  feeCurrency: 'SUI' | 'SBETS';
  // Event-related data (joined from events table)
  eventName?: string;
  homeTeam?: string;
  awayTeam?: string;
  // Wurlus protocol data
  wurlusBetId?: string;
  txHash?: string;
  // Cash out data
  cashOutAvailable?: boolean;
  cashOutAmount?: number;
  cashOutAt?: string;
}

// Parlay bet
export interface ParlayBet {
  id: number;
  userId: number;
  totalOdds: number;
  betAmount: number;
  potentialPayout: number;
  status: 'pending' | 'won' | 'lost' | 'partially_won' | 'cashed_out';
  createdAt: string;
  settledAt: string | null;
  legs: BetLeg[];
  // Wurlus protocol data
  wurlus_parlay_id?: string;
  txHash?: string;
  // Fee data
  platformFee?: number;
  networkFee?: number;
  feeCurrency: 'SUI' | 'SBETS';
}

// Leg of a parlay bet
export interface BetLeg {
  id: number;
  parlayId: number;
  eventId: number;
  marketId: number;
  outcomeId: string | null;
  odds: number;
  prediction: string;
  status: 'pending' | 'won' | 'lost';
  result?: string;
  // Event-related data
  eventName?: string;
  homeTeam?: string;
  awayTeam?: string;
  marketName?: string;
}

// User data
export interface User {
  id: number;
  username: string;
  email?: string;
  walletAddress?: string;
  walletType?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  balance?: {
    SUI: number;
    SBETS: number;
  };
  isVerified?: boolean;
  isAdmin?: boolean;
  createdAt: string;
}

// Authentication context
export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (walletAddress: string, walletType: string) => Promise<boolean>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
}

// Provider props
export interface ProviderProps {
  children: ReactNode;
}

// Sport with supported market types
export interface Sport {
  id: number;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
  isFeatured?: boolean;
  marketTypes?: SportMarketType[];
}

// Market type for a sport
export interface SportMarketType {
  id: number;
  name: string;
  code: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

// Live event data for streaming
export interface LiveEventData {
  eventId: number;
  sportId: number;
  homeTeam: string;
  awayTeam: string;
  score: string;
  time: string;
  status: 'live' | 'paused' | 'finished';
  period?: string;
  lastUpdate: string;
  statistics?: any;
  eventUpdates?: LiveEventUpdate[];
}

// Update for a live event
export interface LiveEventUpdate {
  id: number;
  eventId: number;
  type: 'goal' | 'card' | 'substitution' | 'injury' | 'var' | 'other';
  team: 'home' | 'away';
  playerName?: string;
  minute?: number;
  description: string;
  timestamp: string;
}

// Notification
export interface Notification {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: 'bet_won' | 'bet_lost' | 'cash_out' | 'promotion' | 'system' | 'deposit' | 'withdrawal';
  isRead: boolean;
  createdAt: string;
  link?: string;
  data?: any;
}

// Wallet connection data
export interface WalletData {
  address: string;
  type: string;
  network: string;
  balance?: {
    SUI: number;
    SBETS: number;
  };
}

// Wurlus protocol staking data
export interface WurlusStaking {
  userId: number;
  walletAddress: string;
  amountStaked: number;
  stakingDate: string;
  unstakingDate?: string;
  isActive: boolean;
  txHash?: string;
  lockedUntil?: string;
  rewardRate?: number;
  accumulatedRewards: number;
}

// Wurlus protocol dividend data
export interface WurlusDividend {
  userId: number;
  walletAddress: string;
  amount: number;
  distributionDate: string;
  claimed: boolean;
  claimedDate?: string;
  txHash?: string;
  periodStart: string;
  periodEnd: string;
}

// Promotion
export interface Promotion {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  type: 'deposit' | 'signup' | 'referral' | 'risk_free' | 'odds_boost';
  code?: string;
  terms?: string;
  link?: string;
}