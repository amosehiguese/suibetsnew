import { createHash } from 'crypto';

const WALRUS_PUBLISHERS = [
  'https://publisher.walrus-mainnet.walrus.space/v1/blobs',
  'https://walrus-publisher.staketab.org/v1/blobs',
  'https://publisher.walrus.space/v1/blobs',
  'https://walrus-publisher-mainnet.nodes.guru/v1/blobs',
];
const WALRUS_AGGREGATORS = [
  'https://aggregator.walrus-mainnet.walrus.space/v1/blobs',
  'https://walrus-aggregator.staketab.org/v1/blobs',
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
    version: '1.0',
    type: 'bet_receipt',
    ...data,
    storedAt: Date.now(),
    chain: 'sui:mainnet',
    walrusNetwork: 'mainnet',
  };
  return JSON.stringify(receipt);
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
      signal: AbortSignal.timeout(20000),
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
        signal: AbortSignal.timeout(10000),
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
