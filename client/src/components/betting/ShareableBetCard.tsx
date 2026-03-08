import { useRef, useState } from 'react';
import { Share2, Download, X, Copy, Check, CheckCircle2, XCircle, Clock, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { formatAddress } from '@/hooks/useSuiNSName';
import SuiNSName from '@/components/SuiNSName';
import html2canvas from 'html2canvas';

interface BetLeg {
  eventName: string;
  selection: string;
  prediction?: string;
  odds: number;
  eventId?: string;
  marketId?: string;
  homeTeam?: string;
  awayTeam?: string;
  legResult?: 'won' | 'lost' | 'pending' | 'void';
}

interface ShareableBetCardProps {
  bet: {
    id: number | string;
    numericId?: number;
    eventName: string;
    prediction: string;
    odds: number;
    betAmount: number;
    potentialPayout: number;
    currency: string;
    status: string;
    createdAt: string;
    txHash?: string;
    walletAddress?: string;
  };
  isParlay?: boolean;
  parlayLegs?: BetLeg[];
  isOpen: boolean;
  onClose: () => void;
}

const SPORT_FROM_EVENT_ID: Record<string, string> = {
  basketball: 'Basketball',
  'ice-hockey': 'Ice Hockey',
  baseball: 'Baseball',
  rugby: 'Rugby',
  handball: 'Handball',
  volleyball: 'Volleyball',
  mma: 'MMA',
  'american-football': 'Am. Football',
  afl: 'AFL',
  'formula-1': 'Formula 1',
  nba: 'NBA',
  nfl: 'NFL',
};

const MARKET_LABELS: Record<string, string> = {
  'match-winner': 'Winner',
  'match_winner': 'Winner',
  '1': 'Winner',
  '2': 'BTTS',
  '3': 'Double Chance',
  '4': 'Half-Time',
  '5': 'Over/Under',
  '6': 'Correct Score',
  'btts': 'BTTS',
  'double-chance': 'Double Chance',
  'over-under': 'Over/Under',
};

function getSportFromEventId(eventId?: string): string | null {
  if (!eventId) return null;
  for (const [prefix, label] of Object.entries(SPORT_FROM_EVENT_ID)) {
    if (eventId.startsWith(prefix + '_')) return label;
  }
  if (/^\d+$/.test(eventId)) return 'Football';
  return null;
}

function getMarketLabel(marketId?: string): string | null {
  if (!marketId) return null;
  return MARKET_LABELS[marketId] || null;
}

function shortenWallet(address?: string): string {
  if (!address) return '';
  if (address.length <= 14) return address;
  return formatAddress(address);
}

export function ShareableBetCard({ bet, isParlay = false, parlayLegs = [], isOpen, onClose }: ShareableBetCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [betCopied, setBetCopied] = useState(false);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { 
        month: '2-digit', 
        day: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'won':
      case 'paid_out':
        return { text: status === 'paid_out' ? 'PAID OUT' : 'WON', bg: 'bg-green-500/20', text_color: 'text-green-400', border: 'border-green-500/30' };
      case 'lost':
        return { text: 'LOST', bg: 'bg-red-500/20', text_color: 'text-red-400', border: 'border-red-500/30' };
      case 'pending':
      case 'confirmed':
        return { text: 'PENDING', bg: 'bg-yellow-500/20', text_color: 'text-yellow-400', border: 'border-yellow-500/30' };
      case 'void':
        return { text: 'VOID', bg: 'bg-gray-500/20', text_color: 'text-gray-400', border: 'border-gray-500/30' };
      default:
        return { text: status.toUpperCase(), bg: 'bg-gray-500/20', text_color: 'text-gray-400', border: 'border-gray-500/30' };
    }
  };

  const getLegIcon = (legResult?: string, betStatus?: string) => {
    if (legResult === 'won') return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />;
    if (legResult === 'lost') return <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
    if (betStatus === 'won' || betStatus === 'paid_out') return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />;
    if (betStatus === 'lost') return <XCircle className="w-3.5 h-3.5 text-red-400/50 flex-shrink-0" />;
    return <Clock className="w-3.5 h-3.5 text-yellow-400/60 flex-shrink-0" />;
  };

  const [saving, setSaving] = useState(false);
  const [inlineImageUrl, setInlineImageUrl] = useState<string | null>(null);

  const generateCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!cardRef.current) return null;
    try {
      const el = cardRef.current;
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || ('ontouchstart' in window);
      const canvas = await html2canvas(el, {
        backgroundColor: '#0a1214',
        scale: isMobile ? 1.5 : 2,
        logging: false,
        useCORS: true,
        allowTaint: true,
        width: el.scrollWidth,
        height: el.scrollHeight,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        foreignObjectRendering: false,
        removeContainer: true,
        onclone: (clonedDoc: Document) => {
          const clonedEl = clonedDoc.querySelector('[data-card-capture]');
          if (clonedEl instanceof HTMLElement) {
            clonedEl.style.transform = 'none';
            clonedEl.style.position = 'relative';
          }
        },
      });
      return canvas;
    } catch (err) {
      console.error('[ShareableBetCard] html2canvas error:', err);
      return null;
    }
  };

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    setInlineImageUrl(null);
    
    try {
      await new Promise(r => setTimeout(r, 100));

      const canvas = await generateCanvas();
      if (!canvas) {
        toast({ title: 'Save failed', description: 'Could not generate image', variant: 'destructive' });
        setSaving(false);
        return;
      }

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || ('ontouchstart' in window);
      
      if (isMobile) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
        if (!blob) {
          toast({ title: 'Save failed', description: 'Could not generate image', variant: 'destructive' });
          setSaving(false);
          return;
        }

        const file = new File([blob], `suibets-bet-${bet.id}.png`, { type: 'image/png' });

        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'SuiBets Bet Slip' });
            toast({ title: 'Shared!', description: 'Image shared successfully' });
            setSaving(false);
            return;
          } catch (shareErr: any) {
            if (shareErr?.name === 'AbortError') {
              setSaving(false);
              return;
            }
          }
        }

        // On iOS, <a download> is ignored — go straight to inline image for long-press save
        // On Android without Web Share, try anchor download first
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        if (!isIOS) {
          try {
            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = `suibets-bet-${bet.id}.png`;
            link.href = dataUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => document.body.removeChild(link), 200);
            toast({ title: 'Downloaded!', description: 'Bet slip saved to your device' });
            setSaving(false);
            return;
          } catch {}
        }

        // Fallback: show inline image for long-press save (primary path on iOS)
        const dataUrl = canvas.toDataURL('image/png');
        setInlineImageUrl(dataUrl);
        toast({ title: 'Image ready!', description: 'Long press the image below to save it' });
      } else {
        const link = document.createElement('a');
        link.download = `suibets-bet-${bet.id}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({ title: 'Downloaded!', description: 'Bet slip saved to your device' });
      }
    } catch (error) {
      console.error('Download error:', error);
      toast({ title: 'Save failed', description: 'Could not generate image. Try using Share instead.', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleShare = async () => {
    const shareId = bet.numericId ?? bet.id;
    const shareUrl = `https://www.suibets.com/bet/${shareId}`;

    try {
      const canvas = await generateCanvas();
      if (canvas) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          const file = new File([blob], `suibets-bet-${shareId}.png`, { type: 'image/png' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            try {
              await navigator.share({
                title: 'My SuiBets Bet',
                text: `Check out my bet on SuiBets! ${isParlay ? 'Parlay' : 'Single'} @ ${bet.odds.toFixed(2)} odds\n${shareUrl}`,
                files: [file],
              });
              return;
            } catch (shareErr: any) {
              if (shareErr?.name === 'AbortError') return;
            }
          }
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast({ title: 'Copied to clipboard!', description: 'Image copied, paste it anywhere to share' });
            return;
          } catch {}
        }
      }
    } catch {}

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Link copied!', description: 'Share this link so friends can copy your bet' });
    } catch {
      toast({ title: 'Share failed', description: 'Could not share or copy link', variant: 'destructive' });
    }
  };

  const handleCopyBet = async () => {
    const shareId = bet.numericId ?? bet.id;
    const shareUrl = `https://www.suibets.com/bet/${shareId}`;
    const legs = isParlay && parlayLegs.length > 0
      ? parlayLegs
      : (isParlay && bet.prediction?.includes(' | '))
        ? parsePipeSeparatedLegs()
        : [{ eventName: bet.eventName, selection: bet.prediction, odds: bet.odds }];

    const lines = legs.map((leg, i) => {
      const name = leg.eventName && leg.eventName !== 'Unknown Event' ? leg.eventName : '';
      const sel = leg.selection || leg.prediction || '';
      const display = name ? `${name}: ${sel}` : sel;
      return legs.length > 1 ? `  Leg ${i + 1}: ${display} @ ${(leg.odds || 1).toFixed(2)}` : display;
    });

    const text = [
      `SuiBets - Copy This Bet`,
      isParlay ? `Parlay (${legs.length} Legs)` : 'Single Bet',
      ...lines,
      `Combined Odds: ${bet.odds.toFixed(2)}`,
      `Stake: ${bet.betAmount.toLocaleString()} ${bet.currency}`,
      `Potential Win: ${bet.potentialPayout.toLocaleString()} ${bet.currency}`,
      ``,
      `Copy this bet: ${shareUrl}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setBetCopied(true);
      setTimeout(() => setBetCopied(false), 2000);
      toast({ title: 'Bet Copied!', description: 'Bet link and details copied. Share with friends so they can copy your bet!' });
    } catch {
      toast({ title: 'Copy failed', description: 'Could not copy to clipboard', variant: 'destructive' });
    }
  };

  const parsePipeSeparatedLegs = (): BetLeg[] => {
    if (typeof bet.prediction === 'string' && bet.prediction.includes(' | ')) {
      const legs = bet.prediction.split(' | ');
      return legs.map((leg: string) => {
        const colonIdx = leg.lastIndexOf(':');
        if (colonIdx > 0) {
          const eventName = leg.substring(0, colonIdx).trim();
          const selection = leg.substring(colonIdx + 1).trim();
          return { eventName, selection, odds: 1 };
        }
        return { eventName: 'Match', selection: leg.trim(), odds: 1 };
      });
    }
    return [];
  };

  const displayLegs = isParlay && parlayLegs.length > 0 
    ? parlayLegs 
    : (isParlay && bet.prediction?.includes(' | '))
      ? parsePipeSeparatedLegs()
      : [{
          eventName: bet.eventName,
          selection: bet.prediction,
          odds: bet.odds
        }];

  const statusBadge = getStatusBadge(bet.status);
  const isSettled = ['won', 'paid_out', 'lost', 'void'].includes(bet.status);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#0a1214] border-[#1e3a3f] text-white max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center justify-between">
            <span>Share Your Bet</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="p-4">
          <div 
            ref={cardRef}
            className="relative rounded-xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #0d1b1e 0%, #112225 50%, #0a1214 100%)' }}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-cyan-500/20 to-transparent" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-cyan-500/10 to-transparent" />
            
            <div className="relative p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <img 
                    src="/images/suibets-logo.png" 
                    alt="SuiBets" 
                    className="h-10 w-auto"
                  />
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold ${statusBadge.bg} ${statusBadge.text_color} border ${statusBadge.border}`}>
                  {statusBadge.text}
                </div>
              </div>

              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm font-medium">
                    {isParlay ? `Parlay (${displayLegs.length} Legs)` : 'Single Bet'}
                  </span>
                  {bet.numericId && (
                    <span className="text-gray-600 text-xs" data-testid="text-bet-id">#{bet.numericId}</span>
                  )}
                </div>
                <span className="text-white font-bold text-xl" data-testid="text-combined-odds">{bet.odds.toFixed(2)}</span>
              </div>

              {bet.walletAddress && (
                <div className="mb-3" data-testid="text-wallet-address">
                  <SuiNSName address={bet.walletAddress} className="text-gray-600 text-xs font-mono" />
                </div>
              )}

              <div className="space-y-2.5 mb-4">
                {displayLegs.map((leg, idx) => {
                  const selection = leg.selection || leg.prediction || '';
                  const eventName = leg.eventName && leg.eventName !== 'Unknown Event' && leg.eventName !== 'Match' && !leg.eventName.match(/^\d+$/)
                    ? leg.eventName 
                    : '';
                  
                  const displayText = eventName && !selection.includes(' vs ') && !selection.includes(':')
                    ? `${eventName}: ${selection}`
                    : selection;

                  const sport = getSportFromEventId(leg.eventId);
                  const market = getMarketLabel(leg.marketId);
                  const dotColor = leg.legResult === 'won' ? 'bg-green-400' 
                    : leg.legResult === 'lost' ? 'bg-red-400'
                    : isSettled && bet.status === 'won' ? 'bg-green-400'
                    : isSettled && bet.status === 'lost' ? 'bg-red-400/50'
                    : 'bg-cyan-400';
                  
                  return (
                    <div key={idx} className="relative pl-5" data-testid={`bet-leg-${idx}`}>
                      <div className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${dotColor} border-2 border-[#112225]`} />
                      {idx < displayLegs.length - 1 && (
                        <div className="absolute left-[4px] top-4 w-0.5 h-[calc(100%+2px)] bg-gray-700/50" />
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {(sport || market) && (
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              {sport && (
                                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium" data-testid={`text-leg-sport-${idx}`}>
                                  {sport}
                                </span>
                              )}
                              {sport && market && <span className="text-gray-700 text-[10px]">/</span>}
                              {market && (
                                <span className="text-[10px] text-gray-500 uppercase tracking-wider" data-testid={`text-leg-market-${idx}`}>
                                  {market}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="text-cyan-300 font-semibold text-sm leading-tight">{displayText}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                          {displayLegs.length > 1 && leg.odds > 1 && (
                            <span className="text-gray-500 text-xs">@ {leg.odds.toFixed(2)}</span>
                          )}
                          {isSettled && getLegIcon(leg.legResult, bet.status)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-black/30 rounded-lg p-3 space-y-2">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="text-gray-500">Stake</span>
                  <span className="text-white font-medium" data-testid="text-stake">
                    {bet.betAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {bet.currency}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="text-gray-500">{bet.status === 'won' || bet.status === 'paid_out' ? 'Won' : 'To Win'}</span>
                  <span className={`font-bold ${
                    bet.status === 'won' || bet.status === 'paid_out' ? 'text-green-400' 
                    : bet.status === 'lost' ? 'text-red-400 line-through' 
                    : 'text-cyan-400'
                  }`} data-testid="text-potential-payout">
                    {bet.status === 'lost' ? '-' : ''}{bet.potentialPayout.toLocaleString(undefined, { maximumFractionDigits: 4 })} {bet.currency}
                  </span>
                </div>
                {bet.status === 'lost' && (
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="text-gray-500">Result</span>
                    <span className="text-red-400 font-medium" data-testid="text-result">
                      -{bet.betAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {bet.currency}
                    </span>
                  </div>
                )}
              </div>

              {bet.txHash && isSettled && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-600">
                  <span>TX:</span>
                  <span className="font-mono truncate" data-testid="text-tx-hash">{bet.txHash.slice(0, 16)}...</span>
                </div>
              )}

              <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                <span data-testid="text-bet-date">{formatDate(bet.createdAt)}</span>
                <span>suibets.com</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-4">
            <Button 
              onClick={handleDownload}
              className="flex-1 bg-[#1e3a3f] hover:bg-[#2a4a4f] text-white"
              data-testid="button-download-bet"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button 
              onClick={handleCopyBet}
              className="flex-1 bg-[#1e3a3f] hover:bg-[#2a4a4f] text-white"
              data-testid="button-copy-bet"
            >
              {betCopied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {betCopied ? 'Copied!' : 'Copy Bet'}
            </Button>
            <Button 
              onClick={handleShare}
              className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
              data-testid="button-share-bet"
            >
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Share2 className="w-4 h-4 mr-2" />}
              {copied ? 'Copied!' : 'Share'}
            </Button>
          </div>

          {inlineImageUrl && (
            <div className="mt-4 rounded-lg overflow-hidden border border-cyan-500/30 bg-black/40 p-2">
              <p className="text-xs text-gray-400 text-center mb-2">Long press the image to save it</p>
              <img
                src={inlineImageUrl}
                alt="Bet slip"
                className="w-full rounded"
                data-testid="img-inline-download"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShareButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="h-8 w-8 text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10"
      title="Share bet"
      data-testid="button-share-bet-open"
    >
      <Share2 className="w-4 h-4" />
    </Button>
  );
}
