import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SportEvent, MarketData, OutcomeData } from '../types/betting';

export interface FreeSportsResult {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: 'home' | 'away' | 'draw';
  status: string;
}

const CACHE_DIR = '/tmp';
const CACHE_DATE_FILE = path.join(CACHE_DIR, 'free_sports_cache_date.txt');
const CACHE_DATA_FILE = path.join(CACHE_DIR, 'free_sports_cache_data.json');

let cachedFreeSportsEvents: SportEvent[] = [];
let lastFetchTime: number = 0;
let lastResultsFetchTime: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;

let lastUpcomingFetchDate: string = '';
let lastResultsFetchDate: string = '';

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

function saveCacheToFile(): void {
  try {
    fs.writeFileSync(CACHE_DATE_FILE, lastUpcomingFetchDate);
    fs.writeFileSync(CACHE_DATA_FILE, JSON.stringify(cachedFreeSportsEvents));
  } catch (err: any) {
    console.warn(`[FreeSports] Could not save cache to file: ${err.message}`);
  }
}

loadCacheFromFile();

const getUTCDateString = (): string => new Date().toISOString().split('T')[0];

const FREE_SPORTS_CONFIG: Record<string, {
  endpoint: string;
  apiHost: string;
  sportId: number;
  name: string;
  hasDraws: boolean;
  daysAhead: number;
  isRapidApi?: boolean;
  rapidApiKey?: string;
}> = {
  basketball: {
    endpoint: 'https://v1.basketball.api-sports.io/games',
    apiHost: 'v1.basketball.api-sports.io',
    sportId: 2,
    name: 'Basketball',
    hasDraws: false,
    daysAhead: 2
  },
  baseball: {
    endpoint: 'https://v1.baseball.api-sports.io/games',
    apiHost: 'v1.baseball.api-sports.io',
    sportId: 5,
    name: 'Baseball',
    hasDraws: false,
    daysAhead: 2
  },
  'ice-hockey': {
    endpoint: 'https://v1.hockey.api-sports.io/games',
    apiHost: 'v1.hockey.api-sports.io',
    sportId: 6,
    name: 'Ice Hockey',
    hasDraws: false,
    daysAhead: 2
  },
  mma: {
    endpoint: 'https://v1.mma.api-sports.io/fights',
    apiHost: 'v1.mma.api-sports.io',
    sportId: 7,
    name: 'MMA',
    hasDraws: false,
    daysAhead: 2
  },
  'american-football': {
    endpoint: 'https://v1.american-football.api-sports.io/games',
    apiHost: 'v1.american-football.api-sports.io',
    sportId: 4,
    name: 'American Football',
    hasDraws: false,
    daysAhead: 2
  },
  afl: {
    endpoint: 'https://v1.afl.api-sports.io/games',
    apiHost: 'v1.afl.api-sports.io',
    sportId: 10,
    name: 'AFL',
    hasDraws: true,
    daysAhead: 2
  },
  handball: {
    endpoint: 'https://v1.handball.api-sports.io/games',
    apiHost: 'v1.handball.api-sports.io',
    sportId: 12,
    name: 'Handball',
    hasDraws: true,
    daysAhead: 2
  },
  rugby: {
    endpoint: 'https://v1.rugby.api-sports.io/games',
    apiHost: 'v1.rugby.api-sports.io',
    sportId: 15,
    name: 'Rugby',
    hasDraws: true,
    daysAhead: 2
  },
  volleyball: {
    endpoint: 'https://v1.volleyball.api-sports.io/games',
    apiHost: 'v1.volleyball.api-sports.io',
    sportId: 16,
    name: 'Volleyball',
    hasDraws: false,
    daysAhead: 2
  },
  'horse-racing': {
    endpoint: 'https://the-racing-api1.p.rapidapi.com/v1/racecards/free',
    apiHost: 'the-racing-api1.p.rapidapi.com',
    sportId: 17,
    name: 'Horse Racing',
    hasDraws: false,
    daysAhead: 1,
    isRapidApi: true,
    rapidApiKey: '35244dbeebmsh90d96a714c2827fp1b3101jsnafe411c38a3a'
  },
  cricket: {
    endpoint: 'https://cricket-api-free-data.p.rapidapi.com/cricket-schedule',
    apiHost: 'cricket-api-free-data.p.rapidapi.com',
    sportId: 18,
    name: 'Cricket',
    hasDraws: true,
    daysAhead: 7,
    isRapidApi: true,
    rapidApiKey: '35244dbeebmsh90d96a714c2827fp1b3101jsnafe411c38a3a'
  },
};

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
  
  if (category.includes('boxing') || (category.includes('heavyweight') && !slug.includes('ufc') && !slug.includes('mma'))) {
    return true;
  }
  
  return false;
}

function safeParseDate(game: any): string {
  if (game.date && typeof game.date === 'string') {
    try {
      const d = new Date(game.date);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch {}
  }
  if (game.timestamp && typeof game.timestamp === 'number') {
    try {
      const d = new Date(game.timestamp * 1000);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch {}
  }
  if (game.time && typeof game.time === 'string') {
    try {
      const d = new Date(game.time);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch {}
  }
  return new Date().toISOString();
}

const API_KEY = process.env.API_SPORTS_KEY || '';

export class FreeSportsService {
  private isRunning: boolean = false;
  private morningSchedulerInterval: NodeJS.Timeout | null = null;
  private nightSchedulerInterval: NodeJS.Timeout | null = null;

  startSchedulers(): void {
    if (this.isRunning) {
      console.log('[FreeSports] Schedulers already running');
      return;
    }

    this.isRunning = true;
    const sportNames = Object.keys(FREE_SPORTS_CONFIG).join(', ');
    console.log('[FreeSports] Starting daily schedulers for free sports');
    console.log(`[FreeSports] Sports: ${sportNames}`);
    console.log('[FreeSports] Schedule: Upcoming 6AM UTC, Results 11PM UTC');

    const today = getUTCDateString();
    
    if (lastUpcomingFetchDate !== today || cachedFreeSportsEvents.length === 0) {
      console.log(`[FreeSports] Initial fetch of upcoming matches (date: ${lastUpcomingFetchDate}, cache: ${cachedFreeSportsEvents.length} events)...`);
      this.fetchAllUpcomingMatches().catch(err => {
        console.error('[FreeSports] Initial fetch failed:', err.message);
      });
    } else {
      console.log(`[FreeSports] Using cached data - ${cachedFreeSportsEvents.length} events (fetched: ${lastUpcomingFetchDate})`);
    }

    this.morningSchedulerInterval = setInterval(() => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const todayStr = getUTCDateString();
      if (utcHour === 6 && lastUpcomingFetchDate !== todayStr) {
        console.log('[FreeSports] Morning fetch triggered (6 AM UTC)');
        this.fetchAllUpcomingMatches().catch(err => {
          console.error('[FreeSports] Morning fetch failed:', err.message);
        });
      }
    }, 60 * 60 * 1000);

    this.nightSchedulerInterval = setInterval(() => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const todayStr = getUTCDateString();
      if (utcHour === 23 && lastResultsFetchDate !== todayStr) {
        console.log('[FreeSports] Night results fetch triggered (11 PM UTC)');
        this.fetchAllResults().catch(err => {
          console.error('[FreeSports] Night results fetch failed:', err.message);
        });
      }
    }, 60 * 60 * 1000);

    console.log('[FreeSports] ✅ Daily schedulers started');
  }

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

  async fetchAllUpcomingMatches(): Promise<SportEvent[]> {
    console.log('[FreeSports] 📅 Fetching upcoming matches for all free sports...');
    
    const allEvents: SportEvent[] = [];

    for (const [sportSlug, config] of Object.entries(FREE_SPORTS_CONFIG)) {
      try {
        let sportEvents: SportEvent[] = [];
        const daysToFetch = config.daysAhead || 2;
        let sportRateLimited = false;

        if (sportSlug === 'cricket') {
          sportEvents = await this.fetchCricket(config);
        } else if (sportSlug === 'horse-racing') {
          sportEvents = await this.fetchHorseRacing(config);
        } else {
          for (let dayOffset = 0; dayOffset < daysToFetch; dayOffset++) {
            if (sportRateLimited) break;
            
            const fetchDate = new Date();
            fetchDate.setUTCDate(fetchDate.getUTCDate() + dayOffset);
            
            try {
              const dayEvents = await this.fetchUpcomingForSingleDate(sportSlug, config, fetchDate);
              sportEvents.push(...dayEvents);
            } catch (dayErr: any) {
              if (dayErr.response?.status === 429) {
                console.warn(`[FreeSports] Rate limited for ${config.name} day+${dayOffset}, skipping remaining days`);
                sportRateLimited = true;
                break;
              }
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
          }
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
          console.log(`[FreeSports] ${config.name}: ${sportEvents.length} upcoming events (${daysToFetch} days)`);
        }
        allEvents.push(...sportEvents);
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[FreeSports] Error fetching ${config.name}:`, error.message);
      }
    }

    if (allEvents.length > 0) {
      cachedFreeSportsEvents = allEvents;
      lastFetchTime = Date.now();
      lastUpcomingFetchDate = getUTCDateString();
      saveCacheToFile();
      console.log(`[FreeSports] ✅ Total: ${allEvents.length} upcoming events cached (locked until ${lastUpcomingFetchDate})`);
    } else {
      console.warn(`[FreeSports] ⚠️ Got 0 events - likely API rate limit. NOT overwriting cache.`);
    }
    return allEvents;
  }

  private async fetchCricket(config: typeof FREE_SPORTS_CONFIG[string]): Promise<SportEvent[]> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'x-rapidapi-key': config.rapidApiKey || '35244dbeebmsh90d96a714c2827fp1b3101jsnafe411c38a3a',
        'x-rapidapi-host': config.apiHost
      };

      const response = await axios.get(config.endpoint, { headers, timeout: 15000 });

      const schedules = response.data?.response?.schedules || [];
      if (schedules.length === 0) {
        console.log('[FreeSports] Cricket: No schedules found');
        return [];
      }

      const events: SportEvent[] = [];
      const seenMatchIds = new Set<string>();

      for (const sched of schedules) {
        const wrapper = sched.scheduleAdWrapper;
        if (!wrapper) continue;

        for (const matchList of (wrapper.matchScheduleList || [])) {
          const seriesName = matchList.seriesName || 'Cricket Series';

          for (const matchInfo of (matchList.matchInfo || [])) {
            const matchId = String(matchInfo.matchId || `cr-${Math.random().toString(36).slice(2,8)}`);
            if (seenMatchIds.has(matchId)) continue;
            seenMatchIds.add(matchId);

            const team1 = matchInfo.team1?.teamName || 'Team 1';
            const team2 = matchInfo.team2?.teamName || 'Team 2';
            const format = matchInfo.matchFormat || '';
            const venue = matchInfo.venueInfo?.ground || '';
            const city = matchInfo.venueInfo?.city || '';

            let startTime: string;
            if (matchInfo.startDate) {
              try {
                const ts = typeof matchInfo.startDate === 'number' ? matchInfo.startDate : parseInt(matchInfo.startDate);
                startTime = new Date(ts).toISOString();
              } catch { startTime = new Date().toISOString(); }
            } else {
              startTime = new Date().toISOString();
            }

            const homeOdds = 1.5 + Math.random() * 1.5;
            const awayOdds = 1.5 + Math.random() * 1.5;
            const drawOdds = 3.0 + Math.random() * 2.0;

            const outcomes: OutcomeData[] = [
              { id: 'home', name: team1, odds: parseFloat(homeOdds.toFixed(2)), probability: 1 / homeOdds },
              { id: 'away', name: team2, odds: parseFloat(awayOdds.toFixed(2)), probability: 1 / awayOdds }
            ];

            if (format === 'TEST' || format === 'ODI') {
              outcomes.push({ id: 'draw', name: 'Draw', odds: parseFloat(drawOdds.toFixed(2)), probability: 1 / drawOdds });
            }

            const markets: MarketData[] = [
              { id: 'winner', name: 'Match Winner', outcomes }
            ];

            if (format === 'T20' || format === 'ODI') {
              const overLine = format === 'T20' ? 160.5 : 280.5;
              markets.push({
                id: 'total_runs',
                name: `Total Runs (Over/Under ${overLine})`,
                outcomes: [
                  { id: 'over', name: `Over ${overLine}`, odds: parseFloat((1.8 + Math.random() * 0.4).toFixed(2)), probability: 0.5 },
                  { id: 'under', name: `Under ${overLine}`, odds: parseFloat((1.8 + Math.random() * 0.4).toFixed(2)), probability: 0.5 }
                ]
              });
            }

            if (format === 'T20') {
              markets.push({
                id: 'top_batsman',
                name: 'Highest Opening Partnership',
                outcomes: [
                  { id: 'home_open', name: `${team1} Openers`, odds: parseFloat((1.8 + Math.random() * 0.5).toFixed(2)), probability: 0.5 },
                  { id: 'away_open', name: `${team2} Openers`, odds: parseFloat((1.8 + Math.random() * 0.5).toFixed(2)), probability: 0.5 }
                ]
              });
            }

            const leagueName = `${seriesName}${format ? ' (' + format + ')' : ''}`;
            const awayLabel = `${team2}${venue ? ' @ ' + venue : ''}${city ? ', ' + city : ''}`;

            events.push({
              id: `cricket_${matchId}`,
              sportId: 18,
              leagueName,
              homeTeam: team1,
              awayTeam: awayLabel,
              startTime,
              status: 'scheduled',
              isLive: false,
              markets,
              homeOdds: parseFloat(homeOdds.toFixed(2)),
              awayOdds: parseFloat(awayOdds.toFixed(2)),
              drawOdds: (format === 'TEST' || format === 'ODI') ? parseFloat(drawOdds.toFixed(2)) : undefined
            });
          }
        }
      }

      console.log(`[FreeSports] Cricket: Parsed ${events.length} matches from ${schedules.length} schedule days`);
      return events;
    } catch (error: any) {
      console.error('[FreeSports] Cricket fetch error:', error.message);
      return [];
    }
  }

  private async fetchHorseRacing(config: typeof FREE_SPORTS_CONFIG[string]): Promise<SportEvent[]> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'x-rapidapi-key': config.rapidApiKey || '35244dbeebmsh90d96a714c2827fp1b3101jsnafe411c38a3a',
        'x-rapidapi-host': config.apiHost
      };

      const response = await axios.get(config.endpoint, {
        params: { day: 'today' },
        headers,
        timeout: 15000
      });

      let races: any[] = [];
      
      if (Array.isArray(response.data)) {
        races = response.data;
      } else if (response.data?.response && Array.isArray(response.data.response)) {
        races = response.data.response;
      } else if (response.data?.racecards && Array.isArray(response.data.racecards)) {
        races = response.data.racecards;
      } else if (typeof response.data === 'object' && response.data !== null) {
        const keys = Object.keys(response.data);
        for (const key of keys) {
          if (Array.isArray(response.data[key])) {
            races = response.data[key];
            break;
          }
        }
      }

      if (races.length === 0) {
        console.log(`[FreeSports] Horse Racing: No races found. Response keys: ${typeof response.data === 'object' ? Object.keys(response.data || {}).join(',') : typeof response.data}`);
        return [];
      }

      const events: SportEvent[] = [];
      for (const race of races) {
        try {
          const raceName = race.race || race.name || race.race_name || race.title || 'Horse Race';
          const course = race.course || race.venue || race.track || race.course_name || 'Racecourse';
          const raceId = String(race.race_id || race.id || `hr-${Math.random().toString(36).slice(2,8)}`);
          let startTime: string;
          if (race.off_dt) {
            try { startTime = new Date(race.off_dt).toISOString(); } catch { startTime = safeParseDate(race); }
          } else if (race.off_time && race.date) {
            try { startTime = new Date(`${race.date}T${race.off_time}:00Z`).toISOString(); } catch { startTime = safeParseDate(race); }
          } else {
            startTime = safeParseDate(race);
          }

          const raceRunners = race.runners || race.horses || race.entries || [];
          const runnerCount = raceRunners.length;
          const distance = race.distance_f ? `${race.distance_f}f` : '';
          const going = race.going || '';
          const raceClass = race.race_class || race.pattern || '';
          const prize = race.prize || '';

          const outcomes: OutcomeData[] = raceRunners.map((runner: any, idx: number) => {
            const horseName = runner.horse || runner.horse_name || runner.name || `Runner ${idx + 1}`;
            const jockey = runner.jockey || '';
            const trainer = runner.trainer || '';
            const number = runner.number || (idx + 1);
            const form = runner.form || '';

            const baseOdds = 2.0 + (Math.random() * (runnerCount * 1.5));
            const odds = parseFloat(baseOdds.toFixed(2));

            return {
              id: `runner_${number}`,
              name: `#${number} ${horseName}`,
              odds,
              probability: 1 / odds,
              jockey,
              trainer,
              form
            };
          });

          const homeTeam = raceName;
          const awayTeam = `${course}${distance ? ' | ' + distance : ''}${going ? ' | ' + going : ''}`;
          const topOdds = outcomes.length > 0 ? outcomes[0].odds : 2.0;
          const secondOdds = outcomes.length > 1 ? outcomes[1].odds : 3.0;

          events.push({
            id: `horse-racing_${raceId}`,
            sportId: 17,
            leagueName: `${course}${raceClass ? ' - ' + raceClass : ''}`,
            homeTeam,
            awayTeam,
            startTime,
            status: 'scheduled',
            isLive: false,
            markets: [{ id: 'winner', name: `Race Winner (${runnerCount} runners)`, outcomes }],
            homeOdds: parseFloat(topOdds.toFixed(2)),
            awayOdds: parseFloat(secondOdds.toFixed(2)),
            metadata: {
              runnerCount,
              distance,
              going,
              raceClass,
              prize,
              surface: race.surface || ''
            }
          } as any);
        } catch (raceErr: any) {
          console.warn(`[FreeSports] Horse Racing: Error parsing race: ${raceErr.message}`);
        }
      }

      console.log(`[FreeSports] Horse Racing: Parsed ${events.length} races from ${races.length} raw entries`);
      return events;
    } catch (error: any) {
      if (error.response?.status === 429 || (error.response?.data?.error && String(error.response.data.error).includes('Rate limit'))) {
        console.warn('[FreeSports] Horse Racing: Rate limited, will retry next cycle');
      } else {
        console.error('[FreeSports] Horse Racing fetch error:', error.message);
      }
      return [];
    }
  }

  private async fetchUpcomingForSingleDate(
    sportSlug: string, 
    config: typeof FREE_SPORTS_CONFIG[string],
    fetchDate: Date
  ): Promise<SportEvent[]> {
    const dateStr = fetchDate.toISOString().split('T')[0];
    
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };

      if (config.isRapidApi) {
        headers['x-rapidapi-key'] = config.rapidApiKey || '';
        headers['x-rapidapi-host'] = config.apiHost;
      } else {
        headers['x-apisports-key'] = API_KEY;
      }

      const params: Record<string, any> = { date: dateStr, timezone: 'UTC' };

      const response = await axios.get(config.endpoint, {
        params,
        headers,
        timeout: 10000
      });

      if (response.data?.errors && Object.keys(response.data.errors).length > 0) {
        const errorMsg = JSON.stringify(response.data.errors);
        if (!errorMsg.includes('plan')) {
          console.warn(`[FreeSports] API error for ${config.name} (${dateStr}): ${errorMsg}`);
        }
        
        if (response.data.errors.requests && String(response.data.errors.requests).includes('request limit')) {
          const err: any = new Error('API rate limit reached');
          err.response = { status: 429 };
          throw err;
        }
        return [];
      }

      const games = response.data?.response || [];
      
      return games.map((game: any) => this.transformToSportEvent(game, sportSlug, config)).filter(Boolean);
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

  private transformToSportEvent(
    game: any, 
    sportSlug: string, 
    config: typeof FREE_SPORTS_CONFIG[string]
  ): SportEvent | null {
    try {
      let homeTeam: string;
      let awayTeam: string;
      
      if (sportSlug === 'mma' || sportSlug === 'boxing') {
        homeTeam = game.fighters?.first?.name || game.fighters?.home?.name || game.home?.name || 'Fighter 1';
        awayTeam = game.fighters?.second?.name || game.fighters?.away?.name || game.away?.name || 'Fighter 2';
      } else if (sportSlug === 'cricket') {
        homeTeam = game.teams?.home?.name || game.home?.name || 'Home Team';
        awayTeam = game.teams?.away?.name || game.away?.name || 'Away Team';
      } else if (sportSlug === 'tennis') {
        homeTeam = game.players?.home?.name || game.teams?.home?.name || game.home?.name || 'Player 1';
        awayTeam = game.players?.away?.name || game.teams?.away?.name || game.away?.name || 'Player 2';
      } else {
        homeTeam = game.teams?.home?.name || game.home?.name || 'Home Team';
        awayTeam = game.teams?.away?.name || game.away?.name || 'Away Team';
      }
      
      const league = game.league?.name || game.competition?.name || 'Unknown League';
      const startTime = safeParseDate(game);
      const gameId = String(game.id);

      const homeOdds = 1.8 + Math.random() * 0.5;
      const awayOdds = 1.8 + Math.random() * 0.5;

      const outcomes: OutcomeData[] = [
        { id: 'home', name: homeTeam, odds: parseFloat(homeOdds.toFixed(2)), probability: 1 / homeOdds },
        { id: 'away', name: awayTeam, odds: parseFloat(awayOdds.toFixed(2)), probability: 1 / awayOdds }
      ];

      const markets: MarketData[] = [
        { id: 'winner', name: 'Match Winner', outcomes }
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

  async fetchAllResults(): Promise<FreeSportsResult[]> {
    console.log('[FreeSports] 🌙 Fetching results for settlement...');
    
    const results: FreeSportsResult[] = [];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    for (const [sportSlug, config] of Object.entries(FREE_SPORTS_CONFIG)) {
      if (sportSlug === 'horse-racing' || sportSlug === 'cricket') continue;

      try {
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'x-apisports-key': API_KEY
        };

        const response = await axios.get(config.endpoint, {
          params: { date: dateStr, timezone: 'UTC' },
          headers,
          timeout: 10000
        });

        const games = response.data?.response || [];
        
        for (const game of games) {
          const status = game.status?.long || game.status?.short || '';
          const isFinished = status.toLowerCase().includes('finished') || 
                            status.toLowerCase().includes('final') ||
                            status === 'FT' || status === 'AET' || status === 'PEN';
          
          if (isFinished) {
            let homeTeam = '';
            let awayTeam = '';
            
            if (sportSlug === 'mma' || sportSlug === 'boxing') {
              homeTeam = game.fighters?.home?.name || game.fighters?.first?.name || game.home?.name || 'Fighter 1';
              awayTeam = game.fighters?.away?.name || game.fighters?.second?.name || game.away?.name || 'Fighter 2';
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

    lastResultsFetchTime = Date.now();
    lastResultsFetchDate = getUTCDateString();
    console.log(`[FreeSports] ✅ Total: ${results.length} finished games for settlement`);
    
    if (results.length > 0) {
      this.triggerSettlement(results);
    }
    
    return results;
  }
  
  private async triggerSettlement(results: FreeSportsResult[]): Promise<void> {
    try {
      const { settlementWorker } = await import('./settlementWorker');
      
      console.log(`[FreeSports] 🎯 Triggering settlement for ${results.length} finished matches...`);
      
      for (const result of results) {
        try {
          await settlementWorker.settleEvent(result.eventId, {
            homeScore: result.homeScore,
            awayScore: result.awayScore,
            winner: result.winner,
            status: 'finished'
          });
        } catch (settleErr: any) {}
      }
      
      console.log(`[FreeSports] ✅ Settlement triggered for ${results.length} results`);
    } catch (error: any) {
      console.error(`[FreeSports] Error triggering settlement:`, error.message);
    }
  }

  getUpcomingEvents(): SportEvent[] {
    return cachedFreeSportsEvents;
  }

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

  lookupEvent(eventId: string): { found: boolean; event?: SportEvent; shouldBeLive: boolean } {
    const event = cachedFreeSportsEvents.find(e => String(e.id) === String(eventId));
    if (!event) {
      return { found: false, shouldBeLive: false };
    }
    const shouldBeLive = event.startTime ? new Date(event.startTime).getTime() <= Date.now() : false;
    return { found: true, event, shouldBeLive };
  }

  async forceRefresh(): Promise<SportEvent[]> {
    console.log('[FreeSports] Admin forced refresh of all free sports');
    lastUpcomingFetchDate = '';
    return this.fetchAllUpcomingMatches();
  }
}

export const freeSportsService = new FreeSportsService();
