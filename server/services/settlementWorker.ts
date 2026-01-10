import { storage } from '../storage';
import balanceService from './balanceService';
import { blockchainBetService } from './blockchainBetService';
import { db } from '../db';
import { settledEvents } from '../../shared/schema';
import { eq, sql } from 'drizzle-orm';

interface FinishedMatch {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: 'home' | 'away' | 'draw';
  status: string;
}

interface UnsettledBet {
  id: string;
  eventId: string;
  externalEventId: string;
  homeTeam: string;
  awayTeam: string;
  prediction: string;
  odds: number;
  stake: number;
  potentialWin: number;
  userId: string;
  currency: string;
  betObjectId?: string; // On-chain Sui bet object ID (for SUI bets placed via contract)
}

const REVENUE_WALLET = 'platform_revenue';

class SettlementWorkerService {
  private _isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private settledEventIdsCache = new Set<string>(); // In-memory cache, synced from DB
  private checkInterval = 5 * 60 * 1000; // 5 minutes (AGGRESSIVE API SAVING - was 2min)
  private finishedMatchesCache: { data: FinishedMatch[]; timestamp: number } | null = null;
  private finishedMatchesCacheTTL = 3 * 60 * 1000; // Cache finished matches for 3 minutes

  async start() {
    if (this._isRunning) {
      console.log('⚙️ SettlementWorker already running');
      return;
    }

    // Load settled events from database on startup (survives restarts)
    await this.loadSettledEventsFromDB();

    this._isRunning = true;
    console.log('🚀 SettlementWorker started - checking for finished matches every 5 minutes (API SAVING MODE)');

    this.intervalId = setInterval(async () => {
      try {
        await this.checkAndSettleBets();
      } catch (error) {
        console.error('❌ SettlementWorker error:', error);
      }
    }, this.checkInterval);

    this.checkAndSettleBets();
  }

  private async loadSettledEventsFromDB() {
    try {
      const settledFromDB = await db.select().from(settledEvents);
      for (const event of settledFromDB) {
        this.settledEventIdsCache.add(event.externalEventId);
      }
      console.log(`📋 Loaded ${settledFromDB.length} settled events from database`);
    } catch (error) {
      console.error('Failed to load settled events from DB:', error);
    }
  }

  private async markEventAsSettled(match: FinishedMatch, betsSettledCount: number) {
    try {
      // Check if already exists in DB
      const existing = await db.select().from(settledEvents).where(eq(settledEvents.externalEventId, match.eventId));
      if (existing.length === 0) {
        // Insert new settled event
        await db.insert(settledEvents).values({
          externalEventId: match.eventId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          winner: match.winner,
          betsSettled: betsSettledCount
        });
        console.log(`📝 Persisted settled event: ${match.eventId} (${betsSettledCount} bets settled)`);
      } else {
        // Update betsSettled count for existing event (upsert pattern)
        const newTotal = (existing[0].betsSettled || 0) + betsSettledCount;
        await db.update(settledEvents)
          .set({ betsSettled: newTotal })
          .where(eq(settledEvents.externalEventId, match.eventId));
        console.log(`📝 Updated settled event: ${match.eventId} (total ${newTotal} bets settled)`);
      }
      this.settledEventIdsCache.add(match.eventId);
    } catch (error) {
      console.error(`Failed to persist settled event ${match.eventId}:`, error);
    }
  }

  private isEventSettled(eventId: string): boolean {
    return this.settledEventIdsCache.has(eventId);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isRunning = false;
    console.log('⏹️ SettlementWorker stopped');
  }

  public async checkAndSettleBets() {
    console.log('🔍 SettlementWorker: Checking for finished matches...');

    try {
      // Check for unsettled bets FIRST to avoid unnecessary API calls
      const unsettledBets = await this.getUnsettledBets();
      
      if (unsettledBets.length === 0) {
        console.log('📭 SettlementWorker: No unsettled bets - skipping API fetch');
        return;
      }

      // Only fetch finished matches if we have bets to settle
      const finishedMatches = await this.getFinishedMatches();
      
      if (finishedMatches.length === 0) {
        console.log('📭 SettlementWorker: No new finished matches to settle');
        return;
      }

      console.log(`📋 SettlementWorker: Found ${finishedMatches.length} finished matches`);
      console.log(`🎯 SettlementWorker: Processing ${unsettledBets.length} unsettled bets`);
      
      // Debug: Log unsettled bet details for matching
      for (const bet of unsettledBets) {
        console.log(`📊 Unsettled bet: externalEventId=${bet.externalEventId}, eventId=${bet.eventId}, prediction=${bet.prediction}, homeTeam=${bet.homeTeam}, awayTeam=${bet.awayTeam}`);
        
        // Check if this bet's event is in the finished matches
        const betExtId = String(bet.externalEventId || '').trim();
        const matchingFinished = finishedMatches.find(m => String(m.eventId || '').trim() === betExtId);
        if (matchingFinished) {
          console.log(`🎯 Found finished match for bet: ${matchingFinished.homeTeam} vs ${matchingFinished.awayTeam} (${matchingFinished.homeScore}-${matchingFinished.awayScore})`);
        } else {
          console.log(`⏳ Match ${betExtId} not yet finished or not in today's results`);
        }
      }

      for (const match of finishedMatches) {
        // IMPROVED MATCHING: Use multiple strategies to find bets for this match
        const betsForMatch = unsettledBets.filter(bet => {
          // Strategy 1: Exact external event ID match (most reliable) - compare as strings
          const betExtId = String(bet.externalEventId || '').trim();
          const matchId = String(match.eventId || '').trim();
          if (betExtId && matchId && betExtId === matchId) {
            console.log(`✅ MATCH FOUND: bet externalEventId=${betExtId} matches finished match ${matchId}`);
            return true;
          }
          
          // Strategy 2: Match by stored team names (reliable for newer bets)
          if (bet.homeTeam && bet.awayTeam) {
            const betHome = bet.homeTeam.toLowerCase();
            const betAway = bet.awayTeam.toLowerCase();
            const matchHome = match.homeTeam.toLowerCase();
            const matchAway = match.awayTeam.toLowerCase();
            if ((betHome === matchHome || matchHome.includes(betHome) || betHome.includes(matchHome)) &&
                (betAway === matchAway || matchAway.includes(betAway) || betAway.includes(matchAway))) {
              return true;
            }
          }
          
          // Strategy 3: Match by prediction containing team name (fallback for older bets)
          // IMPROVED: Check BOTH directions AND normalize team names
          const prediction = bet.prediction?.toLowerCase() || '';
          const matchHome = match.homeTeam.toLowerCase();
          const matchAway = match.awayTeam.toLowerCase();
          
          // Helper to normalize team names - strip common prefixes/suffixes
          const normalizeTeam = (name: string) => {
            return name
              .replace(/^(sl|fc|cf|sc|as|ac|afc|rcd|cd|ud|sd|ca|rc|real|sporting|atletico)\s+/i, '')
              .replace(/\s+(fc|sc|cf|afc|united|city|rovers|athletic|wanderers)$/i, '')
              .trim();
          };
          
          const normPrediction = normalizeTeam(prediction);
          const normMatchHome = normalizeTeam(matchHome);
          const normMatchAway = normalizeTeam(matchAway);
          
          // Check both directions: prediction contains team OR team contains prediction
          if (prediction.includes(matchHome) || prediction.includes(matchAway) ||
              matchHome.includes(prediction) || matchAway.includes(prediction) ||
              normPrediction.includes(normMatchHome) || normPrediction.includes(normMatchAway) ||
              normMatchHome.includes(normPrediction) || normMatchAway.includes(normPrediction)) {
            console.log(`✅ MATCH FOUND via prediction: "${prediction}" matches "${matchHome}" or "${matchAway}"`);
            return true;
          }
          
          // Strategy 4: Legacy eventId match
          if (bet.eventId && bet.eventId === match.eventId) {
            return true;
          }
          
          return false;
        });

        if (betsForMatch.length > 0) {
          console.log(`⚽ Settling ${betsForMatch.length} bets for ${match.homeTeam} vs ${match.awayTeam} (${match.homeScore}-${match.awayScore})`);
          await this.settleBetsForMatch(match, betsForMatch);
        }
      }
    } catch (error) {
      console.error('❌ SettlementWorker checkAndSettleBets error:', error);
    }
  }

  private async getFinishedMatches(): Promise<FinishedMatch[]> {
    // AGGRESSIVE API SAVING: Use cache if fresh
    if (this.finishedMatchesCache && 
        (Date.now() - this.finishedMatchesCache.timestamp) < this.finishedMatchesCacheTTL) {
      console.log('📦 SettlementWorker: Using cached finished matches');
      return this.finishedMatchesCache.data;
    }
    
    const finishedMatches: FinishedMatch[] = [];
    
    try {
      // AGGRESSIVE API SAVING: Only check football (99% of bets)
      // Other sports rarely have bets and waste API calls
      const sportsToCheck = ['football'];
      
      for (const sport of sportsToCheck) {
        try {
          const response = await this.fetchFinishedForSport(sport);
          finishedMatches.push(...response);
        } catch (error) {
          // Silently skip failed sports
        }
      }

      // Cache the results
      this.finishedMatchesCache = {
        data: finishedMatches,
        timestamp: Date.now()
      };

      // NOTE: Don't filter out matches based on settledEventIdsCache here!
      // Multiple bets can exist on the same match. The settlement logic
      // will naturally skip matches with no pending bets.
      return finishedMatches;
    } catch (error) {
      console.error('Error fetching finished matches:', error);
      return [];
    }
  }

  private async fetchFinishedForSport(sport: string): Promise<FinishedMatch[]> {
    const finished: FinishedMatch[] = [];

    const apiKey = process.env.API_SPORTS_KEY || process.env.SPORTSDATA_API_KEY || process.env.APISPORTS_KEY || '';
    if (!apiKey) return [];

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const datesToCheck = [todayStr, yesterdayStr];
    
    const sportEndpoints: Record<string, string> = {
      football: 'https://v3.football.api-sports.io/fixtures',
      basketball: 'https://v1.basketball.api-sports.io/games',
      baseball: 'https://v1.baseball.api-sports.io/games',
      hockey: 'https://v1.hockey.api-sports.io/games'
    };

    const url = sportEndpoints[sport];
    if (!url) return finished;

    for (const dateStr of datesToCheck) {
      try {
        const axios = await import('axios');
        const params = sport === 'football' 
          ? { date: dateStr, status: 'FT-AET-PEN' }
          : { date: dateStr, status: 'FT' };
          
        const response = await axios.default.get(url, {
          params,
          headers: {
            'x-apisports-key': apiKey,
            'Accept': 'application/json'
          },
          timeout: 10000
        });

        if (response.data?.response && Array.isArray(response.data.response)) {
          for (const match of response.data.response) {
            const eventId = match.fixture?.id?.toString() || match.id?.toString();
            const homeTeam = match.teams?.home?.name || '';
            const awayTeam = match.teams?.away?.name || '';
            
            let homeScore = 0;
            let awayScore = 0;
            
            if (sport === 'football') {
              homeScore = match.goals?.home || 0;
              awayScore = match.goals?.away || 0;
            } else if (sport === 'basketball') {
              homeScore = match.scores?.home?.total || 0;
              awayScore = match.scores?.away?.total || 0;
            } else {
              homeScore = match.scores?.home || 0;
              awayScore = match.scores?.away || 0;
            }

            const winner: 'home' | 'away' | 'draw' = 
              homeScore > awayScore ? 'home' : 
              awayScore > homeScore ? 'away' : 'draw';

            finished.push({
              eventId,
              homeTeam,
              awayTeam,
              homeScore,
              awayScore,
              winner,
              status: 'finished'
            });
          }
        }
      } catch (error) {
        // Silently handle API errors for this date
      }
    }

    return finished;
  }

  private settledBetIds = new Set<string>(); // Track settled bet IDs to prevent duplicates

  private async getUnsettledBets(): Promise<UnsettledBet[]> {
    try {
      // Get ALL unsettled bets from all users - include both 'pending' and 'confirmed' status
      // 'confirmed' = on-chain bets that were placed but not yet settled
      const pendingBets = await storage.getAllBets('pending');
      const confirmedBets = await storage.getAllBets('confirmed');
      const allBets = [...pendingBets, ...confirmedBets];
      return allBets
        .filter(bet => !this.settledBetIds.has(bet.id))
        .map(bet => ({
          id: bet.id,
          eventId: bet.eventId || '',
          externalEventId: bet.externalEventId || String(bet.eventId || ''),
          homeTeam: bet.homeTeam || '',
          awayTeam: bet.awayTeam || '',
          prediction: bet.selection || bet.prediction || '',
          odds: bet.odds,
          stake: bet.stake || bet.betAmount,
          potentialWin: bet.potentialWin || bet.potentialPayout,
          userId: bet.walletAddress || bet.userId || 'unknown',
          currency: bet.currency || 'SUI',
          betObjectId: bet.betObjectId || undefined // On-chain bet object ID for SUI bets
        }));
    } catch (error) {
      console.error('Error getting unsettled bets:', error);
      return [];
    }
  }

  private async settleBetsForMatch(match: FinishedMatch, bets: UnsettledBet[]) {
    for (const bet of bets) {
      // DUPLICATE SETTLEMENT PREVENTION: Skip if already settled this session
      if (this.settledBetIds.has(bet.id)) {
        console.log(`⚠️ SKIPPING: Bet ${bet.id} already processed this session`);
        continue;
      }
      
      try {
        const isWinner = this.determineBetOutcome(bet, match);
        const status = isWinner ? 'won' : 'lost';
        const grossPayout = isWinner ? bet.potentialWin : 0;
        // FEE CALCULATION: 1% of PROFIT only (matching smart contract logic)
        // Profit = grossPayout - stake = net winnings beyond original bet
        const profit = isWinner ? (grossPayout - bet.stake) : 0;
        const platformFee = profit > 0 ? profit * 0.01 : 0; // 1% of profit, NOT gross
        const netPayout = grossPayout - platformFee;

        // DUAL SETTLEMENT: On-chain for SUI/SBETS with betObjectId, off-chain fallback
        const hasOnChainBet = bet.betObjectId && blockchainBetService.isAdminKeyConfigured();
        const isSuiOnChainBet = bet.currency === 'SUI' && hasOnChainBet;
        const isSbetsOnChainBet = bet.currency === 'SBETS' && hasOnChainBet;
        
        // CRITICAL WARNING: Flag bets without betObjectId that will use off-chain fallback
        if (!bet.betObjectId) {
          console.warn(`⚠️ MISSING betObjectId: Bet ${bet.id} (${bet.currency}) has no on-chain object ID - will use OFF-CHAIN fallback`);
          console.warn(`   This bet was likely placed before the betObjectId extraction fix or transaction failed to capture it`);
        }
        if (!blockchainBetService.isAdminKeyConfigured()) {
          console.warn(`⚠️ ADMIN_PRIVATE_KEY not configured - all settlements will use OFF-CHAIN fallback`);
        }

        if (isSuiOnChainBet) {
          // ============ ON-CHAIN SETTLEMENT (SUI via smart contract) ============
          // Contract handles payout directly - winner gets SUI from contract treasury
          // Lost bets stay in contract treasury as accrued fees
          console.log(`🔗 ON-CHAIN SUI SETTLEMENT: Bet ${bet.id} via smart contract`);
          
          // Small delay between on-chain transactions to prevent object version conflicts
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const settlementResult = await blockchainBetService.executeSettleBetOnChain(
            bet.betObjectId!,
            isWinner
          );

          if (settlementResult.success) {
            // Update database status to reflect on-chain settlement
            // Use 'paid_out' for winners since payout was sent, 'lost' for losers
            const finalStatus = isWinner ? 'paid_out' : 'lost';
            const statusUpdated = await storage.updateBetStatus(bet.id, finalStatus, grossPayout);
            if (statusUpdated) {
              console.log(`✅ ON-CHAIN SUI SETTLED: ${bet.id} ${finalStatus} | TX: ${settlementResult.txHash}`);
              this.settledBetIds.add(bet.id);
            }
          } else {
            console.error(`❌ ON-CHAIN SUI SETTLEMENT FAILED: ${bet.id} - ${settlementResult.error}`);
            // Don't mark as settled - will retry next cycle
            continue;
          }
        } else if (isSbetsOnChainBet) {
          // ============ ON-CHAIN SETTLEMENT (SBETS via smart contract) ============
          // Contract handles payout directly - winner gets SBETS from contract treasury
          console.log(`🔗 ON-CHAIN SBETS SETTLEMENT: Bet ${bet.id} via smart contract`);
          
          // Small delay between on-chain transactions to prevent object version conflicts
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const settlementResult = await blockchainBetService.executeSettleBetSbetsOnChain(
            bet.betObjectId!,
            isWinner
          );

          if (settlementResult.success) {
            // Use 'paid_out' for winners since payout was sent, 'lost' for losers
            const finalStatus = isWinner ? 'paid_out' : 'lost';
            const statusUpdated = await storage.updateBetStatus(bet.id, finalStatus, grossPayout);
            if (statusUpdated) {
              console.log(`✅ ON-CHAIN SBETS SETTLED: ${bet.id} ${finalStatus} | TX: ${settlementResult.txHash}`);
              this.settledBetIds.add(bet.id);
            }
          } else {
            console.error(`❌ ON-CHAIN SBETS SETTLEMENT FAILED: ${bet.id} - ${settlementResult.error}`);
            continue;
          }
        } else {
          // ============ OFF-CHAIN SETTLEMENT (SBETS or SUI fallback) ============
          // Uses internal balance tracking - funds managed via hybrid custodial model
          console.log(`📊 OFF-CHAIN SETTLEMENT: Bet ${bet.id} (${bet.currency}) via database`);

          // DOUBLE PAYOUT PREVENTION: Only process winnings if status update succeeded
          // Use 'paid_out' for winners after successful payout, 'lost' for losers
          const initialStatus = isWinner ? 'won' : 'lost'; // Start as 'won', upgrade to 'paid_out' after payout
          const statusUpdated = await storage.updateBetStatus(bet.id, initialStatus, grossPayout);

          if (statusUpdated) {
            if (isWinner && netPayout > 0) {
              const winningsAdded = await balanceService.addWinnings(bet.userId, netPayout, bet.currency as 'SUI' | 'SBETS');
              if (!winningsAdded) {
                // CRITICAL: Revert bet status if balance credit failed - allows retry next cycle
                await storage.updateBetStatus(bet.id, 'pending');
                console.error(`❌ SETTLEMENT REVERTED: Failed to credit winnings for bet ${bet.id} - will retry`);
                continue; // Don't mark as settled, allow retry
              }
              // CRITICAL: Record 1% platform fee as revenue
              await balanceService.addRevenue(platformFee, bet.currency as 'SUI' | 'SBETS');
              // Now upgrade status to 'paid_out' since payout succeeded
              await storage.updateBetStatus(bet.id, 'paid_out', grossPayout);
              console.log(`💰 WINNER (DB): ${bet.userId} won ${netPayout} ${bet.currency} (fee: ${platformFee} ${bet.currency} -> revenue) - PAID OUT`);
            } else {
              // Lost bet - add full stake to platform revenue
              await balanceService.addRevenue(bet.stake, bet.currency as 'SUI' | 'SBETS');
              console.log(`📉 LOST (DB): ${bet.userId} lost ${bet.stake} ${bet.currency} - added to platform revenue`);
            }
            console.log(`✅ Settled bet ${bet.id}: ${isWinner ? 'paid_out' : 'lost'} (${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam})`);
            
            // ONLY mark as settled after successful payout processing
            this.settledBetIds.add(bet.id);
          } else {
            // Bet was already settled (by concurrent process) - mark to skip future attempts
            console.log(`⚠️ DUPLICATE SETTLEMENT PREVENTED: Bet ${bet.id} already settled - no payout applied`);
            this.settledBetIds.add(bet.id);
          }
        }
      } catch (error) {
        console.error(`❌ Error settling bet ${bet.id}:`, error);
        // Don't mark as settled on error - allow retry next cycle
      }
    }

    // Persist event as settled in database (survives restarts)
    await this.markEventAsSettled(match, bets.length);
  }

  private determineBetOutcome(bet: UnsettledBet, match: FinishedMatch): boolean {
    const prediction = bet.prediction.toLowerCase().trim();
    const homeTeam = match.homeTeam.toLowerCase();
    const awayTeam = match.awayTeam.toLowerCase();

    // Check for Correct Score prediction (e.g., "1-0", "2-1", "0-0")
    const correctScoreMatch = prediction.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (correctScoreMatch) {
      const predictedHome = parseInt(correctScoreMatch[1], 10);
      const predictedAway = parseInt(correctScoreMatch[2], 10);
      return match.homeScore === predictedHome && match.awayScore === predictedAway;
    }

    // Check for "Other" correct score prediction (any score not in standard options)
    if (prediction === 'other') {
      const commonScores = ['0-0', '1-0', '0-1', '1-1', '2-0', '0-2', '2-1', '1-2', '2-2', '3-0', '0-3', '3-1', '1-3', '3-2', '2-3'];
      const actualScore = `${match.homeScore}-${match.awayScore}`;
      return !commonScores.includes(actualScore);
    }

    // Match Winner predictions
    if (prediction.includes(homeTeam) || prediction === 'home' || prediction === '1') {
      return match.winner === 'home';
    }
    
    if (prediction.includes(awayTeam) || prediction === 'away' || prediction === '2') {
      return match.winner === 'away';
    }
    
    if (prediction === 'draw' || prediction === 'x' || prediction === 'tie') {
      return match.winner === 'draw';
    }

    // Over/Under predictions (for other sports like basketball, tennis)
    if (prediction.includes('over')) {
      const totalGoals = match.homeScore + match.awayScore;
      const threshold = parseFloat(prediction.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals > threshold;
    }
    
    if (prediction.includes('under')) {
      const totalGoals = match.homeScore + match.awayScore;
      const threshold = parseFloat(prediction.replace(/[^0-9.]/g, '')) || 2.5;
      return totalGoals < threshold;
    }

    return false;
  }

  async manualSettle(betId: string, outcome: 'won' | 'lost' | 'void') {
    try {
      const bet = await storage.getBet(betId);
      if (!bet) throw new Error('Bet not found');

      const payout = outcome === 'won' ? bet.potentialPayout : 
                     outcome === 'void' ? bet.betAmount : 0;

      // DOUBLE PAYOUT PREVENTION: Only process winnings if status update succeeded
      const statusUpdated = await storage.updateBetStatus(betId, outcome, payout);

      if (!statusUpdated) {
        console.log(`⚠️ DUPLICATE SETTLEMENT PREVENTED: Bet ${betId} already settled - no payout applied`);
        return { success: false, betId, outcome, payout, message: 'Bet already settled' };
      }

      if (outcome === 'won' && payout > 0) {
        await balanceService.addWinnings(bet.userId || 'user1', payout, (bet.feeCurrency || 'SUI') as 'SUI' | 'SBETS');
        console.log(`💰 MANUAL SETTLE (DB): ${bet.userId} won ${payout} ${bet.feeCurrency}`);
      } else if (outcome === 'void') {
        await balanceService.addWinnings(bet.userId || 'user1', payout, (bet.feeCurrency || 'SUI') as 'SUI' | 'SBETS');
        console.log(`🔄 VOIDED (DB): Refunded ${payout} to ${bet.userId}`);
      } else {
        await balanceService.addRevenue(bet.betAmount, (bet.feeCurrency || 'SUI') as 'SUI' | 'SBETS');
        console.log(`📉 MANUAL LOSS (DB): Added ${bet.betAmount} to platform revenue`);
      }

      return { success: true, betId, outcome, payout };
    } catch (error) {
      console.error('Manual settlement error:', error);
      throw error;
    }
  }

  async forceOnChainSettlement(betId: string, outcome: 'won' | 'lost' | 'void'): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const bet = await storage.getBet(betId);
      if (!bet) {
        return { success: false, error: 'Bet not found' };
      }

      const betObjectId = bet.betObjectId;
      if (!betObjectId) {
        return { success: false, error: 'Bet has no on-chain betObjectId - cannot execute on-chain settlement' };
      }

      if (!blockchainBetService.isAdminKeyConfigured()) {
        return { success: false, error: 'Admin private key not configured - cannot execute on-chain settlement' };
      }

      const isWinner = outcome === 'won';
      const isVoid = outcome === 'void';
      const currency = bet.feeCurrency || bet.currency || 'SUI';

      console.log(`🔧 FORCE ON-CHAIN SETTLEMENT: Bet ${betId} (${currency}) -> ${outcome}`);

      let result;
      if (isVoid) {
        if (currency === 'SBETS') {
          result = await blockchainBetService.executeVoidBetSbetsOnChain(betObjectId);
        } else {
          result = await blockchainBetService.executeVoidBetOnChain(betObjectId);
        }
      } else {
        if (currency === 'SBETS') {
          result = await blockchainBetService.executeSettleBetSbetsOnChain(betObjectId, isWinner);
        } else {
          result = await blockchainBetService.executeSettleBetOnChain(betObjectId, isWinner);
        }
      }

      if (result.success) {
        console.log(`✅ FORCE ON-CHAIN SETTLEMENT SUCCESS: Bet ${betId} -> ${outcome} | TX: ${result.txHash}`);
        return { success: true, txHash: result.txHash };
      } else {
        console.error(`❌ FORCE ON-CHAIN SETTLEMENT FAILED: Bet ${betId} - ${result.error}`);
        return { success: false, error: result.error };
      }
    } catch (error: any) {
      console.error('Force on-chain settlement error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  async getBetsNeedingOnChainSettlement(): Promise<any[]> {
    try {
      const allBets = await storage.getAllBets();
      return allBets.filter(bet => 
        bet.betObjectId && 
        (bet.status === 'won' || bet.status === 'lost' || bet.status === 'void') &&
        !bet.winningsWithdrawn
      );
    } catch (error) {
      console.error('Error getting bets needing on-chain settlement:', error);
      return [];
    }
  }

  getStatus() {
    return {
      isRunning: this._isRunning,
      settledEventsInMemory: this.settledEventIdsCache.size,
      settledBetsInMemory: this.settledBetIds.size,
      checkInterval: this.checkInterval / 1000
    };
  }

  // Helper methods for testing
  isRunningNow(): boolean {
    return this._isRunning;
  }

  getSettledEventsCount(): number {
    return this.settledEventIdsCache.size;
  }

  getSettledBetsCount(): number {
    return this.settledBetIds.size;
  }
}

export const settlementWorker = new SettlementWorkerService();
