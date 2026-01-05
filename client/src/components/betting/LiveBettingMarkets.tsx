import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBetting } from '@/context/BettingContext';
import { apiRequest } from '@/lib/queryClient';
import { formatOdds } from '@/lib/utils';
import { 
  RefreshCw, Clock, Activity, BookType, BadgeInfo, CircleDot, 
  Cpu, Snowflake, Dumbbell, Trophy, Flag, FlagTriangleRight,
  Bike, Dice5, Target, Table2, Shirt, Car, Gamepad2
} from 'lucide-react';
import { Sport } from '@/types';

// Event Market interface
interface Market {
  id: string;
  name: string;
  outcomes: Outcome[];
}

// Event Outcome interface
interface Outcome {
  id: string;
  name: string;
  odds: number;
  probability: number;
}

// Event interface
interface Event {
  id: string;
  sportId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: string;
  score: string;
  markets: Market[];
  isLive: boolean;
}

// Map of sport IDs to icons
const SPORT_ICONS: Record<number, React.ReactNode> = {
  1: <Activity className="h-5 w-5 mr-2" />, // Soccer
  2: <BookType className="h-5 w-5 mr-2" />, // Basketball
  3: <BadgeInfo className="h-5 w-5 mr-2" />, // Tennis
  4: <Cpu className="h-5 w-5 mr-2" />, // Baseball
  5: <Snowflake className="h-5 w-5 mr-2" />, // Hockey
  6: <Trophy className="h-5 w-5 mr-2" />, // Rugby
  7: <Flag className="h-5 w-5 mr-2" />, // Golf
  8: <FlagTriangleRight className="h-5 w-5 mr-2" />, // Boxing
  9: <CircleDot className="h-5 w-5 mr-2" />, // Cricket
  10: <Dumbbell className="h-5 w-5 mr-2" />, // MMA
  11: <Bike className="h-5 w-5 mr-2" />, // Cycling
  12: <Target className="h-5 w-5 mr-2" />, // Darts
  13: <Flag className="h-5 w-5 mr-2" />, // Golf
  16: <Activity className="h-5 w-5 mr-2" />, // American Football
  17: <Trophy className="h-5 w-5 mr-2" />, // Rugby
  19: <Dice5 className="h-5 w-5 mr-2" />, // Volleyball
  20: <Table2 className="h-5 w-5 mr-2" />, // Snooker
  21: <Shirt className="h-5 w-5 mr-2" />, // Handball
  22: <Car className="h-5 w-5 mr-2" />, // Formula 1
  23: <Gamepad2 className="h-5 w-5 mr-2" />, // Esports
};

// Generate a unique identifier for events
function uniqueEventId(sportId: number, eventId: string, index: number): string {
  return `sport-${sportId}-event-${eventId}-idx-${index}`;
}

// Generate a unique identifier for markets
function uniqueMarketId(eventId: string, marketId: string, index: number): string {
  return `event-${eventId}-market-${marketId}-idx-${index}`;
}

// Generate a unique identifier for outcomes
function uniqueOutcomeId(marketId: string, outcomeId: string, index: number): string {
  return `market-${marketId}-outcome-${outcomeId}-idx-${index}`;
}

function LiveBettingMarkets() {
  // Refs to prevent unnecessary rerenders
  const cacheRef = useRef<Event[]>([]);
  const { addBet } = useBetting();
  
  // UI state
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [expandedMarkets, setExpandedMarkets] = useState<Record<string, boolean>>({});
  const [activeSportFilter, setActiveSportFilter] = useState<number | null>(null);
  
  // Helper function to classify/correct sport IDs based on event data
  const classifySport = useCallback((event: Event): number => {
    // If we have a valid sportId, use it directly
    const originalSportId = event.sportId;
    
    // Look for basketball indicators
    if (
      event.leagueName?.toLowerCase().includes('nba') || 
      event.leagueName?.toLowerCase().includes('basketball') ||
      event.leagueName?.toLowerCase().includes('ncaa') ||
      originalSportId === 2
    ) {
      return 2; // Basketball
    }
    
    // Look for baseball indicators
    if (
      event.leagueName?.toLowerCase().includes('mlb') || 
      event.leagueName?.toLowerCase().includes('baseball') ||
      event.homeTeam?.includes('Sox') ||
      event.homeTeam?.includes('Yankees') ||
      event.homeTeam?.includes('Cubs') ||
      event.homeTeam?.includes('Braves') ||
      originalSportId === 4
    ) {
      return 4; // Baseball
    }
    
    // Look for tennis indicators
    if (
      event.leagueName?.toLowerCase().includes('atp') || 
      event.leagueName?.toLowerCase().includes('wta') ||
      event.leagueName?.toLowerCase().includes('tennis') ||
      (event.leagueName?.toLowerCase().includes('open') && !event.leagueName?.toLowerCase().includes('football')) ||
      originalSportId === 3
    ) {
      return 3; // Tennis
    }
    
    // Look for hockey indicators
    if (
      event.leagueName?.toLowerCase().includes('nhl') || 
      event.leagueName?.toLowerCase().includes('hockey') ||
      event.leagueName?.toLowerCase().includes('khl') ||
      originalSportId === 5
    ) {
      return 5; // Hockey
    }
    
    // Look for cricket indicators
    if (
      event.leagueName?.toLowerCase().includes('cricket') || 
      event.leagueName?.toLowerCase().includes('ipl') ||
      event.leagueName?.toLowerCase().includes('test match') ||
      event.leagueName?.toLowerCase().includes('t20') ||
      originalSportId === 9
    ) {
      return 9; // Cricket
    }
    
    // Map additional popular sports
    if (originalSportId === 13) return 13; // Golf
    if (originalSportId === 16) return 16; // American Football
    if (originalSportId === 17) return 17; // Rugby
    if (originalSportId === 19) return 19; // Volleyball 
    if (originalSportId === 20) return 20; // Snooker
    
    // Default to football/soccer if no other indicators found
    return originalSportId || 1; // Football/Soccer as fallback
  }, []);
  
  // Fetch live events with increased timeout and retry logic
  const { 
    data: rawEvents = [], 
    isLoading: eventsLoading, 
    error: eventsError, 
    refetch 
  } = useQuery<Event[]>({
    queryKey: ['/api/events/live'],
    queryFn: async () => {
      try {
        const response = await apiRequest(
          'GET', 
          '/api/events?isLive=true', 
          undefined, 
          { timeout: 15000 }
        );
        
        if (!response.ok) {
          console.warn(`Server error ${response.status} from live events endpoint`);
          return []; 
        }
        
        const data = await response.json();
        if (!Array.isArray(data)) {
          console.warn('Received non-array data for live events');
          return [];
        }
        
        console.log(`Received ${data.length} live events`);
        return data;
      } catch (error) {
        console.warn(`Error fetching live events: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return [];
      }
    },
    refetchInterval: 15000, // Refresh every 15 seconds for live
    retry: 2, 
    retryDelay: 1000,
    staleTime: 15000, // Consider data fresh for 15 seconds
    refetchOnWindowFocus: false, // Prevent flicker on tab focus
    placeholderData: (previousData) => previousData ?? [], // Keep previous data during refetch
  });
  
  // Process and normalize events, using cached events if API fails
  const events = useMemo(() => {
    // If no raw events from API, use cached events
    if (!rawEvents || !Array.isArray(rawEvents) || rawEvents.length === 0) {
      return cacheRef.current.length > 0 ? cacheRef.current : [];
    }
    
    // Map and normalize raw events
    const processed = rawEvents
      .filter(event => event && typeof event === 'object')
      .map(event => ({
        ...event,
        id: event.id || `event-${Math.random().toString(36).substring(2, 8)}`,
        sportId: classifySport(event),
        homeTeam: event.homeTeam || 'Unknown Team',
        awayTeam: event.awayTeam || 'Unknown Opponent',
        markets: Array.isArray(event.markets) ? event.markets.filter(m => 
          m && Array.isArray(m.outcomes) && m.outcomes.length > 0
        ) : []
      }))
      .filter(event => event.markets.length > 0); // Only keep events with valid markets
    
    // Update cache for future use
    if (processed.length > 0) {
      cacheRef.current = processed;
    }
    
    return processed;
  }, [rawEvents, classifySport]);
  
  // Fetch sports data for accurate sport names
  const { data: sports = [] } = useQuery<Sport[]>({
    queryKey: ['/api/sports'],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', '/api/sports');
        return response.json();
      } catch (error) {
        console.warn(`Error fetching sports: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return [];
      }
    },
    staleTime: 3600000, // Cache sports for 1 hour
  });
  
  // Create a lookup dictionary for sports by ID
  const sportsById = useMemo(() => {
    return sports.reduce((acc, sport) => {
      acc[sport.id] = sport;
      return acc;
    }, {} as Record<number, Sport>);
  }, [sports]);
  
  // Group events by sport
  const eventsBySport = useMemo(() => {
    return events.reduce((acc, event) => {
      if (!event) return acc;
      
      const sportId = event.sportId.toString();
      if (!acc[sportId]) {
        acc[sportId] = [];
      }
      acc[sportId].push(event);
      return acc;
    }, {} as Record<string, Event[]>);
  }, [events]);
  
  // Get available sports for filters
  const availableSports = useMemo(() => {
    return Object.keys(eventsBySport).map(sportId => ({
      id: parseInt(sportId),
      name: sportsById[parseInt(sportId)]?.name || `Sport ${sportId}`,
      count: eventsBySport[sportId].length
    })).sort((a, b) => b.count - a.count); // Sort by event count, most first
  }, [eventsBySport, sportsById]);
  
  // Apply sport filter if needed
  const filteredEvents = useMemo(() => {
    return activeSportFilter 
      ? { [activeSportFilter]: eventsBySport[activeSportFilter.toString()] }
      : eventsBySport;
  }, [activeSportFilter, eventsBySport]);
  
  // Initialize expanded states for events when data is loaded
  useEffect(() => {
    if (events.length > 0) {
      const initialExpandedEvents: Record<string, boolean> = {};
      const initialExpandedMarkets: Record<string, boolean> = {};
      
      // Auto-expand first 3 events
      events.slice(0, 3).forEach(event => {
        if (event) {
          initialExpandedEvents[event.id] = true;
          
          // Auto-expand first market for each expanded event
          if (event.markets && event.markets.length > 0) {
            initialExpandedMarkets[`${event.id}-${event.markets[0].id}`] = true;
          }
        }
      });
      
      setExpandedEvents(initialExpandedEvents);
      setExpandedMarkets(initialExpandedMarkets);
    }
  }, [events.length]);
  
  // Toggle event expansion
  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEvents(prev => ({
      ...prev,
      [eventId]: !prev[eventId]
    }));
  }, []);
  
  // Toggle market expansion
  const toggleMarket = useCallback((eventId: string, marketId: string) => {
    const key = `${eventId}-${marketId}`;
    setExpandedMarkets(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  }, []);
  
  // Handle bet click - add to bet slip
  const handleBetClick = useCallback((event: Event, market: Market, outcome: Outcome) => {
    // Create a unique ID for this bet
    const betId = `${event.id}-${market.id}-${outcome.id}-${Date.now()}`;
    
    // Handle both string and number event IDs
    const eventIdValue = typeof event.id === 'string' ? 
      (isNaN(parseInt(event.id)) ? event.id : parseInt(event.id)) : 
      event.id;
    
    // Extract market ID safely
    const marketIdValue = typeof market.id === 'string' ?
      (market.id.includes('-') ? parseInt(market.id.split('-')[0]) : parseInt(market.id)) :
      market.id;
    
    // Add bet to the slip
    addBet({
      id: betId,
      eventId: typeof eventIdValue === 'number' 
        ? eventIdValue.toString() 
        : eventIdValue as string,
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      selectionName: outcome.name,
      odds: outcome.odds,
      stake: 10, // Default stake amount
      market: market.name,
      marketId: marketIdValue,
      outcomeId: outcome.id,
      isLive: true,
      uniqueId: Math.random().toString(36).substring(2, 8) // Add unique identifier
    });
    
    console.log(`Added bet: ${outcome.name} @ ${outcome.odds} for ${event.homeTeam} vs ${event.awayTeam}`);
  }, [addBet]);
  
  // Loading state
  if (eventsLoading && cacheRef.current.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-40">
        <RefreshCw className="animate-spin h-8 w-8 text-cyan-400" />
      </div>
    );
  }
  
  // No events state
  if (events.length === 0) {
    return (
      <Card className="border-[#1e3a3f] bg-[#112225] shadow-lg shadow-cyan-900/10">
        <CardContent className="p-6 text-center">
          <p className="text-gray-400">No live events available at the moment.</p>
          <Button 
            variant="outline" 
            className="mt-4 border-[#1e3a3f] text-cyan-400 hover:bg-cyan-900/20"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardContent>
      </Card>
    );
  }
  
  // Main content
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <Button 
          variant="outline" 
          size="sm" 
          className="border-[#1e3a3f] text-cyan-400 hover:bg-cyan-900/20"
          onClick={() => refetch()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Odds
        </Button>
      </div>
      
      {/* Sports filter tabs */}
      <div className="overflow-x-auto pb-2 mb-4 custom-scrollbar">
        <div className="flex space-x-2 min-w-max">
          <Button 
            key="all"
            variant={activeSportFilter === null ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveSportFilter(null)}
            className={`whitespace-nowrap ${
              activeSportFilter === null 
                ? 'bg-[#00ffff] text-[#112225] hover:bg-[#00ffff]/90' 
                : 'border-[#1e3a3f] text-gray-300 hover:text-[#00ffff] hover:border-[#00ffff]'
            }`}
          >
            All Sports ({Object.values(eventsBySport).flat().length})
          </Button>
          
          {availableSports.map(sport => (
            <Button 
              key={`sport-tab-${sport.id}`}
              variant={activeSportFilter === sport.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveSportFilter(sport.id)}
              className={`whitespace-nowrap ${
                activeSportFilter === sport.id 
                  ? 'bg-[#00ffff] text-[#112225] hover:bg-[#00ffff]/90' 
                  : 'border-[#1e3a3f] text-gray-300 hover:text-[#00ffff] hover:border-[#00ffff]'
              }`}
            >
              {sport.name} ({sport.count})
            </Button>
          ))}
        </div>
      </div>
      
      {/* Main content div with max height and scrolling */}
      <div className="max-h-[calc(100vh-220px)] overflow-y-auto pr-2 custom-scrollbar">
        {Object.entries(filteredEvents || {}).map(([sportId, sportEvents], sportIndex) => {
          if (!sportEvents || sportEvents.length === 0) return null;
          
          const sportIdNum = parseInt(sportId);
          const sport = sportsById ? sportsById[sportIdNum] : null;
          const sportName = sport ? sport.name : `Sport ${sportId}`;
          
          return (
            <div key={`sport-section-${sportId}-${sportIndex}`} className="mb-6">
              <div className="text-lg font-bold text-cyan-400 mb-2 flex items-center sticky top-0 bg-[#112225] py-2 z-10">
                {/* Sport-specific icon */}
                {SPORT_ICONS[sportIdNum] || <Activity className="h-5 w-5 mr-2" />}
                {sportName}
              </div>
              
              {sportEvents.map((event, eventIndex) => (
                <Card 
                  key={uniqueEventId(sportIdNum, event.id, eventIndex)}
                  className="mb-4 border-[#1e3a3f] bg-gradient-to-b from-[#14292e] to-[#112225] shadow-lg shadow-cyan-900/10 overflow-hidden"
                >
                  {/* Event header with toggle */}
                  <CardHeader 
                    className="pb-3 bg-[#0b1618] border-b border-[#1e3a3f] relative cursor-pointer"
                    onClick={() => toggleEvent(event.id)}
                  >
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-400 to-blue-500 opacity-70"></div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center">
                        <span className="w-2 h-2 bg-red-500 rounded-full mr-2 live-pulse"></span>
                        <span className="text-cyan-300 font-bold">{event.homeTeam} vs {event.awayTeam}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="text-xs bg-[#1e3a3f] text-cyan-300 px-2 py-1 rounded">
                          {event.leagueName}
                        </div>
                        <div className="text-xs bg-[#1e3a3f] text-cyan-300 px-2 py-1 rounded flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          {event.score || "0-0"}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  
                  {/* Markets section (shows when event is expanded) */}
                  {expandedEvents[event.id] && (
                    <CardContent className="p-3">
                      {event.markets && event.markets.length > 0 ? (
                        event.markets.map((market, marketIndex) => (
                          <div 
                            key={uniqueMarketId(event.id, market.id, marketIndex)} 
                            className="mb-3 last:mb-0"
                          >
                            {/* Market header with toggle */}
                            <div 
                              className="px-3 py-2 bg-[#0f1c1f] rounded-t border-[#1e3a3f] border flex justify-between items-center cursor-pointer"
                              onClick={() => toggleMarket(event.id, market.id)}
                            >
                              <span className="font-medium text-cyan-300">{market.name}</span>
                            </div>
                            
                            {/* Market outcomes (shows when market is expanded) */}
                            {expandedMarkets[`${event.id}-${market.id}`] && (
                              <div className="p-3 bg-[#0b1618] border-[#1e3a3f] border-t-0 border rounded-b">
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {market.outcomes && market.outcomes.map((outcome, outcomeIndex) => (
                                    <Button
                                      key={uniqueOutcomeId(market.id, outcome.id || '', outcomeIndex)}
                                      variant="outline"
                                      onClick={() => handleBetClick(event, market, outcome)}
                                      className="flex flex-col border-[#1e3a3f] bg-[#0b1618] hover:bg-[#0f3942] hover:border-[#00ffff] hover:text-[#00ffff] transition-all duration-200 py-3"
                                    >
                                      <span className="text-sm font-medium text-cyan-300">{outcome.name}</span>
                                      <div className="flex items-center justify-center mt-1 px-2 py-1 bg-[#1e3a3f] rounded text-cyan-300 text-xs">
                                        {formatOdds(outcome.odds)}
                                      </div>
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-400 text-center py-2">No markets available for this event</p>
                      )}
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default LiveBettingMarkets;