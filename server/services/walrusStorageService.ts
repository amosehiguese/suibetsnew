import { createHash } from 'crypto';

// =============================================================================
// Publisher list — ordered by reliability.
// Only walrus-mainnet-publisher-1.staketab.org is confirmed working on mainnet
// as of March 2026 (per live testing). Others are kept as fallbacks in case
// they come back online, but tried with shorter timeouts.
// Official list: https://github.com/MystenLabs/awesome-walrus
// =============================================================================
const WALRUS_PUBLISHERS: Array<{ url: string; timeout: number; priority: 'primary' | 'secondary' }> = [
  // PRIMARY — confirmed working March 2026
  { url: 'https://walrus-mainnet-publisher-1.staketab.org/v1/blobs', timeout: 30000, priority: 'primary' },
  // SECONDARY — Mysten Labs official (was working earlier, may come back)
  { url: 'https://publisher.walrus-mainnet.walrus.space/v1/blobs', timeout: 12000, priority: 'secondary' },
  // SECONDARY — community nodes (kept as fallback, short timeout to avoid blocking)
  { url: 'https://walrus-mainnet.nodeinfra.com/v1/blobs', timeout: 10000, priority: 'secondary' },
  { url: 'https://walrus.badkids.xyz/v1/blobs', timeout: 10000, priority: 'secondary' },
  { url: 'https://walrus-publisher.nodes.guru/v1/blobs', timeout: 10000, priority: 'secondary' },
];

const WALRUS_AGGREGATORS = [
  'https://aggregator.walrus-mainnet.walrus.space/v1/blobs',
  'https://wal-aggregator-mainnet.staketab.org/v1/blobs',
];

const STORE_EPOCHS = 10;

// Track publisher health so we skip recently-dead ones
const publisherHealth: Map<string, { failedAt: number; failures: number }> = new Map();
const HEALTH_RESET_MS = 5 * 60 * 1000; // reset after 5 minutes

function isPublisherHealthy(url: string): boolean {
  const h = publisherHealth.get(url);
  if (!h) return true;
  if (Date.now() - h.failedAt > HEALTH_RESET_MS) {
    publisherHealth.delete(url);
    return true;
  }
  // Skip secondary publishers after 2 failures; skip primary after 5
  const isPrimary = WALRUS_PUBLISHERS.find(p => p.url === url)?.priority === 'primary';
  return h.failures < (isPrimary ? 5 : 2);
}

function markPublisherFailed(url: string) {
  const h = publisherHealth.get(url) || { failedAt: 0, failures: 0 };
  publisherHealth.set(url, { failedAt: Date.now(), failures: h.failures + 1 });
}

function markPublisherSuccess(url: string) {
  publisherHealth.delete(url);
}

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

async function tryPublisher(
  publisherUrl: string,
  receiptJson: string,
  timeoutMs: number,
): Promise<{ blobId: string; publisher: string } | null> {
  try {
    const url = `${publisherUrl}?epochs=${STORE_EPOCHS}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: receiptJson,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[Walrus] Publisher ${publisherUrl} returned ${response.status}: ${text.slice(0, 200)}`);
      markPublisherFailed(publisherUrl);
      return null;
    }

    const result = await response.json();
    const blobId = extractBlobId(result);

    if (blobId) {
      markPublisherSuccess(publisherUrl);
      return { blobId, publisher: publisherUrl };
    }

    console.warn(`[Walrus] No blobId from ${publisherUrl}:`, JSON.stringify(result).slice(0, 300));
    markPublisherFailed(publisherUrl);
    return null;
  } catch (err: any) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.warn(`[Walrus] Publisher ${publisherUrl} ${isTimeout ? 'timed out' : `failed: ${err.message}`}`);
    markPublisherFailed(publisherUrl);
    return null;
  }
}

// Race all healthy publishers simultaneously — first success wins.
// Primary publisher always participates; secondaries only if healthy.
async function storeViaHttp(receiptJson: string): Promise<{ blobId: string; publisher: string } | null> {
  const candidates = WALRUS_PUBLISHERS.filter(p => {
    if (p.priority === 'primary') return true; // always try primary
    return isPublisherHealthy(p.url);
  });

  console.log(`[Walrus] Racing ${candidates.length} publisher(s)...`);

  // Use Promise.any so the first successful publisher wins
  const promises = candidates.map(async (p) => {
    const result = await tryPublisher(p.url, receiptJson, p.timeout);
    if (!result) throw new Error(`${p.url} failed`);
    return result;
  });

  try {
    const winner = await Promise.any(promises);
    console.log(`[Walrus] ✅ Success with publisher: ${winner.publisher}`);
    return winner;
  } catch {
    console.error(`[Walrus] ❌ ALL ${candidates.length} publishers failed — receipt will be stored locally`);
    return null;
  }
}

// Verify a stored blob is retrievable from aggregators
async function verifyBlobStored(blobId: string): Promise<boolean> {
  for (const aggregatorBase of WALRUS_AGGREGATORS) {
    try {
      const response = await fetch(`${aggregatorBase}/${blobId}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok || response.status === 200) {
        console.log(`[Walrus] ✅ Blob ${blobId} verified on aggregator: ${aggregatorBase}`);
        return true;
      }
    } catch {
      // try next aggregator
    }
  }
  // Try GET if HEAD fails (some aggregators don't support HEAD)
  for (const aggregatorBase of WALRUS_AGGREGATORS) {
    try {
      const response = await fetch(`${aggregatorBase}/${blobId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        console.log(`[Walrus] ✅ Blob ${blobId} verified via GET on: ${aggregatorBase}`);
        return true;
      }
    } catch {
      // ignore
    }
  }
  console.warn(`[Walrus] ⚠️ Blob ${blobId} could not be verified on any aggregator (may still be certifying)`);
  return false;
}

export async function storeBetReceipt(data: BetReceiptData): Promise<WalrusStoreResponse> {
  const receiptJson = generateReceiptJson(data);
  const receiptHash = hashReceipt(receiptJson);

  const result = await storeViaHttp(receiptJson);

  if (result) {
    console.log(`🐋 Walrus MAINNET receipt stored: ${result.blobId} (via ${result.publisher})`);
    // Verify in background — don't block bet response
    verifyBlobStored(result.blobId).catch(() => {});
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

// Health-check all publishers — useful for admin endpoints
export async function checkPublisherHealth(): Promise<Record<string, { status: string; latencyMs?: number }>> {
  const testPayload = JSON.stringify({ suibets_health_check: true, ts: Date.now() });
  const results: Record<string, { status: string; latencyMs?: number }> = {};

  await Promise.allSettled(
    WALRUS_PUBLISHERS.map(async (p) => {
      const start = Date.now();
      try {
        const response = await fetch(`${p.url}?epochs=1`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: testPayload,
          signal: AbortSignal.timeout(15000),
        });
        const latencyMs = Date.now() - start;
        if (response.ok) {
          const json = await response.json().catch(() => null);
          const blobId = json ? extractBlobId(json) : null;
          results[p.url] = {
            status: blobId ? `✅ working (blobId: ${blobId.slice(0, 12)}...)` : '⚠️ responded but no blobId',
            latencyMs,
          };
        } else {
          results[p.url] = { status: `❌ HTTP ${response.status}`, latencyMs };
        }
      } catch (err: any) {
        const reason = err.name === 'TimeoutError' ? 'timeout'
          : err.cause?.code === 'ECONNREFUSED' ? 'connection refused'
          : err.cause?.code === 'ENOTFOUND' ? 'DNS not found'
          : err.message;
        results[p.url] = { status: `❌ ${reason}`, latencyMs: Date.now() - start };
      }
    })
  );

  return results;
}
