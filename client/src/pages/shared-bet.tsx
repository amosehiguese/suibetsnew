import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useBetting } from '@/context/BettingContext';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import SuiNSName from '@/components/SuiNSName';
const suibetsLogo = "/images/suibets-logo.png";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Check,
  TrendingUp,
  ExternalLink,
  Share2,
  RefreshCw,
  AlertTriangle,
  X
} from 'lucide-react';
import CleanHome from '@/pages/clean-home';

interface SharedBetData {
  id: string | number;
  numericId?: number;
  eventId: string;
  externalEventId?: string;
  eventName: string;
  selection?: string;
  prediction?: string;
  odds: number;
  stake?: number;
  betAmount?: number;
  amount?: number;
  potentialWin?: number;
  potentialPayout?: number;
  status: string;
  placedAt?: string;
  createdAt?: string;
  settledAt?: string;
  txHash?: string;
  currency?: string;
  feeCurrency?: string;
  walletAddress?: string;
  userId?: string;
  marketId?: string;
  homeTeam?: string;
  awayTeam?: string;
}

export default function SharedBetPage() {
  const [, params] = useRoute('/bet/:id');
  const [, setLocation] = useLocation();
  const betId = params?.id;
  const { addBet } = useBetting();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [betAdded, setBetAdded] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [showModal, setShowModal] = useState(true);

  const { data: bet, isLoading, error } = useQuery<SharedBetData>({
    queryKey: [`/api/bets/${betId}`],
    enabled: !!betId,
  });

  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showModal]);

  const handleCloseModal = () => {
    setShowModal(false);
    setLocation('/');
  };

  const getStake = (b: SharedBetData) => b.stake ?? b.betAmount ?? b.amount ?? 0;
  const getPayout = (b: SharedBetData) => b.potentialWin ?? b.potentialPayout ?? 0;
  const getCurrency = (b: SharedBetData) => b.currency ?? b.feeCurrency ?? 'SUI';
  const getSelection = (b: SharedBetData) => b.selection ?? b.prediction ?? '';
  const getDate = (b: SharedBetData) => b.placedAt ?? b.createdAt ?? '';
  const getWallet = (b: SharedBetData) => b.walletAddress ?? b.userId ?? '';

  const tryParseLegs = (b: SharedBetData): { isParlay: boolean; legs: any[] } => {
    const sources = [b.eventName, b.selection, b.prediction];
    for (const src of sources) {
      if (typeof src === 'string' && src.startsWith('[')) {
        try {
          const parsed = JSON.parse(src);
          if (Array.isArray(parsed) && parsed.length > 1) return { isParlay: true, legs: parsed };
        } catch {}
      }
    }
    return { isParlay: false, legs: [] };
  };

  const handleCopyBet = async () => {
    if (!bet) return;
    setCopyLoading(true);

    const isSettled = ['won', 'paid_out', 'lost', 'void'].includes(bet.status);
    const { isParlay, legs: parlayLegs } = tryParseLegs(bet);

    const resolveEventId = (b: SharedBetData): string => {
      const extId = b.externalEventId || '';
      if (extId && !extId.startsWith('parlay_') && !extId.startsWith('sync_')) {
        return extId;
      }
      const eid = String(b.eventId || '');
      if (eid && eid !== '0' && eid !== 'null' && eid !== 'undefined') {
        return eid;
      }
      return '';
    };

    const extractParlayLegEventIds = (extId: string): string[] => {
      if (!extId || !extId.startsWith('parlay_')) return [];
      const parts = extId.split('_');
      const legIds: string[] = [];
      let i = 2;
      while (i < parts.length) {
        if (/^\d+$/.test(parts[i])) {
          legIds.push(parts[i]);
          i++;
        } else if (i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
          legIds.push(`${parts[i]}_${parts[i + 1]}`);
          i += 2;
        } else {
          i++;
        }
      }
      return legIds;
    };

    const checkEventAvailable = async (eventId: string): Promise<{ available: boolean; homeTeam?: string; awayTeam?: string }> => {
      if (!eventId) return { available: false };
      try {
        const resp = await fetch(`/api/events/check/${encodeURIComponent(eventId)}`);
        if (!resp.ok) return { available: false };
        const data = await resp.json();
        return { available: data.available === true, homeTeam: data.homeTeam, awayTeam: data.awayTeam };
      } catch {
        return { available: false };
      }
    };

    if (isParlay) {
      const parlayExtId = bet.externalEventId || '';
      const extractedLegIds = extractParlayLegEventIds(parlayExtId);
      
      let addedCount = 0;
      let unavailableCount = 0;
      for (let idx = 0; idx < parlayLegs.length; idx++) {
        const leg = parlayLegs[idx];
        let legEventId = leg.eventId || leg.externalEventId || '';
        if ((!legEventId || legEventId.startsWith('sync_')) && extractedLegIds[idx]) {
          legEventId = extractedLegIds[idx];
        }
        if (!legEventId) {
          unavailableCount++;
          continue;
        }
        const check = await checkEventAvailable(legEventId);
        if (!check.available) {
          unavailableCount++;
          continue;
        }
        addBet({
          id: `copy-${bet.id}-${idx}-${Date.now()}`,
          eventId: legEventId,
          eventName: leg.eventName || 'Copied Bet',
          selectionName: leg.selection || leg.prediction || 'Pick',
          odds: leg.odds || 1,
          stake: 0,
          market: leg.marketId || 'match-winner',
          currency: getCurrency(bet) as 'SUI' | 'SBETS',
          homeTeam: check.homeTeam || leg.homeTeam,
          awayTeam: check.awayTeam || leg.awayTeam,
        });
        addedCount++;
      }
      if (addedCount === 0) {
        toast({
          title: 'Events No Longer Available',
          description: isSettled
            ? 'This bet has already settled. The events are no longer open for betting.'
            : 'None of the events in this parlay are available for betting right now.',
          variant: 'destructive',
        });
        setCopyLoading(false);
        return;
      }
      if (unavailableCount > 0) {
        toast({
          title: `${addedCount} of ${parlayLegs.length} Legs Copied`,
          description: `${unavailableCount} leg(s) skipped because those events have ended or are unavailable.`,
        });
      } else {
        toast({
          title: 'Parlay Copied!',
          description: `${addedCount} selections added to your bet slip. Set your stake and place the bet!`,
        });
      }
    } else {
      const primaryEventId = resolveEventId(bet);
      if (!primaryEventId) {
        toast({
          title: 'Cannot Copy This Bet',
          description: 'The event information is missing or invalid.',
          variant: 'destructive',
        });
        setCopyLoading(false);
        return;
      }
      const check = await checkEventAvailable(primaryEventId);
      if (!check.available) {
        toast({
          title: 'Event No Longer Available',
          description: isSettled
            ? 'This bet has already settled. The event is no longer open for betting.'
            : 'This event has ended or is no longer available for betting.',
          variant: 'destructive',
        });
        setCopyLoading(false);
        return;
      }
      addBet({
        id: `copy-${bet.id}-${Date.now()}`,
        eventId: primaryEventId,
        eventName: bet.eventName || 'Copied Bet',
        selectionName: getSelection(bet) || 'Pick',
        odds: bet.odds || 1,
        stake: 0,
        market: bet.marketId || 'match-winner',
        currency: getCurrency(bet) as 'SUI' | 'SBETS',
        homeTeam: check.homeTeam || bet.homeTeam,
        awayTeam: check.awayTeam || bet.awayTeam,
      });
      toast({
        title: 'Bet Copied!',
        description: 'Selection added to your bet slip. Set your stake and place the bet!',
      });
    }
    setBetAdded(true);
    setCopyLoading(false);
  };

  const handleShareLink = async () => {
    const shareId = bet?.numericId ?? betId;
    const shareUrl = `https://www.suibets.com/bet/${shareId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Link Copied!', description: 'Share this link with friends' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'won':
      case 'paid_out':
        return { label: status === 'paid_out' ? 'PAID OUT' : 'WON', color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30', icon: <CheckCircle2 className="h-6 w-6 text-green-400" /> };
      case 'lost':
        return { label: 'LOST', color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30', icon: <XCircle className="h-6 w-6 text-red-400" /> };
      case 'pending':
      case 'confirmed':
        return { label: 'PENDING', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', icon: <Clock className="h-6 w-6 text-yellow-400 animate-pulse" /> };
      default:
        return { label: status?.toUpperCase() || 'UNKNOWN', color: 'text-gray-400', bg: 'bg-gray-500/20', border: 'border-gray-500/30', icon: <Clock className="h-6 w-6 text-gray-400" /> };
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return dateStr; }
  };


  const getPnl = () => {
    if (!bet) return { value: 0, display: '0', isPositive: false };
    const stk = getStake(bet);
    const pyt = getPayout(bet);
    if (bet.status === 'won' || bet.status === 'paid_out') {
      const profit = pyt - stk;
      return { value: profit, display: `+${profit.toFixed(2)}`, isPositive: true };
    }
    if (bet.status === 'lost') {
      return { value: -stk, display: `-${stk.toFixed(2)}`, isPositive: false };
    }
    return { value: 0, display: `+${(pyt - stk).toFixed(2)}`, isPositive: true };
  };

  const parseBetLegs = () => {
    if (!bet) return [];
    const { isParlay, legs } = tryParseLegs(bet);
    if (isParlay) return legs;
    return [{ eventName: bet.eventName, selection: getSelection(bet), odds: bet.odds }];
  };

  return (
    <>
      <CleanHome />

      {showModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          data-testid="shared-bet-overlay"
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={handleCloseModal}
            data-testid="shared-bet-backdrop"
          />

          <div className="relative z-10 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto rounded-2xl" data-testid="shared-bet-modal">
            <button
              onClick={handleCloseModal}
              className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/40 text-gray-400 hover:text-white hover:bg-black/60 transition-colors"
              data-testid="button-close-modal"
            >
              <X size={18} />
            </button>

            {isLoading && (
              <div className="bg-[#0d1b2a] rounded-2xl border border-cyan-900/40 p-12 text-center">
                <RefreshCw className="h-8 w-8 text-cyan-400 animate-spin mx-auto mb-4" />
                <p className="text-gray-400">Loading bet details...</p>
              </div>
            )}

            {error && (
              <div className="bg-[#0d1b2a] rounded-2xl border border-cyan-900/40 p-12 text-center">
                <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
                <p className="text-white text-lg font-medium mb-2">Bet Not Found</p>
                <p className="text-gray-400 mb-6">This bet may no longer exist or the link is invalid.</p>
                <button
                  onClick={handleCloseModal}
                  className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-3 rounded-xl"
                  data-testid="btn-go-home"
                >
                  Browse Events
                </button>
              </div>
            )}

            {bet && (() => {
              const statusInfo = getStatusInfo(bet.status);
              const pnl = getPnl();
              const legs = parseBetLegs();
              const isParlay = legs.length > 1;
              const isSettled = ['won', 'paid_out', 'lost', 'void'].includes(bet.status);
              const currency = getCurrency(bet);
              const stakeVal = getStake(bet);
              const payoutVal = getPayout(bet);
              const dateVal = getDate(bet);

              return (
                <div className="space-y-4">
                  <div
                    className="relative rounded-2xl overflow-hidden border border-cyan-900/40"
                    style={{ background: 'linear-gradient(135deg, #0d1b1e 0%, #112225 50%, #0a1214 100%)' }}
                    data-testid="pnl-card"
                  >
                    <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-cyan-500/15 to-transparent" />
                    <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-cyan-500/8 to-transparent" />

                    <div className="relative p-6 pt-8">
                      <div className="text-center mb-4">
                        <p className="text-gray-400 text-xs uppercase tracking-wider font-medium">Shared Bet</p>
                        {getWallet(bet) && (
                          <p className="text-gray-500 text-xs mt-0.5">by <SuiNSName address={getWallet(bet)} className="text-gray-500 text-xs" /></p>
                        )}
                      </div>

                      <div className="flex items-center justify-between mb-4">
                        <img src={suibetsLogo} alt="SuiBets" className="h-8 w-auto" />
                        <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${statusInfo.bg} ${statusInfo.color} border ${statusInfo.border}`} data-testid="text-status">
                          {statusInfo.label}
                        </div>
                      </div>

                      <div className="flex items-center justify-between mb-1">
                        <span className="text-gray-400 text-sm font-medium">
                          {isParlay ? `Parlay (${legs.length} Legs)` : 'Single Bet'}
                        </span>
                        <span className="text-white font-bold text-xl" data-testid="text-odds">{bet.odds.toFixed(2)}</span>
                      </div>

                      <div className="space-y-3 mb-5 mt-4">
                        {legs.map((leg: any, idx: number) => {
                          const selection = leg.selection || leg.prediction || '';
                          const eventName = leg.eventName && leg.eventName !== 'Unknown Event' && !leg.eventName.startsWith('[') ? leg.eventName : '';
                          const displayText = eventName && !selection.includes(' vs ') ? `${eventName}: ${selection}` : selection;

                          const dotColor = isSettled && (bet.status === 'won' || bet.status === 'paid_out') ? 'bg-green-400'
                            : isSettled && bet.status === 'lost' ? 'bg-red-400'
                            : 'bg-cyan-400';

                          return (
                            <div key={idx} className="relative pl-5" data-testid={`leg-${idx}`}>
                              <div className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${dotColor} border-2 border-[#112225]`} />
                              {idx < legs.length - 1 && (
                                <div className="absolute left-[4px] top-4 w-0.5 h-[calc(100%+4px)] bg-gray-700/50" />
                              )}
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-cyan-300 font-semibold text-sm leading-tight">{displayText}</span>
                                {isParlay && leg.odds > 1 && (
                                  <span className="text-gray-500 text-xs flex-shrink-0">@ {(leg.odds || 1).toFixed(2)}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="bg-black/30 rounded-xl p-4 space-y-2.5">
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="text-gray-500">Stake</span>
                          <span className="text-white font-medium" data-testid="text-stake">{stakeVal.toLocaleString(undefined, { maximumFractionDigits: 4 })} {currency}</span>
                        </div>
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="text-gray-500">{isSettled ? 'Payout' : 'Potential Win'}</span>
                          <span className={`font-bold ${bet.status === 'won' || bet.status === 'paid_out' ? 'text-green-400' : bet.status === 'lost' ? 'text-red-400 line-through' : 'text-cyan-400'}`} data-testid="text-payout">
                            {payoutVal.toLocaleString(undefined, { maximumFractionDigits: 4 })} {currency}
                          </span>
                        </div>
                        {isSettled && (
                          <div className="flex justify-between gap-2 text-sm pt-1 border-t border-gray-700/50">
                            <span className="text-gray-500">P&L</span>
                            <span className={`font-bold text-lg ${pnl.isPositive ? 'text-green-400' : 'text-red-400'}`} data-testid="text-pnl">
                              {pnl.display} {currency}
                            </span>
                          </div>
                        )}
                      </div>

                      {bet.txHash && (
                        <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-600">
                          <span>TX:</span>
                          <a
                            href={`https://suiscan.xyz/mainnet/tx/${bet.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-cyan-500/60 hover:text-cyan-400 flex items-center gap-1"
                            data-testid="link-tx"
                          >
                            {bet.txHash.slice(0, 16)}...
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
                        <span>{dateVal ? formatDate(dateVal) : ''}</span>
                        <span>suibets.com</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={handleCopyBet}
                      disabled={betAdded || copyLoading}
                      className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-colors ${
                        betAdded
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30 cursor-default'
                          : copyLoading
                          ? 'bg-cyan-500/50 text-black/50 cursor-wait'
                          : 'bg-cyan-500 hover:bg-cyan-600 text-black'
                      }`}
                      data-testid="button-copy-bet"
                    >
                      {betAdded ? (
                        <>
                          <Check className="h-5 w-5" />
                          Added to Bet Slip
                        </>
                      ) : copyLoading ? (
                        <>
                          <RefreshCw className="h-5 w-5 animate-spin" />
                          Checking Availability...
                        </>
                      ) : (
                        <>
                          <Copy className="h-5 w-5" />
                          Copy This Bet
                        </>
                      )}
                    </button>

                    <div className="flex gap-3">
                      <button
                        onClick={handleShareLink}
                        className="flex-1 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 bg-[#0f1923] border border-cyan-900/30 text-gray-300 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors"
                        data-testid="button-share-link"
                      >
                        {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                        {copied ? 'Copied!' : 'Share Link'}
                      </button>
                      <button
                        onClick={handleCloseModal}
                        className="flex-1 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 bg-[#0f1923] border border-cyan-900/30 text-gray-300 hover:text-cyan-400 hover:border-cyan-500/40 transition-colors"
                        data-testid="button-browse-events"
                      >
                        <TrendingUp className="h-4 w-4" />
                        Browse Events
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
