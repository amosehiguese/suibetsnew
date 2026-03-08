import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardContent 
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  ChevronDown,
  Activity,
  Calendar,
  TrendingUp,
  Clock
} from 'lucide-react';
import { useBetting } from '@/context/BettingContext';
import { Event, Market } from '@/types';
import sportMarketsAdapter, { SportIds } from '@/lib/sportMarketsAdapter';
import { Separator } from '@/components/ui/separator';

// Inline sport event card component definition since we had import issues
const SportEventCard = ({ event, sportId }: { event: Event, sportId: number }) => {
  const { addBet } = useBetting();
  
  // Get markets for this event based on sport type
  let markets: any[] = event.markets || [];
  
  // If no markets provided, use default ones based on sport
  if (!markets || markets.length === 0) {
    markets = sportMarketsAdapter.getDefaultMarkets(
      sportId, 
      event.homeTeam, 
      event.awayTeam
    );
  } else {
    // Enhance the existing markets and add missing secondary markets
    markets = sportMarketsAdapter.enhanceMarketsForSport(markets as any, sportId, event.homeTeam, event.awayTeam);
  }
  
  const primaryMarket = markets[0];
  
  // Format date for display
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    
    // Return 'Today' with the time if it's today
    const today = new Date();
    if (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    ) {
      return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Otherwise return the date and time
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + 
      ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  // Function to handle adding a bet to the betslip
  const handleAddBet = (e: React.MouseEvent, selectionName: string, odds: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Convert eventId to string if it's a number
    const eventIdString = typeof event.id === 'number' ? event.id.toString() : event.id;
    
    // Create the bet object
    const bet = {
      id: `${eventIdString}-${primaryMarket?.name || 'Match Result'}-${selectionName}-${Date.now()}`,
      eventId: eventIdString,
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      selectionName,
      odds,
      stake: 10, // Default stake
      market: primaryMarket?.name || 'Match Result',
      isLive: event.isLive,
      uniqueId: Math.random().toString(36).substring(2, 8)
    };
    
    addBet(bet);
  };
  
  return (
    <Card className="bg-[#112225] border-[#1e3a3f] hover:border-cyan-500/70 transition-all duration-200 overflow-hidden relative">
      <CardContent className="p-3">
        {/* Event header with time */}
        <div className="flex justify-between items-start mb-3">
          <div className="flex-1">
            <h3 className="text-white font-bold truncate">{event.homeTeam} vs {event.awayTeam}</h3>
            <div className="flex items-center text-xs text-gray-400 mt-1">
              {event.isLive ? (
                <>
                  <Activity className="h-3 w-3 text-red-500 mr-1 animate-pulse" />
                  <span className="text-cyan-300">Live</span>
                  {event.score && (
                    <span className="ml-2 px-1.5 py-0.5 bg-[#1e3a3f] rounded text-cyan-300 font-medium">
                      {event.score}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3 mr-1" />
                  <span>{formatDate(event.startTime)}</span>
                </>
              )}
            </div>
          </div>
          <div className="bg-[#0b1618] px-2 py-1 rounded text-xs text-cyan-300">
            {event.leagueName}
          </div>
        </div>
        
        {/* Betting options */}
        {primaryMarket && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2 text-center">{primaryMarket.name}</p>
            <div className="grid grid-cols-2 gap-1">
              {primaryMarket.outcomes.slice(0, 2).map((outcome, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="h-10 bg-[#1e3a3f] hover:bg-cyan-800 border-[#2a4c55] text-cyan-300 hover:text-white"
                  onClick={(e) => handleAddBet(e, outcome.name, outcome.odds)}
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-normal">{outcome.name}</span>
                    <span className="font-bold">{outcome.odds.toFixed(2)}</span>
                  </div>
                </Button>
              ))}
            </div>
            
            {/* If there's a draw option (for sports like soccer) */}
            {primaryMarket.outcomes.length > 2 && (
              <div className="mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-10 bg-[#1e3a3f] hover:bg-cyan-800 border-[#2a4c55] text-cyan-300 hover:text-white"
                  onClick={(e) => handleAddBet(e, primaryMarket.outcomes[2].name, primaryMarket.outcomes[2].odds)}
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-normal">{primaryMarket.outcomes[2].name}</span>
                    <span className="font-bold">{primaryMarket.outcomes[2].odds.toFixed(2)}</span>
                  </div>
                </Button>
              </div>
            )}
          </div>
        )}
        
        {/* Link to event details page */}
        <Link href={`/match/${event.id}`}>
          <span className="absolute inset-0 z-10 cursor-pointer"></span>
        </Link>
      </CardContent>
    </Card>
  );
};

// Simple loading spinner component for lazy loading
const LoadingSpinner = ({ size = 'md', color = 'cyan' }: { size?: 'sm' | 'md' | 'lg', color?: 'primary' | 'white' | 'cyan' }) => {
  // Size mapping
  const sizeMap = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };
  
  // Color mapping
  const colorMap = {
    primary: 'border-cyan-500 border-t-cyan-300',
    white: 'border-white/30 border-t-white',
    cyan: 'border-cyan-700 border-t-cyan-300'
  };
  
  return (
    <div 
      className={`inline-block ${sizeMap[size]} ${colorMap[color]} rounded-full border-4 animate-spin`}
      role="status"
      aria-label="Loading..."
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
};

const getSportIdBySlug = (slug: string): number => {
  const sportMap: Record<string, number> = {
    'soccer': SportIds.SOCCER,
    'football': SportIds.SOCCER,
    'basketball': SportIds.BASKETBALL,
    'tennis': SportIds.TENNIS,
    'baseball': SportIds.BASEBALL,
    'hockey': SportIds.HOCKEY,
    'rugby': SportIds.RUGBY,
    'golf': SportIds.GOLF,
    'volleyball': SportIds.VOLLEYBALL,
    'cricket': SportIds.CRICKET,
    'mma': SportIds.MMA_UFC,
    'ufc': SportIds.MMA_UFC,
    'boxing': SportIds.BOXING,
    'formula1': SportIds.FORMULA_1,
    'f1': SportIds.FORMULA_1,
    'cycling': SportIds.CYCLING,
    'american-football': SportIds.AMERICAN_FOOTBALL,
    'afl': SportIds.AFL,
    'snooker': SportIds.SNOOKER,
    'darts': SportIds.DARTS,
    'wwe': SportIds.WWE_ENTERTAINMENT,
    'entertainment': SportIds.WWE_ENTERTAINMENT,
    'wwe-entertainment': SportIds.WWE_ENTERTAINMENT
  };

  return sportMap[slug.toLowerCase()] || SportIds.SOCCER;
};

const getSportNameById = (id: number): string => {
  const sportNames: Record<number, string> = {
    [SportIds.SOCCER]: 'Soccer',
    [SportIds.BASKETBALL]: 'Basketball',
    [SportIds.TENNIS]: 'Tennis',
    [SportIds.BASEBALL]: 'Baseball',
    [SportIds.HOCKEY]: 'Hockey',
    [SportIds.RUGBY]: 'Rugby',
    [SportIds.GOLF]: 'Golf',
    [SportIds.VOLLEYBALL]: 'Volleyball',
    [SportIds.CRICKET]: 'Cricket',
    [SportIds.MMA_UFC]: 'MMA/UFC',
    [SportIds.BOXING]: 'Boxing',
    [SportIds.FORMULA_1]: 'Formula 1',
    [SportIds.CYCLING]: 'Cycling',
    [SportIds.AMERICAN_FOOTBALL]: 'American Football',
    [SportIds.AFL]: 'AFL',
    [SportIds.SNOOKER]: 'Snooker',
    [SportIds.DARTS]: 'Darts',
    [SportIds.WWE_ENTERTAINMENT]: 'WWE Entertainment'
  };

  return sportNames[id] || 'Unknown Sport';
};

const getSportIconById = (id: number): string => {
  const sportIcons: Record<number, string> = {
    [SportIds.SOCCER]: '⚽',
    [SportIds.BASKETBALL]: '🏀',
    [SportIds.TENNIS]: '🎾',
    [SportIds.BASEBALL]: '⚾',
    [SportIds.HOCKEY]: '🏒',
    [SportIds.RUGBY]: '🏉',
    [SportIds.GOLF]: '⛳',
    [SportIds.VOLLEYBALL]: '🏐',
    [SportIds.CRICKET]: '🏏',
    [SportIds.MMA_UFC]: '🥊',
    [SportIds.BOXING]: '🥊',
    [SportIds.FORMULA_1]: '🏎️',
    [SportIds.CYCLING]: '🚴',
    [SportIds.AMERICAN_FOOTBALL]: '🏈',
    [SportIds.AFL]: '🏉',
    [SportIds.SNOOKER]: '🎱',
    [SportIds.DARTS]: '🎯',
    [SportIds.WWE_ENTERTAINMENT]: '🎭'
  };

  return sportIcons[id] || '🎮';
};

const SportPage: React.FC = () => {
  const params = useParams<{ sport: string }>();
  const sportSlug = params.sport || 'soccer';
  const sportId = getSportIdBySlug(sportSlug);
  const sportName = getSportNameById(sportId);
  const sportIcon = getSportIconById(sportId);
  
  const [activeTab, setActiveTab] = useState<string>('live');

  // Fetch live events for the specific sport
  const { 
    data: liveEvents = [], 
    isLoading: isLoadingLive,
    error: liveError
  } = useQuery<Event[]>({
    queryKey: ['/api/events', { isLive: true, sportId }],
    enabled: activeTab === 'live',
  });

  // Fetch upcoming events for the specific sport
  const { 
    data: upcomingEvents = [], 
    isLoading: isLoadingUpcoming,
    error: upcomingError
  } = useQuery<Event[]>({
    queryKey: ['/api/events', { isLive: false, sportId }],
    enabled: activeTab === 'upcoming',
  });

  // Group events by league
  const groupEventsByLeague = (events: Event[]) => {
    const grouped: Record<string, Event[]> = {};
    
    events.forEach(event => {
      const leagueName = event.leagueName || 'Other Leagues';
      if (!grouped[leagueName]) {
        grouped[leagueName] = [];
      }
      grouped[leagueName].push(event);
    });
    
    return Object.entries(grouped).map(([leagueName, events]) => ({
      leagueName,
      events
    }));
  };

  const liveEventsByLeague = groupEventsByLeague(liveEvents);
  const upcomingEventsByLeague = groupEventsByLeague(upcomingEvents);

  return (
    <div className="container mx-auto p-4">
      <Card className="bg-[#112225] border-[#1e3a3f] text-white mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl text-cyan-300 flex items-center">
            <span className="mr-2">{sportIcon}</span> {sportName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs 
            defaultValue="live" 
            className="w-full"
            value={activeTab}
            onValueChange={setActiveTab}
          >
            <TabsList className="bg-[#0b1618] border border-[#1e3a3f] grid grid-cols-2 w-full max-w-md mb-4">
              <TabsTrigger 
                value="live" 
                className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
              >
                <Activity className="w-4 h-4 mr-2" /> Live Events
              </TabsTrigger>
              <TabsTrigger 
                value="upcoming" 
                className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
              >
                <Calendar className="w-4 h-4 mr-2" /> Upcoming
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="live">
              {isLoadingLive ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner />
                </div>
              ) : liveError ? (
                <div className="text-red-400 p-4 bg-[#1e262f] rounded-md">
                  Error loading live events. Please try again later.
                </div>
              ) : liveEventsByLeague.length === 0 ? (
                <div className="text-gray-400 p-4 bg-[#0b1618] rounded-md">
                  No live {sportName} events at the moment. Please check back later.
                </div>
              ) : (
                <div className="space-y-6">
                  {liveEventsByLeague.map((league, idx) => (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-cyan-300 font-bold text-lg">
                          {league.leagueName}
                        </h3>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          <TrendingUp className="w-4 h-4 mr-1" /> Stats
                        </Button>
                      </div>
                      <Separator className="bg-[#1e3a3f] mb-3" />
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {league.events.map((event) => (
                          <SportEventCard 
                            key={event.id} 
                            event={event} 
                            sportId={sportId}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="upcoming">
              {isLoadingUpcoming ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner />
                </div>
              ) : upcomingError ? (
                <div className="text-red-400 p-4 bg-[#1e262f] rounded-md">
                  Error loading upcoming events. Please try again later.
                </div>
              ) : upcomingEventsByLeague.length === 0 ? (
                <div className="text-gray-400 p-4 bg-[#0b1618] rounded-md">
                  No upcoming {sportName} events available. Please check back later.
                </div>
              ) : (
                <div className="space-y-6">
                  {upcomingEventsByLeague.map((league, idx) => (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-cyan-300 font-bold text-lg">
                          {league.leagueName}
                        </h3>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          <TrendingUp className="w-4 h-4 mr-1" /> Stats
                        </Button>
                      </div>
                      <Separator className="bg-[#1e3a3f] mb-3" />
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {league.events.map((event) => (
                          <SportEventCard 
                            key={event.id} 
                            event={event} 
                            sportId={sportId}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default SportPage;