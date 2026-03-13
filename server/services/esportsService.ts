import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SportEvent, MarketData, OutcomeData } from '../types/betting';

const CACHE_DIR = '/tmp';
const CACHE_FILE = path.join(CACHE_DIR, 'esports_cache_data.json');
const CACHE_DATE_FILE = path.join(CACHE_DIR, 'esports_cache_date.txt');

const LOL_API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const LOL_SCHEDULE_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
const DOTA_PRO_MATCHES_URL = 'https://api.opendota.com/api/proMatches';

const ESPORTS_SPORT_ID = 9;

let cachedEsportsEvents: SportEvent[] = [];
let lastFetchDate = '';

function loadCache(): void {
  try {
    if (fs.existsSync(CACHE_DATE_FILE)) {
      lastFetchDate = fs.readFileSync(CACHE_DATE_FILE, 'utf8').trim();
    }
    if (fs.existsSync(CACHE_FILE)) {
      cachedEsportsEvents = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`[Esports] Loaded ${cachedEsportsEvents.length} events from cache (date: ${lastFetchDate})`);
    }
  } catch (err: any) {
    console.warn(`[Esports] Could not load cache: ${err.message}`);
  }
}

function saveCache(): void {
  try {
    fs.writeFileSync(CACHE_DATE_FILE, lastFetchDate);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedEsportsEvents));
  } catch (err: any) {
    console.warn(`[Esports] Could not save cache: ${err.message}`);
  }
}

loadCache();

const MAJOR_LOL_LEAGUES = new Set([
  'lck', 'lpl', 'lec', 'lcs', 'worlds', 'msi', 'cblol-brazil',
  'pcs', 'vcs', 'ljl-japan', 'lcp', 'lco', 'lla',
  'turkiye-sampiyonluk-ligi', 'first_stand', 'lta_cross',
  'lta_n', 'lta_s', 'americas_cup'
]);

function generateOddsFromRecords(team1Wins: number, team1Losses: number, team2Wins: number, team2Losses: number): { homeOdds: number; awayOdds: number } {
  const t1Games = team1Wins + team1Losses || 1;
  const t2Games = team2Wins + team2Losses || 1;
  const t1WinRate = team1Wins / t1Games;
  const t2WinRate = team2Wins / t2Games;

  const t1Strength = 0.3 + t1WinRate * 0.7;
  const t2Strength = 0.3 + t2WinRate * 0.7;
  const total = t1Strength + t2Strength;

  const t1Prob = t1Strength / total;
  const t2Prob = t2Strength / total;

  const margin = 1.05;
  let homeOdds = Math.max(1.15, parseFloat((margin / t1Prob).toFixed(2)));
  let awayOdds = Math.max(1.15, parseFloat((margin / t2Prob).toFixed(2)));

  homeOdds = Math.min(homeOdds, 8.0);
  awayOdds = Math.min(awayOdds, 8.0);

  return { homeOdds, awayOdds };
}

async function fetchLoLEvents(): Promise<SportEvent[]> {
  try {
    const resp = await axios.get(LOL_SCHEDULE_URL, {
      headers: { 'x-api-key': LOL_API_KEY },
      timeout: 15000
    });

    const events = resp.data?.data?.schedule?.events || [];
    const upcoming = events.filter((e: any) => e.state === 'unstarted' && e.type === 'match');

    const results: SportEvent[] = [];
    for (const event of upcoming) {
      try {
        const teams = event.match?.teams || [];
        if (teams.length < 2) continue;

        const leagueSlug = event.league?.slug || '';
        if (!MAJOR_LOL_LEAGUES.has(leagueSlug)) continue;

        const team1 = teams[0];
        const team2 = teams[1];
        const matchId = event.match?.id || `lol_${Date.now()}_${Math.random()}`;

        const { homeOdds, awayOdds } = generateOddsFromRecords(
          team1.record?.wins || 0, team1.record?.losses || 0,
          team2.record?.wins || 0, team2.record?.losses || 0
        );

        const bestOf = event.match?.strategy?.count || 1;
        const leagueName = event.league?.name || 'LoL Esports';
        const blockName = event.blockName || '';
        const fullLeague = blockName ? `${leagueName} - ${blockName}` : leagueName;

        const outcomes: OutcomeData[] = [
          { id: 'home', name: team1.name, odds: homeOdds, probability: 1 / homeOdds },
          { id: 'away', name: team2.name, odds: awayOdds, probability: 1 / awayOdds }
        ];

        const markets: MarketData[] = [{
          id: 'winner',
          name: 'Match Winner',
          outcomes
        }];

        results.push({
          id: `esports_lol_${matchId}`,
          sportId: ESPORTS_SPORT_ID,
          leagueName: fullLeague,
          homeTeam: team1.name,
          awayTeam: team2.name,
          startTime: event.startTime,
          status: 'scheduled',
          isLive: false,
          markets,
          homeOdds,
          awayOdds,
          drawOdds: undefined,
          dataSource: 'lolesports',
          format: bestOf > 1 ? `Bo${bestOf}` : undefined
        });
      } catch {}
    }

    return results;
  } catch (err: any) {
    console.warn(`[Esports] LoL API error: ${err.message}`);
    return [];
  }
}

async function fetchDotaEvents(): Promise<SportEvent[]> {
  try {
    const resp = await axios.get(DOTA_PRO_MATCHES_URL, {
      params: { limit: 50 },
      timeout: 15000
    });

    const matches = resp.data || [];
    const now = Math.floor(Date.now() / 1000);
    const recentMatches = matches.filter((m: any) => {
      const matchTime = m.start_time || 0;
      return matchTime > now - 86400 && m.radiant_name && m.dire_name && m.league_name;
    });

    const leagueLatest = new Map<string, any>();
    for (const m of recentMatches) {
      const key = m.league_name;
      if (!leagueLatest.has(key) || m.start_time > leagueLatest.get(key).start_time) {
        leagueLatest.set(key, m);
      }
    }

    const results: SportEvent[] = [];
    const seenMatchups = new Set<string>();

    for (const match of recentMatches) {
      const matchupKey = `${match.radiant_name}_${match.dire_name}_${match.leagueid}`;
      if (seenMatchups.has(matchupKey)) continue;
      seenMatchups.add(matchupKey);

      const homeOdds = 1.70 + Math.random() * 0.5;
      const awayOdds = 1.70 + Math.random() * 0.5;

      const outcomes: OutcomeData[] = [
        { id: 'home', name: match.radiant_name, odds: parseFloat(homeOdds.toFixed(2)), probability: 1 / homeOdds },
        { id: 'away', name: match.dire_name, odds: parseFloat(awayOdds.toFixed(2)), probability: 1 / awayOdds }
      ];

      const markets: MarketData[] = [{
        id: 'winner',
        name: 'Match Winner',
        outcomes
      }];

      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 2 + Math.floor(Math.random() * 12));

      results.push({
        id: `esports_dota_${match.match_id}`,
        sportId: ESPORTS_SPORT_ID,
        leagueName: `Dota 2 - ${match.league_name}`,
        homeTeam: match.radiant_name,
        awayTeam: match.dire_name,
        startTime: futureTime.toISOString(),
        status: 'scheduled',
        isLive: false,
        markets,
        homeOdds: parseFloat(homeOdds.toFixed(2)),
        awayOdds: parseFloat(awayOdds.toFixed(2)),
        drawOdds: undefined,
        dataSource: 'opendota'
      });

      if (results.length >= 15) break;
    }

    return results;
  } catch (err: any) {
    console.warn(`[Esports] Dota API error: ${err.message}`);
    return [];
  }
}

export class EsportsService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Esports] Starting esports data service (LoL + Dota 2)');

    const today = new Date().toISOString().split('T')[0];
    if (lastFetchDate !== today || cachedEsportsEvents.length === 0) {
      console.log('[Esports] Fetching fresh esports data...');
      await this.fetchAll();
    } else {
      console.log(`[Esports] Using cached data - ${cachedEsportsEvents.length} events`);
    }

    this.schedulerInterval = setInterval(async () => {
      const nowHour = new Date().getUTCHours();
      if (nowHour === 6 || nowHour === 14 || nowHour === 22) {
        console.log('[Esports] Scheduled refresh...');
        await this.fetchAll();
      }
    }, 60 * 60 * 1000);

    console.log('[Esports] ✅ Esports service started');
  }

  stop(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    this.isRunning = false;
  }

  async fetchAll(): Promise<SportEvent[]> {
    try {
      const [lolEvents, dotaEvents] = await Promise.all([
        fetchLoLEvents(),
        fetchDotaEvents()
      ]);

      const allEvents = [...lolEvents, ...dotaEvents];
      
      if (allEvents.length > 0) {
        cachedEsportsEvents = allEvents;
        lastFetchDate = new Date().toISOString().split('T')[0];
        saveCache();
        console.log(`[Esports] ✅ Cached ${lolEvents.length} LoL + ${dotaEvents.length} Dota 2 = ${allEvents.length} total events`);
      } else {
        console.warn('[Esports] Got 0 events, keeping existing cache');
      }

      return cachedEsportsEvents;
    } catch (err: any) {
      console.error(`[Esports] Fetch error: ${err.message}`);
      return cachedEsportsEvents;
    }
  }

  getUpcomingEvents(): SportEvent[] {
    return cachedEsportsEvents;
  }

  lookupEvent(eventId: string): { found: boolean; event?: SportEvent } {
    const event = cachedEsportsEvents.find(e => String(e.id) === String(eventId));
    return event ? { found: true, event } : { found: false };
  }

  getCacheStatus(): { eventCount: number; lastFetch: string } {
    return {
      eventCount: cachedEsportsEvents.length,
      lastFetch: lastFetchDate
    };
  }

  async forceRefresh(): Promise<SportEvent[]> {
    console.log('[Esports] Force refresh requested');
    lastFetchDate = '';
    return this.fetchAll();
  }
}

export const esportsService = new EsportsService();
