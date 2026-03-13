import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '@/lib/queryClient';
import { useWebSocketLiveUpdates } from '@/lib/useWebSocketLiveUpdates';
import { 
  Trophy, 
  Grid, 
  Home,
  ChevronRight,
  Zap,
  Radio,
  AreaChart,
  Wifi,
  WifiOff,
  Activity,
  Target,
  Gamepad2,
  Dumbbell
} from 'lucide-react';

// Sport icon mapping with proper icons
const SPORT_ICONS: Record<number, JSX.Element> = {
  1: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,      // Football (European) 
  2: <Activity className="mr-2 h-4 w-4 text-[#00ffff]" />, // Basketball
  3: <Target className="mr-2 h-4 w-4 text-[#00ffff]" />,   // Tennis
  4: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,    // Baseball
  5: <Gamepad2 className="mr-2 h-4 w-4 text-[#00ffff]" />, // Hockey
  6: <Dumbbell className="mr-2 h-4 w-4 text-[#00ffff]" />, // Handball
  7: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />, // Volleyball
  8: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,      // Rugby
  9: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,    // Cricket
  10: <Target className="mr-2 h-4 w-4 text-[#00ffff]" />,  // Golf
  11: <Dumbbell className="mr-2 h-4 w-4 text-[#00ffff]" />, // Boxing
  12: <Dumbbell className="mr-2 h-4 w-4 text-[#00ffff]" />, // MMA/UFC
  13: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />, // Formula 1
  14: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />, // Cycling
  15: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,     // American Football
  16: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,     // AFL
  17: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,   // Snooker
  18: <Target className="mr-2 h-4 w-4 text-[#00ffff]" />,  // Darts
  19: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />, // Table Tennis
  20: <Dumbbell className="mr-2 h-4 w-4 text-[#00ffff]" />, // WWE Entertainment
  21: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,     // Beach Volleyball
  22: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,   // Winter Sports
  23: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />, // Motorsport
  24: <Gamepad2 className="mr-2 h-4 w-4 text-[#00ffff]" />, // Esports
  25: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,   // Netball
  26: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,     // Soccer
  27: <Activity className="mr-2 h-4 w-4 text-[#00ffff]" />, // NBA
  28: <Gamepad2 className="mr-2 h-4 w-4 text-[#00ffff]" />, // NHL
  29: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,     // NFL
  30: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />    // MLB
};

export default function SportsSidebarFixed() {
  const [, setLocation] = useLocation();
  const [sportEventCounts, setSportEventCounts] = useState<Record<number, { live: number, upcoming: number }>>({});
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  
  // Fetch sports for the sidebar directly from the API with error handling
  const { data: sports = [] } = useQuery({
    queryKey: ['/api/sports'],
    queryFn: async () => {
      try {
        console.log("Fetching sports for sidebar...");
        const response = await apiRequest('GET', '/api/sports', undefined, { timeout: 5000 });
        if (!response.ok) {
          throw new Error(`Failed to fetch sports: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`Fetched ${data.length} sports for sidebar`, data);
        return data;
      } catch (error) {
        console.error("Error fetching sports:", error);
        // Return hardcoded default sports as fallback
        // Fallback list matching DB sports table IDs exactly
        return [
          { id: 1,  name: 'Soccer',            slug: 'soccer',            icon: '⚽', isActive: true },
          { id: 2,  name: 'Basketball',         slug: 'basketball',        icon: '🏀', isActive: true },
          { id: 3,  name: 'Tennis',             slug: 'tennis',            icon: '🎾', isActive: true },
          { id: 4,  name: 'American Football',  slug: 'american-football', icon: '🏈', isActive: true },
          { id: 5,  name: 'Baseball',           slug: 'baseball',          icon: '⚾', isActive: true },
          { id: 6,  name: 'Ice Hockey',         slug: 'ice-hockey',        icon: '🏒', isActive: true },
          { id: 7,  name: 'MMA',                slug: 'mma',               icon: '🥊', isActive: true },
          { id: 8,  name: 'Boxing',             slug: 'boxing',            icon: '🥊', isActive: true },
          { id: 9,  name: 'Esports',            slug: 'esports',           icon: '🎮', isActive: true },
          { id: 10, name: 'AFL',                slug: 'afl',               icon: '🏉', isActive: true },
          { id: 11, name: 'Formula 1',          slug: 'formula-1',         icon: '🏎️', isActive: true },
          { id: 12, name: 'Handball',           slug: 'handball',          icon: '🤾', isActive: true },
          { id: 13, name: 'NBA',                slug: 'nba',               icon: '🏀', isActive: true },
          { id: 14, name: 'NFL',                slug: 'nfl',               icon: '🏈', isActive: true },
          { id: 15, name: 'Rugby',              slug: 'rugby',             icon: '🏉', isActive: true },
          { id: 16, name: 'Volleyball',         slug: 'volleyball',        icon: '🏐', isActive: true },
          { id: 17, name: 'Horse Racing',       slug: 'horse-racing',      icon: '🏇', isActive: true },
          { id: 18, name: 'Cricket',            slug: 'cricket',           icon: '🏏', isActive: true },
        ];
      }
    },
    staleTime: 300000, // 5 minutes
    retry: 2
  });

  // Fetch live events with improved error handling
  const { data: liveEvents = [] } = useQuery({
    queryKey: ['/api/events/live'],
    queryFn: async () => {
      try {
        console.log("Fetching live events from lite API for sidebar");
        
        const response = await apiRequest('GET', '/api/events/live-lite', undefined, { 
          timeout: 15000 
        });
        
        if (!response.ok) {
          console.warn("Lite API failed, using fallback endpoint:", response);
          throw new Error(`Status ${response.status}`);
        }
        
        const data = await response.json();
        
        if (Array.isArray(data)) {
          return data.filter(event => 
            event && 
            typeof event === 'object' && 
            event.isLive && 
            (event.id || event.eventId) && 
            (event.homeTeam || event.awayTeam || event.home || event.team1)
          );
        }
      } catch (error) {
        console.error("Error fetching live events for sidebar:", error);
        return [];
      }
    },
    refetchInterval: 60000, // Refresh every 60 seconds for live (reduced to conserve API)
    staleTime: 55000,
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000)
  });

  // Fetch upcoming events with improved error handling
  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ['/api/events/upcoming'],
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', '/api/events', undefined, { 
          timeout: 15000 
        });
        
        if (!response.ok) {
          console.warn(`Upcoming events API returned status ${response.status}`);
          return [];
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data)) {
          console.warn("Upcoming events API did not return an array:", typeof data);
          return [];
        }
        
        const validEvents = data.filter(event => 
          event && 
          typeof event === 'object' && 
          !event.isLive && 
          (event.id || event.eventId) && 
          (event.homeTeam || event.home || event.team1)
        );
        
        return validEvents;
      } catch (error) {
        console.error("Error fetching upcoming events for sidebar:", error);
        return [];
      }
    },
    refetchInterval: 120000, // Refresh every 2 minutes for upcoming (reduced to conserve API)
    staleTime: 110000,
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000)
  });

  // Set up WebSocket connection for live score updates
  const { connectionStatus } = useWebSocketLiveUpdates<any>({
    onScoreUpdate: (updatedEvents) => {
      console.log(`[WebSocket] Received live score updates for ${updatedEvents.length} events`);
    },
    onStatusChange: (status) => {
      setWsStatus(status);
      console.log(`[WebSocket] Connection status changed to: ${status}`);
    },
    autoReconnect: true
  });

  const { data: apiCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ['events', 'counts'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/events/counts', undefined, { timeout: 10000 });
      if (!response.ok) return {};
      return await response.json();
    },
    staleTime: 30000,
    refetchInterval: 30000,
  });

  useEffect(() => {
    const counts: Record<number, { live: number, upcoming: number }> = {};
    
    sports.forEach(sport => {
      counts[sport.id] = { live: 0, upcoming: apiCounts[String(sport.id)] || 0 };
    });
    
    if (Array.isArray(liveEvents)) {
      liveEvents.forEach(event => {
        if (event?.sportId && typeof event.sportId === 'number') {
          if (!counts[event.sportId]) {
            counts[event.sportId] = { live: 0, upcoming: 0 };
          }
          counts[event.sportId].live++;
        }
      });
    }
    
    setSportEventCounts(counts);
  }, [liveEvents, apiCounts, sports]);

  const activeSports = useMemo(() => {
    return sports.filter(sport => sport.isActive !== false);
  }, [sports]);

  const navigateToSport = (sportSlug: string) => {
    console.log(`Navigating to sport: ${sportSlug}`);
    setLocation(`/sports-live/${sportSlug}`);
  };

  return (
    <div className="w-64 bg-[#0b1618] text-white h-full border-r border-[#1e3a3f] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-[#1e3a3f]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-cyan-400 flex items-center">
            <Trophy className="mr-2 h-5 w-5" />
            Sports
          </h2>
          <div className="flex items-center space-x-1">
            {wsStatus === 'connected' ? (
              <Wifi className="h-4 w-4 text-green-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-400" />
            )}
          </div>
        </div>
      </div>

      {/* Quick Navigation */}
      <div className="p-4 border-b border-[#1e3a3f]">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation('/live-events')}
            className="border-[#1e3a3f] text-cyan-400 hover:border-cyan-400 hover:bg-[#1e3a3f] text-xs"
          >
            <Radio className="mr-1 h-3 w-3" />
            Live
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation('/upcoming-events')}
            className="border-[#1e3a3f] text-cyan-400 hover:border-cyan-400 hover:bg-[#1e3a3f] text-xs"
          >
            <Grid className="mr-1 h-3 w-3" />
            Upcoming
          </Button>
        </div>
      </div>

      {/* Sports List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {activeSports.map((sport) => {
            const counts = sportEventCounts[sport.id] || { live: 0, upcoming: 0 };
            const hasEvents = counts.live > 0 || counts.upcoming > 0;
            
            return (
              <Button
                key={sport.id}
                variant="ghost"
                className="w-full justify-between p-3 h-auto text-left hover:bg-[#1e3a3f] hover:text-cyan-400 transition-colors group"
                onClick={() => navigateToSport(sport.slug)}
              >
                <div className="flex items-center">
                  {SPORT_ICONS[sport.id] || <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />}
                  <span className="text-sm font-medium text-gray-300 group-hover:text-cyan-400">
                    {sport.name}
                  </span>
                </div>
                
                <div className="flex items-center space-x-1">
                  {counts.live > 0 && (
                    <Badge variant="destructive" className="text-xs px-1.5 py-0.5 animate-pulse">
                      {counts.live}
                    </Badge>
                  )}
                  {counts.upcoming > 0 && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0.5 border-cyan-400 text-cyan-400">
                      {counts.upcoming}
                    </Badge>
                  )}
                  {hasEvents && <ChevronRight className="h-3 w-3 text-gray-500 group-hover:text-cyan-400" />}
                </div>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="p-4 border-t border-[#1e3a3f] bg-[#0a1214]">
        <div className="text-xs text-gray-400 space-y-1">
          <div className="flex justify-between">
            <span>Live Events:</span>
            <span className="text-red-400 font-bold">{liveEvents.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Upcoming:</span>
            <span className="text-cyan-400 font-bold">{upcomingEvents.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Connection:</span>
            <span className={wsStatus === 'connected' ? 'text-green-400' : 'text-red-400'}>
              {wsStatus === 'connected' ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}