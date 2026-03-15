import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SportEvent } from '../types/betting';

const MMA_SPORT_ID = 7;
const CACHE_FILE = path.join('/tmp', 'mma_api_fights_cache.json');

interface MMAFight {
  id: number;
  date: string;
  time: string;
  timestamp: number;
  timezone: string;
  slug: string;
  is_main: boolean;
  category: string;
  status: { long: string; short: string };
  fighters: {
    first: { id: number; name: string; logo: string; winner: boolean };
    second: { id: number; name: string; logo: string; winner: boolean };
  };
}

interface MMACache {
  upcomingFights: MMAFight[];
  finishedFights: MMAFight[];
  fetchedAt: number;
  datesFetched: string[];
}

class MMAApiService {
  private apiKey: string;
  private baseUrl = 'https://v1.mma.api-sports.io';
  private cache: MMACache | null = null;
  private readonly CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

  constructor() {
    this.apiKey = process.env.API_SPORTS_KEY || '';
    this.loadCache();
  }

  private loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        this.cache = JSON.parse(raw);
      }
    } catch {
      this.cache = null;
    }
  }

  private saveCache(cache: MMACache) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      this.cache = cache;
    } catch (e) {
      console.error('[MMAApi] Failed to save cache:', e);
    }
  }

  private getUpcomingDates(): string[] {
    const dates: string[] = [];
    const now = new Date();
    for (let i = 0; i <= 42 && dates.length < 10; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const dow = d.getDay();
      if (dow === 5 || dow === 6 || dow === 0) {
        dates.push(d.toISOString().split('T')[0]);
      }
    }
    return dates;
  }

  private getPastDates(): string[] {
    const dates: string[] = [];
    const now = new Date();
    for (let i = 0; i <= 14; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dow = d.getDay();
      if (dow === 5 || dow === 6 || dow === 0 || i === 0) {
        dates.push(d.toISOString().split('T')[0]);
      }
    }
    return dates;
  }

  private async fetchFightsForDate(date: string): Promise<MMAFight[]> {
    if (!this.apiKey) return [];
    try {
      const response = await axios.get(`${this.baseUrl}/fights`, {
        params: { date },
        headers: { 'x-apisports-key': this.apiKey },
        timeout: 12000,
      });
      if (response.data?.errors && Object.keys(response.data.errors).length > 0) {
        const errMsg = JSON.stringify(response.data.errors);
        if (errMsg.includes('Free plans do not have access') || errMsg.includes('do not exist')) {
          return [];
        }
      }
      return response.data?.response || [];
    } catch {
      return [];
    }
  }

  async refreshCache(forceRefresh = false): Promise<void> {
    if (!this.apiKey) return;

    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.cache.fetchedAt < this.CACHE_TTL) {
      return;
    }

    console.log('[MMAApi] Refreshing fight cache from API...');

    const upcomingDates = this.getUpcomingDates();
    const pastDates = this.getPastDates();
    const allDates = [...new Set([...pastDates, ...upcomingDates])].sort();

    const upcomingFights: MMAFight[] = [];
    const finishedFights: MMAFight[] = [];

    for (const date of allDates) {
      const fights = await this.fetchFightsForDate(date);
      for (const f of fights) {
        const status = f.status?.short;
        if (status === 'NS') {
          upcomingFights.push(f);
        } else if (status === 'FT' || status === 'EOR' || status === 'CANC') {
          finishedFights.push(f);
        }
      }
      await new Promise(r => setTimeout(r, 250));
    }

    const cache: MMACache = {
      upcomingFights,
      finishedFights,
      fetchedAt: now,
      datesFetched: allDates,
    };
    this.saveCache(cache);
    console.log(`[MMAApi] Cache refreshed: ${upcomingFights.length} upcoming, ${finishedFights.length} finished fights`);
  }

  private generateOdds(fight: MMAFight): { odds1: number; odds2: number } {
    const isMain = fight.is_main;
    const cat = (fight.category || '').toLowerCase();
    const isTitle = cat.includes('champion') || cat.includes('title') || cat.includes('interim');

    if (isTitle) return { odds1: 1.42, odds2: 2.80 };
    if (isMain) return { odds1: 1.62, odds2: 2.30 };
    return { odds1: 1.75, odds2: 2.10 };
  }

  private mapToSportEvent(fight: MMAFight): SportEvent {
    const fighter1 = fight.fighters?.first?.name || 'Fighter 1';
    const fighter2 = fight.fighters?.second?.name || 'Fighter 2';
    const { odds1, odds2 } = this.generateOdds(fight);

    return {
      id: `mma_real_${fight.id}`,
      sportId: MMA_SPORT_ID,
      leagueName: fight.slug || 'UFC',
      homeTeam: fighter1,
      awayTeam: fighter2,
      startTime: fight.date,
      status: 'scheduled',
      isLive: false,
      markets: [
        {
          id: 'match_winner',
          name: 'Fight Winner',
          outcomes: [
            { id: 'fighter1', name: fighter1, odds: odds1, probability: 1 / odds1 },
            { id: 'fighter2', name: fighter2, odds: odds2, probability: 1 / odds2 },
          ],
        },
      ],
      homeOdds: odds1,
      awayOdds: odds2,
      venue: '',
      eventTitle: fight.category || 'UFC Fight',
    } as SportEvent;
  }

  getUpcomingEvents(): SportEvent[] {
    if (!this.cache) return [];
    const now = new Date().toISOString();
    return this.cache.upcomingFights
      .filter(f => f.date >= now.split('T')[0])
      .map(f => this.mapToSportEvent(f));
  }

  getFinishedFights(): MMAFight[] {
    return this.cache?.finishedFights || [];
  }

  isCacheStale(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.fetchedAt > this.CACHE_TTL;
  }
}

export const mmaApiService = new MMAApiService();
