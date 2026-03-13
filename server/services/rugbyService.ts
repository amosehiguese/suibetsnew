import axios from 'axios';
import { SportEvent, OddsData, MarketData, OutcomeData } from '../types/betting';
import { ApiSportsService } from './apiSportsService';

/**
 * Service for handling Rugby-specific data
 * Supports both Rugby League and Rugby Union
 */
export class RugbyService {
  private apiKey: string;
  private apiSportsService: ApiSportsService;
  private liveGamesCache: { [key: string]: SportEvent[] } = {};
  private lastFetchTime: { [key: string]: number } = {};
  // Cache TTL in milliseconds (30 seconds)
  private CACHE_TTL = 30 * 1000;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.SPORTSDATA_API_KEY || process.env.API_SPORTS_KEY || '3ec255b133882788e32f6349eff77b21';
    this.apiSportsService = new ApiSportsService(this.apiKey);
    
    // Setup the autorefresh after all methods are defined
    this.refreshLiveGames();
    setInterval(() => this.refreshLiveGames(), 60 * 1000); // Every minute
  }
  
  /**
   * Update the API key 
   * @param apiKey New API key to use
   */
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    console.log('[RugbyService] API key updated');
    
    // Also update the internal apiSportsService reference
    if (this.apiSportsService && typeof this.apiSportsService.setApiKey === 'function') {
      this.apiSportsService.setApiKey(apiKey);
    }
  }
  
  /**
   * Refresh live games cache in the background
   */
  private async refreshLiveGames() {
    try {
      console.log(`[RugbyService] Running background refresh of live Rugby games`);
      
      // Refresh both types of rugby
      await Promise.all([
        this.fetchLiveGamesWithCache('league', true),
        this.fetchLiveGamesWithCache('union', true)
      ]);
      
      console.log(`[RugbyService] Background refresh complete`);
    } catch (error) {
      console.error(`[RugbyService] Error in background refresh:`, error);
    }
  }
  
  /**
   * Fetch live games with caching for performance
   * @param rugbyType 'league' or 'union' to specify rugby type
   * @param forceRefresh Whether to force refresh even if cache is still valid
   * @returns Array of live rugby events
   */
  async fetchLiveGamesWithCache(rugbyType: 'league' | 'union', forceRefresh: boolean = false): Promise<SportEvent[]> {
    const cacheKey = `rugby-${rugbyType}-live`;
    const now = Date.now();
    
    // Check if we have cached data that's still valid
    if (!forceRefresh && 
        this.liveGamesCache[cacheKey] && 
        this.lastFetchTime[cacheKey] && 
        now - this.lastFetchTime[cacheKey] < this.CACHE_TTL) {
      console.log(`[RugbyService] Using cached ${rugbyType} rugby live games data, age: ${(now - this.lastFetchTime[cacheKey]) / 1000}s`);
      return this.liveGamesCache[cacheKey];
    }
    
    // Otherwise fetch fresh data
    console.log(`[RugbyService] Fetching fresh ${rugbyType} rugby live games data`);
    try {
      // Try API Sports first and fall back to direct API if needed
      const events = await this.getLiveGames(rugbyType);
      
      // Update the cache
      this.liveGamesCache[cacheKey] = events;
      this.lastFetchTime[cacheKey] = now;
      
      console.log(`[RugbyService] Cached ${events.length} fresh ${rugbyType} rugby live games`);
      return events;
    } catch (error) {
      console.error(`[RugbyService] Error fetching fresh ${rugbyType} rugby live games:`, error);
      
      // If we have cached data, return it even if it's stale
      if (this.liveGamesCache[cacheKey]) {
        console.log(`[RugbyService] Returning stale cached data due to fetch error`);
        return this.liveGamesCache[cacheKey];
      }
      
      return [];
    }
  }

  /**
   * Get all live rugby games
   * @param rugbyType 'league' or 'union' to specify rugby type
   * @returns Array of live rugby events
   */
  async getLiveGames(rugbyType: 'league' | 'union' = 'union'): Promise<SportEvent[]> {
    console.log(`[RugbyService] Fetching live ${rugbyType} rugby games`);
    
    // Use the Rugby-specific API endpoint
    const slug = rugbyType === 'league' ? 'rugby-league' : 'rugby-union';
    
    try {
      // Get basic events from API Sports service
      const events = await this.apiSportsService.getLiveEvents(slug);
      console.log(`[RugbyService] Found ${events.length} live ${rugbyType} rugby games from API-Sports`);
      
      if (events.length > 0) {
        // Show sample of the data for debugging
        console.log(`[RugbyService] Sample ${rugbyType.toUpperCase()} event data:`, JSON.stringify(events[0]));
        
        // Filter out games that aren't actually rugby
        // Check for rugby-specific leagues or other identifiers
        const rugbyEvents = events.filter(event => {
          const isRugbyGame = this.isGenuineRugbyGame(event, rugbyType);
          
          if (!isRugbyGame) {
            console.log(`[RugbyService] REJECTING non-rugby match: ${event.homeTeam} vs ${event.awayTeam} (${event.leagueName})`);
          }
          
          return isRugbyGame;
        });
        
        if (rugbyEvents.length === 0) {
          console.log(`[RugbyService] Warning: None of the ${events.length} games appear to be genuine ${rugbyType} rugby data, trying direct API`);
        } else {
          return rugbyEvents;
        }
      }
      
      // If no events found via API Sports, try direct Rugby API call
      return await this.getDirectLiveRugbyGames(rugbyType);
      
    } catch (error) {
      console.error(`[RugbyService] Error fetching live ${rugbyType} rugby games:`, error);
      return [];
    }
  }
  
  /**
   * Get upcoming rugby games
   * @param rugbyType 'league' or 'union' to specify rugby type
   * @param limit Number of events to return
   * @returns Array of upcoming rugby events
   */
  async getUpcomingGames(rugbyType: 'league' | 'union' = 'union', limit: number = 10): Promise<SportEvent[]> {
    console.log(`[RugbyService] Fetching upcoming ${rugbyType} rugby games`);
    
    const slug = rugbyType === 'league' ? 'rugby-league' : 'rugby-union';
    
    try {
      // Get basic events from API Sports service
      const events = await this.apiSportsService.getUpcomingEvents(slug, limit);
      console.log(`[RugbyService] Found ${events.length} upcoming ${rugbyType} rugby games from API-Sports`);
      
      if (events.length > 0) {
        // Filter out games that aren't actually rugby
        const rugbyEvents = events.filter(event => this.isGenuineRugbyGame(event, rugbyType));
        
        if (rugbyEvents.length === 0) {
          console.log(`[RugbyService] Warning: None of the ${events.length} games appear to be genuine ${rugbyType} rugby data, trying direct API`);
        } else {
          return rugbyEvents;
        }
      }
      
      // If no events found via API Sports, try direct Rugby API call
      return await this.getDirectUpcomingRugbyGames(rugbyType, limit);
      
    } catch (error) {
      console.error(`[RugbyService] Error fetching upcoming ${rugbyType} rugby games:`, error);
      return [];
    }
  }
  
  /**
   * Make a direct call to the Rugby API for live games
   * @param rugbyType 'league' or 'union' to specify rugby type
   * @returns Array of live rugby events
   */
  private async getDirectLiveRugbyGames(rugbyType: 'league' | 'union'): Promise<SportEvent[]> {
    console.log(`[RugbyService] Using direct ${rugbyType} rugby API for live games`);
    
    const endpoint = rugbyType === 'league' 
      ? 'https://v1.rugby-league.api-sports.io/games'
      : 'https://v1.rugby.api-sports.io/games';
    
    try {
      // First try with the current season and specific league
      const params = {
        season: new Date().getFullYear(),
        status: 'LIVE', // Rugby API uses uppercase status
      };
      
      console.log(`[RugbyService] Making direct API call with params:`, params);
      
      const response = await axios.get(endpoint, {
        params,
        headers: {
          'x-apisports-key': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      if (response.data && response.data.response && Array.isArray(response.data.response)) {
        const games = response.data.response;
        console.log(`[RugbyService] Direct API returned ${games.length} games`);
        
        if (games.length > 0) {
          // Transform to our standard format
          return this.transformRugbyGames(games, rugbyType, true);
        }
      }
      
      console.log(`[RugbyService] No live games found from direct API call`);
      return [];
    } catch (error) {
      console.error(`[RugbyService] Error calling direct ${rugbyType} rugby API:`, error);
      return [];
    }
  }
  
  /**
   * Make a direct call to the Rugby API for upcoming games
   * @param rugbyType 'league' or 'union' to specify rugby type
   * @param limit Number of events to return
   * @returns Array of upcoming rugby events
   */
  private async getDirectUpcomingRugbyGames(rugbyType: 'league' | 'union', limit: number): Promise<SportEvent[]> {
    console.log(`[RugbyService] Using direct ${rugbyType} rugby API for upcoming games`);
    
    const endpoint = rugbyType === 'league' 
      ? 'https://v1.rugby-league.api-sports.io/games'
      : 'https://v1.rugby.api-sports.io/games';
    
    try {
      // Get the current date and format it
      const today = new Date().toISOString().split('T')[0];
      
      // First try with the current season and specific parameters
      const params = {
        season: new Date().getFullYear(),
        date: today,
        status: 'NS', // Not Started
      };
      
      console.log(`[RugbyService] Making direct API call with params:`, params);
      
      const response = await axios.get(endpoint, {
        params,
        headers: {
          'x-apisports-key': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      if (response.data && response.data.response && Array.isArray(response.data.response)) {
        const games = response.data.response;
        console.log(`[RugbyService] Direct API returned ${games.length} games`);
        
        if (games.length > 0) {
          // Transform to our standard format and limit the number
          return this.transformRugbyGames(games, rugbyType, false).slice(0, limit);
        }
      }
      
      // If no games found, try with a date range
      console.log(`[RugbyService] No upcoming games found with direct date params, trying date range`);
      
      // Try with extended date range
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30); // Look 30 days ahead
      const futureDateStr = futureDate.toISOString().split('T')[0];
      
      console.log(`[RugbyService] Using date range from ${today} to ${futureDateStr}`);
      
      // Use season parameter without date to get more results
      const rangeResponse = await axios.get(endpoint, {
        params: {
          season: new Date().getFullYear(),
          status: 'NS',
        },
        headers: {
          'x-apisports-key': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      if (rangeResponse.data && rangeResponse.data.response && Array.isArray(rangeResponse.data.response)) {
        const rangeGames = rangeResponse.data.response;
        console.log(`[RugbyService] Date range approach returned ${rangeGames.length} games`);
        
        if (rangeGames.length > 0) {
          // Transform to our standard format and limit the number
          return this.transformRugbyGames(rangeGames, rugbyType, false).slice(0, limit);
        }
      }
      
      console.log(`[RugbyService] No upcoming games found from any API source, returning empty array`);
      return [];
    } catch (error) {
      console.error(`[RugbyService] Error calling direct ${rugbyType} rugby API:`, error);
      return [];
    }
  }
  
  /**
   * Transform rugby API data to our standard format
   * @param games Raw rugby game data from the API
   * @param rugbyType 'league' or 'union' to specify rugby type
   * @param isLive Whether these are live games
   * @returns Transformed SportEvent array
   */
  private transformRugbyGames(games: any[], rugbyType: 'league' | 'union', isLive: boolean): SportEvent[] {
    return games.map((game, index) => {
      // Create a unique ID for the event
      const id = game.id || `rugby-${rugbyType}-${index}-${Date.now()}`;
      
      // Map league info
      const league = game.league || {};
      const leagueName = league.name || `${rugbyType.charAt(0).toUpperCase() + rugbyType.slice(1)} Rugby`;
      
      // Map team info
      const homeTeam = game.teams?.home?.name || 'Home Team';
      const awayTeam = game.teams?.away?.name || 'Away Team';
      
      // Map score info
      let score = '0 - 0';
      
      // Handle different score formats from the Rugby API
      if (game.scores) {
        // Primary format: scores object with home/away properties
        const homeScore = game.scores.home || game.scores.home_score || 0;
        const awayScore = game.scores.away || game.scores.away_score || 0;
        score = `${homeScore} - ${awayScore}`;
      } else if (game.score) {
        // Alternative format: score object or direct score string
        if (typeof game.score === 'string') {
          score = game.score;
        } else if (typeof game.score === 'object') {
          const homeScore = game.score.home || game.score.home_score || 0;
          const awayScore = game.score.away || game.score.away_score || 0;
          score = `${homeScore} - ${awayScore}`;
        }
      } else if (game.home_score !== undefined && game.away_score !== undefined) {
        // Direct properties on the game object
        score = `${game.home_score} - ${game.away_score}`;
      }
      
      // Add detailed logging for troubleshooting
      console.log(`[RugbyService] Parsed score for ${homeTeam} vs ${awayTeam}: ${score}`);
      if (isLive) {
        console.log(`[RugbyService] Live game score structure:`, JSON.stringify({
          hasScores: !!game.scores,
          hasScore: !!game.score,
          hasHomeAwayScore: game.home_score !== undefined && game.away_score !== undefined,
          finalScore: score
        }));
      }
      
      // Map start time
      let startTime = new Date().toISOString();
      if (game.date) {
        startTime = new Date(game.date).toISOString();
      }
      
      // Map status
      const status = isLive ? 'live' : 'scheduled';
      
      // Create default market
      const market = {
        id: `${id}-market-match-winner`,
        name: 'Match Result',
        outcomes: [
          {
            id: `${id}-outcome-home`,
            name: `${homeTeam}`,
            odds: 1.95,
            probability: 0.51
          },
          {
            id: `${id}-outcome-away`,
            name: `${awayTeam}`,
            odds: 1.85,
            probability: 0.54
          }
        ]
      };
      
      // Create the standard sport event
      return {
        id,
        sportId: 15, // Rugby DB ID is 15 for both league and union
        leagueName,
        homeTeam,
        awayTeam,
        startTime,
        status,
        score,
        markets: [market],
        isLive,
        dataSource: `api-sports-rugby-${rugbyType}`
      };
    });
  }
  
  /**
   * Check if an event is genuinely a rugby game
   * @param event The event to check
   * @param rugbyType 'league' or 'union' to specify rugby type
   * @returns Boolean indicating if this is a genuine rugby game
   */
  private isGenuineRugbyGame(event: SportEvent, rugbyType: 'league' | 'union'): boolean {
    // If we have explicit sport ID matching, trust that
    if (event.sportId === 15) return true;
    
    // Check for league name containing rugby keywords
    const leagueName = event.leagueName?.toLowerCase() || '';
    const rugbyKeywords = [
      'rugby', 'nrl', 'super league', 'premiership rugby', 'top 14', 
      'pro14', 'super rugby', 'six nations', 'world cup rugby',
      'challenge cup', 'champions cup'
    ];
    
    // Type-specific keywords
    const leagueKeywords = ['nrl', 'super league', 'challenge cup'];
    const unionKeywords = ['premiership rugby', 'top 14', 'pro14', 'super rugby', 'six nations'];
    
    // Check for any rugby keyword
    const isRugby = rugbyKeywords.some(keyword => leagueName.includes(keyword));
    
    // Check for type-specific keywords
    const isCorrectType = rugbyType === 'league' 
      ? leagueKeywords.some(keyword => leagueName.includes(keyword))
      : unionKeywords.some(keyword => leagueName.includes(keyword));
    
    // If we find a type-specific keyword, return true
    if (isCorrectType) return true;
    
    // If we find any rugby keyword, it's better than nothing
    return isRugby;
  }
}

export const rugbyService = new RugbyService(process.env.SPORTSDATA_API_KEY);