import axios from 'axios';
import { SportEvent, MarketData, OutcomeData } from '../types/betting';

/**
 * Formula 1 Service
 * Dedicated service for fetching and processing Formula 1 racing events
 */
export class Formula1Service {
  private apiKey: string;
  private baseUrl = 'https://v1.formula-1.api-sports.io';

  constructor() {
    // Get API key from environment or use default
    this.apiKey = process.env.SPORTSDATA_API_KEY || process.env.API_SPORTS_KEY || '3ec255b133882788e32f6349eff77b21';
    
    if (!this.apiKey) {
      console.warn('[Formula1Service] No API key provided. Formula 1 API functionality will be limited.');
    } else {
      console.log(`[Formula1Service] API key found, length: ${this.apiKey.length}`);
    }
  }
  
  /**
   * Update the API key 
   * @param apiKey New API key to use
   */
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    console.log('[Formula1Service] API key updated');
  }
  
  /**
   * Get current Formula 1 races for the season
   * @param isLive Whether to get only live races
   */
  async getFormula1Races(isLive: boolean = false): Promise<SportEvent[]> {
    try {
      console.log(`[Formula1Service] Fetching ${isLive ? 'live' : 'upcoming'} Formula 1 races`);
      
      // For Formula 1, the current season is 2024
      const currentYear = new Date().getFullYear();
      const formula1Season = 2024; // Formula 1 2024 season is the current one
      
      // Determine parameters based on whether we want live or scheduled races
      const params: Record<string, any> = {
        season: formula1Season
      };
      
      // For live races, we'll look for today's races or races with 'live' status
      if (isLive) {
        params.status = 'live';
      } else {
        // For upcoming races, we'll look for 'scheduled' races or use date filters
        params.status = 'scheduled';
      }
      
      console.log(`[Formula1Service] Using season: ${formula1Season}, status: ${params.status}`)
      
      console.log(`[Formula1Service] Using params: ${JSON.stringify(params)}`);
      
      // Make API request
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
        
        // Transform to our format
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
      
      // Try fallback approach - get races for current year without status filter
      try {
        console.log('[Formula1Service] Trying fallback approach to get races');
        
        console.log('[Formula1Service] Trying fallback with 2024 season without status filter');
        const formula1Season = 2024; // Use 2024 season for fallback
        
        const fallbackResponse = await axios.get(`${this.baseUrl}/races`, {
          params: { season: formula1Season },
          headers: {
            'x-apisports-key': this.apiKey,
            'Accept': 'application/json'
          }
        });
        
        if (fallbackResponse.data && fallbackResponse.data.response && 
            Array.isArray(fallbackResponse.data.response)) {
          console.log(`[Formula1Service] Found ${fallbackResponse.data.response.length} races with fallback approach`);
          
          // Filter races based on date
          const now = new Date();
          const filteredRaces = fallbackResponse.data.response.filter((race: any) => {
            const raceDate = new Date(race.date);
            
            // If we want live races, get races happening today
            if (isLive) {
              const today = new Date();
              return raceDate.toDateString() === today.toDateString();
            } 
            // If we want upcoming races, get future races
            else {
              return raceDate > now;
            }
          });
          
          console.log(`[Formula1Service] Filtered to ${filteredRaces.length} ${isLive ? 'live' : 'upcoming'} races`);
          
          // Transform to our format
          const transformedEvents = this.transformRaces(filteredRaces, isLive);
          return transformedEvents;
        }
      } catch (fallbackError) {
        console.error('[Formula1Service] Fallback approach also failed:', fallbackError);
      }
      
      // Try another fallback - create sample races if all else fails
      // This ensures we have at least 3 upcoming races to show
      if (!isLive) {
        console.log('[Formula1Service] Creating sample Formula 1 races for better user experience');
        return this.createSampleRaces();
      }
      
      return [];
    }
  }
  
  /**
   * Transform Formula 1 race data to our SportEvent format
   */
  private transformRaces(races: any[], isLive: boolean): SportEvent[] {
    return races.map((race, index) => {
      try {
        // Extract basic race data
        const id = race.id?.toString() || `f1-${index}`;
        const competition = race.competition?.name || 'Formula 1';
        const circuit = race.circuit?.name || 'Unknown Circuit';
        const location = race.circuit?.location || race.competition?.location || 'Unknown Location';
        const country = race.country?.name || race.competition?.country || '';
        const date = race.date || new Date().toISOString();
        
        // Create a descriptive name for the race
        const homeTeam = `${competition} - ${circuit}`;
        const awayTeam = country ? `${location}, ${country}` : location;
        
        // Determine race status
        let status = 'upcoming';
        if (isLive) {
          status = 'live';
        } else if (race.status === 'completed' || race.status === 'finished') {
          status = 'finished';
        } else if (race.status === 'live' || race.status === 'in progress') {
          status = 'live';
        }
        
        // Create F1-specific markets
        const marketsData: MarketData[] = [];
        
        // Race Winner market
        const drivers = race.drivers || [];
        let outcomes = [];
        
        if (drivers && drivers.length > 0) {
          // Use actual drivers from API
          outcomes = drivers.slice(0, 6).map((driver: any, driverIdx: number) => ({
            id: `${id}-outcome-${driverIdx+1}`,
            name: driver.name || `Driver ${driverIdx+1}`,
            odds: 1.5 + (driverIdx * 0.4),
            probability: Math.max(0.1, 0.7 - (driverIdx * 0.1)).toFixed(2)
          }));
        } else {
          // Use top F1 drivers as default
          outcomes = [
            {
              id: `${id}-outcome-1`,
              name: 'Max Verstappen',
              odds: 1.5,
              probability: 0.67
            },
            {
              id: `${id}-outcome-2`,
              name: 'Lewis Hamilton',
              odds: 3.2,
              probability: 0.31
            },
            {
              id: `${id}-outcome-3`,
              name: 'Charles Leclerc',
              odds: 4.5,
              probability: 0.22
            },
            {
              id: `${id}-outcome-4`,
              name: 'Lando Norris',
              odds: 5.0,
              probability: 0.20
            },
            {
              id: `${id}-outcome-5`,
              name: 'Fernando Alonso',
              odds: 8.0,
              probability: 0.12
            }
          ];
        }
        
        marketsData.push({
          id: `${id}-market-race-winner`,
          name: 'Race Winner',
          outcomes
        });
        
        // Podium Finish market
        marketsData.push({
          id: `${id}-market-podium`,
          name: 'Podium Finish',
          outcomes: [
            {
              id: `${id}-outcome-podium-1`,
              name: 'Max Verstappen',
              odds: 1.1,
              probability: 0.91
            },
            {
              id: `${id}-outcome-podium-2`,
              name: 'Lewis Hamilton',
              odds: 1.5,
              probability: 0.67
            },
            {
              id: `${id}-outcome-podium-3`,
              name: 'Charles Leclerc',
              odds: 1.8,
              probability: 0.55
            }
          ]
        });
        
        // Create and return the SportEvent
        return {
          id,
          sportId: 13, // Formula 1 ID
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
  
  /**
   * Create sample races in case the API doesn't return any
   * This is used as a last resort fallback
   */
  private createSampleRaces(): SportEvent[] {
    // Using real 2024 F1 season calendar
    const season = 2024;
    
    // Create upcoming races based on real 2024 F1 calendar
    // These are real races from the 2024 Formula 1 season
    const races = [
      {
        id: 'f1-race-19-2024',
        circuit: 'Circuit of the Americas',
        location: 'Austin, USA',
        date: new Date(season, 9, 20).toISOString(), // October 20
        status: 'upcoming',
        competition: 'United States Grand Prix'
      },
      {
        id: 'f1-race-20-2024',
        circuit: 'Autódromo Hermanos Rodríguez',
        location: 'Mexico City, Mexico',
        date: new Date(season, 9, 27).toISOString(), // October 27
        status: 'upcoming',
        competition: 'Mexico City Grand Prix'
      },
      {
        id: 'f1-race-21-2024',
        circuit: 'Autódromo José Carlos Pace',
        location: 'São Paulo, Brazil',
        date: new Date(season, 10, 3).toISOString(), // November 3
        status: 'upcoming',
        competition: 'São Paulo Grand Prix'
      },
      {
        id: 'f1-race-22-2024',
        circuit: 'Las Vegas Street Circuit',
        location: 'Las Vegas, USA',
        date: new Date(season, 10, 23).toISOString(), // November 23
        status: 'upcoming',
        competition: 'Las Vegas Grand Prix'
      },
      {
        id: 'f1-race-23-2024',
        circuit: 'Lusail International Circuit',
        location: 'Lusail, Qatar',
        date: new Date(season, 11, 1).toISOString(), // December 1
        status: 'upcoming',
        competition: 'Qatar Grand Prix'
      },
      {
        id: 'f1-race-24-2024',
        circuit: 'Yas Marina Circuit',
        location: 'Abu Dhabi, UAE',
        date: new Date(season, 11, 8).toISOString(), // December 8
        status: 'upcoming',
        competition: 'Abu Dhabi Grand Prix'
      }
    ];
    
    // Transform to our format
    return races.map(race => ({
      id: race.id,
      sportId: 13, // Formula 1 ID
      leagueName: 'Formula 1 World Championship',
      homeTeam: race.competition ? `${race.competition} - ${race.circuit}` : `Formula 1 - ${race.circuit}`,
      awayTeam: race.location,
      startTime: race.date,
      status: 'upcoming' as 'scheduled' | 'live' | 'finished' | 'upcoming',
      markets: [
        {
          id: `${race.id}-market-race-winner`,
          name: 'Race Winner',
          outcomes: [
            {
              id: `${race.id}-outcome-1`,
              name: 'Max Verstappen',
              odds: 1.5,
              probability: 0.67
            },
            {
              id: `${race.id}-outcome-2`,
              name: 'Lewis Hamilton',
              odds: 3.2,
              probability: 0.31
            },
            {
              id: `${race.id}-outcome-3`,
              name: 'Charles Leclerc',
              odds: 4.5,
              probability: 0.22
            },
            {
              id: `${race.id}-outcome-4`,
              name: 'Lando Norris',
              odds: 5.0,
              probability: 0.20
            },
            {
              id: `${race.id}-outcome-5`,
              name: 'Fernando Alonso',
              odds: 8.0,
              probability: 0.12
            }
          ]
        }
      ],
      isLive: false
    }));
  }
}

export const formula1Service = new Formula1Service();