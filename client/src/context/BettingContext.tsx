import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { BettingContextType, SelectedBet, PlaceBetOptions } from '@/types/index';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from './AuthContext';
import { useToast } from '@/hooks/use-toast';
import { calculatePotentialWinnings, calculateParlayOdds } from '@/lib/utils';
import { useOnChainBet } from '@/hooks/useOnChainBet';
import { useCurrentAccount } from '@mysten/dapp-kit';

// Create betting context
const BettingContext = createContext<BettingContextType>({
  selectedBets: [],
  addBet: () => {},
  removeBet: () => {},
  clearBets: () => {},
  placeBet: async () => false,
  totalStake: 0,
  potentialWinnings: 0,
  updateStake: () => {},
});

// Custom hook to use the betting context
export const useBetting = () => useContext(BettingContext);

// Load bets from localStorage (outside component to avoid React warnings)
const loadSavedBets = (): SelectedBet[] => {
  try {
    const savedBets = localStorage.getItem('selectedBets');
    return savedBets ? JSON.parse(savedBets) : [];
  } catch (e) {
    console.error("Error loading bets from localStorage:", e);
    return [];
  }
};

// Provider for betting context
export const BettingProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  // Initialize with saved bets from localStorage
  const [selectedBets, setSelectedBets] = useState<SelectedBet[]>(loadSavedBets);
  const { user } = useAuth();
  const { toast } = useToast();
  
  // On-chain betting hook (SUI and SBETS)
  const currentAccount = useCurrentAccount();
  const { placeBetOnChain, getSbetsCoins, isLoading: isOnChainLoading } = useOnChainBet();
  
  // Save bets to localStorage whenever they change
  useEffect(() => {
    console.log("Saving bets to localStorage:", selectedBets);
    localStorage.setItem('selectedBets', JSON.stringify(selectedBets));
  }, [selectedBets]);

  // Add a bet to the selection - with improved handling for better user experience
  const addBet = (bet: SelectedBet) => {
    console.log("BettingContext: Adding bet to slip", bet);
    
    // Block bets on live matches when time reaches 80 minutes
    if (bet.isLive && bet.matchMinute !== undefined && bet.matchMinute >= 80) {
      console.log(`BettingContext: Bet blocked - match at ${bet.matchMinute} minutes (>= 80 min cutoff)`);
      toast({
        title: "Betting Closed",
        description: `Betting is closed for this match (${bet.matchMinute}' played)`,
        variant: "destructive",
      });
      return;
    }
    
    // Ensure we have the current state by using a callback with setSelectedBets
    setSelectedBets(prevBets => {
      // First, check if this is a duplicate bet with the same selection
      // but allow duplicates if there's a uniqueId (which is used to prevent auto-duplication)
      const isDuplicate = !bet.uniqueId && prevBets.some(
        (existing) => 
          existing.eventId === bet.eventId && 
          existing.market === bet.market && 
          existing.selectionName === bet.selectionName
      );
      
      if (isDuplicate) {
        console.log("BettingContext: Potential duplicate bet detected", bet.id);
        
        // Show a toast to inform user this bet is already in the slip
        toast({
          title: "Bet Already in Slip",
          description: `${bet.selectionName} is already in your bet slip`,
        });
        
        return prevBets; // Don't change the bet array
      }
      
      // Check if we already have this specific bet by ID (for updates)
      const existingBetIndex = prevBets.findIndex(
        (existing) => existing.id === bet.id
      );
  
      if (existingBetIndex >= 0) {
        console.log("BettingContext: Updating existing bet", existingBetIndex);
        // Replace the existing bet in a new array
        const updatedBets = [...prevBets];
        updatedBets[existingBetIndex] = bet;
        
        toast({
          title: "Bet Updated",
          description: `Updated ${bet.selectionName} in your bet slip`,
        });
        
        return updatedBets;
      } else {
        console.log("BettingContext: Adding new bet to slip", prevBets.length);
        // Add a new bet to the array
        const newBets = [...prevBets, bet];
        console.log("BettingContext: New bets array length:", newBets.length);
        
        // Always show a toast for successful bet addition
        toast({
          title: "Bet Added",
          description: `Added ${bet.selectionName} to your bet slip`,
          variant: "default",
        });
        
        return newBets;
      }
    });
    
    // Log the current bets after the state update for debugging
    setTimeout(() => {
      const updatedBets = JSON.parse(localStorage.getItem('selectedBets') || '[]');
      console.log("BettingContext: Current bets count:", updatedBets.length);
    }, 500);
  };

  // Remove a bet from the selection
  // FIXED: Use functional form to avoid stale closure
  const removeBet = (id: string) => {
    setSelectedBets(prevBets => prevBets.filter((bet) => bet.id !== id));
  };

  // Clear all bets
  const clearBets = () => {
    setSelectedBets([]);
  };

  // Update stake amount for a bet
  // FIXED: Use functional form to avoid stale closure when called in rapid succession
  const updateStake = (id: string, stake: number) => {
    setSelectedBets(prevBets =>
      prevBets.map((bet) => (bet.id === id ? { ...bet, stake } : bet))
    );
  };

  // Place a bet (handle both single and parlay bets)
  const placeBet = async (betAmount: number, options?: PlaceBetOptions): Promise<boolean> => {
    try {
      if (!user) {
        toast({
          title: "Authentication required",
          description: "Please connect your wallet to place bets",
          variant: "destructive",
        });
        
        // Auto-show connect wallet modal when user tries to place a bet
        const connectWalletEvent = new CustomEvent('suibets:connect-wallet-required');
        window.dispatchEvent(connectWalletEvent);
        
        return false;
      }

      if (selectedBets.length === 0) {
        toast({
          title: "No bets selected",
          description: "Please select at least one bet",
          variant: "destructive",
        });
        return false;
      }

      // On-chain betting - funds come directly from connected wallet
      const betOptions: PlaceBetOptions = {
        betType: selectedBets.length > 1 ? 'parlay' : 'single',
        currency: options?.currency || 'SUI',
        acceptOddsChange: true,
        paymentMethod: 'wallet', // On-chain betting from wallet balance
        ...options,
      };

      // For single bets
      if (betOptions.betType === 'single' && selectedBets.length === 1) {
        const bet = selectedBets[0];
        const stakeAmount = bet.stake || betAmount;

        // OPTION 1: Platform Balance (off-chain, deduct from database)
        if (betOptions.paymentMethod === 'platform') {
          try {
            const response = await apiRequest('POST', '/api/bets', {
              userId: user.walletAddress || currentAccount?.address,
              walletAddress: user.walletAddress || currentAccount?.address,
              eventId: bet.eventId,
              eventName: bet.eventName,
              marketId: bet.marketId,
              outcomeId: bet.outcomeId,
              odds: bet.odds,
              betAmount: stakeAmount,
              prediction: bet.selectionName,
              potentialPayout: calculatePotentialWinnings(stakeAmount, bet.odds),
              feeCurrency: betOptions.currency,
              paymentMethod: 'platform',
              status: 'pending',
              isLive: bet.isLive,
              matchMinute: bet.matchMinute,
            });

            if (response.ok) {
              const betData = await response.json();
              
              // Emit event with bet confirmation details for UI to display
              const betConfirmedEvent = new CustomEvent('suibets:bet-confirmed', {
                detail: {
                  betId: betData.id || betData.betId,
                  eventName: bet.eventName,
                  prediction: bet.selectionName,
                  odds: bet.odds,
                  stake: stakeAmount,
                  currency: betOptions.currency,
                  potentialWin: calculatePotentialWinnings(stakeAmount, bet.odds),
                  txHash: betData.txHash || null,
                  status: 'confirmed',
                  placedAt: new Date().toISOString(),
                }
              });
              window.dispatchEvent(betConfirmedEvent);
              
              toast({
                title: "✅ Bet Confirmed!",
                description: `${bet.selectionName} @ ${bet.odds.toFixed(2)} - ${stakeAmount} ${betOptions.currency}`,
              });
              // Don't clear bets here - let BetSlip show confirmation first
              // Bets will be cleared when user dismisses the confirmation
              return true;
            } else {
              const errorData = await response.json();
              toast({
                title: "Failed to place bet",
                description: errorData.message || "Insufficient balance or error occurred",
                variant: "destructive",
              });
              return false;
            }
          } catch (error: any) {
            toast({
              title: "Error placing bet",
              description: error.message || "An unexpected error occurred",
              variant: "destructive",
            });
            return false;
          }
        }

        // OPTION 2: Direct Wallet (on-chain for SUI, off-chain for SBETS)
        // Check if wallet is connected
        if (!currentAccount?.address) {
          toast({
            title: "Wallet Required",
            description: "Connect your Sui wallet to place bets",
            variant: "destructive",
          });
          
          const connectWalletEvent = new CustomEvent('suibets:connect-wallet-required');
          window.dispatchEvent(connectWalletEvent);
          return false;
        }

        // Get SBETS coin object if needed for SBETS bets
        let sbetsCoinObjectId: string | undefined;
        if (betOptions.currency === 'SBETS') {
          const sbetsCoins = await getSbetsCoins(currentAccount.address);
          if (sbetsCoins.length === 0 || sbetsCoins[0].balance < stakeAmount) {
            toast({
              title: "Insufficient SBETS",
              description: "You don't have enough SBETS tokens for this bet",
              variant: "destructive",
            });
            return false;
          }
          sbetsCoinObjectId = sbetsCoins[0].objectId;
        }

        // PRE-FLIGHT CHECK: Validate event is still bettable BEFORE on-chain transaction
        // This prevents money being sent to contract only to have database save fail
        try {
          const validationResponse = await apiRequest('POST', '/api/bets/validate', {
            eventId: String(bet.eventId),
            isLive: bet.isLive,
          });
          if (!validationResponse.ok) {
            const errorData = await validationResponse.json();
            toast({
              title: "Betting Closed",
              description: errorData.message || "This match is no longer accepting bets",
              variant: "destructive",
            });
            return false;
          }
        } catch (validationError: any) {
          // If validation endpoint doesn't exist, proceed (backwards compatibility)
          console.log('[BettingContext] Validation check skipped:', validationError.message);
        }

        // Both SUI and SBETS use on-chain smart contract
        const onChainResult = await placeBetOnChain({
          eventId: String(bet.eventId),
          marketId: String(bet.marketId || 'match_winner'),
          prediction: bet.selectionName,
          betAmount: stakeAmount,
          odds: bet.odds,
          walrusBlobId: '',
          coinType: betOptions.currency as 'SUI' | 'SBETS',
          sbetsCoinObjectId,
          walletAddress: currentAccount.address,
        });

        if (!onChainResult.success) {
          // On-chain bet failed - don't clear slip, error already shown by hook
          return false;
        }

        // On-chain bet succeeded - now record in database
        try {
          const response = await apiRequest('POST', '/api/bets', {
            userId: currentAccount.address,
            walletAddress: currentAccount.address,
            eventId: String(bet.eventId),
            eventName: bet.eventName,
            marketId: String(bet.marketId || 'match_winner'),
            outcomeId: String(bet.outcomeId || bet.selectionName || 'selection'),
            odds: bet.odds,
            betAmount: stakeAmount,
            prediction: bet.selectionName,
            potentialPayout: calculatePotentialWinnings(stakeAmount, bet.odds),
            feeCurrency: betOptions.currency,
            txHash: onChainResult.txDigest,
            onChainBetId: onChainResult.betObjectId,
            paymentMethod: 'wallet',
            status: 'confirmed',
          });

          if (response.ok) {
            const betData = await response.json();
            
            // Emit confirmation event for UI
            const betConfirmedEvent = new CustomEvent('suibets:bet-confirmed', {
              detail: {
                betId: betData.bet?.id || onChainResult.betObjectId,
                eventName: bet.eventName,
                prediction: bet.selectionName,
                odds: bet.odds,
                stake: stakeAmount,
                currency: betOptions.currency,
                potentialWin: calculatePotentialWinnings(stakeAmount, bet.odds),
                txHash: onChainResult.txDigest,
                status: 'confirmed',
                placedAt: new Date().toISOString(),
              }
            });
            window.dispatchEvent(betConfirmedEvent);
            
            const txLink = `https://suiscan.xyz/mainnet/tx/${onChainResult.txDigest}`;
            toast({
              title: "Bet Placed On-Chain!",
              description: (
                <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">
                  View TX: {onChainResult.txDigest?.slice(0, 12)}...
                </a>
              ),
            });
            // Bets cleared when user dismisses confirmation
            return true;
          } else {
            // Database failed but bet is on-chain - keep in slip for retry
            const txLink = `https://suiscan.xyz/mainnet/tx/${onChainResult.txDigest}`;
            toast({
              title: "Database Error",
              description: (
                <div className="flex flex-col gap-1">
                  <span>Bet on-chain but failed to save. Retry or contact support.</span>
                  <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">
                    View TX: {onChainResult.txDigest?.slice(0, 12)}...
                  </a>
                </div>
              ),
              variant: "destructive",
            });
            // Store txHash locally for recovery
            localStorage.setItem('pendingOnChainBet', JSON.stringify({
              txDigest: onChainResult.txDigest,
              betObjectId: onChainResult.betObjectId,
              bet,
              stakeAmount,
              timestamp: Date.now(),
            }));
            return false;
          }
        } catch (dbError: any) {
          // Database error but bet is on-chain
          const txLink = `https://suiscan.xyz/mainnet/tx/${onChainResult.txDigest}`;
          toast({
            title: "Database Error",
            description: (
              <div className="flex flex-col gap-1">
                <span>Bet on-chain but failed to save.</span>
                <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">
                  View TX: {onChainResult.txDigest?.slice(0, 12)}...
                </a>
              </div>
            ),
            variant: "destructive",
          });
          localStorage.setItem('pendingOnChainBet', JSON.stringify({
            txDigest: onChainResult.txDigest,
            betObjectId: onChainResult.betObjectId,
            bet,
            stakeAmount,
            timestamp: Date.now(),
          }));
          return false;
        }
      }

      // For parlay bets - ON-CHAIN
      if (betOptions.betType === 'parlay' && selectedBets.length > 1) {
        const parlayOdds = calculateParlayOdds(selectedBets);
        const potentialPayout = calculatePotentialWinnings(betAmount, parlayOdds);

        // Check if wallet is connected for on-chain parlay
        if (!currentAccount?.address) {
          toast({
            title: "Wallet Required",
            description: "Connect your Sui wallet to place parlay bets",
            variant: "destructive",
          });
          const connectWalletEvent = new CustomEvent('suibets:connect-wallet-required');
          window.dispatchEvent(connectWalletEvent);
          return false;
        }

        // Get SBETS coin object if needed for SBETS parlay bets
        let sbetsCoinObjectId: string | undefined;
        if (betOptions.currency === 'SBETS') {
          const sbetsCoins = await getSbetsCoins(currentAccount.address);
          if (sbetsCoins.length === 0 || sbetsCoins[0].balance < betAmount) {
            toast({
              title: "Insufficient SBETS",
              description: "You don't have enough SBETS tokens for this parlay",
              variant: "destructive",
            });
            return false;
          }
          sbetsCoinObjectId = sbetsCoins[0].objectId;
        }

        // Create combined parlay data for on-chain
        const parlayEventId = `parlay_${Date.now()}_${selectedBets.map(b => b.eventId).join('_')}`;
        const parlayMarketId = 'parlay_combined';
        const parlayPrediction = selectedBets.map(b => `${b.eventName}: ${b.selectionName}`).join(' | ').slice(0, 500);

        // Place on-chain bet
        const onChainResult = await placeBetOnChain({
          eventId: parlayEventId,
          marketId: parlayMarketId,
          prediction: parlayPrediction,
          betAmount: betAmount,
          odds: parlayOdds,
          walrusBlobId: '',
          coinType: betOptions.currency as 'SUI' | 'SBETS',
          sbetsCoinObjectId,
          walletAddress: currentAccount.address,
        });

        if (!onChainResult.success) {
          return false; // Error already shown by hook
        }

        // Save to database after successful on-chain transaction
        const response = await apiRequest('POST', '/api/parlays', {
          userId: currentAccount.address,
          walletAddress: currentAccount.address,
          totalOdds: parlayOdds,
          betAmount: betAmount,
          potentialPayout: potentialPayout,
          feeCurrency: betOptions.currency,
          txHash: onChainResult.txDigest,
          onChainBetId: onChainResult.betObjectId,
          status: 'confirmed',
          legs: selectedBets.map(bet => ({
            eventId: bet.eventId,
            marketId: bet.marketId,
            outcomeId: bet.outcomeId,
            odds: bet.odds,
            prediction: bet.selectionName,
          })),
        });

        if (response.ok) {
          const txLink = `https://suiscan.xyz/mainnet/tx/${onChainResult.txDigest}`;
          toast({
            title: "Parlay Placed On-Chain!",
            description: (
              <div className="flex flex-col gap-1">
                <span>{selectedBets.length} legs @ {parlayOdds.toFixed(2)}x</span>
                <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">
                  View TX: {onChainResult.txDigest?.slice(0, 12)}...
                </a>
              </div>
            ),
          });
          clearBets();
          return true;
        } else {
          // On-chain succeeded but DB failed - still success
          const txLink = `https://suiscan.xyz/mainnet/tx/${onChainResult.txDigest}`;
          toast({
            title: "Parlay On-Chain!",
            description: (
              <div className="flex flex-col gap-1">
                <span>DB save pending</span>
                <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">
                  View TX: {onChainResult.txDigest?.slice(0, 12)}...
                </a>
              </div>
            ),
          });
          clearBets();
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error("Error placing bet:", error);
      toast({
        title: "Error placing bet",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    }
  };

  // Calculate total stake and potential winnings
  const totalStake = selectedBets.reduce((sum, bet) => sum + (Number.isFinite(bet.stake) ? bet.stake : 0), 0);
  
  // Calculate potential winnings differently for parlays vs. single bets
  const potentialWinnings = selectedBets.length > 1 
    ? calculatePotentialWinnings(
        totalStake,
        calculateParlayOdds(selectedBets.map(bet => ({ odds: bet.odds })))
      )
    : selectedBets.reduce(
        (sum, bet) => sum + calculatePotentialWinnings(Number.isFinite(bet.stake) ? bet.stake : 0, bet.odds),
        0
      );

  return (
    <BettingContext.Provider
      value={{
        selectedBets,
        addBet,
        removeBet,
        clearBets,
        placeBet,
        totalStake,
        potentialWinnings,
        updateStake,
      }}
    >
      {children}
    </BettingContext.Provider>
  );
};