import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { BettingContextType, SelectedBet, PlaceBetOptions } from '@/types/index';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from './AuthContext';
import { useToast } from '@/hooks/use-toast';
import { calculatePotentialWinnings, calculateParlayOdds } from '@/lib/utils';
import { useOnChainBet } from '@/hooks/useOnChainBet';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useZkLogin } from './ZkLoginContext';

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
  const { zkLoginAddress, isZkLoginActive } = useZkLogin();
  const { placeBetOnChain, getSbetsCoins, isLoading: isOnChainLoading } = useOnChainBet();
  const activeWalletAddress = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);
  
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
    
    setSelectedBets(prevBets => {
      const isDuplicate = !bet.uniqueId && prevBets.some(
        (existing) => 
          existing.eventId === bet.eventId && 
          existing.market === bet.market && 
          existing.selectionName === bet.selectionName
      );
      
      if (isDuplicate) {
        console.log("BettingContext: Potential duplicate bet detected", bet.id);
        toast({
          title: "Bet Already in Slip",
          description: `${bet.selectionName} is already in your bet slip`,
        });
        return prevBets;
      }
      
      const sameEventIndex = prevBets.findIndex(
        (existing) => existing.eventId === bet.eventId
      );
      
      if (sameEventIndex >= 0) {
        console.log("BettingContext: Replacing bet from same event", prevBets[sameEventIndex].selectionName, "->", bet.selectionName);
        const updatedBets = [...prevBets];
        updatedBets[sameEventIndex] = bet;
        toast({
          title: "Selection Changed",
          description: `Switched to ${bet.selectionName} for this match`,
        });
        return updatedBets;
      }
      
      const existingBetIndex = prevBets.findIndex(
        (existing) => existing.id === bet.id
      );
  
      if (existingBetIndex >= 0) {
        console.log("BettingContext: Updating existing bet", existingBetIndex);
        const updatedBets = [...prevBets];
        updatedBets[existingBetIndex] = bet;
        toast({
          title: "Bet Updated",
          description: `Updated ${bet.selectionName} in your bet slip`,
        });
        return updatedBets;
      } else {
        console.log("BettingContext: Adding new bet to slip", prevBets.length);
        const newBets = [...prevBets, bet];
        console.log("BettingContext: New bets array length:", newBets.length);
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
              userId: user.walletAddress || activeWalletAddress,
              walletAddress: user.walletAddress || activeWalletAddress,
              eventId: bet.eventId,
              eventName: bet.eventName,
              market: bet.market,
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
              homeTeam: bet.homeTeam,
              awayTeam: bet.awayTeam,
              giftRecipientWallet: betOptions.giftRecipientWallet || undefined,
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
                  walrusBlobId: betData.walrusBlobId || null,
                  walrusUrl: betData.walrusUrl || null,
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

        if (!activeWalletAddress) {
          toast({
            title: "Wallet Required",
            description: "Connect your Sui wallet or sign in with Google to place bets",
            variant: "destructive",
          });
          
          const connectWalletEvent = new CustomEvent('suibets:connect-wallet-required');
          window.dispatchEvent(connectWalletEvent);
          return false;
        }

        // FREE SBETS BET PATH - Skip on-chain, record directly to database
        if (options?.useFreeBet && betOptions.currency === 'SBETS') {
          console.log('[BettingContext] FREE SBETS bet - recording directly to DB');
          
          try {
            const response = await apiRequest('POST', '/api/bets', {
              userId: activeWalletAddress,
              walletAddress: activeWalletAddress,
              eventId: String(selectedBets[0].eventId),
              eventName: selectedBets[0].eventName,
              marketId: String(selectedBets[0].marketId || 'match_winner'),
              outcomeId: String(selectedBets[0].outcomeId || selectedBets[0].selectionName || 'selection'),
              odds: selectedBets[0].odds,
              betAmount: stakeAmount,
              prediction: selectedBets[0].selectionName,
              potentialPayout: calculatePotentialWinnings(stakeAmount, selectedBets[0].odds),
              currency: 'SBETS',
              feeCurrency: 'SBETS',
              paymentMethod: 'free_bet',
              status: 'pending',
              useFreeBet: true,
              isLive: selectedBets[0].isLive,
              matchMinute: selectedBets[0].matchMinute,
              homeTeam: selectedBets[0].homeTeam,
              awayTeam: selectedBets[0].awayTeam,
              giftRecipientWallet: betOptions.giftRecipientWallet || undefined,
            });

            if (response.ok) {
              const betData = await response.json();
              
              const confirmation = {
                betId: betData.id || `freebet-${Date.now()}`,
                txHash: 'free-bet',
                eventId: String(selectedBets[0].eventId),
                eventName: selectedBets[0].eventName,
                stake: stakeAmount,
                odds: selectedBets[0].odds,
                potentialWin: calculatePotentialWinnings(stakeAmount, selectedBets[0].odds),
                prediction: selectedBets[0].selectionName,
                placedAt: new Date().toISOString(),
                currency: 'SBETS',
                status: 'pending',
              };
              
              window.dispatchEvent(new CustomEvent('suibets:bet-confirmed', { detail: confirmation }));
              console.log('[BettingContext] FREE SBETS bet confirmed:', betData);
              return true;
            } else {
              const errorData = await response.json();
              toast({
                title: "Free Bet Failed",
                description: errorData.message || "Failed to place free bet",
                variant: "destructive",
              });
              return false;
            }
          } catch (freeBetError: any) {
            console.error('[BettingContext] FREE SBETS bet error:', freeBetError);
            toast({
              title: "Free Bet Failed",
              description: freeBetError.message || "Failed to place free bet",
              variant: "destructive",
            });
            return false;
          }
        }

        // Get fresh SBETS coin object if needed for SBETS bets
        // IMPORTANT: Always fetch fresh coins - object versions change after each transaction
        let sbetsCoinObjectId: string | undefined;
        if (betOptions.currency === 'SBETS') {
          console.log('[BettingContext] Fetching fresh SBETS coins for wallet:', activeWalletAddress);
          const sbetsCoins = await getSbetsCoins(activeWalletAddress!);
          console.log('[BettingContext] Found SBETS coins:', sbetsCoins.length, 'total balance:', sbetsCoins.reduce((a, c) => a + c.balance, 0));
          if (sbetsCoins.length === 0 || sbetsCoins[0].balance < stakeAmount) {
            toast({
              title: "Insufficient SBETS",
              description: "You don't have enough SBETS tokens for this bet",
              variant: "destructive",
            });
            return false;
          }
          sbetsCoinObjectId = sbetsCoins[0].objectId;
          console.log('[BettingContext] Using fresh SBETS coin:', sbetsCoinObjectId);
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
          walletAddress: activeWalletAddress!,
        });

        if (onChainResult.success) {
          try {
            console.log('[BettingContext] On-chain bet successful, recording in DB:', onChainResult.txDigest);
            const response = await apiRequest('POST', '/api/bets', {
              userId: activeWalletAddress,
              walletAddress: activeWalletAddress,
              eventId: String(selectedBets[0].eventId),
              eventName: selectedBets[0].eventName,
              homeTeam: selectedBets[0].homeTeam,
              awayTeam: selectedBets[0].awayTeam,
              marketId: String(selectedBets[0].marketId || 'match_winner'),
              outcomeId: String(selectedBets[0].outcomeId || selectedBets[0].selectionName || 'selection'),
              odds: selectedBets[0].odds,
              betAmount: stakeAmount,
              prediction: selectedBets[0].selectionName,
              potentialPayout: calculatePotentialWinnings(stakeAmount, selectedBets[0].odds),
              feeCurrency: betOptions.currency,
              txHash: onChainResult.txDigest,
              onChainBetId: onChainResult.betObjectId,
              paymentMethod: 'wallet',
              status: 'confirmed',
              useBonus: betOptions.useBonus || false,
              giftRecipientWallet: betOptions.giftRecipientWallet || undefined,
            });

            if (response.ok) {
              const betData = await response.json();
              
              // Emit confirmation event for UI
              const betConfirmedEvent = new CustomEvent('suibets:bet-confirmed', {
                detail: {
                  betId: betData.bet?.id || onChainResult.betObjectId || betData.id || `onchain_${onChainResult.txDigest?.slice(0, 10)}`,
                  eventName: selectedBets[0].eventName,
                  prediction: selectedBets[0].selectionName,
                  odds: selectedBets[0].odds,
                  stake: stakeAmount,
                  currency: betOptions.currency,
                  potentialWin: calculatePotentialWinnings(stakeAmount, selectedBets[0].odds),
                  txHash: onChainResult.txDigest,
                  status: 'confirmed',
                  placedAt: new Date().toISOString(),
                  walrusBlobId: betData.walrusBlobId || null,
                  walrusUrl: betData.walrusUrl || null,
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
              return true;
            } else {
              // Database failed but bet is on-chain - still show success to user
              console.error('[BettingContext] DB record failed for on-chain bet:', onChainResult.txDigest);
              
              const betConfirmedEvent = new CustomEvent('suibets:bet-confirmed', {
                detail: {
                  betId: onChainResult.betObjectId || `onchain_${onChainResult.txDigest?.slice(0, 10)}`,
                  eventName: selectedBets[0].eventName,
                  prediction: selectedBets[0].selectionName,
                  odds: selectedBets[0].odds,
                  stake: stakeAmount,
                  currency: betOptions.currency,
                  potentialWin: calculatePotentialWinnings(stakeAmount, selectedBets[0].odds),
                  txHash: onChainResult.txDigest,
                  status: 'confirmed',
                  placedAt: new Date().toISOString(),
                }
              });
              window.dispatchEvent(betConfirmedEvent);
              return true;
            }
          } catch (dbError: any) {
            console.error('[BettingContext] Error recording on-chain bet in DB:', dbError);
            // Fallback success for user since on-chain worked
            return true;
          }
        } else {
          return false;
        }
      }

      if (betOptions.betType === 'parlay' && selectedBets.length > 1) {
        const parlayEventIds = selectedBets.map(b => b.eventId);
        const uniqueParlayEventIds = new Set(parlayEventIds);
        if (uniqueParlayEventIds.size < parlayEventIds.length) {
          toast({
            title: "Invalid Parlay",
            description: "Cannot have multiple selections from the same match in a parlay",
            variant: "destructive",
          });
          return false;
        }
        
        const parlayOdds = calculateParlayOdds(selectedBets);
        const potentialPayout = calculatePotentialWinnings(betAmount, parlayOdds);

        if (!activeWalletAddress) {
          toast({
            title: "Wallet Required",
            description: "Connect your Sui wallet or sign in with Google to place parlay bets",
            variant: "destructive",
          });
          const connectWalletEvent = new CustomEvent('suibets:connect-wallet-required');
          window.dispatchEvent(connectWalletEvent);
          return false;
        }

        // Get fresh SBETS coin object if needed for SBETS parlay bets
        // IMPORTANT: Always fetch fresh coins - object versions change after each transaction
        let sbetsCoinObjectId: string | undefined;
        if (betOptions.currency === 'SBETS') {
          console.log('[BettingContext] Parlay: Fetching fresh SBETS coins');
          const sbetsCoins = await getSbetsCoins(activeWalletAddress!);
          console.log('[BettingContext] Parlay: Found SBETS coins:', sbetsCoins.length);
          if (sbetsCoins.length === 0 || sbetsCoins[0].balance < betAmount) {
            toast({
              title: "Insufficient SBETS",
              description: "You don't have enough SBETS tokens for this parlay",
              variant: "destructive",
            });
            return false;
          }
          sbetsCoinObjectId = sbetsCoins[0].objectId;
          console.log('[BettingContext] Parlay: Using fresh SBETS coin:', sbetsCoinObjectId);
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
          walletAddress: activeWalletAddress!,
        });

        if (onChainResult.success) {
          try {
            console.log('[BettingContext] On-chain parlay successful, recording in DB:', onChainResult.txDigest);
            const response = await apiRequest('POST', '/api/parlays', {
              userId: activeWalletAddress,
              walletAddress: activeWalletAddress,
              totalOdds: parlayOdds,
              betAmount: betAmount,
              potentialPayout: potentialPayout,
              feeCurrency: betOptions.currency,
              txHash: onChainResult.txDigest,
              onChainBetId: onChainResult.betObjectId,
              status: 'confirmed',
              legs: selectedBets.map(bet => ({
                eventId: bet.eventId,
                eventName: bet.eventName,
                homeTeam: bet.homeTeam,
                awayTeam: bet.awayTeam,
                marketId: bet.marketId,
                outcomeId: bet.outcomeId,
                odds: bet.odds,
                prediction: bet.selectionName,
              })),
            });

            const parlayConfirmation = {
              betId: onChainResult.betObjectId || `parlay_${onChainResult.txDigest?.slice(0, 10)}`,
              eventName: `Parlay (${selectedBets.length} legs)`,
              prediction: selectedBets.map(b => b.selectionName).join(' | '),
              odds: parlayOdds,
              stake: betAmount,
              currency: betOptions.currency,
              potentialWin: potentialPayout,
              txHash: onChainResult.txDigest,
              status: 'confirmed',
              placedAt: new Date().toISOString(),
              isParlay: true,
              legs: selectedBets.map(b => ({
                eventName: b.eventName,
                prediction: b.selectionName,
                odds: b.odds,
              })),
            };

            if (response.ok) {
              const betData = await response.json();
              parlayConfirmation.betId = betData.bet?.id || betData.id || parlayConfirmation.betId;

              window.dispatchEvent(new CustomEvent('suibets:bet-confirmed', { detail: parlayConfirmation }));

              const txLink = `https://suiscan.xyz/mainnet/tx/${onChainResult.txDigest}`;
              toast({
                title: "Parlay Placed On-Chain!",
                description: (
                  <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">
                    View TX: {onChainResult.txDigest?.slice(0, 12)}...
                  </a>
                ),
              });
              clearBets();
              return true;
            } else {
              console.error('[BettingContext] DB record failed for on-chain parlay:', onChainResult.txDigest);

              window.dispatchEvent(new CustomEvent('suibets:bet-confirmed', { detail: parlayConfirmation }));

              const txLink = `https://suiscan.xyz/mainnet/tx/${onChainResult.txDigest}`;
              toast({
                title: "Parlay On-Chain!",
                description: (
                  <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">
                    View TX: {onChainResult.txDigest?.slice(0, 12)}...
                  </a>
                ),
              });
              clearBets();
              return true;
            }
          } catch (err) {
            console.error('[BettingContext] Error recording parlay in DB:', err);
            clearBets();
            return true;
          }
        } else {
          return false;
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