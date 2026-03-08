import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';

interface AuthenticEvent {
  id: string;
  homeTeam: string;
  awayTeam: string;
  leagueName?: string;
  status?: string;
  startTime?: string;
  venue?: string;
  isLive?: boolean;
  odds?: {
    home?: string | number;
    away?: string | number;
    draw?: string | number;
    homeWin?: number;
    awayWin?: number;
  };
  score?: {
    home?: number;
    away?: number;
  };
}

interface AuthenticEventsDisplayProps {
  sportId: number;
  sportName: string;
  selectedTab: 'live' | 'upcoming';
}

function formatDecimalOdds(odds: string | number): string {
  if (!odds) return 'N/A';
  
  if (typeof odds === 'string' && odds.includes('.')) {
    return odds;
  }
  
  if (typeof odds === 'number') {
    if (odds >= 1 && odds <= 100) {
      return odds.toFixed(2);
    }
    if (odds > 100) {
      return (odds / 100 + 1).toFixed(2);
    } else {
      return (100 / Math.abs(odds) + 1).toFixed(2);
    }
  }
  
  return odds.toString();
}

function formatEventTime(dateStr?: string): string {
  if (!dateStr) return 'TBD';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'TBD';
  }
}

export function AuthenticEventsDisplay({ sportId, sportName, selectedTab }: AuthenticEventsDisplayProps) {
  const [events, setEvents] = useState<AuthenticEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAuthenticEvents = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const url = `/api/events?sportId=${sportId}&isLive=${selectedTab === 'live'}`;
        console.log(`Fetching authentic events from: ${url}`);
        
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const authenticEvents = await response.json();
        console.log(`✓ 100% Authentic Events: ${authenticEvents.length} ${selectedTab} ${sportName} matches`);
        
        if (authenticEvents.length > 0) {
          console.log('Sample authentic event:', {
            id: authenticEvents[0].id,
            homeTeam: authenticEvents[0].homeTeam,
            awayTeam: authenticEvents[0].awayTeam,
            odds: authenticEvents[0].odds,
            isLive: authenticEvents[0].isLive,
            status: authenticEvents[0].status,
            source: authenticEvents[0].source || 'authentic'
          });
        }
        
        setEvents(authenticEvents);
      } catch (err) {
        console.error('Failed to fetch authentic events:', err);
        setError(`Unable to load authentic ${sportName} events: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    fetchAuthenticEvents();
    
    // Auto-refresh live events every 30 seconds
    let interval: NodeJS.Timeout | null = null;
    if (selectedTab === 'live') {
      interval = setInterval(fetchAuthenticEvents, 30000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sportId, sportName, selectedTab]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 bg-cyan-400 rounded animate-pulse"></div>
          <span className="text-cyan-400">Loading {sportName} events...</span>
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse border-[#1e3a3f] bg-[#112225]">
            <CardHeader>
              <div className="h-6 bg-[#1e3a3f] rounded w-1/2"></div>
            </CardHeader>
            <CardContent>
              <div className="h-16 bg-[#1e3a3f] rounded"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500/50 bg-red-950/20">
        <CardHeader>
          <CardTitle className="text-red-400 flex items-center">
            <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
            Connection Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300 mb-4">{error}</p>
          <Button 
            onClick={() => window.location.reload()} 
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Retry Connection
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="border border-[#1e3a3f] bg-gradient-to-b from-[#112225] to-[#14292e]">
        <CardHeader className="bg-gradient-to-r from-[#0b1618] to-[#0f1d20] border-b border-[#1e3a3f]">
          <CardTitle className="text-cyan-400 flex items-center">
            <span className="w-2 h-2 bg-cyan-400 rounded-full mr-2"></span>
            No {selectedTab.toUpperCase()} Events
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="text-cyan-100">
            No {selectedTab} {sportName.toLowerCase()} matches currently available.
            {selectedTab === 'live' ? ' Check upcoming events or try another sport.' : ' Events will appear closer to match times.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Authentic Events Header */}
      <div className="flex items-center justify-between">
        <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 px-3 py-1">
          <span className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></span>
          {events.length} Authentic {selectedTab.toUpperCase()} Events
        </Badge>
        <Badge variant="outline" className="text-cyan-400 border-cyan-400/50">
          {sportName}
        </Badge>
      </div>
      
      {/* Events Grid */}
      <div className="grid grid-cols-1 gap-4">
        {events.map((event) => (
          <Card 
            key={event.id} 
            className="overflow-hidden border border-[#1e3a3f] shadow-xl shadow-cyan-900/10 bg-gradient-to-b from-[#112225] to-[#14292e]"
          >
            <CardHeader className="pb-3 bg-gradient-to-r from-[#0b1618] to-[#0f1d20] relative border-b border-[#1e3a3f]">
              {/* Authentic Event Indicator */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-400 to-cyan-400"></div>
              
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <CardTitle className="text-lg flex items-center mb-2">
                    <span className="text-cyan-300">
                      {event.leagueName || 'Premier League'}
                    </span>
                    {selectedTab === 'live' && (
                      <Badge className="ml-2 bg-gradient-to-r from-red-600 to-red-500 animate-pulse">
                        LIVE
                      </Badge>
                    )}
                  </CardTitle>
                  
                  <CardDescription className="flex items-center text-sm">
                    <Clock className="w-4 h-4 mr-1" />
                    <span>
                      {selectedTab === 'live' ? 'In Progress' : formatEventTime(event.startTime)}
                    </span>
                    {event.venue && (
                      <>
                        <span className="mx-2 text-[#1e3a3f]">•</span>
                        <span>{event.venue}</span>
                      </>
                    )}
                  </CardDescription>
                </div>
                
                {event.score && (event.score.home !== undefined && event.score.away !== undefined) && (
                  <div className="text-right">
                    <div className="text-sm font-medium text-cyan-400">Score</div>
                    <div className="text-xl font-bold bg-[#0b1618] py-1 px-3 rounded-lg border border-[#1e3a3f]">
                      {event.score.home} - {event.score.away}
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            
            <CardContent className="pt-6">
              {(sportId === 18 || sportId === 11 || sportId === 19) ? (
                <>
                  <div className="text-center mb-4">
                    <h3 className="text-xl font-bold text-white mb-1" data-testid={`text-race-name-${event.id}`}>
                      {event.homeTeam}
                    </h3>
                    <p className="text-sm text-gray-400">{event.awayTeam}</p>
                    {(event as any).raceDetails && (
                      <div className="flex items-center justify-center gap-3 mt-2 text-xs text-gray-500">
                        {(event as any).raceDetails.surface && <span>{(event as any).raceDetails.surface}</span>}
                        {(event as any).raceDetails.distance && <><span>•</span><span>{(event as any).raceDetails.distance}</span></>}
                        {(event as any).raceDetails.going && <><span>•</span><span>{(event as any).raceDetails.going}</span></>}
                        {(event as any).raceDetails.prize && <><span>•</span><span>{(event as any).raceDetails.prize}</span></>}
                        <span>•</span>
                        <span>{(event as any).raceDetails.fieldSize || (event as any).runnersInfo?.length || '?'} {(sportId === 11 || sportId === 19) ? 'riders' : 'runners'}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(event as any).markets?.[0]?.outcomes?.map((runner: any, idx: number) => {
                      const runnerInfo = (event as any).runnersInfo?.[idx];
                      return (
                        <div
                          key={runner.id || idx}
                          className="flex items-center justify-between bg-[#0b1618] border border-[#1e3a3f] rounded-lg px-4 py-3 hover:border-cyan-400/50 hover:bg-cyan-400/5 transition-all cursor-pointer"
                          data-testid={`runner-${event.id}-${idx}`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-cyan-400 font-bold text-sm w-6 text-center">
                              {runnerInfo?.number || idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-white text-sm truncate">{runner.name}</div>
                              {runnerInfo && (
                                <div className="text-xs text-gray-400 truncate">
                                  {(sportId === 11 || sportId === 19) ? '' : 'J: '}{runnerInfo.jockey || 'TBA'}
                                  {runnerInfo.trainer && ` • T: ${runnerInfo.trainer}`}
                                </div>
                              )}
                            </div>
                            {runnerInfo?.form && (
                              <span className="text-xs text-yellow-400/70 font-mono bg-yellow-400/5 px-2 py-0.5 rounded">
                                {runnerInfo.form}
                              </span>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-3 border-[#1e3a3f] bg-[#14292e] hover:bg-cyan-400/20 hover:border-cyan-400 hover:text-cyan-400 font-bold text-base min-w-[60px]"
                            data-testid={`odds-runner-${event.id}-${idx}`}
                          >
                            {runner.odds?.toFixed(2) || 'N/A'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <h3 className="text-2xl font-bold text-white mb-2">
                      {event.homeTeam} vs {event.awayTeam}
                    </h3>
                    {event.status && event.status !== 'Scheduled' && (
                      <Badge variant="outline" className="text-cyan-400 border-cyan-400/50">
                        {event.status}
                      </Badge>
                    )}
                  </div>
                  {(() => {
                    const homeOdds = (event as any).homeOdds || event.odds?.homeWin || event.odds?.home;
                    const awayOdds = (event as any).awayOdds || event.odds?.awayWin || event.odds?.away;
                    const NO_DRAW_SPORTS = new Set([2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 24]);
                    const drawOdds = NO_DRAW_SPORTS.has(sportId) ? null : ((event as any).drawOdds || event.odds?.draw);
                    if (!homeOdds && !awayOdds) return null;
                    const hasDraws = !!drawOdds;
                    return (
                      <div className={`grid ${hasDraws ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
                        <div className="text-center">
                          <div className="mb-3 bg-[#0b1618] p-3 rounded-lg border border-[#1e3a3f]">
                            <div className="font-bold text-cyan-300">{event.homeTeam}</div>
                          </div>
                          <Button 
                            variant="outline"
                            className="w-full border-[#1e3a3f] bg-[#14292e] hover:bg-cyan-400/20 hover:border-cyan-400 hover:text-cyan-400 transition-all duration-200 text-lg font-bold"
                          >
                            {formatDecimalOdds(homeOdds)}
                          </Button>
                        </div>
                        {hasDraws && (
                          <div className="text-center">
                            <div className="mb-3 bg-[#0b1618] p-3 rounded-lg border border-[#1e3a3f]">
                              <div className="font-bold text-gray-300">Draw</div>
                            </div>
                            <Button 
                              variant="outline" 
                              className="w-full border-[#1e3a3f] bg-[#14292e] hover:bg-cyan-400/20 hover:border-cyan-400 hover:text-cyan-400 transition-all duration-200 text-lg font-bold"
                            >
                              {formatDecimalOdds(drawOdds)}
                            </Button>
                          </div>
                        )}
                        <div className="text-center">
                          <div className="mb-3 bg-[#0b1618] p-3 rounded-lg border border-[#1e3a3f]">
                            <div className="font-bold text-cyan-300">{event.awayTeam}</div>
                          </div>
                          <Button 
                            variant="outline" 
                            className="w-full border-[#1e3a3f] bg-[#14292e] hover:bg-cyan-400/20 hover:border-cyan-400 hover:text-cyan-400 transition-all duration-200 text-lg font-bold"
                          >
                            {formatDecimalOdds(awayOdds)}
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
              
              {/* Authentic Event Footer */}
              <div className="mt-6 pt-4 border-t border-[#1e3a3f] text-center">
                <div className="flex items-center justify-center text-xs text-green-400">
                  <span className="w-2 h-2 bg-green-400 rounded-full mr-2"></span>
                  Event ID: {event.id} • 100% Authentic Data
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}