import axios from 'axios';
import { SportEvent, MarketData, OutcomeData } from '../types/betting';

export class Formula1Service {
  private apiKey: string;
  private baseUrl = 'https://v1.formula-1.api-sports.io';

  constructor() {
    this.apiKey = process.env.SPORTSDATA_API_KEY || process.env.API_SPORTS_KEY || '3ec255b133882788e32f6349eff77b21';
    
    if (!this.apiKey) {
      console.warn('[Formula1Service] No API key provided. Formula 1 API functionality will be limited.');
    } else {
      console.log(`[Formula1Service] API key found, length: ${this.apiKey.length}`);
    }
  }
  
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    console.log('[Formula1Service] API key updated');
  }
  
  async getFormula1Races(isLive: boolean = false): Promise<SportEvent[]> {
    try {
      console.log(`[Formula1Service] Fetching ${isLive ? 'live' : 'upcoming'} Formula 1 races`);
      
      const currentYear = new Date().getFullYear();
      
      const params: Record<string, any> = {
        season: currentYear
      };
      
      if (isLive) {
        params.status = 'live';
      } else {
        params.status = 'scheduled';
      }
      
      console.log(`[Formula1Service] Using season: ${currentYear}, status: ${params.status}`)
      
      const response = await axios.get(`${this.baseUrl}/races`, {
        params,
        headers: {
          'x-apisports-key': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      console.log(`[Formula1Service] Response status: ${response.status}`);
      
      if (response.data && response.data.response && Array.isArray(response.data.response)) {
        console.log(`[Formula1Service] Found ${response.data.response.length} races`);
        
        const transformedEvents = this.transformRaces(response.data.response, isLive);
        console.log(`[Formula1Service] Transformed ${transformedEvents.length} F1 races`);
        
        return transformedEvents;
      } else {
        console.log(`[Formula1Service] Unexpected response format:`, 
                   response.data ? Object.keys(response.data) : 'No data');
        return [];
      }
    } catch (error) {
      console.error('[Formula1Service] Error fetching Formula 1 races:', error);
      
      try {
        console.log('[Formula1Service] Trying fallback approach to get races');
        const currentYear = new Date().getFullYear();
        
        const fallbackResponse = await axios.get(`${this.baseUrl}/races`, {
          params: { season: currentYear },
          headers: {
            'x-apisports-key': this.apiKey,
            'Accept': 'application/json'
          }
        });
        
        if (fallbackResponse.data && fallbackResponse.data.response && 
            Array.isArray(fallbackResponse.data.response)) {
          console.log(`[Formula1Service] Found ${fallbackResponse.data.response.length} races with fallback approach`);
          
          const now = new Date();
          const filteredRaces = fallbackResponse.data.response.filter((race: any) => {
            const raceDate = new Date(race.date);
            
            if (isLive) {
              const today = new Date();
              return raceDate.toDateString() === today.toDateString();
            } else {
              return raceDate > now;
            }
          });
          
          console.log(`[Formula1Service] Filtered to ${filteredRaces.length} ${isLive ? 'live' : 'upcoming'} races`);
          
          const transformedEvents = this.transformRaces(filteredRaces, isLive);
          return transformedEvents;
        }
      } catch (fallbackError) {
        console.error('[Formula1Service] Fallback approach also failed:', fallbackError);
      }
      
      return [];
    }
  }
  
  private transformRaces(races: any[], isLive: boolean): SportEvent[] {
    return races.map((race, index) => {
      try {
        const id = race.id?.toString() || `f1-${index}`;
        const competition = race.competition?.name || 'Formula 1';
        const circuit = race.circuit?.name || 'Unknown Circuit';
        const location = race.circuit?.location || race.competition?.location || 'Unknown Location';
        const country = race.country?.name || race.competition?.country || '';
        const date = race.date || new Date().toISOString();
        
        const homeTeam = `${competition} - ${circuit}`;
        const awayTeam = country ? `${location}, ${country}` : location;
        
        let status = 'upcoming';
        if (isLive) {
          status = 'live';
        } else if (race.status === 'completed' || race.status === 'finished') {
          status = 'finished';
        } else if (race.status === 'live' || race.status === 'in progress') {
          status = 'live';
        }
        
        const marketsData: MarketData[] = [];
        
        const drivers = race.drivers || [];
        let outcomes = [];
        
        if (drivers && drivers.length > 0) {
          outcomes = drivers.slice(0, 6).map((driver: any, driverIdx: number) => ({
            id: `${id}-outcome-${driverIdx+1}`,
            name: driver.name || `Driver ${driverIdx+1}`,
            odds: 1.5 + (driverIdx * 0.4),
            probability: Math.max(0.1, 0.7 - (driverIdx * 0.1)).toFixed(2)
          }));
        } else {
          outcomes = [
            { id: `${id}-outcome-1`, name: 'Race Winner TBD', odds: 2.0, probability: 0.5 }
          ];
        }
        
        marketsData.push({
          id: `${id}-market-race-winner`,
          name: 'Race Winner',
          outcomes
        });
        
        return {
          id,
          sportId: 13,
          leagueName: competition,
          homeTeam,
          awayTeam,
          startTime: new Date(date).toISOString(),
          status: status as 'scheduled' | 'live' | 'finished' | 'upcoming',
          score: isLive ? 'In Progress' : undefined,
          markets: marketsData,
          isLive: status === 'live'
        };
      } catch (error) {
        console.error(`[Formula1Service] Error transforming race:`, error);
        return {
          id: `f1-error-${index}`,
          sportId: 13,
          leagueName: 'Formula 1',
          homeTeam: 'Formula 1 Race',
          awayTeam: 'Grand Prix',
          startTime: new Date().toISOString(),
          status: 'upcoming',
          markets: [],
          isLive: false
        };
      }
    });
  }
}

export const formula1Service = new Formula1Service();
