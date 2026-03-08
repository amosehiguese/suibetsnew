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
      }
    } catch (error: any) {
      console.error(`[FreeSports] WWE generation error:`, error.message);
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
      { id: 'brazilian-gp', gpName: 'Brazilian Grand Prix', circuit: 'Autódromo de Goiânia, Brazil', date: '2026-03-22T18:00:00Z' },
      { id: 'americas-gp', gpName: 'Grand Prix of the Americas', circuit: 'Circuit of The Americas, Austin', date: '2026-03-29T19:00:00Z' },
      { id: 'qatar-gp', gpName: 'Qatar Grand Prix', circuit: 'Lusail International Circuit', date: '2026-04-12T17:00:00Z' },
      { id: 'spanish-gp', gpName: 'Spanish Grand Prix', circuit: 'Circuito de Jerez, Spain', date: '2026-04-26T13:00:00Z' },
      { id: 'french-gp', gpName: 'French Grand Prix', circuit: 'Le Mans, France', date: '2026-05-10T13:00:00Z' },
      { id: 'catalan-gp', gpName: 'Catalan Grand Prix', circuit: 'Circuit de Barcelona-Catalunya', date: '2026-05-17T13:00:00Z' },
      { id: 'italian-gp', gpName: 'Italian Grand Prix', circuit: 'Autodromo del Mugello, Italy', date: '2026-05-31T13:00:00Z' },
      { id: 'hungarian-gp', gpName: 'Hungarian Grand Prix', circuit: 'Balaton Park Circuit, Hungary', date: '2026-06-07T13:00:00Z' },
      { id: 'czech-gp', gpName: 'Czech Grand Prix', circuit: 'Automotodrom Brno, Czech Republic', date: '2026-06-21T13:00:00Z' },
      { id: 'german-gp', gpName: 'German Grand Prix', circuit: 'Sachsenring, Germany', date: '2026-06-28T13:00:00Z' },
      { id: 'dutch-gp', gpName: 'Dutch Grand Prix', circuit: 'TT Circuit Assen, Netherlands', date: '2026-07-12T13:00:00Z' },
      { id: 'british-gp', gpName: 'British Grand Prix', circuit: 'Silverstone Circuit, UK', date: '2026-08-02T13:00:00Z' },
      { id: 'austrian-gp', gpName: 'Austrian Grand Prix', circuit: 'Red Bull Ring, Spielberg', date: '2026-08-16T13:00:00Z' },
      { id: 'aragon-gp', gpName: 'Aragon Grand Prix', circuit: 'MotorLand Aragón, Spain', date: '2026-08-30T13:00:00Z' },
      { id: 'san-marino-gp', gpName: 'San Marino Grand Prix', circuit: 'Misano World Circuit, Italy', date: '2026-09-13T13:00:00Z' },
      { id: 'indonesian-gp', gpName: 'Indonesian Grand Prix', circuit: 'Mandalika Circuit, Lombok', date: '2026-09-27T08:00:00Z' },
      { id: 'japanese-gp', gpName: 'Japanese Grand Prix', circuit: 'Mobility Resort Motegi, Japan', date: '2026-10-04T06:00:00Z' },
      { id: 'australian-gp', gpName: 'Australian Grand Prix', circuit: 'Phillip Island Circuit, Australia', date: '2026-10-18T05:00:00Z' },
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

    const rawPowers = motoGPGrid.map(rider => {
      const jitter = (Math.random() - 0.5) * 0.01;
      return Math.max(0.005, Math.pow(rider.rating / 60, 6) + jitter);
    });
    const totalPower = rawPowers.reduce((s, v) => s + v, 0);

    const TARGET_OVERROUND = 1.20;
    const outcomes: OutcomeData[] = motoGPGrid.map((rider, idx) => {
      const fairProb = rawPowers[idx] / totalPower;
      const bookedProb = fairProb * TARGET_OVERROUND;
      const odds = parseFloat(Math.max(1.50, 1 / bookedProb).toFixed(2));
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
    const BOXING_SPORT_ID = 17;
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
        id: 'dickens-cacace', fighter1: 'Jazza Dickens', fighter2: 'Anthony Cacace',
        record1: '36-4 (15 KOs)', record2: '23-1 (10 KOs)',
        odds1: 2.75, odds2: 1.45,
        title: 'WBA Super Featherweight Title', venue: '3Arena, Dublin',
        date: '2026-03-14T20:00:00Z', league: 'DAZN Boxing'
      },
      {
        id: 'adames-williams', fighter1: 'Carlos Adames', fighter2: 'Austin Williams',
        record1: '24-1-1 (18 KOs)', record2: '19-1 (13 KOs)',
        odds1: 1.25, odds2: 3.50,
        title: 'WBC Middleweight Title', venue: 'Caribe Royale, Orlando',
        date: '2026-03-21T21:00:00Z', league: 'DAZN Boxing'
      },
      {
        id: 'fundora-thurman', fighter1: 'Sebastian Fundora', fighter2: 'Keith Thurman',
        record1: '23-1-1 (15 KOs)', record2: '31-1 (23 KOs)',
        odds1: 1.25, odds2: 3.50,
        title: 'WBC Super Welterweight Title', venue: 'MGM Grand, Las Vegas',
        date: '2026-03-28T21:00:00Z', league: 'PBC PPV on Prime Video'
      },
      {
        id: 'itauma-franklin', fighter1: 'Moses Itauma', fighter2: 'Jermaine Franklin',
        record1: '12-0 (10 KOs)', record2: '22-2 (14 KOs)',
        odds1: 1.33, odds2: 3.00,
        title: 'Heavyweight', venue: 'Co-op Live Arena, Manchester',
        date: '2026-03-28T20:00:00Z', league: 'DAZN Boxing'
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
        title: 'World Title Unification', venue: 'Olympia, London',
        date: '2026-04-05T18:00:00Z', league: 'Sky Sports Boxing'
      },
      {
        id: 'santiago-taniguchi', fighter1: 'Rene Santiago', fighter2: 'Masataka Taniguchi',
        record1: '16-0 (10 KOs)', record2: '18-4 (10 KOs)',
        odds1: 1.50, odds2: 2.50,
        title: 'WBO/WBA Light Flyweight Titles', venue: 'Korakuen Hall, Tokyo',
        date: '2026-04-03T11:00:00Z', league: 'World Championship Boxing'
      },
      {
        id: 'ramirez-benavidez', fighter1: 'Gilberto Ramirez', fighter2: 'David Benavidez',
        record1: '46-1 (30 KOs)', record2: '29-0 (24 KOs)',
        odds1: 2.80, odds2: 1.42,
        title: 'WBO & WBA Cruiserweight Titles', venue: 'T-Mobile Arena, Las Vegas',
        date: '2026-05-02T21:00:00Z', league: 'DAZN Boxing'
      },
      {
        id: 'wardley-dubois', fighter1: 'Fabio Wardley', fighter2: 'Daniel Dubois',
        record1: '18-0 (17 KOs)', record2: '22-2 (21 KOs)',
        odds1: 2.10, odds2: 1.72,
        title: 'WBO Heavyweight Title', venue: 'Co-op Live Arena, Manchester',
        date: '2026-05-09T20:00:00Z', league: 'DAZN PPV'
      },
      {
        id: 'usyk-verhoeven', fighter1: 'Oleksandr Usyk', fighter2: 'Rico Verhoeven',
        record1: '22-0 (14 KOs)', record2: '1-0 (Boxing)',
        odds1: 1.18, odds2: 4.50,
        title: 'WBC Heavyweight Title', venue: 'Pyramids of Giza, Egypt',
        date: '2026-05-23T20:00:00Z', league: 'DAZN Boxing'
      },
      {
        id: 'smith-puello', fighter1: 'Dalton Smith', fighter2: 'Alberto Puello',
        record1: '18-0 (13 KOs)', record2: '24-1 (12 KOs)',
        odds1: 1.45, odds2: 2.70,
        title: 'WBC Super Lightweight Title', venue: 'Sheffield Arena, UK',
        date: '2026-06-06T20:00:00Z', league: 'DAZN Boxing'
      },
      {
        id: 'crawford-spence', fighter1: 'Terence Crawford', fighter2: 'Errol Spence Jr.',
        record1: '41-0 (31 KOs)', record2: '28-1 (22 KOs)',
        odds1: 1.40, odds2: 2.85,
        title: 'WBA Super Middleweight Title', venue: 'T-Mobile Arena, Las Vegas',
        date: '2026-07-11T21:00:00Z', league: 'PBC PPV on Prime Video'
      },
      {
        id: 'inoue-nery2', fighter1: 'Naoya Inoue', fighter2: 'Luis Nery',
        record1: '29-0 (25 KOs)', record2: '35-2 (27 KOs)',
        odds1: 1.15, odds2: 5.00,
        title: 'Undisputed Super Bantamweight', venue: 'Tokyo Dome, Japan',
        date: '2026-07-25T10:00:00Z', league: 'Top Rank Boxing'
      },
      {
        id: 'bivol-beterbiev2', fighter1: 'Dmitry Bivol', fighter2: 'Artur Beterbiev',
        record1: '24-1 (12 KOs)', record2: '21-0 (20 KOs)',
        odds1: 2.20, odds2: 1.65,
        title: 'Undisputed Light Heavyweight Rematch', venue: 'Kingdom Arena, Riyadh',
        date: '2026-08-15T20:00:00Z', league: 'Riyadh Season Boxing'
      },
      {
        id: 'mayweather-pacquiao2', fighter1: 'Floyd Mayweather', fighter2: 'Manny Pacquiao',
        record1: '50-0 (27 KOs)', record2: '62-8-2 (39 KOs)',
        odds1: 1.55, odds2: 2.40,
        title: 'Exhibition Bout', venue: 'The Sphere, Las Vegas',
        date: '2026-09-19T21:00:00Z', league: 'Netflix Boxing PPV'
      },
    ];

    const now = new Date();
    const upcomingFights = boxingFights.filter(f => new Date(f.date) > now);

    return upcomingFights.map(fight => {
      const drawOdds = parseFloat((15 + Math.random() * 10).toFixed(2));
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
        drawOdds,
        homeRecord: fight.record1,
        awayRecord: fight.record2,
        venue: fight.venue,
        eventTitle: fight.title,
      } as SportEvent;
    });
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
        date: '2026-05-09T23:00:00Z',
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
        date: '2026-05-09T22:00:00Z',
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
        date: '2026-05-09T21:00:00Z',
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
    ];

    const now = new Date();
    const upcomingEvents = wweEvents.filter(e => new Date(e.date) > now);

    return upcomingEvents.map(event => {
      const drawOdds = event.matchType === 'Ladder Match'
        ? parseFloat((4.00 + Math.random() * 3).toFixed(2))
        : parseFloat((8.00 + Math.random() * 12).toFixed(2));

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
        drawOdds,
        venue: event.venue,
        eventTitle: event.title,
      } as SportEvent;
    });
  }

  private generateTennisEvents(): SportEvent[] {
    const TENNIS_SPORT_ID = 3;

    const tennisMatches: {
      id: string; player1: string; player2: string; ranking1: number; ranking2: number;
      odds1: number; odds2: number; tournament: string; round: string;
      date: string; surface: string; location: string;
    }[] = [
      { id: 'iw-alcaraz-sinner', player1: 'Carlos Alcaraz', player2: 'Jannik Sinner', ranking1: 1, ranking2: 2, odds1: 1.83, odds2: 1.95, tournament: 'BNP Paribas Open', round: 'Final', date: '2026-03-15T21:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-djokovic-fritz', player1: 'Novak Djokovic', player2: 'Taylor Fritz', ranking1: 5, ranking2: 4, odds1: 1.55, odds2: 2.40, tournament: 'BNP Paribas Open', round: 'Semi-Final', date: '2026-03-14T20:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-zverev-draper', player1: 'Alexander Zverev', player2: 'Jack Draper', ranking1: 3, ranking2: 8, odds1: 1.65, odds2: 2.20, tournament: 'BNP Paribas Open', round: 'Semi-Final', date: '2026-03-14T18:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-medvedev-shelton', player1: 'Daniil Medvedev', player2: 'Ben Shelton', ranking1: 6, ranking2: 10, odds1: 1.72, odds2: 2.10, tournament: 'BNP Paribas Open', round: 'Quarter-Final', date: '2026-03-13T19:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'iw-rublev-musetti', player1: 'Andrey Rublev', player2: 'Lorenzo Musetti', ranking1: 9, ranking2: 15, odds1: 1.60, odds2: 2.30, tournament: 'BNP Paribas Open', round: 'Quarter-Final', date: '2026-03-13T17:00:00Z', surface: 'Hard', location: 'Indian Wells, USA' },
      { id: 'miami-alcaraz-djokovic', player1: 'Carlos Alcaraz', player2: 'Novak Djokovic', ranking1: 1, ranking2: 5, odds1: 1.50, odds2: 2.55, tournament: 'Miami Open', round: 'Final', date: '2026-03-29T20:00:00Z', surface: 'Hard', location: 'Miami, USA' },
      { id: 'miami-sinner-zverev', player1: 'Jannik Sinner', player2: 'Alexander Zverev', ranking1: 2, ranking2: 3, odds1: 1.65, odds2: 2.20, tournament: 'Miami Open', round: 'Semi-Final', date: '2026-03-28T19:00:00Z', surface: 'Hard', location: 'Miami, USA' },
      { id: 'miami-fritz-draper', player1: 'Taylor Fritz', player2: 'Jack Draper', ranking1: 4, ranking2: 8, odds1: 1.80, odds2: 2.00, tournament: 'Miami Open', round: 'Semi-Final', date: '2026-03-28T17:00:00Z', surface: 'Hard', location: 'Miami, USA' },
      { id: 'mc-alcaraz-sinner', player1: 'Carlos Alcaraz', player2: 'Jannik Sinner', ranking1: 1, ranking2: 2, odds1: 1.60, odds2: 2.25, tournament: 'Monte-Carlo Masters', round: 'Final', date: '2026-04-19T14:00:00Z', surface: 'Clay', location: 'Monte-Carlo, Monaco' },
      { id: 'mc-djokovic-rublev', player1: 'Novak Djokovic', player2: 'Andrey Rublev', ranking1: 5, ranking2: 9, odds1: 1.45, odds2: 2.70, tournament: 'Monte-Carlo Masters', round: 'Semi-Final', date: '2026-04-18T14:00:00Z', surface: 'Clay', location: 'Monte-Carlo, Monaco' },
      { id: 'mc-zverev-musetti', player1: 'Alexander Zverev', player2: 'Lorenzo Musetti', ranking1: 3, ranking2: 15, odds1: 1.40, odds2: 2.85, tournament: 'Monte-Carlo Masters', round: 'Quarter-Final', date: '2026-04-17T12:00:00Z', surface: 'Clay', location: 'Monte-Carlo, Monaco' },
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
      if (sportSlug === 'wwe' || sportSlug === 'entertainment' || sportSlug === 'wwe-entertainment') {
        return cachedFreeSportsEvents.filter(e => e.sportId === 20);
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
    if (!sports.includes('wwe')) sports.push('wwe');
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
           sportSlug === 'cricket' ||
           sportSlug === 'wwe' ||
           sportSlug === 'entertainment';
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
