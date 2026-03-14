/**
 * Bluefin Exchange Service
 * Proxies requests to the Bluefin decentralized perps exchange on Sui mainnet.
 * Docs: https://bluefin-exchange.readme.io
 */

const BLUEFIN_BASE_URL = 'https://dapi.api.sui-prod.bluefin.io';

export interface BluefinTicker {
  symbol: string;
  indexPrice: string;
  markPrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  askPrice: string;
  high24H: string;
  low24H: string;
  volume24H: string;
  quoteVolume24H: string;
  priceChange24H: string;
  priceChangePcnt24H: string;
  openInterest: string;
  fundingRate: string;
  nextFundingTime: number;
  oraclePrice: string;
}

export interface BluefinOrderBookEntry {
  price: string;
  quantity: string;
}

export interface BluefinOrderBook {
  symbol: string;
  asks: BluefinOrderBookEntry[];
  bids: BluefinOrderBookEntry[];
  lastUpdatedAt: number;
}

export interface BluefinTrade {
  symbol: string;
  price: string;
  quantity: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
}

export interface BluefinCandle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface BluefinMarket {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  minOrderSize: string;
  maxOrderSize: string;
  stepSize: string;
  tickSize: string;
  maxLeverage: number;
  defaultLeverage: number;
  maintenanceMarginRequired: string;
  initialMarginRequired: string;
  mtbLong: string;
  mtbShort: string;
}

export interface BluefinFundingRate {
  symbol: string;
  fundingRate: string;
  nextFundingTime: number;
  time: number;
}

export interface BluefinPosition {
  symbol: string;
  positionSide: string;
  quantityReduced: string;
  avgEntryPrice: string;
  leverage: number;
  positionQty: string;
  unrealizedProfit: string;
  unrealizedPnl: string;
  marginType: string;
  isolatedMargin: string;
  initialMargin: string;
  maintenanceMargin: string;
  liquidationPrice: string;
  markPrice: string;
  indexPrice: string;
}

export interface BluefinOrder {
  id: string;
  symbol: string;
  orderType: string;
  side: string;
  price: string;
  quantity: string;
  filledQty: string;
  avgFillPrice: string;
  status: string;
  leverage: number;
  reduceOnly: boolean;
  clientId: string;
  fee: string;
  feeCurrency: string;
  salt: string;
  createdAt: number;
  updatedAt: number;
}

export interface BluefinUserTrade {
  id: string;
  symbol: string;
  orderId: string;
  side: string;
  price: string;
  quantity: string;
  fee: string;
  feeCurrency: string;
  realizedPnl: string;
  isMaker: boolean;
  createdAt: number;
}

export interface BluefinFundingHistory {
  id: string;
  symbol: string;
  positionSide: string;
  fundingRate: string;
  payment: string;
  status: string;
  createdAt: number;
}

export interface BluefinTransaction {
  id: string;
  symbol: string;
  type: string;
  amount: string;
  asset: string;
  status: string;
  txHash: string;
  createdAt: number;
}

export interface BluefinAccount {
  address: string;
  accountValue: string;
  availableMargin: string;
  marginRatio: string;
  totalPositionMargin: string;
  totalOrderMargin: string;
  unrealizedProfit: string;
  positions: BluefinPosition[];
  canTrade: boolean;
  muteStatus: boolean;
  leverage: Record<string, number>;
}

async function bluefinFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${BLUEFIN_BASE_URL}${path}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) url.searchParams.set(key, String(val));
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Bluefin API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export class BluefinService {
  /** Get all available perpetual markets */
  async getMarkets(): Promise<BluefinMarket[]> {
    const data = await bluefinFetch<{ contracts: BluefinMarket[] }>('/exchangeInfo');
    return data.contracts || [];
  }

  /** Get ticker data for one or all symbols */
  async getTicker(symbol?: string): Promise<BluefinTicker[]> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = symbol;
    const data = await bluefinFetch<BluefinTicker[]>('/ticker', params);
    return Array.isArray(data) ? data : [data];
  }

  /** Get order book depth for a symbol */
  async getOrderBook(symbol: string, limit = 20): Promise<BluefinOrderBook> {
    return bluefinFetch<BluefinOrderBook>('/orderbook', { symbol, limit });
  }

  /** Get recent trades for a symbol */
  async getRecentTrades(symbol: string, limit = 30): Promise<BluefinTrade[]> {
    return bluefinFetch<BluefinTrade[]>('/recentTrades', { symbol, limit });
  }

  /** Get OHLCV candlestick data */
  async getCandlesticks(
    symbol: string,
    interval: string = '1h',
    limit = 100,
    startTime?: number,
    endTime?: number
  ): Promise<BluefinCandle[]> {
    return bluefinFetch<BluefinCandle[]>('/candlestickData', {
      symbol,
      interval,
      limit,
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
    });
  }

  /** Get current funding rate */
  async getFundingRate(symbol?: string): Promise<BluefinFundingRate[]> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = symbol;
    const data = await bluefinFetch<BluefinFundingRate | BluefinFundingRate[]>('/fundingRate', params);
    return Array.isArray(data) ? data : [data];
  }

  /** Get account info for a wallet address */
  async getAccount(address: string): Promise<BluefinAccount> {
    return bluefinFetch<BluefinAccount>('/account', { parentAddress: address });
  }

  /** Get open/recent orders for an account */
  async getOrders(
    address: string,
    symbol?: string,
    statuses: string = 'OPEN,PARTIAL_FILLED'
  ): Promise<BluefinOrder[]> {
    return bluefinFetch<BluefinOrder[]>('/orders', {
      parentAddress: address,
      ...(symbol && { symbol }),
      statuses,
    });
  }

  /** Get user's trade history */
  async getUserTrades(
    address: string,
    symbol?: string,
    limit = 50,
    pageNumber = 1
  ): Promise<BluefinUserTrade[]> {
    return bluefinFetch<BluefinUserTrade[]>('/userTrades', {
      parentAddress: address,
      ...(symbol && { symbol }),
      limit,
      pageNumber,
    });
  }

  /**
   * Get account funding rate payment history
   * https://bluefin-exchange.readme.io/reference/getaccountfundingratehistory
   */
  async getFundingHistory(
    address: string,
    symbol?: string,
    limit = 50,
    pageNumber = 1,
    startTime?: number,
    endTime?: number
  ): Promise<BluefinFundingHistory[]> {
    return bluefinFetch<BluefinFundingHistory[]>('/userFundingHistory', {
      parentAddress: address,
      ...(symbol && { symbol }),
      limit,
      pageNumber,
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
    });
  }

  /**
   * Get account transaction history (deposits, withdrawals, transfers, etc.)
   * https://bluefin-exchange.readme.io/reference/getaccounttransactionhistory
   */
  async getUserTransactionHistory(
    address: string,
    symbol?: string,
    limit = 50,
    pageNumber = 1,
    startTime?: number,
    endTime?: number
  ): Promise<BluefinTransaction[]> {
    return bluefinFetch<BluefinTransaction[]>('/userTransactionHistory', {
      parentAddress: address,
      ...(symbol && { symbol }),
      limit,
      pageNumber,
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
    });
  }
}

export const bluefinService = new BluefinService();
