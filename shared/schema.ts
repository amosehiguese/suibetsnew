import { pgTable, text, serial, integer, boolean, timestamp, real, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Core app tables
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  // Seal pattern for wallet security - store fingerprint not actual address
  walletAddress: text("wallet_address").unique(), // Encrypted wallet address
  walletFingerprint: text("wallet_fingerprint").unique(), // Hash fingerprint of wallet address
  walletType: text("wallet_type").default("Sui"),
  balance: real("balance").default(0), // Legacy field for backward compatibility
  suiBalance: real("sui_balance").default(0),
  sbetsBalance: real("sbets_balance").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  // Wurlus protocol integration
  wurlusProfileId: text("wurlus_profile_id"), // Blockchain profile ID
  wurlusRegistered: boolean("wurlus_registered").default(false),
  wurlusProfileCreatedAt: timestamp("wurlus_profile_created_at"),
  lastLoginAt: timestamp("last_login_at")
});

export const sports = pgTable("sports", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  icon: text("icon"),
  // Wurlus protocol integration
  wurlusSportId: text("wurlus_sport_id"), // Blockchain sport ID
  isActive: boolean("is_active").default(true),
  providerId: text("provider_id") // ID of the data provider
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  sportId: integer("sport_id").references(() => sports.id),
  leagueName: text("league_name").notNull(),
  leagueSlug: text("league_slug").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  startTime: timestamp("start_time").notNull(),
  homeOdds: real("home_odds"),
  drawOdds: real("draw_odds"),
  awayOdds: real("away_odds"),
  isLive: boolean("is_live").default(false),
  score: text("score"),
  status: text("status").default("upcoming"),
  metadata: json("metadata"),
  // Wurlus protocol integration
  wurlusEventId: text("wurlus_event_id"), // Blockchain event ID
  wurlusMarketIds: text("wurlus_market_ids").array(), // Associated market IDs
  createdOnChain: boolean("created_on_chain").default(false),
  eventHash: text("event_hash"), // Hash identifier from blockchain
  providerId: text("provider_id") // ID of the data provider
});

export const markets = pgTable("markets", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id),
  marketTypeId: integer("market_type_id").references(() => marketTypes.id), // Reference to market type
  name: text("name").notNull(),
  marketType: text("market_type").notNull(), // e.g., moneyline, over/under, etc. (kept for backwards compatibility)
  status: text("status").default("open"),
  // Market-specific parameters
  parameters: json("parameters"), // Additional configuration for this specific market
  displayOrder: integer("display_order").default(0), // Order to display in UI
  // Wurlus protocol integration
  wurlusMarketId: text("wurlus_market_id").notNull().unique(), // Blockchain market ID
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
  creatorAddress: text("creator_address"), // Admin address that created it
  liquidityPool: real("liquidity_pool").default(0), // Amount in the market's liquidity pool
  transactionHash: text("transaction_hash") // Transaction hash for market creation
});

// Market types table to manage different bet types across sports
export const marketTypes = pgTable("market_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // Unique identifier (e.g., "OVER_UNDER", "CORRECT_SCORE")
  name: text("name").notNull(), // Display name
  sportId: integer("sport_id").references(() => sports.id), // Sport this market type applies to (null = all sports)
  description: text("description"), // Detailed explanation of the bet type
  parameters: json("parameters"), // Additional parameters needed (e.g., points for over/under)
  displayOrder: integer("display_order").default(0), // Order to display in UI
  isActive: boolean("is_active").default(true),
  // Parameters for special markets
  requiresPlayerSelection: boolean("requires_player_selection").default(false), // For player-specific bets
  requiresScoreSelection: boolean("requires_score_selection").default(false), // For correct score bets
  requiresTimeSelection: boolean("requires_time_selection").default(false), // For time-specific bets
  requiresNumericValue: boolean("requires_numeric_value").default(false), // For over/under bets
  defaultValue: real("default_value"), // Default value for numeric markets
  valueUnit: text("value_unit"), // Unit for the value (points, goals, etc.)
  // Sports-specific categorization
  category: text("category"), // E.g., "main", "props", "specials"
  createdAt: timestamp("created_at").defaultNow()
});

export const outcomes = pgTable("outcomes", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").references(() => markets.id),
  name: text("name").notNull(),
  odds: real("odds").notNull(),
  probability: real("probability"), // Calculated probability
  status: text("status").default("active"),
  // Wurlus protocol integration
  wurlusOutcomeId: text("wurlus_outcome_id").notNull().unique(), // Blockchain outcome ID
  transactionHash: text("transaction_hash"), // Transaction hash for outcome creation
  isWinner: boolean("is_winner").default(false)
});

export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  walletAddress: text("wallet_address"), // Store wallet address for settlement
  eventId: integer("event_id").references(() => events.id),
  marketId: integer("market_id").references(() => markets.id),
  outcomeId: integer("outcome_id").references(() => outcomes.id),
  betAmount: real("bet_amount").notNull(),
  currency: text("currency").default("SUI"), // "SUI" or "SBETS" - explicit token tracking
  odds: real("odds").notNull(),
  prediction: text("prediction").notNull(),
  potentialPayout: real("potential_payout").notNull(),
  status: text("status").default("pending"),
  result: text("result"),
  payout: real("payout"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Bet type
  betType: text("bet_type").default("single"), // single, parlay
  // Cash-out options
  cashOutAvailable: boolean("cash_out_available").default(false),
  cashOutAmount: real("cash_out_amount"),
  cashOutAt: timestamp("cash_out_at"),
  // Parlay related
  parlayId: integer("parlay_id").references(() => parlays.id),
  // Wurlus protocol integration
  wurlusBetId: text("wurlus_bet_id"), // Blockchain bet ID
  betObjectId: text("bet_object_id"), // On-chain Sui bet object ID (for contract-based settlement)
  txHash: text("tx_hash"), // Transaction hash for bet placement
  settlementTxHash: text("settlement_tx_hash"), // Transaction hash for bet settlement/payout
  platformFee: real("platform_fee"), // Platform fee in SUI
  networkFee: real("network_fee"), // Network fee in SUI
  feeCurrency: text("fee_currency").default("SUI"), // Currency of fees
  // Event display name for bet history
  eventName: text("event_name"), // Store event name for display in bet history
  // External API event ID for settlement matching (e.g., API-Sports fixture ID)
  externalEventId: text("external_event_id"), // String event ID from sports API for settlement
  // Team names for settlement matching
  homeTeam: text("home_team"), // Home team name for settlement
  awayTeam: text("away_team"), // Away team name for settlement
  // Withdrawal tracking
  winningsWithdrawn: boolean("winnings_withdrawn").default(false) // Track if winnings have been withdrawn
});

// Parlay bets (combines multiple bets into one wager)
export const parlays = pgTable("parlays", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  betAmount: real("bet_amount").notNull(),
  totalOdds: real("total_odds").notNull(),
  potentialPayout: real("potential_payout").notNull(),
  status: text("status").default("pending"),
  result: text("result"),
  payout: real("payout"),
  settledAt: timestamp("settled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Cash-out options
  cashOutAvailable: boolean("cash_out_available").default(false),
  cashOutAmount: real("cash_out_amount"),
  cashOutAt: timestamp("cash_out_at"),
  // Wurlus protocol integration
  wurlusParlayId: text("wurlus_parlay_id"), // Blockchain parlay ID
  txHash: text("tx_hash"), // Transaction hash for parlay placement
  platformFee: real("platform_fee"), // Platform fee in SUI
  networkFee: real("network_fee"), // Network fee in SUI
  feeCurrency: text("fee_currency").default("SUI") // Currency of fees
});

// Bet legs (individual bets within a parlay)
export const betLegs = pgTable("bet_legs", {
  id: serial("id").primaryKey(),
  parlayId: integer("parlay_id").references(() => parlays.id),
  eventId: integer("event_id").references(() => events.id),
  marketId: integer("market_id").references(() => markets.id),
  outcomeId: integer("outcome_id").references(() => outcomes.id),
  odds: real("odds").notNull(),
  prediction: text("prediction").notNull(),
  status: text("status").default("pending"),
  result: text("result"),
  createdAt: timestamp("created_at").defaultNow(),
  // Wurlus protocol integration 
  wurlusLegId: text("wurlus_leg_id"), // Blockchain leg ID
  isWinner: boolean("is_winner").default(false)
});

// Wurlus Protocol specific tables
export const wurlusStaking = pgTable("wurlus_staking", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  walletAddress: text("wallet_address").notNull(),
  amountStaked: real("amount_staked").notNull(),
  stakingDate: timestamp("staking_date").defaultNow(),
  unstakingDate: timestamp("unstaking_date"),
  isActive: boolean("is_active").default(true),
  txHash: text("tx_hash"), // Transaction hash for staking
  lockedUntil: timestamp("locked_until"), // Timestamp when tokens can be unstaked
  rewardRate: real("reward_rate"), // Current reward rate
  accumulatedRewards: real("accumulated_rewards").default(0) // Total rewards accumulated
});

export const wurlusDividends = pgTable("wurlus_dividends", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  walletAddress: text("wallet_address").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  dividendAmount: real("dividend_amount").notNull(),
  status: text("status").default("pending"), // pending, available, claimed
  claimedAt: timestamp("claimed_at"),
  claimTxHash: text("claim_tx_hash"), // Transaction hash for claiming
  platformFee: real("platform_fee") // Platform fee taken on dividends
});

export const wurlus_wallet_operations = pgTable("wurlus_wallet_operations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  walletAddress: text("wallet_address").notNull(),
  operationType: text("operation_type").notNull(), // deposit, withdraw, bet, win, stake, unstake, claim
  amount: real("amount").notNull(),
  txHash: text("tx_hash").notNull(),
  status: text("status").default("completed"),
  timestamp: timestamp("timestamp").defaultNow(),
  metadata: json("metadata") // Additional operation details
});

export const promotions = pgTable("promotions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  type: text("type").notNull(),
  amount: real("amount"),
  code: text("code"),
  minDeposit: real("min_deposit"),
  rolloverSports: real("rollover_sports"),
  rolloverCasino: real("rollover_casino"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  isActive: boolean("is_active").default(true),
  // Wurlus protocol integration
  wurlusPromotionId: text("wurlus_promotion_id"), // If this promotion exists on-chain
  smartContractAddress: text("smart_contract_address") // Address of promotion smart contract
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  // Wurlus protocol integration
  relatedTxHash: text("related_tx_hash"), // If notification is related to a blockchain tx
  notificationType: text("notification_type").default("app"), // app, blockchain, system
  priority: text("priority").default("normal") // high, normal, low
});

// Insert Schemas
export const insertUserSchema = createInsertSchema(users)
  .pick({
    username: true,
    password: true,
    email: true,
    walletAddress: true, 
    walletFingerprint: true,
    walletType: true,
    suiBalance: true,
    sbetsBalance: true
  })
  .partial({ 
    password: true, // Make password optional for wallet-based users
    walletAddress: true, // Wallet address might be encrypted later
    walletFingerprint: true, // Fingerprint is generated from the wallet address
    suiBalance: true, // Balances are initialized with defaults
    sbetsBalance: true
  });

export const insertSportSchema = createInsertSchema(sports).pick({
  name: true,
  slug: true,
  icon: true,
  wurlusSportId: true,
  isActive: true,
  providerId: true
});

export const insertEventSchema = createInsertSchema(events).pick({
  sportId: true,
  leagueName: true,
  leagueSlug: true,
  homeTeam: true,
  awayTeam: true,
  startTime: true,
  homeOdds: true,
  drawOdds: true,
  awayOdds: true,
  isLive: true,
  score: true,
  status: true,
  metadata: true,
  wurlusEventId: true,
  createdOnChain: true,
  providerId: true
});

export const insertMarketSchema = createInsertSchema(markets).pick({
  eventId: true,
  marketTypeId: true,
  name: true,
  marketType: true,
  status: true,
  parameters: true,
  displayOrder: true,
  wurlusMarketId: true,
  creatorAddress: true,
  liquidityPool: true,
  transactionHash: true
});

export const insertMarketTypeSchema = createInsertSchema(marketTypes).pick({
  code: true,
  name: true,
  sportId: true,
  description: true,
  parameters: true,
  displayOrder: true,
  isActive: true,
  requiresPlayerSelection: true,
  requiresScoreSelection: true,
  requiresTimeSelection: true,
  requiresNumericValue: true,
  defaultValue: true,
  valueUnit: true,
  category: true
});

export const insertOutcomeSchema = createInsertSchema(outcomes).pick({
  marketId: true,
  name: true,
  odds: true,
  probability: true,
  status: true,
  // Blockchain fields
  wurlusOutcomeId: true,
  transactionHash: true,
  isWinner: true
});

export const insertBetSchema = createInsertSchema(bets)
  .pick({
    userId: true,
    eventId: true,
    marketId: true,
    outcomeId: true,
    betAmount: true,
    odds: true,
    prediction: true,
    potentialPayout: true,
    betType: true,
    parlayId: true,
    wurlusBetId: true,
    txHash: true,
    platformFee: true,
    networkFee: true,
    feeCurrency: true
  });

export const insertWurlusStakingSchema = createInsertSchema(wurlusStaking).pick({
  userId: true,
  walletAddress: true,
  amountStaked: true,
  stakingDate: true,
  txHash: true,
  lockedUntil: true,
  rewardRate: true
});

export const insertWurlusDividendSchema = createInsertSchema(wurlusDividends).pick({
  userId: true,
  walletAddress: true,
  periodStart: true,
  periodEnd: true,
  dividendAmount: true,
  status: true
});

export const insertWurlusWalletOperationSchema = createInsertSchema(wurlus_wallet_operations).pick({
  userId: true,
  walletAddress: true,
  operationType: true,
  amount: true,
  txHash: true,
  status: true,
  metadata: true
});

export const insertPromotionSchema = createInsertSchema(promotions).pick({
  title: true,
  description: true,
  imageUrl: true,
  type: true,
  amount: true,
  code: true,
  minDeposit: true,
  rolloverSports: true,
  rolloverCasino: true,
  startDate: true,
  endDate: true,
  isActive: true,
  wurlusPromotionId: true,
  smartContractAddress: true
});

export const insertNotificationSchema = createInsertSchema(notifications).pick({
  userId: true,
  title: true,
  message: true,
  relatedTxHash: true,
  notificationType: true,
  priority: true
});

export const insertParlaySchema = createInsertSchema(parlays).pick({
  userId: true,
  betAmount: true,
  totalOdds: true,
  potentialPayout: true,
  wurlusParlayId: true,
  txHash: true,
  platformFee: true,
  networkFee: true,
  feeCurrency: true
});

export const insertBetLegSchema = createInsertSchema(betLegs).pick({
  parlayId: true,
  eventId: true,
  marketId: true,
  outcomeId: true,
  odds: true,
  prediction: true,
  wurlusLegId: true
});

// Type Exports
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertSport = z.infer<typeof insertSportSchema>;
export type Sport = typeof sports.$inferSelect;

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;

export type InsertMarketType = z.infer<typeof insertMarketTypeSchema>;
export type MarketType = typeof marketTypes.$inferSelect;

export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type Market = typeof markets.$inferSelect;

export type InsertOutcome = z.infer<typeof insertOutcomeSchema>;
export type Outcome = typeof outcomes.$inferSelect;

export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof bets.$inferSelect;

export type InsertWurlusStaking = z.infer<typeof insertWurlusStakingSchema>;
export type WurlusStaking = typeof wurlusStaking.$inferSelect;

export type InsertWurlusDividend = z.infer<typeof insertWurlusDividendSchema>;
export type WurlusDividend = typeof wurlusDividends.$inferSelect;

export type InsertWurlusWalletOperation = z.infer<typeof insertWurlusWalletOperationSchema>;
export type WurlusWalletOperation = typeof wurlus_wallet_operations.$inferSelect;

export type InsertPromotion = z.infer<typeof insertPromotionSchema>;
export type Promotion = typeof promotions.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export type InsertParlay = z.infer<typeof insertParlaySchema>;
export type Parlay = typeof parlays.$inferSelect;

export type InsertBetLeg = z.infer<typeof insertBetLegSchema>;
export type BetLeg = typeof betLegs.$inferSelect;

// Wallet type for Sui
export type WalletType = 'Sui' | 'Suiet' | 'Nightly' | 'WalletConnect';

// Settled events tracking table (for bet settlement persistence)
export const settledEvents = pgTable("settled_events", {
  id: serial("id").primaryKey(),
  externalEventId: text("external_event_id").notNull().unique(), // API event ID
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  winner: text("winner"), // 'home', 'away', 'draw'
  settledAt: timestamp("settled_at").defaultNow(),
  betsSettled: integer("bets_settled").default(0) // Number of bets settled for this event
});

export const insertSettledEventSchema = createInsertSchema(settledEvents).omit({ id: true, settledAt: true });
export type InsertSettledEvent = z.infer<typeof insertSettledEventSchema>;
export type SettledEvent = typeof settledEvents.$inferSelect;
