import { createHash } from 'crypto';

const WALRUS_PUBLISHERS = [
  'https://publisher.walrus-mainnet.walrus.space/v1/blobs',
  'https://walrus-publisher.nodes.guru/v1/blobs',
  'https://publisher.walrus.space/v1/blobs',
];
const WALRUS_AGGREGATORS = [
  'https://aggregator.walrus-mainnet.walrus.space/v1/blobs',
  'https://aggregator.walrus.space/v1/blobs',
];
const STORE_EPOCHS = 5;

interface BetReceiptData {
  betId: string;
  walletAddress: string;
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  odds: number;
  stake: number;
  currency: string;
  potentialPayout: number;
  txHash?: string;
  betObjectId?: string;
  placedAt: number;
  sportName?: string;
  marketType?: string;
}

interface WalrusStoreResponse {
  blobId: string | null;
  receiptJson: string;
  receiptHash: string;
  publisherUsed?: string;
  error?: string;
}

function generateReceiptJson(data: BetReceiptData): string {
  const receipt = {
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
      id: data.betId,
      walletAddress: data.walletAddress,
      eventId: data.eventId,
      eventName: data.eventName,
      homeTeam: data.homeTeam,
      awayTeam: data.awayTeam,
      prediction: data.prediction,
      odds: data.odds,
      stake: data.stake,
      currency: data.currency,
      potentialPayout: data.potentialPayout,
      sportName: data.sportName || null,
      marketType: data.marketType || 'match_winner',
    },
    blockchain: {
      chain: 'sui:mainnet',
      network: 'mainnet',
      txHash: data.txHash || null,
      betObjectId: data.betObjectId || null,
      token: data.currency === 'SBETS'
        ? '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS'
        : '0x2::sui::SUI',
      contract: '0x737324ddac9fb96e3d7ffab524f5489c1a0b3e5b4bffa2f244303005001b4ada',
      platform: '0x5fc1073c9533c6737fa3a0882055d1778602681df70bdabde96b0127b588f082',
    },
    storage: {
      protocol: 'walrus',
      network: 'mainnet',
      storedAt: Date.now(),
      placedAt: data.placedAt,
    },
    verification: {
      receiptHash: createHash('sha256').update(JSON.stringify({
        betId: data.betId,
        walletAddress: data.walletAddress,
        eventId: data.eventId,
        prediction: data.prediction,
        odds: data.odds,
        stake: data.stake,
        currency: data.currency,
        placedAt: data.placedAt,
      })).digest('hex'),
      algorithm: 'sha256',
      fields: ['betId', 'walletAddress', 'eventId', 'prediction', 'odds', 'stake', 'currency', 'placedAt'],
    },
  };
  return JSON.stringify(receipt, null, 2);
}

function hashReceipt(json: string): string {
  return createHash('sha256').update(json).digest('hex').slice(0, 32);
}

function extractBlobId(result: any): string | null {
  if (result?.newlyCreated?.blobObject?.blobId) {
    return result.newlyCreated.blobObject.blobId;
  }
  if (result?.alreadyCertified?.blobId) {
    return result.alreadyCertified.blobId;
  }
  if (typeof result?.blobId === 'string') {
    return result.blobId;
  }
  if (Array.isArray(result) && result[0]?.blobStoreResult) {
    const inner = result[0].blobStoreResult;
    return inner?.newlyCreated?.blobObject?.blobId || inner?.alreadyCertified?.blobId || null;
  }
  return null;
}

async function tryPublisher(publisherUrl: string, receiptJson: string): Promise<{ blobId: string; publisher: string } | null> {
  try {
    const url = `${publisherUrl}?epochs=${STORE_EPOCHS}&send=true`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: receiptJson,
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[Walrus] Publisher ${publisherUrl} returned ${response.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const result = await response.json();
    const blobId = extractBlobId(result);

    if (blobId) {
      return { blobId, publisher: publisherUrl };
    }

    console.warn(`[Walrus] No blobId from ${publisherUrl}:`, JSON.stringify(result).slice(0, 300));
    return null;
  } catch (err: any) {
    console.warn(`[Walrus] Publisher ${publisherUrl} failed: ${err.message}`);
    return null;
  }
}

async function storeViaHttp(receiptJson: string): Promise<{ blobId: string; publisher: string } | null> {
  for (const publisherUrl of WALRUS_PUBLISHERS) {
    const result = await tryPublisher(publisherUrl, receiptJson);
    if (result) return result;
  }
  return null;
}

export async function storeBetReceipt(data: BetReceiptData): Promise<WalrusStoreResponse> {
  const receiptJson = generateReceiptJson(data);
  const receiptHash = hashReceipt(receiptJson);

  const result = await storeViaHttp(receiptJson);

  if (result) {
    console.log(`🐋 Walrus MAINNET receipt stored: ${result.blobId} (via ${result.publisher})`);
    return { blobId: result.blobId, receiptJson, receiptHash, publisherUsed: result.publisher };
  }

  console.warn(`[Walrus] All publishers failed — receipt stored locally (hash: ${receiptHash})`);
  return { blobId: null, receiptJson, receiptHash, error: 'All Walrus publishers unreachable' };
}

export async function getBetReceipt(blobId: string): Promise<any | null> {
  for (const aggregatorBase of WALRUS_AGGREGATORS) {
    try {
      const response = await fetch(`${aggregatorBase}/${blobId}`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) continue;

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text, format: 'text' };
      }
    } catch (err: any) {
      console.warn(`[Walrus] Aggregator ${aggregatorBase} failed for ${blobId}: ${err.message}`);
    }
  }

  return null;
}

export function getWalrusAggregatorUrl(blobId: string): string {
  return `${WALRUS_AGGREGATORS[0]}/${blobId}`;
}
