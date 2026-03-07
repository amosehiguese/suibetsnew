import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SportEvent, MarketData, OutcomeData } from '../types/betting';

/**
 * FREE SPORTS SERVICE
 * Handles all sports EXCEPT football (which uses paid API)
 * 
 * Strategy:
 * - Fetch upcoming matches ONCE per day (morning 6 AM UTC)
 * - Fetch results ONCE per day (night 11 PM UTC)
 * - No live betting for free sports
 * - Cache data aggressively (24 hours)
 * - ULTRA API SAVING: File-based cache persistence to survive restarts
 */

// Type for finished match results (used for settlement)
export interface FreeSportsResult {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: 'home' | 'away' | 'draw';
  status: string;
}

// Cache file paths for persistence across restarts
const CACHE_DIR = '/tmp';
const CACHE_DATE_FILE = path.join(CACHE_DIR, 'free_sports_cache_date.txt');
const CACHE_DATA_FILE = path.join(CACHE_DIR, 'free_sports_cache_data.json');

// Cached data for free sports
let cachedFreeSportsEvents: SportEvent[] = [];
let lastFetchTime: number = 0;
let lastResultsFetchTime: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours cache

// Per-day locks to prevent duplicate fetches (stores YYYY-MM-DD)
let lastUpcomingFetchDate: string = '';
let lastResultsFetchDate: string = '';

// ULTRA API SAVING: Load cache from file on startup
function loadCacheFromFile(): void {
  try {
    if (fs.existsSync(CACHE_DATE_FILE)) {
      lastUpcomingFetchDate = fs.readFileSync(CACHE_DATE_FILE, 'utf8').trim();
    }
    if (fs.existsSync(CACHE_DATA_FILE)) {
      const data = fs.readFileSync(CACHE_DATA_FILE, 'utf8');
      cachedFreeSportsEvents = JSON.parse(data);
      lastFetchTime = Date.now();
      console.log(`[FreeSports] Loaded ${cachedFreeSportsEvents.length} events from file cache (date: ${lastUpcomingFetchDate})`);
    }
  } catch (err: any) {
    console.warn(`[FreeSports] Could not load cache from file: ${err.message}`);
  }
}

// ULTRA API SAVING: Save cache to file
function saveCacheToFile(): void {
  try {
    fs.writeFileSync(CACHE_DATE_FILE, lastUpcomingFetchDate);
    fs.writeFileSync(CACHE_DATA_FILE, JSON.stringify(cachedFreeSportsEvents));
  } catch (err: any) {
    console.warn(`[FreeSports] Could not save cache to file: ${err.message}`);
  }
}

// Load cache on module init
loadCacheFromFile();

// Helper to get current UTC date string
const getUTCDateString = (): string => new Date().toISOString().split('T')[0];

// Free sports configuration - ALL available API-Sports APIs
const FREE_SPORTS_CONFIG: Record<string, {
  endpoint: string;
  apiHost: string;
  sportId: number;
  name: string;
  hasDraws: boolean;
  daysAhead: number;
}> = {
  basketball: {
    endpoint: 'https://v1.basketball.api-sports.io/games',
    apiHost: 'v1.basketball.api-sports.io',
    sportId: 2,
    name: 'Basketball',
    hasDraws: false,
    daysAhead: 3
  },
  baseball: {
    endpoint: 'https://v1.baseball.api-sports.io/games',
    apiHost: 'v1.baseball.api-sports.io',
    sportId: 5,
    name: 'Baseball',
    hasDraws: false,
    daysAhead: 3
  },
  'ice-hockey': {
    endpoint: 'https://v1.hockey.api-sports.io/games',
    apiHost: 'v1.hockey.api-sports.io',
    sportId: 6,
    name: 'Ice Hockey',
    hasDraws: false,
    daysAhead: 3
  },
  mma: {
    endpoint: 'https://v1.mma.api-sports.io/fights',
    apiHost: 'v1.mma.api-sports.io',
    sportId: 7,
    name: 'MMA',
    hasDraws: false,
    daysAhead: 3
  },
  'american-football': {
    endpoint: 'https://v1.american-football.api-sports.io/games',
    apiHost: 'v1.american-football.api-sports.io',
    sportId: 4,
    name: 'American Football',
    hasDraws: false,
    daysAhead: 3
  },
  afl: {
    endpoint: 'https://v1.afl.api-sports.io/games',
    apiHost: 'v1.afl.api-sports.io',
    sportId: 10,
    name: 'AFL',
    hasDraws: true,
    daysAhead: 3
  },
  'formula-1': {
    endpoint: 'https://v1.formula-1.api-sports.io/races',
    apiHost: 'v1.formula-1.api-sports.io',
    sportId: 11,
    name: 'Formula 1',
    hasDraws: false,
    daysAhead: 3
  },
  handball: {
    endpoint: 'https://v1.handball.api-sports.io/games',
    apiHost: 'v1.handball.api-sports.io',
    sportId: 12,
    name: 'Handball',
    hasDraws: true,
    daysAhead: 3
  },
  rugby: {
    endpoint: 'https://v1.rugby.api-sports.io/games',
    apiHost: 'v1.rugby.api-sports.io',
    sportId: 15,
    name: 'Rugby',
    hasDraws: true,
    daysAhead: 3
  },
  volleyball: {
    endpoint: 'https://v1.volleyball.api-sports.io/games',
    apiHost: 'v1.volleyball.api-sports.io',
    sportId: 16,
    name: 'Volleyball',
    hasDraws: false,
    daysAhead: 3
  },
};

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const CRICBUZZ_BASE_URL = 'https://free-cricbuzz-cricket-api.p.rapidapi.com';
const CRICKET_SPORT_ID = 9;

const MMA_ORGANIZATIONS = new Set([
  'ufc', 'bellator', 'one championship', 'one fc', 'pfl', 'cage warriors',
  'ksw', 'rizin', 'invicta', 'lfa', 'bkfc', 'eagle fc', 'ares', 'oktagon'
]);

function isBoxingFight(game: any): boolean {
  const slug = (game.slug || '').toLowerCase();
  const category = (game.category || '').toLowerCase();
  
  if (slug.includes('boxing') || slug.includes('pbc') || slug.includes('showtime') ||
      slug.includes('dazn boxing') || slug.includes('top rank') || slug.includes('golden boy') ||
      slug.includes('matchroom') || slug.includes('wbc') || slug.includes('wba') ||
      slug.includes('ibf') || slug.includes('wbo') || slug.includes('ring magazine')) {
    return true;
  }
  
  for (const org of MMA_ORGANIZATIONS) {
    if (slug.includes(org)) return false;
  }
  
  if (category.includes('boxing') || category.includes('heavyweight') && !slug.includes('ufc') && !slug.includes('mma')) {
    return true;
  }
  
  return false;
}

// API key
const API_KEY = process.env.API_SPORTS_KEY || '';

export class FreeSportsService {
  private isRunning: boolean = false;
  private morningSchedulerInterval: NodeJS.Timeout | null = null;
  private nightSchedulerInterval: NodeJS.Timeout | null = null;

  /**
   * Start the daily schedulers
   * - Morning (6 AM UTC): Fetch upcoming matches
   * - Night (11 PM UTC): Fetch results for settlement
   */
  startSchedulers(): void {
    if (this.isRunning) {
      console.log('[FreeSports] Schedulers already running');
      return;
    }

    this.isRunning = true;
    console.log('[FreeSports] Starting daily schedulers for free sports');
    console.log('[FreeSports] Sports: basketball, baseball, ice-hockey, mma, american-football, afl, formula-1, handball, rugby, volleyball, cricket');
    console.log('[FreeSports] Schedule: Upcoming 6AM UTC, Results 11PM UTC');

    // STRICT DAILY SCHEDULE: Only fetch if not already done today
    const today = getUTCDateString();
    
    // Initial fetch on startup if: haven't fetched today OR cache is empty (failed previous fetch)
    if (lastUpcomingFetchDate !== today || cachedFreeSportsEvents.length === 0) {
      console.log(`[FreeSports] Initial fetch of upcoming matches (date: ${lastUpcomingFetchDate}, cache: ${cachedFreeSportsEvents.length} events)...`);
      this.fetchAllUpcomingMatches().catch(err => {
        console.error('[FreeSports] Initial fetch failed:', err.message);
      });
    } else {
      console.log(`[FreeSports] Using cached data - ${cachedFreeSportsEvents.length} events (fetched: ${lastUpcomingFetchDate})`);
    }

    // Check every hour if we should fetch - STRICT: only at 6 AM UTC, once per day
    this.morningSchedulerInterval = setInterval(() => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const todayStr = getUTCDateString();
      
      // STRICT: Only fetch at 6 AM UTC AND only if we haven't fetched today
      if (utcHour === 6 && lastUpcomingFetchDate !== todayStr) {
        console.log('[FreeSports] Morning fetch triggered (6 AM UTC)');
        this.fetchAllUpcomingMatches().catch(err => {
          console.error('[FreeSports] Morning fetch failed:', err.message);
        });
      }
    }, 60 * 60 * 1000); // Check every hour

    // Check every hour if we should fetch results - STRICT: only at 11 PM UTC, once per day
    this.nightSchedulerInterval = setInterval(() => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const todayStr = getUTCDateString();
      
      // STRICT: Only fetch at 11 PM UTC AND only if we haven't fetched today
      if (utcHour === 23 && lastResultsFetchDate !== todayStr) {
        console.log('[FreeSports] Night results fetch triggered (11 PM UTC)');
        this.fetchAllResults().catch(err => {
          console.error('[FreeSports] Night results fetch failed:', err.message);
        });
      }
    }, 60 * 60 * 1000); // Check every hour

    console.log('[FreeSports] ✅ Daily schedulers started');
  }

  /**
   * Stop the schedulers
   */
  stopSchedulers(): void {
    if (this.morningSchedulerInterval) {
      clearInterval(this.morningSchedulerInterval);
      this.morningSchedulerInterval = null;
    }
    if (this.nightSchedulerInterval) {
      clearInterval(this.nightSchedulerInterval);
      this.nightSchedulerInterval = null;
    }
    this.isRunning = false;
    console.log('[FreeSports] Schedulers stopped');
  }

  /**
   * Fetch upcoming matches for all free sports
   */
  async fetchAllUpcomingMatches(): Promise<SportEvent[]> {
    console.log('[FreeSports] 📅 Fetching upcoming matches for all free sports...');
    
    const allEvents: SportEvent[] = [];

    for (const [sportSlug, config] of Object.entries(FREE_SPORTS_CONFIG)) {
      try {
        let sportEvents: SportEvent[] = [];
        const daysToFetch = config.daysAhead || 2;
        let sportRateLimited = false;
        
        for (let dayOffset = 0; dayOffset < daysToFetch; dayOffset++) {
          if (sportRateLimited) break;
          
          const fetchDate = new Date();
          fetchDate.setUTCDate(fetchDate.getUTCDate() + dayOffset);
          
          try {
            const dayEvents = await this.fetchUpcomingForSingleDate(sportSlug, config, fetchDate);
            sportEvents.push(...dayEvents);
          } catch (dayErr: any) {
            if (dayErr.response?.status === 429) {
              console.warn(`[FreeSports] Rate limited for ${config.name} day+${dayOffset}, skipping remaining days for this sport`);
              sportRateLimited = true;
              break;
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        const seenIds = new Set<string>();
        sportEvents = sportEvents.filter(e => {
          const id = String(e.id);
          if (seenIds.has(id)) return false;
          seenIds.add(id);
          return true;
        });
        
        if (sportSlug === 'mma') {
          const mmaCount = sportEvents.filter(e => e.sportId === 7).length;
          const boxingCount = sportEvents.filter(e => e.sportId === 17).length;
          if (boxingCount > 0) {
            console.log(`[FreeSports] MMA: ${mmaCount} fights, Boxing: ${boxingCount} fights (${daysToFetch} days)`);
          } else {
            console.log(`[FreeSports] ${config.name}: ${sportEvents.length} upcoming matches (${daysToFetch} days)`);
          }
        } else {
          console.log(`[FreeSports] ${config.name}: ${sportEvents.length} upcoming matches (${daysToFetch} days)`);
        }
        allEvents.push(...sportEvents);
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[FreeSports] Error fetching ${config.name}:`, error.message);
      }
    }

    try {
      const cricketEvents = await this.fetchCricketMatches();
      if (cricketEvents.length > 0) {
        allEvents.push(...cricketEvents);
      }
    } catch (error: any) {
      console.error(`[FreeSports] Cricket fetch error:`, error.message);
    }

    try {
      const scheduledEvents = this.getScheduledCombatAndMotorsportEvents();
      if (scheduledEvents.length > 0) {
        const existingIds = new Set(allEvents.map(e => String(e.id)));
        const newEvents = scheduledEvents.filter(e => !existingIds.has(String(e.id)));
        allEvents.push(...newEvents);
        console.log(`[FreeSports] 🥊🏎️ Added ${newEvents.length} scheduled Boxing/F1/MMA events (${scheduledEvents.length} total, ${scheduledEvents.length - newEvents.length} dupes skipped)`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] Scheduled events error:`, error.message);
    }

    if (allEvents.length > 0) {
      cachedFreeSportsEvents = allEvents;
      lastFetchTime = Date.now();
      lastUpcomingFetchDate = getUTCDateString();
      saveCacheToFile();
      console.log(`[FreeSports] ✅ Total: ${allEvents.length} upcoming matches cached (locked until ${lastUpcomingFetchDate})`);
    } else {
      console.warn(`[FreeSports] ⚠️ Got 0 events - likely API rate limit. NOT overwriting cache. Will retry on next restart.`);
    }
    return allEvents;
  }

  private async fetchUpcomingForSingleDate(
    sportSlug: string, 
    config: typeof FREE_SPORTS_CONFIG[string],
    fetchDate: Date
  ): Promise<SportEvent[]> {
    const dateStr = fetchDate.toISOString().split('T')[0];
    
    try {
      const response = await axios.get(config.endpoint, {
        params: {
          date: dateStr,
          timezone: 'UTC'
        },
        headers: {
          'x-apisports-key': API_KEY,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      if (response.data?.errors && Object.keys(response.data.errors).length > 0) {
        const errorMsg = JSON.stringify(response.data.errors);
        console.warn(`[FreeSports] API error for ${config.name} (${dateStr}): ${errorMsg}`);
        
        if (response.data.errors.requests && String(response.data.errors.requests).includes('request limit')) {
          const err: any = new Error('API rate limit reached');
          err.response = { status: 429 };
          throw err;
        }
        if (response.data.errors.plan && String(response.data.errors.plan).includes('Free plans')) {
          const err: any = new Error('Free plan date/season restriction');
          err.response = { status: 429 };
          throw err;
        }
        return [];
      }

      const games = response.data?.response || [];
      
      return games.map((game: any) => this.transformToSportEvent(game, sportSlug, config)).flat().filter(Boolean) as SportEvent[];
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn(`[FreeSports] Rate limited for ${config.name}, skipping`);
      } else if (error.code === 'ENOTFOUND') {
        console.warn(`[FreeSports] DNS error for ${config.name} (${config.endpoint}) - API host does not exist, skipping`);
        return [];
      }
      throw error;
    }
  }

  /**
   * Transform API response to SportEvent
   */
  private transformToSportEvent(
    game: any, 
    sportSlug: string, 
    config: typeof FREE_SPORTS_CONFIG[string]
  ): SportEvent | SportEvent[] | null {
    try {
      const gameId = String(game.id);
      let homeTeam: string;
      let awayTeam: string;
      
      if (sportSlug === 'mma' || sportSlug === 'boxing') {
        homeTeam = game.fighters?.first?.name || game.fighters?.home?.name || game.home?.name || 'Fighter 1';
        awayTeam = game.fighters?.second?.name || game.fighters?.away?.name || game.away?.name || 'Fighter 2';
      } else if (sportSlug === 'tennis') {
        homeTeam = game.players?.home?.name || game.teams?.home?.name || game.home?.name || 'Player 1';
        awayTeam = game.players?.away?.name || game.teams?.away?.name || game.away?.name || 'Player 2';
      } else if (sportSlug === 'formula-1') {
        const gpName = game.competition?.name || game.circuit?.name || game.name || 'Grand Prix';
        const startTime = game.date || (game.timestamp ? new Date(game.timestamp * 1000).toISOString() : new Date().toISOString());
        return this.generateF1DriverMatchups(gameId, gpName, startTime, config.sportId);
      } else {
        homeTeam = game.teams?.home?.name || game.home?.name || 'Home Team';
        awayTeam = game.teams?.away?.name || game.away?.name || 'Away Team';
      }
      
      const league = game.league?.name || game.competition?.name || 'Unknown League';
      const startTime = game.date ? game.date : (game.timestamp ? new Date(game.timestamp * 1000).toISOString() : new Date().toISOString());

      // Generate basic odds (will be updated when API provides real odds)
      const homeOdds = 1.8 + Math.random() * 0.5;
      const awayOdds = 1.8 + Math.random() * 0.5;

      const outcomes: OutcomeData[] = [
        { id: 'home', name: homeTeam, odds: parseFloat(homeOdds.toFixed(2)), probability: 1 / homeOdds },
        { id: 'away', name: awayTeam, odds: parseFloat(awayOdds.toFixed(2)), probability: 1 / awayOdds }
      ];

      const markets: MarketData[] = [
        {
          id: 'winner',
          name: 'Match Winner',
          outcomes
        }
      ];

      let finalSportId = config.sportId;
      let finalSlug = sportSlug;
      
      if (sportSlug === 'mma' && isBoxingFight(game)) {
        finalSportId = 17;
        finalSlug = 'boxing';
      }

      return {
        id: `${finalSlug}_${gameId}`,
        sportId: finalSportId,
        leagueName: league,
        homeTeam,
        awayTeam,
        startTime,
        status: 'scheduled',
        isLive: false,
        markets,
        homeOdds: parseFloat(homeOdds.toFixed(2)),
        awayOdds: parseFloat(awayOdds.toFixed(2)),
        drawOdds: config.hasDraws ? parseFloat((2.5 + Math.random() * 0.5).toFixed(2)) : undefined
      };
    } catch (error) {
      console.error('[FreeSports] Error transforming game:', error);
      return null;
    }
  }

  /**
   * Fetch results for settlement - includes team names for matching
   */
  async fetchAllResults(): Promise<FreeSportsResult[]> {
    console.log('[FreeSports] 🌙 Fetching results for settlement...');
    
    const results: FreeSportsResult[] = [];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    for (const [sportSlug, config] of Object.entries(FREE_SPORTS_CONFIG)) {
      try {
        const response = await axios.get(config.endpoint, {
          params: {
            date: dateStr,
            timezone: 'UTC'
          },
          headers: {
            'x-apisports-key': API_KEY,
            'Accept': 'application/json'
          },
          timeout: 10000
        });

        const games = response.data?.response || [];
        
        for (const game of games) {
          const status = game.status?.long || game.status?.short || '';
          const isFinished = status.toLowerCase().includes('finished') || 
                            status.toLowerCase().includes('final') ||
                            status === 'FT' || status === 'AET' || status === 'PEN';
          
          if (isFinished) {
            // Extract team names based on sport API structure
            let homeTeam = '';
            let awayTeam = '';
            
            if (sportSlug === 'mma' || sportSlug === 'boxing') {
              homeTeam = game.fighters?.home?.name || game.fighters?.first?.name || game.home?.name || 'Fighter 1';
              awayTeam = game.fighters?.away?.name || game.fighters?.second?.name || game.away?.name || 'Fighter 2';
            } else if (sportSlug === 'tennis') {
              homeTeam = game.players?.home?.name || game.teams?.home?.name || game.home?.name || 'Player 1';
              awayTeam = game.players?.away?.name || game.teams?.away?.name || game.away?.name || 'Player 2';
            } else {
              homeTeam = game.teams?.home?.name || game.home?.name || 'Home';
              awayTeam = game.teams?.away?.name || game.away?.name || 'Away';
            }
            
            const homeScore = game.scores?.home?.total ?? game.scores?.home ?? 0;
            const awayScore = game.scores?.away?.total ?? game.scores?.away ?? 0;
            
            results.push({
              eventId: `${sportSlug}_${game.id}`,
              homeTeam,
              awayTeam,
              homeScore: typeof homeScore === 'number' ? homeScore : parseInt(homeScore) || 0,
              awayScore: typeof awayScore === 'number' ? awayScore : parseInt(awayScore) || 0,
              winner: homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw',
              status: 'finished'
            });
          }
        }
        
        console.log(`[FreeSports] ${config.name}: ${results.length} finished games`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.error(`[FreeSports] Error fetching results for ${config.name}:`, error.message);
      }
    }

    try {
      const cricketResults = await this.fetchCricketResults();
      results.push(...cricketResults);
    } catch (error: any) {
      console.error(`[FreeSports] Cricket results fetch error:`, error.message);
    }

    lastResultsFetchTime = Date.now();
    lastResultsFetchDate = getUTCDateString();
    console.log(`[FreeSports] ✅ Total: ${results.length} finished games for settlement (locked until ${lastResultsFetchDate})`);
    
    if (results.length > 0) {
      this.triggerSettlement(results);
    }
    
    return results;
  }
  
  /**
   * Trigger settlement worker to process free sports results
   */
  private async triggerSettlement(results: FreeSportsResult[]): Promise<void> {
    try {
      // Import settlement worker dynamically to avoid circular dependencies
      const { settlementWorker } = await import('./settlementWorker');
      
      console.log(`[FreeSports] 🎯 Triggering settlement for ${results.length} finished matches...`);
      await settlementWorker.processFreeSportsResults(results);
      console.log(`[FreeSports] ✅ Settlement triggered successfully`);
    } catch (error: any) {
      console.error(`[FreeSports] ❌ Failed to trigger settlement:`, error.message);
    }
  }

  private generateF1DriverMatchups(raceId: string, gpName: string, startTime: string, sportId: number): SportEvent[] {
    const f1Drivers = [
      'Max Verstappen', 'Liam Lawson', 'Charles Leclerc', 'Lewis Hamilton',
      'Lando Norris', 'Oscar Piastri', 'George Russell', 'Andrea Kimi Antonelli',
      'Fernando Alonso', 'Lance Stroll', 'Pierre Gasly', 'Jack Doohan',
      'Carlos Sainz', 'Alex Albon', 'Yuki Tsunoda', 'Isack Hadjar',
      'Nico Hülkenberg', 'Gabriel Bortoleto', 'Esteban Ocon', 'Oliver Bearman'
    ];
    const h2hPairs: [number, number][] = [
      [0, 3], [2, 4], [5, 6], [12, 8], [1, 7]
    ];
    return h2hPairs.map((pair, idx) => {
      const [a, b] = pair;
      const hOdds = parseFloat((1.7 + Math.random() * 0.6).toFixed(2));
      const aOdds = parseFloat((1.7 + Math.random() * 0.6).toFixed(2));
      return {
        id: `formula-1_${raceId}_h2h_${idx}`,
        sportId,
        leagueName: `F1 ${gpName} - Driver H2H`,
        homeTeam: f1Drivers[a],
        awayTeam: f1Drivers[b],
        startTime,
        status: 'scheduled',
        isLive: false,
        markets: [{
          id: 'winner',
          name: 'Driver H2H',
          outcomes: [
            { id: 'home', name: f1Drivers[a], odds: hOdds, probability: 1 / hOdds },
            { id: 'away', name: f1Drivers[b], odds: aOdds, probability: 1 / aOdds }
          ]
        }],
        homeOdds: hOdds,
        awayOdds: aOdds,
      } as SportEvent;
    });
  }

  private getScheduledCombatAndMotorsportEvents(): SportEvent[] {
    const now = Date.now();
    const events: SportEvent[] = [];

    const scheduledEvents = [
      { id: 'boxing_20260305_1', sportId: 17, league: 'DAZN Boxing', home: 'Steven Butler', away: 'Ramadan Hiseni', date: '2026-03-05T23:00:00Z', venue: 'Montreal, Canada', slug: 'boxing' },
      { id: 'boxing_20260305_2', sportId: 17, league: 'DAZN Boxing', home: 'Lenar Perez', away: 'Isaac Chilemba', date: '2026-03-05T23:30:00Z', venue: 'Montreal, Canada', slug: 'boxing' },
      { id: 'boxing_20260305_3', sportId: 17, league: 'DAZN Boxing', home: 'Jhon Orobio', away: 'Yomar Alamo', date: '2026-03-06T00:00:00Z', venue: 'Montreal, Canada', slug: 'boxing' },
      { id: 'boxing_20260305_4', sportId: 17, league: 'DAZN Boxing', home: 'Steve Claggett', away: 'TBA', date: '2026-03-06T00:30:00Z', venue: 'Montreal, Canada', slug: 'boxing' },
      { id: 'boxing_20260308_1', sportId: 17, league: 'Paramount+ Boxing', home: 'Jai Opetaia', away: 'Brandon Glanton', date: '2026-03-08T22:00:00Z', venue: 'Las Vegas, NV, USA', slug: 'boxing' },
      { id: 'boxing_20260314_1', sportId: 17, league: 'DAZN Boxing - Dublin', home: 'Jazza Dickens', away: 'Anthony Cacace', date: '2026-03-14T20:00:00Z', venue: 'Dublin, Ireland', slug: 'boxing' },
      { id: 'boxing_20260314_2', sportId: 17, league: 'DAZN Boxing - Dublin', home: "Pierce O'Leary", away: 'Mark Chamberlain', date: '2026-03-14T21:00:00Z', venue: 'Dublin, Ireland', slug: 'boxing' },
      { id: 'boxing_20260314_3', sportId: 17, league: 'DAZN Boxing - Dublin', home: 'Jono Carroll', away: 'Colm Murphy', date: '2026-03-14T19:00:00Z', venue: 'Dublin, Ireland', slug: 'boxing' },
      { id: 'boxing_20260919_1', sportId: 17, league: 'Sphere Arena - Super Fight', home: 'Floyd Mayweather Jr.', away: 'Manny Pacquiao', date: '2026-09-19T23:00:00Z', venue: 'Las Vegas, NV, USA', slug: 'boxing' },

      { id: 'f1_2026_r02_h2h_1', sportId: 11, league: 'F1 Chinese GP - Driver H2H', home: 'Max Verstappen', away: 'Lewis Hamilton', date: '2026-03-15T07:00:00Z', venue: 'Shanghai, China', slug: 'formula-1' },
      { id: 'f1_2026_r02_h2h_2', sportId: 11, league: 'F1 Chinese GP - Driver H2H', home: 'Charles Leclerc', away: 'Lando Norris', date: '2026-03-15T07:00:00Z', venue: 'Shanghai, China', slug: 'formula-1' },
      { id: 'f1_2026_r02_h2h_3', sportId: 11, league: 'F1 Chinese GP - Driver H2H', home: 'Oscar Piastri', away: 'George Russell', date: '2026-03-15T07:00:00Z', venue: 'Shanghai, China', slug: 'formula-1' },
      { id: 'f1_2026_r02_h2h_4', sportId: 11, league: 'F1 Chinese GP - Driver H2H', home: 'Carlos Sainz', away: 'Fernando Alonso', date: '2026-03-15T07:00:00Z', venue: 'Shanghai, China', slug: 'formula-1' },
      { id: 'f1_2026_r02_h2h_5', sportId: 11, league: 'F1 Chinese GP - Driver H2H', home: 'Liam Lawson', away: 'Andrea Kimi Antonelli', date: '2026-03-15T07:00:00Z', venue: 'Shanghai, China', slug: 'formula-1' },

      { id: 'f1_2026_r03_h2h_1', sportId: 11, league: 'F1 Japanese GP - Driver H2H', home: 'Max Verstappen', away: 'Charles Leclerc', date: '2026-03-29T05:00:00Z', venue: 'Suzuka, Japan', slug: 'formula-1' },
      { id: 'f1_2026_r03_h2h_2', sportId: 11, league: 'F1 Japanese GP - Driver H2H', home: 'Lewis Hamilton', away: 'Lando Norris', date: '2026-03-29T05:00:00Z', venue: 'Suzuka, Japan', slug: 'formula-1' },
      { id: 'f1_2026_r03_h2h_3', sportId: 11, league: 'F1 Japanese GP - Driver H2H', home: 'Oscar Piastri', away: 'Carlos Sainz', date: '2026-03-29T05:00:00Z', venue: 'Suzuka, Japan', slug: 'formula-1' },
      { id: 'f1_2026_r03_h2h_4', sportId: 11, league: 'F1 Japanese GP - Driver H2H', home: 'George Russell', away: 'Fernando Alonso', date: '2026-03-29T05:00:00Z', venue: 'Suzuka, Japan', slug: 'formula-1' },
      { id: 'f1_2026_r03_h2h_5', sportId: 11, league: 'F1 Japanese GP - Driver H2H', home: 'Alex Albon', away: 'Pierre Gasly', date: '2026-03-29T05:00:00Z', venue: 'Suzuka, Japan', slug: 'formula-1' },

      { id: 'f1_2026_r04_h2h_1', sportId: 11, league: 'F1 Bahrain GP - Driver H2H', home: 'Max Verstappen', away: 'Lando Norris', date: '2026-04-12T15:00:00Z', venue: 'Sakhir, Bahrain', slug: 'formula-1' },
      { id: 'f1_2026_r04_h2h_2', sportId: 11, league: 'F1 Bahrain GP - Driver H2H', home: 'Lewis Hamilton', away: 'Charles Leclerc', date: '2026-04-12T15:00:00Z', venue: 'Sakhir, Bahrain', slug: 'formula-1' },
      { id: 'f1_2026_r04_h2h_3', sportId: 11, league: 'F1 Bahrain GP - Driver H2H', home: 'Oscar Piastri', away: 'George Russell', date: '2026-04-12T15:00:00Z', venue: 'Sakhir, Bahrain', slug: 'formula-1' },
      { id: 'f1_2026_r04_h2h_4', sportId: 11, league: 'F1 Bahrain GP - Driver H2H', home: 'Carlos Sainz', away: 'Liam Lawson', date: '2026-04-12T15:00:00Z', venue: 'Sakhir, Bahrain', slug: 'formula-1' },
      { id: 'f1_2026_r04_h2h_5', sportId: 11, league: 'F1 Bahrain GP - Driver H2H', home: 'Fernando Alonso', away: 'Nico Hülkenberg', date: '2026-04-12T15:00:00Z', venue: 'Sakhir, Bahrain', slug: 'formula-1' },

      { id: 'f1_2026_r05_h2h_1', sportId: 11, league: 'F1 Saudi Arabian GP - Driver H2H', home: 'Max Verstappen', away: 'Oscar Piastri', date: '2026-04-19T17:00:00Z', venue: 'Jeddah, Saudi Arabia', slug: 'formula-1' },
      { id: 'f1_2026_r05_h2h_2', sportId: 11, league: 'F1 Saudi Arabian GP - Driver H2H', home: 'Charles Leclerc', away: 'George Russell', date: '2026-04-19T17:00:00Z', venue: 'Jeddah, Saudi Arabia', slug: 'formula-1' },
      { id: 'f1_2026_r05_h2h_3', sportId: 11, league: 'F1 Saudi Arabian GP - Driver H2H', home: 'Lewis Hamilton', away: 'Lando Norris', date: '2026-04-19T17:00:00Z', venue: 'Jeddah, Saudi Arabia', slug: 'formula-1' },
      { id: 'f1_2026_r05_h2h_4', sportId: 11, league: 'F1 Saudi Arabian GP - Driver H2H', home: 'Andrea Kimi Antonelli', away: 'Oliver Bearman', date: '2026-04-19T17:00:00Z', venue: 'Jeddah, Saudi Arabia', slug: 'formula-1' },

      { id: 'f1_2026_r06_h2h_1', sportId: 11, league: 'F1 Miami GP - Driver H2H', home: 'Max Verstappen', away: 'Lewis Hamilton', date: '2026-05-03T19:00:00Z', venue: 'Miami, FL, USA', slug: 'formula-1' },
      { id: 'f1_2026_r06_h2h_2', sportId: 11, league: 'F1 Miami GP - Driver H2H', home: 'Lando Norris', away: 'Charles Leclerc', date: '2026-05-03T19:00:00Z', venue: 'Miami, FL, USA', slug: 'formula-1' },
      { id: 'f1_2026_r06_h2h_3', sportId: 11, league: 'F1 Miami GP - Driver H2H', home: 'Oscar Piastri', away: 'Carlos Sainz', date: '2026-05-03T19:00:00Z', venue: 'Miami, FL, USA', slug: 'formula-1' },
      { id: 'f1_2026_r06_h2h_4', sportId: 11, league: 'F1 Miami GP - Driver H2H', home: 'George Russell', away: 'Fernando Alonso', date: '2026-05-03T19:00:00Z', venue: 'Miami, FL, USA', slug: 'formula-1' },

      { id: 'mma_20260308_1', sportId: 7, league: 'UFC Fight Night', home: 'TBA', away: 'TBA', date: '2026-03-08T23:00:00Z', venue: 'Las Vegas, NV, USA', slug: 'mma' },
    ];

    for (const ev of scheduledEvents) {
      const startMs = new Date(ev.date).getTime();
      if (startMs < now) continue;

      const homeOdds = parseFloat((1.7 + Math.random() * 0.6).toFixed(2));
      const awayOdds = parseFloat((1.7 + Math.random() * 0.6).toFixed(2));

      const outcomes: OutcomeData[] = [
        { id: 'home', name: ev.home, odds: homeOdds, probability: 1 / homeOdds },
        { id: 'away', name: ev.away, odds: awayOdds, probability: 1 / awayOdds }
      ];

      const isF1 = ev.slug === 'formula-1';
      const markets: MarketData[] = [
        { id: 'winner', name: isF1 ? 'Driver H2H' : 'Match Winner', outcomes }
      ];

      events.push({
        id: `${ev.slug}_${ev.id}`,
        sportId: ev.sportId,
        leagueName: ev.league,
        homeTeam: ev.home,
        awayTeam: ev.away,
        startTime: ev.date,
        status: 'scheduled',
        isLive: false,
        markets,
        homeOdds,
        awayOdds,
        venue: ev.venue,
      } as SportEvent);
    }

    return events;
  }

  private async fetchCricketMatches(): Promise<SportEvent[]> {
    if (!RAPIDAPI_KEY) {
      console.warn('[FreeSports] No RAPIDAPI_KEY set, skipping cricket');
      return [];
    }

    try {
      console.log('[FreeSports] 🏏 Fetching cricket schedule from Cricbuzz API...');
      const response = await axios.get(`${CRICBUZZ_BASE_URL}/cricket-schedule`, {
        headers: {
          'x-rapidapi-host': 'free-cricbuzz-cricket-api.p.rapidapi.com',
          'x-rapidapi-key': RAPIDAPI_KEY,
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const schedules = response.data?.response?.schedules || [];
      const events: SportEvent[] = [];
      const now = Date.now();
      const seenMatchIds = new Set<number>();

      for (const schedule of schedules) {
        const wrapper = schedule.scheduleAdWrapper || schedule;
        const matchList = wrapper.matchScheduleList || [];

        for (const series of matchList) {
          const seriesName = series.seriesName || 'Cricket Match';
          const matches = series.matchInfo || [];

          for (const match of matches) {
            if (!match.matchId || !match.team1 || !match.team2) continue;
            if (seenMatchIds.has(match.matchId)) continue;
            seenMatchIds.add(match.matchId);

            let startMs = parseInt(match.startDate, 10);
            if (isNaN(startMs)) continue;
            if (startMs < 1e12) startMs *= 1000;
            if (startMs < now) continue;

            const homeTeam = match.team1.teamName || match.team1.teamSName || 'Team 1';
            const awayTeam = match.team2.teamName || match.team2.teamSName || 'Team 2';
            const format = match.matchFormat || 'T20';
            const venue = match.venueInfo ? `${match.venueInfo.ground || ''}, ${match.venueInfo.city || ''}` : '';

            const homeOdds = parseFloat((1.7 + Math.random() * 0.6).toFixed(2));
            const awayOdds = parseFloat((1.7 + Math.random() * 0.6).toFixed(2));
            const drawOdds = format === 'TEST' ? parseFloat((3.0 + Math.random() * 1.0).toFixed(2)) : undefined;

            const outcomes: OutcomeData[] = [
              { id: 'home', name: homeTeam, odds: homeOdds, probability: 1 / homeOdds },
              { id: 'away', name: awayTeam, odds: awayOdds, probability: 1 / awayOdds }
            ];

            if (drawOdds) {
              outcomes.push({ id: 'draw', name: 'Draw', odds: drawOdds, probability: 1 / drawOdds });
            }

            const markets: MarketData[] = [
              { id: 'winner', name: 'Match Winner', outcomes }
            ];

            events.push({
              id: `cricket_${match.matchId}`,
              sportId: CRICKET_SPORT_ID,
              leagueName: `${seriesName} (${format})`,
              homeTeam,
              awayTeam,
              startTime: new Date(startMs).toISOString(),
              status: 'scheduled',
              isLive: false,
              markets,
              homeOdds,
              awayOdds,
              drawOdds,
              venue,
              format,
            } as SportEvent);
          }
        }
      }

      console.log(`[FreeSports] 🏏 Cricket: ${events.length} upcoming matches fetched`);
      return events;
    } catch (error: any) {
      console.error(`[FreeSports] 🏏 Cricket fetch error: ${error.message}`);
      return [];
    }
  }

  private async fetchCricketResults(): Promise<FreeSportsResult[]> {
    if (!RAPIDAPI_KEY) return [];

    try {
      console.log('[FreeSports] 🏏 Fetching cricket match results...');
      const response = await axios.get(`${CRICBUZZ_BASE_URL}/cricket-schedule`, {
        headers: {
          'x-rapidapi-host': 'free-cricbuzz-cricket-api.p.rapidapi.com',
          'x-rapidapi-key': RAPIDAPI_KEY,
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const schedules = response.data?.response?.schedules || [];
      const results: FreeSportsResult[] = [];
      const now = Date.now();
      const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);
      let apiCallCount = 0;
      const MAX_RESULT_API_CALLS = 5;

      for (const schedule of schedules) {
        if (apiCallCount >= MAX_RESULT_API_CALLS) break;
        const wrapper = schedule.scheduleAdWrapper || schedule;
        const matchList = wrapper.matchScheduleList || [];

        for (const series of matchList) {
          if (apiCallCount >= MAX_RESULT_API_CALLS) break;
          const matches = series.matchInfo || [];
          for (const match of matches) {
            if (apiCallCount >= MAX_RESULT_API_CALLS) break;
            if (!match.matchId || !match.team1 || !match.team2) continue;

            let endMs = parseInt(match.endDate, 10);
            if (isNaN(endMs)) continue;
            if (endMs < 1e12) endMs *= 1000;
            if (endMs > now || endMs < twoDaysAgo) continue;

            apiCallCount++;
            const matchInfoResp = await axios.get(`${CRICBUZZ_BASE_URL}/cricket-match-info`, {
              params: { matchid: match.matchId },
              headers: {
                'x-rapidapi-host': 'free-cricbuzz-cricket-api.p.rapidapi.com',
                'x-rapidapi-key': RAPIDAPI_KEY,
              },
              timeout: 10000
            }).catch(() => null);

            const matchInfo = matchInfoResp?.data?.response?.matchInfo;
            if (matchInfo && matchInfo.status) {
              const statusLower = (matchInfo.status || '').toLowerCase();
              const isFinished = statusLower.includes('won') || statusLower.includes('drawn') || statusLower.includes('tied') || statusLower.includes('no result') || statusLower.includes('abandoned');

              if (isFinished) {
                const homeTeam = match.team1.teamName || 'Team 1';
                const awayTeam = match.team2.teamName || 'Team 2';
                const homeSName = (match.team1.teamSName || '').toLowerCase();
                const awaySName = (match.team2.teamSName || '').toLowerCase();
                let winner: 'home' | 'away' | 'draw' = 'draw';

                if (statusLower.includes('no result') || statusLower.includes('abandoned')) {
                  winner = 'draw';
                } else if (statusLower.includes('drawn') || statusLower.includes('tied')) {
                  winner = 'draw';
                } else if (statusLower.includes(homeTeam.toLowerCase()) || statusLower.includes(homeSName)) {
                  winner = 'home';
                } else if (statusLower.includes(awayTeam.toLowerCase()) || statusLower.includes(awaySName)) {
                  winner = 'away';
                }

                results.push({
                  eventId: `cricket_${match.matchId}`,
                  homeTeam,
                  awayTeam,
                  homeScore: 0,
                  awayScore: 0,
                  winner,
                  status: 'finished'
                });
              }
            }

            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      console.log(`[FreeSports] 🏏 Cricket: ${results.length} finished matches for settlement (${apiCallCount} API calls used)`);
      return results;
    } catch (error: any) {
      console.error(`[FreeSports] 🏏 Cricket results fetch error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get cached upcoming events for a specific sport
   */
  getUpcomingEvents(sportSlug?: string): SportEvent[] {
    if (sportSlug) {
      if (sportSlug === 'cricket') {
        return cachedFreeSportsEvents.filter(e => e.sportId === CRICKET_SPORT_ID);
      }
      const config = FREE_SPORTS_CONFIG[sportSlug];
      if (config) {
        return cachedFreeSportsEvents.filter(e => e.sportId === config.sportId);
      }
      return [];
    }
    return cachedFreeSportsEvents;
  }

  /**
   * Get all supported free sports
   */
  getSupportedSports(): string[] {
    const sports = Object.keys(FREE_SPORTS_CONFIG);
    if (!sports.includes('boxing')) sports.push('boxing');
    if (!sports.includes('cricket')) sports.push('cricket');
    return sports;
  }

  /**
   * Check if a sport is a free sport
   */
  isFreeSport(sportSlug: string): boolean {
    return sportSlug in FREE_SPORTS_CONFIG || 
           sportSlug === 'hockey' || 
           sportSlug === 'nfl' || 
           sportSlug === 'mlb' ||
           sportSlug === 'boxing' ||
           sportSlug === 'tennis' ||
           sportSlug === 'cricket';
  }

  /**
   * Get cache status
   */
  getCacheStatus(): { 
    eventCount: number; 
    lastFetch: Date | null; 
    cacheAgeMinutes: number;
    isStale: boolean;
  } {
    const cacheAgeMs = Date.now() - lastFetchTime;
    return {
      eventCount: cachedFreeSportsEvents.length,
      lastFetch: lastFetchTime > 0 ? new Date(lastFetchTime) : null,
      cacheAgeMinutes: Math.round(cacheAgeMs / (60 * 1000)),
      isStale: cacheAgeMs > CACHE_TTL
    };
  }

  /**
   * Look up a specific event by ID for validation
   * Returns event data including startTime for betting cutoff enforcement
   */
  lookupEvent(eventId: string): { found: boolean; event?: SportEvent; shouldBeLive: boolean } {
    const event = cachedFreeSportsEvents.find(e => String(e.id) === String(eventId));
    if (!event) {
      return { found: false, shouldBeLive: false };
    }
    
    const shouldBeLive = event.startTime ? new Date(event.startTime).getTime() <= Date.now() : false;
    return { found: true, event, shouldBeLive };
  }

  /**
   * Force refresh (manual trigger)
   */
  async forceRefresh(): Promise<SportEvent[]> {
    console.log('[FreeSports] Force refresh requested - resetting date lock');
    lastUpcomingFetchDate = '';
    return this.fetchAllUpcomingMatches();
  }
}

// Singleton instance
export const freeSportsService = new FreeSportsService();
