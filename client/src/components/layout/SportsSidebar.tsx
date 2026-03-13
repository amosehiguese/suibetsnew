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
  BarChart,
  Clock,
  Zap,
  Radio,
  AreaChart,
  Wifi,
  WifiOff
} from 'lucide-react';

// Sport icon mapping
const SPORT_ICONS: Record<number, JSX.Element> = {
  1: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  2: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  3: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  4: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  5: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  6: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  7: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  8: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  9: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  10: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  11: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  12: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  13: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  14: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  15: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  16: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  17: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  18: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  19: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  20: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  21: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  22: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  23: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />,
  24: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  25: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  26: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  27: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  28: <Radio className="mr-2 h-4 w-4 text-[#00ffff]" />,
  29: <Zap className="mr-2 h-4 w-4 text-[#00ffff]" />,
  30: <AreaChart className="mr-2 h-4 w-4 text-[#00ffff]" />
};

export default function SportsSidebar() {
  const [location, setLocation] = useLocation();
  const [sportEventCounts, setSportEventCounts] = useState<Record<number, { live: number, upcoming: number }>>({});
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [hoveredSportId, setHoveredSportId] = useState<number | null>(null);

  // Extract selected sport from URL
  const getSelectedSportId = (): number | null => {
    const match = location.match(/\/sports-live\/(.+)/);
    if (match) {
      const slug = match[1];
      return getSportIdForSlug(slug);
    }
    return null;
  };

  const selectedSportId = getSelectedSportId();
  
  // Fetch sports
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
        // Fallback matches DB sports table IDs exactly
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
    refetchInterval: 300000,
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000)
  });
  
  // Fetch live events
  const { data: liveEvents = [] } = useQuery({
    queryKey: ['/api/events/live-lite'],
    queryFn: async () => {
      try {
        console.log("Fetching live events from lite API for sidebar");
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          
          const response = await fetch('/api/events/live-lite', {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
              'Cache-Control': 'no-cache'
            }
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`API status: ${response.status}`);
          }
          
          const responseText = await response.text();
          
          if (!responseText.trim().startsWith('[') || !responseText.trim().endsWith(']')) {
            throw new Error("Invalid array format");
          }
          
          try {
            const data = JSON.parse(responseText);
            
            if (!Array.isArray(data)) {
              throw new Error("Not an array after parsing");
            }
            
            console.log(`Received ${data.length} lite events for sidebar`);
            
            const validEvents = data.filter(event => 
              event && 
              typeof event === 'object' && 
              (event.id || event.eventId) && 
              (event.homeTeam || event.awayTeam || event.home || event.team1)
            );
            
            return validEvents;
          } catch (jsonError) {
            throw jsonError;
          }
        } catch (liteError) {
          
          const fallbackResponse = await apiRequest('GET', '/api/events?isLive=true', undefined, { 
            timeout: 15000,
            retries: 2     
          });
          
          if (!fallbackResponse.ok) {
            return [];
          }
          
          const fallbackData = await fallbackResponse.json();
          
          if (!Array.isArray(fallbackData)) {
            console.warn("Fallback API did not return an array:", typeof fallbackData);
            return [];
          }
          
          console.log(`Received ${fallbackData.length} live events from fallback API`);
          
          return fallbackData.filter(event => 
            event && 
            typeof event === 'object' && 
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

  // Fetch upcoming events
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

  // WebSocket connection
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

  // Calculate event counts
  useEffect(() => {
    if (!sports.length || (!liveEvents.length && !upcomingEvents.length)) return;
    
    const counts: Record<number, { live: number, upcoming: number }> = {};
    
    sports.forEach((sport: any) => {
      counts[sport.id] = { live: 0, upcoming: 0 };
    });
    
    liveEvents.forEach((event: any) => {
      if (event.sportId && counts[event.sportId]) {
        counts[event.sportId].live += 1;
      }
    });
    
    upcomingEvents.forEach((event: any) => {
      if (event.sportId && counts[event.sportId]) {
        counts[event.sportId].upcoming += 1;
      }
    });
    
    setSportEventCounts(counts);
    
  }, [sports.length, liveEvents.length, upcomingEvents.length]);

  // Map slug to sport ID
  const getSportIdForSlug = (slug: string): number => {
    // IDs match the database sports table exactly
    const mappings: Record<string, number> = {
      'soccer': 1,
      'football': 1,
      'basketball': 2,
      'tennis': 3,
      'american-football': 4,
      'american_football': 4,
      'baseball': 5,
      'ice-hockey': 6,
      'hockey': 6,
      'mma': 7,
      'mma-ufc': 7,
      'ufc': 7,
      'boxing': 8,
      'esports': 9,
      'afl': 10,
      'aussie-rules': 10,
      'formula-1': 11,
      'formula_1': 11,
      'f1': 11,
      'handball': 12,
      'nba': 13,
      'nfl': 14,
      'rugby': 15,
      'volleyball': 16,
      'horse-racing': 17,
      'horseracing': 17,
      'cricket': 18,
    };
    return mappings[slug] || 1;
  };

  // Handle sport click
  const handleSportClick = (sport: any) => {
    const normalizedSlug = sport.slug
      .replace('_', '-')
      .toLowerCase();
    
    const sportId = getSportIdForSlug(normalizedSlug);
    
    localStorage.removeItem('currentSportId');
    localStorage.removeItem('currentSportSlug');
    
    localStorage.setItem('currentSportId', String(sportId));
    localStorage.setItem('currentSportSlug', normalizedSlug);
    
    console.log(`Selected sport: ${sport.name} (ID: ${sportId}, slug: ${normalizedSlug}) - CACHE CLEARED`);
    
    setLocation(`/sports-live/${normalizedSlug}`);
  };

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Upcoming button at top */}
      <div className="mb-6">
        <Button
          onClick={() => setLocation('/home-real')}
          className="w-full bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-black font-bold py-2 px-3 rounded-lg shadow-lg shadow-cyan-500/50 transition-all hover:shadow-cyan-500/70 flex items-center justify-center gap-2"
          data-testid="button-upcoming"
        >
          <span>📅</span>
          Upcoming
        </Button>
      </div>
      
      {/* Sports list */}
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <div className="space-y-2">
          {sports
            .filter((sport: any) => {
              if (!sport.isActive) return false;
              
              // Hide selected sport from the list
              if (selectedSportId && sport.id === selectedSportId) {
                return false;
              }
              
              if (sport.id === 26) {
                return !sports.some((s: any) => s.id === 1 && s.isActive);
              }
              
              if ([27, 28, 29, 30].includes(sport.id)) {
                if (sport.id === 27) return !sports.some((s: any) => s.id === 2 && s.isActive);
                if (sport.id === 28) return !sports.some((s: any) => s.id === 5 && s.isActive);
                if (sport.id === 29) return !sports.some((s: any) => s.id === 15 && s.isActive);
                if (sport.id === 30) return !sports.some((s: any) => s.id === 4 && s.isActive);
              }
              
              return true;
            })
            .sort((a: any, b: any) => {
              const isMainSportA = a.id >= 1 && a.id <= 14;
              const isMainSportB = b.id >= 1 && b.id <= 14;
              
              if (isMainSportA && !isMainSportB) return -1;
              if (!isMainSportA && isMainSportB) return 1;
              
              const liveDiff = (sportEventCounts[b.id]?.live || 0) - (sportEventCounts[a.id]?.live || 0);
              if (liveDiff !== 0) return liveDiff;
              
              const upcomingDiff = (sportEventCounts[b.id]?.upcoming || 0) - (sportEventCounts[a.id]?.upcoming || 0);
              if (upcomingDiff !== 0) return upcomingDiff;
              
              if (isMainSportA && isMainSportB) {
                return a.id - b.id;
              }
              
              return a.name.localeCompare(b.name);
            })
            .map((sport: any) => {
              const liveCount = sportEventCounts[sport.id]?.live || 0;
              const upcomingCount = sportEventCounts[sport.id]?.upcoming || 0;
              const isHovered = hoveredSportId === sport.id;
              const sportIcon = SPORT_ICONS[sport.id] || <span className="mr-2 h-4 w-4">🎮</span>;
              
              return (
                <Button
                  key={sport.id}
                  variant="ghost"
                  className={`w-full justify-start px-3 py-2 rounded-lg transition-all ${
                    isHovered 
                      ? 'bg-cyan-500/30 text-cyan-50 shadow-lg shadow-cyan-500/50 border-l-2 border-cyan-500' 
                      : 'text-white hover:text-cyan-200 hover:bg-cyan-500/20'
                  }`}
                  onClick={() => handleSportClick(sport)}
                  onMouseEnter={() => setHoveredSportId(sport.id)}
                  onMouseLeave={() => setHoveredSportId(null)}
                  data-testid={`button-sport-${sport.id}`}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    {sportIcon}
                    <span className="truncate text-sm font-medium">{sport.name}</span>
                  </div>
                  
                  {(liveCount > 0 || upcomingCount > 0) && (
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      {liveCount > 0 && (
                        <Badge className="bg-red-500 text-white text-xs px-2 py-0.5">
                          {liveCount}
                        </Badge>
                      )}
                      {upcomingCount > 0 && (
                        <Badge className="bg-blue-600 text-white text-xs px-2 py-0.5">
                          {upcomingCount}
                        </Badge>
                      )}
                    </div>
                  )}
                </Button>
              );
            })}
        </div>
      </div>
      
      {/* Quick links footer */}
      <div className="mt-6 pt-4 border-t border-[#1e3a3f]">
        <div className="space-y-2 text-xs text-cyan-400/70">
          <p>Join Telegram</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-cyan-300 hover:text-cyan-100 text-xs"
            onClick={() => window.open('https://t.me/Sui_Bets', '_blank')}
          >
            🌐 t.me/Sui_Bets
          </Button>
        </div>
      </div>
    </div>
  );
}
