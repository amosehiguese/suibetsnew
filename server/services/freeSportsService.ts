import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SportEvent, MarketData, OutcomeData } from '../types/betting';
import { mmaApiService } from './mmaApiService';

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

// SofaScore unofficial API - free, no key required
// Covers niche sports not available on API-Sports free tier
const SOFASCORE_BASE_URL = 'https://api.sofascore.com/api/v1';
const SOFASCORE_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.sofascore.com/',
  'Origin': 'https://www.sofascore.com',
  'Cache-Control': 'no-cache',
};

const SOFASCORE_SPORTS_CONFIG: Record<string, {
  slug: string;
  sportId: number;
  name: string;
  icon: string;
  hasDraws: boolean;
}> = {
  darts: {
    slug: 'darts',
    sportId: 21,
    name: 'Darts',
    icon: '🎯',
    hasDraws: false,
  },
  snooker: {
    slug: 'snooker',
    sportId: 22,
    name: 'Snooker',
    icon: '🎱',
    hasDraws: false,
  },
  'table-tennis': {
    slug: 'table-tennis',
    sportId: 23,
    name: 'Table Tennis',
    icon: '🏓',
    hasDraws: false,
  },
  'water-polo': {
    slug: 'waterpolo',
    sportId: 24,
    name: 'Water Polo',
    icon: '🤽',
    hasDraws: true,
  },
  badminton: {
    slug: 'badminton',
    sportId: 25,
    name: 'Badminton',
    icon: '🏸',
    hasDraws: false,
  },
  chess: {
    slug: 'chess',
    sportId: 26,
    name: 'Chess',
    icon: '♟️',
    hasDraws: false,
  },
  armwrestling: {
    slug: 'armwrestling',
    sportId: 27,
    name: 'Armwrestling',
    icon: '💪',
    hasDraws: false,
  },
};

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const CRICBUZZ_BASE_URL = 'https://free-cricbuzz-cricket-api.p.rapidapi.com';
const CRICKET_SPORT_ID = 18;
const HORSE_RACING_SPORT_ID = 17;
const RACING_API_BASE = 'https://the-racing-api1.p.rapidapi.com';
const RACING_API_HOST = 'the-racing-api1.p.rapidapi.com';

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
          const boxingCount = sportEvents.filter(e => e.sportId === 8).length;
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
      const horseRacingEvents = await this.fetchHorseRacing();
      if (horseRacingEvents.length > 0) {
        allEvents.push(...horseRacingEvents);
      }
    } catch (error: any) {
      console.error(`[FreeSports] Horse Racing fetch error:`, error.message);
    }

    try {
      const motoGPEvents = this.generateMotoGPEvents();
      if (motoGPEvents.length > 0) {
        allEvents.push(...motoGPEvents);
        console.log(`[FreeSports] 🏍️ MotoGP: ${motoGPEvents.length} upcoming races generated`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] MotoGP generation error:`, error.message);
    }

    try {
      const boxingEvents = this.generateBoxingEvents();
      if (boxingEvents.length > 0) {
        allEvents.push(...boxingEvents);
        console.log(`[FreeSports] 🥊 Boxing: ${boxingEvents.length} upcoming fights generated`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] Boxing generation error:`, error.message);
    }

    try {
      const tennisEvents = this.generateTennisEvents();
      if (tennisEvents.length > 0) {
        allEvents.push(...tennisEvents);
        console.log(`[FreeSports] 🎾 Tennis: ${tennisEvents.length} upcoming matches generated`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] Tennis generation error:`, error.message);
    }

    try {
      const wweEvents = this.generateWWEEvents();
      if (wweEvents.length > 0) {
        allEvents.push(...wweEvents);
        console.log(`[FreeSports] 🎭 WWE Entertainment: ${wweEvents.length} upcoming events generated`);
      } else {
        console.log(`[FreeSports] 🎭 WWE Entertainment: 0 events returned from generator`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] WWE generation error:`, error.message, error.stack);
    }

    try {
      const generatedF1 = this.generateF1Schedule();
      if (generatedF1.length > 0) {
        const existingF1 = allEvents.filter(e => e.sportId === 11);
        const existingF1Ids = new Set(existingF1.map(e => String(e.id)));
        // Match by race date (same day = same race, even if name differs slightly e.g. "China" vs "Chinese")
        const existingF1Dates = new Set(existingF1.map(e => (e.startTime || '').slice(0, 10)));
        const newF1 = generatedF1.filter(e =>
          !existingF1Ids.has(String(e.id)) &&
          !existingF1Dates.has((e.startTime || '').slice(0, 10))
        );
        allEvents.push(...newF1);
        console.log(`[FreeSports] 🏎️ F1 Generated: ${newF1.length} upcoming races added (${existingF1.length} from API skipped)`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] F1 schedule generation error:`, error.message);
    }

    try {
      await mmaApiService.refreshCache();
      const realMMAEvents = mmaApiService.getUpcomingEvents();
      if (realMMAEvents.length > 0) {
        allEvents.push(...realMMAEvents);
        console.log(`[FreeSports] 🥋 UFC/MMA Real API: ${realMMAEvents.length} upcoming fights from API`);
      } else {
        const generatedUFC = this.generateUFCEvents();
        if (generatedUFC.length > 0) {
          allEvents.push(...generatedUFC);
          console.log(`[FreeSports] 🥋 UFC Fallback: ${generatedUFC.length} generated fight cards (API returned 0)`);
        }
      }
    } catch (error: any) {
      console.error(`[FreeSports] UFC/MMA fetch error:`, error.message);
      try {
        const generatedUFC = this.generateUFCEvents();
        if (generatedUFC.length > 0) {
          allEvents.push(...generatedUFC);
          console.log(`[FreeSports] 🥋 UFC Fallback after error: ${generatedUFC.length} generated fight cards`);
        }
      } catch {}
    }

    try {
      const sofaScoreEvents = await this.fetchSofaScoreUpcoming();
      if (sofaScoreEvents.length > 0) {
        allEvents.push(...sofaScoreEvents);
        console.log(`[FreeSports] 🎯 SofaScore niche sports: ${sofaScoreEvents.length} upcoming events added`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] SofaScore fetch error:`, error.message);
    }

    cachedFreeSportsEvents = allEvents;
    lastUpcomingFetchDate = getUTCDateString();
    lastFetchTime = Date.now();
    saveCacheToFile();
    console.log(`[FreeSports] ✅ Cache updated: ${allEvents.length} total events`);

    return allEvents;
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

    try {
      const sofaScoreResults = await this.fetchSofaScoreResults();
      if (sofaScoreResults.length > 0) {
        results.push(...sofaScoreResults);
        console.log(`[FreeSports] 🎯 SofaScore results: ${sofaScoreResults.length} finished niche sport matches for settlement`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] SofaScore results fetch error:`, error.message);
    }

    try {
      const wweResults = this.generateWWEResults();
      if (wweResults.length > 0) {
        results.push(...wweResults);
        console.log(`[FreeSports] 🎭 WWE results: ${wweResults.length} matches auto-settled`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] WWE results generation error:`, error.message);
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

  /**
   * Fetch upcoming events for a single sport on a single date from the free API.
   * Called once per sport per day (max 3 days ahead).
   * Falls back to generated events if API returns 0 results.
   */
  private async fetchUpcomingForSingleDate(
    sportSlug: string,
    config: { endpoint: string; apiHost: string; sportId: number; name: string; hasDraws: boolean; daysAhead: number },
    date: Date
  ): Promise<SportEvent[]> {
    const dateStr = date.toISOString().split('T')[0];

    const headers: Record<string, string> = {
      'x-apisports-key': API_KEY,
      'Accept': 'application/json',
    };

    const params: Record<string, string | number> = {
      date: dateStr,
      timezone: 'UTC',
    };

    const response = await axios.get(config.endpoint, {
      params,
      headers,
      timeout: 12000,
    });

    const games: any[] = response.data?.response || [];
    if (!games.length) return [];

    const events: SportEvent[] = [];

    for (const game of games) {
      try {
        const statusLong = (game.status?.long || '').toLowerCase();
        const statusShort = (game.status?.short || '');
        const isFinished = statusLong.includes('finish') || statusLong.includes('final') ||
          statusShort === 'FT' || statusShort === 'AET' || statusShort === 'PEN' ||
          statusShort === 'AOT';
        if (isFinished) continue;

        let homeTeam = '';
        let awayTeam = '';
        let startTime = '';
        let leagueName = '';
        let sportId = config.sportId;

        if (sportSlug === 'formula-1') {
          const gpName = game.competition?.name || game.circuit?.name || 'Grand Prix';
          const circuitName = game.circuit?.name || game.competition?.location || gpName;
          const raceStartTime = game.date || `${dateStr}T12:00:00Z`;
          const raceId = String(game.id || gpName.replace(/\s+/g, '-').toLowerCase());
          const f1Event = this.generateF1RaceEvent(raceId, gpName, circuitName, raceStartTime, config.sportId);
          events.push(f1Event);
          continue;
        } else if (sportSlug === 'mma') {
          if (isBoxingFight(game)) {
            sportId = 8;
          }
          homeTeam = game.fighters?.home?.name ||
            game.fighters?.first?.name ||
            (Array.isArray(game.fighters) ? game.fighters[0]?.name : '') ||
            'Fighter 1';
          awayTeam = game.fighters?.away?.name ||
            game.fighters?.second?.name ||
            (Array.isArray(game.fighters) ? game.fighters[1]?.name : '') ||
            'Fighter 2';
          startTime = game.date || `${dateStr}T20:00:00Z`;
          leagueName = game.league?.name || game.competition?.name || 'MMA';
        } else {
          homeTeam = game.teams?.home?.name || game.home?.name || 'Home Team';
          awayTeam = game.teams?.away?.name || game.away?.name || 'Away Team';
          startTime = game.date || `${dateStr}T12:00:00Z`;
          leagueName = game.league?.name || game.competition?.name || config.name;
          if (game.league?.country && !leagueName.includes(game.league.country)) {
            leagueName += ` (${game.league.country})`;
          }
        }

        if (!homeTeam || !awayTeam || homeTeam === awayTeam) continue;

        // Seeded deterministic odds — consistent for the same game, realistic sportsbook margins
        const seedStr = String(game.id || `${homeTeam}_${awayTeam}`);
        const seedHash = seedStr.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
        const seededRand = (offset: number) => { const x = Math.sin(Math.abs(seedHash) + offset) * 10000; return x - Math.floor(x); };
        const MARGIN = 1.055; // 5.5% bookmaker margin
        const r1 = seededRand(1);
        const r2 = seededRand(2);
        let hOdds: number, aOdds: number;
        let drawOdds: number | undefined;
        if (config.hasDraws) {
          const drawProb = 0.18 + r2 * 0.12;
          const remaining = 1 - drawProb;
          const homeProb = remaining * (0.38 + r1 * 0.24);
          const awayProb = remaining - homeProb;
          hOdds = parseFloat(Math.max(1.20, MARGIN / homeProb).toFixed(2));
          aOdds = parseFloat(Math.max(1.20, MARGIN / Math.max(0.15, awayProb)).toFixed(2));
          drawOdds = parseFloat(Math.max(2.80, MARGIN / drawProb).toFixed(2));
        } else {
          const homeProb = 0.38 + r1 * 0.24;
          const awayProb = 1 - homeProb;
          hOdds = parseFloat(Math.max(1.15, MARGIN / homeProb).toFixed(2));
          aOdds = parseFloat(Math.max(1.15, MARGIN / awayProb).toFixed(2));
        }

        const outcomes: OutcomeData[] = [
          { id: 'home', name: homeTeam, odds: hOdds, probability: 1 / hOdds },
          { id: 'away', name: awayTeam, odds: aOdds, probability: 1 / aOdds },
        ];
        if (drawOdds) {
          outcomes.push({ id: 'draw', name: 'Draw', odds: drawOdds, probability: 1 / drawOdds });
        }

        const event: SportEvent = {
          id: `${sportSlug}_api_${game.id}`,
          sportId,
          leagueName,
          homeTeam,
          awayTeam,
          startTime,
          status: 'scheduled',
          isLive: false,
          markets: [{ id: 'match_winner', name: 'Match Winner', outcomes }],
          homeOdds: hOdds,
          awayOdds: aOdds,
          ...(drawOdds !== undefined ? { drawOdds } : {}),
        } as SportEvent;

        events.push(event);
      } catch (parseErr: any) {
        console.warn(`[FreeSports] Error parsing ${sportSlug} game ${game?.id}:`, parseErr.message);
      }
    }

    console.log(`[FreeSports] API: ${config.name} on ${dateStr} → ${events.length} events`);
    return events;
  }

  private generateF1RaceEvent(raceId: string, gpName: string, circuitName: string, startTime: string, sportId: number): SportEvent {
    const f1Grid: { name: string; team: string; number: number; rating: number }[] = [
      { name: 'Max Verstappen', team: 'Red Bull Racing', number: 1, rating: 94 },
      { name: 'Isack Hadjar', team: 'Red Bull Racing', number: 6, rating: 72 },
      { name: 'Charles Leclerc', team: 'Ferrari', number: 16, rating: 90 },
      { name: 'Lewis Hamilton', team: 'Ferrari', number: 44, rating: 85 },
      { name: 'Lando Norris', team: 'McLaren', number: 4, rating: 88 },
      { name: 'Oscar Piastri', team: 'McLaren', number: 81, rating: 85 },
      { name: 'George Russell', team: 'Mercedes', number: 63, rating: 86 },
      { name: 'Andrea Kimi Antonelli', team: 'Mercedes', number: 12, rating: 78 },
      { name: 'Fernando Alonso', team: 'Aston Martin Honda', number: 14, rating: 75 },
      { name: 'Lance Stroll', team: 'Aston Martin Honda', number: 18, rating: 60 },
      { name: 'Pierre Gasly', team: 'Alpine Mercedes', number: 10, rating: 72 },
      { name: 'Franco Colapinto', team: 'Alpine Mercedes', number: 43, rating: 66 },
      { name: 'Carlos Sainz', team: 'Williams', number: 55, rating: 80 },
      { name: 'Alex Albon', team: 'Williams', number: 23, rating: 74 },
      { name: 'Liam Lawson', team: 'Racing Bulls', number: 30, rating: 71 },
      { name: 'Arvid Lindblad', team: 'Racing Bulls', number: 39, rating: 64 },
      { name: 'Nico Hülkenberg', team: 'Audi', number: 27, rating: 70 },
      { name: 'Gabriel Bortoleto', team: 'Audi', number: 5, rating: 65 },
      { name: 'Esteban Ocon', team: 'Haas', number: 31, rating: 73 },
      { name: 'Oliver Bearman', team: 'Haas', number: 87, rating: 68 },
      { name: 'Sergio Pérez', team: 'Cadillac', number: 11, rating: 69 },
      { name: 'Valtteri Bottas', team: 'Cadillac', number: 77, rating: 67 },
    ];

    const raceHash = raceId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const seededRand = (seed: number) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };

    const rawPowers = f1Grid.map((driver, idx) => {
      const basePower = Math.pow(driver.rating / 55, 10);
      const jitter = (seededRand(raceHash + idx * 7) - 0.5) * 0.4 * basePower;
      return Math.max(0.001, basePower + jitter);
    });
    const totalPower = rawPowers.reduce((s, v) => s + v, 0);

    const TARGET_OVERROUND = 1.15;
    const outcomes: OutcomeData[] = f1Grid.map((driver, idx) => {
      const fairProb = rawPowers[idx] / totalPower;
      const bookedProb = fairProb * TARGET_OVERROUND;
      const odds = parseFloat(Math.max(1.20, 1 / bookedProb).toFixed(2));
      return {
        id: `driver_${driver.number}`,
        name: driver.name,
        odds,
        probability: 1 / odds
      };
    });

    const placeOutcomes: OutcomeData[] = outcomes.map(w => {
      const placeOdds = parseFloat(Math.max(1.20, ((w.odds - 1) / 3.0) + 1).toFixed(2));
      return { id: w.id, name: w.name, odds: placeOdds, probability: 1 / placeOdds };
    });

    const podiumOutcomes: OutcomeData[] = outcomes.map(w => {
      const podiumOdds = parseFloat(Math.max(1.10, ((w.odds - 1) / 5.0) + 1).toFixed(2));
      return { id: w.id, name: w.name, odds: podiumOdds, probability: 1 / podiumOdds };
    });

    const runnersInfo = f1Grid.map(driver => ({
      name: driver.name,
      number: driver.number,
      jockey: driver.team,
      trainer: '',
      form: '',
      age: null,
      weight: null,
      draw: null,
    }));

    return {
      id: `formula-1_${raceId}`,
      sportId,
      leagueName: `Formula 1`,
      homeTeam: gpName,
      awayTeam: `${f1Grid.length} drivers`,
      startTime,
      status: 'scheduled',
      isLive: false,
      markets: [
        { id: 'race_winner', name: 'Win', outcomes },
        { id: 'race_place', name: 'Top 2', outcomes: placeOutcomes },
        { id: 'race_show', name: 'Podium', outcomes: podiumOutcomes },
      ],
      homeOdds: outcomes[0]?.odds || 3.0,
      awayOdds: outcomes[1]?.odds || 4.0,
      runnersInfo,
      raceDetails: {
        course: circuitName,
        region: '',
        raceType: 'Grand Prix',
        distance: '',
        going: '',
        surface: 'Circuit',
        raceClass: '',
        prize: '',
        fieldSize: f1Grid.length,
        ageBand: '',
        pattern: '',
      },
    } as SportEvent;
  }

  private generateMotoGPEvents(): SportEvent[] {
    const MOTOGP_SPORT_ID = 19;
    const motoGPSchedule2026: { id: string; gpName: string; circuit: string; date: string }[] = [
      { id: 'thai-gp', gpName: 'Thai Grand Prix', circuit: 'Chang International Circuit, Buriram', date: '2026-03-01T09:00:00Z' },
      { id: 'brazilian-gp', gpName: 'Brazilian Grand Prix', circuit: 'Autódromo Ayrton Senna, Goiânia', date: '2026-03-22T18:00:00Z' },
      { id: 'americas-gp', gpName: 'Grand Prix of the Americas', circuit: 'Circuit of The Americas, Austin', date: '2026-03-29T19:00:00Z' },
      { id: 'qatar-gp', gpName: 'Qatar Grand Prix', circuit: 'Lusail International Circuit', date: '2026-04-12T17:00:00Z' },
      { id: 'spanish-gp', gpName: 'Spanish Grand Prix', circuit: 'Circuito de Jerez, Spain', date: '2026-04-26T13:00:00Z' },
      { id: 'french-gp', gpName: 'French Grand Prix', circuit: 'Le Mans, France', date: '2026-05-10T13:00:00Z' },
      { id: 'catalan-gp', gpName: 'Catalan Grand Prix', circuit: 'Circuit de Barcelona-Catalunya', date: '2026-05-17T13:00:00Z' },
      { id: 'italian-gp', gpName: 'Italian Grand Prix', circuit: 'Autodromo del Mugello, Italy', date: '2026-05-31T13:00:00Z' },
      { id: 'hungarian-gp', gpName: 'Hungarian Grand Prix', circuit: 'Balaton Park Circuit, Hungary', date: '2026-06-07T13:00:00Z' },
      { id: 'czech-gp', gpName: 'Czech Grand Prix', circuit: 'Automotodrom Brno, Czech Republic', date: '2026-06-21T13:00:00Z' },
      { id: 'german-gp', gpName: 'German Grand Prix', circuit: 'Sachsenring, Hohenstein-Ernstthal', date: '2026-06-28T13:00:00Z' },
      { id: 'british-gp', gpName: 'British Grand Prix', circuit: 'Silverstone Circuit, UK', date: '2026-08-16T13:00:00Z' },
      { id: 'aragon-gp', gpName: 'Aragon Grand Prix', circuit: 'MotorLand Aragón, Alcañiz', date: '2026-08-30T13:00:00Z' },
      { id: 'austrian-gp', gpName: 'Austrian Grand Prix', circuit: 'Red Bull Ring, Spielberg', date: '2026-09-06T13:00:00Z' },
      { id: 'san-marino-gp', gpName: 'San Marino Grand Prix', circuit: 'Misano World Circuit, Misano Adriatico', date: '2026-09-20T13:00:00Z' },
      { id: 'japanese-gp', gpName: 'Japanese Grand Prix', circuit: 'Twin Ring Motegi, Japan', date: '2026-10-04T06:00:00Z' },
      { id: 'indonesian-gp', gpName: 'Indonesian Grand Prix', circuit: 'Mandalika Circuit, Lombok', date: '2026-10-11T08:00:00Z' },
      { id: 'australian-gp', gpName: 'Australian Grand Prix', circuit: 'Phillip Island Circuit, Australia', date: '2026-10-25T05:00:00Z' },
      { id: 'malaysian-gp', gpName: 'Malaysian Grand Prix', circuit: 'Sepang International Circuit', date: '2026-11-01T08:00:00Z' },
      { id: 'portuguese-gp', gpName: 'Portuguese Grand Prix', circuit: 'Autódromo do Algarve, Portimão', date: '2026-11-08T14:00:00Z' },
      { id: 'valencia-gp', gpName: 'Valencian Grand Prix', circuit: 'Circuit Ricardo Tormo, Valencia', date: '2026-11-15T14:00:00Z' },
    ];

    const now = new Date();
    const upcomingRaces = motoGPSchedule2026.filter(race => new Date(race.date) > now);
    const racesToShow = upcomingRaces.slice(0, 3);

    return racesToShow.map(race =>
      this.generateMotoGPRaceEvent(race.id, race.gpName, race.circuit, race.date, MOTOGP_SPORT_ID)
    );
  }

  private generateMotoGPRaceEvent(raceId: string, gpName: string, circuitName: string, startTime: string, sportId: number): SportEvent {
    const motoGPGrid: { name: string; team: string; number: number; rating: number }[] = [
      { name: 'Marc Márquez', team: 'Ducati Lenovo', number: 93, rating: 95 },
      { name: 'Marco Bezzecchi', team: 'Aprilia Racing', number: 72, rating: 85 },
      { name: 'Alex Márquez', team: 'Gresini Ducati', number: 73, rating: 82 },
      { name: 'Pedro Acosta', team: 'Red Bull KTM', number: 31, rating: 83 },
      { name: 'Francesco Bagnaia', team: 'Ducati Lenovo', number: 1, rating: 88 },
      { name: 'Jorge Martín', team: 'Aprilia Racing', number: 89, rating: 80 },
      { name: 'Enea Bastianini', team: 'KTM Tech3', number: 23, rating: 79 },
      { name: 'Maverick Viñales', team: 'KTM Tech3', number: 12, rating: 78 },
      { name: 'Fabio Di Giannantonio', team: 'VR46 Ducati', number: 49, rating: 77 },
      { name: 'Fermín Aldeguer', team: 'Gresini Ducati', number: 54, rating: 74 },
      { name: 'Brad Binder', team: 'Red Bull KTM', number: 33, rating: 76 },
      { name: 'Jack Miller', team: 'Pramac Yamaha', number: 43, rating: 73 },
      { name: 'Fabio Quartararo', team: 'Monster Yamaha', number: 20, rating: 75 },
      { name: 'Alex Rins', team: 'Monster Yamaha', number: 42, rating: 72 },
      { name: 'Raúl Fernández', team: 'Trackhouse Aprilia', number: 25, rating: 74 },
      { name: 'Ai Ogura', team: 'Trackhouse Aprilia', number: 79, rating: 71 },
      { name: 'Franco Morbidelli', team: 'VR46 Ducati', number: 21, rating: 72 },
      { name: 'Johann Zarco', team: 'Honda LCR', number: 5, rating: 70 },
      { name: 'Joan Mir', team: 'Repsol Honda', number: 36, rating: 71 },
      { name: 'Luca Marini', team: 'Repsol Honda', number: 10, rating: 68 },
      { name: 'Somkiat Chantra', team: 'Honda LCR', number: 35, rating: 66 },
      { name: 'Joe Roberts', team: 'Pramac Yamaha', number: 16, rating: 69 },
    ];

    const raceHash = raceId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const seededRand = (seed: number) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };

    const rawPowers = motoGPGrid.map((rider, idx) => {
      const basePower = Math.pow(rider.rating / 55, 10);
      const jitter = (seededRand(raceHash + idx * 7) - 0.5) * 0.4 * basePower;
      return Math.max(0.001, basePower + jitter);
    });
    const totalPower = rawPowers.reduce((s, v) => s + v, 0);

    const TARGET_OVERROUND = 1.15;
    const outcomes: OutcomeData[] = motoGPGrid.map((rider, idx) => {
      const fairProb = rawPowers[idx] / totalPower;
      const bookedProb = fairProb * TARGET_OVERROUND;
      const odds = parseFloat(Math.max(1.20, 1 / bookedProb).toFixed(2));
      return {
        id: `rider_${rider.number}`,
        name: rider.name,
        odds,
        probability: 1 / odds
      };
    });

    const placeOutcomes: OutcomeData[] = outcomes.map(w => {
      const placeOdds = parseFloat(Math.max(1.20, ((w.odds - 1) / 3.0) + 1).toFixed(2));
      return { id: w.id, name: w.name, odds: placeOdds, probability: 1 / placeOdds };
    });

    const podiumOutcomes: OutcomeData[] = outcomes.map(w => {
      const podiumOdds = parseFloat(Math.max(1.10, ((w.odds - 1) / 5.0) + 1).toFixed(2));
      return { id: w.id, name: w.name, odds: podiumOdds, probability: 1 / podiumOdds };
    });

    const runnersInfo = motoGPGrid.map(rider => ({
      name: rider.name,
      number: rider.number,
      jockey: rider.team,
      trainer: '',
      form: '',
      age: null,
      weight: null,
      draw: null,
    }));

    return {
      id: `motogp_${raceId}`,
      sportId,
      leagueName: 'MotoGP',
      homeTeam: gpName,
      awayTeam: `${motoGPGrid.length} riders`,
      startTime,
      status: 'scheduled',
      isLive: false,
      markets: [
        { id: 'race_winner', name: 'Win', outcomes },
        { id: 'race_place', name: 'Top 2', outcomes: placeOutcomes },
        { id: 'race_show', name: 'Podium', outcomes: podiumOutcomes },
      ],
      homeOdds: outcomes[0]?.odds || 3.0,
      awayOdds: outcomes[1]?.odds || 4.0,
      runnersInfo,
      raceDetails: {
        course: circuitName,
        region: '',
        raceType: 'Grand Prix',
        distance: '',
        going: '',
        surface: 'Circuit',
        raceClass: 'MotoGP',
        prize: '',
        fieldSize: motoGPGrid.length,
        ageBand: '',
        pattern: '',
      },
    } as SportEvent;
  }

  private generateBoxingEvents(): SportEvent[] {
    const BOXING_SPORT_ID = 8;
    const boxingFights: {
      id: string; fighter1: string; fighter2: string; record1: string; record2: string;
      odds1: number; odds2: number; title: string; venue: string; date: string; league: string;
    }[] = [
      {
        id: 'opetaia-glanton', fighter1: 'Jai Opetaia', fighter2: 'Brandon Glanton',
        record1: '29-0 (23 KOs)', record2: '21-3 (18 KOs)',
        odds1: 1.07, odds2: 9.00,
        title: 'IBF Cruiserweight Title', venue: 'Meta APEX, Las Vegas',
        date: '2026-03-08T21:00:00Z', league: 'Zuffa Boxing'
      },
      {
        id: 'dickens-cacace', fighter1: 'James Dickens', fighter2: 'Anthony Cacace',
        record1: '36-4 (15 KOs)', record2: '23-1 (10 KOs)',
        odds1: 2.75, odds2: 1.45,
        title: 'WBA Super Featherweight Title', venue: '3Arena, Dublin',
        date: '2026-03-14T20:00:00Z', league: 'DAZN Boxing'
      },
      {
        id: 'donaire-masuda', fighter1: 'Nonito Donaire', fighter2: 'Riku Masuda',
        record1: '42-7 (28 KOs)', record2: '10-1 (6 KOs)',
        odds1: 1.35, odds2: 3.20,
        title: 'Bantamweight (10 Rounds)', venue: 'Yokohama Buntai, Yokohama',
        date: '2026-03-15T10:00:00Z', league: 'Japanese Boxing Commission'
      },
      {
        id: 'olascuaga-iimura', fighter1: 'Anthony Olascuaga', fighter2: 'Jukiya Iimura',
        record1: '7-1 (5 KOs)', record2: '11-0 (7 KOs)',
        odds1: 2.00, odds2: 1.80,
        title: 'WBO Flyweight Title', venue: 'Yokohama Buntai, Yokohama',
        date: '2026-03-15T09:00:00Z', league: 'Japanese Boxing Commission'
      },
      {
        id: 'conlan-walsh', fighter1: 'Michael Conlan', fighter2: 'Kevin Walsh',
        record1: '19-3 (9 KOs)', record2: '13-1 (5 KOs)',
        odds1: 1.30, odds2: 3.50,
        title: 'Featherweight (10 Rounds)', venue: 'SSE Arena, Belfast',
        date: '2026-03-20T20:00:00Z', league: 'DAZN Boxing'
      },
      {
        id: 'scotney-flores', fighter1: 'Ellie Scotney', fighter2: 'Mayelli Flores',
        record1: '10-0 (2 KOs)', record2: '18-2 (5 KOs)',
        odds1: 1.20, odds2: 4.00,
        title: 'Undisputed Women\'s Super Bantamweight', venue: 'Olympia, London',
        date: '2026-04-05T19:00:00Z', league: 'Sky Sports Boxing'
      },
      {
        id: 'dubois-harper', fighter1: 'Caroline Dubois', fighter2: 'Terri Harper',
        record1: '12-0 (4 KOs)', record2: '15-3-2 (6 KOs)',
        odds1: 1.36, odds2: 2.90,
        title: 'Women\'s World Title Unification', venue: 'Olympia, London',
        date: '2026-04-05T18:00:00Z', league: 'Sky Sports Boxing'
      },
      {
        id: 'fury-makhmudov', fighter1: 'Tyson Fury', fighter2: 'Arslanbek Makhmudov',
        record1: '34-1-1 (24 KOs)', record2: '18-1 (18 KOs)',
        odds1: 1.18, odds2: 5.00,
        title: 'Heavyweight (12 Rounds)', venue: 'Tottenham Hotspur Stadium, London',
        date: '2026-04-11T20:00:00Z', league: 'Netflix Boxing'
      },
      {
        id: 'baumgardner-shin', fighter1: 'Alycia Baumgardner', fighter2: 'Bo Mi Re Shin',
        record1: '16-1 (7 KOs)', record2: '15-2 (4 KOs)',
        odds1: 1.30, odds2: 3.40,
        title: 'IBF/WBO/WBA Women\'s Jr. Lightweight Titles', venue: 'Madison Square Garden, New York',
        date: '2026-04-17T22:00:00Z', league: 'ESPN Boxing'
      },
      {
        id: 'ramirez-benavidez', fighter1: 'Gilberto Ramirez', fighter2: 'David Benavidez',
        record1: '46-1 (30 KOs)', record2: '29-0 (24 KOs)',
        odds1: 2.80, odds2: 1.42,
        title: 'WBO & WBA Cruiserweight Titles', venue: 'T-Mobile Arena, Las Vegas',
        date: '2026-05-02T21:00:00Z', league: 'Prime Video PPV'
      },
      {
        id: 'smith-puello', fighter1: 'Dalton Smith', fighter2: 'Alberto Puello',
        record1: '18-0 (13 KOs)', record2: '24-1 (12 KOs)',
        odds1: 1.45, odds2: 2.70,
        title: 'WBC Super Lightweight Title', venue: 'Sheffield Arena, Sheffield',
        date: '2026-06-06T20:00:00Z', league: 'DAZN Boxing'
      },
    ];

    const now = new Date();
    const upcomingFights = boxingFights.filter(f => new Date(f.date) > now);

    return upcomingFights.map(fight => {
      return {
        id: `boxing_${fight.id}`,
        sportId: BOXING_SPORT_ID,
        leagueName: fight.league,
        homeTeam: fight.fighter1,
        awayTeam: fight.fighter2,
        startTime: fight.date,
        status: 'scheduled',
        isLive: false,
        markets: [{
          id: 'match_winner',
          name: 'Fight Winner',
          outcomes: [
            { id: 'fighter1', name: fight.fighter1, odds: fight.odds1, probability: 1 / fight.odds1 },
            { id: 'fighter2', name: fight.fighter2, odds: fight.odds2, probability: 1 / fight.odds2 },
          ]
        }],
        homeOdds: fight.odds1,
        awayOdds: fight.odds2,
        homeRecord: fight.record1,
        awayRecord: fight.record2,
        venue: fight.venue,
        eventTitle: fight.title,
      } as SportEvent;
    });
  }

  private generateWeeklyWWEShows(): {
    id: string; wrestler1: string; wrestler2: string; odds1: number; odds2: number;
    title: string; venue: string; date: string; show: string; matchType: string;
  }[] {
    const now = new Date();
    const events: any[] = [];

    const rawVenues = [
      'Climate Pledge Arena, Seattle', 'Desert Diamond Arena, Glendale', 'TD Garden, Boston',
      'Madison Square Garden, New York', 'Toyota Center, Houston', 'Golden 1 Center, Sacramento',
      'T-Mobile Arena, Las Vegas', 'Barclays Center, Brooklyn', 'United Center, Chicago',
      'Wells Fargo Center, Philadelphia', 'Rocket Mortgage FieldHouse, Cleveland', 'Ball Arena, Denver',
      'Capital One Arena, Washington DC', 'Scotiabank Arena, Toronto', 'Amway Center, Orlando',
      'Bridgestone Arena, Nashville', 'FedExForum, Memphis', 'BOK Center, Tulsa',
      'Enterprise Center, St. Louis', 'PPG Paints Arena, Pittsburgh',
    ];
    const sdVenues = [
      'PHX Arena, Phoenix', 'Lenovo Center, Raleigh', 'SAP Center, San Jose',
      'Dickies Arena, Fort Worth', 'Vystar Veterans Memorial Arena, Jacksonville',
      'Smoothie King Center, New Orleans', 'Kia Center, Orlando', 'Gainbridge Fieldhouse, Indianapolis',
      'Little Caesars Arena, Detroit', 'Frost Bank Center, San Antonio', 'Moody Center, Austin',
      'Spectrum Center, Charlotte', 'Nationwide Arena, Columbus', 'Delta Center, Salt Lake City',
      'Chase Center, San Francisco', 'Crypto.com Arena, Los Angeles', 'State Farm Arena, Atlanta',
      'Target Center, Minneapolis', 'Moda Center, Portland', 'KeyBank Center, Buffalo',
    ];

    const rawMain: [string, string, number, number, string][] = [
      ['CM Punk', 'Gunther', 1.36, 3.10, 'World Heavyweight Championship Match'],
      ['Seth Rollins', 'Drew McIntyre', 1.57, 2.45, 'Singles Match'],
      ['Roman Reigns', 'Solo Sikoa', 1.22, 4.50, 'Tribal Combat'],
      ['Brock Lesnar', 'Bronson Reed', 1.18, 5.00, 'Open Challenge'],
      ['Cody Rhodes', 'Randy Orton', 1.83, 2.00, 'Championship Showdown'],
      ['Jey Uso', 'Gunther', 2.60, 1.50, 'Intercontinental Title Match'],
      ['Seth Rollins', 'Logan Paul', 1.28, 3.75, 'Celebrity Main Event'],
      ['CM Punk', 'Seth Rollins', 1.91, 1.91, 'Dream Match'],
      ['Roman Reigns', 'Drew McIntyre', 1.33, 3.30, 'Main Event Singles Match'],
      ['Cody Rhodes', 'LA Knight', 1.40, 3.00, 'Undisputed Title Defense'],
    ];
    const rawWomens: [string, string, number, number, string][] = [
      ['Rhea Ripley', 'Liv Morgan', 1.44, 2.80, 'Women\'s World Title'],
      ['Jade Cargill', 'Bianca Belair', 1.80, 2.05, 'Women\'s Tag Division'],
      ['Liv Morgan', 'Becky Lynch', 1.67, 2.25, 'Women\'s Main Event'],
      ['Rhea Ripley', 'Charlotte Flair', 1.53, 2.55, 'Women\'s Championship'],
      ['Bayley', 'IYO SKY', 2.10, 1.77, 'Women\'s Division'],
    ];
    const rawMid: [string, string, number, number, string][] = [
      ['Jey Uso', 'Pete Dunne', 1.33, 3.25, 'Midcard Singles'],
      ['Bronson Reed', 'Braun Strowman', 1.75, 2.10, 'Hoss Fight'],
      ['Chad Gable', 'Otis', 1.65, 2.25, 'Alpha Academy Rivalry'],
      ['Damian Priest', 'Dominik Mysterio', 1.40, 3.00, 'Judgment Day Fallout'],
      ['Kofi Kingston', 'Xavier Woods', 1.91, 1.91, 'Tag Team Breakup'],
      ['Sheamus', 'Ludwig Kaiser', 1.50, 2.60, 'Physical Encounter'],
      ['Dragon Lee', 'Ricochet', 1.85, 2.00, 'Cruiserweight Showcase'],
      ['R-Truth', 'Karrion Kross', 2.80, 1.43, 'Open Challenge'],
    ];
    const rawMid2: [string, string, number, number, string][] = [
      ['Bron Breakker', 'Ilja Dragunov', 1.55, 2.50, 'IC Title Contender'],
      ['Sami Zayn', 'Chad Gable', 1.60, 2.35, 'Grudge Match'],
      ['Pete Dunne', 'Dragon Lee', 1.80, 2.05, 'Cruiserweight Battle'],
      ['Karrion Kross', 'Sheamus', 1.67, 2.25, 'Grudge Match'],
      ['Ludwig Kaiser', 'Kofi Kingston', 1.50, 2.60, 'Singles Action'],
      ['Ilja Dragunov', 'Ricochet', 1.70, 2.15, 'High Flying Clash'],
      ['Damian Priest', 'Bronson Reed', 1.45, 2.75, 'Powerhouse Bout'],
      ['Braun Strowman', 'Otis', 1.36, 3.10, 'Big Man Showdown'],
    ];
    const rawTitle: [string, string, number, number, string][] = [
      ['Bron Breakker', 'Jey Uso', 1.40, 3.00, 'Intercontinental Championship'],
      ['Sami Zayn', 'Ludwig Kaiser', 1.57, 2.45, 'IC Title Defense'],
      ['Sheamus', 'Bron Breakker', 2.10, 1.77, 'IC Title Challenge'],
      ['Jey Uso', 'Sami Zayn', 1.50, 2.60, 'IC Title Rematch'],
      ['Bron Breakker', 'Pete Dunne', 1.30, 3.50, 'IC Title Open Challenge'],
      ['Chad Gable', 'Sami Zayn', 2.20, 1.72, 'IC Title Contender Match'],
      ['Ilja Dragunov', 'Bron Breakker', 1.91, 1.91, 'IC Title Dream Match'],
      ['Jey Uso', 'Chad Gable', 1.44, 2.80, 'IC Title Defense'],
    ];
    const rawTag: [string, string, number, number, string][] = [
      ['The Judgment Day', 'The LWO', 1.44, 2.80, 'Tag Team Match'],
      ['DIY', 'The Creed Brothers', 1.60, 2.35, 'Tag Team Contenders'],
      ['Awesome Truth', 'Alpha Academy', 1.50, 2.60, 'Tag Title Match'],
      ['War Raiders', 'The New Day', 1.36, 3.10, 'Tag Division'],
      ['Imperium', 'Street Profits', 1.53, 2.55, 'Tag Team Action'],
      ['The Usos', 'Pretty Deadly', 1.28, 3.75, 'Tag Team Showcase'],
      ['Authors of Pain', 'American Alpha', 1.67, 2.25, 'Tag Team Battle'],
      ['Motor City Machine Guns', 'Legado del Fantasma', 1.45, 2.75, 'Tag Team Classic'],
    ];
    const rawOpener: [string, string, number, number, string][] = [
      ['Akira Tozawa', 'Cedric Alexander', 1.91, 1.91, 'Opening Contest'],
      ['R-Truth', 'Giovanni Vinci', 1.65, 2.25, 'Opening Match'],
      ['Ricochet', 'Akira Tozawa', 1.28, 3.75, 'High Energy Opener'],
      ['Dominik Mysterio', 'Dragon Lee', 1.70, 2.15, 'Opening Bout'],
      ['Xavier Woods', 'Giovanni Vinci', 1.57, 2.45, 'Show Opener'],
      ['Pete Dunne', 'Cedric Alexander', 1.44, 2.80, 'Opening Singles'],
      ['Kofi Kingston', 'Akira Tozawa', 1.33, 3.25, 'Kickoff Match'],
      ['Otis', 'R-Truth', 1.50, 2.60, 'Fun Opener'],
    ];
    const sdMain: [string, string, number, number, string][] = [
      ['Cody Rhodes', 'AJ Styles', 1.30, 3.50, 'Main Event'],
      ['Randy Orton', 'LA Knight', 1.50, 2.60, 'Contender Match'],
      ['Kevin Owens', 'Sami Zayn', 1.91, 1.91, 'Former Tag Partners Clash'],
      ['Gunther', 'Sami Zayn', 1.36, 3.15, 'Intercontinental Title Match'],
      ['AJ Styles', 'Carmelo Hayes', 1.45, 2.75, 'SmackDown Main Event'],
      ['The Usos', 'The Bloodline', 1.57, 2.45, 'Tag Team Match'],
      ['Cody Rhodes', 'Kevin Owens', 1.33, 3.30, 'Championship Confrontation'],
      ['LA Knight', 'Santos Escobar', 1.28, 3.75, 'United States Title Match'],
    ];
    const sdWomens: [string, string, number, number, string][] = [
      ['Rhea Ripley', 'Nia Jax', 1.36, 3.10, 'Women\'s Division'],
      ['Bianca Belair', 'Naomi', 1.44, 2.80, 'Women\'s SmackDown'],
      ['Charlotte Flair', 'Bayley', 1.57, 2.45, 'Women\'s Championship Contender'],
      ['IYO SKY', 'Asuka', 1.80, 2.05, 'Women\'s Match'],
    ];
    const sdMid: [string, string, number, number, string][] = [
      ['Carmelo Hayes', 'Andrade', 1.70, 2.15, 'Midcard Singles'],
      ['Apollo Crews', 'Baron Corbin', 1.55, 2.50, 'SmackDown Clash'],
      ['Grayson Waller', 'Austin Theory', 1.91, 1.91, 'A-Town Down Under Split'],
      ['Angel Garza', 'Santos Escobar', 2.20, 1.72, 'LDF Rivalry'],
      ['Montez Ford', 'Angelo Dawkins', 1.83, 2.00, 'Street Profits Clash'],
      ['Pretty Deadly', 'Legado del Fantasma', 1.57, 2.45, 'Tag Action'],
      ['Nick Aldis', 'Solo Sikoa', 2.60, 1.50, 'Authority vs Bloodline'],
      ['Bobby Lashley', 'Bron Breakker', 1.65, 2.25, 'Powerhouse Match'],
    ];
    const sdMid2: [string, string, number, number, string][] = [
      ['Andrade', 'Angel Garza', 1.50, 2.60, 'Former Partners Clash'],
      ['Baron Corbin', 'Montez Ford', 1.70, 2.15, 'SmackDown Bout'],
      ['Austin Theory', 'Apollo Crews', 1.57, 2.45, 'Singles Match'],
      ['Santos Escobar', 'Carmelo Hayes', 1.65, 2.25, 'Rivalry Match'],
      ['Bron Breakker', 'Grayson Waller', 1.33, 3.25, 'Powerhouse vs Flash'],
      ['Angelo Dawkins', 'Baron Corbin', 1.80, 2.05, 'SmackDown Action'],
      ['Bobby Lashley', 'Apollo Crews', 1.40, 3.00, 'All Mighty Challenge'],
      ['Nick Aldis', 'Austin Theory', 2.40, 1.57, 'GM vs Superstar'],
    ];
    const sdTitle: [string, string, number, number, string][] = [
      ['LA Knight', 'Carmelo Hayes', 1.44, 2.80, 'United States Championship'],
      ['Santos Escobar', 'LA Knight', 1.70, 2.15, 'US Title Defense'],
      ['Andrade', 'LA Knight', 1.91, 1.91, 'US Title Challenge'],
      ['Carmelo Hayes', 'Andrade', 1.55, 2.50, 'US Title Contender Match'],
      ['LA Knight', 'Grayson Waller', 1.30, 3.50, 'US Title Open Challenge'],
      ['Austin Theory', 'LA Knight', 2.20, 1.72, 'US Title Grudge Match'],
      ['Santos Escobar', 'Carmelo Hayes', 1.60, 2.35, 'US Title No.1 Contender'],
      ['LA Knight', 'Apollo Crews', 1.36, 3.10, 'US Title Defense'],
    ];
    const sdTag: [string, string, number, number, string][] = [
      ['Street Profits', 'B-Fab & Jade', 1.45, 2.75, 'Mixed Tag Match'],
      ['DIY', 'The Bloodline', 1.70, 2.15, 'Tag Team Match'],
      ['Legado del Fantasma', 'Los Lotharios', 1.36, 3.10, 'Lucha Tag Team'],
      ['The Usos', 'Pretty Deadly', 1.33, 3.25, 'Tag Title Contenders'],
      ['Alpha Academy', 'A-Town Down Under', 1.57, 2.45, 'Tag Team Clash'],
      ['Motor City Machine Guns', 'DIY', 1.91, 1.91, 'Tag Team Classic'],
      ['Imperium', 'Brawling Brutes', 1.50, 2.60, 'European Tag Match'],
      ['New Catch Republic', 'The Creed Brothers', 1.60, 2.35, 'Tag Division Match'],
    ];
    const sdOpener: [string, string, number, number, string][] = [
      ['Pretty Deadly', 'Los Lotharios', 1.57, 2.45, 'Opening Contest'],
      ['Giovanni Vinci', 'Cedric Alexander', 1.70, 2.15, 'Opening Match'],
      ['Akira Tozawa', 'Angel Garza', 2.20, 1.72, 'Show Opener'],
      ['Grayson Waller', 'Cedric Alexander', 1.44, 2.80, 'Opening Bout'],
      ['Apollo Crews', 'Giovanni Vinci', 1.55, 2.50, 'SmackDown Opener'],
      ['Austin Theory', 'Akira Tozawa', 1.33, 3.25, 'Opening Singles'],
      ['Angel Garza', 'Giovanni Vinci', 1.91, 1.91, 'Kickoff Match'],
      ['Baron Corbin', 'Cedric Alexander', 1.40, 3.00, 'Opening Action'],
    ];

    const nowUtcDay = now.getUTCDay();
    const nowUtcDate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    for (let weekOffset = 0; weekOffset < 1; weekOffset++) {
      let daysUntilMonday = (1 - nowUtcDay + 7) % 7;
      if (daysUntilMonday === 0) daysUntilMonday = 7;
      const mondayMs = nowUtcDate + (daysUntilMonday + weekOffset * 7) * 86400000;

      const venueIdx = weekOffset % rawVenues.length;
      const rawDateStr = new Date(mondayMs + 3600000).toISOString().split('T')[0];
      const rv = rawVenues[venueIdx];

      // Raw: exactly 4 matches per episode (Main Event, Women's, Title, Tag)
      const [m1, m2, mo1, mo2, mt] = rawMain[weekOffset % rawMain.length];
      events.push({ id: `raw-${rawDateStr}-main`, wrestler1: m1, wrestler2: m2, odds1: mo1, odds2: mo2, title: mt, venue: rv, date: new Date(mondayMs + 4 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Main Event' });

      const [w1, w2, wo1, wo2, wt] = rawWomens[weekOffset % rawWomens.length];
      events.push({ id: `raw-${rawDateStr}-women`, wrestler1: w1, wrestler2: w2, odds1: wo1, odds2: wo2, title: wt, venue: rv, date: new Date(mondayMs + 3 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: "Women's Match" });

      const [rt1, rt2, rto1, rto2, rtt] = rawTitle[weekOffset % rawTitle.length];
      events.push({ id: `raw-${rawDateStr}-title`, wrestler1: rt1, wrestler2: rt2, odds1: rto1, odds2: rto2, title: rtt, venue: rv, date: new Date(mondayMs + 2 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Championship Match' });

      const [t1, t2, to1, to2, tt] = rawTag[weekOffset % rawTag.length];
      events.push({ id: `raw-${rawDateStr}-tag`, wrestler1: t1, wrestler2: t2, odds1: to1, odds2: to2, title: tt, venue: rv, date: new Date(mondayMs + 1 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Tag Team Match' });

      const fridayMs = mondayMs + 4 * 86400000;
      const sdVenueIdx = weekOffset % sdVenues.length;
      const sdDateStr = new Date(fridayMs + 3600000).toISOString().split('T')[0];
      const sv = sdVenues[sdVenueIdx];

      // SmackDown: exactly 4 matches per episode (Main Event, Women's, Title, Tag)
      const [s1, s2, so1, so2, st] = sdMain[weekOffset % sdMain.length];
      events.push({ id: `sd-${sdDateStr}-main`, wrestler1: s1, wrestler2: s2, odds1: so1, odds2: so2, title: st, venue: sv, date: new Date(fridayMs + 4 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Main Event' });

      const [sw1, sw2, swo1, swo2, swt] = sdWomens[weekOffset % sdWomens.length];
      events.push({ id: `sd-${sdDateStr}-women`, wrestler1: sw1, wrestler2: sw2, odds1: swo1, odds2: swo2, title: swt, venue: sv, date: new Date(fridayMs + 3 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: "Women's Match" });

      const [sdt1, sdt2, sdto1, sdto2, sdtt] = sdTitle[weekOffset % sdTitle.length];
      events.push({ id: `sd-${sdDateStr}-title`, wrestler1: sdt1, wrestler2: sdt2, odds1: sdto1, odds2: sdto2, title: sdtt, venue: sv, date: new Date(fridayMs + 2 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Championship Match' });

      const [st1, st2, sto1, sto2, stt] = sdTag[weekOffset % sdTag.length];
      events.push({ id: `sd-${sdDateStr}-tag`, wrestler1: st1, wrestler2: st2, odds1: sto1, odds2: sto2, title: stt, venue: sv, date: new Date(fridayMs + 1 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Tag Team Match' });
    }

    return events;
  }

  private generateWWEEvents(): SportEvent[] {
    const WWE_SPORT_ID = 20;

    const wweEvents: {
      id: string;
      wrestler1: string;
      wrestler2: string;
      odds1: number;
      odds2: number;
      title: string;
      venue: string;
      date: string;
      show: string;
      matchType: string;
    }[] = [
      {
        id: 'wrestlemania42-punk-reigns',
        wrestler1: 'CM Punk (c)',
        wrestler2: 'Roman Reigns',
        odds1: 1.65,
        odds2: 2.20,
        title: 'World Heavyweight Championship',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-19T22:00:00Z',
        show: 'WrestleMania 42 - Night 2',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-rhodes-orton',
        wrestler1: 'Cody Rhodes (c)',
        wrestler2: 'Randy Orton',
        odds1: 1.50,
        odds2: 2.50,
        title: 'Undisputed WWE Championship',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-18T22:00:00Z',
        show: 'WrestleMania 42 - Night 1',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-cargill-ripley',
        wrestler1: 'Jade Cargill (c)',
        wrestler2: 'Rhea Ripley',
        odds1: 2.10,
        odds2: 1.72,
        title: 'WWE Women\'s Championship',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-18T20:00:00Z',
        show: 'WrestleMania 42 - Night 1',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-vaquer-morgan',
        wrestler1: 'Stephanie Vaquer (c)',
        wrestler2: 'Liv Morgan',
        odds1: 1.80,
        odds2: 2.00,
        title: 'Women\'s World Championship',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-19T20:00:00Z',
        show: 'WrestleMania 42 - Night 2',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-lee-lynch',
        wrestler1: 'AJ Lee (c)',
        wrestler2: 'Becky Lynch',
        odds1: 1.90,
        odds2: 1.90,
        title: 'Women\'s Intercontinental Championship',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-18T19:00:00Z',
        show: 'WrestleMania 42 - Night 1',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-rollins-paul',
        wrestler1: 'Seth Rollins',
        wrestler2: 'Logan Paul',
        odds1: 1.40,
        odds2: 2.90,
        title: 'Special Attraction Match',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-19T19:30:00Z',
        show: 'WrestleMania 42 - Night 2',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-lesnar-open',
        wrestler1: 'Brock Lesnar',
        wrestler2: 'Oba Femi',
        odds1: 2.10,
        odds2: 1.72,
        title: 'Open Challenge',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-18T21:00:00Z',
        show: 'WrestleMania 42 - Night 1',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-giulia-flair',
        wrestler1: 'Giulia (c)',
        wrestler2: 'Charlotte Flair',
        odds1: 2.20,
        odds2: 1.65,
        title: 'United States Championship',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-19T18:30:00Z',
        show: 'WrestleMania 42 - Night 2',
        matchType: 'Singles Match'
      },
      {
        id: 'wrestlemania42-hayes-williams',
        wrestler1: 'Carmelo Hayes',
        wrestler2: 'Trick Williams',
        odds1: 1.85,
        odds2: 1.95,
        title: 'Grudge Match',
        venue: 'Allegiant Stadium, Las Vegas',
        date: '2026-04-18T18:30:00Z',
        show: 'WrestleMania 42 - Night 1',
        matchType: 'Singles Match'
      },
      {
        id: 'backlash2026-main',
        wrestler1: 'CM Punk',
        wrestler2: 'Seth Rollins',
        odds1: 1.55,
        odds2: 2.40,
        title: 'World Heavyweight Championship',
        venue: 'Benchmark International Arena, Tampa',
        date: '2026-05-03T23:00:00Z',
        show: 'Backlash 2026',
        matchType: 'Singles Match'
      },
      {
        id: 'backlash2026-womens',
        wrestler1: 'Rhea Ripley',
        wrestler2: 'Bianca Belair',
        odds1: 1.60,
        odds2: 2.30,
        title: 'WWE Women\'s Championship',
        venue: 'Benchmark International Arena, Tampa',
        date: '2026-05-03T22:00:00Z',
        show: 'Backlash 2026',
        matchType: 'Singles Match'
      },
      {
        id: 'backlash2026-tag',
        wrestler1: 'The Usos',
        wrestler2: 'DIY',
        odds1: 1.70,
        odds2: 2.10,
        title: 'Tag Team Championship',
        venue: 'Benchmark International Arena, Tampa',
        date: '2026-05-03T21:00:00Z',
        show: 'Backlash 2026',
        matchType: 'Tag Team Match'
      },
      {
        id: 'clash-italy-main',
        wrestler1: 'Cody Rhodes',
        wrestler2: 'Gunther',
        odds1: 1.75,
        odds2: 2.05,
        title: 'Undisputed WWE Championship',
        venue: 'Inalpi Arena, Turin',
        date: '2026-05-31T20:00:00Z',
        show: 'Clash in Italy',
        matchType: 'Singles Match'
      },
      {
        id: 'clash-italy-womens',
        wrestler1: 'Liv Morgan',
        wrestler2: 'IYO SKY',
        odds1: 1.65,
        odds2: 2.20,
        title: 'Women\'s World Championship',
        venue: 'Inalpi Arena, Turin',
        date: '2026-05-31T19:00:00Z',
        show: 'Clash in Italy',
        matchType: 'Singles Match'
      },
      {
        id: 'summerslam2026-main',
        wrestler1: 'Roman Reigns',
        wrestler2: 'John Cena',
        odds1: 1.45,
        odds2: 2.75,
        title: 'Undisputed WWE Championship',
        venue: 'U.S. Bank Stadium, Minneapolis',
        date: '2026-08-01T23:00:00Z',
        show: 'SummerSlam 2026 - Night 1',
        matchType: 'Singles Match'
      },
      {
        id: 'summerslam2026-wh',
        wrestler1: 'CM Punk',
        wrestler2: 'Drew McIntyre',
        odds1: 1.60,
        odds2: 2.30,
        title: 'World Heavyweight Championship',
        venue: 'U.S. Bank Stadium, Minneapolis',
        date: '2026-08-02T23:00:00Z',
        show: 'SummerSlam 2026 - Night 2',
        matchType: 'Singles Match'
      },
      {
        id: 'summerslam2026-womens',
        wrestler1: 'Rhea Ripley',
        wrestler2: 'Charlotte Flair',
        odds1: 1.55,
        odds2: 2.40,
        title: 'WWE Women\'s Championship',
        venue: 'U.S. Bank Stadium, Minneapolis',
        date: '2026-08-01T21:00:00Z',
        show: 'SummerSlam 2026 - Night 1',
        matchType: 'Singles Match'
      },
      {
        id: 'mitb2026-mens',
        wrestler1: 'LA Knight',
        wrestler2: 'Jey Uso',
        odds1: 2.50,
        odds2: 3.00,
        title: 'Men\'s Money in the Bank Ladder Match',
        venue: 'Smoothie King Center, New Orleans',
        date: '2026-09-06T23:00:00Z',
        show: 'Money in the Bank 2026',
        matchType: 'Ladder Match'
      },
      {
        id: 'mitb2026-womens',
        wrestler1: 'Bianca Belair',
        wrestler2: 'Bayley',
        odds1: 2.80,
        odds2: 3.20,
        title: 'Women\'s Money in the Bank Ladder Match',
        venue: 'Smoothie King Center, New Orleans',
        date: '2026-09-06T22:00:00Z',
        show: 'Money in the Bank 2026',
        matchType: 'Ladder Match'
      },
      {
        id: 'survivor2026-main',
        wrestler1: 'Team Raw',
        wrestler2: 'Team SmackDown',
        odds1: 1.75,
        odds2: 2.05,
        title: 'Men\'s WarGames Match',
        venue: 'Pechanga Arena, San Diego',
        date: '2026-11-29T23:00:00Z',
        show: 'Survivor Series 2026',
        matchType: 'WarGames Match'
      },
      {
        id: 'survivor2026-womens',
        wrestler1: 'Team Raw Women',
        wrestler2: 'Team SmackDown Women',
        odds1: 1.85,
        odds2: 1.95,
        title: 'Women\'s WarGames Match',
        venue: 'Pechanga Arena, San Diego',
        date: '2026-11-29T22:00:00Z',
        show: 'Survivor Series 2026',
        matchType: 'WarGames Match'
      },
      ...this.generateWeeklyWWEShows(),
    ];

    const now = new Date();
    const upcomingEvents = wweEvents.filter(e => new Date(e.date) > now);

    return upcomingEvents.map(event => {
      return {
        id: `wwe_${event.id}`,
        sportId: WWE_SPORT_ID,
        leagueName: event.show,
        homeTeam: event.wrestler1,
        awayTeam: event.wrestler2,
        startTime: event.date,
        status: 'scheduled',
        isLive: false,
        markets: [{
          id: 'match_winner',
          name: 'Match Winner',
          outcomes: [
            { id: 'wrestler1', name: event.wrestler1, odds: event.odds1, probability: 1 / event.odds1 },
            { id: 'wrestler2', name: event.wrestler2, odds: event.odds2, probability: 1 / event.odds2 },
          ]
        }],
        homeOdds: event.odds1,
        awayOdds: event.odds2,
        venue: event.venue,
        eventTitle: event.title,
      } as SportEvent;
    });
  }

  /**
   * WWE settlement: only real results, never random.
   * Since no real-time results API is available for WWE,
   * this returns an empty array so bets remain pending.
   */
  private generateWWEResults(): FreeSportsResult[] {
    console.log('[FreeSports] 🎭 WWE: returning empty results — no random settlement (bets stay pending until real results available)');
    return [];
  }

  private generateF1Schedule(): SportEvent[] {
    const F1_SPORT_ID = 11;
    const f1Races2026: { id: string; gpName: string; circuit: string; date: string }[] = [
      { id: 'australia-gp', gpName: 'Australian Grand Prix', circuit: 'Albert Park Circuit, Melbourne', date: '2026-03-08T05:00:00Z' },
      { id: 'china-gp', gpName: 'Chinese Grand Prix', circuit: 'Shanghai International Circuit', date: '2026-03-15T07:00:00Z' },
      { id: 'japan-gp', gpName: 'Japanese Grand Prix', circuit: 'Suzuka Circuit', date: '2026-03-29T06:00:00Z' },
      { id: 'bahrain-gp', gpName: 'Bahrain Grand Prix', circuit: 'Bahrain International Circuit', date: '2026-04-12T15:00:00Z' },
      { id: 'saudi-gp', gpName: 'Saudi Arabian Grand Prix', circuit: 'Jeddah Corniche Circuit', date: '2026-04-19T17:00:00Z' },
      { id: 'miami-gp', gpName: 'Miami Grand Prix', circuit: 'Miami International Autodrome', date: '2026-05-03T19:30:00Z' },
      { id: 'canada-gp', gpName: 'Canadian Grand Prix', circuit: 'Circuit Gilles Villeneuve, Montréal', date: '2026-05-24T18:00:00Z' },
      { id: 'monaco-gp', gpName: 'Monaco Grand Prix', circuit: 'Circuit de Monaco, Monte Carlo', date: '2026-06-07T13:00:00Z' },
      { id: 'barcelona-gp', gpName: 'Barcelona-Catalunya Grand Prix', circuit: 'Circuit de Barcelona-Catalunya', date: '2026-06-14T13:00:00Z' },
      { id: 'austria-gp', gpName: 'Austrian Grand Prix', circuit: 'Red Bull Ring, Spielberg', date: '2026-06-28T13:00:00Z' },
      { id: 'britain-gp', gpName: 'British Grand Prix', circuit: 'Silverstone Circuit', date: '2026-07-05T14:00:00Z' },
      { id: 'belgium-gp', gpName: 'Belgian Grand Prix', circuit: 'Circuit de Spa-Francorchamps', date: '2026-07-19T13:00:00Z' },
      { id: 'hungary-gp', gpName: 'Hungarian Grand Prix', circuit: 'Hungaroring, Budapest', date: '2026-07-26T13:00:00Z' },
      { id: 'netherlands-gp', gpName: 'Dutch Grand Prix', circuit: 'Circuit Zandvoort', date: '2026-08-23T13:00:00Z' },
      { id: 'italy-gp', gpName: 'Italian Grand Prix', circuit: 'Autodromo Nazionale Monza', date: '2026-09-06T13:00:00Z' },
      { id: 'madrid-gp', gpName: 'Spanish Grand Prix', circuit: 'IFEMA Madrid Street Circuit', date: '2026-09-13T13:00:00Z' },
      { id: 'azerbaijan-gp', gpName: 'Azerbaijan Grand Prix', circuit: 'Baku City Circuit', date: '2026-09-26T12:00:00Z' },
      { id: 'singapore-gp', gpName: 'Singapore Grand Prix', circuit: 'Marina Bay Street Circuit', date: '2026-10-11T12:00:00Z' },
      { id: 'usa-gp', gpName: 'United States Grand Prix', circuit: 'Circuit of the Americas, Austin', date: '2026-10-25T18:00:00Z' },
      { id: 'mexico-gp', gpName: 'Mexico City Grand Prix', circuit: 'Autódromo Hermanos Rodríguez', date: '2026-11-01T19:00:00Z' },
      { id: 'brazil-gp', gpName: 'São Paulo Grand Prix', circuit: 'Autódromo José Carlos Pace, Interlagos', date: '2026-11-08T17:00:00Z' },
      { id: 'lasvegas-gp', gpName: 'Las Vegas Grand Prix', circuit: 'Las Vegas Strip Circuit', date: '2026-11-21T06:00:00Z' },
      { id: 'qatar-f1-gp', gpName: 'Qatar Grand Prix', circuit: 'Losail International Circuit', date: '2026-11-29T15:00:00Z' },
      { id: 'abudhabi-gp', gpName: 'Abu Dhabi Grand Prix', circuit: 'Yas Marina Circuit', date: '2026-12-06T13:00:00Z' },
    ];

    const now = new Date();
    const upcomingRaces = f1Races2026.filter(race => new Date(race.date) > now);
    const racesToShow = upcomingRaces.slice(0, 5);

    return racesToShow.map(race =>
      this.generateF1RaceEvent(race.id, race.gpName, race.circuit, race.date, F1_SPORT_ID)
    );
  }

  private generateUFCEvents(): SportEvent[] {
    const MMA_SPORT_ID = 7;
    const ufcFights: {
      id: string; fighter1: string; fighter2: string;
      odds1: number; odds2: number; title: string; venue: string;
      date: string; card: string;
    }[] = [
      { id: 'ufc326-main', fighter1: 'Max Holloway', fighter2: 'Charles Oliveira', odds1: 1.65, odds2: 2.25, title: 'BMF Title', venue: 'UFC APEX, Las Vegas', date: '2026-03-08T01:00:00Z', card: 'UFC 326' },
      { id: 'ufc-fn-mar14-main', fighter1: 'Josh Emmett', fighter2: 'Kevin Vallejos', odds1: 1.22, odds2: 4.50, title: 'Featherweight Main Event', venue: 'UFC APEX, Las Vegas', date: '2026-03-15T01:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc-fn-mar14-co', fighter1: 'Amanda Lemos', fighter2: 'Virna Jandiroba', odds1: 1.57, odds2: 2.45, title: 'Women\'s Strawweight', venue: 'UFC APEX, Las Vegas', date: '2026-03-15T00:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc-fn-mar21-main', fighter1: 'Movsar Evloev', fighter2: 'Lerone Murphy', odds1: 1.40, odds2: 3.00, title: 'Featherweight Main Event', venue: 'UFC APEX, Las Vegas', date: '2026-03-22T01:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc-fn-mar21-co', fighter1: 'Jailton Almeida', fighter2: 'Alexandr Romanov', odds1: 1.18, odds2: 5.25, title: 'Heavyweight', venue: 'UFC APEX, Las Vegas', date: '2026-03-22T00:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc-fn-mar28-main', fighter1: 'Israel Adesanya', fighter2: 'Joe Pyfer', odds1: 1.30, odds2: 3.60, title: 'Middleweight Main Event', venue: 'UFC APEX, Las Vegas', date: '2026-03-29T01:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc-fn-mar28-co', fighter1: 'Dustin Poirier', fighter2: 'Benoit Saint-Denis', odds1: 2.20, odds2: 1.72, title: 'Lightweight Co-Main', venue: 'UFC APEX, Las Vegas', date: '2026-03-29T00:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc-fn-apr04-main', fighter1: 'Renato Moicano', fighter2: 'Chris Duncan', odds1: 1.35, odds2: 3.25, title: 'Lightweight Main Event', venue: 'UFC APEX, Las Vegas', date: '2026-04-05T01:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc327-main', fighter1: 'Jiri Prochazka', fighter2: 'Carlos Ulberg', odds1: 1.48, odds2: 2.75, title: 'Vacant Light Heavyweight Championship', venue: 'Kaseya Center, Miami', date: '2026-04-12T01:00:00Z', card: 'UFC 327' },
      { id: 'ufc327-co', fighter1: 'Joshua Van', fighter2: 'Tatsuro Taira', odds1: 2.30, odds2: 1.65, title: 'Flyweight Championship', venue: 'Kaseya Center, Miami', date: '2026-04-12T00:00:00Z', card: 'UFC 327' },
      { id: 'ufc327-3', fighter1: 'Patricio Pitbull', fighter2: 'Aaron Pico', odds1: 1.91, odds2: 1.91, title: 'Featherweight', venue: 'Kaseya Center, Miami', date: '2026-04-11T23:00:00Z', card: 'UFC 327' },
      { id: 'ufc327-4', fighter1: 'Dominick Reyes', fighter2: 'Johnny Walker', odds1: 1.80, odds2: 2.05, title: 'Light Heavyweight', venue: 'Kaseya Center, Miami', date: '2026-04-11T22:30:00Z', card: 'UFC 327' },
      { id: 'ufc327-5', fighter1: 'Curtis Blaydes', fighter2: 'Josh Hokit', odds1: 1.25, odds2: 4.00, title: 'Heavyweight', venue: 'Kaseya Center, Miami', date: '2026-04-11T22:00:00Z', card: 'UFC 327' },
      { id: 'ufc327-6', fighter1: 'Tatiana Suarez', fighter2: 'Loopy Godinez', odds1: 1.40, odds2: 3.00, title: 'Women\'s Strawweight', venue: 'Kaseya Center, Miami', date: '2026-04-11T21:30:00Z', card: 'UFC 327' },
      { id: 'ufc-fn-apr24-main', fighter1: 'Sean Brady', fighter2: 'Joaquin Buckley', odds1: 1.65, odds2: 2.25, title: 'Welterweight Main Event', venue: 'UFC APEX, Las Vegas', date: '2026-04-24T20:30:00Z', card: 'UFC Fight Night' },
      { id: 'ufc-fn-may02-main', fighter1: 'Jack Della Maddalena', fighter2: 'Carlos Prates', odds1: 1.55, odds2: 2.50, title: 'Welterweight Main Event', venue: 'UFC APEX, Las Vegas', date: '2026-05-02T11:00:00Z', card: 'UFC Fight Night' },
      { id: 'ufc328-main', fighter1: 'Alexander Volkov', fighter2: 'Waldo Cortes-Acosta', odds1: 1.40, odds2: 3.00, title: 'Heavyweight Main Event', venue: 'Prudential Center, Newark', date: '2026-05-10T02:00:00Z', card: 'UFC 328' },
      { id: 'ufc328-co', fighter1: 'Jan Blachowicz', fighter2: 'Bogdan Guskov', odds1: 1.70, odds2: 2.15, title: 'Light Heavyweight', venue: 'Prudential Center, Newark', date: '2026-05-10T01:00:00Z', card: 'UFC 328' },
    ];

    const now = new Date();
    const upcomingFights = ufcFights.filter(f => new Date(f.date) > now);

    return upcomingFights.map(fight => {
      return {
        id: `mma_gen_${fight.id}`,
        sportId: MMA_SPORT_ID,
        leagueName: fight.card,
        homeTeam: fight.fighter1,
        awayTeam: fight.fighter2,
        startTime: fight.date,
        status: 'scheduled',
        isLive: false,
        markets: [{
          id: 'match_winner',
          name: 'Fight Winner',
          outcomes: [
            { id: 'fighter1', name: fight.fighter1, odds: fight.odds1, probability: 1 / fight.odds1 },
            { id: 'fighter2', name: fight.fighter2, odds: fight.odds2, probability: 1 / fight.odds2 },
          ]
        }],
        homeOdds: fight.odds1,
        awayOdds: fight.odds2,
        venue: fight.venue,
        eventTitle: fight.title,
      } as SportEvent;
    });
  }

  private generateTennisEvents(): SportEvent[] {
    const TENNIS_SPORT_ID = 3;

    const tennisMatches: {
      id: string; player1: string; player2: string; ranking1: number; ranking2: number;
      odds1: number; odds2: number; tournament: string; round: string; date: string;
      surface: string; location: string;
    }[] = [
      { id: 'iw-alcaraz-sinner', player1: 'Carlos Alcaraz', player2: 'Jannik Sinner', ranking1: 1, ranking2: 2, odds1: 1.80, odds2: 2.00, tournament: 'BNP Paribas Open', round: 'Final', date: '2026-03-15T21:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-djokovic-fritz', player1: 'Novak Djokovic', player2: 'Taylor Fritz', ranking1: 5, ranking2: 4, odds1: 1.65, odds2: 2.20, tournament: 'BNP Paribas Open', round: 'Semi-Final', date: '2026-03-14T21:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-zverev-draper', player1: 'Alexander Zverev', player2: 'Jack Draper', ranking1: 3, ranking2: 8, odds1: 1.55, odds2: 2.40, tournament: 'BNP Paribas Open', round: 'Semi-Final', date: '2026-03-14T18:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-medvedev-shelton', player1: 'Daniil Medvedev', player2: 'Ben Shelton', ranking1: 6, ranking2: 10, odds1: 1.60, odds2: 2.30, tournament: 'BNP Paribas Open', round: 'Quarter-Final', date: '2026-03-13T21:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-rublev-musetti', player1: 'Andrey Rublev', player2: 'Lorenzo Musetti', ranking1: 9, ranking2: 15, odds1: 1.50, odds2: 2.55, tournament: 'BNP Paribas Open', round: 'Quarter-Final', date: '2026-03-13T18:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'miami-sinner-zverev', player1: 'Jannik Sinner', player2: 'Alexander Zverev', ranking1: 2, ranking2: 3, odds1: 1.70, odds2: 2.10, tournament: 'Miami Open', round: 'Final', date: '2026-03-29T20:00:00Z', surface: 'Hard', location: 'Miami, USA' },
      { id: 'miami-alcaraz-fritz', player1: 'Carlos Alcaraz', player2: 'Taylor Fritz', ranking1: 1, ranking2: 4, odds1: 1.50, odds2: 2.55, tournament: 'Miami Open', round: 'Semi-Final', date: '2026-03-28T20:00:00Z', surface: 'Hard', location: 'Miami, USA' },
      { id: 'miami-djokovic-shelton', player1: 'Novak Djokovic', player2: 'Ben Shelton', ranking1: 5, ranking2: 10, odds1: 1.55, odds2: 2.40, tournament: 'Miami Open', round: 'Semi-Final', date: '2026-03-28T17:00:00Z', surface: 'Hard', location: 'Miami, USA' },
      { id: 'mc-alcaraz-djokovic', player1: 'Carlos Alcaraz', player2: 'Novak Djokovic', ranking1: 1, ranking2: 5, odds1: 1.60, odds2: 2.30, tournament: 'Monte-Carlo Masters', round: 'Final', date: '2026-04-12T14:00:00Z', surface: 'Clay', location: 'Monte-Carlo, Monaco' },
      { id: 'mc-sinner-rublev', player1: 'Jannik Sinner', player2: 'Andrey Rublev', ranking1: 2, ranking2: 9, odds1: 1.40, odds2: 2.85, tournament: 'Monte-Carlo Masters', round: 'Semi-Final', date: '2026-04-11T14:00:00Z', surface: 'Clay', location: 'Monte-Carlo, Monaco' },
      { id: 'madrid-sinner-alcaraz', player1: 'Jannik Sinner', player2: 'Carlos Alcaraz', ranking1: 2, ranking2: 1, odds1: 2.00, odds2: 1.80, tournament: 'Madrid Open', round: 'Final', date: '2026-05-03T16:00:00Z', surface: 'Clay', location: 'Madrid, Spain' },
      { id: 'madrid-zverev-fritz', player1: 'Alexander Zverev', player2: 'Taylor Fritz', ranking1: 3, ranking2: 4, odds1: 1.55, odds2: 2.40, tournament: 'Madrid Open', round: 'Semi-Final', date: '2026-05-02T14:00:00Z', surface: 'Clay', location: 'Madrid, Spain' },
      { id: 'rome-sinner-alcaraz', player1: 'Jannik Sinner', player2: 'Carlos Alcaraz', ranking1: 2, ranking2: 1, odds1: 1.90, odds2: 1.90, tournament: 'Italian Open', round: 'Final', date: '2026-05-17T14:00:00Z', surface: 'Clay', location: 'Rome, Italy' },
      { id: 'rome-djokovic-zverev', player1: 'Novak Djokovic', player2: 'Alexander Zverev', ranking1: 5, ranking2: 3, odds1: 1.75, odds2: 2.05, tournament: 'Italian Open', round: 'Semi-Final', date: '2026-05-16T14:00:00Z', surface: 'Clay', location: 'Rome, Italy' },
      { id: 'rome-fritz-rublev', player1: 'Taylor Fritz', player2: 'Andrey Rublev', ranking1: 4, ranking2: 9, odds1: 1.85, odds2: 1.95, tournament: 'Italian Open', round: 'Semi-Final', date: '2026-05-16T11:00:00Z', surface: 'Clay', location: 'Rome, Italy' },
      { id: 'rg-alcaraz-sinner', player1: 'Carlos Alcaraz', player2: 'Jannik Sinner', ranking1: 1, ranking2: 2, odds1: 1.55, odds2: 2.40, tournament: 'French Open', round: 'Final', date: '2026-06-07T14:00:00Z', surface: 'Clay', location: 'Paris, France' },
      { id: 'rg-djokovic-zverev', player1: 'Novak Djokovic', player2: 'Alexander Zverev', ranking1: 5, ranking2: 3, odds1: 1.70, odds2: 2.10, tournament: 'French Open', round: 'Semi-Final', date: '2026-06-06T14:00:00Z', surface: 'Clay', location: 'Paris, France' },
      { id: 'rg-fritz-shelton', player1: 'Taylor Fritz', player2: 'Ben Shelton', ranking1: 4, ranking2: 10, odds1: 1.55, odds2: 2.40, tournament: 'French Open', round: 'Quarter-Final', date: '2026-06-04T14:00:00Z', surface: 'Clay', location: 'Paris, France' },
      { id: 'rg-draper-rublev', player1: 'Jack Draper', player2: 'Andrey Rublev', ranking1: 8, ranking2: 9, odds1: 1.90, odds2: 1.90, tournament: 'French Open', round: 'Quarter-Final', date: '2026-06-04T11:00:00Z', surface: 'Clay', location: 'Paris, France' },
      { id: 'halle-sinner-fritz', player1: 'Jannik Sinner', player2: 'Taylor Fritz', ranking1: 2, ranking2: 4, odds1: 1.45, odds2: 2.70, tournament: 'Terra Wortmann Open', round: 'Final', date: '2026-06-21T14:00:00Z', surface: 'Grass', location: 'Halle, Germany' },
      { id: 'queens-alcaraz-draper', player1: 'Carlos Alcaraz', player2: 'Jack Draper', ranking1: 1, ranking2: 8, odds1: 1.40, odds2: 2.85, tournament: 'Queens Club Championships', round: 'Final', date: '2026-06-21T14:00:00Z', surface: 'Grass', location: 'London, UK' },
      { id: 'wim-alcaraz-sinner', player1: 'Carlos Alcaraz', player2: 'Jannik Sinner', ranking1: 1, ranking2: 2, odds1: 1.75, odds2: 2.05, tournament: 'Wimbledon', round: 'Final', date: '2026-07-12T14:00:00Z', surface: 'Grass', location: 'London, UK' },
      { id: 'wim-djokovic-fritz', player1: 'Novak Djokovic', player2: 'Taylor Fritz', ranking1: 5, ranking2: 4, odds1: 1.60, odds2: 2.30, tournament: 'Wimbledon', round: 'Semi-Final', date: '2026-07-11T14:00:00Z', surface: 'Grass', location: 'London, UK' },
      { id: 'wim-zverev-shelton', player1: 'Alexander Zverev', player2: 'Ben Shelton', ranking1: 3, ranking2: 10, odds1: 1.55, odds2: 2.40, tournament: 'Wimbledon', round: 'Semi-Final', date: '2026-07-11T11:00:00Z', surface: 'Grass', location: 'London, UK' },
      { id: 'wim-draper-medvedev', player1: 'Jack Draper', player2: 'Daniil Medvedev', ranking1: 8, ranking2: 6, odds1: 1.72, odds2: 2.10, tournament: 'Wimbledon', round: 'Quarter-Final', date: '2026-07-09T14:00:00Z', surface: 'Grass', location: 'London, UK' },
      { id: 'cin-sinner-zverev', player1: 'Jannik Sinner', player2: 'Alexander Zverev', ranking1: 2, ranking2: 3, odds1: 1.55, odds2: 2.40, tournament: 'Cincinnati Masters', round: 'Final', date: '2026-08-23T19:00:00Z', surface: 'Hard', location: 'Cincinnati, USA' },
      { id: 'cin-alcaraz-medvedev', player1: 'Carlos Alcaraz', player2: 'Daniil Medvedev', ranking1: 1, ranking2: 6, odds1: 1.45, odds2: 2.70, tournament: 'Cincinnati Masters', round: 'Semi-Final', date: '2026-08-22T19:00:00Z', surface: 'Hard', location: 'Cincinnati, USA' },
      { id: 'uso-sinner-alcaraz', player1: 'Jannik Sinner', player2: 'Carlos Alcaraz', ranking1: 2, ranking2: 1, odds1: 1.85, odds2: 1.95, tournament: 'US Open', round: 'Final', date: '2026-09-13T20:00:00Z', surface: 'Hard', location: 'New York, USA' },
      { id: 'uso-djokovic-fritz', player1: 'Novak Djokovic', player2: 'Taylor Fritz', ranking1: 5, ranking2: 4, odds1: 1.65, odds2: 2.20, tournament: 'US Open', round: 'Semi-Final', date: '2026-09-12T19:00:00Z', surface: 'Hard', location: 'New York, USA' },
      { id: 'uso-zverev-draper', player1: 'Alexander Zverev', player2: 'Jack Draper', ranking1: 3, ranking2: 8, odds1: 1.60, odds2: 2.30, tournament: 'US Open', round: 'Semi-Final', date: '2026-09-12T16:00:00Z', surface: 'Hard', location: 'New York, USA' },
      { id: 'uso-shelton-rublev', player1: 'Ben Shelton', player2: 'Andrey Rublev', ranking1: 10, ranking2: 9, odds1: 1.80, odds2: 2.00, tournament: 'US Open', round: 'Quarter-Final', date: '2026-09-10T19:00:00Z', surface: 'Hard', location: 'New York, USA' },
    ];

    const now = new Date();
    const upcomingMatches = tennisMatches.filter(m => new Date(m.date) > now);
    const matchesToShow = upcomingMatches.slice(0, 8);

    return matchesToShow.map(match => ({
      id: `tennis_${match.id}`,
      sportId: TENNIS_SPORT_ID,
      leagueName: `${match.tournament} - ${match.round}`,
      homeTeam: match.player1,
      awayTeam: match.player2,
      startTime: match.date,
      status: 'scheduled',
      isLive: false,
      markets: [{
        id: 'match_winner',
        name: 'Match Winner',
        outcomes: [
          { id: 'player1', name: match.player1, odds: match.odds1, probability: 1 / match.odds1 },
          { id: 'player2', name: match.player2, odds: match.odds2, probability: 1 / match.odds2 },
        ]
      }],
      homeOdds: match.odds1,
      awayOdds: match.odds2,
      venue: match.location,
      surface: match.surface,
    } as SportEvent));
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

            const cricketRatings: Record<string, number> = {
              'india': 95, 'australia': 92, 'england': 88, 'south africa': 86,
              'new zealand': 84, 'pakistan': 83, 'sri lanka': 75, 'west indies': 73,
              'bangladesh': 68, 'afghanistan': 66, 'zimbabwe': 58, 'ireland': 55,
              'netherlands': 50, 'scotland': 48, 'nepal': 45, 'oman': 42,
              'usa': 44, 'uae': 43, 'namibia': 46, 'kenya': 40,
              'canada': 41, 'hong kong': 38, 'papua new guinea': 36, 'jersey': 35,
              'bermuda': 33, 'italy': 34, 'germany': 32, 'denmark': 31,
              'singapore': 30, 'malaysia': 29, 'uganda': 37, 'tanzania': 28,
              'mexico': 25, 'argentina': 26, 'brazil': 24, 'chile': 23,
              'peru': 22, 'suriname': 27, 'cayman': 20, 'bahamas': 21,
              'belize': 19, 'costa rica': 18, 'panama': 17, 'samoa': 28,
              'vanuatu': 30, 'fiji': 29, 'japan': 35, 'china': 20,
              'thailand': 32, 'philippines': 22, 'myanmar': 18,
              'central districts': 65, 'northern districts': 63, 'otago': 62,
              'canterbury': 64, 'auckland': 66, 'wellington': 63,
            };
            const rateTeam = (name: string) => {
              const n = name.toLowerCase().trim();
              for (const [key, val] of Object.entries(cricketRatings)) {
                if (n.includes(key)) return val;
              }
              return 40;
            };
            const rH = rateTeam(homeTeam);
            const rA = rateTeam(awayTeam);
            const homeAdv = 1.03;
            const OVERROUND = format === 'TEST' ? 1.08 : 1.06;
            const rawPH = (rH * homeAdv) / (rH * homeAdv + rA);
            const cricketSeed = `${homeTeam}_${awayTeam}`.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
            const cSeededRand = (offset: number) => { const x = Math.sin(Math.abs(cricketSeed) + offset) * 10000; return x - Math.floor(x); };
            const jitterC = (cSeededRand(5) - 0.5) * 0.04;
            const pH = Math.max(0.08, Math.min(0.92, rawPH + jitterC));
            const pA = 1 - pH;

            let homeOdds: number, awayOdds: number, drawOdds: number | undefined;
            if (format === 'TEST') {
              const drawProb = 0.18 + (cSeededRand(6) - 0.5) * 0.06;
              const remProb = 1 - drawProb;
              const testPH = pH * remProb;
              const testPA = pA * remProb;
              homeOdds = parseFloat(Math.max(1.10, 1 / (testPH * OVERROUND)).toFixed(2));
              awayOdds = parseFloat(Math.max(1.10, 1 / (testPA * OVERROUND)).toFixed(2));
              drawOdds = parseFloat(Math.max(2.00, 1 / (drawProb * OVERROUND)).toFixed(2));
            } else {
              homeOdds = parseFloat(Math.max(1.10, 1 / (pH * OVERROUND)).toFixed(2));
              awayOdds = parseFloat(Math.max(1.10, 1 / (pA * OVERROUND)).toFixed(2));
              drawOdds = undefined;
            }

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
      if (events.length > 0) return events;
      console.warn('[FreeSports] 🏏 Cricket API returned 0 events — using static fallback generator');
      return this.generateCricketEvents();
    } catch (error: any) {
      console.error(`[FreeSports] 🏏 Cricket fetch error: ${error.message} — using static fallback`);
      return this.generateCricketEvents();
    }
  }

  private generateCricketEvents(): SportEvent[] {
    const CRICKET_SPORT_ID = 18;
    const OVERROUND = 1.10;

    // ICC rankings-based strength ratings (2026)
    const intlTeams: Record<string, number> = {
      'India': 95, 'Australia': 92, 'England': 89, 'South Africa': 87,
      'New Zealand': 86, 'Pakistan': 84, 'Sri Lanka': 82, 'Bangladesh': 80,
      'West Indies': 78, 'Zimbabwe': 72, 'Afghanistan': 75, 'Ireland': 70,
    };

    // IPL 2026 team strength ratings
    const iplTeams: Record<string, number> = {
      'Mumbai Indians': 90, 'Chennai Super Kings': 89, 'Kolkata Knight Riders': 87,
      'Royal Challengers Bangalore': 86, 'Rajasthan Royals': 85, 'Gujarat Titans': 85,
      'Sunrisers Hyderabad': 84, 'Delhi Capitals': 83, 'Lucknow Super Giants': 83,
      'Punjab Kings': 82,
    };

    const events: SportEvent[] = [];
    const now = new Date();

    const makeMatch = (
      t1: string, t2: string, r1: number, r2: number,
      series: string, dateStr: string, hasDraws: boolean
    ) => {
      if (new Date(dateStr) <= now) return;
      const [o1, o2] = this.calcNicheOdds(r1, r2, 4, OVERROUND);
      const id = `cricket_gen_${t1.replace(/\s+/g,'_').toLowerCase()}_${t2.replace(/\s+/g,'_').toLowerCase()}_${new Date(dateStr).getTime()}`;
      const outcomes: OutcomeData[] = [
        { id: 'home', name: t1, odds: o1, probability: 1 / o1 },
        { id: 'away', name: t2, odds: o2, probability: 1 / o2 },
      ];
      if (hasDraws) {
        const drawOdds = parseFloat(Math.max(2.80, (o1 + o2) * 0.55).toFixed(2));
        outcomes.splice(1, 0, { id: 'draw', name: 'Draw', odds: drawOdds, probability: 1 / drawOdds });
      }
      events.push({
        id, sportId: CRICKET_SPORT_ID, leagueName: series,
        homeTeam: t1, awayTeam: t2,
        startTime: dateStr, status: 'scheduled', isLive: false,
        homeOdds: o1, awayOdds: o2,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes }],
      } as SportEvent);
    };

    // --- International series (Test, ODI, T20I) ---
    // Bangladesh vs Zimbabwe Test series (March 2026)
    makeMatch('Bangladesh', 'Zimbabwe', intlTeams['Bangladesh'], intlTeams['Zimbabwe'],
      'Bangladesh vs Zimbabwe - Test Series', '2026-03-20T06:00:00Z', true);
    makeMatch('Bangladesh', 'Zimbabwe', intlTeams['Bangladesh'], intlTeams['Zimbabwe'],
      'Bangladesh vs Zimbabwe - Test Series', '2026-03-28T06:00:00Z', true);

    // Sri Lanka vs Australia ODI series (March 2026)
    makeMatch('Sri Lanka', 'Australia', intlTeams['Sri Lanka'], intlTeams['Australia'],
      'Sri Lanka vs Australia - ODI Series', '2026-03-22T10:00:00Z', false);
    makeMatch('Sri Lanka', 'Australia', intlTeams['Sri Lanka'], intlTeams['Australia'],
      'Sri Lanka vs Australia - ODI Series', '2026-03-25T10:00:00Z', false);
    makeMatch('Sri Lanka', 'Australia', intlTeams['Sri Lanka'], intlTeams['Australia'],
      'Sri Lanka vs Australia - ODI Series', '2026-03-28T10:00:00Z', false);

    // West Indies vs India T20I series
    makeMatch('West Indies', 'India', intlTeams['West Indies'], intlTeams['India'],
      'West Indies vs India - T20I Series', '2026-03-26T23:00:00Z', false);
    makeMatch('West Indies', 'India', intlTeams['West Indies'], intlTeams['India'],
      'West Indies vs India - T20I Series', '2026-03-29T23:00:00Z', false);
    makeMatch('West Indies', 'India', intlTeams['West Indies'], intlTeams['India'],
      'West Indies vs India - T20I Series', '2026-04-01T23:00:00Z', false);

    // Pakistan vs New Zealand ODI series
    makeMatch('Pakistan', 'New Zealand', intlTeams['Pakistan'], intlTeams['New Zealand'],
      'Pakistan vs New Zealand - ODI Series', '2026-04-05T14:00:00Z', false);
    makeMatch('Pakistan', 'New Zealand', intlTeams['Pakistan'], intlTeams['New Zealand'],
      'Pakistan vs New Zealand - ODI Series', '2026-04-07T14:00:00Z', false);
    makeMatch('Pakistan', 'New Zealand', intlTeams['Pakistan'], intlTeams['New Zealand'],
      'Pakistan vs New Zealand - ODI Series', '2026-04-09T14:00:00Z', false);

    // England vs South Africa T20I
    makeMatch('England', 'South Africa', intlTeams['England'], intlTeams['South Africa'],
      'England vs South Africa - T20I Series', '2026-04-16T17:00:00Z', false);
    makeMatch('England', 'South Africa', intlTeams['England'], intlTeams['South Africa'],
      'England vs South Africa - T20I Series', '2026-04-18T17:00:00Z', false);
    makeMatch('England', 'South Africa', intlTeams['England'], intlTeams['South Africa'],
      'England vs South Africa - T20I Series', '2026-04-20T17:00:00Z', false);

    // --- IPL 2026 (Indian Premier League) - season starts ~March 22 ---
    const iplMatches: [string, string, string][] = [
      ['Mumbai Indians', 'Royal Challengers Bangalore', '2026-03-22T14:00:00Z'],
      ['Chennai Super Kings', 'Kolkata Knight Riders', '2026-03-23T14:00:00Z'],
      ['Rajasthan Royals', 'Delhi Capitals', '2026-03-24T14:00:00Z'],
      ['Gujarat Titans', 'Punjab Kings', '2026-03-25T14:00:00Z'],
      ['Sunrisers Hyderabad', 'Lucknow Super Giants', '2026-03-26T14:00:00Z'],
      ['Mumbai Indians', 'Chennai Super Kings', '2026-03-28T14:00:00Z'],
      ['Kolkata Knight Riders', 'Rajasthan Royals', '2026-03-29T14:00:00Z'],
      ['Royal Challengers Bangalore', 'Gujarat Titans', '2026-03-30T14:00:00Z'],
      ['Delhi Capitals', 'Sunrisers Hyderabad', '2026-04-01T14:00:00Z'],
      ['Punjab Kings', 'Mumbai Indians', '2026-04-02T14:00:00Z'],
      ['Lucknow Super Giants', 'Chennai Super Kings', '2026-04-03T14:00:00Z'],
      ['Rajasthan Royals', 'Royal Challengers Bangalore', '2026-04-04T14:00:00Z'],
    ];

    for (const [t1, t2, date] of iplMatches) {
      makeMatch(t1, t2, iplTeams[t1], iplTeams[t2], 'IPL 2026 - Indian Premier League', date, false);
    }

    console.log(`[FreeSports] 🏏 Cricket (static fallback): ${events.length} upcoming matches`);
    return events.slice(0, 30);
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

  private async fetchHorseRacing(): Promise<SportEvent[]> {
    if (!RAPIDAPI_KEY) {
      console.warn('[FreeSports] No RAPIDAPI_KEY set, skipping horse racing');
      return [];
    }

    try {
      console.log('[FreeSports] 🏇 Fetching horse racing from The Racing API...');
      const events: SportEvent[] = [];
      const now = Date.now();

      const fetchWithRetry = async (url: string, maxRetries = 3): Promise<any> => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await axios.get(url, {
              headers: {
                'x-rapidapi-host': RACING_API_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY,
                'Accept': 'application/json'
              },
              timeout: 15000
            });
            return response;
          } catch (err: any) {
            if (err.response?.status === 429 && attempt < maxRetries) {
              const wait = Math.min(5000 * Math.pow(2, attempt), 30000);
              console.log(`[FreeSports] 🏇 Rate limited (429), retrying in ${wait/1000}s (attempt ${attempt + 1}/${maxRetries})...`);
              await new Promise(r => setTimeout(r, wait));
              continue;
            }
            throw err;
          }
        }
      };

      for (const day of ['today', 'tomorrow']) {
        const response = await fetchWithRetry(`${RACING_API_BASE}/v1/racecards/free?day=${day}`);

        const racecards = response.data?.racecards || [];

        for (const race of racecards) {
          if (!race.race_id || !race.runners || race.runners.length < 2) continue;

          const raceStart = new Date(race.off_dt).getTime();
          if (isNaN(raceStart) || raceStart < now) continue;

          const runners = race.runners.filter((r: any) => {
            const num = String(r.number || '').toUpperCase();
            return num !== 'NR' && num !== 'N/R' && num !== 'SCR';
          });

          if (runners.length < 2) continue;

          const fieldSize = runners.length;
          const rawScores = runners.map((runner: any, idx: number) => {
            const formScore = this.calculateFormScore(runner.form || '');
            const drawAdv = (runner.draw && runner.draw <= 4) ? 0.2 : 0;
            const weightPen = runner.lbs ? Math.max(0, (runner.lbs - 140) * 0.005) : 0;
            const positionBias = idx * 0.08;
            return Math.max(0.1, 1.0 + formScore * 1.5 + drawAdv - weightPen - positionBias);
          });

          const rawPowers = rawScores.map(s => Math.pow(s, 3.0));
          const totalPower = rawPowers.reduce((s: number, v: number) => s + v, 0);
          const OVERROUND = 1.15 + (fieldSize > 8 ? 0.05 : 0) + (fieldSize > 14 ? 0.05 : 0);

          const winOutcomes: OutcomeData[] = runners.map((runner: any, idx: number) => {
            const fairProb = rawPowers[idx] / totalPower;
            const jitter = (Math.random() - 0.5) * 0.01;
            const adjProb = Math.max(0.015, Math.min(0.65, fairProb + jitter));
            const bookedProb = adjProb * OVERROUND;
            const odds = parseFloat(Math.max(1.20, 1 / bookedProb).toFixed(2));
            return {
              id: `runner_${runner.number || idx}`,
              name: runner.horse || `Runner ${idx + 1}`,
              odds,
              probability: 1 / odds
            };
          });

          const placeOutcomes: OutcomeData[] = winOutcomes.map(w => {
            const placeFactor = fieldSize >= 8 ? 3.0 : fieldSize >= 5 ? 2.5 : 2.0;
            const placeOdds = parseFloat(Math.max(1.10, ((w.odds - 1) / placeFactor) + 1).toFixed(2));
            return { id: w.id, name: w.name, odds: placeOdds, probability: 1 / placeOdds };
          });

          const showOutcomes: OutcomeData[] = winOutcomes.map(w => {
            const showFactor = fieldSize >= 8 ? 5.0 : fieldSize >= 5 ? 4.0 : 3.0;
            const showOdds = parseFloat(Math.max(1.05, ((w.odds - 1) / showFactor) + 1).toFixed(2));
            return { id: w.id, name: w.name, odds: showOdds, probability: 1 / showOdds };
          });

          const markets: MarketData[] = [
            { id: 'race_winner', name: 'Win', outcomes: winOutcomes },
            { id: 'race_place', name: 'Place', outcomes: placeOutcomes },
            { id: 'race_show', name: 'Show', outcomes: showOutcomes },
          ];

          const courseName = race.course || 'Unknown Course';
          const region = race.region || '';
          const raceType = race.type || 'Flat';
          const distance = race.distance_f ? `${race.distance_f}f` : '';
          const going = race.going || '';
          const raceClass = race.race_class || '';

          const runnersInfo = runners.map((r: any) => ({
            name: r.horse,
            number: r.number,
            jockey: r.jockey,
            trainer: r.trainer,
            form: r.form,
            age: r.age,
            weight: r.lbs,
            draw: r.draw,
            headgear: r.headgear,
            sire: r.sire,
            dam: r.dam,
          }));

          events.push({
            id: `horse-racing_${race.race_id}`,
            sportId: HORSE_RACING_SPORT_ID,
            leagueName: `${courseName} (${region})`,
            homeTeam: race.race_name || 'Race',
            awayTeam: `${raceType} ${distance} - ${going}`.trim(),
            startTime: new Date(raceStart).toISOString(),
            status: 'scheduled',
            isLive: false,
            markets,
            homeOdds: winOutcomes[0]?.odds || 3.0,
            awayOdds: winOutcomes[1]?.odds || 4.0,
            venue: courseName,
            runnersInfo,
            raceDetails: {
              course: courseName,
              region,
              raceType,
              distance,
              going,
              surface: race.surface || 'Turf',
              raceClass,
              prize: race.prize || '',
              fieldSize: parseInt(race.field_size) || runners.length,
              ageBand: race.age_band || '',
              pattern: race.pattern || '',
            },
          } as SportEvent);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`[FreeSports] 🏇 Horse Racing: ${events.length} races fetched (today + tomorrow)`);
      return events;
    } catch (error: any) {
      console.error(`[FreeSports] 🏇 Horse Racing fetch error: ${error.message}`);
      console.log('[FreeSports] 🏇 Generating fallback horse racing events...');
      return this.generateFallbackHorseRacing();
    }
  }

  private generateFallbackHorseRacing(): SportEvent[] {
    const events: SportEvent[] = [];
    const now = new Date();

    const courses = [
      { name: 'Cheltenham', region: 'GB', surface: 'Turf', going: 'Good to Soft' },
      { name: 'Ascot', region: 'GB', surface: 'Turf', going: 'Good' },
      { name: 'Newmarket', region: 'GB', surface: 'Turf', going: 'Good to Firm' },
      { name: 'Kempton Park', region: 'GB', surface: 'All Weather', going: 'Standard' },
      { name: 'Leopardstown', region: 'IRE', surface: 'Turf', going: 'Yielding' },
      { name: 'Aqueduct', region: 'USA', surface: 'Dirt', going: 'Fast' },
      { name: 'Santa Anita', region: 'USA', surface: 'Dirt', going: 'Fast' },
      { name: 'Gulfstream Park', region: 'USA', surface: 'Dirt', going: 'Fast' },
    ];

    const horseNames = [
      'Desert Crown', 'Coroebus', 'Baaeed', 'Inspiral', 'Nashwa',
      'Emily Upjohn', 'Luxembourg', 'Paddington', 'Mostahdaf', 'Magical Lagoon',
      'Auguste Rodin', 'King of Steel', 'Haskoy', 'Warm Heart', 'Westover',
      'Aidan\'s Dream', 'Sea Commander', 'Storm Rising', 'Night Flyer', 'Royal Fortune',
      'Silver Bullet', 'Thunder Strike', 'Dawn Patrol', 'Golden Mile', 'Star Chaser',
      'Celtic Prince', 'Iron Duke', 'Wild Spirit', 'Flash Point', 'Dark Ruler',
      'Swift Arrow', 'Blue Ridge', 'Noble Quest', 'Storm King', 'Brave Heart',
      'Fast Lane', 'Crystal Clear', 'Bold Move', 'Tiger Run', 'Moon Shadow',
    ];

    const jockeys = [
      'R. Moore', 'W. Buick', 'F. Dettori', 'T. Marquand', 'J. Doyle',
      'O. Murphy', 'B. Doyle', 'R. Kingscote', 'J. Spencer', 'P. Hanagan',
      'C. Soumillon', 'S. De Sousa', 'D. Tudhope', 'J. Crowley', 'L. Dettori',
    ];

    const trainers = [
      'J. Gosden', 'C. Appleby', 'A. O\'Brien', 'W. Haggas', 'R. Varian',
      'A. Balding', 'S. bin Suroor', 'R. Beckett', 'K. Ryan', 'M. Johnston',
    ];

    const raceTypes = ['Flat', 'Hurdle', 'Chase', 'National Hunt Flat'];
    const distances = ['5f', '6f', '7f', '1m', '1m2f', '1m4f', '1m6f', '2m', '2m4f', '3m'];
    const raceClasses = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'];

    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      const raceDay = new Date(now);
      raceDay.setDate(raceDay.getDate() + dayOffset);

      const shuffledCourses = [...courses].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 2));

      for (const course of shuffledCourses) {
        const numRaces = 5 + Math.floor(Math.random() * 3);
        const usedHorses = new Set<string>();

        for (let raceIdx = 0; raceIdx < numRaces; raceIdx++) {
          const raceHour = 12 + raceIdx + Math.floor(Math.random() * 2);
          const raceMin = Math.floor(Math.random() * 4) * 15;
          const raceTime = new Date(raceDay);
          raceTime.setHours(raceHour, raceMin, 0, 0);

          if (raceTime.getTime() < now.getTime()) continue;

          const fieldSize = 6 + Math.floor(Math.random() * 10);
          const availableHorses = horseNames.filter(h => !usedHorses.has(h));
          const shuffledHorses = [...availableHorses].sort(() => Math.random() - 0.5).slice(0, fieldSize);
          shuffledHorses.forEach(h => usedHorses.add(h));

          if (shuffledHorses.length < 4) continue;

          const raceType = course.surface === 'Turf' && course.region !== 'USA' ? raceTypes[Math.floor(Math.random() * raceTypes.length)] : 'Flat';
          const distance = distances[Math.floor(Math.random() * distances.length)];
          const raceClass = raceClasses[Math.floor(Math.random() * raceClasses.length)];
          const raceId = `fb-${course.name.toLowerCase().replace(/\s/g, '')}-${dayOffset}-${raceIdx}`;

          const rawScores = shuffledHorses.map((_, idx) => {
            const baseScore = 1.0 + Math.random() * 2.0;
            const positionBias = idx * 0.05;
            return Math.max(0.1, baseScore - positionBias);
          });
          const rawPowers = rawScores.map(s => Math.pow(s, 3.0));
          const totalPower = rawPowers.reduce((sum, v) => sum + v, 0);
          const OVERROUND = 1.15 + (shuffledHorses.length > 8 ? 0.05 : 0) + (shuffledHorses.length > 14 ? 0.05 : 0);

          const winOutcomes: OutcomeData[] = shuffledHorses.map((horse, idx) => {
            const fairProb = rawPowers[idx] / totalPower;
            const jitter = (Math.random() - 0.5) * 0.01;
            const adjProb = Math.max(0.015, Math.min(0.65, fairProb + jitter));
            const bookedProb = adjProb * OVERROUND;
            const odds = parseFloat(Math.max(1.20, 1 / bookedProb).toFixed(2));
            return { id: `runner_${idx + 1}`, name: horse, odds, probability: 1 / odds };
          });

          const placeOutcomes: OutcomeData[] = winOutcomes.map(w => {
            const placeFactor = shuffledHorses.length >= 8 ? 3.0 : shuffledHorses.length >= 5 ? 2.5 : 2.0;
            const placeOdds = parseFloat(Math.max(1.10, ((w.odds - 1) / placeFactor) + 1).toFixed(2));
            return { id: w.id, name: w.name, odds: placeOdds, probability: 1 / placeOdds };
          });

          const showOutcomes: OutcomeData[] = winOutcomes.map(w => {
            const showFactor = shuffledHorses.length >= 8 ? 5.0 : shuffledHorses.length >= 5 ? 4.0 : 3.0;
            const showOdds = parseFloat(Math.max(1.05, ((w.odds - 1) / showFactor) + 1).toFixed(2));
            return { id: w.id, name: w.name, odds: showOdds, probability: 1 / showOdds };
          });

          const markets: MarketData[] = [
            { id: 'race_winner', name: 'Win', outcomes: winOutcomes },
            { id: 'race_place', name: 'Place', outcomes: placeOutcomes },
            { id: 'race_show', name: 'Show', outcomes: showOutcomes },
          ];

          const runnersInfo = shuffledHorses.map((horse, idx) => ({
            name: horse,
            number: idx + 1,
            jockey: jockeys[idx % jockeys.length],
            trainer: trainers[idx % trainers.length],
            form: Array.from({length: 5}, () => Math.floor(Math.random() * 9) + 1).join(''),
            age: 3 + Math.floor(Math.random() * 5),
            weight: 120 + Math.floor(Math.random() * 30),
            draw: idx + 1,
          }));

          events.push({
            id: `horse-racing_${raceId}`,
            sportId: HORSE_RACING_SPORT_ID,
            leagueName: `${course.name} (${course.region})`,
            homeTeam: `Race ${raceIdx + 1} - ${raceClass}`,
            awayTeam: `${raceType} ${distance} - ${course.going}`,
            startTime: raceTime.toISOString(),
            status: 'scheduled',
            isLive: false,
            markets,
            homeOdds: winOutcomes[0]?.odds || 3.0,
            awayOdds: winOutcomes[1]?.odds || 4.0,
            venue: course.name,
            runnersInfo,
            raceDetails: {
              course: course.name,
              region: course.region,
              raceType,
              distance,
              going: course.going,
              surface: course.surface,
              raceClass,
              prize: '',
              fieldSize: shuffledHorses.length,
              ageBand: '3yo+',
              pattern: '',
            },
          } as SportEvent);
        }
      }
    }

    console.log(`[FreeSports] 🏇 Horse Racing fallback: ${events.length} generated races`);
    return events;
  }

  private calculateFormScore(form: string): number {
    if (!form || form === '-') return 0;
    const chars = form.replace(/[^0-9]/g, '').slice(-5);
    let score = 0;
    const weights = [1.0, 0.85, 0.7, 0.55, 0.4];
    for (let i = chars.length - 1; i >= 0; i--) {
      const pos = parseInt(chars[i]);
      const w = weights[chars.length - 1 - i] || 0.3;
      if (pos === 1) score += 2.0 * w;
      else if (pos === 2) score += 1.4 * w;
      else if (pos === 3) score += 0.9 * w;
      else if (pos === 4) score += 0.5 * w;
      else if (pos <= 6) score += 0.2 * w;
      else if (pos <= 9) score -= 0.1 * w;
      else score -= 0.3 * w;
    }
    return Math.max(0, score);
  }

  /**
   * Generate upcoming events for niche sports (darts, snooker, table tennis, water polo, badminton)
   * Uses real player/team names and realistic tournament schedules.
   * Settlement auto-resolves based on seeded randomness once match time passes.
   */
  private async fetchSofaScoreUpcoming(): Promise<SportEvent[]> {
    const events: SportEvent[] = [];

    events.push(...this.generateDartsEvents());
    events.push(...this.generateSnookerEvents());
    events.push(...this.generateTableTennisEvents());
    events.push(...this.generateWaterPoloEvents());
    events.push(...this.generateBadmintonEvents());
    events.push(...this.generateChessEvents());
    events.push(...this.generateArmwrestlingEvents());

    return events;
  }

  /**
   * Power-amplified odds: uses exponential scaling to spread odds realistically.
   * Higher exponent = bigger gap between strong and weak players.
   * For chess: normalize to (rating - BASE) first to amplify small FIDE differences.
   */
  private calcNicheOdds(r1: number, r2: number, exp: number, overround: number): [number, number] {
    const p1 = Math.pow(Math.max(r1, 1), exp);
    const p2 = Math.pow(Math.max(r2, 1), exp);
    const total = p1 + p2;
    const prob1 = p1 / total;
    const prob2 = p2 / total;
    const o1 = parseFloat(Math.max(1.10, 1 / (prob1 * overround)).toFixed(2));
    const o2 = parseFloat(Math.max(1.10, 1 / (prob2 * overround)).toFixed(2));
    return [o1, o2];
  }

  private calcChessOdds(r1: number, r2: number, overround: number): [number, number] {
    // Normalize FIDE ratings to amplify small rating differences (2700+ elite)
    const BASE = 2700;
    const n1 = Math.max(1, r1 - BASE);
    const n2 = Math.max(1, r2 - BASE);
    return this.calcNicheOdds(n1, n2, 2, overround);
  }

  private generateNicheMatch(
    sportKey: string,
    sportId: number,
    leagueName: string,
    player1: string,
    player2: string,
    odds1: number,
    odds2: number,
    startTime: string,
    hasDraws = false,
  ): SportEvent {
    const outcomes: OutcomeData[] = [
      { id: 'home', name: player1, odds: odds1, probability: 1 / odds1 },
      { id: 'away', name: player2, odds: odds2, probability: 1 / odds2 },
    ];
    if (hasDraws) {
      const drawOdds = parseFloat(Math.max(2.50, (odds1 + odds2) * 0.6).toFixed(2));
      outcomes.splice(1, 0, { id: 'draw', name: 'Draw', odds: drawOdds, probability: 1 / drawOdds });
    }
    const id = `${sportKey}_${player1.replace(/\s+/g,'_').toLowerCase()}_${player2.replace(/\s+/g,'_').toLowerCase()}_${new Date(startTime).getTime()}`;
    return {
      id,
      sportId,
      leagueName,
      homeTeam: player1,
      awayTeam: player2,
      startTime,
      status: 'scheduled',
      isLive: false,
      homeOdds: odds1,
      awayOdds: odds2,
      markets: [{ id: 'match_winner', name: 'Match Winner', outcomes }],
    } as SportEvent;
  }

  private generateDartsEvents(): SportEvent[] {
    const DARTS_SPORT_ID = 21;
    const pdcPlayers = [
      { name: 'Luke Littler', rating: 96 },
      { name: 'Luke Humphries', rating: 94 },
      { name: 'Michael van Gerwen', rating: 93 },
      { name: 'Gerwyn Price', rating: 88 },
      { name: 'Peter Wright', rating: 87 },
      { name: 'Gary Anderson', rating: 85 },
      { name: 'Jonny Clayton', rating: 84 },
      { name: 'Nathan Aspinall', rating: 83 },
      { name: 'Dimitri Van den Bergh', rating: 82 },
      { name: 'Rob Cross', rating: 82 },
      { name: 'Jose de Sousa', rating: 80 },
      { name: 'Danny Noppert', rating: 79 },
    ];

    const tournaments = [
      { name: 'PDC Premier League Darts', dates: ['2026-03-19T19:00:00Z', '2026-03-26T19:00:00Z', '2026-04-02T19:00:00Z'] },
      { name: 'UK Open', dates: ['2026-03-20T12:00:00Z', '2026-03-21T12:00:00Z'] },
      { name: 'Masters', dates: ['2026-04-10T14:00:00Z', '2026-04-11T14:00:00Z'] },
    ];

    const now = new Date();
    const events: SportEvent[] = [];
    const OVERROUND = 1.10;

    for (const tournament of tournaments) {
      for (const dateStr of tournament.dates) {
        if (new Date(dateStr) <= now) continue;
        // Varied pairings: top vs mid-table creates realistic spread in odds
        const pairs: [number, number][] = [[0,3],[1,4],[2,5],[6,9],[7,10],[8,11]];
        for (const [i, j] of pairs) {
          if (i >= pdcPlayers.length || j >= pdcPlayers.length) continue;
          const p1 = pdcPlayers[i];
          const p2 = pdcPlayers[j];
          const [o1, o2] = this.calcNicheOdds(p1.rating, p2.rating, 6, OVERROUND);
          events.push(this.generateNicheMatch('darts', DARTS_SPORT_ID, tournament.name, p1.name, p2.name, o1, o2, dateStr));
        }
        if (events.length >= 12) break;
      }
    }

    console.log(`[FreeSports] 🎯 Darts: ${events.length} upcoming matches`);
    return events.slice(0, 12);
  }

  private generateSnookerEvents(): SportEvent[] {
    const SNOOKER_SPORT_ID = 22;
    const players = [
      { name: 'Ronnie O\'Sullivan', rating: 97 },
      { name: 'Judd Trump', rating: 95 },
      { name: 'Mark Selby', rating: 91 },
      { name: 'Neil Robertson', rating: 90 },
      { name: 'Kyren Wilson', rating: 88 },
      { name: 'Mark Allen', rating: 85 },
      { name: 'Zhao Xintong', rating: 88 },
      { name: 'Si Jiahui', rating: 83 },
      { name: 'Barry Hawkins', rating: 82 },
      { name: 'John Higgins', rating: 89 },
      { name: 'Stuart Bingham', rating: 80 },
      { name: 'Shaun Murphy', rating: 81 },
    ];

    const tournaments = [
      { name: 'World Snooker Championship', dates: ['2026-04-18T13:00:00Z', '2026-04-19T13:00:00Z', '2026-04-25T13:00:00Z', '2026-04-26T13:00:00Z'] },
      { name: 'Tour Championship', dates: ['2026-03-28T13:00:00Z', '2026-03-29T13:00:00Z'] },
      { name: 'China Open', dates: ['2026-04-07T10:00:00Z', '2026-04-08T10:00:00Z'] },
    ];

    const now = new Date();
    const events: SportEvent[] = [];
    const OVERROUND = 1.10;

    for (const tournament of tournaments) {
      for (const dateStr of tournament.dates) {
        if (new Date(dateStr) <= now) continue;
        // Top vs mid-table pairings for realistic spread (O'Sullivan vs Robertson, Trump vs Wilson, etc.)
        const pairs: [number, number][] = [[0,3],[1,4],[2,5],[6,9],[7,10],[8,11]];
        for (const [i, j] of pairs) {
          if (i >= players.length || j >= players.length) continue;
          const p1 = players[i];
          const p2 = players[j];
          const [o1, o2] = this.calcNicheOdds(p1.rating, p2.rating, 6, OVERROUND);
          events.push(this.generateNicheMatch('snooker', SNOOKER_SPORT_ID, tournament.name, p1.name, p2.name, o1, o2, dateStr));
        }
        if (events.length >= 12) break;
      }
    }

    console.log(`[FreeSports] 🎱 Snooker: ${events.length} upcoming matches`);
    return events.slice(0, 12);
  }

  private generateTableTennisEvents(): SportEvent[] {
    const TT_SPORT_ID = 23;
    const players = [
      { name: 'Fan Zhendong', rating: 97 },
      { name: 'Ma Long', rating: 94 },
      { name: 'Wang Chuqin', rating: 95 },
      { name: 'Lin Gaoyuan', rating: 90 },
      { name: 'Truls Moregard', rating: 87 },
      { name: 'Felix Lebrun', rating: 88 },
      { name: 'Tomokazu Harimoto', rating: 86 },
      { name: 'Darko Jorgic', rating: 83 },
      { name: 'Hugo Calderano', rating: 85 },
      { name: 'Liam Pitchford', rating: 80 },
      { name: 'Alexis Lebrun', rating: 84 },
      { name: 'Patrick Franziska', rating: 79 },
    ];

    const tournaments = [
      { name: 'ITTF World Tour', dates: ['2026-03-20T09:00:00Z', '2026-03-21T09:00:00Z', '2026-03-22T09:00:00Z'] },
      { name: 'WTT Contender', dates: ['2026-04-03T09:00:00Z', '2026-04-04T09:00:00Z'] },
      { name: 'World Table Tennis Championships', dates: ['2026-04-22T09:00:00Z', '2026-04-23T09:00:00Z'] },
    ];

    const now = new Date();
    const events: SportEvent[] = [];
    const OVERROUND = 1.10;

    for (const tournament of tournaments) {
      for (const dateStr of tournament.dates) {
        if (new Date(dateStr) <= now) continue;
        // Varied pairings: Fan Zhendong vs Wang Chuqin, Ma Long vs Lin Gaoyuan, etc.
        const pairs: [number, number][] = [[0,2],[1,3],[4,6],[5,7],[8,10],[9,11]];
        for (const [i, j] of pairs) {
          if (i >= players.length || j >= players.length) continue;
          const p1 = players[i];
          const p2 = players[j];
          const [o1, o2] = this.calcNicheOdds(p1.rating, p2.rating, 5, OVERROUND);
          events.push(this.generateNicheMatch('table-tennis', TT_SPORT_ID, tournament.name, p1.name, p2.name, o1, o2, dateStr));
        }
        if (events.length >= 12) break;
      }
    }

    console.log(`[FreeSports] 🏓 Table Tennis: ${events.length} upcoming matches`);
    return events.slice(0, 12);
  }

  private generateWaterPoloEvents(): SportEvent[] {
    const WP_SPORT_ID = 24;
    const teams = [
      { name: 'Ferencváros (HUN)', rating: 95 },
      { name: 'Pro Recco (ITA)', rating: 94 },
      { name: 'Olympiakos (GRE)', rating: 90 },
      { name: 'Jug (CRO)', rating: 89 },
      { name: 'Barceloneta (ESP)', rating: 88 },
      { name: 'Brescia (ITA)', rating: 86 },
      { name: 'Zodiac Lille (FRA)', rating: 80 },
      { name: 'Szolnok (HUN)', rating: 84 },
      { name: 'HAVK Mladost (CRO)', rating: 83 },
      { name: 'Vasas SC (HUN)', rating: 81 },
    ];

    const tournaments = [
      { name: 'LEN Champions League', dates: ['2026-03-21T14:00:00Z', '2026-03-22T14:00:00Z', '2026-04-04T14:00:00Z', '2026-04-05T14:00:00Z'] },
      { name: 'LEN Euro Cup', dates: ['2026-04-18T14:00:00Z', '2026-04-19T14:00:00Z'] },
    ];

    const now = new Date();
    const events: SportEvent[] = [];
    const OVERROUND = 1.10;

    for (const tournament of tournaments) {
      for (const dateStr of tournament.dates) {
        if (new Date(dateStr) <= now) continue;
        // Top vs mid-table: Ferencváros vs Jug, Pro Recco vs Barceloneta, etc.
        const pairs: [number, number][] = [[0,3],[1,4],[2,5],[6,9],[7,8]];
        for (const [i, j] of pairs) {
          if (i >= teams.length || j >= teams.length) continue;
          const t1 = teams[i];
          const t2 = teams[j];
          const [o1, o2] = this.calcNicheOdds(t1.rating, t2.rating, 4, OVERROUND);
          events.push(this.generateNicheMatch('water-polo', WP_SPORT_ID, tournament.name, t1.name, t2.name, o1, o2, dateStr, true));
        }
        if (events.length >= 10) break;
      }
    }

    console.log(`[FreeSports] 🤽 Water Polo: ${events.length} upcoming matches`);
    return events.slice(0, 10);
  }

  private generateBadmintonEvents(): SportEvent[] {
    const BAD_SPORT_ID = 25;
    const players = [
      { name: 'Viktor Axelsen', rating: 97 },
      { name: 'Kunlavut Vitidsarn', rating: 93 },
      { name: 'Lee Zii Jia', rating: 90 },
      { name: 'Anders Antonsen', rating: 89 },
      { name: 'Shi Yuqi', rating: 91 },
      { name: 'Lakshya Sen', rating: 86 },
      { name: 'Anthony Ginting', rating: 88 },
      { name: 'Jonatan Christie', rating: 85 },
      { name: 'Chou Tien-chen', rating: 84 },
      { name: 'Ng Ka Long', rating: 82 },
      { name: 'H.S. Prannoy', rating: 83 },
      { name: 'Kenta Nishimoto', rating: 81 },
    ];

    const tournaments = [
      { name: 'BWF World Tour Super 1000', dates: ['2026-03-17T08:00:00Z', '2026-03-18T08:00:00Z', '2026-03-19T08:00:00Z'] },
      { name: 'All England Open', dates: ['2026-03-19T09:00:00Z', '2026-03-20T09:00:00Z', '2026-03-21T09:00:00Z'] },
      { name: 'Malaysia Open', dates: ['2026-04-07T09:00:00Z', '2026-04-08T09:00:00Z'] },
      { name: 'India Open', dates: ['2026-04-14T09:00:00Z', '2026-04-15T09:00:00Z'] },
    ];

    const now = new Date();
    const events: SportEvent[] = [];
    const OVERROUND = 1.10;

    for (const tournament of tournaments) {
      for (const dateStr of tournament.dates) {
        if (new Date(dateStr) <= now) continue;
        // Axelsen vs Antonsen, Vitidsarn vs Shi Yuqi, Lee Zii Jia vs Lakshya Sen, etc.
        const pairs: [number, number][] = [[0,3],[1,4],[2,5],[6,9],[7,10],[8,11]];
        for (const [i, j] of pairs) {
          if (i >= players.length || j >= players.length) continue;
          const p1 = players[i];
          const p2 = players[j];
          const [o1, o2] = this.calcNicheOdds(p1.rating, p2.rating, 6, OVERROUND);
          events.push(this.generateNicheMatch('badminton', BAD_SPORT_ID, tournament.name, p1.name, p2.name, o1, o2, dateStr));
        }
        if (events.length >= 12) break;
      }
    }

    console.log(`[FreeSports] 🏸 Badminton: ${events.length} upcoming matches`);
    return events.slice(0, 12);
  }

  private generateChessEvents(): SportEvent[] {
    const CHESS_SPORT_ID = 26;

    // Top FIDE-rated players (ratings as of early 2026)
    const players = [
      { name: 'Magnus Carlsen', rating: 2830, country: 'Norway' },
      { name: 'Fabiano Caruana', rating: 2810, country: 'USA' },
      { name: 'Hikaru Nakamura', rating: 2802, country: 'USA' },
      { name: 'Dominaraju Gukesh', rating: 2783, country: 'India' },
      { name: 'Ian Nepomniachtchi', rating: 2765, country: 'Russia' },
      { name: 'Alireza Firouzja', rating: 2760, country: 'France' },
      { name: 'Wesley So', rating: 2751, country: 'USA' },
      { name: 'Nodirbek Abdusattorov', rating: 2748, country: 'Uzbekistan' },
      { name: 'Anish Giri', rating: 2742, country: 'Netherlands' },
      { name: 'Arjun Erigaisi', rating: 2740, country: 'India' },
      { name: 'Richard Rapport', rating: 2738, country: 'Romania' },
      { name: 'Viswanathan Anand', rating: 2726, country: 'India' },
    ];

    // Real upcoming FIDE chess tournaments 2026
    const tournaments = [
      { name: 'Grand Chess Tour 2026 - St. Louis Rapid', dates: ['2026-04-15T14:00:00Z', '2026-04-16T14:00:00Z', '2026-04-17T14:00:00Z', '2026-04-18T14:00:00Z'] },
      { name: 'Norway Chess 2026', dates: ['2026-05-26T12:00:00Z', '2026-05-27T12:00:00Z', '2026-05-28T12:00:00Z', '2026-05-29T12:00:00Z', '2026-05-30T12:00:00Z'] },
      { name: 'FIDE Grand Swiss 2026', dates: ['2026-10-25T11:00:00Z', '2026-10-26T11:00:00Z', '2026-10-27T11:00:00Z', '2026-10-28T11:00:00Z'] },
      { name: 'World Chess Championship 2026 - Game', dates: ['2026-11-25T12:00:00Z', '2026-11-27T12:00:00Z', '2026-11-29T12:00:00Z', '2026-12-01T12:00:00Z', '2026-12-03T12:00:00Z'] },
    ];

    const now = new Date();
    const events: SportEvent[] = [];
    const OVERROUND = 1.08; // Lower bookmaker margin for chess (high-profile, liquid markets)

    for (const tournament of tournaments) {
      for (const dateStr of tournament.dates) {
        if (new Date(dateStr) <= now) continue;
        // Cross-seeded pairings create realistic favourites (Carlsen vs Nakamura, Caruana vs Gukesh, etc.)
        const pairs: [number, number][] = [[0,2],[1,3],[4,6],[5,7],[8,10],[9,11]];
        for (const [i, j] of pairs) {
          if (i >= players.length || j >= players.length) continue;
          const p1 = players[i];
          const p2 = players[j];
          const [o1, o2] = this.calcChessOdds(p1.rating, p2.rating, OVERROUND);
          events.push(this.generateNicheMatch('chess', CHESS_SPORT_ID, tournament.name, p1.name, p2.name, o1, o2, dateStr));
        }
        if (events.length >= 14) break;
      }
      if (events.length >= 14) break;
    }

    console.log(`[FreeSports] ♟️ Chess: ${events.length} upcoming matches (World Chess Federation / FIDE)`);
    return events.slice(0, 14);
  }

  private generateArmwrestlingEvents(): SportEvent[] {
    const ARM_SPORT_ID = 27;

    // WAL (World Armwrestling League) professional athletes
    const heavyweightPullers = [
      { name: 'Devon Larratt', rating: 97, country: 'Canada' },
      { name: 'Denis Cyplenkov', rating: 96, country: 'Ukraine' },
      { name: 'Michael Todd', rating: 93, country: 'USA' },
      { name: 'Travis Bagent', rating: 90, country: 'USA' },
      { name: 'Andrey Pushkar', rating: 91, country: 'Ukraine' },
      { name: 'Richard Lupkes', rating: 88, country: 'USA' },
    ];

    const lightHeavyweightPullers = [
      { name: 'John Brzenk', rating: 94, country: 'USA' },
      { name: 'Alexey Voyevoda', rating: 87, country: 'Russia' },
      { name: 'Ron Bath', rating: 85, country: 'USA' },
      { name: 'Ermes Gasparini', rating: 84, country: 'Italy' },
    ];

    // WAL Season 5 (2026) event schedule
    const walEvents = [
      { name: 'WAL Season 5 - Detroit', date: '2026-04-12T18:00:00Z' },
      { name: 'WAL Season 5 - Columbus', date: '2026-05-17T18:00:00Z' },
      { name: 'WAL Season 5 - Dallas', date: '2026-06-14T18:00:00Z' },
      { name: 'WAL Superfight Series', date: '2026-07-19T18:00:00Z' },
      { name: 'WAL Season 5 - Finals', date: '2026-09-06T18:00:00Z' },
    ];

    const now = new Date();
    const events: SportEvent[] = [];
    const OVERROUND = 1.08;

    for (const walEvent of walEvents) {
      if (new Date(walEvent.date) <= now) continue;

      // Heavyweight card — cross-seeded: Larratt vs Todd, Cyplenkov vs Bagent, Pushkar vs Lupkes
      const hwPairs: [number, number][] = [[0,2],[1,3],[4,5]];
      for (const [i, j] of hwPairs) {
        if (i >= heavyweightPullers.length || j >= heavyweightPullers.length) continue;
        const p1 = heavyweightPullers[i];
        const p2 = heavyweightPullers[j];
        const [o1, o2] = this.calcNicheOdds(p1.rating, p2.rating, 8, OVERROUND);
        events.push(this.generateNicheMatch('armwrestling', ARM_SPORT_ID, `${walEvent.name} - Heavyweight`, p1.name, p2.name, o1, o2, walEvent.date));
      }

      // Light Heavyweight card — Brzenk vs Bath (clear favourite), Voyevoda vs Gasparini
      const lhPairs: [number, number][] = [[0,2],[1,3]];
      for (const [i, j] of lhPairs) {
        if (i >= lightHeavyweightPullers.length || j >= lightHeavyweightPullers.length) continue;
        const p1 = lightHeavyweightPullers[i];
        const p2 = lightHeavyweightPullers[j];
        const [o1, o2] = this.calcNicheOdds(p1.rating, p2.rating, 8, OVERROUND);
        events.push(this.generateNicheMatch('armwrestling', ARM_SPORT_ID, `${walEvent.name} - Light Heavyweight`, p1.name, p2.name, o1, o2, walEvent.date));
      }

      if (events.length >= 16) break;
    }

    console.log(`[FreeSports] 💪 Armwrestling: ${events.length} upcoming matches (World Armwrestling League)`);
    return events.slice(0, 16);
  }

  /**
   * Fetch real settlement results for niche sports from SofaScore API.
   * NEVER uses random or seeded results — only real match outcomes from the live API.
   * If SofaScore is unavailable, returns an empty array so bets remain pending.
   */
  private async fetchSofaScoreResults(): Promise<FreeSportsResult[]> {
    const results: FreeSportsResult[] = [];

    // Sports that have real SofaScore coverage
    const sofaScoreSports: Array<{ slug: string; sportKey: string; sportId: number; hasDraws: boolean }> = [
      { slug: 'darts', sportKey: 'darts', sportId: 21, hasDraws: false },
      { slug: 'snooker', sportKey: 'snooker', sportId: 22, hasDraws: false },
      { slug: 'table-tennis', sportKey: 'table-tennis', sportId: 23, hasDraws: false },
      { slug: 'waterpolo', sportKey: 'water-polo', sportId: 24, hasDraws: true },
      { slug: 'badminton', sportKey: 'badminton', sportId: 25, hasDraws: false },
    ];

    // Build a lookup of our generated events so we can match by name
    const allNicheEvents = [
      ...this.generateDartsEvents(),
      ...this.generateSnookerEvents(),
      ...this.generateTableTennisEvents(),
      ...this.generateWaterPoloEvents(),
      ...this.generateBadmintonEvents(),
      ...this.generateChessEvents(),
      ...this.generateArmwrestlingEvents(),
    ];
    const now = new Date();

    for (const sport of sofaScoreSports) {
      try {
        // Fetch the most recent finished events from SofaScore (page 0 = most recent)
        const resp = await axios.get(
          `${SOFASCORE_BASE_URL}/sport/${sport.slug}/events/last/0`,
          { headers: SOFASCORE_HEADERS, timeout: 12000 }
        );
        const events: any[] = resp.data?.events || [];

        const FINISHED_STATUSES = new Set(['ended', 'finished', 'canceled', 'walkover', 'retired', 'final']);

        for (const ev of events) {
          const statusDesc = (ev?.status?.description || ev?.status?.type || '').toLowerCase();
          if (!FINISHED_STATUSES.has(statusDesc) && statusDesc !== 'ap' && statusDesc !== 'aet') continue;

          const homeTeamName: string = ev?.homeTeam?.name || ev?.homeTeam?.shortName || '';
          const awayTeamName: string = ev?.awayTeam?.name || ev?.awayTeam?.shortName || '';
          if (!homeTeamName || !awayTeamName) continue;

          const homeScore: number = ev?.homeScore?.current ?? ev?.homeScore?.display ?? 0;
          const awayScore: number = ev?.awayScore?.current ?? ev?.awayScore?.display ?? 0;
          const winner: 'home' | 'away' | 'draw' =
            homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';

          // Match against our generated events by player/team name similarity
          const matchingEvent = allNicheEvents.find(ge => {
            if (!ge.startTime) return false;
            // Only match events that should be finished (started > 2 hours ago)
            const startedAt = new Date(ge.startTime);
            if (now.getTime() - startedAt.getTime() < 2 * 60 * 60 * 1000) return false;

            const geHome = ge.homeTeam.toLowerCase().trim();
            const geAway = ge.awayTeam.toLowerCase().trim();
            const sfHome = homeTeamName.toLowerCase().trim();
            const sfAway = awayTeamName.toLowerCase().trim();

            const homeMatch =
              geHome === sfHome ||
              sfHome.includes(geHome) ||
              geHome.includes(sfHome) ||
              geHome.split(' ')[0] === sfHome.split(' ')[0]; // match on first name (common for darts/snooker)
            const awayMatch =
              geAway === sfAway ||
              sfAway.includes(geAway) ||
              geAway.includes(sfAway) ||
              geAway.split(' ')[0] === sfAway.split(' ')[0];

            return homeMatch && awayMatch;
          });

          if (matchingEvent) {
            const eventId = String(matchingEvent.id);
            // Avoid duplicates
            if (!results.some(r => r.eventId === eventId)) {
              console.log(`[FreeSports] ✅ SofaScore ${sport.slug} result: ${homeTeamName} ${homeScore}-${awayScore} ${awayTeamName} → ${winner}`);
              results.push({
                eventId,
                homeTeam: matchingEvent.homeTeam,
                awayTeam: matchingEvent.awayTeam,
                homeScore,
                awayScore,
                winner,
                status: 'finished',
              });
            }
          }
        }

        console.log(`[FreeSports] SofaScore ${sport.slug}: ${events.length} API events checked, ${results.filter(r => String(r.eventId).startsWith(sport.sportKey)).length} matched`);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err: any) {
        console.warn(`[FreeSports] SofaScore ${sport.slug} results unavailable: ${err.message} — bets remain pending (no random settlement)`);
      }
    }

    // Chess and Armwrestling: no real-time API available — bets remain pending
    // Do NOT settle with random/seeded results
    const chessPending = allNicheEvents.filter(e => String(e.id).startsWith('chess_') && e.startTime && now.getTime() - new Date(e.startTime).getTime() > 2 * 60 * 60 * 1000);
    const armPending = allNicheEvents.filter(e => String(e.id).startsWith('armwrestling_') && e.startTime && now.getTime() - new Date(e.startTime).getTime() > 2 * 60 * 60 * 1000);
    if (chessPending.length > 0) {
      console.log(`[FreeSports] ♟️ Chess: ${chessPending.length} past events — awaiting real results (no API available)`);
    }
    if (armPending.length > 0) {
      console.log(`[FreeSports] 💪 Armwrestling: ${armPending.length} past events — awaiting real results (no API available)`);
    }

    console.log(`[FreeSports] 🎯 SofaScore niche sports settlement: ${results.length} real results found`);
    return results;
  }

  /**
   * Get cached upcoming events for a specific sport
   */
  getUpcomingEvents(sportSlug?: string): SportEvent[] {
    if (sportSlug) {
      // Canonical slug-to-sportId map covering all sidebar slugs and aliases
      // IDs match the database sports table exactly
      const SLUG_TO_SPORT_ID: Record<string, number> = {
        // Core sports (DB IDs)
        'soccer': 1,
        'football': 1,
        'basketball': 2,
        'tennis': 3,
        'american-football': 4,
        'nfl': 14,
        'baseball': 5,
        'ice-hockey': 6,
        'hockey': 6,
        'mma': 7,
        'mma-ufc': 7,
        'ufc': 7,
        'boxing': 8,
        'esports': 9,
        'afl': 10,
        'aussie-rules': 10,
        'formula-1': 11,
        'f1': 11,
        'handball': 12,
        'nba': 13,
        'rugby': 15,
        'volleyball': 16,
        'horse-racing': 17,
        'horseracing': 17,
        'cricket': 18,
        // Standalone generators (no DB entry, use placeholder IDs)
        'motogp': 19,
        'moto-gp': 19,
        'wwe': 20,
        'entertainment': 20,
        'wwe-entertainment': 20,
        // SofaScore niche sports
        'darts': 21,
        'snooker': 22,
        'table-tennis': 23,
        'table_tennis': 23,
        'water-polo': 24,
        'waterpolo': 24,
        'badminton': 25,
      };
      const sportId = SLUG_TO_SPORT_ID[sportSlug];
      if (sportId !== undefined) {
        return cachedFreeSportsEvents.filter(e => e.sportId === sportId);
      }
    }
    return cachedFreeSportsEvents;
  }

  /**
   * Check if a sport is a free sport
   */
  isFreeSport(sportSlug: string): boolean {
    return sportSlug in FREE_SPORTS_CONFIG || 
           sportSlug in SOFASCORE_SPORTS_CONFIG ||
           sportSlug === 'hockey' || 
           sportSlug === 'nfl' || 
           sportSlug === 'mlb' ||
           sportSlug === 'boxing' ||
           sportSlug === 'tennis' ||
           sportSlug === 'cricket' ||
           sportSlug === 'wwe' ||
           sportSlug === 'entertainment' ||
           sportSlug === 'darts' ||
           sportSlug === 'snooker' ||
           sportSlug === 'table-tennis' ||
           sportSlug === 'water-polo' ||
           sportSlug === 'badminton';
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

  getCachedEvents(): SportEvent[] {
    return cachedFreeSportsEvents;
  }

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
