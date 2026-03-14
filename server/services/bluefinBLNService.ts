/**
 * Bluefin BLN (Liquidity Network) Integration Service
 *
 * STATUS: Pre-built and ready — awaiting BLN partner whitelist confirmation from Bluefin.
 *
 * Once SuiBets is whitelisted:
 *   1. Set BLN_PARTNER_ADDRESS env var (provided by Bluefin after approval)
 *   2. Set BLN_MARKET_IDS env var (sport market IDs deployed on BLN)
 *   3. Set BLN_ENABLED=true
 *   4. All endpoints below become live automatically
 *
 * Partnership contact: partnerships@bluefin.io | discord.gg/bluefin (#bln-partners)
 * Announcement: https://bluefin.io/blog (March 9, 2026)
 */

const BLUEFIN_PERPS_API = 'https://dapi.api.sui-prod.bluefin.io';

export const BLN_ENABLED = process.env.BLN_ENABLED === 'true';
const BLN_PARTNER_ADDRESS = process.env.BLN_PARTNER_ADDRESS ?? '';

/**
 * Proposed SuiBets sports perp markets to launch on BLN.
 * These are the market specs we will submit to Bluefin for deployment.
 */
export const SUIBETS_BLN_MARKETS = [
  {
    id: 'MATCH_OUTCOME_PERP',
    name: 'Match Outcome Perpetual',
    description: 'Perpetual contract on binary match outcomes (Home/Away/Draw). Price tracks live betting odds from API-Sports.',
    assetType: 'SPORTS_MATCH_OUTCOME',
    leverage: 5,
    collateralToken: 'USDC',
    settlementToken: 'SBETS',
    feeRate: 0.05,
    maintenanceMargin: 0.025,
    initialMargin: 0.10,
    oracleProvider: 'API-Sports + Pyth',
    sports: ['football', 'basketball', 'tennis'],
    status: 'PENDING_BLN_APPROVAL',
  },
  {
    id: 'TOURNAMENT_WINNER_PERP',
    name: 'Tournament Winner Perpetual',
    description: 'Perpetual contract on tournament winner odds. Tracks Champions League, Premier League, NBA etc.',
    assetType: 'SPORTS_TOURNAMENT_WINNER',
    leverage: 3,
    collateralToken: 'USDC',
    settlementToken: 'SBETS',
    feeRate: 0.05,
    maintenanceMargin: 0.033,
    initialMargin: 0.15,
    oracleProvider: 'API-Sports + Pyth',
    sports: ['football', 'basketball', 'mma'],
    status: 'PENDING_BLN_APPROVAL',
  },
  {
    id: 'PLAYER_PERFORMANCE_PERP',
    name: 'Player Performance Perpetual',
    description: 'Perpetual contract on player performance metrics (goals scored, assists, points). Oracle: live stats feed.',
    assetType: 'SPORTS_PLAYER_STAT',
    leverage: 3,
    collateralToken: 'USDC',
    settlementToken: 'SBETS',
    feeRate: 0.075,
    maintenanceMargin: 0.033,
    initialMargin: 0.20,
    oracleProvider: 'API-Sports live stats',
    sports: ['football', 'basketball'],
    status: 'PENDING_BLN_APPROVAL',
  },
];

export interface BLNMarketTicker {
  symbol: string;
  indexPrice: string;
  markPrice: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  volume24H: string;
  priceChangePcnt24H: string;
  openInterest: string;
  fundingRate: string;
  nextFundingTime: number;
}

export interface BLNPosition {
  symbol: string;
  positionSide: string;
  positionQty: string;
  avgEntryPrice: string;
  unrealizedPnl: string;
  markPrice: string;
  leverage: number;
  liquidationPrice: string;
  marginType: string;
}

export interface BLNOrderBook {
  symbol: string;
  bids: Array<{ price: string; quantity: string }>;
  asks: Array<{ price: string; quantity: string }>;
  lastUpdatedAt: number;
}

async function blnFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${BLUEFIN_PERPS_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`BLN API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

export class BluefinBLNService {
  /**
   * Get all BLN sports perp market tickers.
   * These will return data once Bluefin deploys the SuiBets market IDs.
   */
  async getSportsMarketTickers(): Promise<BLNMarketTicker[]> {
    if (!BLN_ENABLED) return [];
    const marketSymbols = SUIBETS_BLN_MARKETS.map(m => m.id);
    const results: BLNMarketTicker[] = [];
    for (const symbol of marketSymbols) {
      try {
        const ticker = await blnFetch<BLNMarketTicker>('/ticker', { symbol });
        results.push(ticker);
      } catch {
        // Market not yet deployed — skip
      }
    }
    return results;
  }

  /**
   * Get order book for a specific sports perp market.
   */
  async getMarketOrderBook(symbol: string, limit = 20): Promise<BLNOrderBook | null> {
    if (!BLN_ENABLED) return null;
    return blnFetch<BLNOrderBook>('/orderbook', { symbol, limit });
  }

  /**
   * Get open positions for a wallet address across all BLN sports markets.
   */
  async getUserPositions(walletAddress: string): Promise<BLNPosition[]> {
    if (!BLN_ENABLED) return [];
    return blnFetch<BLNPosition[]>('/account', { parentAddress: walletAddress })
      .then((acc: any) => acc?.positions ?? []);
  }

  /**
   * Get partner revenue share info (requires BLN_PARTNER_ADDRESS).
   * Bluefin routes a % of trading fees to the partner address.
   */
  async getPartnerRevenueInfo(): Promise<{ partnerAddress: string; totalFeeShare: string; pendingPayout: string } | null> {
    if (!BLN_ENABLED || !BLN_PARTNER_ADDRESS) return null;
    return blnFetch('/partnerRevenue', { partnerAddress: BLN_PARTNER_ADDRESS }).catch(() => null);
  }

  /**
   * Returns the market configuration we will submit to Bluefin for BLN deployment.
   * Used in the partnership proposal and UI display.
   */
  getProposedMarkets() {
    return SUIBETS_BLN_MARKETS;
  }

  /**
   * Returns current BLN integration status for health/debug endpoints.
   */
  getStatus() {
    return {
      enabled: BLN_ENABLED,
      partnerAddress: BLN_PARTNER_ADDRESS ? `${BLN_PARTNER_ADDRESS.slice(0, 10)}…` : 'NOT_SET',
      proposedMarkets: SUIBETS_BLN_MARKETS.length,
      status: BLN_ENABLED ? 'ACTIVE' : 'PENDING_WHITELIST',
      docsUrl: 'https://learn.bluefin.io',
      partnershipContact: 'partnerships@bluefin.io',
    };
  }
}

export const bluefinBLNService = new BluefinBLNService();
