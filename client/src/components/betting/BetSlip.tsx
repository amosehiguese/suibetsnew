import { useState, useEffect, useCallback } from 'react';
import { useBetting } from '@/context/BettingContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { X, Trash2, ChevronUp, ChevronDown, CheckCircle2, Copy, ExternalLink, Gift, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';

interface ParlayLeg {
  eventName: string;
  prediction: string;
  odds: number;
}

interface BetConfirmation {
  betId: string;
  eventName: string;
  prediction: string;
  odds: number;
  stake: number;
  currency: string;
  potentialWin: number;
  txHash: string | null;
  status: string;
  placedAt: string;
  isParlay?: boolean;
  legs?: ParlayLeg[];
  walrusBlobId?: string | null;
  walrusUrl?: string | null;
}

export function BetSlip() {
  const { selectedBets, removeBet, clearBets, updateStake, placeBet, totalStake, potentialWinnings } = useBetting();
  const { user } = useAuth();
  const currentAccount = useCurrentAccount();
  const walletAdapter = { isConnected: !!currentAccount?.address, address: currentAccount?.address };
  const { toast } = useToast();
  const [betType, setBetType] = useState<'single' | 'parlay'>(selectedBets.length > 1 ? 'parlay' : 'single');
  const [isLoading, setIsLoading] = useState(false);
  const [betCurrency, setBetCurrency] = useState<'SUI' | 'SBETS'>('SBETS'); // Default to SBETS during SUI pause
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [confirmedBet, setConfirmedBet] = useState<BetConfirmation | null>(null);
  const [useBonus, setUseBonus] = useState(false);
  const [isGiftBet, setIsGiftBet] = useState(false);
  const [giftWallet, setGiftWallet] = useState('');
  
  // Fetch promotion bonus balance
  const { data: promotionData } = useQuery<{
    isActive: boolean;
    bonusBalance: number;
    totalBetUsd: number;
    thresholdUsd: number;
  }>({
    queryKey: ['/api/promotion/status', currentAccount?.address],
    queryFn: async () => {
      const res = await fetch(`/api/promotion/status?wallet=${currentAccount?.address}`);
      if (!res.ok) throw new Error('Failed to fetch promotion status');
      return res.json();
    },
    enabled: !!currentAccount?.address,
    refetchInterval: 30000, // Reduced from 15s
  });
  
  // Fetch betting status (SUI pause)
  const { data: bettingStatus } = useQuery<{
    suiBettingPaused: boolean;
    sbetsBettingEnabled: boolean;
    pauseMessage: string | null;
  }>({
    queryKey: ['/api/betting-status'],
    queryFn: async () => {
      const res = await fetch('/api/betting-status');
      if (!res.ok) throw new Error('Failed to fetch betting status');
      return res.json();
    },
    staleTime: 30000,
  });
  
  const suiBettingPaused = bettingStatus?.suiBettingPaused ?? true; // Default to paused for safety
  
  // Fetch free bet balance (welcome bonus + referral rewards)
  const { data: freeBetData, refetch: refetchFreeBet } = useQuery<{
    freeBetBalance: number;
    freeBetUsed: boolean;
    welcomeBonusClaimed: boolean;
    canClaimWelcome: boolean;
  }>({
    queryKey: ['/api/free-bet/status', currentAccount?.address],
    queryFn: async () => {
      const res = await fetch(`/api/free-bet/status?wallet=${currentAccount?.address}`);
      if (!res.ok) throw new Error('Failed to fetch free bet status');
      return res.json();
    },
    enabled: !!currentAccount?.address,
    refetchInterval: 30000, // Reduced from 10s
  });
  
  const freeBetBalance = freeBetData?.freeBetUsed ? 0 : (freeBetData?.freeBetBalance || 0);
  const bonusBalance = promotionData?.bonusBalance || 0;
  const [useFreeBet, setUseFreeBet] = useState(false);
  
  useEffect(() => {
    setBetType(selectedBets.length > 1 ? 'parlay' : 'single');
  }, [selectedBets.length]);

  // Listen for bet confirmation events
  useEffect(() => {
    const handleBetConfirmed = (e: CustomEvent<BetConfirmation>) => {
      setConfirmedBet(e.detail);
    };
    
    window.addEventListener('suibets:bet-confirmed', handleBetConfirmed as EventListener);
    return () => {
      window.removeEventListener('suibets:bet-confirmed', handleBetConfirmed as EventListener);
    };
  }, []);

  // Auto-dismiss confirmation after 5 seconds
  useEffect(() => {
    if (confirmedBet) {
      const timer = setTimeout(() => {
        dismissConfirmation();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [confirmedBet]);

  const copyBetId = (betId: string) => {
    navigator.clipboard.writeText(betId);
    toast({ title: "Copied!", description: "Bet ID copied to clipboard" });
  };

  const dismissConfirmation = () => {
    setConfirmedBet(null);
    clearBets(); // Clear bets after showing confirmation
  };

  const MIN_STAKE_SUI = 0.05;
  const MAX_STAKE_SUI = 100;
  const MIN_STAKE_SBETS = 1000;
  const MAX_STAKE_SBETS = 10000;
  
  const MIN_STAKE = betCurrency === 'SBETS' ? MIN_STAKE_SBETS : MIN_STAKE_SUI;
  const MAX_STAKE = betCurrency === 'SBETS' ? MAX_STAKE_SBETS : MAX_STAKE_SUI;
  
  // Track raw string inputs for each bet to allow intermediate typing states
  const [stakeInputs, setStakeInputs] = useState<Record<string, string>>({});
  const [parlayInput, setParlayInput] = useState<string>('');
  
  // Initialize stake inputs from selected bets
  useEffect(() => {
    const newInputs: Record<string, string> = {};
    selectedBets.forEach(bet => {
      if (!(bet.id in stakeInputs)) {
        newInputs[bet.id] = bet.stake ? bet.stake.toString() : '';
      }
    });
    if (Object.keys(newInputs).length > 0) {
      setStakeInputs(prev => ({ ...prev, ...newInputs }));
    }
  }, [selectedBets]);
  
  const handleStakeChange = (id: string, value: string) => {
    // Allow valid intermediate states like "0.", "1.", etc.
    // Only allow digits and one decimal point
    const cleaned = value.replace(/[^0-9.]/g, '');
    // Only allow one decimal point
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned;
    
    // Update the display value
    setStakeInputs(prev => ({ ...prev, [id]: sanitized }));
    
    // Parse and update the numeric stake (0 for empty/incomplete)
    const numValue = parseFloat(sanitized);
    updateStake(id, isNaN(numValue) ? 0 : numValue);
  };

  const setQuickStake = (id: string, amount: number) => {
    setStakeInputs(prev => ({ ...prev, [id]: amount.toString() }));
    updateStake(id, amount);
  };
  
  const handleParlayStakeChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const sanitized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned;
    
    setParlayInput(sanitized);
    
    const numValue = parseFloat(sanitized);
    if (!isNaN(numValue) && numValue >= 0) {
      // FIXED: For parlay, set FULL stake on first bet only (parlay is one combined bet)
      // The total stake calculation in BettingContext sums all bet.stakes
      selectedBets.forEach((bet, index) => {
        updateStake(bet.id, index === 0 ? numValue : 0);
      });
    } else {
      selectedBets.forEach(bet => updateStake(bet.id, 0));
    }
  };
  
  const setQuickParlayStake = (amount: number) => {
    setParlayInput(amount.toString());
    // FIXED: For parlay, set FULL stake on first bet only
    selectedBets.forEach((bet, index) => {
      updateStake(bet.id, index === 0 ? amount : 0);
    });
  };

  const handlePlaceBet = async () => {
    if (!user || !walletAdapter.isConnected) {
      toast({
        title: "Connect Wallet",
        description: "Please connect your wallet to place bets",
        variant: "destructive",
      });
      const connectWalletEvent = new CustomEvent('suibets:connect-wallet-required');
      window.dispatchEvent(connectWalletEvent);
      return;
    }
    
    if (totalStake <= 0) {
      toast({
        title: "Invalid stake",
        description: "Please enter a valid stake amount",
        variant: "destructive",
      });
      return;
    }
    
    if (betType === 'single') {
      const invalidBets = selectedBets.filter(bet => !bet.stake || bet.stake < MIN_STAKE);
      if (invalidBets.length > 0) {
        toast({
          title: "Minimum stake required",
          description: `Please enter at least ${MIN_STAKE} ${betCurrency} for each bet`,
          variant: "destructive",
        });
        return;
      }
      // Check max stake for each bet
      const overMaxBets = selectedBets.filter(bet => bet.stake && bet.stake > MAX_STAKE);
      if (overMaxBets.length > 0) {
        toast({
          title: "Maximum stake exceeded",
          description: `Maximum bet is ${MAX_STAKE} ${betCurrency} per bet`,
          variant: "destructive",
        });
        return;
      }
    } else {
      // For parlay, check total stake
      if (totalStake < MIN_STAKE) {
        toast({
          title: "Minimum stake required",
          description: `Please enter at least ${MIN_STAKE} ${betCurrency}`,
          variant: "destructive",
        });
        return;
      }
      // Check max stake for parlay
      if (totalStake > MAX_STAKE) {
        toast({
          title: "Maximum stake exceeded",
          description: `Maximum bet is ${MAX_STAKE} ${betCurrency} per parlay`,
          variant: "destructive",
        });
        return;
      }
    }
    
    if (isGiftBet) {
      if (!giftWallet || !/^0x[0-9a-fA-F]{64}$/.test(giftWallet)) {
        toast({
          title: "Invalid recipient wallet",
          description: "Please enter a valid Sui wallet address (starts with 0x)",
          variant: "destructive",
        });
        return;
      }
      if (giftWallet.toLowerCase() === currentAccount?.address?.toLowerCase()) {
        toast({
          title: "Cannot gift to yourself",
          description: "Enter a different wallet address to send this gift bet",
          variant: "destructive",
        });
        return;
      }
    }

    setIsLoading(true);
    try {
      const currentTotal = selectedBets.reduce((sum, bet) => sum + (Number.isFinite(bet.stake) ? bet.stake : 0), 0);
      const success = await placeBet(currentTotal, {
        betType,
        currency: betCurrency,
        acceptOddsChange: true,
        useBonus: useBonus && bonusBalance > 0,
        useFreeBet: useFreeBet && freeBetBalance > 0 && betCurrency === 'SBETS',
        giftRecipientWallet: isGiftBet && giftWallet ? giftWallet : undefined,
      });
      
      if (success) {
        // Bet confirmation is shown via the event listener
        // Bets will be cleared when user dismisses the confirmation
        // Reset bonus toggles after successful bet
        setUseBonus(false);
        setUseFreeBet(false);
        setIsGiftBet(false);
        setGiftWallet('');
        refetchFreeBet();
      } else {
        toast({
          title: "Bet Failed",
          description: "There was an error placing your bet. Check your balance.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Show confirmation slip if a bet was just confirmed
  if (confirmedBet) {
    return (
      <div className="bg-[#111111] border border-green-500/50 rounded-lg shadow-xl" data-testid="bet-confirmation">
        {/* Confirmation Header */}
        <div className="bg-green-900/30 px-4 py-3 border-b border-green-500/30">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-green-400" size={24} />
            <span className="text-green-400 font-bold text-lg">Bet Confirmed!</span>
          </div>
        </div>
        
        {/* Bet Details */}
        <div className="px-4 py-4 space-y-3">
          {confirmedBet.isParlay && confirmedBet.legs ? (
            <>
              <div className="text-white text-sm font-medium">Parlay ({confirmedBet.legs.length} legs)</div>
              <div className="space-y-2 border-l-2 border-cyan-500/30 pl-3">
                {confirmedBet.legs.map((leg, idx) => (
                  <div key={idx} className="text-sm">
                    <div className="text-gray-400 text-xs">{leg.eventName}</div>
                    <div className="text-cyan-400 font-medium">{leg.prediction} @{leg.odds.toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-gray-400 text-sm">Combined Odds:</span>
                <span className="text-cyan-400 font-bold">@{confirmedBet.odds.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-white text-sm font-medium">{confirmedBet.eventName}</div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Selection:</span>
                <span className="text-cyan-400 font-medium">{confirmedBet.prediction} @{confirmedBet.odds.toFixed(2)}</span>
              </div>
            </>
          )}
          
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Stake:</span>
            <span className="text-white font-medium">{confirmedBet.stake.toFixed(4)} {confirmedBet.currency}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Potential Win:</span>
            <span className="text-green-400 font-bold">{confirmedBet.potentialWin.toFixed(4)} {confirmedBet.currency}</span>
          </div>
          
          <div className="border-t border-gray-700 pt-3 mt-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Bet ID:</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-300 text-xs font-mono">
                  {confirmedBet.betId?.slice(0, 12)}...
                </span>
                <button 
                  onClick={() => copyBetId(confirmedBet.betId)}
                  className="text-gray-400 hover:text-cyan-400 transition-colors"
                  data-testid="btn-copy-bet-id"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
            
            {confirmedBet.txHash && (
              <div className="flex justify-between items-center mt-2">
                <span className="text-gray-400 text-sm">TX:</span>
                <a 
                  href={`https://suiscan.xyz/mainnet/tx/${confirmedBet.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs font-mono"
                >
                  {confirmedBet.txHash.slice(0, 12)}...
                  <ExternalLink size={12} />
                </a>
              </div>
            )}

            {confirmedBet.walrusBlobId && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-purple-400 text-xs font-semibold">🐋 Walrus Receipt</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-xs">Blob ID:</span>
                  <span className="text-purple-300 text-xs font-mono">
                    {confirmedBet.walrusBlobId.startsWith('local_')
                      ? confirmedBet.walrusBlobId.slice(6, 18) + '...'
                      : confirmedBet.walrusBlobId.slice(0, 14) + '...'}
                  </span>
                </div>
                {confirmedBet.walrusUrl ? (
                  <a
                    href={confirmedBet.walrusUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-xs mt-1 justify-end"
                    data-testid="link-walrus-receipt"
                  >
                    Verify on Walrus <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-gray-500 text-xs mt-1 block text-right">Receipt saved</span>
                )}
              </div>
            )}
          </div>
          
          <button
            onClick={dismissConfirmation}
            className="w-full mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-3 px-4 rounded-lg transition-colors"
            data-testid="btn-dismiss-confirmation"
          >
            Place Another Bet
          </button>
        </div>
      </div>
    );
  }

  // Don't render if no bets
  if (selectedBets.length === 0) {
    return null;
  }

  return (
    <div className="bg-[#111111] border border-cyan-900/50 rounded-lg shadow-xl" data-testid="betslip">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/30 cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 font-bold text-lg">Bet Slip</span>
          <span className="bg-cyan-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">
            {selectedBets.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={(e) => { e.stopPropagation(); clearBets(); }}
            className="text-gray-500 hover:text-red-400 transition-colors"
            data-testid="btn-clear-bets"
          >
            <Trash2 size={16} />
          </button>
          {isCollapsed ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
        </div>
      </div>

      {/* Bonus Balance Banner - only show when bonus > 0 */}
      {promotionData?.isActive && !isCollapsed && (
        <div className="bg-gradient-to-r from-yellow-500/20 via-orange-500/20 to-yellow-500/20 border-b border-yellow-500/30 px-4 py-3" data-testid="promo-banner">
          <div className="flex items-center justify-between text-[11px] font-bold text-yellow-500 uppercase tracking-wider mb-2">
            <div className="flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 fill-yellow-500 animate-pulse" />
              <span>Bet $15 → Get $5 Free!</span>
            </div>
            <span className="bg-black/40 px-2 py-0.5 rounded-full border border-yellow-500/20">
              Progress: ${promotionData?.totalBetUsd?.toFixed(2) || "0.00"}/${promotionData?.thresholdUsd || "15"}.00
            </span>
          </div>
          <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5 mb-2">
            <div 
              className="h-full bg-gradient-to-r from-yellow-400 via-orange-500 to-yellow-400 bg-[length:200%_100%] animate-shimmer transition-all duration-1000 ease-out"
              style={{ width: `${Math.min(100, ((promotionData?.totalBetUsd || 0) % (promotionData?.thresholdUsd || 15)) / (promotionData?.thresholdUsd || 15) * 100)}%` }}
            />
          </div>
          {bonusBalance > 0 && (
            <div className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-md p-2">
              <div className="flex flex-col">
                <span className="text-[10px] text-green-400/80 font-semibold uppercase tracking-tighter leading-none mb-1">Available Bonus Credit</span>
                <span className="text-white text-xs font-bold leading-none">Use for your next bet!</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-white bg-green-500 px-2 py-1 rounded text-sm font-black shadow-lg shadow-green-500/20 animate-bounce-subtle">
                  ${bonusBalance.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {!isCollapsed && (
        <>
          {/* Bet Type Tabs */}
          {selectedBets.length > 1 && (
            <div className="flex border-b border-cyan-900/30">
              <button
                onClick={() => setBetType('single')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  betType === 'single' 
                    ? 'text-cyan-400 border-b-2 border-cyan-400' 
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Singles
              </button>
              <button
                onClick={() => setBetType('parlay')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  betType === 'parlay' 
                    ? 'text-cyan-400 border-b-2 border-cyan-400' 
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Parlay
              </button>
            </div>
          )}

          {/* Bets List */}
          <div className="max-h-60 overflow-y-auto">
            {selectedBets.map((bet) => (
              <div key={bet.id} className="px-4 py-3 border-b border-cyan-900/20 hover:bg-[#1a1a1a] transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 pr-2">
                    <p className="text-white text-sm font-medium truncate">{bet.eventName}</p>
                    <p className="text-gray-500 text-xs">{bet.market}</p>
                  </div>
                  <button 
                    onClick={() => removeBet(bet.id)}
                    className="text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-medium">{bet.selectionName}</span>
                    <span className="text-cyan-500 font-bold">@{bet.odds.toFixed(2)}</span>
                    {bet.isLive && (
                      <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded animate-pulse">LIVE</span>
                    )}
                  </div>
                </div>

                {betType === 'single' && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={stakeInputs[bet.id] ?? ''}
                          onChange={(e) => handleStakeChange(bet.id, e.target.value)}
                          placeholder={`Min ${MIN_STAKE}`}
                          className="w-full bg-[#0a0a0a] border border-cyan-900/50 rounded px-3 py-1.5 text-white text-sm focus:border-cyan-500 focus:outline-none pr-12"
                          data-testid={`input-stake-${bet.id}`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{betCurrency}</span>
                      </div>
                      <span className="text-gray-400 text-xs whitespace-nowrap">
                        Win: <span className="text-cyan-400 font-medium">{((Number.isFinite(bet.stake) ? bet.stake : 0) * bet.odds).toFixed(2)}</span>
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {[0.1, 0.5, 1, 2, 5].map((amount) => (
                        <button
                          key={amount}
                          onClick={() => setQuickStake(bet.id, amount)}
                          className="flex-1 text-xs py-1 bg-[#1a1a1a] hover:bg-cyan-900/30 text-gray-400 hover:text-cyan-400 rounded transition-colors"
                          data-testid={`btn-quick-stake-${amount}`}
                        >
                          {amount}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1" data-testid="text-max-bet-single">
                      Max bet: {MAX_STAKE.toLocaleString()} {betCurrency}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Parlay Stake Input */}
          {betType === 'parlay' && (
            <div className="px-4 py-3 border-b border-cyan-900/20">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400 text-sm">Combined Odds:</span>
                <span className="text-cyan-400 font-bold">
                  {selectedBets.reduce((total, bet) => total * bet.odds, 1).toFixed(2)}
                </span>
              </div>
              <a 
                href="/parlay" 
                className="block text-center text-xs text-purple-400 hover:text-purple-300 mb-2 underline"
                data-testid="link-parlay-builder"
              >
                Open Full Parlay Builder
              </a>
              <div className="relative mb-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={parlayInput}
                  onChange={(e) => handleParlayStakeChange(e.target.value)}
                  placeholder={`Min ${MIN_STAKE} ${betCurrency}`}
                  className="w-full bg-[#0a0a0a] border border-cyan-900/50 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none pr-14"
                  data-testid="input-parlay-stake"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{betCurrency}</span>
              </div>
              <div className="flex gap-1">
                {[0.1, 0.5, 1, 2, 5].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setQuickParlayStake(amount)}
                    className="flex-1 text-xs py-1 bg-[#1a1a1a] hover:bg-cyan-900/30 text-gray-400 hover:text-cyan-400 rounded transition-colors"
                    data-testid={`btn-parlay-quick-${amount}`}
                  >
                    {amount}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-500 mt-1" data-testid="text-max-bet-parlay">
                Max bet: {MAX_STAKE.toLocaleString()} {betCurrency}
              </p>
            </div>
          )}

          {/* Currency & Total */}
          <div className="px-4 py-3 border-b border-cyan-900/20">
            {/* SUI Betting Paused Banner */}
            {suiBettingPaused && (
              <div className="bg-orange-500/20 border border-orange-500/40 rounded-lg p-3 mb-3" data-testid="sui-pause-banner">
                <div className="flex items-center gap-2">
                  <span className="text-orange-400 text-lg">⏸️</span>
                  <div className="flex flex-col">
                    <span className="text-orange-400 font-bold text-sm">SUI Betting Paused</span>
                    <span className="text-orange-300/80 text-xs">Bet with SBETS while we fund the treasury!</span>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Currency:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => !suiBettingPaused && setBetCurrency('SUI')}
                  disabled={suiBettingPaused}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    suiBettingPaused
                      ? 'bg-gray-800 text-gray-600 cursor-not-allowed line-through'
                      : betCurrency === 'SUI' 
                        ? 'bg-cyan-500 text-black' 
                        : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
                  }`}
                  data-testid="btn-currency-sui"
                >
                  SUI {suiBettingPaused && '(Paused)'}
                </button>
                <button
                  onClick={() => setBetCurrency('SBETS')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    betCurrency === 'SBETS' 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
                  }`}
                  data-testid="btn-currency-sbets"
                >
                  SBETS
                </button>
              </div>
            </div>
            
            {/* FREE SBETS - Apply to bet with one click */}
            {freeBetBalance > 0 && (
              <div className="bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/40 rounded-lg p-3 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gift className="w-5 h-5 text-cyan-400 animate-pulse" />
                    <div className="flex flex-col">
                      <span className="text-cyan-300 font-bold text-sm">FREE SBETS</span>
                      <span className="text-cyan-400 text-lg font-black">{freeBetBalance.toLocaleString()} SBETS</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setBetCurrency('SBETS');
                      setUseFreeBet(true);
                      if (selectedBets.length > 0) {
                        updateStake(selectedBets[0].id, Math.min(freeBetBalance, 1000));
                      }
                    }}
                    className={`px-4 py-2 font-bold rounded-lg text-sm transition-all ${
                      useFreeBet 
                        ? 'bg-cyan-400 text-black ring-2 ring-cyan-300' 
                        : 'bg-cyan-500 hover:bg-cyan-400 text-black'
                    }`}
                    data-testid="btn-use-free-sbets"
                  >
                    {useFreeBet ? 'USING FREE SBETS' : 'USE FREE SBETS'}
                  </button>
                </div>
              </div>
            )}
            
            {/* Use Promotion Bonus Toggle - Show when user has promotion bonus */}
            {bonusBalance > 0 && (
              <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-2">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-green-400" />
                  <div className="flex flex-col">
                    <span className="text-green-400 font-bold text-sm">Use Promo Bonus</span>
                    <span className="text-green-400/70 text-xs">${bonusBalance.toFixed(2)} available</span>
                  </div>
                </div>
                <button
                  onClick={() => setUseBonus(!useBonus)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    useBonus ? 'bg-green-500' : 'bg-gray-600'
                  } relative`}
                  data-testid="toggle-use-bonus"
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    useBonus ? 'right-1' : 'left-1'
                  }`} />
                </button>
              </div>
            )}
            
            {useBonus && bonusBalance > 0 && (
              <div className="text-center text-xs text-green-400 mt-2 bg-green-500/10 py-1 rounded">
                Your ${Math.min(bonusBalance, totalStake * 1.5).toFixed(2)} promo bonus will be applied!
              </div>
            )}
            
            {betType === 'single' && (
              <div className="mt-3">
                <div className="flex items-center justify-between bg-pink-500/10 border border-pink-500/30 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Gift className="w-4 h-4 text-pink-400" />
                    <span className="text-pink-400 font-bold text-sm">Gift This Bet</span>
                  </div>
                  <button
                    onClick={() => setIsGiftBet(!isGiftBet)}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      isGiftBet ? 'bg-pink-500' : 'bg-gray-600'
                    } relative`}
                    data-testid="toggle-gift-bet"
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      isGiftBet ? 'right-1' : 'left-1'
                    }`} />
                  </button>
                </div>
                {isGiftBet && (
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      placeholder="Recipient wallet address (0x...)"
                      value={giftWallet}
                      onChange={(e) => setGiftWallet(e.target.value.trim())}
                      className="w-full bg-[#1a1a1a] border border-pink-500/30 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-pink-400"
                      data-testid="input-gift-wallet"
                    />
                    <p className="text-pink-400/70 text-xs">
                      Winnings will be sent to this wallet if the bet wins
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mt-2">
              <span className="text-gray-400 text-sm">Potential Win:</span>
              <span className="text-cyan-400 font-bold text-lg">{potentialWinnings.toFixed(2)} {betCurrency}</span>
            </div>
          </div>

          {/* Place Bet Button */}
          <div className="p-4">
            <button
              onClick={handlePlaceBet}
              disabled={isLoading || totalStake <= 0}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              data-testid="btn-place-bet"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </>
              ) : (
                `${isGiftBet ? 'Gift' : 'Place'} ${betType === 'parlay' ? 'Parlay' : 'Bet'} - ${totalStake.toFixed(2)} ${betCurrency}`
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default BetSlip;
