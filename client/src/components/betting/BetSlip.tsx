import { useState, useEffect, useCallback } from 'react';
import { useBetting } from '@/context/BettingContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { X, Trash2, ChevronUp, ChevronDown, CheckCircle2, Copy, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
}

export function BetSlip() {
  const { selectedBets, removeBet, clearBets, updateStake, placeBet, totalStake, potentialWinnings } = useBetting();
  const { user } = useAuth();
  const currentAccount = useCurrentAccount();
  const walletAdapter = { isConnected: !!currentAccount?.address, address: currentAccount?.address };
  const { toast } = useToast();
  const [betType, setBetType] = useState<'single' | 'parlay'>(selectedBets.length > 1 ? 'parlay' : 'single');
  const [isLoading, setIsLoading] = useState(false);
  const [betCurrency, setBetCurrency] = useState<'SUI' | 'SBETS'>('SUI');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [confirmedBet, setConfirmedBet] = useState<BetConfirmation | null>(null);
  
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

  // Separate limits for SUI and SBETS (matching on-chain contract)
  const MIN_STAKE_SUI = 0.05;       // 50,000,000 MIST
  const MAX_STAKE_SUI = 20;         // 20,000,000,000 MIST
  const MIN_STAKE_SBETS = 1000;     // 1,000,000,000,000 MIST
  const MAX_STAKE_SBETS = 10000000; // 10,000,000,000,000,000 MIST
  
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
    
    setIsLoading(true);
    try {
      const currentTotal = selectedBets.reduce((sum, bet) => sum + (bet.stake || 0), 0);
      const success = await placeBet(currentTotal, {
        betType,
        currency: betCurrency,
        acceptOddsChange: true
      });
      
      if (success) {
        // Bet confirmation is shown via the event listener
        // Bets will be cleared when user dismisses the confirmation
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
          <div className="text-white text-sm font-medium">{confirmedBet.eventName}</div>
          
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Selection:</span>
            <span className="text-cyan-400 font-medium">{confirmedBet.prediction} @{confirmedBet.odds.toFixed(2)}</span>
          </div>
          
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
                        Win: <span className="text-cyan-400 font-medium">{((bet.stake || 0) * bet.odds).toFixed(2)}</span>
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
            </div>
          )}

          {/* Currency & Total */}
          <div className="px-4 py-3 border-b border-cyan-900/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Currency:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setBetCurrency('SUI')}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    betCurrency === 'SUI' 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
                  }`}
                  data-testid="btn-currency-sui"
                >
                  SUI
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
            <div className="flex items-center justify-between">
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
                `Place ${betType === 'parlay' ? 'Parlay' : 'Bet'} - ${totalStake.toFixed(2)} ${betCurrency}`
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default BetSlip;
