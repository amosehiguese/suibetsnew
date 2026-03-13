import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Check,
  ExternalLink,
  ArrowLeft,
  Shield,
  Database,
  Hash,
  Calendar,
  Layers,
  Wallet,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useState } from 'react';
const suibetsLogo = "/images/suibets-logo.png";

export default function WalrusReceiptPage() {
  const [, params] = useRoute('/walrus-receipt/:blobId');
  const [, setLocation] = useLocation();
  const blobId = params?.blobId;
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: receipt, isLoading, error } = useQuery<any>({
    queryKey: [`/api/walrus/receipt/${blobId}?json=1`],
    enabled: !!blobId,
    retry: 2,
  });

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {}
  };

  const getStatusConfig = (status?: string) => {
    switch (status) {
      case 'won':
      case 'paid_out':
        return { label: status === 'paid_out' ? 'PAID OUT' : 'WON', color: 'text-green-400', bg: 'bg-green-500/15', border: 'border-green-500/30', icon: <CheckCircle2 className="h-5 w-5 text-green-400" /> };
      case 'lost':
        return { label: 'LOST', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30', icon: <XCircle className="h-5 w-5 text-red-400" /> };
      case 'pending':
      case 'confirmed':
        return { label: 'PENDING', color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30', icon: <Clock className="h-5 w-5 text-yellow-400 animate-pulse" /> };
      default:
        return { label: (status || 'PENDING').toUpperCase(), color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30', icon: <Clock className="h-5 w-5 text-yellow-400" /> };
    }
  };

  const formatDate = (ts?: number | string) => {
    if (!ts) return '—';
    try {
      return new Date(typeof ts === 'number' ? ts : ts).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch { return String(ts); }
  };

  const shortHash = (h?: string, n = 16) => h ? `${h.slice(0, n)}...` : '—';

  const CopyButton = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => copyToClipboard(text, field)}
      className="ml-1.5 text-gray-500 hover:text-cyan-400 transition-colors flex-shrink-0"
      title="Copy"
    >
      {copiedField === field ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-gray-800/60 last:border-0">
      <span className="text-gray-500 text-sm flex-shrink-0">{label}</span>
      <div className="text-right text-sm">{children}</div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #050d12 0%, #0a1520 50%, #060e16 100%)' }}>
      {/* Nav */}
      <nav className="border-b border-cyan-900/30 bg-black/40 backdrop-blur-md px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation('/bet-history')}
              className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
              data-testid="btn-back"
            >
              <ArrowLeft size={18} />
            </button>
            <Link href="/">
              <img src={suibetsLogo} alt="SuiBets" className="h-8 w-auto cursor-pointer" />
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🐋</span>
            <span className="text-cyan-400 text-sm font-semibold">Walrus Receipt</span>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-10">

        {isLoading && (
          <div className="text-center py-24">
            <RefreshCw className="h-10 w-10 text-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Fetching receipt from Walrus decentralized storage...</p>
          </div>
        )}

        {error && !receipt && (
          <div className="text-center py-24">
            <AlertTriangle className="h-12 w-12 text-yellow-400 mx-auto mb-4" />
            <p className="text-white text-lg font-semibold mb-2">Receipt Unavailable</p>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              This blob ID may still be certifying on the Walrus network, or it may not exist. Try again in a moment.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-5 py-2.5 rounded-xl text-sm"
              >
                Retry
              </button>
              <button
                onClick={() => setLocation('/bet-history')}
                className="bg-gray-800 hover:bg-gray-700 text-white font-medium px-5 py-2.5 rounded-xl text-sm"
              >
                Back to My Bets
              </button>
            </div>
          </div>
        )}

        {receipt && (() => {
          const data = receipt.receipt || receipt;
          const bet = data.bet || {};
          const blockchain = data.blockchain || {};
          const storage = data.storage || {};
          const verification = data.verification || {};
          const status = bet.status;
          const statusCfg = getStatusConfig(status);
          const isParlay = typeof bet.eventName === 'string' && bet.eventName.startsWith('[');
          let parlayLegs: any[] = [];
          try {
            if (isParlay) parlayLegs = JSON.parse(bet.eventName);
          } catch {}

          return (
            <div className="space-y-5">
              {/* Hero card */}
              <div
                className="rounded-2xl border border-cyan-500/25 overflow-hidden relative"
                style={{ background: 'linear-gradient(135deg, #0d1e2a 0%, #111e2e 60%, #0a1620 100%)' }}
              >
                <div className="absolute top-0 right-0 w-56 h-56 bg-gradient-to-bl from-cyan-500/10 to-transparent pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-gradient-to-tr from-purple-500/8 to-transparent pointer-events-none" />

                <div className="relative p-6">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <img src={suibetsLogo} alt="SuiBets" className="h-8 w-auto" />
                    </div>
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${statusCfg.bg} ${statusCfg.color} ${statusCfg.border}`} data-testid="status-badge">
                      {statusCfg.icon}
                      {statusCfg.label}
                    </div>
                  </div>

                  <div className="mb-1">
                    <p className="text-gray-400 text-xs uppercase tracking-widest font-medium mb-1">
                      {isParlay ? `Parlay Bet (${parlayLegs.length} Legs)` : 'Single Bet'}
                    </p>
                    <h1 className="text-white text-xl font-bold leading-tight">
                      {isParlay
                        ? `${parlayLegs.length}-Leg Parlay`
                        : (bet.eventName || 'Bet Receipt')}
                    </h1>
                    {!isParlay && bet.prediction && (
                      <p className="text-cyan-400 font-semibold mt-1">{bet.prediction}</p>
                    )}
                  </div>

                  {isParlay && parlayLegs.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {parlayLegs.map((leg: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-2 pl-3 relative">
                          <div className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-cyan-400/80 flex-shrink-0" />
                          <div>
                            <span className="text-cyan-300 text-sm font-medium">{leg.selection || leg.prediction || 'Pick'}</span>
                            <span className="text-gray-500 text-xs ml-2">@ {Number(leg.odds || 1).toFixed(2)}</span>
                            {leg.eventName && (
                              <p className="text-gray-500 text-xs">{leg.eventName}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="bg-black/30 rounded-xl p-3 text-center">
                      <p className="text-gray-500 text-xs mb-1">Stake</p>
                      <p className="text-white font-bold text-sm" data-testid="text-stake">
                        {Number(bet.stake || 0).toFixed(4)} {bet.currency || 'SUI'}
                      </p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 text-center">
                      <p className="text-gray-500 text-xs mb-1">Odds</p>
                      <p className="text-cyan-400 font-bold text-sm" data-testid="text-odds">
                        {Number(bet.odds || 1).toFixed(2)}x
                      </p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 text-center">
                      <p className="text-gray-500 text-xs mb-1">To Win</p>
                      <p className={`font-bold text-sm ${status === 'won' || status === 'paid_out' ? 'text-green-400' : status === 'lost' ? 'text-red-400 line-through' : 'text-cyan-400'}`} data-testid="text-payout">
                        {Number(bet.potentialPayout || 0).toFixed(4)} {bet.currency || 'SUI'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Walrus Storage Section */}
              <div className="rounded-2xl border border-purple-500/25 overflow-hidden" style={{ background: 'linear-gradient(135deg, #120a1e 0%, #150d22 100%)' }}>
                <div className="px-5 py-4 border-b border-purple-900/30 flex items-center gap-2">
                  <span className="text-xl">🐋</span>
                  <h2 className="text-purple-300 font-bold text-sm tracking-wide uppercase">Walrus Decentralized Storage</h2>
                  <span className="ml-auto bg-purple-500/20 text-purple-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-purple-500/30">
                    ✓ On-Chain
                  </span>
                </div>
                <div className="p-5 space-y-0">
                  <Row label="Blob ID">
                    <div className="flex items-center justify-end gap-1 max-w-xs">
                      <span className="text-purple-300 font-mono text-xs break-all text-right" data-testid="text-blob-id">
                        {blobId}
                      </span>
                      {blobId && <CopyButton text={blobId} field="blobId" />}
                    </div>
                  </Row>
                  <Row label="Network">
                    <span className="text-gray-300">Walrus Mainnet</span>
                  </Row>
                  {storage.storedAt && (
                    <Row label="Stored At">
                      <span className="text-gray-300">{formatDate(storage.storedAt)}</span>
                    </Row>
                  )}
                  <Row label="Aggregator">
                    <a
                      href={`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-xs"
                      data-testid="link-raw-blob"
                    >
                      View Raw Blob <ExternalLink size={11} />
                    </a>
                  </Row>
                </div>
              </div>

              {/* Bet Details Section */}
              <div className="rounded-2xl border border-cyan-900/30 overflow-hidden" style={{ background: '#0d1520' }}>
                <div className="px-5 py-4 border-b border-cyan-900/30 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-cyan-400" />
                  <h2 className="text-cyan-300 font-bold text-sm tracking-wide uppercase">Bet Details</h2>
                </div>
                <div className="p-5 space-y-0">
                  <Row label="Bet ID">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gray-300 font-mono text-xs" data-testid="text-bet-id">{shortHash(bet.id, 20)}</span>
                      {bet.id && <CopyButton text={bet.id} field="betId" />}
                    </div>
                  </Row>
                  {bet.homeTeam && bet.awayTeam && (
                    <Row label="Match">
                      <span className="text-white font-medium">{bet.homeTeam} vs {bet.awayTeam}</span>
                    </Row>
                  )}
                  {bet.sportName && (
                    <Row label="Sport">
                      <span className="text-gray-300">{bet.sportName}</span>
                    </Row>
                  )}
                  {bet.marketType && (
                    <Row label="Market">
                      <span className="text-gray-300">{bet.marketType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                    </Row>
                  )}
                  {storage.placedAt && (
                    <Row label="Placed At">
                      <span className="text-gray-300">{formatDate(storage.placedAt)}</span>
                    </Row>
                  )}
                  {bet.walletAddress && (
                    <Row label="Wallet">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-gray-300 font-mono text-xs">{shortHash(bet.walletAddress, 12)}</span>
                        <CopyButton text={bet.walletAddress} field="wallet" />
                      </div>
                    </Row>
                  )}
                </div>
              </div>

              {/* Blockchain Section */}
              {(blockchain.txHash || blockchain.betObjectId || blockchain.contract) && (
                <div className="rounded-2xl border border-cyan-900/30 overflow-hidden" style={{ background: '#0d1520' }}>
                  <div className="px-5 py-4 border-b border-cyan-900/30 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-cyan-400" />
                    <h2 className="text-cyan-300 font-bold text-sm tracking-wide uppercase">Blockchain</h2>
                    <span className="ml-auto text-gray-500 text-xs">Sui Mainnet</span>
                  </div>
                  <div className="p-5 space-y-0">
                    {blockchain.txHash && (
                      <Row label="Transaction">
                        <a
                          href={`https://suiscan.xyz/mainnet/tx/${blockchain.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs"
                          data-testid="link-tx"
                        >
                          {shortHash(blockchain.txHash, 12)} <ExternalLink size={11} />
                        </a>
                      </Row>
                    )}
                    {blockchain.betObjectId && (
                      <Row label="Bet Object">
                        <a
                          href={`https://suiscan.xyz/mainnet/object/${blockchain.betObjectId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs"
                          data-testid="link-object"
                        >
                          {shortHash(blockchain.betObjectId, 12)} <ExternalLink size={11} />
                        </a>
                      </Row>
                    )}
                    {blockchain.contract && (
                      <Row label="Contract">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-500 font-mono text-xs">{shortHash(blockchain.contract, 12)}</span>
                          <CopyButton text={blockchain.contract} field="contract" />
                        </div>
                      </Row>
                    )}
                  </div>
                </div>
              )}

              {/* Verification Section */}
              {verification.receiptHash && (
                <div className="rounded-2xl border border-green-900/30 overflow-hidden" style={{ background: '#0a1510' }}>
                  <div className="px-5 py-4 border-b border-green-900/30 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-green-400" />
                    <h2 className="text-green-300 font-bold text-sm tracking-wide uppercase">Verification</h2>
                    <span className="ml-auto flex items-center gap-1 bg-green-500/15 text-green-400 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-green-500/25">
                      <CheckCircle2 size={10} /> Verified
                    </span>
                  </div>
                  <div className="p-5 space-y-0">
                    <Row label="Receipt Hash">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-green-300 font-mono text-xs">{shortHash(verification.receiptHash, 16)}</span>
                        <CopyButton text={verification.receiptHash} field="receiptHash" />
                      </div>
                    </Row>
                    {verification.algorithm && (
                      <Row label="Algorithm">
                        <span className="text-gray-300 uppercase text-xs">{verification.algorithm}</span>
                      </Row>
                    )}
                    <Row label="Platform">
                      <span className="text-gray-300">SuiBets v{data.version || '2.0'}</span>
                    </Row>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setLocation('/bet-history')}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm bg-cyan-500 hover:bg-cyan-600 text-black transition-colors"
                  data-testid="btn-my-bets"
                >
                  <ArrowLeft size={16} />
                  My Bets
                </button>
                <a
                  href={`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm bg-gray-800 hover:bg-gray-700 text-white border border-gray-700/50 transition-colors"
                  data-testid="btn-raw-blob"
                >
                  Raw Blob
                  <ExternalLink size={14} />
                </a>
              </div>

              {/* Footer */}
              <div className="text-center pt-2 pb-4">
                <p className="text-gray-600 text-xs">This receipt is permanently stored on the Walrus decentralized storage network.</p>
                <a href="https://www.suibets.com" className="text-cyan-700 hover:text-cyan-500 text-xs">suibets.com</a>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
