import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { Clock, Calendar, Filter, ChevronRight } from 'lucide-react';
import SimpleMarkets from '@/components/betting/SimpleMarkets';

export default function UpcomingEventsPage() {
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<string>('all');

  // Fetch upcoming events
  const { data: upcomingEvents = [], isLoading: upcomingLoading } = useQuery({
    queryKey: ['/api/events/upcoming', selectedSport],
    queryFn: async () => {
      const url = selectedSport === 'all' 
        ? '/api/events' 
        : `/api/events?sportId=${selectedSport}`;
      
      const response = await apiRequest('GET', url);
      if (!response.ok) throw new Error('Failed to fetch upcoming events');
      
      const data = await response.json();
      return Array.isArray(data) ? data.filter(event => !event.isLive) : [];
    },
    refetchInterval: 30000, // Refresh every 30 seconds for upcoming
  });

  // Get unique sports from events
  const availableSports = [
    { id: 'all', name: 'All Sports' },
    ...Array.from(new Set(upcomingEvents.map(event => event.sportId)))
      .map(sportId => ({
        id: sportId.toString(),
        name: getSportName(sportId)
      }))
  ];

  function getSportName(sportId: number): string {
    const sportNames: Record<number, string> = {
      1: 'Football',
      2: 'Basketball', 
      3: 'Tennis',
      4: 'Baseball',
      5: 'Hockey',
      6: 'Handball',
      7: 'Volleyball',
      8: 'Rugby',
      9: 'Cricket',
      10: 'Golf',
      11: 'Boxing',
      12: 'MMA',
      13: 'Formula 1',
      14: 'Cycling',
      15: 'American Football',
      20: 'WWE Entertainment',
      26: 'Soccer'
    };
    return sportNames[sportId] || `Sport ${sportId}`;
  }

  function getTimeFromNow(startTime: string): string {
    const now = new Date();
    const eventTime = new Date(startTime);
    const diffMs = eventTime.getTime() - now.getTime();
    
    if (diffMs < 0) return 'Started';
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
      return `${diffDays}d ${diffHours % 24}h`;
    } else if (diffHours > 0) {
      return `${diffHours}h ${Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))}m`;
    } else {
      return `${Math.floor(diffMs / (1000 * 60))}m`;
    }
  }

  function filterEventsByTime(events: any[]) {
    if (timeFilter === 'all') return events;
    
    const now = new Date();
    const filtered = events.filter(event => {
      const eventTime = new Date(event.startTime);
      const diffHours = (eventTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      switch (timeFilter) {
        case 'today':
          return diffHours <= 24;
        case 'tomorrow':
          return diffHours > 24 && diffHours <= 48;
        case 'week':
          return diffHours <= 168; // 7 days
        default:
          return true;
      }
    });
    
    return filtered;
  }

  const filteredEvents = filterEventsByTime(
    selectedSport === 'all' 
      ? upcomingEvents 
      : upcomingEvents.filter(event => event.sportId.toString() === selectedSport)
  );

  return (
    <Layout title="Upcoming Events">
      <div className="min-h-screen bg-[#0b1618] text-white py-6">
        <div className="container mx-auto px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Calendar className="h-8 w-8 text-cyan-400" />
              <div>
                <h1 className="text-3xl font-bold text-cyan-400">Upcoming Events</h1>
                <p className="text-gray-400">Scheduled sporting events available for betting</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="border-cyan-400 text-cyan-400">
                <Clock className="h-3 w-3 mr-1" />
                {filteredEvents.length} events
              </Badge>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Sports Filter */}
            <Card className="bg-[#112225] border-[#1e3a3f]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-cyan-300">
                  <Filter className="h-5 w-5 mr-2" />
                  Filter by Sport
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {availableSports.map((sport) => (
                    <Button
                      key={sport.id}
                      variant={selectedSport === sport.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedSport(sport.id)}
                      className={`${
                        selectedSport === sport.id 
                          ? 'bg-cyan-600 text-white' 
                          : 'border-[#1e3a3f] text-gray-300 hover:border-cyan-400 hover:text-cyan-400'
                      }`}
                    >
                      {sport.name}
                      {sport.id !== 'all' && (
                        <Badge variant="secondary" className="ml-2 bg-[#1e3a3f]">
                          {upcomingEvents.filter(e => e.sportId.toString() === sport.id).length}
                        </Badge>
                      )}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Time Filter */}
            <Card className="bg-[#112225] border-[#1e3a3f]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-cyan-300">
                  <Clock className="h-5 w-5 mr-2" />
                  Filter by Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'all', name: 'All Time' },
                    { id: 'today', name: 'Today' },
                    { id: 'tomorrow', name: 'Tomorrow' },
                    { id: 'week', name: 'This Week' }
                  ].map((filter) => (
                    <Button
                      key={filter.id}
                      variant={timeFilter === filter.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTimeFilter(filter.id)}
                      className={`${
                        timeFilter === filter.id 
                          ? 'bg-cyan-600 text-white' 
                          : 'border-[#1e3a3f] text-gray-300 hover:border-cyan-400 hover:text-cyan-400'
                      }`}
                    >
                      {filter.name}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Loading State */}
          {upcomingLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="bg-[#112225] border-[#1e3a3f] animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-4 bg-[#1e3a3f] rounded mb-4"></div>
                    <div className="h-8 bg-[#1e3a3f] rounded mb-2"></div>
                    <div className="h-6 bg-[#1e3a3f] rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Upcoming Events Grid */}
          {!upcomingLoading && filteredEvents.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredEvents.map((event) => (
                <Card key={event.id} className="bg-[#112225] border-[#1e3a3f] hover:border-cyan-400/50 transition-colors">
                  <CardHeader className="border-b border-[#1e3a3f]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline" className="border-cyan-400 text-cyan-400">
                          <Clock className="h-3 w-3 mr-1" />
                          {getTimeFromNow(event.startTime)}
                        </Badge>
                        <span className="text-sm text-gray-400">
                          {getSportName(event.sportId)}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </div>
                    
                    <CardTitle className="text-white text-lg">
                      {event.homeTeam} vs {event.awayTeam}
                    </CardTitle>
                    
                    <div className="flex items-center justify-between text-sm">
                      {event.league && (
                        <span className="text-gray-400">{event.league}</span>
                      )}
                      <div className="flex items-center space-x-3">
                        <span className="text-gray-500 text-xs">ID:{event.id}</span>
                        <span className="text-cyan-400">
                          {new Date(event.startTime).toLocaleDateString()} {new Date(event.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="p-4">
                    {/* Event Info */}
                    <div className="mb-4 p-3 bg-[#0b1618] rounded border border-[#1e3a3f]">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-lg font-bold text-cyan-400">
                            {event.homeTeam}
                          </div>
                          <div className="text-xs text-gray-400">Home</div>
                        </div>
                        <div>
                          <div className="text-cyan-400 font-bold">VS</div>
                          <div className="text-xs text-gray-400">
                            {getTimeFromNow(event.startTime)}
                          </div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-cyan-400">
                            {event.awayTeam}
                          </div>
                          <div className="text-xs text-gray-400">Away</div>
                        </div>
                      </div>
                    </div>

                    {/* Pre-match Betting Markets */}
                    <SimpleMarkets
                      event={event}
                      eventId={event.id}
                      sportType={getSportName(event.sportId).toLowerCase()}
                      isLive={false}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* No Upcoming Events */}
          {!upcomingLoading && filteredEvents.length === 0 && (
            <Card className="bg-[#112225] border-[#1e3a3f] text-center py-12">
              <CardContent>
                <Calendar className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-400 mb-2">
                  No Upcoming Events
                </h3>
                <p className="text-gray-500 mb-6">
                  {selectedSport === 'all' 
                    ? `No upcoming events for the selected time period.`
                    : `No upcoming ${availableSports.find(s => s.id === selectedSport)?.name} events for the selected time period.`
                  }
                </p>
                <div className="flex justify-center space-x-4">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setSelectedSport('all');
                      setTimeFilter('all');
                    }}
                    className="border-[#1e3a3f] text-cyan-400 hover:border-cyan-400"
                  >
                    Clear Filters
                  </Button>
                  <Button 
                    onClick={() => window.location.reload()}
                    className="bg-cyan-600 hover:bg-cyan-700"
                  >
                    Refresh Events
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}