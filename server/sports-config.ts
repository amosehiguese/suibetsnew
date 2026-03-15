/**
 * Sports Configuration for SuiBets Platform
 * Configurable sports list with environment variable support
 */

export interface SportsConfig {
  available: string[];
  enabled?: string[];
  singleSportMode: boolean;
  currentSport: string;
}

/**
 * All available sports from API-Sports
 */
const ALL_SPORTS = [
  'football', 'basketball', 'tennis', 'baseball', 'hockey', 'handball', 'volleyball',
  'rugby', 'cricket', 'golf', 'boxing', 'mma', 'formula-1', 'cycling',
  'american-football', 'aussie-rules', 'snooker', 'darts', 'table-tennis',
  'badminton', 'motorsport', 'esports', 'netball', 'water-polo'
];

/**
 * Get the configured sports list based on environment variables
 * 
 * Environment Variables:
 * - SPORTS_LIST: Comma-separated list of sports to fetch (e.g., "football,basketball,tennis")
 * - SINGLE_SPORT_MODE: Set to 'true' to fetch only one sport at a time
 * - CURRENT_SPORT: The current sport to fetch in single sport mode (default: "football")
 * 
 * @returns Array of sports to fetch
 */
export function getSportsToFetch(): string[] {
  const singleSportMode = process.env.SINGLE_SPORT_MODE === 'true';
  
  // If single sport mode is enabled, return only that sport
  if (singleSportMode) {
    const sport = process.env.CURRENT_SPORT || 'football';
    console.log(`📍 SINGLE SPORT MODE: Fetching only "${sport}"`);
    return [sport];
  }
  
  // If custom sports list is provided, use it
  if (process.env.SPORTS_LIST) {
    const customSports = process.env.SPORTS_LIST
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s && ALL_SPORTS.includes(s)); // Validate against available sports
    
    if (customSports.length > 0) {
      console.log(`📍 CUSTOM SPORTS LIST: ${customSports.join(', ')}`);
      return customSports;
    } else {
      console.warn(`⚠️ SPORTS_LIST provided but no valid sports found. Using all sports.`);
    }
  }
  
  // Default: fetch all available sports
  console.log(`📍 FETCHING ALL AVAILABLE SPORTS (${ALL_SPORTS.length} sports)`);
  return ALL_SPORTS;
}

/**
 * Get the sports configuration object
 */
export function getSportsConfig(): SportsConfig {
  const singleSportMode = process.env.SINGLE_SPORT_MODE === 'true';
  
  return {
    available: ALL_SPORTS,
    enabled: process.env.SPORTS_LIST 
      ? process.env.SPORTS_LIST.split(',').map(s => s.trim().toLowerCase())
      : undefined,
    singleSportMode,
    currentSport: process.env.CURRENT_SPORT || 'football'
  };
}

export default { getSportsToFetch, getSportsConfig, ALL_SPORTS };
