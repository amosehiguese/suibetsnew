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
const HORSE_RACING_SPORT_ID = 18;
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
      const horseRacingEvents = await this.fetchHorseRacing();
      if (horseRacingEvents.length > 0) {
        allEvents.push(...horseRacingEvents);
      }
    } catch (error: any) {
      console.error(`[FreeSports] Horse Racing fetch error:`, error.message);
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
        const circuitName = game.circuit?.name || game.competition?.name || gpName;
        const startTime = game.date || (game.timestamp ? new Date(game.timestamp * 1000).toISOString() : new Date().toISOString());
        return this.generateF1RaceEvent(gameId, gpName, circuitName, startTime, config.sportId);
      } else {
        homeTeam = game.teams?.home?.name || game.home?.name || 'Home Team';
        awayTeam = game.teams?.away?.name || game.away?.name || 'Away Team';
      }
      
      let league = game.league?.name || game.competition?.name || '';
      if ((sportSlug === 'mma' || sportSlug === 'boxing') && !league) {
        const slug = game.slug || '';
        const colonIdx = slug.indexOf(':');
        league = colonIdx > 0 ? slug.substring(0, colonIdx).trim() : (slug || 'MMA');
      }
      if (!league) league = 'Unknown League';
      const startTime = game.date ? game.date : (game.timestamp ? new Date(game.timestamp * 1000).toISOString() : new Date().toISOString());

      const gameHash = gameId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
      const seededRand = (seed: number) => {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
      };

      let homeProb: number;
      let targetOverround: number;

      if (sportSlug === 'mma' || sportSlug === 'boxing') {
        targetOverround = 1.07;
        const r = seededRand(gameHash);
        homeProb = r < 0.15 ? 0.25 + seededRand(gameHash + 1) * 0.1
                 : r < 0.30 ? 0.65 + seededRand(gameHash + 2) * 0.1
                 : 0.35 + seededRand(gameHash + 3) * 0.30;
      } else if (sportSlug === 'basketball') {
        targetOverround = 1.05;
        homeProb = 0.35 + seededRand(gameHash) * 0.30;
      } else if (sportSlug === 'ice-hockey') {
        targetOverround = 1.05;
        homeProb = 0.38 + seededRand(gameHash) * 0.24;
      } else if (sportSlug === 'baseball') {
        targetOverround = 1.05;
        homeProb = 0.36 + seededRand(gameHash) * 0.28;
      } else {
        targetOverround = 1.06;
        homeProb = 0.35 + seededRand(gameHash) * 0.30;
      }

      const awayProb = 1 - homeProb;
      const homeOdds = parseFloat(Math.max(1.12, 1 / (homeProb * targetOverround)).toFixed(2));
      const awayOdds = parseFloat(Math.max(1.12, 1 / (awayProb * targetOverround)).toFixed(2));

      const outcomes: OutcomeData[] = [
        { id: 'home', name: homeTeam, odds: homeOdds, probability: 1 / homeOdds },
        { id: 'away', name: awayTeam, odds: awayOdds, probability: 1 / awayOdds }
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
        drawOdds: config.hasDraws ? (() => {
          const drawProb = 0.12 + seededRand(gameHash + 7) * 0.08;
          const scale = targetOverround / (1 + drawProb * targetOverround);
          outcomes[0].odds = parseFloat(Math.max(1.12, 1 / (homeProb * scale)).toFixed(2));
          outcomes[0].probability = 1 / outcomes[0].odds;
          outcomes[1].odds = parseFloat(Math.max(1.12, 1 / (awayProb * scale)).toFixed(2));
          outcomes[1].probability = 1 / outcomes[1].odds;
          return parseFloat(Math.max(2.80, 1 / (drawProb * targetOverround)).toFixed(2));
        })() : undefined
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

  private generateF1RaceEvent(raceId: string, gpName: string, circuitName: string, startTime: string, sportId: number): SportEvent {
    const f1Grid: { name: string; team: string; number: number; rating: number }[] = [
      { name: 'Max Verstappen', team: 'Red Bull Racing', number: 1, rating: 92 },
      { name: 'Liam Lawson', team: 'Red Bull Racing', number: 30, rating: 68 },
      { name: 'Charles Leclerc', team: 'Ferrari', number: 16, rating: 88 },
      { name: 'Lewis Hamilton', team: 'Ferrari', number: 44, rating: 85 },
      { name: 'Lando Norris', team: 'McLaren', number: 4, rating: 86 },
      { name: 'Oscar Piastri', team: 'McLaren', number: 81, rating: 83 },
      { name: 'George Russell', team: 'Mercedes', number: 63, rating: 96 },
      { name: 'Andrea Kimi Antonelli', team: 'Mercedes', number: 12, rating: 87 },
      { name: 'Fernando Alonso', team: 'Aston Martin', number: 14, rating: 75 },
      { name: 'Lance Stroll', team: 'Aston Martin', number: 18, rating: 60 },
      { name: 'Pierre Gasly', team: 'Alpine', number: 10, rating: 72 },
      { name: 'Jack Doohan', team: 'Alpine', number: 7, rating: 64 },
      { name: 'Carlos Sainz', team: 'Williams', number: 55, rating: 80 },
      { name: 'Alex Albon', team: 'Williams', number: 23, rating: 74 },
      { name: 'Yuki Tsunoda', team: 'RB', number: 22, rating: 71 },
      { name: 'Isack Hadjar', team: 'RB', number: 6, rating: 65 },
      { name: 'Nico Hülkenberg', team: 'Sauber', number: 27, rating: 70 },
      { name: 'Gabriel Bortoleto', team: 'Sauber', number: 5, rating: 63 },
      { name: 'Esteban Ocon', team: 'Haas', number: 31, rating: 73 },
      { name: 'Oliver Bearman', team: 'Haas', number: 87, rating: 66 },
    ];

    const rawPowers = f1Grid.map(driver => {
      const jitter = (Math.random() - 0.5) * 0.01;
      return Math.max(0.005, Math.pow(driver.rating / 60, 6) + jitter);
    });
    const totalPower = rawPowers.reduce((s, v) => s + v, 0);

    const TARGET_OVERROUND = 1.20;
    const outcomes: OutcomeData[] = f1Grid.map((driver, idx) => {
      const fairProb = rawPowers[idx] / totalPower;
      const bookedProb = fairProb * TARGET_OVERROUND;
      const odds = parseFloat(Math.max(1.50, 1 / bookedProb).toFixed(2));
      return {
        id: `driver_${driver.number}`,
        name: driver.name,
        odds,
        probability: 1 / odds
      };
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
      markets: [{
        id: 'race_winner',
        name: 'Race Winner',
        outcomes
      }],
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
            };
            const rateTeam = (name: string) => {
              const lower = name.toLowerCase();
              for (const [key, val] of Object.entries(cricketRatings)) {
                if (lower.includes(key)) return val;
              }
              return 70;
            };
            const rH = rateTeam(homeTeam);
            const rA = rateTeam(awayTeam);
            const homeAdv = 1.03;
            const OVERROUND = format === 'TEST' ? 1.08 : 1.06;
            const rawPH = (rH * homeAdv) / (rH * homeAdv + rA);
            const jitterC = (Math.random() - 0.5) * 0.04;
            const pH = Math.max(0.08, Math.min(0.92, rawPH + jitterC));
            const pA = 1 - pH;

            let homeOdds: number, awayOdds: number, drawOdds: number | undefined;
            if (format === 'TEST') {
              const drawProb = 0.18 + (Math.random() - 0.5) * 0.06;
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

  private async fetchHorseRacing(): Promise<SportEvent[]> {
    if (!RAPIDAPI_KEY) {
      console.warn('[FreeSports] No RAPIDAPI_KEY set, skipping horse racing');
      return [];
    }

    try {
      console.log('[FreeSports] 🏇 Fetching horse racing from The Racing API...');
      const events: SportEvent[] = [];
      const now = Date.now();

      for (const day of ['today', 'tomorrow']) {
        const response = await axios.get(`${RACING_API_BASE}/v1/racecards/free?day=${day}`, {
          headers: {
            'x-rapidapi-host': RACING_API_HOST,
            'x-rapidapi-key': RAPIDAPI_KEY,
            'Accept': 'application/json'
          },
          timeout: 15000
        });

        const racecards = response.data?.racecards || [];

        for (const race of racecards) {
          if (!race.race_id || !race.runners || race.runners.length < 2) continue;

          const raceStart = new Date(race.off_dt).getTime();
          if (isNaN(raceStart) || raceStart < now) continue;

          const runners = race.runners.slice(0, 20);

          const fieldSize = runners.length;
          const rawPowers = runners.map((runner: any, idx: number) => {
            const formScore = this.calculateFormScore(runner.form || '');
            const drawAdv = (runner.draw && runner.draw <= 4) ? 0.15 : 0;
            const weightPen = runner.lbs ? Math.max(0, (runner.lbs - 140) * 0.003) : 0;
            const positionBias = idx * 0.05;
            return Math.max(0.05, 1.8 + formScore * 0.7 + drawAdv - weightPen - positionBias);
          });
          const totalPower = rawPowers.reduce((s: number, v: number) => s + v, 0);
          const OVERROUND = 1.15 + (fieldSize > 8 ? 0.05 : 0) + (fieldSize > 14 ? 0.05 : 0);

          const winOutcomes: OutcomeData[] = runners.map((runner: any, idx: number) => {
            const fairProb = rawPowers[idx] / totalPower;
            const jitter = (Math.random() - 0.5) * 0.015;
            const adjProb = Math.max(0.02, Math.min(0.60, fairProb + jitter));
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
      return [];
    }
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
   * Get cached upcoming events for a specific sport
   */
  getUpcomingEvents(sportSlug?: string): SportEvent[] {
    if (sportSlug) {
      if (sportSlug === 'cricket') {
        return cachedFreeSportsEvents.filter(e => e.sportId === CRICKET_SPORT_ID);
      }
      if (sportSlug === 'horse-racing') {
        return cachedFreeSportsEvents.filter(e => e.sportId === HORSE_RACING_SPORT_ID);
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
    if (!sports.includes('horse-racing')) sports.push('horse-racing');
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
