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
      } else {
        console.log(`[FreeSports] 🎭 WWE Entertainment: 0 events returned from generator`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] WWE generation error:`, error.message, error.stack);
    }

    try {
      const generatedF1 = this.generateF1Schedule();
      if (generatedF1.length > 0) {
        const existingF1Ids = new Set(allEvents.filter(e => e.sportId === 11).map(e => String(e.id)));
        const newF1 = generatedF1.filter(e => !existingF1Ids.has(String(e.id)));
        allEvents.push(...newF1);
        console.log(`[FreeSports] 🏎️ F1 Generated: ${newF1.length} upcoming races added (${existingF1Ids.size} from API skipped)`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] F1 schedule generation error:`, error.message);
    }

    try {
      const generatedUFC = this.generateUFCEvents();
      if (generatedUFC.length > 0) {
        allEvents.push(...generatedUFC);
        console.log(`[FreeSports] 🥋 UFC Generated: ${generatedUFC.length} upcoming fight cards`);
      }
    } catch (error: any) {
      console.error(`[FreeSports] UFC generation error:`, error.message);
    }

    const fallbackSports = [
      { sportId: 2, name: 'NBA', fn: () => this.generateNBAEvents() },
      { sportId: 6, name: 'NHL', fn: () => this.generateNHLEvents() },
      { sportId: 5, name: 'MLB', fn: () => this.generateMLBEvents() },
      { sportId: 12, name: 'Handball', fn: () => this.generateHandballEvents() },
      { sportId: 15, name: 'Rugby', fn: () => this.generateRugbyEvents() },
      { sportId: 16, name: 'Volleyball', fn: () => this.generateVolleyballEvents() },
      { sportId: 10, name: 'AFL', fn: () => this.generateAFLEvents() },
      { sportId: 9, name: 'Cricket', fn: () => this.generateCricketEvents() },
      { sportId: 18, name: 'Horse Racing', fn: () => this.generateFallbackHorseRacing() },
    ];
    for (const fb of fallbackSports) {
      try {
        const existing = allEvents.filter(e => e.sportId === fb.sportId).length;
        if (existing === 0) {
          const generated = fb.fn();
          if (generated.length > 0) {
            allEvents.push(...generated);
            console.log(`[FreeSports] 📋 ${fb.name} Fallback: ${generated.length} upcoming events generated`);
          }
        }
      } catch (error: any) {
        console.error(`[FreeSports] ${fb.name} fallback error:`, error.message);
      }
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

    for (let weekOffset = 0; weekOffset < 8; weekOffset++) {
      let daysUntilMonday = (1 - nowUtcDay + 7) % 7;
      if (daysUntilMonday === 0) daysUntilMonday = 7;
      const mondayMs = nowUtcDate + (daysUntilMonday + weekOffset * 7) * 86400000;

      const venueIdx = weekOffset % rawVenues.length;
      const rawDateStr = new Date(mondayMs + 3600000).toISOString().split('T')[0];
      const rv = rawVenues[venueIdx];

      const [m1, m2, mo1, mo2, mt] = rawMain[weekOffset % rawMain.length];
      events.push({ id: `raw-${rawDateStr}-main`, wrestler1: m1, wrestler2: m2, odds1: mo1, odds2: mo2, title: mt, venue: rv, date: new Date(mondayMs + 4 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Singles Match' });

      const [w1, w2, wo1, wo2, wt] = rawWomens[weekOffset % rawWomens.length];
      events.push({ id: `raw-${rawDateStr}-women`, wrestler1: w1, wrestler2: w2, odds1: wo1, odds2: wo2, title: wt, venue: rv, date: new Date(mondayMs + 3.5 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Singles Match' });

      const [rt1, rt2, rto1, rto2, rtt] = rawTitle[weekOffset % rawTitle.length];
      events.push({ id: `raw-${rawDateStr}-title`, wrestler1: rt1, wrestler2: rt2, odds1: rto1, odds2: rto2, title: rtt, venue: rv, date: new Date(mondayMs + 3 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Championship Match' });

      const [md1, md2, mdo1, mdo2, mdt] = rawMid[weekOffset % rawMid.length];
      events.push({ id: `raw-${rawDateStr}-mid`, wrestler1: md1, wrestler2: md2, odds1: mdo1, odds2: mdo2, title: mdt, venue: rv, date: new Date(mondayMs + 2.5 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Singles Match' });

      const [md21, md22, md2o1, md2o2, md2t] = rawMid2[weekOffset % rawMid2.length];
      events.push({ id: `raw-${rawDateStr}-mid2`, wrestler1: md21, wrestler2: md22, odds1: md2o1, odds2: md2o2, title: md2t, venue: rv, date: new Date(mondayMs + 2 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Singles Match' });

      const [t1, t2, to1, to2, tt] = rawTag[weekOffset % rawTag.length];
      events.push({ id: `raw-${rawDateStr}-tag`, wrestler1: t1, wrestler2: t2, odds1: to1, odds2: to2, title: tt, venue: rv, date: new Date(mondayMs + 1.5 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Tag Team Match' });

      const [ro1, ro2, roo1, roo2, rot] = rawOpener[weekOffset % rawOpener.length];
      events.push({ id: `raw-${rawDateStr}-opener`, wrestler1: ro1, wrestler2: ro2, odds1: roo1, odds2: roo2, title: rot, venue: rv, date: new Date(mondayMs + 1 * 3600000).toISOString(), show: 'Monday Night Raw', matchType: 'Singles Match' });

      const fridayMs = mondayMs + 4 * 86400000;
      const sdVenueIdx = weekOffset % sdVenues.length;
      const sdDateStr = new Date(fridayMs + 3600000).toISOString().split('T')[0];
      const sv = sdVenues[sdVenueIdx];

      const [s1, s2, so1, so2, st] = sdMain[weekOffset % sdMain.length];
      events.push({ id: `sd-${sdDateStr}-main`, wrestler1: s1, wrestler2: s2, odds1: so1, odds2: so2, title: st, venue: sv, date: new Date(fridayMs + 4 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Singles Match' });

      const [sw1, sw2, swo1, swo2, swt] = sdWomens[weekOffset % sdWomens.length];
      events.push({ id: `sd-${sdDateStr}-women`, wrestler1: sw1, wrestler2: sw2, odds1: swo1, odds2: swo2, title: swt, venue: sv, date: new Date(fridayMs + 3.5 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Singles Match' });

      const [sdt1, sdt2, sdto1, sdto2, sdtt] = sdTitle[weekOffset % sdTitle.length];
      events.push({ id: `sd-${sdDateStr}-title`, wrestler1: sdt1, wrestler2: sdt2, odds1: sdto1, odds2: sdto2, title: sdtt, venue: sv, date: new Date(fridayMs + 3 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Championship Match' });

      const [smd1, smd2, smdo1, smdo2, smdt] = sdMid[weekOffset % sdMid.length];
      events.push({ id: `sd-${sdDateStr}-mid`, wrestler1: smd1, wrestler2: smd2, odds1: smdo1, odds2: smdo2, title: smdt, venue: sv, date: new Date(fridayMs + 2.5 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Singles Match' });

      const [smd21, smd22, smd2o1, smd2o2, smd2t] = sdMid2[weekOffset % sdMid2.length];
      events.push({ id: `sd-${sdDateStr}-mid2`, wrestler1: smd21, wrestler2: smd22, odds1: smd2o1, odds2: smd2o2, title: smd2t, venue: sv, date: new Date(fridayMs + 2 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Singles Match' });

      const [st1, st2, sto1, sto2, stt] = sdTag[weekOffset % sdTag.length];
      events.push({ id: `sd-${sdDateStr}-tag`, wrestler1: st1, wrestler2: st2, odds1: sto1, odds2: sto2, title: stt, venue: sv, date: new Date(fridayMs + 1.5 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Tag Team Match' });

      const [sop1, sop2, sopo1, sopo2, sopt] = sdOpener[weekOffset % sdOpener.length];
      events.push({ id: `sd-${sdDateStr}-opener`, wrestler1: sop1, wrestler2: sop2, odds1: sopo1, odds2: sopo2, title: sopt, venue: sv, date: new Date(fridayMs + 1 * 3600000).toISOString(), show: 'Friday Night SmackDown', matchType: 'Singles Match' });
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

  private generateNBAEvents(): SportEvent[] {
    const games: { away: string; home: string; venue: string; date: string }[] = [
      { away: 'Boston Celtics', home: 'Cleveland Cavaliers', venue: 'Rocket Mortgage FieldHouse, Cleveland', date: '2026-03-08T18:00:00Z' },
      { away: 'New York Knicks', home: 'Los Angeles Lakers', venue: 'Crypto.com Arena, Los Angeles', date: '2026-03-08T20:30:00Z' },
      { away: 'Houston Rockets', home: 'San Antonio Spurs', venue: 'Frost Bank Center, San Antonio', date: '2026-03-09T01:00:00Z' },
      { away: 'Detroit Pistons', home: 'Miami Heat', venue: 'Kaseya Center, Miami', date: '2026-03-08T23:00:00Z' },
      { away: 'Dallas Mavericks', home: 'Toronto Raptors', venue: 'Scotiabank Arena, Toronto', date: '2026-03-08T23:00:00Z' },
      { away: 'Washington Wizards', home: 'New Orleans Pelicans', venue: 'Smoothie King Center, New Orleans', date: '2026-03-09T00:00:00Z' },
      { away: 'Orlando Magic', home: 'Milwaukee Bucks', venue: 'Fiserv Forum, Milwaukee', date: '2026-03-09T01:00:00Z' },
      { away: 'Indiana Pacers', home: 'Portland Trail Blazers', venue: 'Moda Center, Portland', date: '2026-03-09T02:00:00Z' },
      { away: 'Chicago Bulls', home: 'Sacramento Kings', venue: 'Golden 1 Center, Sacramento', date: '2026-03-09T02:00:00Z' },
      { away: 'New York Knicks', home: 'LA Clippers', venue: 'Intuit Dome, Inglewood', date: '2026-03-10T03:00:00Z' },
      { away: 'Boston Celtics', home: 'San Antonio Spurs', venue: 'Frost Bank Center, San Antonio', date: '2026-03-11T01:00:00Z' },
      { away: 'Minnesota Timberwolves', home: 'Los Angeles Lakers', venue: 'Crypto.com Arena, Los Angeles', date: '2026-03-11T03:30:00Z' },
      { away: 'Brooklyn Nets', home: 'Atlanta Hawks', venue: 'State Farm Arena, Atlanta', date: '2026-03-13T00:30:00Z' },
      { away: 'Denver Nuggets', home: 'San Antonio Spurs', venue: 'Frost Bank Center, San Antonio', date: '2026-03-13T02:00:00Z' },
      { away: 'Chicago Bulls', home: 'Los Angeles Lakers', venue: 'Crypto.com Arena, Los Angeles', date: '2026-03-13T03:30:00Z' },
      { away: 'Denver Nuggets', home: 'Los Angeles Lakers', venue: 'Crypto.com Arena, Los Angeles', date: '2026-03-15T01:30:00Z' },
    ];
    const now = new Date();
    return games.filter(g => new Date(g.date) > now).map(g => {
      const hOdds = +(1.5 + Math.random() * 0.8).toFixed(2);
      const aOdds = +(1.5 + Math.random() * 0.8).toFixed(2);
      return {
        id: `nba_${g.home.toLowerCase().replace(/\s/g,'-')}_${g.date.slice(5,10)}`,
        sportId: 2, leagueName: 'NBA Regular Season',
        homeTeam: g.home, awayTeam: g.away,
        startTime: g.date, status: 'scheduled', isLive: false,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes: [
          { id: 'home', name: g.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: g.away, odds: aOdds, probability: 1/aOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, venue: g.venue,
      } as SportEvent;
    });
  }

  private generateNHLEvents(): SportEvent[] {
    const games: { away: string; home: string; venue: string; date: string }[] = [
      { away: 'Minnesota Wild', home: 'Colorado Avalanche', venue: 'Ball Arena, Denver', date: '2026-03-08T19:00:00Z' },
      { away: 'Boston Bruins', home: 'Pittsburgh Penguins', venue: 'PPG Paints Arena, Pittsburgh', date: '2026-03-08T21:30:00Z' },
      { away: 'Tampa Bay Lightning', home: 'Buffalo Sabres', venue: 'KeyBank Center, Buffalo', date: '2026-03-08T23:00:00Z' },
      { away: 'Chicago Blackhawks', home: 'Dallas Stars', venue: 'American Airlines Center, Dallas', date: '2026-03-08T23:00:00Z' },
      { away: 'Detroit Red Wings', home: 'New Jersey Devils', venue: 'Prudential Center, Newark', date: '2026-03-09T00:00:00Z' },
      { away: 'St. Louis Blues', home: 'Anaheim Ducks', venue: 'Honda Center, Anaheim', date: '2026-03-09T02:00:00Z' },
      { away: 'Edmonton Oilers', home: 'Vegas Golden Knights', venue: 'T-Mobile Arena, Las Vegas', date: '2026-03-09T02:30:00Z' },
      { away: 'Columbus Blue Jackets', home: 'Florida Panthers', venue: 'Amerant Bank Arena, Sunrise', date: '2026-03-10T00:00:00Z' },
      { away: 'San Jose Sharks', home: 'Boston Bruins', venue: 'TD Garden, Boston', date: '2026-03-10T00:00:00Z' },
      { away: 'Washington Capitals', home: 'Buffalo Sabres', venue: 'KeyBank Center, Buffalo', date: '2026-03-10T00:00:00Z' },
      { away: 'Anaheim Ducks', home: 'Toronto Maple Leafs', venue: 'Scotiabank Arena, Toronto', date: '2026-03-10T00:00:00Z' },
      { away: 'Detroit Red Wings', home: 'Tampa Bay Lightning', venue: 'Amalie Arena, Tampa', date: '2026-03-10T00:00:00Z' },
      { away: 'Calgary Flames', home: 'New Jersey Devils', venue: 'Prudential Center, Newark', date: '2026-03-10T00:00:00Z' },
      { away: 'St. Louis Blues', home: 'Carolina Hurricanes', venue: 'PNC Arena, Raleigh', date: '2026-03-10T00:00:00Z' },
      { away: 'Edmonton Oilers', home: 'Dallas Stars', venue: 'American Airlines Center, Dallas', date: '2026-03-10T01:00:00Z' },
      { away: 'Philadelphia Flyers', home: 'Minnesota Wild', venue: 'Xcel Energy Center, St. Paul', date: '2026-03-10T01:00:00Z' },
      { away: 'New York Rangers', home: 'Winnipeg Jets', venue: 'Canada Life Centre, Winnipeg', date: '2026-03-10T01:00:00Z' },
      { away: 'Nashville Predators', home: 'Vancouver Canucks', venue: 'Rogers Arena, Vancouver', date: '2026-03-10T03:00:00Z' },
      { away: 'Pittsburgh Penguins', home: 'Vegas Golden Knights', venue: 'T-Mobile Arena, Las Vegas', date: '2026-03-10T03:00:00Z' },
      { away: 'Colorado Avalanche', home: 'Seattle Kraken', venue: 'Climate Pledge Arena, Seattle', date: '2026-03-10T03:00:00Z' },
      { away: 'Los Angeles Kings', home: 'New York Islanders', venue: 'UBS Arena, Elmont', date: '2026-03-14T00:00:00Z' },
      { away: 'Edmonton Oilers', home: 'St. Louis Blues', venue: 'Enterprise Center, St. Louis', date: '2026-03-14T01:00:00Z' },
      { away: 'Anaheim Ducks', home: 'Ottawa Senators', venue: 'Canadian Tire Centre, Ottawa', date: '2026-03-14T18:00:00Z' },
      { away: 'Boston Bruins', home: 'Washington Capitals', venue: 'Capital One Arena, Washington', date: '2026-03-14T20:00:00Z' },
      { away: 'Colorado Avalanche', home: 'Winnipeg Jets', venue: 'Canada Life Centre, Winnipeg', date: '2026-03-14T21:00:00Z' },
      { away: 'New York Rangers', home: 'Minnesota Wild', venue: 'Xcel Energy Center, St. Paul', date: '2026-03-14T23:00:00Z' },
      { away: 'Toronto Maple Leafs', home: 'Buffalo Sabres', venue: 'KeyBank Center, Buffalo', date: '2026-03-15T00:00:00Z' },
      { away: 'San Jose Sharks', home: 'Montreal Canadiens', venue: 'Bell Centre, Montreal', date: '2026-03-15T00:00:00Z' },
      { away: 'Carolina Hurricanes', home: 'Tampa Bay Lightning', venue: 'Amalie Arena, Tampa', date: '2026-03-15T00:00:00Z' },
    ];
    const now = new Date();
    return games.filter(g => new Date(g.date) > now).map(g => {
      const hOdds = +(1.6 + Math.random() * 0.7).toFixed(2);
      const aOdds = +(1.6 + Math.random() * 0.7).toFixed(2);
      return {
        id: `nhl_${g.home.toLowerCase().replace(/\s/g,'-')}_${g.date.slice(5,10)}`,
        sportId: 6, leagueName: 'NHL Regular Season',
        homeTeam: g.home, awayTeam: g.away,
        startTime: g.date, status: 'scheduled', isLive: false,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes: [
          { id: 'home', name: g.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: g.away, odds: aOdds, probability: 1/aOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, venue: g.venue,
      } as SportEvent;
    });
  }

  private generateMLBEvents(): SportEvent[] {
    const games: { away: string; home: string; venue: string; date: string; league: string }[] = [
      { away: 'Arizona Diamondbacks', home: 'Cincinnati Reds', venue: 'Goodyear Ballpark, Goodyear AZ', date: '2026-03-08T21:05:00Z', league: 'Cactus League' },
      { away: 'Los Angeles Dodgers', home: 'Oakland Athletics', venue: 'Hohokam Stadium, Mesa AZ', date: '2026-03-08T21:05:00Z', league: 'Cactus League' },
      { away: 'San Francisco Giants', home: 'Chicago Cubs', venue: 'Sloan Park, Mesa AZ', date: '2026-03-08T21:05:00Z', league: 'Cactus League' },
      { away: 'Cincinnati Reds', home: 'San Diego Padres', venue: 'Peoria Sports Complex, Peoria AZ', date: '2026-03-08T21:10:00Z', league: 'Cactus League' },
      { away: 'Los Angeles Angels', home: 'Texas Rangers', venue: 'Surprise Stadium, Surprise AZ', date: '2026-03-08T21:05:00Z', league: 'Cactus League' },
      { away: 'Seattle Mariners', home: 'Milwaukee Brewers', venue: 'American Family Fields, Phoenix AZ', date: '2026-03-08T21:10:00Z', league: 'Cactus League' },
      { away: 'Cleveland Guardians', home: 'Colorado Rockies', venue: 'Salt River Fields, Scottsdale AZ', date: '2026-03-08T21:10:00Z', league: 'Cactus League' },
      { away: 'Kansas City Royals', home: 'Chicago White Sox', venue: 'Camelback Ranch, Glendale AZ', date: '2026-03-08T21:05:00Z', league: 'Cactus League' },
      { away: 'Arizona Diamondbacks', home: 'San Francisco Giants', venue: 'Scottsdale Stadium, Scottsdale AZ', date: '2026-03-14T21:05:00Z', league: 'Cactus League' },
      { away: 'Los Angeles Dodgers', home: 'Chicago White Sox', venue: 'Camelback Ranch, Glendale AZ', date: '2026-03-14T21:05:00Z', league: 'Cactus League' },
      { away: 'Texas Rangers', home: 'Cincinnati Reds', venue: 'Goodyear Ballpark, Goodyear AZ', date: '2026-03-14T21:05:00Z', league: 'Cactus League' },
      { away: 'Kansas City Royals', home: 'Oakland Athletics', venue: 'Hohokam Stadium, Mesa AZ', date: '2026-03-14T21:05:00Z', league: 'Cactus League' },
      { away: 'Colorado Rockies', home: 'Milwaukee Brewers', venue: 'American Family Fields, Phoenix AZ', date: '2026-03-14T21:10:00Z', league: 'Cactus League' },
      { away: 'San Diego Padres', home: 'Texas Rangers', venue: 'Surprise Stadium, Surprise AZ', date: '2026-03-14T21:10:00Z', league: 'Cactus League' },
      { away: 'Chicago Cubs', home: 'Colorado Rockies', venue: 'Salt River Fields, Scottsdale AZ', date: '2026-03-14T21:10:00Z', league: 'Cactus League' },
      { away: 'Seattle Mariners', home: 'Los Angeles Angels', venue: 'Tempe Diablo Stadium, Tempe AZ', date: '2026-03-14T21:10:00Z', league: 'Cactus League' },
      { away: 'Cleveland Guardians', home: 'San Diego Padres', venue: 'Peoria Sports Complex, Peoria AZ', date: '2026-03-14T21:10:00Z', league: 'Cactus League' },
    ];
    const now = new Date();
    return games.filter(g => new Date(g.date) > now).map(g => {
      const hOdds = +(1.5 + Math.random() * 0.9).toFixed(2);
      const aOdds = +(1.5 + Math.random() * 0.9).toFixed(2);
      return {
        id: `mlb_${g.home.toLowerCase().replace(/\s/g,'-')}_${g.date.slice(5,10)}`,
        sportId: 5, leagueName: `MLB Spring Training - ${g.league}`,
        homeTeam: g.home, awayTeam: g.away,
        startTime: g.date, status: 'scheduled', isLive: false,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes: [
          { id: 'home', name: g.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: g.away, odds: aOdds, probability: 1/aOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, venue: g.venue,
      } as SportEvent;
    });
  }

  private generateHandballEvents(): SportEvent[] {
    const games: { home: string; away: string; league: string; venue: string; date: string }[] = [
      { home: 'Wisla Plock', away: 'Szeged', league: 'EHF Champions League - MD14', venue: 'Orlen Arena, Plock', date: '2026-03-11T17:45:00Z' },
      { home: 'GOG', away: 'RK Zagreb', league: 'EHF Champions League - MD14', venue: 'Gudme Arena, Gudme', date: '2026-03-11T17:45:00Z' },
      { home: 'FC Barcelona', away: 'Eurofarm Pelister', league: 'EHF Champions League - MD14', venue: 'Palau Blaugrana, Barcelona', date: '2026-03-11T18:00:00Z' },
      { home: 'Paris Saint-Germain', away: 'SC Magdeburg', league: 'EHF Champions League - MD14', venue: 'Stade Pierre de Coubertin, Paris', date: '2026-03-11T18:00:00Z' },
      { home: 'Veszprem', away: 'Aalborg Handbold', league: 'EHF Champions League - MD14', venue: 'Veszprem Arena, Veszprem', date: '2026-03-12T17:45:00Z' },
      { home: 'Kolstad', away: 'Industria Kielce', league: 'EHF Champions League - MD14', venue: 'Kolstad Arena, Trondheim', date: '2026-03-12T17:45:00Z' },
      { home: 'Fuchse Berlin', away: 'HBC Nantes', league: 'EHF Champions League - MD14', venue: 'Max-Schmeling-Halle, Berlin', date: '2026-03-12T18:00:00Z' },
      { home: 'Sporting Lisboa', away: 'Dinamo Bucuresti', league: 'EHF Champions League - MD14', venue: 'Pavilhao Joao Rocha, Lisbon', date: '2026-03-12T18:00:00Z' },
    ];
    const now = new Date();
    return games.filter(g => new Date(g.date) > now).map(g => {
      const hOdds = +(1.4 + Math.random() * 1.0).toFixed(2);
      const aOdds = +(1.4 + Math.random() * 1.0).toFixed(2);
      const drawOdds = +(6.0 + Math.random() * 3.0).toFixed(2);
      return {
        id: `handball_${g.home.toLowerCase().replace(/\s/g,'-')}_${g.date.slice(5,10)}`,
        sportId: 12, leagueName: g.league,
        homeTeam: g.home, awayTeam: g.away,
        startTime: g.date, status: 'scheduled', isLive: false,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes: [
          { id: 'home', name: g.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: g.away, odds: aOdds, probability: 1/aOdds },
          { id: 'draw', name: 'Draw', odds: drawOdds, probability: 1/drawOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, drawOdds, venue: g.venue,
      } as SportEvent;
    });
  }

  private generateRugbyEvents(): SportEvent[] {
    const games: { home: string; away: string; league: string; venue: string; date: string }[] = [
      { home: 'Ireland', away: 'Scotland', league: 'Six Nations 2026 - Round 5', venue: 'Aviva Stadium, Dublin', date: '2026-03-14T14:10:00Z' },
      { home: 'Wales', away: 'Italy', league: 'Six Nations 2026 - Round 5', venue: 'Principality Stadium, Cardiff', date: '2026-03-14T16:40:00Z' },
      { home: 'France', away: 'England', league: 'Six Nations 2026 - Round 5', venue: 'Stade de France, Paris', date: '2026-03-14T20:40:00Z' },
    ];
    const now = new Date();
    return games.filter(g => new Date(g.date) > now).map(g => {
      const hOdds = +(1.3 + Math.random() * 1.0).toFixed(2);
      const aOdds = +(1.3 + Math.random() * 1.0).toFixed(2);
      const drawOdds = +(12.0 + Math.random() * 8.0).toFixed(2);
      return {
        id: `rugby_${g.home.toLowerCase().replace(/\s/g,'-')}_${g.date.slice(5,10)}`,
        sportId: 15, leagueName: g.league,
        homeTeam: g.home, awayTeam: g.away,
        startTime: g.date, status: 'scheduled', isLive: false,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes: [
          { id: 'home', name: g.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: g.away, odds: aOdds, probability: 1/aOdds },
          { id: 'draw', name: 'Draw', odds: drawOdds, probability: 1/drawOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, drawOdds, venue: g.venue,
      } as SportEvent;
    });
  }

  private generateVolleyballEvents(): SportEvent[] {
    const games: { home: string; away: string; league: string; venue: string; date: string }[] = [
      { home: 'Trentino Volley', away: 'Lube Civitanova', league: 'SuperLega Serie A', venue: 'BLM Group Arena, Trento', date: '2026-03-08T17:00:00Z' },
      { home: 'Verona Volley', away: 'Milano Powervolley', league: 'SuperLega Serie A', venue: 'AGSM Forum, Verona', date: '2026-03-08T18:00:00Z' },
      { home: 'Modena Volley', away: 'Gas Sales Piacenza', league: 'SuperLega Serie A', venue: 'PalaPanini, Modena', date: '2026-03-08T20:30:00Z' },
      { home: 'Vero Volley Milano', away: 'VakifBank Istanbul', league: 'CEV Champions League (W)', venue: 'Allianz Cloud, Milan', date: '2026-03-10T18:00:00Z' },
      { home: 'Gas Sales Piacenza', away: 'Modena Volley', league: 'SuperLega Serie A', venue: 'PalaBanca, Piacenza', date: '2026-03-14T17:00:00Z' },
      { home: 'Monza', away: 'Sir Safety Perugia', league: 'SuperLega Serie A', venue: 'Arena di Monza, Monza', date: '2026-03-15T17:00:00Z' },
      { home: 'Lube Civitanova', away: 'Trentino Volley', league: 'SuperLega Serie A', venue: 'Eurosuole Forum, Civitanova Marche', date: '2026-03-15T18:00:00Z' },
      { home: 'Milano Powervolley', away: 'Verona Volley', league: 'SuperLega Serie A', venue: 'Allianz Cloud, Milan', date: '2026-03-15T20:30:00Z' },
    ];
    const now = new Date();
    return games.filter(g => new Date(g.date) > now).map(g => {
      const hOdds = +(1.4 + Math.random() * 0.8).toFixed(2);
      const aOdds = +(1.4 + Math.random() * 0.8).toFixed(2);
      return {
        id: `volleyball_${g.home.toLowerCase().replace(/\s/g,'-')}_${g.date.slice(5,10)}`,
        sportId: 16, leagueName: g.league,
        homeTeam: g.home, awayTeam: g.away,
        startTime: g.date, status: 'scheduled', isLive: false,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes: [
          { id: 'home', name: g.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: g.away, odds: aOdds, probability: 1/aOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, venue: g.venue,
      } as SportEvent;
    });
  }

  private generateAFLEvents(): SportEvent[] {
    const games: { home: string; away: string; venue: string; date: string; round: string }[] = [
      { home: 'St Kilda Saints', away: 'Collingwood Magpies', venue: 'MCG, Melbourne', date: '2026-03-08T09:00:00Z', round: 'Opening Round' },
      { home: 'Carlton Blues', away: 'Richmond Tigers', venue: 'MCG, Melbourne', date: '2026-03-12T08:30:00Z', round: 'Round 1' },
      { home: 'Essendon Bombers', away: 'Hawthorn Hawks', venue: 'MCG, Melbourne', date: '2026-03-13T08:40:00Z', round: 'Round 1' },
      { home: 'Western Bulldogs', away: 'GWS Giants', venue: 'Marvel Stadium, Melbourne', date: '2026-03-14T02:15:00Z', round: 'Round 1' },
      { home: 'Geelong Cats', away: 'Fremantle Dockers', venue: 'GMHBA Stadium, Geelong', date: '2026-03-14T05:15:00Z', round: 'Round 1' },
      { home: 'Sydney Swans', away: 'Brisbane Lions', venue: 'SCG, Sydney', date: '2026-03-14T08:10:00Z', round: 'Round 1' },
      { home: 'Collingwood Magpies', away: 'Adelaide Crows', venue: 'MCG, Melbourne', date: '2026-03-14T08:35:00Z', round: 'Round 1' },
      { home: 'North Melbourne', away: 'Port Adelaide Power', venue: 'Marvel Stadium, Melbourne', date: '2026-03-15T02:10:00Z', round: 'Round 1' },
      { home: 'Melbourne Demons', away: 'West Coast Eagles', venue: 'MCG, Melbourne', date: '2026-03-15T04:10:00Z', round: 'Round 1' },
      { home: 'Gold Coast Suns', away: 'St Kilda Saints', venue: 'People First Stadium, Gold Coast', date: '2026-03-15T06:10:00Z', round: 'Round 1' },
    ];
    const now = new Date();
    return games.filter(g => new Date(g.date) > now).map(g => {
      const hOdds = +(1.5 + Math.random() * 0.8).toFixed(2);
      const aOdds = +(1.5 + Math.random() * 0.8).toFixed(2);
      return {
        id: `afl_${g.home.toLowerCase().replace(/\s/g,'-')}_${g.date.slice(5,10)}`,
        sportId: 10, leagueName: `AFL 2026 - ${g.round}`,
        homeTeam: g.home, awayTeam: g.away,
        startTime: g.date, status: 'scheduled', isLive: false,
        markets: [{ id: 'match_winner', name: 'Match Winner', outcomes: [
          { id: 'home', name: g.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: g.away, odds: aOdds, probability: 1/aOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, venue: g.venue,
      } as SportEvent;
    });
  }

  private generateCricketEvents(): SportEvent[] {
    const now = new Date();
    const matches: Array<{home: string; away: string; venue: string; league: string; date: Date}> = [];

    const iccChampionsTrophy = [
      { home: 'India', away: 'Bangladesh', venue: 'Dubai International Stadium, Dubai', date: new Date('2026-02-19T09:30:00Z') },
      { home: 'Australia', away: 'England', venue: 'Gaddafi Stadium, Lahore', date: new Date('2026-02-22T09:30:00Z') },
      { home: 'Pakistan', away: 'New Zealand', venue: 'National Stadium, Karachi', date: new Date('2026-02-23T09:30:00Z') },
      { home: 'South Africa', away: 'Sri Lanka', venue: 'Dubai International Stadium, Dubai', date: new Date('2026-02-25T09:30:00Z') },
      { home: 'India', away: 'Pakistan', venue: 'Dubai International Stadium, Dubai', date: new Date('2026-02-28T09:30:00Z') },
      { home: 'England', away: 'West Indies', venue: 'Gaddafi Stadium, Lahore', date: new Date('2026-03-01T09:30:00Z') },
      { home: 'Australia', away: 'South Africa', venue: 'Rawalpindi Cricket Stadium', date: new Date('2026-03-02T09:30:00Z') },
      { home: 'New Zealand', away: 'Bangladesh', venue: 'National Stadium, Karachi', date: new Date('2026-03-04T09:30:00Z') },
    ];
    iccChampionsTrophy.forEach(m => matches.push({ ...m, league: 'ICC Champions Trophy 2026' }));

    const iplMatches = [
      { home: 'Chennai Super Kings', away: 'Mumbai Indians', venue: 'MA Chidambaram Stadium, Chennai', date: new Date('2026-03-14T14:00:00Z') },
      { home: 'Royal Challengers Bengaluru', away: 'Kolkata Knight Riders', venue: 'M. Chinnaswamy Stadium, Bengaluru', date: new Date('2026-03-15T14:00:00Z') },
      { home: 'Delhi Capitals', away: 'Punjab Kings', venue: 'Arun Jaitley Stadium, Delhi', date: new Date('2026-03-16T14:00:00Z') },
      { home: 'Rajasthan Royals', away: 'Sunrisers Hyderabad', venue: 'Sawai Mansingh Stadium, Jaipur', date: new Date('2026-03-17T14:00:00Z') },
      { home: 'Gujarat Titans', away: 'Lucknow Super Giants', venue: 'Narendra Modi Stadium, Ahmedabad', date: new Date('2026-03-18T14:00:00Z') },
      { home: 'Mumbai Indians', away: 'Royal Challengers Bengaluru', venue: 'Wankhede Stadium, Mumbai', date: new Date('2026-03-20T14:00:00Z') },
      { home: 'Kolkata Knight Riders', away: 'Chennai Super Kings', venue: 'Eden Gardens, Kolkata', date: new Date('2026-03-21T14:00:00Z') },
      { home: 'Sunrisers Hyderabad', away: 'Delhi Capitals', venue: 'Rajiv Gandhi Intl Stadium, Hyderabad', date: new Date('2026-03-22T14:00:00Z') },
    ];
    iplMatches.forEach(m => matches.push({ ...m, league: 'IPL 2026' }));

    const countyMatches = [
      { home: 'Surrey', away: 'Hampshire', venue: 'The Oval, London', league: 'County Championship', date: new Date('2026-03-10T10:00:00Z') },
      { home: 'Essex', away: 'Kent', venue: 'County Ground, Chelmsford', league: 'County Championship', date: new Date('2026-03-11T10:00:00Z') },
      { home: 'Yorkshire', away: 'Lancashire', venue: 'Headingley, Leeds', league: 'County Championship', date: new Date('2026-03-12T10:00:00Z') },
      { home: 'Nottinghamshire', away: 'Warwickshire', venue: 'Trent Bridge, Nottingham', league: 'County Championship', date: new Date('2026-03-13T10:00:00Z') },
    ];
    matches.push(...countyMatches);

    const upcoming = matches.filter(m => m.date.getTime() > now.getTime());
    if (upcoming.length === 0) {
      const futureMatches = [...iccChampionsTrophy, ...iplMatches].map((m, i) => ({
        ...m,
        league: i < iccChampionsTrophy.length ? 'ICC Champions Trophy 2026' : 'IPL 2026',
        date: new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000)
      }));
      upcoming.push(...futureMatches);
    }

    return upcoming.map(m => {
      const hStr = (2.0 + Math.random() * 3.0);
      const aStr = (2.0 + Math.random() * 3.0);
      const total = hStr + aStr;
      const hProb = hStr / total;
      const aProb = aStr / total;
      const margin = 1.08;
      const hOdds = parseFloat((margin / hProb).toFixed(2));
      const aOdds = parseFloat((margin / aProb).toFixed(2));
      return {
        id: `cricket_fb_${m.home.toLowerCase().replace(/\s/g, '-')}_${m.date.getTime()}`,
        sportId: 9,
        sportName: 'Cricket',
        league: m.league,
        homeTeam: m.home,
        awayTeam: m.away,
        startTime: m.date.toISOString(),
        status: 'upcoming',
        markets: [{ type: 'match_winner', outcomes: [
          { id: 'home', name: m.home, odds: hOdds, probability: 1/hOdds },
          { id: 'away', name: m.away, odds: aOdds, probability: 1/aOdds },
        ]}],
        homeOdds: hOdds, awayOdds: aOdds, venue: m.venue,
      } as SportEvent;
    });
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
    }
    return cachedFreeSportsEvents;
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
