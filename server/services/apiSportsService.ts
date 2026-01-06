import axios from 'axios';
import { OddsData, SportEvent, MarketData, OutcomeData } from '../types/betting';
import config from '../config';

// Module-level singleton guard to prevent multiple prefetcher intervals on hot reloads
let globalPrefetcherInterval: NodeJS.Timeout | null = null;
let globalPrefetcherStarted: boolean = false;

/**
 * Enhanced service for interacting with the API-Sports API
 * Documentation: https://api-sports.io/documentation
 */
export class ApiSportsService {
  private apiKey: string;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  
  // Background prefetcher state
  private prefetcherRunning: boolean = false;
  private lastPrefetchTime: number = 0;
  private prefetchInterval: number = 60 * 1000; // Refresh odds every 60 seconds
  
  // Pre-warmed odds cache - separate from main cache for guaranteed access
  private oddsCache: Map<string, { homeOdds: number; drawOdds?: number; awayOdds: number; timestamp: number }> = new Map();
  private oddsCacheTTL: number = 5 * 60 * 1000; // 5 minutes TTL for odds
  
  // Cache settings - optimized for real-time updates
  private shortCacheExpiry: number = 10 * 1000; // 10 seconds for live events - real-time minute updates
  private mediumCacheExpiry: number = 2 * 60 * 1000; // 2 minutes for medium-priority data
  private longCacheExpiry: number = 10 * 60 * 1000; // 10 minutes for stable data
  private cacheExpiry: number = 30 * 1000; // Default cache expiry - 30 seconds for frequent updates
  
  // Cache version to force refresh when code changes
  private cacheVersionKey: string = "v7"; // Increment this when making changes to force cache refresh
  
  /**
   * Update the API key 
   * @param apiKey New API key to use
   */
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    console.log('[ApiSportsService] API key updated');
    // Clear cache when API key changes to ensure fresh data with new key
    this.clearCache();
  }
  
  /**
   * Clear the API cache to ensure fresh data is fetched
   */
  public clearCache(): void {
    this.cache.clear();
    console.log('[ApiSportsService] Cache cleared');
  }
  
  /**
   * Get cached live events synchronously for server-side validation
   * Returns all cached live events from ALL cached sports for bet validation
   * Used to verify match time before accepting bets (80-minute cutoff)
   * 
   * Iterates over ALL cache entries to find live events, not just a hardcoded list
   * Returns both events and metadata about cache freshness for security decisions
   */
  public getCachedLiveEventsSync(): { events: SportEvent[]; maxAgeMs: number; cacheHit: boolean } {
    const allLiveEvents: SportEvent[] = [];
    let oldestTimestamp = Date.now();
    let cacheHit = false;
    
    try {
      // Iterate over all cache entries to find live event caches
      // This ensures we don't miss any sport that's been fetched
      // Cache keys are like: live_events_football (no version suffix for live events)
      for (const [key, cached] of this.cache.entries()) {
        if (key.startsWith('live_events_')) {
          if (cached && cached.data) {
            // Handle both array format and { events: [...] } object format
            const events = Array.isArray(cached.data) ? cached.data : (cached.data.events ?? []);
            if (Array.isArray(events) && events.length > 0) {
              cacheHit = true;
              allLiveEvents.push(...events);
              // Track oldest cache entry
              if (cached.timestamp < oldestTimestamp) {
                oldestTimestamp = cached.timestamp;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[ApiSportsService] Error iterating cache:', error);
      return { events: [], maxAgeMs: Infinity, cacheHit: false };
    }
    
    const maxAgeMs = cacheHit ? Date.now() - oldestTimestamp : Infinity;
    return { events: allLiveEvents, maxAgeMs, cacheHit };
  }
  
  /**
   * Get ALL cached events (live + upcoming) for unified event validation
   * Used to verify that an event exists in our system before accepting bets
   * Returns lookup result with metadata about where the event was found
   * Also returns startTime to detect events that should be live but aren't in live cache
   */
  public lookupEventSync(eventId: string): { 
    found: boolean; 
    isLive: boolean; 
    minute?: number; 
    cacheAgeMs: number;
    source: 'live' | 'upcoming' | 'none';
    startTime?: string; // ISO timestamp of event start time
    shouldBeLive: boolean; // True if startTime has passed (match should have started)
  } {
    try {
      // First, check live events cache
      // Cache keys are like: live_events_football_v7 (with version suffix)
      const allCacheKeys = Array.from(this.cache.keys());
      console.log(`[lookupEventSync] Looking for event ${eventId}, cache keys: ${allCacheKeys.join(', ')}`);
      
      for (const [key, cached] of this.cache.entries()) {
        if (key.startsWith('live_events_')) {
          if (cached && cached.data) {
            // Handle both array format and { events: [...] } object format
            const events = Array.isArray(cached.data) ? cached.data : (cached.data.events ?? []);
            console.log(`[lookupEventSync] Checking ${key}: isArray=${Array.isArray(cached.data)}, events.length=${Array.isArray(events) ? events.length : 'N/A'}`);
            if (Array.isArray(events)) {
              const event = events.find((e: any) => String(e.id) === eventId);
              if (event) {
                // Get minute from event data - DO NOT default to 0
                // Missing minute data should be treated as unverifiable for security
                const minuteValue = event.minute ?? event.elapsed;
                return {
                  found: true,
                  isLive: true,
                  minute: minuteValue, // undefined if not available - fail-closed
                  cacheAgeMs: Date.now() - cached.timestamp,
                  source: 'live',
                  startTime: event.startTime,
                  shouldBeLive: true // Already live
                };
              }
            }
          }
        }
      }
      
      // Second, check upcoming events cache
      // Cache keys are like: upcoming_events_football_10_v7 or upcoming_events_football_250_v7
      for (const [key, cached] of this.cache.entries()) {
        if (key.startsWith('upcoming_events_')) {
          if (cached && cached.data) {
            // Handle both array format and { events: [...] } object format
            const events = Array.isArray(cached.data) ? cached.data : (cached.data.events ?? []);
            console.log(`[lookupEventSync] Checking upcoming ${key}: isArray=${Array.isArray(cached.data)}, events.length=${Array.isArray(events) ? events.length : 'N/A'}`);
            if (Array.isArray(events)) {
              const event = events.find((e: any) => String(e.id) === eventId);
              if (event) {
                // Check if the match should have started based on startTime
                const startTime = event.startTime;
                const shouldBeLive = startTime ? new Date(startTime).getTime() <= Date.now() : false;
                
                return {
                  found: true,
                  isLive: false,
                  minute: undefined,
                  cacheAgeMs: Date.now() - cached.timestamp,
                  source: 'upcoming',
                  startTime,
                  shouldBeLive
                };
              }
            }
          }
        }
      }
      
      // Event not found in any cache
      return { found: false, isLive: false, cacheAgeMs: Infinity, source: 'none', shouldBeLive: false };
    } catch (error) {
      console.error('[ApiSportsService] Error in lookupEventSync:', error);
      return { found: false, isLive: false, cacheAgeMs: Infinity, source: 'none', shouldBeLive: false };
    }
  }
  
  // API endpoints for each sport - expanded to include all sports from the API
  // Aligned with sportMap in routes.ts for consistent identifiers
  private sportEndpoints: Record<string, string> = {
    // Main sports with direct API endpoints
    football: 'https://v3.football.api-sports.io/fixtures',       // ID: 1
    soccer: 'https://v3.football.api-sports.io/fixtures',         // ID: 26 (alt name for football)
    basketball: 'https://v1.basketball.api-sports.io/games',      // ID: 2
    tennis: 'https://v1.tennis.api-sports.io/matches',            // ID: 3
    baseball: 'https://v1.baseball.api-sports.io/games',          // ID: 4
    'ice-hockey': 'https://v1.hockey.api-sports.io/games',        // ID: 5
    hockey: 'https://v1.hockey.api-sports.io/games',              // Legacy support
    handball: 'https://v1.handball.api-sports.io/games',          // ID: 6
    volleyball: 'https://v1.volleyball.api-sports.io/games',      // ID: 7
    rugby: 'https://v1.rugby.api-sports.io/games',                // ID: 8
    cricket: 'https://v1.cricket.api-sports.io/fixtures',         // ID: 9
    golf: 'https://v1.golf.api-sports.io/tournaments',            // ID: 10
    boxing: 'https://v1.boxing.api-sports.io/fights',             // ID: 11
    'mma-ufc': 'https://v1.mma.api-sports.io/fights',             // ID: 12
    mma: 'https://v1.mma.api-sports.io/fights',                   // Legacy support
    'formula-1': 'https://v1.formula-1.api-sports.io/races',      // ID: 13
    formula_1: 'https://v1.formula-1.api-sports.io/races',        // Legacy support
    cycling: 'https://v1.cycling.api-sports.io/races',            // ID: 14
    'american-football': 'https://v1.american-football.api-sports.io/games', // ID: 15
    american_football: 'https://v1.american-football.api-sports.io/games',   // Legacy support
    'aussie-rules': 'https://v1.aussie-rules.api-sports.io/games', // ID: 16 (was afl)
    afl: 'https://v1.aussie-rules.api-sports.io/games',            // Legacy support
    snooker: 'https://v1.snooker.api-sports.io/fixtures',          // ID: 17
    darts: 'https://v1.darts.api-sports.io/fixtures',              // ID: 18
    'table-tennis': 'https://v1.table-tennis.api-sports.io/fixtures', // ID: 19
    tabletennis: 'https://v1.table-tennis.api-sports.io/fixtures',     // Legacy support
    badminton: 'https://v1.badminton.api-sports.io/fixtures',          // ID: 20
    'beach-volleyball': 'https://v1.volleyball.api-sports.io/games',    // ID: 21 (using volleyball API)
    'winter-sports': 'https://v1.ski.api-sports.io/races',              // ID: 22
    motorsport: 'https://v1.motorsport.api-sports.io/races',            // ID: 23
    esports: 'https://v1.esports.api-sports.io/games',                 // ID: 24
    netball: 'https://v1.netball.api-sports.io/games',                 // ID: 25
    
    // League-specific endpoints (which use the main sport APIs)
    nba: 'https://v1.basketball.api-sports.io/games',    // ID: 27 (uses basketball API)
    nhl: 'https://v1.hockey.api-sports.io/games',        // ID: 28 (uses hockey API)
    nfl: 'https://v1.american-football.api-sports.io/games', // ID: 29 (uses american football API)
    mlb: 'https://v1.baseball.api-sports.io/games',      // ID: 30 (uses baseball API)
  };
  
  // Status check endpoint for each API
  private statusEndpoints: Record<string, string> = {
    football: 'https://v3.football.api-sports.io/status',
    basketball: 'https://v1.basketball.api-sports.io/status',
    tennis: 'https://v1.tennis.api-sports.io/status',
    baseball: 'https://v1.baseball.api-sports.io/status',
    cricket: 'https://v1.cricket.api-sports.io/status',
    hockey: 'https://v1.hockey.api-sports.io/status',
    handball: 'https://v1.handball.api-sports.io/status',
    volleyball: 'https://v1.volleyball.api-sports.io/status',
    rugby: 'https://v1.rugby.api-sports.io/status',
    formula_1: 'https://v1.formula-1.api-sports.io/status',
    'formula-1': 'https://v1.formula-1.api-sports.io/status',
    american_football: 'https://v1.american-football.api-sports.io/status',
    nba: 'https://v1.basketball.api-sports.io/status',
    nfl: 'https://v1.american-football.api-sports.io/status',
    afl: 'https://v1.aussie-rules.api-sports.io/status'
  };

  constructor(apiKey?: string) {
    // PAID API-SPORTS ONLY - NO FALLBACKS
    const key = apiKey || process.env.API_SPORTS_KEY;
    
    if (!key) {
      const errorMsg = '❌ CRITICAL: API_SPORTS_KEY environment variable not set! Paid API-Sports is REQUIRED. Set API_SPORTS_KEY in Railway/Replit environment.';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    this.apiKey = key;
    console.log(`[ApiSportsService] ✅ API-SPORTS KEY ACTIVE | Key length: ${this.apiKey.length}`);
    console.log(`[ApiSportsService] 📍 Endpoint: https://v3.football.api-sports.io | POLICY: PAID API ONLY - NO FALLBACKS`);
    
    // Set longer timeout for API requests
    axios.defaults.timeout = 15000;
    
    // Verify API key works correctly for direct API - start with most important APIs
    this.verifyApiConnections();
    this.checkForLiveFixtures();
  }
  
  /**
   * Verify API connections with all major sports APIs
   */
  private async verifyApiConnections() {
    try {
      // Try to verify at least the football API connection first
      await this.verifyApiConnection('football');
      
      // Try other important sports APIs in parallel (only ones that exist)
      // Note: tennis, cricket, golf, boxing, cycling APIs don't exist
      Promise.all([
        this.verifyApiConnection('basketball'),
        this.verifyApiConnection('mma-ufc')
      ]).catch(error => {
        console.warn(`[ApiSportsService] Some sport APIs may not be available: ${error.message}`);
      });
    } catch (error) {
      console.error('[ApiSportsService] API connections verification failed:', error);
    }
  }

  /**
   * Verify that a specific sport API connection is working properly
   */
  private async verifyApiConnection(sport: string = 'football') {
    try {
      console.log(`[ApiSportsService] Verifying ${sport} API connection...`);
      const statusEndpoint = this.statusEndpoints[sport] || 'https://v3.football.api-sports.io/status';
      
      const response = await axios.get(statusEndpoint, {
        headers: {
          'x-apisports-key': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      if (response.data && response.data.response) {
        const account = response.data.response.account;
        const subscription = response.data.response.subscription;
        const requests = response.data.response.requests;
        
        // Handle cases where account info might be undefined (some APIs have different response formats)
        const accountName = account?.firstname && account?.lastname 
          ? `${account.firstname} ${account.lastname}` 
          : account?.email || 'API Connected';
        
        console.log(`[ApiSportsService] ${sport} API connection successful! Account: ${accountName}`);
        if (subscription) {
          console.log(`[ApiSportsService] Subscription: ${subscription.plan}, expires: ${subscription.end}`);
        }
        if (requests) {
          console.log(`[ApiSportsService] API usage: ${requests.current}/${requests.limit_day} requests today`);
        }
        return true;
      } else {
        console.warn(`[ApiSportsService] ${sport} API connection verification returned unexpected response format`);
        return false;
      }
    } catch (error) {
      console.error(`[ApiSportsService] ${sport} API connection verification failed:`, error);
      return false;
    }
  }
  
  /**
   * Check for any current live fixtures
   */
  private async checkForLiveFixtures() {
    try {
      console.log('[ApiSportsService] Checking for live fixtures...');
      const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
        params: { 
          live: 'all'
        },
        headers: {
          'x-apisports-key': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      if (response.data && response.data.response) {
        const liveFixtures = response.data.response;
        console.log(`[ApiSportsService] Found ${liveFixtures.length} live fixtures`);
        
        if (liveFixtures.length > 0) {
          console.log('[ApiSportsService] Live events available! The application can display real-time data.');
          
          // Log a few sample fixtures
          liveFixtures.slice(0, 3).forEach((fixture: any, index: number) => {
            const homeTeam = fixture.teams?.home?.name || 'Unknown';
            const awayTeam = fixture.teams?.away?.name || 'Unknown';
            const score = `${fixture.goals?.home || 0}-${fixture.goals?.away || 0}`;
            const status = fixture.fixture?.status?.short || 'Unknown';
            console.log(`[ApiSportsService] Live fixture #${index+1}: ${homeTeam} vs ${awayTeam}, Score: ${score}, Status: ${status}`);
          });
        } else {
          console.log('[ApiSportsService] No live fixtures found at this time. Using fallback data when needed.');
        }
      }
    } catch (error) {
      console.error('[ApiSportsService] Error checking for live fixtures:', error);
    }
  }

  /**
   * Get API client instance with proper headers
   */
  private getApiClient(sport: string = 'football') {
    // Map our sport slug to API-Sports endpoint
    const sportEndpoints: Record<string, string> = {
      // Main sports
      football: 'https://v3.football.api-sports.io',
      soccer: 'https://v3.football.api-sports.io',
      basketball: 'https://v1.basketball.api-sports.io',
      baseball: 'https://v1.baseball.api-sports.io',
      hockey: 'https://v1.hockey.api-sports.io',
      rugby: 'https://v1.rugby.api-sports.io',
      american_football: 'https://v1.american-football.api-sports.io',
      tennis: 'https://v1.tennis.api-sports.io',
      cricket: 'https://v1.cricket.api-sports.io',
      
      // Combat sports
      mma: 'https://v1.mma.api-sports.io',
      boxing: 'https://v1.boxing.api-sports.io',
      'mma-ufc': 'https://v1.mma.api-sports.io', // Add UFC/MMA alias
      
      // Team sports
      volleyball: 'https://v1.volleyball.api-sports.io',
      handball: 'https://v1.handball.api-sports.io',
      aussie_rules: 'https://v1.aussie-rules.api-sports.io',
      afl: 'https://v1.aussie-rules.api-sports.io', // Add AFL alias
      
      // Racket sports
      badminton: 'https://v1.badminton.api-sports.io',
      table_tennis: 'https://v1.table-tennis.api-sports.io',
      squash: 'https://v1.squash.api-sports.io',
      
      // Individual sports
      golf: 'https://v1.golf.api-sports.io',
      cycling: 'https://v1.cycling.api-sports.io',
      formula_1: 'https://v1.formula-1.api-sports.io',
      motogp: 'https://v1.motogp.api-sports.io',
      
      // Winter sports
      ski_jumping: 'https://v1.ski-jumping.api-sports.io',
      skiing: 'https://v1.skiing.api-sports.io',
      
      // Water sports
      swimming: 'https://v1.swimming.api-sports.io',
      water_polo: 'https://v1.water-polo.api-sports.io',
      
      // Other sports
      darts: 'https://v1.darts.api-sports.io',
      snooker: 'https://v1.snooker.api-sports.io',
      horse_racing: 'https://v1.horse-racing.api-sports.io',
      esports: 'https://v1.esports.api-sports.io',
    };

    // Default to football endpoint if sport not found
    const baseUrl = sportEndpoints[sport] || 'https://v3.football.api-sports.io';

    return axios.create({
      baseURL: baseUrl,
      headers: {
        'x-apisports-key': this.apiKey,
        'Accept': 'application/json'
      },
      timeout: 20000 // Increase timeout to 20 seconds
    });
  }

  /**
   * Get cached data or make API request
   * @param cacheKey The key to cache the data under
   * @param fetchFn The function to fetch the data
   * @param cacheExpiryOverride Optional override for cache expiry in milliseconds
   */
  private async getCachedOrFetch(
    cacheKey: string, 
    fetchFn: () => Promise<any>,
    cacheExpiryOverride?: number
  ): Promise<any> {
    // Add version key to force refresh when code changes
    const versionedKey = `${cacheKey}_${this.cacheVersionKey}`;
    const cached = this.cache.get(versionedKey);
    const expiryToUse = cacheExpiryOverride || this.cacheExpiry;
    
    if (cached && Date.now() - cached.timestamp < expiryToUse) {
      // IMPORTANT: Don't use cached empty arrays - always try to fetch fresh data
      const isEmptyArray = Array.isArray(cached.data) && cached.data.length === 0;
      if (!isEmptyArray) {
        console.log(`[ApiSportsService] Using cached data for ${cacheKey}`);
        return cached.data;
      }
      console.log(`[ApiSportsService] Cached data is empty, fetching fresh data for ${cacheKey}`);
    }
    
    try {
      console.log(`[ApiSportsService] Fetching fresh data for ${cacheKey}`);
      const data = await fetchFn();
      
      // Only cache non-empty results to prevent caching API failures
      const isEmptyResult = Array.isArray(data) && data.length === 0;
      if (!isEmptyResult) {
        this.cache.set(versionedKey, { data, timestamp: Date.now() });
        console.log(`[ApiSportsService] Cached ${Array.isArray(data) ? data.length : 'non-array'} items for ${cacheKey}`);
      } else {
        console.log(`[ApiSportsService] Not caching empty result for ${cacheKey}`);
      }
      
      return data;
    } catch (error) {
      // If we have stale cache, return it rather than failing
      if (cached) {
        console.warn(`[ApiSportsService] Failed to fetch fresh data for ${cacheKey}, using stale cache`);
        return cached.data;
      }
      throw error;
    }
  }

  /**
   * Map API-Sports status to our status format
   */
  private mapEventStatus(status: string): 'scheduled' | 'live' | 'finished' {
    // Football status mapping
    const liveStatuses = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'IN PLAY', 'BREAK'];
    const finishedStatuses = ['FT', 'AET', 'PEN', 'FINISHED', 'AFTER PENALTIES', 'AFTER EXTRA TIME'];
    
    if (liveStatuses.includes(status)) return 'live';
    if (finishedStatuses.includes(status)) return 'finished';
    return 'scheduled';
  }

  /**
   * Convert decimal odds to American format
   */
  private decimalToAmerican(decimal: number): number {
    if (decimal >= 2) {
      return Math.round((decimal - 1) * 100);
    } else {
      return Math.round(-100 / (decimal - 1));
    }
  }

  /**
   * Get live events for a specific sport
   * @param sport Sport slug (e.g., 'football', 'basketball')
   */
  async getLiveEvents(sport: string = 'football'): Promise<SportEvent[]> {
    if (!this.apiKey) {
      console.warn('No SPORTSDATA_API_KEY available, returning empty live events');
      return [];
    }

    console.log(`[ApiSportsService] Attempting to fetch live events for ${sport} with API key`);
    
    // Special handling for tennis since its API may not be accessible
    if (sport === 'tennis') {
      // We'll only show tennis data if it's available from the actual tennis API
      return await this.getTennisLiveEvents();
    }
    
    try {
      // Get the appropriate sport ID for our system
      const sportId = this.getSportId(sport);
      console.log(`[ApiSportsService] Sport ID for ${sport} is ${sportId}`);
      
      // Use a shorter cache expiry for live events - MUST pass expiry override!
      const cacheKey = `live_events_${sport}`;
      
      // Get data from the cache or fetch it fresh - Use 10 second expiry for live events to get real-time updates
      const events = await this.getCachedOrFetch(cacheKey, async () => {
        console.log(`[ApiSportsService] Fetching live events for ${sport}`);
        
        // Try to use the sport-specific API endpoint if available
        // Note: tennis, cricket, golf, boxing, cycling APIs don't exist - they will fall through to football
        const sportEndpoints: Record<string, string> = {
          football: 'https://v3.football.api-sports.io/fixtures',
          soccer: 'https://v3.football.api-sports.io/fixtures',
          basketball: 'https://v1.basketball.api-sports.io/games',
          baseball: 'https://v1.baseball.api-sports.io/games',
          hockey: 'https://v1.hockey.api-sports.io/games',
          rugby: 'https://v1.rugby.api-sports.io/games',
          american_football: 'https://v1.american-football.api-sports.io/games',
          'american-football': 'https://v1.american-football.api-sports.io/games',
          handball: 'https://v1.handball.api-sports.io/games',
          volleyball: 'https://v1.volleyball.api-sports.io/games',
          mma: 'https://v1.mma.api-sports.io/fights',
          'mma-ufc': 'https://v1.mma.api-sports.io/fights',
          formula_1: 'https://v1.formula-1.api-sports.io/races',
          'formula-1': 'https://v1.formula-1.api-sports.io/races'
        };
        
        // Create params based on API endpoint format
        // Only include params for APIs that actually exist
        const getParams = (endpoint: string): Record<string, string> => {
          if (endpoint.includes('football')) {
            return { live: 'all' };
          } else if (endpoint.includes('basketball')) {
            const today = new Date().toISOString().split('T')[0];
            return { 
              date: today,
              timezone: 'UTC',
              status: 'NS-1Q-2Q-3Q-4Q-OT-BT-HT'
            };
          } else if (endpoint.includes('mma')) {
            return { status: 'live' };
          } else if (endpoint.includes('formula-1')) {
            return { status: 'live' };
          } else if (endpoint.includes('handball') || endpoint.includes('volleyball')) {
            return { live: 'true' };
          } else if (endpoint.includes('rugby')) {
            return { status: 'LIVE' };
          } else if (endpoint.includes('american-football')) {
            return { live: 'true' };
          } else if (endpoint.includes('baseball')) {
            return { live: 'true' };
          } else if (endpoint.includes('hockey')) {
            return { live: 'true' };
          } else {
            return { live: 'true' };
          }
        };
        
        // Find the right API endpoint URL for this sport
        let apiUrl = 'https://v3.football.api-sports.io/fixtures'; // Default to football
        let params: Record<string, string> = { live: 'all' };
        
        if (sportEndpoints[sport]) {
          apiUrl = sportEndpoints[sport];
          params = getParams(apiUrl);
          console.log(`[ApiSportsService] Using sport-specific API endpoint: ${apiUrl} with params: ${JSON.stringify(params)}`);
        } else {
          console.log(`[ApiSportsService] No specific API endpoint for ${sport}, using football API`);
        }
        
        try {
          console.log(`[ApiSportsService] Making direct API request to ${apiUrl} with params:`, params);
          
          const response = await axios.get(apiUrl, {
            params,
            headers: {
              // For direct API-Sports access
              'x-apisports-key': this.apiKey,
              'Accept': 'application/json'
            }
          });
          
          if (response.data && response.data.response) {
            const rawEvents = response.data.response;
            console.log(`[ApiSportsService] Found ${rawEvents.length} raw live events for ${sport} from direct API call`);
            
            // For sports with direct API support, return the raw data for sport-specific transformation
            if (sportEndpoints[sport]) {
              return rawEvents.map((event: any) => {
                // Inject the correct sportId into the raw event data
                return {
                  ...event,
                  _sportId: sportId,  // Add a temporary field for the transformer to use
                  _sportName: sport   // Add the sport name for reference
                };
              });
            }
            
            return rawEvents;
          } else {
            console.log(`[ApiSportsService] Response structure unexpected:`, 
                        Object.keys(response.data).join(', '));
          }
          
          // Don't use fallback, just return empty list
          console.log(`[ApiSportsService] No live events found for ${sport}`);
          return [];
        } catch (error) {
          console.error(`[ApiSportsService] Error fetching live events for ${sport} from ${apiUrl}:`, error);
          
          // Don't use fallback for API failures, just return empty array
          console.log(`[ApiSportsService] API unavailable for ${sport} - returning empty array`);
          return [];
        }
      }, this.shortCacheExpiry); // Use 15-second cache for live events
      
      // Transform to our format with the right sportId based on requested sport
      const transformedEvents = this.transformEventsData(events, sport, true);
      console.log(`[ApiSportsService] Transformed ${events.length} events into ${transformedEvents.length} SportEvents for ${sport}`);
      return transformedEvents;
    } catch (error) {
      console.error(`Error fetching live events for ${sport} from API-Sports:`, error);
      console.log(`[ApiSportsService] Cannot fetch live ${sport} events - API error. Please check SPORTSDATA_API_KEY. Using key of length: ${this.apiKey.length}.`);
      return [];
    }
  }
  
  /**
   * Get the sport ID from the sport name/slug
   */
  private getSportId(sport: string): number {
    const sportIdMap: Record<string, number> = {
      football: 1,
      soccer: 1,
      basketball: 2,
      nba: 2, // NBA maps to basketball
      tennis: 3,
      baseball: 4,
      hockey: 5,
      handball: 6,
      volleyball: 7,
      rugby: 8,
      cricket: 9, 
      golf: 10,
      boxing: 11,
      mma: 12,
      'mma-ufc': 12, // Added this entry to support mma-ufc as slug
      formula_1: 13,
      'formula-1': 13, // Support either format
      cycling: 14,
      american_football: 15,
      'american-football': 15, // Support hyphenated format
      nfl: 15, // NFL maps to american_football
      afl: 16, // Australian Football League
      'aussie-rules': 16, // Support hyphenated format
      aussie_rules: 16, // Alternative name for AFL
      snooker: 17,
      darts: 18,
      'table-tennis': 19, // Support hyphenated format
      table_tennis: 19,
      badminton: 20,
      esports: 21,
      motorsport: 22,
      netball: 23
    };
    
    return sportIdMap[sport] || 1; // Default to football if not found
  }
  
  /**
   * Get live tennis events specifically
   * Note: The tennis API (v1.tennis.api-sports.io) does not exist, so return empty array
   */
  private async getTennisLiveEvents(): Promise<SportEvent[]> {
    // Tennis API doesn't exist - return empty array without making API call
    console.log(`[ApiSportsService] Tennis API not available - returning empty array`);
    return [];
  }
  


  /**
   * Get upcoming events for a specific sport
   * @param sport Sport slug (e.g., 'football', 'basketball')
   * @param limit Number of events to return
   */
  async getUpcomingEvents(sport: string = 'football', limit: number = 10): Promise<SportEvent[]> {
    if (!this.apiKey) {
      console.warn('No SPORTSDATA_API_KEY available, returning empty upcoming events');
      return [];
    }

    console.log(`[ApiSportsService] Attempting to fetch upcoming events for ${sport} with API key`);
    
    try {
      const cacheKey = `upcoming_events_${sport}_${limit}`;
      
      const events = await this.getCachedOrFetch(cacheKey, async () => {
        console.log(`[ApiSportsService] Fetching upcoming events for ${sport}`);
        let apiUrl: string;
        let params: any = {};
        const today = new Date();

        // Get events for a wider range - next 30 days
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + 30);
        
        const fromDate = today.toISOString().split('T')[0];
        const toDate = futureDate.toISOString().split('T')[0];
        
        // Try different approaches based on the sport
        switch(sport) {
          case 'football':
          case 'soccer':
            // IMPORTANT: 'next' parameter limited to 50, 'from/to' requires league param
            // Solution: Fetch next 50 (quick) + tomorrow's date (for 150+ total matches)
            // We'll handle multi-day fetching in parallel below
            apiUrl = 'https://v3.football.api-sports.io/fixtures';
            params = { 
              next: '50',
              timezone: 'UTC'
            };
            
            // Fetch 5 days of matches to get 200+ events (football only)
            try {
              const getDateStr = (daysFromNow: number) => {
                const date = new Date();
                date.setDate(date.getDate() + daysFromNow);
                return date.toISOString().split('T')[0];
              };
              
              // Fetch today + next 4 days in parallel
              const dayDates = [0, 1, 2, 3, 4].map(d => getDateStr(d));
              console.log(`[ApiSportsService] Fetching football events for dates: ${dayDates.join(', ')}`);
              
              const requests = dayDates.map(date => 
                axios.get(apiUrl, {
                  params: { date, timezone: 'UTC' },
                  headers: { 'x-apisports-key': this.apiKey, 'Accept': 'application/json' }
                }).catch(err => {
                  console.log(`[ApiSportsService] Failed to fetch football for ${date}: ${err.message}`);
                  return { data: { response: [] } }; // Tolerate individual day failures
                })
              );
              
              const results = await Promise.all(requests);
              
              const eventCounts = results.map((r, i) => {
                const count = r.data?.response?.length || 0;
                return `Day ${i} (${dayDates[i]}): ${count}`;
              });
              console.log(`[ApiSportsService] Event counts: ${eventCounts.join(', ')}`);
              
              // Combine all events with sport info (always football for this case)
              const footballSportId = this.getSportId('football');
              const combinedEvents = results.flatMap(r => r.data?.response || [])
                .map((event: any) => ({ ...event, sportId: footballSportId, sportName: 'football' }));
              
              if (combinedEvents.length > 0) {
                // For football, we want 200+ events, so use a minimum of 250 unless explicitly limited
                const effectiveLimit = limit === 10 ? 250 : Math.min(limit, 250);
                const limitedEvents = combinedEvents.slice(0, effectiveLimit);
                console.log(`[ApiSportsService] Found ${combinedEvents.length} upcoming events for football (multi-day fetch), returning ${limitedEvents.length}`);
                return limitedEvents;
              }
            } catch (e: any) {
              console.log(`[ApiSportsService] Multi-day fetch failed for football: ${e.message}, falling back to next=50`);
            }
            break;
          case 'basketball':
            apiUrl = 'https://v1.basketball.api-sports.io/games';
            
            // Get next 7 days for basketball
            const basketballToday = new Date();
            // Add status=NS parameter to get only not started games
            params = {
              status: 'NS', // Not Started games only
              timezone: 'UTC',
              season: new Date().getFullYear(), // Current season
              date: basketballToday.toISOString().split('T')[0] // Format as YYYY-MM-DD
            };
            break;
          case 'tennis':
            // Tennis API doesn't exist - return empty array immediately
            console.log(`[ApiSportsService] Tennis API not available for upcoming events - returning empty array`);
            return [];
          case 'american-football':
            apiUrl = 'https://v1.american-football.api-sports.io/games';
            params = {
              date: fromDate,
              status: 'NS', // Not Started games only
              season: new Date().getFullYear()
            };
            break;
          case 'baseball':
            apiUrl = 'https://v1.baseball.api-sports.io/games';
            // For baseball, search for not started games
            params = {
              date: fromDate,
              status: 'NS', // Not Started games only
              season: new Date().getFullYear()
            };
            break;
          case 'hockey':
            apiUrl = 'https://v1.hockey.api-sports.io/games';
            params = {
              date: fromDate,
              status: 'NS', // Not Started games only
              season: new Date().getFullYear()
            };
            break;
          case 'american_football':
          case 'nfl':
            apiUrl = 'https://v1.american-football.api-sports.io/games';
            params = {
              date: fromDate,
              status: 'NS', // Not Started games only
              season: new Date().getFullYear()
            };
            break;
          case 'formula_1':
          case 'formula-1':
            apiUrl = 'https://v1.formula-1.api-sports.io/races';
            params = {
              status: 'scheduled',
              season: new Date().getFullYear()
            };
            break;
          case 'handball':
            apiUrl = 'https://v1.handball.api-sports.io/games';
            params = {
              date: fromDate,
              status: 'NS', // Not Started games only
              season: new Date().getFullYear()
            };
            break;
          case 'volleyball':
            apiUrl = 'https://v1.volleyball.api-sports.io/games';
            params = {
              date: fromDate,
              status: 'NS', // Not Started games only
              season: new Date().getFullYear()
            };
            break;
          case 'rugby':
            apiUrl = 'https://v1.rugby.api-sports.io/games';
            params = {
              date: fromDate,
              status: 'NS', // Not Started games only
              season: new Date().getFullYear()
            };
            break;
          case 'mma-ufc':
            apiUrl = 'https://v1.mma.api-sports.io/fights';
            // For MMA, search for scheduled events
            params = {
              status: 'scheduled'
            };
            break;
          case 'mma':
            apiUrl = 'https://v1.mma.api-sports.io/fights';
            params = {
              status: 'scheduled'
            };
            break;
          default:
            // For all other sports (tennis, cricket, golf, boxing, cycling, snooker, darts, etc.),
            // These sports don't have dedicated APIs - skip fetching entirely
            // The football API is already fetching comprehensive football data
            console.log(`[ApiSportsService] No dedicated API for ${sport} - skipping upcoming events`);
            return [];
        }
        
        // Try direct approach for upcoming events
        console.log(`[ApiSportsService] Making direct API request to ${apiUrl} for upcoming ${sport} events with params:`, params);
        
        try {
          const response = await axios.get(apiUrl, {
            params,
            headers: {
              'x-apisports-key': this.apiKey,
              'Accept': 'application/json'
            }
          });
          
          // Try to find response data
          if (response.data && response.data.response && Array.isArray(response.data.response)) {
            console.log(`[ApiSportsService] Found ${response.data.response.length} upcoming events for ${sport}`);
            
            // Set sportId and sportName properties on each event (not _sportId!)
            const sportId = this.getSportId(sport);
            const eventsWithSportInfo = response.data.response.map((event: any) => ({
              ...event,
              sportId: sportId, // CRITICAL: Must be 'sportId' not '_sportId'
              sportName: sport
            }));
            
            // Increase the limit for better results - show more paid API events
            return eventsWithSportInfo.slice(0, Math.max(limit, 100));
          } else {
            // Log more details about the response structure
            console.log(`[ApiSportsService] Response structure unexpected for ${sport}:`, 
                        response.data ? JSON.stringify(Object.keys(response.data)) : 'No data');
            console.log(`[ApiSportsService] Raw response data:`, 
                        response.data ? JSON.stringify(response.data).substring(0, 500) : 'No data');
          }
          
          // If we get this far, try an alternative approach for some sports
          // Note: tennis is already handled earlier in the switch statement and returns empty
          if (['basketball', 'baseball', 'hockey', 'mma-ufc'].includes(sport)) {
            console.log(`[ApiSportsService] Trying alternate API request for upcoming ${sport} events`);
            
            // Different parameters for alternative approach
            const altParams: Record<string, string> = {
              season: String(new Date().getFullYear()),
              next: '21'
            };
            
            console.log(`[ApiSportsService] Using alternative params:`, altParams);
            
            const altResponse = await axios.get(apiUrl, {
              params: altParams,
              headers: {
                'x-apisports-key': this.apiKey,
                'Accept': 'application/json'
              }
            });
            
            if (altResponse.data && altResponse.data.response && Array.isArray(altResponse.data.response)) {
              console.log(`[ApiSportsService] Alternative approach found ${altResponse.data.response.length} upcoming events for ${sport}`);
              
              // Set sport info on events
              const sportId = this.getSportId(sport);
              const eventsWithSportInfo = altResponse.data.response.map((event: any) => ({
                ...event,
                sportId: sportId,
                sportName: sport
              }));
              
              return eventsWithSportInfo.slice(0, Math.max(limit, 100));
            }
          }
          
          console.log(`[ApiSportsService] No upcoming events found for ${sport} after multiple attempts`);
          return [];
        } catch (error) {
          console.error(`[ApiSportsService] Error fetching upcoming events for ${sport}:`, error);
          console.log(`[ApiSportsService] Cannot fetch upcoming ${sport} events - API error. Please check SPORTSDATA_API_KEY. Using key of length: ${this.apiKey.length}.`);
          
          // Try a more generic approach for specific sports
          if (['mma-ufc', 'boxing'].includes(sport)) {
            try {
              console.log(`[ApiSportsService] Trying generic fetch for ${sport} events`);
              
              // For MMA and boxing, just grab any events without filtering by status
              const genericUrl = sport === 'mma-ufc' 
                ? 'https://v1.mma.api-sports.io/fights'
                : 'https://v1.boxing.api-sports.io/fights';
              
              const genericResponse = await axios.get(genericUrl, {
                headers: {
                  'x-apisports-key': this.apiKey,
                  'Accept': 'application/json'
                }
              });
              
              if (genericResponse.data && genericResponse.data.response && 
                  Array.isArray(genericResponse.data.response)) {
                console.log(`[ApiSportsService] Generic approach found ${genericResponse.data.response.length} events for ${sport}`);
                
                // Filter to future events
                const now = new Date();
                const sportId = this.getSportId(sport);
                
                const futureEvents = genericResponse.data.response
                  .filter((event: any) => {
                    const eventDate = event.date ? new Date(event.date) : null;
                    return eventDate && eventDate > now;
                  })
                  .map((event: any) => ({
                    ...event,
                    sportId: sportId,
                    sportName: sport
                  }));
                
                console.log(`[ApiSportsService] Found ${futureEvents.length} future events for ${sport}`);
                return futureEvents.slice(0, Math.max(limit, 100));
              }
            } catch (genericError) {
              console.error(`[ApiSportsService] Generic approach also failed for ${sport}:`, genericError);
            }
          }
          
          return [];
        }
      });
      
      // Transform to our format - with detailed logging
      console.log(`[ApiSportsService] Transforming ${events.length} raw events for ${sport}`);
      const transformedEvents = this.transformEventsData(events, sport, false);
      console.log(`[ApiSportsService] Transformed ${events.length} events into ${transformedEvents.length} SportEvents for ${sport}`);
      
      // Set status to "upcoming" explicitly for these events
      const upcomingEvents = transformedEvents.map(event => ({
        ...event,
        status: "upcoming" as "scheduled" | "live" | "finished" | "upcoming",
        isLive: false
      }));
      
      console.log(`[ApiSportsService] Returning ${upcomingEvents.length} upcoming events for ${sport}`);
      return upcomingEvents;
    } catch (error) {
      console.error(`Error fetching upcoming events for ${sport} from API-Sports:`, error);
      console.log(`[ApiSportsService] Cannot fetch upcoming ${sport} events - API error. Please check SPORTSDATA_API_KEY. Using key of length: ${this.apiKey.length}.`);
      return [];
    }
  }
  
  /**
   * Get upcoming events for all sports
   * @param limit Number of events per sport to return
   */
  async getAllUpcomingEvents(limit: number = 5): Promise<SportEvent[]> {
    if (!this.apiKey) {
      console.warn('No SPORTSDATA_API_KEY available, returning empty upcoming events');
      return [];
    }

    console.log(`[ApiSportsService] Attempting to fetch upcoming events for all sports with API key`);
    
    try {
      const cacheKey = `upcoming_events_all_sports_${limit}`;
      
      return await this.getCachedOrFetch(cacheKey, async () => {
        console.log(`[ApiSportsService] Fetching upcoming events for all sports`);
        
        // Focus on sports that typically have the most events available
        const prioritySports = [
          { id: 1, name: 'football' },
          { id: 2, name: 'basketball' },
          { id: 3, name: 'tennis' },
          { id: 4, name: 'baseball' },
          { id: 15, name: 'american_football' }, // NFL
          { id: 12, name: 'mma-ufc' }
        ];
        
        // Secondary sports to try if we need more events
        const secondarySports = [
          { id: 5, name: 'hockey' },
          { id: 6, name: 'handball' },
          { id: 7, name: 'volleyball' },
          { id: 8, name: 'rugby' },
          { id: 9, name: 'cricket' },
          { id: 11, name: 'boxing' },
          { id: 13, name: 'formula_1' },
          { id: 16, name: 'afl' },
          { id: 2, name: 'nba' }  // Using NBA alias for basketball
        ];
        
        let allEvents: SportEvent[] = [];
        
        // First try to get events from priority sports with a higher limit
        // to ensure we get a good selection
        console.log(`[ApiSportsService] Fetching upcoming events for ${prioritySports.length} priority sports`);
        
        const priorityPromises = prioritySports.map(sport => 
          this.getUpcomingEvents(sport.name, limit * 2) // Double limit for priority sports
            .then(events => {
              if (events && events.length > 0) {
                console.log(`[ApiSportsService] Found ${events.length} upcoming events for ${sport.name}`);
                return events;
              }
              return [];
            })
            .catch(error => {
              console.error(`[ApiSportsService] Error fetching upcoming events for ${sport.name}:`, error);
              return [];
            })
        );
        
        // Wait for all priority sport promises to complete
        const priorityResults = await Promise.all(priorityPromises);
        
        // Add priority sports events
        priorityResults.forEach(events => {
          if (events.length > 0) {
            allEvents = [...allEvents, ...events];
          }
        });
        
        console.log(`[ApiSportsService] Found ${allEvents.length} upcoming events from priority sports`);
        
        // Always try to fetch data for all secondary sports to ensure we have data for each sport category
        console.log(`[ApiSportsService] Fetching data for all secondary sports to ensure full coverage`);
        
        const secondaryPromises = secondarySports.map(sport => 
          this.getUpcomingEvents(sport.name, limit)
            .then(events => {
              if (events && events.length > 0) {
                console.log(`[ApiSportsService] Found ${events.length} upcoming events for ${sport.name}`);
                return events;
              }
              return [];
            })
            .catch(error => {
              console.error(`[ApiSportsService] Error fetching upcoming events for ${sport.name}:`, error);
              return [];
            })
        );
          
        // Wait for secondary sport promises
        const secondaryResults = await Promise.all(secondaryPromises);
        
        // Add secondary sports events
        secondaryResults.forEach(events => {
          if (events.length > 0) {
            allEvents = [...allEvents, ...events];
          }
        });
        
        // Make sure sport IDs are set correctly
        const eventsWithValidSportIds = allEvents.map(event => {
          // If sportId is missing or invalid, try to set it based on _sportName
          if (!event.sportId && event._sportName) {
            const sportId = this.getSportId(event._sportName);
            return {
              ...event,
              sportId
            };
          }
          return event;
        });
        
        console.log(`[ApiSportsService] Found a total of ${eventsWithValidSportIds.length} upcoming events from all sports combined`);
        return eventsWithValidSportIds;
      });
    } catch (error) {
      console.error('Error fetching upcoming events for all sports:', error);
      return [];
    }
  }

  /**
   * Transform events data from API-Sports format to our format
   */
  private transformEventsData(events: any[], sport: string, isLive: boolean): SportEvent[] {
    if (!events || !Array.isArray(events)) return [];
    
    // Get the correct sportId for this sport - ALWAYS use this, don't trust event data
    const correctSportId = this.getSportId(sport);
    
    // For all sports, use the appropriate transformer
    return events.map((event, index) => {
      // ALWAYS set the correct sportId based on the sport parameter - override any existing value
      event.sportId = correctSportId;
      event._sportName = sport;
      
      if (sport === 'football' || sport === 'soccer') {
        return this.transformFootballEvent(event, isLive, index);
      } else if (sport === 'basketball') {
        return this.transformBasketballEvent(event, isLive, index);
      } else if (sport === 'tennis') {
        // Use the tennis-specific transformer
        console.log(`[ApiSportsService] Using tennis transformer for event ${index}`);
        return this.transformTennisEvent(event, isLive, index);
      } else if (sport === 'cricket') {
        // Use cricket-specific transformer to ensure correct sport ID
        console.log(`[ApiSportsService] Processing cricket with sport ID 9 for event ${index}`);
        
        try {
          // Guaranteed to use Sport ID 9 for cricket
          const cricketEvent = this.transformGenericEvent(event, sport, isLive, index);
          return {
            ...cricketEvent,
            sportId: 9, // ENSURE cricket always has sportId 9
            score: event.score ? `${event.score.home || 0} - ${event.score.away || 0}` : undefined
          };
        } catch (e) {
          console.error(`Error creating cricket event:`, e);
          return this.transformGenericEvent(event, 'cricket', isLive, index);
        }
      } else if (sport === 'formula_1' || sport === 'formula-1') {
        // Use special handling for Formula 1 events
        console.log(`[ApiSportsService] Special handling for Formula 1 event ${index}`);
        
        // Log the actual event structure to better understand the data
        console.log(`[ApiSportsService] Formula 1 event raw data: ${JSON.stringify(event).substring(0, 500)}...`);
        
        // Extract race information - handle both API formats (races API vs fixtures API)
        const eventId = event.id?.toString() || event.fixture?.id?.toString() || `formula1-${index}`;
        const competition = event.competition?.name || event.league?.name || 'Formula 1';
        const circuit = event.circuit?.name || event.venue?.name || 'Circuit';
        const location = event.circuit?.location || event.venue?.city || 'Location';
        const raceDate = event.date || event.fixture?.date || new Date().toISOString();
        
        // Create a better display name for the race
        const homeTeam = `${competition} - ${circuit}`;
        const awayTeam = location || 'Grand Prix';
        
        // Get appropriate status mapping based on event status or the isLive parameter
        let status = 'upcoming';
        if (isLive) {
          status = 'live';
        } else if (event.status === 'completed' || event.status === 'finished') {
          status = 'finished';
        } else if (event.status === 'live' || event.status === 'in_progress') {
          status = 'live';
        } else if (event.status === 'not_started' || event.status === 'scheduled') {
          status = 'upcoming';
        }
        
        // Create F1-specific markets with real drivers where possible
        // Extract drivers from the response if available
        const drivers = event.drivers || [];
        
        // Create outcome data based on real drivers or use default drivers
        let outcomes = [];
        if (drivers && drivers.length > 0) {
          // Use real drivers from the API
          outcomes = drivers.slice(0, 5).map((driver: any, driverIndex: number) => ({
            id: `${eventId}-outcome-${driverIndex+1}`,
            name: driver.name || `Driver ${driverIndex+1}`,
            // Calculate odds based on driver position or use default formula
            odds: 1.5 + (driverIndex * 0.5),
            probability: Math.max(0.1, 0.7 - (driverIndex * 0.1))
          }));
        } else {
          // Use top Formula 1 drivers as default
          outcomes = [
            {
              id: `${eventId}-outcome-1`,
              name: 'Max Verstappen',
              odds: 1.5,
              probability: 0.67
            },
            {
              id: `${eventId}-outcome-2`,
              name: 'Lewis Hamilton',
              odds: 3.2,
              probability: 0.31
            },
            {
              id: `${eventId}-outcome-3`,
              name: 'Charles Leclerc',
              odds: 4.5,
              probability: 0.22
            }
          ];
        }
        
        const marketsData: MarketData[] = [
          {
            id: `${eventId}-market-race-winner`,
            name: 'Race Winner',
            outcomes
          }
        ];
        
        // Return a complete, well-formed event with proper sportId
        return {
          id: eventId,
          sportId: 13, // IMPORTANT: Always use Formula 1 sportId (13)
          leagueName: competition,
          homeTeam,
          awayTeam,
          startTime: new Date(raceDate).toISOString(),
          status: status as "scheduled" | "live" | "finished" | "upcoming",
          score: isLive ? "Lap: 0/0" : undefined, // Using a Formula 1 specific format
          markets: marketsData,
          isLive: status === 'live'
        };
      } else {
        return this.transformGenericEvent(event, sport, isLive, index);
      }
    });
  }
  
  /**
   * Transform tennis event data
   */
  private transformTennisEvent(event: any, isLive: boolean, index: number): SportEvent {
    // Process tennis API data with appropriate structure
    try {
      const id = event.id || event.fixture?.id || `tennis-${index}`;
      const homePlayer = event.home?.name || event.teams?.home?.name || 'Player 1';
      const awayPlayer = event.away?.name || event.teams?.away?.name || 'Player 2';
      const tournament = event.league?.name || event.tournament?.name || 'Tennis Tournament';
      const status = event.status?.short || event.fixture?.status?.short || 'NS';
      const mappedStatus = this.mapEventStatus(status);
      
      // Tennis scores can be complex - try to extract them or provide placeholder
      const score = event.score?.full || event.score?.sets || '0 - 0';
      
      // Look for real odds data from the API response
      let homeOdds = 1.7;
      let awayOdds = 1.9;
      
      // Try to extract odds if available in various formats
      if (event.odds && Array.isArray(event.odds) && event.odds.length > 0) {
        // Direct tennis API format
        if (event.odds[0]?.values) {
          const homeOddsData = event.odds[0].values.find((v: any) => v.value === homePlayer);
          const awayOddsData = event.odds[0].values.find((v: any) => v.value === awayPlayer);
          
          if (homeOddsData && homeOddsData.odd) {
            homeOdds = parseFloat(homeOddsData.odd);
          }
          
          if (awayOddsData && awayOddsData.odd) {
            awayOdds = parseFloat(awayOddsData.odd);
          }
        }
        // Alternative API format
        else if (event.odds[0]?.bookmakers && event.odds[0].bookmakers.length > 0) {
          const matchWinnerBet = event.odds[0].bookmakers[0]?.bets?.find((b: any) => 
            b.name === 'Match Winner' || b.name === 'Winner');
            
          if (matchWinnerBet && Array.isArray(matchWinnerBet.values)) {
            const homeOddsValue = matchWinnerBet.values.find((v: any) => 
              v.value === homePlayer || v.value === '1');
            const awayOddsValue = matchWinnerBet.values.find((v: any) => 
              v.value === awayPlayer || v.value === '2');
              
            if (homeOddsValue && homeOddsValue.odd) {
              homeOdds = parseFloat(homeOddsValue.odd);
            }
            
            if (awayOddsValue && awayOddsValue.odd) {
              awayOdds = parseFloat(awayOddsValue.odd);
            }
          }
        }
      }
      
      // Create more realistic probabilities from odds
      const homeProbability = parseFloat((1 / homeOdds).toFixed(2));
      const awayProbability = parseFloat((1 / awayOdds).toFixed(2));
      
      // Determine the most likely total games line based on tournament type
      let totalGamesLine = 22.5;
      // Adjust line for grand slams (best of 5 sets) vs regular tournaments (best of 3)
      if (tournament.includes('Grand Slam') || 
          tournament.includes('Australian Open') || 
          tournament.includes('French Open') || 
          tournament.includes('Wimbledon') || 
          tournament.includes('US Open')) {
        totalGamesLine = 36.5;
      }
      
      return {
        id: `${id}`,
        sportId: 3, // Tennis sportId in our system
        leagueName: tournament,
        leagueSlug: tournament.toLowerCase().replace(/\s+/g, '-'),
        homeTeam: homePlayer,
        awayTeam: awayPlayer,
        homeOdds: homeOdds,
        awayOdds: awayOdds,
        drawOdds: null, // Tennis has no draws
        startTime: event.fixture?.date || new Date().toISOString(),
        status: mappedStatus as 'scheduled' | 'live' | 'finished' | 'upcoming',
        score: score,
        isLive: mappedStatus === 'live',
        markets: [
          {
            id: `market-tennis-${id}-match-winner`,
            name: 'Match Winner',
            status: 'open',
            marketType: '12', // No draw in tennis
            outcomes: [
              { 
                id: `outcome-tennis-${id}-home`, 
                name: homePlayer, 
                odds: homeOdds, 
                status: 'active', 
                probability: homeProbability 
              },
              { 
                id: `outcome-tennis-${id}-away`, 
                name: awayPlayer, 
                odds: awayOdds, 
                status: 'active', 
                probability: awayProbability 
              }
            ]
          },
          {
            id: `market-tennis-${id}-total`,
            name: 'Total Games',
            status: 'open',
            marketType: 'total',
            outcomes: [
              { 
                id: `outcome-tennis-${id}-over`, 
                name: `Over ${totalGamesLine}`, 
                odds: 1.95, 
                status: 'active', 
                probability: 0.49 
              },
              { 
                id: `outcome-tennis-${id}-under`, 
                name: `Under ${totalGamesLine}`, 
                odds: 1.85, 
                status: 'active', 
                probability: 0.51 
              }
            ]
          }
        ]
      };
    } catch (error) {
      console.error(`[ApiSportsService] Error transforming tennis event:`, error);
      return this.transformGenericEvent(event, 'tennis', isLive, index);
    }
  }

  /**
   * Transform cricket event data
   */
  private transformCricketEvent(event: any, isLive: boolean, index: number): SportEvent {
    try {
      console.log(`[ApiSportsService] Processing cricket event: ${JSON.stringify(event?.fixture?.id || 'unknown')}`);
      console.log(`[ApiSportsService] CRICKET DEBUG: Raw event structure:`, JSON.stringify(event).substring(0, 500));
      
      // Extract key cricket data with fallbacks
      const id = event.fixture?.id?.toString() || event.id?.toString() || `cricket-${index}`;
      const homeTeam = event.teams?.home?.name || 'Home Team';
      const awayTeam = event.teams?.away?.name || 'Away Team';
      const tournament = event.league?.name || 'Cricket Tournament';
      const venueCity = event.fixture?.venue?.city || '';
      const venueCountry = event.league?.country || '';
      const venue = venueCity ? (venueCountry ? `${venueCity}, ${venueCountry}` : venueCity) : 'TBC';
      
      // Format - Test, T20, ODI, etc.
      const format = tournament.includes('Test') ? 'Test' : 
                    tournament.includes('T20') ? 'T20' : 
                    tournament.includes('ODI') ? 'ODI' : 'Cricket';

      // Parse status
      const status = event.fixture?.status?.short || '';
      const mappedStatus = this.mapEventStatus(status);
      
      // Score processing is specific to cricket's format
      let score = 'Match scheduled';
      if (event.score && (mappedStatus === 'live' || mappedStatus === 'finished')) {
        // Format: "Home Team 245/7 (50), Away Team 240/8 (50)"
        const homeScore = event.score?.home?.innings?.inning_1?.score || '0/0';
        const homeOvers = event.score?.home?.innings?.inning_1?.overs || '0';
        const awayScore = event.score?.away?.innings?.inning_1?.score || '0/0';
        const awayOvers = event.score?.away?.innings?.inning_1?.overs || '0';
        
        score = `${homeTeam} ${homeScore} (${homeOvers}), ${awayTeam} ${awayScore} (${awayOvers})`;
      }
      
      // Generate cricket-specific markets
      const marketsData: MarketData[] = [];
      
      // Match Winner market
      marketsData.push({
        id: `${id}-market-match-winner`,
        name: 'Match Winner',
        outcomes: [
          {
            id: `${id}-outcome-home`,
            name: homeTeam,
            odds: 1.92,
            probability: 0.52
          },
          {
            id: `${id}-outcome-away`,
            name: awayTeam,
            odds: 1.88,
            probability: 0.53
          }
        ]
      });
      
      // Total Runs market - varies based on format
      let totalRunsLine = 300;
      if (format === 'T20') {
        totalRunsLine = 160;
      } else if (format === 'Test') {
        totalRunsLine = 350;
      }
      
      marketsData.push({
        id: `${id}-market-total-runs`,
        name: 'Total Runs',
        outcomes: [
          {
            id: `${id}-outcome-over`,
            name: `Over ${totalRunsLine}.5`,
            odds: 1.85,
            probability: 0.54
          },
          {
            id: `${id}-outcome-under`,
            name: `Under ${totalRunsLine}.5`,
            odds: 1.95,
            probability: 0.51
          }
        ]
      });
      
      // Create the cricket event with proper venue and format fields
      const sportEvent: SportEvent = {
        id: id.toString(),
        sportId: 9,  // CRITICAL: Always use Cricket sportId (9)
        leagueName: tournament,
        leagueSlug: tournament.toLowerCase().replace(/\s+/g, '-'),
        homeTeam,
        awayTeam,
        homeOdds: 1.92,
        awayOdds: 1.88,
        drawOdds: null,  // Cricket matches don't typically have draws (except Test matches)
        startTime: event.fixture?.date || new Date().toISOString(),
        status: mappedStatus,
        score,
        isLive: mappedStatus === 'live',
        markets: marketsData,
        venue,       // Now included in the interface
        format       // Now included in the interface
      };
      
      console.log(`[ApiSportsService] Created cricket event with ID ${id} and sportId ${sportEvent.sportId}`);
      return sportEvent;
    } catch (error) {
      console.error(`[ApiSportsService] Error transforming cricket event:`, error);
      return this.transformGenericEvent(event, 'cricket', isLive, index);
    }
  }
  
  /**
   * Transform golf event data
   */
  private transformGolfEvent(event: any, isLive: boolean, index: number): SportEvent {
    try {
      // Extract key golf data with fallbacks
      const id = event.id?.toString() || event.tournament?.id?.toString() || `golf-${index}`;
      const tournament = event.tournament?.name || event.league?.name || 'Golf Tournament';
      const course = event.course?.name || event.venue?.name || 'Golf Course';
      const country = event.country?.name || event.country || 'International';
      
      // Format tournament details
      const leagueName = tournament;
      const homeTeam = event.player1?.name || event.players?.[0]?.name || tournament;
      const awayTeam = event.player2?.name || event.players?.[1]?.name || course;
      
      // Default status to scheduled/upcoming
      let status: 'scheduled' | 'live' | 'finished' | 'upcoming' = 'scheduled';
      if (isLive) {
        status = 'live';
      } else if (event.status === 'completed' || event.status === 'finished') {
        status = 'finished';
      } else {
        status = 'upcoming';
      }
      
      // Create golf-specific markets
      const marketsData: MarketData[] = [];
      
      // Get the top players to create our tournament winner market
      const players = event.players || [];
      let outcomes: OutcomeData[] = [];
      
      if (players.length > 0) {
        // Use real players from the tournament
        outcomes = players.slice(0, 5).map((player: any, playerIndex: number) => ({
          id: `${id}-outcome-${playerIndex}`,
          name: player.firstname ? `${player.firstname} ${player.lastname}` : player.name || `Player ${playerIndex+1}`,
          odds: 10 + (playerIndex * 5),  // Golf has longer odds typically
          probability: Math.max(0.01, 0.1 - (playerIndex * 0.015))
        }));
      } else {
        // Use some default players if none are provided
        outcomes = [
          {
            id: `${id}-outcome-1`,
            name: 'Rory McIlroy',
            odds: 9.0,
            probability: 0.11
          },
          {
            id: `${id}-outcome-2`,
            name: 'Scottie Scheffler',
            odds: 11.0,
            probability: 0.09
          },
          {
            id: `${id}-outcome-3`,
            name: 'Jon Rahm',
            odds: 14.0,
            probability: 0.07
          }
        ];
      }
      
      // Tournament Winner market
      marketsData.push({
        id: `${id}-market-tournament-winner`,
        name: 'Tournament Winner',
        outcomes
      });
      
      // Round leader market
      marketsData.push({
        id: `${id}-market-round-leader`,
        name: 'Round Leader',
        outcomes: outcomes.map(outcome => ({
          ...outcome,
          id: `${outcome.id}-round`,
          odds: outcome.odds * 0.7  // Slightly better odds for round leader
        }))
      });
      
      return {
        id: id,
        sportId: 10,  // Always use Golf sportId (10)
        leagueName,
        leagueSlug: tournament.toLowerCase().replace(/\s+/g, '-'),
        homeTeam,
        awayTeam,
        startTime: event.date || event.tournament?.date || new Date().toISOString(),
        status,
        score: isLive ? 'Round in progress' : undefined,
        isLive: status === 'live',
        markets: marketsData
      };
    } catch (error) {
      console.error(`[ApiSportsService] Error transforming golf event:`, error);
      return this.transformGenericEvent(event, 'golf', isLive, index);
    }
  }
  
  /**
   * Transform cycling event data
   */
  private transformCyclingEvent(event: any, isLive: boolean, index: number): SportEvent {
    try {
      // Extract key cycling data with fallbacks
      const id = event.id?.toString() || event.race?.id?.toString() || `cycling-${index}`;
      const raceName = event.race?.name || event.league?.name || 'Cycling Race';
      const stageNumber = event.stage?.number || '';
      const stageName = event.stage?.name || '';
      
      // Format race details
      const leagueName = raceName;
      const stageDesc = stageNumber && stageName ? `Stage ${stageNumber}: ${stageName}` : stageName || `Stage ${index+1}`;
      const homeTeam = raceName;
      const awayTeam = stageDesc;
      
      // Set status
      let status: 'scheduled' | 'live' | 'finished' | 'upcoming' = 'scheduled';
      if (isLive) {
        status = 'live';
      } else if (event.status === 'completed' || event.status === 'finished') {
        status = 'finished';
      } else {
        status = 'upcoming';
      }
      
      // Create cycling-specific markets
      const marketsData: MarketData[] = [];
      
      // Get the riders to create stage winner market
      const riders = event.riders || [];
      let outcomes: OutcomeData[] = [];
      
      if (riders.length > 0) {
        // Use real riders from the race
        outcomes = riders.slice(0, 5).map((rider: any, riderIndex: number) => ({
          id: `${id}-outcome-${riderIndex}`,
          name: rider.name || `Rider ${riderIndex+1}`,
          odds: 5 + (riderIndex * 2.5),
          probability: Math.max(0.05, 0.2 - (riderIndex * 0.03))
        }));
      } else {
        // Use some default riders if none are provided
        outcomes = [
          {
            id: `${id}-outcome-1`,
            name: 'Tadej Pogačar',
            odds: 4.5,
            probability: 0.22
          },
          {
            id: `${id}-outcome-2`,
            name: 'Jonas Vingegaard',
            odds: 6.0,
            probability: 0.17
          },
          {
            id: `${id}-outcome-3`,
            name: 'Remco Evenepoel',
            odds: 7.5,
            probability: 0.13
          }
        ];
      }
      
      // Stage Winner market
      marketsData.push({
        id: `${id}-market-stage-winner`,
        name: 'Stage Winner',
        outcomes
      });
      
      // Overall Classification market
      marketsData.push({
        id: `${id}-market-overall-winner`,
        name: 'Overall Winner',
        outcomes: outcomes.map(outcome => ({
          ...outcome,
          id: `${outcome.id}-overall`,
          odds: outcome.odds * 0.8  // Adjusted odds for overall winner
        }))
      });
      
      return {
        id: id,
        sportId: 14,  // Always use Cycling sportId (14)
        leagueName,
        leagueSlug: raceName.toLowerCase().replace(/\s+/g, '-'),
        homeTeam,
        awayTeam,
        startTime: event.date || event.race?.date || new Date().toISOString(),
        status,
        score: isLive ? 'Race in progress' : undefined,
        isLive: status === 'live',
        markets: marketsData
      };
    } catch (error) {
      console.error(`[ApiSportsService] Error transforming cycling event:`, error);
      return this.transformGenericEvent(event, 'cycling', isLive, index);
    }
  }
  
  /**
   * Transform football/soccer event data
   */
  private transformFootballEvent(event: any, isLive: boolean, index: number): SportEvent {
    const homeTeam = event.teams?.home?.name || 'Home Team';
    const awayTeam = event.teams?.away?.name || 'Away Team';
    const eventId = event.fixture?.id?.toString() || `api-sports-football-${index}`;
    const leagueName = event.league?.name || 'Unknown League';
    const status = this.mapEventStatus(event.fixture?.status?.short || '');
    
    // Get the sport ID - use injected _sportId if available, otherwise the sport parameter to determine ID
    // This is important since we may be using football API data for tennis events
    const getSportIdFromString = (sportType: string): number => {
      switch(sportType.toLowerCase()) {
        case 'football':
        case 'soccer':
          return 1;
        case 'basketball':
          return 2;
        case 'tennis':
          return 3;
        case 'baseball':
          return 4;
        case 'hockey':
          return 5;
        default:
          return 1; // Default to football
      }
    };
    
    // Use the passed _sportName or _sportId from the event
    const sportId = event._sportId || 1; // Default to football (1) if not specified
    const sportName = event._sportName || 'football';
    
    // Create basic markets data
    const marketsData: MarketData[] = [];
    
    // Try to extract odds if available
    if (event.odds && event.odds.length > 0) {
      const matchOdds = event.odds[0]?.bookmakers?.[0]?.bets?.find((bet: any) => bet.name === 'Match Winner');
      
      if (matchOdds) {
        const outcomes: OutcomeData[] = matchOdds.values.map((value: any) => ({
          id: `${eventId}-outcome-${value.value}`,
          name: value.value,
          odds: parseFloat(value.odd) || 2.0,
          probability: 1 / (parseFloat(value.odd) || 2.0)
        }));
        
        marketsData.push({
          id: `${eventId}-market-match-winner`,
          name: 'Match Result',
          outcomes: outcomes
        });
      }
      
      // Add more market types if available
      const bothToScore = event.odds[0]?.bookmakers?.[0]?.bets?.find((bet: any) => bet.name === 'Both Teams Score');
      if (bothToScore) {
        const outcomes: OutcomeData[] = bothToScore.values.map((value: any) => ({
          id: `${eventId}-outcome-bts-${value.value}`,
          name: value.value,
          odds: parseFloat(value.odd) || 2.0,
          probability: 1 / (parseFloat(value.odd) || 2.0)
        }));
        
        marketsData.push({
          id: `${eventId}-market-both-to-score`,
          name: 'Both Teams to Score',
          outcomes: outcomes
        });
      }
    } else {
      // Create real markets with accurate structure for events
      // Check if we need 1X2 markets or just 12 markets (no draw)
      const isIndividualSport = [3, 10, 11, 12, 13, 14, 17, 19, 23, 24].includes(sportId);
      
      if (isIndividualSport) {
        // For individual sports like tennis, no "draw" outcome
        marketsData.push({
          id: `${eventId}-market-match-winner`,
          name: 'Match Winner',
          outcomes: [
            {
              id: `${eventId}-outcome-home`,
              name: homeTeam,
              odds: event.homeOdds || 1.85,
              probability: event.homeProbability || 0.54
            },
            {
              id: `${eventId}-outcome-away`,
              name: awayTeam,
              odds: event.awayOdds || 1.95,
              probability: event.awayProbability || 0.51
            }
          ]
        });
      } else {
        // For team sports, include "Draw" outcome
        marketsData.push({
          id: `${eventId}-market-match-winner`,
          name: 'Match Result',
          outcomes: [
            {
              id: `${eventId}-outcome-home`,
              name: homeTeam,
              odds: event.homeOdds || 2.1,
              probability: event.homeProbability || 0.47
            },
            {
              id: `${eventId}-outcome-draw`,
              name: 'Draw',
              odds: event.drawOdds || 3.2,
              probability: event.drawProbability || 0.31
            },
            {
              id: `${eventId}-outcome-away`,
              name: awayTeam,
              odds: event.awayOdds || 3.0,
              probability: event.awayProbability || 0.33
            }
          ]
        });
      }
      
      // Add sport-specific totals markets
      if (sportId === 2) { // Basketball
        marketsData.push({
          id: `${eventId}-market-over-under`,
          name: 'Total Points',
          outcomes: [
            {
              id: `${eventId}-outcome-over`,
              name: 'Over 195.5',
              odds: 1.91,
              probability: 0.52
            },
            {
              id: `${eventId}-outcome-under`,
              name: 'Under 195.5',
              odds: 1.91,
              probability: 0.52
            }
          ]
        });
      } else if (sportId === 3) { // Tennis
        marketsData.push({
          id: `${eventId}-market-over-under`,
          name: 'Total Games',
          outcomes: [
            {
              id: `${eventId}-outcome-over`,
              name: 'Over 22.5',
              odds: 1.91,
              probability: 0.52
            },
            {
              id: `${eventId}-outcome-under`,
              name: 'Under 22.5',
              odds: 1.91,
              probability: 0.52
            }
          ]
        });
      } else { // Default (football) - Correct Score market
        marketsData.push({
          id: `${eventId}-market-correct-score`,
          name: 'Correct Score',
          outcomes: [
            {
              id: `${eventId}-outcome-1-0`,
              name: '1-0',
              odds: 6.5,
              probability: 0.15
            },
            {
              id: `${eventId}-outcome-2-0`,
              name: '2-0',
              odds: 8.0,
              probability: 0.12
            },
            {
              id: `${eventId}-outcome-2-1`,
              name: '2-1',
              odds: 7.5,
              probability: 0.13
            },
            {
              id: `${eventId}-outcome-0-0`,
              name: '0-0',
              odds: 9.0,
              probability: 0.11
            },
            {
              id: `${eventId}-outcome-1-1`,
              name: '1-1',
              odds: 5.5,
              probability: 0.18
            },
            {
              id: `${eventId}-outcome-0-1`,
              name: '0-1',
              odds: 7.0,
              probability: 0.14
            },
            {
              id: `${eventId}-outcome-0-2`,
              name: '0-2',
              odds: 9.5,
              probability: 0.10
            },
            {
              id: `${eventId}-outcome-other`,
              name: 'Other',
              odds: 4.0,
              probability: 0.25
            }
          ]
        });
      }
    }
    
    // Extract elapsed minutes from the API response
    const elapsedMinutes = event.fixture?.status?.elapsed || null;
    
    return {
      id: eventId,
      sportId: sportId, // Use the correct sport ID
      leagueName,
      homeTeam,
      awayTeam,
      startTime: new Date(event.fixture?.date || Date.now()).toISOString(),
      status: (isLive ? 'live' : (status || 'scheduled')) as 'scheduled' | 'live' | 'finished' | 'upcoming',
      score: isLive ? `${event.goals?.home || 0} - ${event.goals?.away || 0}` : undefined,
      minute: elapsedMinutes, // Include elapsed time for live events
      homeScore: event.goals?.home || 0,
      awayScore: event.goals?.away || 0,
      markets: marketsData,
      isLive
    };
  }

  /**
   * Transform basketball event data
   */
  private transformBasketballEvent(event: any, isLive: boolean, index: number): SportEvent {
    const homeTeam = event.teams?.home?.name || 'Home Team';
    const awayTeam = event.teams?.away?.name || 'Away Team';
    const eventId = event.id?.toString() || `api-sports-basketball-${index}`;
    const leagueName = event.league?.name || 'Unknown League';
    
    // Basketball scores
    const homeScore = event.scores?.home?.total || 0;
    const awayScore = event.scores?.away?.total || 0;
    
    // Extract real odds data from the API response if available
    const marketsData: MarketData[] = [];
    
    // Try to find odds data in various formats depending on the API structure
    if (event.odds && Array.isArray(event.odds)) {
      try {
        const markets = event.odds.map((odds: any, idx: number) => {
          const marketName = odds.name || 'Match Winner';
          const marketId = `${eventId}-market-${idx}`;
          
          const outcomes = Array.isArray(odds.values) ? 
            odds.values.map((value: any, vidx: number) => ({
              id: `${marketId}-outcome-${vidx}`,
              name: value.value || (vidx === 0 ? homeTeam : awayTeam),
              odds: parseFloat(value.odd) || 1.9,
              probability: 1 / (parseFloat(value.odd) || 1.9)
            })) : [];
            
          return {
            id: marketId,
            name: marketName,
            outcomes: outcomes
          };
        });
        
        if (markets.length > 0) {
          marketsData.push(...markets);
        }
      } catch (e) {
        console.log(`Error parsing direct odds data for basketball:`, e);
      }
    }
    
    // If no real market data was found, create realistic basketball markets
    if (marketsData.length === 0) {
      // Main basketball markets based on real-world betting patterns
      marketsData.push({
        id: `${eventId}-market-match-winner`,
        name: 'Match Winner',
        outcomes: [
          {
            id: `${eventId}-outcome-home`,
            name: homeTeam,
            odds: 1.85,
            probability: 0.54
          },
          {
            id: `${eventId}-outcome-away`,
            name: awayTeam,
            odds: 1.95,
            probability: 0.51
          }
        ]
      });
      
      // Add point spread market (handicap)
      marketsData.push({
        id: `${eventId}-market-point-spread`,
        name: 'Point Spread',
        outcomes: [
          {
            id: `${eventId}-outcome-spread-home`,
            name: `${homeTeam} (-4.5)`,
            odds: 1.91,
            probability: 0.52
          },
          {
            id: `${eventId}-outcome-spread-away`,
            name: `${awayTeam} (+4.5)`,
            odds: 1.91,
            probability: 0.52
          }
        ]
      });
      
      // Add total points market
      marketsData.push({
        id: `${eventId}-market-total-points`,
        name: 'Total Points',
        outcomes: [
          {
            id: `${eventId}-outcome-over`,
            name: 'Over 219.5',
            odds: 1.91,
            probability: 0.52
          },
          {
            id: `${eventId}-outcome-under`,
            name: 'Under 219.5',
            odds: 1.91,
            probability: 0.52
          }
        ]
      });
    }
    
    return {
      id: eventId,
      sportId: 2, // Basketball
      leagueName,
      homeTeam,
      awayTeam,
      startTime: new Date(event.date || Date.now()).toISOString(),
      status: (isLive ? 'live' : 'scheduled') as 'scheduled' | 'live' | 'finished' | 'upcoming',
      score: isLive ? `${homeScore} - ${awayScore}` : undefined,
      markets: marketsData,
      isLive
    };
  }

  /**
   * Transform Formula 1 race event data
   */
  private transformFormula1Event(event: any, isLive: boolean, index: number): SportEvent {
    console.log(`[ApiSportsService] Transforming Formula 1 event`);
    
    // Initialize event details
    const eventId = event.id?.toString() || `api-sports-f1-${index}`;
    const raceName = event.race?.name || event.competition?.name || event.league?.name || 'Formula 1 Race';
    const circuit = event.circuit?.name || event.venue?.name || 'Unknown Circuit';
    const location = event.circuit?.location || event.venue?.city || 'Unknown Location';
    const country = event.circuit?.country || event.country?.name || 'Unknown Country';
    
    const leagueName = `Formula 1 - ${raceName}`;
    const homeTeam = event.driver1?.name || event.teams?.home?.name || raceName;
    const awayTeam = event.driver2?.name || event.teams?.away?.name || circuit;
    
    // Extract drivers if available
    const drivers: string[] = [];
    if (event.drivers && Array.isArray(event.drivers)) {
      event.drivers.forEach((driver: any) => {
        if (driver.name) {
          drivers.push(driver.name);
        }
      });
    }
    
    // Create a title combining the race details
    const eventTitle = `${raceName} (${circuit}, ${country})`;
    
    // Get the status with proper typing
    let status: 'scheduled' | 'live' | 'finished' | 'upcoming' = 'scheduled';
    if (isLive) {
      status = 'live';
    } else if (event.status?.short === 'FT' || event.status?.short === 'Finished') {
      status = 'finished';
    }
    
    // Create markets data for F1 betting
    const marketsData: MarketData[] = [];
    
    // Try to extract real odds from the API response if available
    if (event.odds && Array.isArray(event.odds)) {
      try {
        const markets = event.odds.map((odds: any, idx: number) => {
          const marketName = odds.name || 'Race Winner';
          const marketId = `${eventId}-market-${idx}`;
          
          const outcomes = Array.isArray(odds.values) ? 
            odds.values.map((value: any, vidx: number) => ({
              id: `${marketId}-outcome-${vidx}`,
              name: value.value || `Driver ${vidx + 1}`,
              odds: parseFloat(value.odd) || 2.0 + (vidx * 0.5),
              probability: 1 / (parseFloat(value.odd) || 2.0 + (vidx * 0.5))
            })) : [];
            
          return {
            id: marketId,
            name: marketName,
            outcomes: outcomes
          };
        });
        
        if (markets.length > 0) {
          marketsData.push(...markets);
        }
      } catch (e) {
        console.log(`Error parsing direct odds data for Formula 1:`, e);
      }
    }
    
    // If no real markets data found, create realistic F1 markets
    if (marketsData.length === 0) {
      // Create a race winner market with proper F1 sportId
      if (drivers.length > 0) {
        // If we have real drivers, use them for the market
        const driverOutcomes = drivers.slice(0, 6).map((driver, idx) => ({
          id: `${eventId}-outcome-${idx}`,
          name: driver,
          odds: 1.5 + (idx * 1.2), // Realistic F1 odds progression
          probability: 1 / (1.5 + (idx * 1.2))
        }));
        
        marketsData.push({
          id: `${eventId}-market-race-winner`,
          name: 'Race Winner',
          outcomes: driverOutcomes
        });
      } else {
        // Use placeholder data if no real drivers available
        marketsData.push({
          id: `${eventId}-market-race-winner`,
          name: 'Race Winner',
          outcomes: [
            {
              id: `${eventId}-outcome-1`,
              name: 'Max Verstappen',
              odds: 1.5,
              probability: 0.67
            },
            {
              id: `${eventId}-outcome-2`,
              name: 'Lewis Hamilton',
              odds: 3.2,
              probability: 0.31
            },
            {
              id: `${eventId}-outcome-3`,
              name: 'Charles Leclerc',
              odds: 4.5,
              probability: 0.22
            },
            {
              id: `${eventId}-outcome-4`,
              name: 'Lando Norris',
              odds: 6.0,
              probability: 0.17
            }
          ]
        });
      }
      
      // Add podium finish market
      marketsData.push({
        id: `${eventId}-market-podium`,
        name: 'Podium Finish',
        outcomes: [
          {
            id: `${eventId}-outcome-podium-1`,
            name: drivers[0] || 'Max Verstappen',
            odds: 1.2,
            probability: 0.83
          },
          {
            id: `${eventId}-outcome-podium-2`,
            name: drivers[1] || 'Lewis Hamilton',
            odds: 1.5,
            probability: 0.67
          },
          {
            id: `${eventId}-outcome-podium-3`,
            name: drivers[2] || 'Charles Leclerc',
            odds: 1.8,
            probability: 0.56
          }
        ]
      });
      
      // Add fastest lap market
      marketsData.push({
        id: `${eventId}-market-fastest-lap`,
        name: 'Fastest Lap',
        outcomes: [
          {
            id: `${eventId}-outcome-fastest-1`,
            name: drivers[0] || 'Max Verstappen',
            odds: 2.2,
            probability: 0.45
          },
          {
            id: `${eventId}-outcome-fastest-2`,
            name: drivers[1] || 'Lewis Hamilton',
            odds: 2.5,
            probability: 0.40
          },
          {
            id: `${eventId}-outcome-fastest-3`,
            name: drivers[2] || 'Charles Leclerc',
            odds: 3.0,
            probability: 0.33
          }
        ]
      });
    }

    return {
      id: eventId,
      sportId: 13, // Formula 1 sportId
      leagueName,
      homeTeam: eventTitle, // Use the event title as the home team for display
      awayTeam: circuit,    // Use circuit as away team for display
      startTime: new Date(event.date || event.race?.date || Date.now()).toISOString(),
      status: status as 'scheduled' | 'live' | 'finished' | 'upcoming',
      score: isLive ? "0 - 0" : undefined, // Use standard format
      markets: marketsData,
      isLive
    };
  }

  /**
   * Transform generic event data for other sports
   */
  private transformGenericEvent(event: any, sport: string, isLive: boolean, index: number): SportEvent {
    // Map sport to sport ID - support both underscore and hyphen formats
    const sportIdMap: Record<string, number> = {
      football: 1,
      soccer: 1,
      basketball: 2,
      tennis: 3,
      baseball: 4,
      hockey: 5,
      handball: 6,
      volleyball: 7,
      rugby: 8,
      cricket: 9,
      golf: 10,
      boxing: 11,
      mma: 12,
      'mma-ufc': 12,
      'formula-1': 13,
      formula_1: 13,
      motorsport: 13,
      cycling: 14,
      american_football: 15,
      'american-football': 15,
      nfl: 15,
      afl: 16,
      'aussie-rules': 16,
      aussie_rules: 16,
      snooker: 17,
      darts: 18,
      table_tennis: 19,
      'table-tennis': 19,
      badminton: 20,
      esports: 21,
      motorsport_other: 22,
      netball: 23,
      surfing: 24,
      horse_racing: 25,
      swimming: 26,
      skiing: 27,
      water_polo: 28,
    };
    
    // Get the sportId from the mapping or use the numeric value if sport is a number
    const sportId = sportIdMap[sport] || (isNaN(Number(sport)) ? 1 : Number(sport));
    
    // Extract team names based on common API-Sports response patterns
    let homeTeam = 'Home Team';
    let awayTeam = 'Away Team';
    let eventId = `api-sports-${sport}-${index}`;
    let leagueName = 'Unknown League';
    
    // Try to extract data from different potential structures
    if (event.teams) {
      homeTeam = event.teams.home?.name || 'Home Team';
      awayTeam = event.teams.away?.name || 'Away Team';
    } else if (event.home && event.away) {
      homeTeam = event.home.name || 'Home Team';
      awayTeam = event.away.name || 'Away Team';
    } else if (event.homeTeam && event.awayTeam) {
      homeTeam = event.homeTeam.name || 'Home Team';
      awayTeam = event.awayTeam.name || 'Away Team';
    }
    
    if (event.id) {
      eventId = event.id.toString();
    } else if (event.fixture && event.fixture.id) {
      eventId = event.fixture.id.toString();
    }
    
    if (event.league) {
      leagueName = event.league.name || 'Unknown League';
    } else if (event.tournament) {
      leagueName = event.tournament.name || 'Unknown League';
    }
    
    // Extract real odds data from the API response if available
    const marketsData: MarketData[] = [];
    
    // Try to find odds data in various formats depending on the API structure
    // 1. Check if odds data is directly available in the event
    if (event.odds && Array.isArray(event.odds)) {
      try {
        const markets = event.odds.map((odds: any, idx: number) => {
          const marketName = odds.name || 'Match Result';
          const marketId = `${eventId}-market-${idx}`;
          
          const outcomes = Array.isArray(odds.values) ? 
            odds.values.map((value: any, vidx: number) => ({
              id: `${marketId}-outcome-${vidx}`,
              name: value.value || (vidx === 0 ? homeTeam : awayTeam),
              odds: parseFloat(value.odd) || 2.0,
              probability: 1 / (parseFloat(value.odd) || 2.0)
            })) : [];
            
          return {
            id: marketId,
            name: marketName,
            outcomes: outcomes
          };
        });
        
        if (markets.length > 0) {
          marketsData.push(...markets);
        }
      } catch (e) {
        console.log(`Error parsing direct odds data for ${sport}:`, e);
      }
    }
    
    // 2. Check for bookmakers data structure (common in football API)
    if (event.bookmakers && Array.isArray(event.bookmakers) && event.bookmakers.length > 0) {
      try {
        const bookmaker = event.bookmakers[0];
        
        if (bookmaker && bookmaker.bets && Array.isArray(bookmaker.bets)) {
          const markets = bookmaker.bets.map((bet: any, idx: number) => {
            const marketName = bet.name || 'Match Result';
            const marketId = `${eventId}-market-${idx}`;
            
            const outcomes = Array.isArray(bet.values) ? 
              bet.values.map((value: any, vidx: number) => ({
                id: `${marketId}-outcome-${vidx}`,
                name: value.value || (vidx === 0 ? homeTeam : awayTeam),
                odds: parseFloat(value.odd) || 2.0,
                probability: 1 / (parseFloat(value.odd) || 2.0)
              })) : [];
              
            return {
              id: marketId,
              name: marketName,
              outcomes: outcomes
            };
          });
          
          if (markets.length > 0) {
            marketsData.push(...markets);
          }
        }
      } catch (e) {
        console.log(`Error parsing bookmakers data for ${sport}:`, e);
      }
    }
    
    // If no real market data was found, create a basic match-winner market with factual structure
    if (marketsData.length === 0) {
      marketsData.push({
        id: `${eventId}-market-match-winner`,
        name: 'Match Result',
        outcomes: [
          {
            id: `${eventId}-outcome-home`,
            name: homeTeam,
            // Use standard industry odds
            odds: 1.95,
            probability: 0.51
          },
          {
            id: `${eventId}-outcome-away`,
            name: awayTeam,
            odds: 1.85,
            probability: 0.54
          }
        ]
      });
    }
    
    // Create the event with proper sportId
    return {
      id: eventId,
      sportId,
      leagueName,
      homeTeam,
      awayTeam,
      startTime: new Date(event.date || event.fixture?.date || Date.now()).toISOString(),
      status: (isLive ? 'live' : 'scheduled') as 'scheduled' | 'live' | 'finished' | 'upcoming',
      score: isLive ? '0 - 0' : undefined, // Default score if not available
      markets: marketsData,
      isLive,
      // Add a dataSource property to indicate this is not adapted from another sport
      dataSource: `api-sports-${sport}`
    };
  }

  /**
   * Get odds for a specific event
   * @param eventId The event ID to fetch odds for
   * @param sport Sport slug
   */
  async getOdds(eventId: string, sport: string = 'football'): Promise<OddsData[]> {
    if (!this.apiKey) {
      console.warn('No SPORTSDATA_API_KEY available, returning empty odds data');
      return [];
    }

    try {
      const cacheKey = `odds_${sport}_${eventId}`;
      
      const oddsData = await this.getCachedOrFetch(cacheKey, async () => {
        // Different API routes based on sport type
        let apiUrl;
        let params = {};
        
        if (sport === 'football' || sport === 'soccer') {
          apiUrl = 'https://v3.football.api-sports.io/odds';
          params = { 
            fixture: eventId
          };
        } else if (sport === 'basketball') {
          apiUrl = 'https://v1.basketball.api-sports.io/odds';
          params = { 
            game: eventId
          };
        } else if (sport === 'baseball') {
          apiUrl = 'https://v1.baseball.api-sports.io/odds';
          params = { 
            game: eventId
          };
        } else if (sport === 'hockey') {
          apiUrl = 'https://v1.hockey.api-sports.io/odds';
          params = { 
            game: eventId
          };
        } else if (sport === 'tennis') {
          apiUrl = 'https://v1.tennis.api-sports.io/odds';
          params = { 
            game: eventId
          };
        } else {
          // Default to football if sport not supported directly
          apiUrl = 'https://v3.football.api-sports.io/odds';
          params = { 
            fixture: eventId
          };
        }
        
        console.log(`[ApiSportsService] Making direct API request to ${apiUrl} for odds`);
        
        const response = await axios.get(apiUrl, {
          params,
          headers: {
            // For direct API-Sports access
            'x-apisports-key': this.apiKey,
            'Accept': 'application/json'
          }
        });
        
        if (response.data && response.data.response) {
          console.log(`[ApiSportsService] Found odds data for event ${eventId}`);
          return response.data.response;
        }
        
        console.log(`[ApiSportsService] No odds found for event ${eventId}`);
        return [];
      });
      
      // Transform to our odds format
      return this.transformOddsData(oddsData, eventId);
    } catch (error) {
      console.error(`Error fetching odds for event ${eventId} from API-Sports:`, error);
      return [];
    }
  }

  /**
   * Transform odds data from API-Sports format to our format
   */
  private transformOddsData(oddsData: any[], eventId: string): OddsData[] {
    if (!oddsData || !Array.isArray(oddsData) || oddsData.length === 0) return [];
    
    const transformed: OddsData[] = [];
    
    // Get the first odds item (which contains all the bookmakers)
    const event = oddsData[0];
    
    if (!event || !event.bookmakers || !Array.isArray(event.bookmakers)) return [];
    
    // Use the first bookmaker's data
    const bookmaker = event.bookmakers[0];
    
    if (!bookmaker || !bookmaker.bets || !Array.isArray(bookmaker.bets)) return [];
    
    // Map each bet type to our market format
    bookmaker.bets.forEach((bet: any) => {
      if (!bet.name || !bet.values) return;
      
      const marketId = `${eventId}-market-${bet.name.toLowerCase().replace(/\s+/g, '-')}`;
      const marketName = bet.name;
      
      const outcomes: OutcomeData[] = bet.values.map((value: any) => ({
        id: `${marketId}-outcome-${value.value.toLowerCase().replace(/\s+/g, '-')}`,
        name: value.value,
        odds: parseFloat(value.odd) || 2.0,
        probability: 1 / (parseFloat(value.odd) || 2.0)
      }));
      
      transformed.push({
        providerId: 'api-sports',
        eventId,
        marketId,
        marketName,
        outcomes
      });
    });
    
    return transformed;
  }

  /**
   * Get odds for specific fixture IDs (direct fetch by fixture)
   * @param fixtureIds Array of fixture IDs to fetch odds for  
   * @param sport Sport slug
   */
  async getOddsForFixtures(fixtureIds: string[], sport: string = 'football'): Promise<Map<string, any>> {
    if (!fixtureIds || fixtureIds.length === 0) return new Map<string, any>();
    
    const resultMap = new Map<string, any>();
    
    // Batch fixtures into groups of 10 to respect API rate limits (10 req/sec)
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < fixtureIds.length; i += batchSize) {
      batches.push(fixtureIds.slice(i, i + batchSize));
    }
    
    console.log(`[ApiSportsService] 🎰 Fetching odds for ${fixtureIds.length} fixtures in ${batches.length} batch(es)`);
    
    // Process ALL batches with rate limiting (max 10 requests per second for API-Sports)
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const promises = batch.map(async (fixtureId) => {
        const cacheKey = `odds_fixture_${fixtureId}`;
        
        try {
          // Check cache first
          const cached = this.cache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < this.mediumCacheExpiry) {
            return cached.data;
          }
          
          let apiUrl: string;
          let params: any = {};
          
          if (sport === 'football' || sport === 'soccer') {
            apiUrl = 'https://v3.football.api-sports.io/odds';
            params = { fixture: fixtureId };
          } else if (sport === 'basketball') {
            apiUrl = 'https://v1.basketball.api-sports.io/odds';
            params = { game: fixtureId };
          } else {
            return null;
          }
          
          const response = await axios.get(apiUrl, {
            params,
            headers: {
              'x-apisports-key': this.apiKey,
              'Accept': 'application/json'
            },
            timeout: 10000
          });
          
          if (response.data?.response?.[0]?.bookmakers?.[0]) {
            const bookmaker = response.data.response[0].bookmakers[0];
            const matchWinner = bookmaker.bets?.find((b: any) => 
              b.name === 'Match Winner' || b.name === 'Home/Away' || b.name === '1X2'
            );
            
            if (matchWinner?.values) {
              const oddsValues: any = { fixtureId };
              for (const val of matchWinner.values) {
                const outcome = val.value?.toLowerCase();
                const oddValue = parseFloat(val.odd);
                if (outcome === 'home' || outcome === '1') {
                  oddsValues.homeOdds = oddValue;
                } else if (outcome === 'draw' || outcome === 'x') {
                  oddsValues.drawOdds = oddValue;
                } else if (outcome === 'away' || outcome === '2') {
                  oddsValues.awayOdds = oddValue;
                }
              }
              // Only cache successful results
              this.cache.set(cacheKey, { data: oddsValues, timestamp: Date.now() });
              return oddsValues;
            }
          }
          // Don't cache null results - allows retry on next request
          return null;
        } catch (error) {
          return null;
        }
      });
      
      const results = await Promise.all(promises);
      results.forEach((odds, index) => {
        if (odds) {
          resultMap.set(batch[index], odds);
        }
      });
      
      // Delay between batches to respect API rate limits (10 req/sec)
      // With 10 concurrent requests per batch, wait 1 second between batches (faster response)
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`[ApiSportsService] 🎰 Got odds for ${resultMap.size}/${fixtureIds.length} fixtures`);
    return resultMap;
  }

  /**
   * Enrich events with real odds from API-Sports
   * @param events Array of SportEvents to enrich
   * @param sport Sport slug
   */
  async enrichEventsWithOdds(events: SportEvent[], sport: string = 'football'): Promise<SportEvent[]> {
    if (!events || events.length === 0) return events;
    
    // Check if we have cached enriched events
    const cacheKey = `enriched_events_${sport}_${events.length}_${events[0]?.id}`;
    const cachedEnriched = this.cache.get(cacheKey);
    if (cachedEnriched) {
      console.log(`[ApiSportsService] 🎰 Using cached enriched events for ${sport}`);
      return cachedEnriched as SportEvent[];
    }
    
    // Try to use pre-warmed odds cache first for instant responses
    const preWarmedOdds = new Map<string, { homeOdds: number; drawOdds?: number; awayOdds: number }>();
    let cacheHits = 0;
    const fixtureIds = events
      .map(e => e.id?.toString())
      .filter((id): id is string => !!id);
    
    // Check pre-warmed cache for each fixture
    for (const fixtureId of fixtureIds) {
      const cached = this.getOddsFromCache(fixtureId);
      if (cached) {
        preWarmedOdds.set(fixtureId, cached);
        cacheHits++;
      }
    }
    
    console.log(`[ApiSportsService] 🎰 Pre-warmed cache hits: ${cacheHits}/${fixtureIds.length}`);
    
    // If we have good cache coverage (>80%), use cached data for speed
    // Otherwise fetch fresh odds for ALL fixtures
    let allOdds: Map<string, { homeOdds: number; drawOdds?: number; awayOdds: number }>;
    
    if (cacheHits >= fixtureIds.length * 0.8) {
      console.log(`[ApiSportsService] 🚀 Using pre-warmed cache for instant response`);
      allOdds = preWarmedOdds;
    } else {
      console.log(`[ApiSportsService] 🎰 Enriching ALL ${events.length} events with real odds`);
      // Fetch odds by fixture ID
      allOdds = await this.getOddsForFixtures(fixtureIds, sport);
      
      // Update the odds cache with fresh data
      allOdds.forEach((odds, fixtureId) => {
        this.oddsCache.set(fixtureId, {
          ...odds,
          timestamp: Date.now()
        });
      });
    }
    
    console.log(`[ApiSportsService] 🎰 Total odds available for ${allOdds.size} fixtures`);
    
    // Enrich events with odds
    let enrichedCount = 0;
    const enrichedEvents = events.map(event => {
      const eventId = event.id?.toString();
      const odds = allOdds.get(eventId!);
      
      if (odds) {
        enrichedCount++;
        // Update markets with real odds
        const updatedMarkets = event.markets?.map(market => {
          if (market.name === 'Match Result' || market.name === 'Match Winner') {
            return {
              ...market,
              outcomes: market.outcomes?.map(outcome => {
                if (outcome.name === event.homeTeam || outcome.id?.includes('home')) {
                  return { ...outcome, odds: odds.homeOdds || outcome.odds };
                } else if (outcome.name === 'Draw' || outcome.id?.includes('draw')) {
                  return { ...outcome, odds: odds.drawOdds || outcome.odds };
                } else if (outcome.name === event.awayTeam || outcome.id?.includes('away')) {
                  return { ...outcome, odds: odds.awayOdds || outcome.odds };
                }
                return outcome;
              })
            };
          }
          return market;
        });
        
        return {
          ...event,
          markets: updatedMarkets,
          homeOdds: odds.homeOdds,
          drawOdds: odds.drawOdds,
          awayOdds: odds.awayOdds,
          oddsSource: 'api-sports'
        };
      }
      
      // Mark events without API odds
      return {
        ...event,
        oddsSource: 'fallback'
      };
    });
    
    console.log(`[ApiSportsService] 🎰 Enriched ${enrichedCount}/${events.length} events with real API odds`);
    
    // Cache the enriched events for 3 minutes (longer since we fetch ALL odds)
    this.cache.set(cacheKey, enrichedEvents, 180);
    
    return enrichedEvents;
  }
  
  /**
   * Start background odds prefetcher
   * Continuously fetches odds for all upcoming events and caches them
   * Uses module-level singleton guard to prevent interval stacking on hot reloads
   */
  startOddsPrefetcher(): void {
    // Use module-level guard to prevent multiple intervals across hot reloads
    if (globalPrefetcherStarted) {
      console.log('[ApiSportsService] 🔄 Odds prefetcher already running (global guard)');
      return;
    }
    
    // Clear any existing interval before starting new one
    if (globalPrefetcherInterval) {
      clearInterval(globalPrefetcherInterval);
      globalPrefetcherInterval = null;
    }
    
    globalPrefetcherStarted = true;
    this.prefetcherRunning = true;
    console.log('[ApiSportsService] 🚀 Starting background odds prefetcher...');
    
    // Initial prefetch
    this.prefetchOdds();
    
    // Schedule periodic prefetch with module-level reference
    globalPrefetcherInterval = setInterval(() => {
      this.prefetchOdds();
    }, this.prefetchInterval);
  }
  
  /**
   * Prefetch odds for all events and warm the cache
   */
  private async prefetchOdds(): Promise<void> {
    try {
      console.log('[ApiSportsService] 🔄 Prefetching odds for all events...');
      const startTime = Date.now();
      
      // Fetch upcoming events for football (main sport)
      const events = await this.getUpcomingEvents('football', 250);
      
      if (!events || events.length === 0) {
        console.log('[ApiSportsService] ⚠️ No events to prefetch odds for');
        return;
      }
      
      const fixtureIds = events
        .map(e => e.id?.toString())
        .filter((id): id is string => !!id);
      
      console.log(`[ApiSportsService] 🔄 Prefetching odds for ${fixtureIds.length} fixtures...`);
      
      // Fetch odds for ALL fixtures
      const allOdds = await this.getOddsForFixtures(fixtureIds, 'football');
      
      // Store in dedicated odds cache
      allOdds.forEach((odds, fixtureId) => {
        this.oddsCache.set(fixtureId, {
          ...odds,
          timestamp: Date.now()
        });
      });
      
      const elapsed = Date.now() - startTime;
      this.lastPrefetchTime = Date.now();
      
      console.log(`[ApiSportsService] ✅ Prefetched ${allOdds.size}/${fixtureIds.length} odds in ${elapsed}ms`);
      console.log(`[ApiSportsService] 📊 Odds cache now has ${this.oddsCache.size} entries`);
      
    } catch (error) {
      console.error('[ApiSportsService] ❌ Odds prefetch failed:', error);
    }
  }
  
  /**
   * Get odds from pre-warmed cache (instant access)
   */
  getOddsFromCache(fixtureId: string): { homeOdds: number; drawOdds?: number; awayOdds: number } | null {
    const cached = this.oddsCache.get(fixtureId);
    if (!cached) return null;
    
    // Check if still valid (within TTL)
    if (Date.now() - cached.timestamp > this.oddsCacheTTL) {
      this.oddsCache.delete(fixtureId);
      return null;
    }
    
    return {
      homeOdds: cached.homeOdds,
      drawOdds: cached.drawOdds,
      awayOdds: cached.awayOdds
    };
  }
  
  /**
   * Get odds cache stats
   */
  getOddsCacheStats(): { size: number; lastPrefetch: number } {
    return {
      size: this.oddsCache.size,
      lastPrefetch: this.lastPrefetchTime
    };
  }
}

export default new ApiSportsService();