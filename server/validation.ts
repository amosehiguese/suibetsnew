/**
 * Validation Schemas for SuiBets API
 */

import { z } from 'zod';

// Bet amount validation - min 0.02 SUI, max 10,000 SUI
export const BetAmountSchema = z.number()
  .min(0.02, 'Minimum bet is 0.02 SUI')
  .max(10000, 'Maximum bet is 10,000 SUI')
  .positive('Bet amount must be positive');

// Odds validation - between 1.01 and 1000
export const OddsSchema = z.number()
  .min(1.01, 'Minimum odds is 1.01')
  .max(1000, 'Maximum odds is 1000')
  .positive('Odds must be positive');

// Bet placement schema
export const PlaceBetSchema = z.object({
  userId: z.union([z.string(), z.number()]).transform(v => String(v)).optional().default('user1'),
  walletAddress: z.string().optional(),
  eventId: z.union([z.string(), z.number()]).transform(v => String(v)).pipe(z.string().min(1, 'Event ID required')),
  eventName: z.string().optional(), // Event name for bet history display
  homeTeam: z.string().optional(), // Home team name for settlement matching
  awayTeam: z.string().optional(), // Away team name for settlement matching
  marketId: z.string().optional().default('match_winner'),
  outcomeId: z.string().optional().default('selection'),
  odds: OddsSchema,
  betAmount: BetAmountSchema,
  currency: z.enum(['SUI', 'SBETS']).optional().default('SUI'), // Token type for the bet
  prediction: z.string().min(1, 'Prediction required'),
  potentialPayout: z.number().optional(),
  feeCurrency: z.enum(['SUI', 'SBETS']).optional().default('SUI'),
  paymentMethod: z.enum(['platform', 'wallet']).optional().default('platform'),
  txHash: z.string().optional(), // For wallet/on-chain bets
  onChainBetId: z.string().optional(), // Sui bet object ID
  status: z.enum(['pending', 'confirmed', 'settled', 'cancelled']).optional().default('pending'),
  isLive: z.boolean().optional(), // Whether this is a live match
  matchMinute: z.number().optional() // Current match minute for live matches (betting blocked >= 80)
});

// Parlay schema
export const ParlaySchema = z.object({
  userId: z.string().optional().default('user1'),
  selections: z.array(
    z.object({
      eventId: z.string(),
      odds: OddsSchema,
      prediction: z.string()
    })
  ).min(2, 'Parlay requires at least 2 selections').max(10, 'Maximum 10 selections per parlay'),
  betAmount: BetAmountSchema,
  feeCurrency: z.enum(['SUI', 'SBETS']).optional().default('SUI')
});

// Withdrawal schema
export const WithdrawSchema = z.object({
  userId: z.string().optional().default('user1'),
  amount: z.number()
    .min(0.1, 'Minimum withdrawal is 0.1 SUI')
    .max(10000, 'Maximum withdrawal is 10,000 SUI')
    .positive('Amount must be positive')
});

// Settlement schema
export const SettleSchema = z.object({
  eventResult: z.object({
    eventId: z.string(),
    result: z.string(),
    homeScore: z.number().optional(),
    awayScore: z.number().optional(),
    winner: z.string().optional()
  })
});

// Cash out schema
export const CashOutSchema = z.object({
  currentOdds: z.number().min(1, 'Odds must be at least 1'),
  percentageWinning: z.number().min(0, 'Percentage must be positive').max(1, 'Percentage must be <= 1')
});

/**
 * Validate request data
 */
export function validateRequest<T>(schema: z.ZodSchema<T>, data: any): { valid: boolean; errors?: string[]; data?: T } {
  try {
    const validated = schema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return { valid: false, errors };
    }
    return { valid: false, errors: ['Validation error'] };
  }
}

export default {
  BetAmountSchema,
  OddsSchema,
  PlaceBetSchema,
  ParlaySchema,
  WithdrawSchema,
  SettleSchema,
  CashOutSchema,
  validateRequest
};
