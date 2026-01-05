import { Event, Sport } from "@/types";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import FeaturedEventCard from "./FeaturedEventCard";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLiveEvents } from "@/hooks/useEvents";

export function LiveEventsSection() {
  const { data: liveEvents = [], isLoading, isFetching } = useLiveEvents();
  
  // Cache previous events to prevent flickering during refetch
  const cachedEventsRef = useRef<any[]>([]);
  const stableEvents = useMemo(() => {
    if (liveEvents.length > 0) {
      cachedEventsRef.current = liveEvents;
      return liveEvents;
    }
    return cachedEventsRef.current;
  }, [liveEvents]);

  // Only show loading on initial load, not during refetch
  if (isLoading && stableEvents.length === 0) {
    return <div className="p-12 text-center">Loading live events...</div>;
  }

  if (stableEvents.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader className="bg-gray-100 p-3 flex flex-row items-center justify-between">
          <div className="flex items-center">
            <ChevronDown className="h-4 w-4 mr-2 text-gray-500" />
            <div className="flex items-center">
              <span className="flex items-center">
                <span className="w-2 h-2 bg-red-500 rounded-full inline-block mr-2 live-pulse"></span>
                LIVE
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 text-center text-gray-500">
          No live events available at the moment.
        </CardContent>
      </Card>
    );
  }

  // Group events by league
  const groupedEvents = stableEvents.reduce((acc, event) => {
    // Create a safe league key from league name
    const key = event.leagueSlug || 
                (event.leagueName ? event.leagueName.toLowerCase().replace(/\s+/g, '-') : 'unknown');
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(event);
    return acc;
  }, {} as Record<string, Event[]>);

  // Helper function to get sport name from sportId - updated to match official API-SPORTS documentation
  const getSportName = (sportId: number | null): string => {
    switch(sportId) {
      // Soccer/Football - https://api-sports.io/documentation/football/v3
      case 1: return 'Football';
      
      // Basketball - https://api-sports.io/documentation/basketball/v1
      case 2: return 'Basketball';
      
      // Baseball - https://api-sports.io/documentation/baseball/v1
      case 3: return 'Baseball';
      
      // Hockey - https://api-sports.io/documentation/hockey/v1
      case 4: return 'Hockey';
      
      // Rugby - https://api-sports.io/documentation/rugby/v1
      case 5: return 'Rugby';
      
      // Golf - https://api-sports.io/documentation/golf/v1
      case 6: return 'Golf';  
      
      // Tennis - https://api-sports.io/documentation/tennis/v1
      case 7: return 'Tennis';
      
      // Handball - https://api-sports.io/documentation/handball/v1
      case 8: return 'Handball';
      
      // Cricket - https://api-sports.io/documentation/cricket/v1
      case 9: return 'Cricket';
      
      // AFL - https://api-sports.io/documentation/afl/v1
      case 10: return 'Australian Football';
      
      // NFL - https://api-sports.io/documentation/nfl/v1
      case 11: return 'American Football';
      
      // Rugby League - https://api-sports.io/documentation/rugby/v1 (second product)
      case 12: return 'Rugby League';
      
      // Soccer/Football Alternative - Legacy ID
      case 13: return 'Soccer';
      
      // Cycling - Internal API
      case 14: return 'Cycling';
      
      // Volleyball - https://api-sports.io/documentation/volleyball/v1
      case 15: return 'Volleyball';
      
      // Formula 1 - https://api-sports.io/documentation/formula-1/v1
      case 16: return 'Formula 1';
      
      // Snooker - Internal API
      case 17: return 'Snooker';
      
      // Ice Hockey - Alternative Hockey ID
      case 18: return 'Ice Hockey';
      
      // Alternative Volleyball - Internal API
      case 19: return 'Volleyball';
      
      // Badminton - Internal API
      case 20: return 'Badminton';
      
      // Darts - Internal API
      case 21: return 'Darts';
      
      // Table Tennis - Internal API
      case 22: return 'Table Tennis';
      
      // Alternative Badminton - Internal API
      case 23: return 'Badminton';
      
      // Beach Volleyball - Internal API
      case 24: return 'Beach Volleyball';
      
      // Winter Sports - Internal API
      case 25: return 'Winter Sports';
      
      // Alternative Formula 1 - Internal API
      case 26: return 'Formula 1';
      
      // MMA - https://api-sports.io/documentation/mma/v1
      case 27: return 'MMA/UFC';
      
      // Boxing - Internal API
      case 28: return 'Boxing';
      
      // Alternative Golf - Internal API
      case 29: return 'Golf';
      
      // Horse Racing - Internal API
      case 30: return 'Horse Racing';
      
      // Greyhounds - Internal API
      case 31: return 'Greyhounds';
      
      // Fallback for unrecognized sport IDs
      default: return 'Other';
    }
  };

  // Get sports count to organize leagues by sport - memoized to prevent recalculation
  const sportGroups = useMemo(() => {
    return stableEvents.reduce((acc, event) => {
      const sportId = event.sportId || 0;
      if (!acc[sportId]) {
        acc[sportId] = {
          name: getSportName(sportId),
          count: 0,
          events: []
        };
      }
      acc[sportId].count++;
      acc[sportId].events.push(event);
      return acc;
    }, {} as Record<number, { name: string; count: number; events: Event[] }>);
  }, [stableEvents]);

  // Define type for sport groups
  type SportGroup = { name: string; count: number; events: Event[] };
  
  // Sort sports by count - memoized for stability
  const sortedSports = useMemo((): SportGroup[] => {
    const groups = Object.values(sportGroups) as SportGroup[];
    return groups.sort((a, b) => b.count - a.count);
  }, [sportGroups]);
  
  // State for expanded/collapsed sport sections
  const [expandedSports, setExpandedSports] = useState<Record<string, boolean>>({});
  
  // Track if we've initialized - only run once
  const initializedRef = useRef(false);
  
  // Initialize the first sport as expanded - only once on first data load
  useEffect(() => {
    if (sortedSports.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setExpandedSports({ [sortedSports[0].name]: true });
    }
  }, [sortedSports]);
  
  // Toggle accordion
  const toggleSportExpand = (sportName: string) => {
    setExpandedSports(prev => ({
      ...prev,
      [sportName]: !prev[sportName]
    }));
  };
  
  return (
    <Card className="mb-4 bg-[#18323a] border-[#2a4c55] shadow-lg">
      <CardHeader className="bg-[#214550] p-3 flex flex-row items-center justify-between border-b border-[#2a4c55]">
        <div className="flex items-center">
          <div className="flex items-center">
            <span className="flex items-center text-cyan-300 font-bold">
              <span className="w-2 h-2 bg-red-500 rounded-full inline-block mr-2 animate-pulse"></span>
              LIVE EVENTS
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" className="border-cyan-400 text-cyan-300 hover:bg-cyan-400/20 text-xs">
          View All
        </Button>
      </CardHeader>
      <CardContent className="p-0 max-h-[700px] overflow-auto custom-scrollbar">
        {/* Featured Events */}
        <div className="bg-[#0b1618] p-4 border-b border-[#1e3a3f]">
          <div className="flex items-center justify-between mb-4">
            <div className="text-cyan-300 text-lg font-bold">Featured Events</div>
            <Link href="/live">
              <button className="bg-cyan-500 text-black text-xs font-semibold rounded py-1 px-3 hover:bg-cyan-400">
                View All Live
              </button>
            </Link>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stableEvents.slice(0, 6).map((event) => (
              <div key={event.id} className="relative bg-[#112225] rounded-md border border-[#1e3a3f] overflow-hidden shadow-md h-full flex flex-col">
                {/* Event header */}
                <div className="bg-[#0b1618] p-3 relative border-b border-[#1e3a3f]">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-cyan-300 font-medium">{getSportName(event.sportId)}</span>
                    <span className="text-xs text-gray-400">{event.leagueName}</span>
                  </div>
                  
                  <div className="text-white font-bold text-sm mb-1">{event.homeTeam}</div>
                  <div className="text-gray-400 text-xs mb-1">vs</div>
                  <div className="text-white font-bold text-sm">{event.awayTeam}</div>
                  
                  <div className="absolute top-3 right-3 bg-red-600 rounded text-xs px-1.5 py-0.5 flex items-center">
                    <span className="w-1.5 h-1.5 bg-white rounded-full mr-1 animate-pulse"></span>
                    <span className="text-white font-semibold">LIVE</span>
                  </div>
                </div>
                
                {/* Score display with robust type handling */}
                <div className="bg-[#0b1618] py-2 text-center font-bold border-b border-[#1e3a3f]">
                  <span className="text-cyan-300 text-lg">
                    {(() => {
                      // Handle all possible score formats
                      if (!event.score) return '0 - 0';
                      
                      if (typeof event.score === 'string') {
                        return event.score;
                      }
                      
                      if (Array.isArray(event.score)) {
                        return `${event.score[0] || 0} - ${event.score[1] || 0}`;
                      }
                      
                      if (typeof event.score === 'object') {
                        // Type guard for object with home/away properties
                        interface ScoreObject {
                          home: number | string;
                          away: number | string;
                        }
                        
                        // Check if object has home and away properties
                        if ('home' in event.score && 'away' in event.score) {
                          const typed = event.score as ScoreObject;
                          return `${typed.home || 0} - ${typed.away || 0}`;
                        }
                      }
                      
                      // Default fallback
                      return '0 - 0';
                    })()}
                  </span>
                </div>
                
                {/* Betting options */}
                <div className="p-3 bg-[#112225] flex-grow flex flex-col justify-between">
                  <div className="text-xs text-gray-400 text-center mb-3">
                    {(event.markets && Array.isArray(event.markets) && event.markets.length > 0) ? 
                      event.markets[0]?.name || "Match Result" : 
                      "Match Result"}
                  </div>
                  
                  <div className="space-y-3">
                    {event.markets && event.markets[0] && event.markets[0].outcomes ? (
                      // Use real market data when available
                      event.markets[0].outcomes.map((outcome: { id?: string; name: string; odds: number }, index: number) => (
                        <button 
                          key={outcome.id || index}
                          className="w-full bg-[#1e3a3f] hover:bg-cyan-800 text-cyan-300 py-2.5 px-3 rounded-sm text-sm font-medium transition-colors flex justify-between items-center border border-[#2a4c55]"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const bet = {
                              id: `${event.id}-${outcome.id || index}-${Date.now()}`,
                              eventId: event.id,
                              eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                              selectionName: outcome.name,
                              odds: outcome.odds,
                              stake: 10,
                              market: event.markets?.[0]?.name || "Match Result",
                              uniqueId: Math.random().toString(36).substring(2, 8)
                            };
                            // Add bet to betslip here
                            console.log('Adding bet:', bet);
                          }}
                        >
                          <span>{outcome.name}</span>
                          <span className="bg-[#0b1618] px-2 py-0.5 rounded text-cyan-400 text-xs font-bold">
                            {outcome.odds.toFixed(2)}
                          </span>
                        </button>
                      ))
                    ) : (
                      // Fallback buttons with default data
                      <>
                        <button 
                          className="w-full bg-[#1e3a3f] hover:bg-cyan-800 text-cyan-300 py-2.5 px-3 rounded-sm text-sm font-medium transition-colors flex justify-between items-center border border-[#2a4c55]"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const bet = {
                              id: `${event.id}-home-${Date.now()}`,
                              eventId: event.id,
                              eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                              selectionName: event.homeTeam,
                              odds: 2.10,
                              stake: 10,
                              market: "Match Result",
                              uniqueId: Math.random().toString(36).substring(2, 8)
                            };
                            console.log('Adding bet for home team:', bet);
                          }}
                        >
                          <span>{event.homeTeam}</span>
                          <span className="bg-[#0b1618] px-2 py-0.5 rounded text-cyan-400 text-xs font-bold">2.10</span>
                        </button>
                        <button 
                          className="w-full bg-[#1e3a3f] hover:bg-cyan-800 text-cyan-300 py-2.5 px-3 rounded-sm text-sm font-medium transition-colors flex justify-between items-center border border-[#2a4c55]"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const bet = {
                              id: `${event.id}-away-${Date.now()}`,
                              eventId: event.id,
                              eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                              selectionName: event.awayTeam,
                              odds: 3.40,
                              stake: 10,
                              market: "Match Result",
                              uniqueId: Math.random().toString(36).substring(2, 8)
                            };
                            console.log('Adding bet for away team:', bet);
                          }}
                        >
                          <span>{event.awayTeam}</span>
                          <span className="bg-[#0b1618] px-2 py-0.5 rounded text-cyan-400 text-xs font-bold">3.40</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Clickable link to event details */}
                <Link href={`/match/${event.id}`}>
                  <span className="absolute inset-0 cursor-pointer z-0"></span>
                </Link>
              </div>
            ))}
          </div>
        </div>
        
        {/* Sports Tabs */}
        <div className="flex items-center bg-[#214550] p-2 border-b border-[#2a4c55] overflow-x-auto sticky top-0 z-10 shadow-md">
          {sortedSports.map((sport, idx) => (
            <Button 
              key={idx}
              variant={idx === 0 ? "default" : "outline"} 
              size="sm" 
              className={`mr-2 text-xs whitespace-nowrap ${
                idx === 0 
                  ? 'bg-cyan-400 text-[#112225] hover:bg-cyan-500 font-semibold' 
                  : 'border-[#2a4c55] text-white hover:text-cyan-200 hover:border-cyan-400 bg-[#18323a]/70'
              }`}
            >
              {sport.name} ({sport.count})
            </Button>
          ))}
        </div>

        {/* Display events by sport in compact grid format */}
        <div className="p-3">
          {sortedSports.slice(0, 10).map((sport, sportIndex) => (
            <div key={sportIndex} className="mb-5 bg-[#0b1618] border border-[#1e3a3f] rounded-md overflow-hidden">
              {/* Sport header with collapsible accordion style */}
              <div 
                className="flex items-center justify-between p-3 bg-[#0b1618] cursor-pointer hover:bg-[#112225] transition-colors"
                onClick={() => toggleSportExpand(sport.name)}
              >
                <h3 className="text-cyan-400 font-bold flex items-center">
                  {expandedSports[sport.name] ? 
                    <ChevronDown className="h-4 w-4 mr-2 text-cyan-300" /> : 
                    <ChevronRight className="h-4 w-4 mr-2 text-cyan-300" />
                  }
                  {sport.name.toUpperCase()} 
                  <span className="ml-2 px-1.5 py-0.5 bg-[#1e3a3f] rounded-sm text-xs text-cyan-300/90">
                    {sport.count}
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-sm flex items-center font-semibold">
                    <span className="w-1 h-1 bg-white rounded-full mr-1 animate-pulse"></span>
                    LIVE
                  </span>
                  <Link href={`/sport/${sport.name.toLowerCase()}`} onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="border-cyan-400 text-cyan-300 hover:bg-cyan-400/20 text-xs">
                      View All
                    </Button>
                  </Link>
                </div>
              </div>
              
              {/* Show sport events when expanded */}
              {expandedSports[sport.name] && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                  {sport.events.slice(0, 3).map((event) => (
                    <Link key={event.id} href={`/match/${event.id}`}>
                      <div className="cursor-pointer bg-[#18323a] hover:bg-[#214550] p-3 border border-[#2a4c55] hover:border-cyan-400/50 rounded transition-all duration-200 shadow-md h-full">
                        <div className="flex justify-between items-center mb-2">
                          <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-sm flex items-center font-semibold">
                            <span className="w-1 h-1 bg-white rounded-full mr-1 animate-pulse"></span>
                            LIVE
                          </span>
                          <span className="text-cyan-300 text-xs font-medium">{event.leagueName}</span>
                        </div>
                        
                        <div className="flex justify-between items-center mb-2.5">
                          <span className="text-cyan-300 font-bold truncate pr-2 max-w-[65%]">{event.homeTeam}</span>
                          {event.markets && event.markets[0] && event.markets[0].outcomes ? (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-xs bg-cyan-700/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 font-semibold px-3"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // Add bet to betslip logic would go here
                                console.log('Adding home bet for:', event.homeTeam);
                              }}
                            >
                              {event.markets[0].outcomes[0]?.odds.toFixed(2) || '1.90'}
                            </Button>
                          ) : (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-xs bg-cyan-700/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 font-semibold px-3"
                            >
                              2.10
                            </Button>
                          )}
                        </div>
                        
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-cyan-300 font-bold truncate pr-2 max-w-[65%]">{event.awayTeam}</span>
                          {event.markets && event.markets[0] && event.markets[0].outcomes && event.markets[0].outcomes[1] ? (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-xs bg-cyan-700/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 font-semibold px-3"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // Add bet to betslip logic would go here
                                console.log('Adding away bet for:', event.awayTeam);
                              }}
                            >
                              {event.markets[0].outcomes[1]?.odds.toFixed(2) || '2.10'}
                            </Button>
                          ) : (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-xs bg-cyan-700/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500 hover:text-white hover:border-cyan-400 font-semibold px-3"
                            >
                              1.90
                            </Button>
                          )}
                        </div>
                        
                        {event.score && (
                          <div className="mt-3 text-center">
                            <span className="text-cyan-300 text-sm font-bold bg-[#2a4c55] px-3 py-1 rounded shadow-inner shadow-black/20 border border-cyan-500/30">
                              {event.score}
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        
        <div className="p-3 text-center bg-gradient-to-r from-[#214550] to-[#2a5665] border-t border-[#2a4c55]">
          <Link href="/live">
            <Button variant="outline" className="border-cyan-400 text-cyan-300 bg-[#18323a]/70 hover:bg-cyan-500 hover:text-white hover:border-cyan-500 font-semibold shadow-md">
              View All Live Events
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}