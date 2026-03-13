/**
 * Sports Market Adapter
 * 
 * This module provides adapters for different sports to handle their specific market types
 * and ensure proper display and betting functionality across all supported sports.
 */

// Import types if available in the project, otherwise define them here
// We'll define them here to make this module self-contained
// If you get import conflicts, use the project's existing types instead

// Sport IDs based on API
export enum SportIds {
  SOCCER = 1,
  BASKETBALL = 2,
  TENNIS = 3,
  BASEBALL = 4,
  HOCKEY = 5,
  HANDBALL = 6,
  VOLLEYBALL = 7,
  RUGBY = 8,
  CRICKET = 9,
  GOLF = 10,
  BOXING = 11,
  MMA_UFC = 12,
  FORMULA_1 = 13,
  CYCLING = 14,
  AMERICAN_FOOTBALL = 15,
  AFL = 16,
  SNOOKER = 17,
  HORSE_RACING = 18,
  MOTOGP = 19,
  WWE_ENTERTAINMENT = 20,
  DARTS = 21
}

// Type definition for outcome (if not already defined elsewhere)
export interface Outcome {
  id: string | number;
  name: string;
  odds: number;
  status?: string;
  probability?: number;
}

// Type definition for market (if not already defined elsewhere)
export interface Market {
  id: string | number;
  name: string;
  type?: string;
  status?: string;
  outcomes: Outcome[];
}

export type AdapterMarket = Market;

// Market types by sport
export enum MarketTypes {
  // Common markets
  MATCH_RESULT = 'Match Result',
  MATCH_WINNER = 'Match Winner',
  OVER_UNDER = 'Over/Under',
  HANDICAP = 'Handicap',
  CORRECT_SCORE = 'Correct Score',
  
  // Soccer specific
  BOTH_TEAMS_TO_SCORE = 'Both Teams to Score',
  DOUBLE_CHANCE = 'Double Chance',
  FIRST_HALF_RESULT = 'First Half Result',
  FIRST_TEAM_TO_SCORE = 'First Team to Score',
  
  // Basketball specific
  TOTAL_POINTS = 'Total Points',
  PLAYER_POINTS = 'Player Points',
  RACE_TO_POINTS = 'Race to Points',
  QUARTER_WINNER = 'Quarter Winner',
  
  // Tennis specific
  SET_WINNER = 'Set Winner',
  TOTAL_GAMES = 'Total Games',
  PLAYER_GAMES = 'Player Games',
  
  // Cricket specific
  TOP_BATSMAN = 'Top Batsman',
  TOP_BOWLER = 'Top Bowler',
  METHOD_OF_DISMISSAL = 'Method of Dismissal',
  TOTAL_MATCH_SIXES = 'Total Match Sixes',
  
  // Combat sports (UFC/Boxing)
  METHOD_OF_VICTORY = 'Method of Victory',
  ROUND_BETTING = 'Round Betting',
  FIGHT_DURATION = 'Fight Duration',
  
  // Motor sports
  RACE_WINNER = 'Race Winner',
  PODIUM_FINISH = 'Podium Finish',
  FASTEST_LAP = 'Fastest Lap',
  
  // Golf
  TOURNAMENT_WINNER = 'Tournament Winner',
  TOP_5_FINISH = 'Top 5 Finish',
  TOP_10_FINISH = 'Top 10 Finish',
  HEAD_TO_HEAD = 'Head to Head'
}

// Helper functions to standardize outcome names
export const standardizeOutcomeName = (outcomeName: string, sportId: number): string => {
  // Convert numeric outcome names (1, X, 2) to more descriptive names
  if (outcomeName === '1') {
    return 'Home';
  } else if (outcomeName === 'X') {
    return 'Draw';
  } else if (outcomeName === '2') {
    return 'Away';
  }
  
  return outcomeName;
};

// Get default markets for a sport if none are available from the API
export const getDefaultMarkets = (sportId: number, homeTeam: string, awayTeam: string): Market[] => {
  const defaultOutcomes: Outcome[] = [
    { id: 'home', name: homeTeam, odds: 2.00, status: 'active', probability: 0.5 },
    { id: 'away', name: awayTeam, odds: 2.00, status: 'active', probability: 0.5 }
  ];
  
  // Add draw outcome for sports that can have draws
  if ([
    SportIds.SOCCER, 
    SportIds.HOCKEY, 
    SportIds.RUGBY,
    SportIds.CRICKET
  ].includes(sportId)) {
    defaultOutcomes.splice(1, 0, {
      id: 'draw',
      name: 'Draw',
      odds: 3.00,
      status: 'active',
      probability: 0.33
    });
  }
  
  let marketType = MarketTypes.MATCH_WINNER;
  
  // Soccer uses Match Result instead of Match Winner
  if (sportId === SportIds.SOCCER) {
    marketType = MarketTypes.MATCH_RESULT;
  }
  // Tennis uses Set Winner for first set
  else if (sportId === SportIds.TENNIS) {
    marketType = MarketTypes.SET_WINNER;
  }
  // Golf uses Tournament Winner
  else if (sportId === SportIds.GOLF) {
    marketType = MarketTypes.TOURNAMENT_WINNER;
  }
  // F1 uses Race Winner
  else if (sportId === SportIds.FORMULA_1) {
    marketType = MarketTypes.RACE_WINNER;
  }
  
  const markets: Market[] = [
    {
      id: 1,
      name: marketType,
      type: 'standard',
      status: 'open',
      outcomes: defaultOutcomes
    }
  ];
  
  // Add secondary markets for soccer
  if (sportId === SportIds.SOCCER) {
    // Both Teams to Score
    markets.push({
      id: 2,
      name: MarketTypes.BOTH_TEAMS_TO_SCORE,
      type: 'btts',
      status: 'open',
      outcomes: [
        { id: 'btts_yes', name: 'Yes', odds: 1.85, status: 'active', probability: 0.54 },
        { id: 'btts_no', name: 'No', odds: 1.95, status: 'active', probability: 0.51 }
      ]
    });
    
    // Double Chance
    markets.push({
      id: 3,
      name: MarketTypes.DOUBLE_CHANCE,
      type: 'double_chance',
      status: 'open',
      outcomes: [
        { id: 'dc_1x', name: `${homeTeam} or Draw`, odds: 1.35, status: 'active', probability: 0.74 },
        { id: 'dc_12', name: `${homeTeam} or ${awayTeam}`, odds: 1.20, status: 'active', probability: 0.83 },
        { id: 'dc_x2', name: `Draw or ${awayTeam}`, odds: 1.40, status: 'active', probability: 0.71 }
      ]
    });
    
    // First Half Result
    markets.push({
      id: 4,
      name: MarketTypes.FIRST_HALF_RESULT,
      type: 'half_time',
      status: 'open',
      outcomes: [
        { id: 'ht_home', name: homeTeam, odds: 2.50, status: 'active', probability: 0.40 },
        { id: 'ht_draw', name: 'Draw', odds: 2.10, status: 'active', probability: 0.48 },
        { id: 'ht_away', name: awayTeam, odds: 3.00, status: 'active', probability: 0.33 }
      ]
    });
    
    // Over/Under 2.5 Goals
    markets.push({
      id: 5,
      name: 'Over/Under 2.5 Goals',
      type: 'over_under',
      status: 'open',
      outcomes: [
        { id: 'ou_over', name: 'Over 2.5', odds: 1.90, status: 'active', probability: 0.53 },
        { id: 'ou_under', name: 'Under 2.5', odds: 1.90, status: 'active', probability: 0.53 }
      ]
    });
    
    // Over/Under 1.5 Goals  
    markets.push({
      id: 6,
      name: 'Over/Under 1.5 Goals',
      type: 'over_under',
      status: 'open',
      outcomes: [
        { id: 'ou15_over', name: 'Over 1.5', odds: 1.45, status: 'active', probability: 0.69 },
        { id: 'ou15_under', name: 'Under 1.5', odds: 2.70, status: 'active', probability: 0.37 }
      ]
    });
  }
  
  return markets;
};

// Get all available market types for a specific sport
export const getAvailableMarketTypesForSport = (sportId: number): string[] => {
  switch (sportId) {
    case SportIds.SOCCER:
      return [
        MarketTypes.MATCH_RESULT,
        MarketTypes.OVER_UNDER,
        MarketTypes.BOTH_TEAMS_TO_SCORE,
        MarketTypes.DOUBLE_CHANCE,
        MarketTypes.CORRECT_SCORE,
        MarketTypes.FIRST_HALF_RESULT,
        MarketTypes.FIRST_TEAM_TO_SCORE
      ];
      
    case SportIds.BASKETBALL:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.HANDICAP,
        MarketTypes.TOTAL_POINTS,
        MarketTypes.PLAYER_POINTS,
        MarketTypes.RACE_TO_POINTS,
        MarketTypes.QUARTER_WINNER
      ];
      
    case SportIds.TENNIS:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.SET_WINNER,
        MarketTypes.TOTAL_GAMES,
        MarketTypes.PLAYER_GAMES
      ];
      
    case SportIds.BASEBALL:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.OVER_UNDER,
        MarketTypes.HANDICAP
      ];
      
    case SportIds.HOCKEY:
      return [
        MarketTypes.MATCH_RESULT,
        MarketTypes.OVER_UNDER,
        MarketTypes.HANDICAP
      ];
      
    case SportIds.RUGBY:
      return [
        MarketTypes.MATCH_RESULT,
        MarketTypes.HANDICAP,
        MarketTypes.OVER_UNDER,
        MarketTypes.FIRST_TEAM_TO_SCORE
      ];
      
    case SportIds.CRICKET:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.TOP_BATSMAN,
        MarketTypes.TOP_BOWLER,
        MarketTypes.METHOD_OF_DISMISSAL,
        MarketTypes.TOTAL_MATCH_SIXES
      ];
      
    case SportIds.VOLLEYBALL:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.SET_WINNER,
        MarketTypes.HANDICAP
      ];
      
    case SportIds.MMA_UFC:
    case SportIds.BOXING:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.METHOD_OF_VICTORY,
        MarketTypes.ROUND_BETTING,
        MarketTypes.FIGHT_DURATION
      ];
      
    case SportIds.FORMULA_1:
      return [
        MarketTypes.RACE_WINNER,
        MarketTypes.PODIUM_FINISH,
        MarketTypes.FASTEST_LAP
      ];
      
    case SportIds.CYCLING:
      return [
        MarketTypes.RACE_WINNER,
        MarketTypes.TOP_5_FINISH,
        MarketTypes.HEAD_TO_HEAD
      ];
      
    case SportIds.AMERICAN_FOOTBALL:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.HANDICAP,
        MarketTypes.OVER_UNDER,
        MarketTypes.FIRST_TEAM_TO_SCORE
      ];
      
    case SportIds.GOLF:
      return [
        MarketTypes.TOURNAMENT_WINNER,
        MarketTypes.TOP_5_FINISH,
        MarketTypes.TOP_10_FINISH,
        MarketTypes.HEAD_TO_HEAD
      ];
      
    case SportIds.SNOOKER:
    case SportIds.DARTS:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.HANDICAP,
        MarketTypes.OVER_UNDER,
        MarketTypes.CORRECT_SCORE
      ];

    case SportIds.WWE_ENTERTAINMENT:
      return [
        MarketTypes.MATCH_WINNER,
      ];
      
    // For all other sports, use general markets
    default:
      return [
        MarketTypes.MATCH_WINNER,
        MarketTypes.OVER_UNDER,
        MarketTypes.HANDICAP
      ];
  }
};

// Get specific market display settings for a sport
export const getMarketDisplaySettings = (sportId: number, marketType: string) => {
  const defaultSettings = {
    displayTitle: marketType,
    outcomes: 'standard', // 'standard', 'yes-no', 'over-under'
    allowParlay: true
  };
  
  // Customize display settings for specific market types
  switch (marketType) {
    case MarketTypes.BOTH_TEAMS_TO_SCORE:
      return {
        ...defaultSettings,
        displayTitle: 'Both Teams to Score',
        outcomes: 'yes-no'
      };
      
    case MarketTypes.OVER_UNDER:
      return {
        ...defaultSettings,
        displayTitle: 'Total Goals/Points',
        outcomes: 'over-under'
      };
      
    default:
      return defaultSettings;
  }
};

// Parse and enhance markets data from API for all sports
export const enhanceMarketsForSport = (markets: Market[], sportId: number, homeTeam?: string, awayTeam?: string): Market[] => {
  if (!markets || markets.length === 0) {
    return [];
  }
  
  // First, enhance existing market names
  const enhancedMarkets = markets.map(market => {
    // Standardize market names based on sport type
    switch(sportId) {
      case SportIds.SOCCER:
        if (market.name.includes('1x2') || market.name.toLowerCase().includes('match result')) {
          market.name = MarketTypes.MATCH_RESULT;
        } else if (market.name.toLowerCase().includes('both teams to score')) {
          market.name = MarketTypes.BOTH_TEAMS_TO_SCORE;
        } else if (market.name.toLowerCase().includes('double chance')) {
          market.name = MarketTypes.DOUBLE_CHANCE;
        } else if (market.name.toLowerCase().includes('correct score')) {
          market.name = MarketTypes.CORRECT_SCORE;
        } else if (market.name.toLowerCase().includes('over/under') || market.name.toLowerCase().includes('goals')) {
          market.name = MarketTypes.OVER_UNDER;
        } else if (market.name.toLowerCase().includes('half time') || market.name.toLowerCase().includes('half-time')) {
          market.name = MarketTypes.FIRST_HALF_RESULT;
        }
        break;
        
      case SportIds.BASKETBALL:
        if (market.name.toLowerCase().includes('winner') || market.name.toLowerCase().includes('moneyline')) {
          market.name = MarketTypes.MATCH_WINNER;
        } else if (market.name.toLowerCase().includes('total')) {
          market.name = MarketTypes.TOTAL_POINTS;
        } else if (market.name.toLowerCase().includes('quarter')) {
          market.name = MarketTypes.QUARTER_WINNER;
        }
        break;
        
      case SportIds.TENNIS:
        if (market.name.toLowerCase().includes('winner')) {
          market.name = MarketTypes.MATCH_WINNER;
        } else if (market.name.toLowerCase().includes('set')) {
          market.name = MarketTypes.SET_WINNER;
        } else if (market.name.toLowerCase().includes('total games')) {
          market.name = MarketTypes.TOTAL_GAMES;
        }
        break;
        
      case SportIds.BASEBALL:
        if (market.name.toLowerCase().includes('winner') || market.name.toLowerCase().includes('moneyline')) {
          market.name = MarketTypes.MATCH_WINNER;
        } else if (market.name.toLowerCase().includes('total')) {
          market.name = MarketTypes.OVER_UNDER;
        }
        break;
        
      case SportIds.CRICKET:
        if (market.name.toLowerCase().includes('winner') || market.name.toLowerCase().includes('match winner')) {
          market.name = MarketTypes.MATCH_WINNER;
        } else if (market.name.toLowerCase().includes('top batsman')) {
          market.name = MarketTypes.TOP_BATSMAN;
        } else if (market.name.toLowerCase().includes('top bowler')) {
          market.name = MarketTypes.TOP_BOWLER;
        }
        break;
        
      case SportIds.MMA_UFC:
      case SportIds.BOXING:
        if (market.name.toLowerCase().includes('winner')) {
          market.name = MarketTypes.MATCH_WINNER;
        } else if (market.name.toLowerCase().includes('method of victory')) {
          market.name = MarketTypes.METHOD_OF_VICTORY;
        } else if (market.name.toLowerCase().includes('round')) {
          market.name = MarketTypes.ROUND_BETTING;
        }
        break;
        
      case SportIds.FORMULA_1:
      case SportIds.CYCLING:
        if (market.name.toLowerCase().includes('winner')) {
          market.name = MarketTypes.RACE_WINNER;
        } else if (market.name.toLowerCase().includes('podium')) {
          market.name = MarketTypes.PODIUM_FINISH;
        }
        break;
        
      case SportIds.GOLF:
        if (market.name.toLowerCase().includes('winner')) {
          market.name = MarketTypes.TOURNAMENT_WINNER;
        } else if (market.name.toLowerCase().includes('top 5')) {
          market.name = MarketTypes.TOP_5_FINISH;
        } else if (market.name.toLowerCase().includes('top 10')) {
          market.name = MarketTypes.TOP_10_FINISH;
        }
        break;
        
      // For other sports, keep the original market name or apply a default standardization
      default:
        if (market.name.toLowerCase().includes('winner')) {
          market.name = MarketTypes.MATCH_WINNER;
        } else if (market.name.toLowerCase().includes('total') || 
                  market.name.toLowerCase().includes('over/under')) {
          market.name = MarketTypes.OVER_UNDER;
        }
        break;
    }
    
    // Standardize outcome names across all sports
    if (market.outcomes) {
      market.outcomes = market.outcomes.map(outcome => ({
        ...outcome,
        name: standardizeOutcomeName(outcome.name, sportId)
      }));
    }
    
    return market;
  });
  
  // For soccer, add missing secondary markets
  if (sportId === SportIds.SOCCER && homeTeam && awayTeam) {
    const existingMarketNames = enhancedMarkets.map(m => m.name.toLowerCase());
    const nextId = enhancedMarkets.length + 100;
    
    // Add BTTS if not present
    if (!existingMarketNames.some(n => n.includes('both teams'))) {
      enhancedMarkets.push({
        id: nextId + 1,
        name: MarketTypes.BOTH_TEAMS_TO_SCORE,
        type: 'btts',
        status: 'open',
        outcomes: [
          { id: 'btts_yes', name: 'Yes', odds: 1.85, status: 'active', probability: 0.54 },
          { id: 'btts_no', name: 'No', odds: 1.95, status: 'active', probability: 0.51 }
        ]
      });
    }
    
    // Add Double Chance if not present
    if (!existingMarketNames.some(n => n.includes('double chance'))) {
      enhancedMarkets.push({
        id: nextId + 2,
        name: MarketTypes.DOUBLE_CHANCE,
        type: 'double_chance',
        status: 'open',
        outcomes: [
          { id: 'dc_1x', name: `${homeTeam} or Draw`, odds: 1.35, status: 'active', probability: 0.74 },
          { id: 'dc_12', name: `${homeTeam} or ${awayTeam}`, odds: 1.20, status: 'active', probability: 0.83 },
          { id: 'dc_x2', name: `Draw or ${awayTeam}`, odds: 1.40, status: 'active', probability: 0.71 }
        ]
      });
    }
    
    // Add First Half Result if not present
    if (!existingMarketNames.some(n => n.includes('half time') || n.includes('half-time') || n.includes('first half'))) {
      enhancedMarkets.push({
        id: nextId + 3,
        name: MarketTypes.FIRST_HALF_RESULT,
        type: 'half_time',
        status: 'open',
        outcomes: [
          { id: 'ht_home', name: homeTeam, odds: 2.50, status: 'active', probability: 0.40 },
          { id: 'ht_draw', name: 'Draw', odds: 2.10, status: 'active', probability: 0.48 },
          { id: 'ht_away', name: awayTeam, odds: 3.00, status: 'active', probability: 0.33 }
        ]
      });
    }
    
    // Add Over/Under 2.5 if not present
    if (!existingMarketNames.some(n => n.includes('over') || n.includes('under'))) {
      enhancedMarkets.push({
        id: nextId + 4,
        name: 'Over/Under 2.5 Goals',
        type: 'over_under',
        status: 'open',
        outcomes: [
          { id: 'ou_over', name: 'Over 2.5', odds: 1.90, status: 'active', probability: 0.53 },
          { id: 'ou_under', name: 'Under 2.5', odds: 1.90, status: 'active', probability: 0.53 }
        ]
      });
    }
  }
  
  return enhancedMarkets;
};

export default {
  SportIds,
  MarketTypes,
  getDefaultMarkets,
  getAvailableMarketTypesForSport,
  getMarketDisplaySettings,
  enhanceMarketsForSport,
  standardizeOutcomeName
};