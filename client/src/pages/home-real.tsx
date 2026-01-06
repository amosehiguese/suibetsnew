import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import Layout from '@/components/layout/Layout';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';
import { BetSlip } from '@/components/betting/BetSlip';
import { useBetting } from '@/context/BettingContext';
import SportsSidebar from '@/components/layout/SportsSidebar';
import { Clock, Calendar, Plus, Minus } from 'lucide-react';
import { BettingButton } from '@/components/betting/BettingButton';

/**
 * Home page that displays featured events across various sports using HTML/CSS components
 */
export default function HomeReal() {
  const [, setLocation] = useLocation();
  const { addBet } = useBetting();
  
  // Fetch upcoming events with optimized caching to prevent flickering
  const { data: upcomingEvents = [], isLoading: upcomingEventsLoading } = useQuery({
    queryKey: ['/api/events', { type: 'upcoming' }],
    queryFn: async () => {
      console.log('Fetching upcoming events from API');
      try {
        const response = await apiRequest('GET', '/api/events', undefined, { timeout: 20000 });
        if (!response.ok) {
          console.warn(`Server error ${response.status} from ${response.url}`);
          return []; // Return empty array on error
        }
        const data = await response.json();
        console.log(`Received ${data.length} events, filtering for upcoming events`);
        
        // Make sure the data is valid before filtering
        if (!Array.isArray(data)) {
          console.warn('Received non-array data for upcoming events');
          return [];
        }
        
        // Filter events and ensure each has required properties
        return data
          .filter((event: any) => event.status === 'upcoming' || event.status === 'scheduled')
          .map((event: any) => ({
            ...event,
            // Ensure minimum required properties
            homeTeam: event.homeTeam || 'Team A',
            awayTeam: event.awayTeam || 'Team B',
            name: event.name || `${event.homeTeam || 'Team A'} vs ${event.awayTeam || 'Team B'}`,
            markets: Array.isArray(event.markets) ? event.markets : []
          }));
      } catch (error) {
        console.warn(`Error fetching upcoming events: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return []; // Return empty array on error
      }
    },
    staleTime: 60000, // Data stays fresh for 60 seconds (prevents refetch flicker)
    gcTime: 300000, // Keep in cache for 5 minutes
    refetchInterval: 60000, // Refetch every 60 seconds (was 30s)
    refetchOnWindowFocus: false, // Prevent refetch when switching tabs
    retry: 2,
    retryDelay: 1000
  });
  
  // Only fetch authentic live events - no fallback data
  async function fetchAuthenticLiveEvents(): Promise<any[]> {
    try {
      console.log('Fetching authentic live events from ESPN API');
      const response = await fetch('/api/events/live', {
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        console.warn(`Live events API failed with status ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        console.warn('Live events API did not return an array');
        return [];
      }
      
      console.log(`Received ${data.length} authentic live events from ESPN`);
      return data.filter(event => 
        event && 
        event.homeTeam && 
        event.awayTeam &&
        event.status !== 'postponed' &&
        event.status !== 'cancelled'
      );
    } catch (error) {
      console.warn('Error fetching authentic live events:', error);
      return [];
    }
  }

  // Fetch live events using the optimized lite endpoint
  const { data: liveEvents = [], isLoading: liveEventsLoading, error: liveEventsError } = useQuery({
    queryKey: ['/api/events/live-lite'],
    queryFn: async () => {
      console.log('Fetching live events from lite API for homepage');
      try {
        // Use direct fetch for more control over the response
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
        
        try {
          // Use direct fetch for better control
          const response = await fetch('/api/events/live-lite', {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
              'Cache-Control': 'no-cache'
            }
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            return [];
          }
          
          // Get response as text first
          const responseText = await response.text();
          
          // Strict validation to ensure it's a JSON array format
          if (!responseText.trim().startsWith('[') || !responseText.trim().endsWith(']')) {
            return [];
          }
          
          try {
            // Parse the text response
            const data = JSON.parse(responseText);
            
            // Double-check it's an array
            if (!Array.isArray(data)) {
              return [];
            }
            
            console.log(`Received ${data.length} lite live events for homepage`);
            
            // Filter for valid events with required properties
            const validEvents = data
              .filter((event: any) => 
                event && 
                typeof event === 'object' && 
                (event.id || event.eventId) && 
                (event.homeTeam || event.awayTeam || event.home || event.away || event.team1 || event.team2)
              )
              .map((event: any) => ({
                ...event,
                // Ensure minimum required properties
                homeTeam: event.homeTeam || event.home || event.team1 || 'Team A',
                awayTeam: event.awayTeam || event.away || event.team2 || 'Team B',
                name: event.name || `${event.homeTeam || event.home || event.team1 || 'Team A'} vs ${event.awayTeam || event.away || event.team2 || 'Team B'}`,
                markets: Array.isArray(event.markets) ? event.markets : []
              }));
            
            return validEvents;
          } catch (jsonError) {
            return [];
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          return [];
        }
      } catch (error) {
        console.warn(`Error in lite events query: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return []; // Return empty array on error to avoid breaking the UI
      }
    },
    staleTime: 10000, // Data stays fresh for 10 seconds (prevents flicker)
    gcTime: 120000, // Keep in cache for 2 minutes
    refetchInterval: 20000, // Refresh every 20 seconds for live (was 15s)
    refetchOnWindowFocus: false, // Prevent refetch when switching tabs
    retry: 1,       // Minimal retries for faster recovery
    retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 3000) // Progressive delay
  });
  
  // Fetch sports for the sidebar
  const { data: sports = [] } = useQuery({
    queryKey: ['/api/sports'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/sports');
      return response.json();
    }
  });
  
  // Handle bet selection
  const handleBetSelection = (event: any, market: any, outcome: any) => {
    const betId = `${event.id}-${market.id}-${outcome.id}`;
    
    addBet({
      id: betId,
      eventId: event.id,
      eventName: event.name || `${event.homeTeam} vs ${event.awayTeam}`,
      selectionName: outcome.name,
      odds: outcome.odds,
      stake: 10, // Default stake
      market: market.name,
      isLive: event.status === 'live'
    });
  };
  
  // Navigate to a sport page
  const navigateToSport = (sportSlug: string) => {
    setLocation(`/sport/${sportSlug}`);
  };
  
  // Log the events for debugging
  console.log('Loaded events for display:', upcomingEvents.length);
  
  return (
    <Layout>
      <div className="flex min-h-screen bg-[#0a0e14]">
        {/* Left sidebar */}
        <div className="w-64 bg-[#061118] border-r border-[#1e3a3f] min-h-screen">
          <SportsSidebar />
        </div>
        
        {/* Main content */}
        <div className="flex-1 p-4">
          {/* Featured Content Section */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-4">
              <h1 className="premium-header">Featured Events</h1>
              <button 
                className="neon-btn-cyan text-sm"
                onClick={() => setLocation('/live-real')}
              >
                ⚡ View All Live
              </button>
            </div>
            
            {/* Featured Live Events */}
            {(liveEvents.length > 0 || liveEventsLoading) && (
              <div className="mb-8 slide-down">
                <h2 className="premium-subheader mb-6 flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-gradient-to-r from-red-500 to-pink-500 mr-2 animate-pulse shadow-lg shadow-red-500/50"></div>
                  LIVE MATCHES
                  <span className="text-xs font-semibold bg-red-500/30 text-red-300 px-3 py-1 rounded-full">NOW</span>
                </h2>
                
                <div className="grid-responsive">
                  {liveEvents.slice(0, 9).map((event: any) => (
                    <div key={event.id} className="neon-card">
                      {/* Sport and Live indicator */}
                      <div className="px-3 py-2 flex justify-between items-center bg-[#061118] border-b border-[#1e3a3f]">
                        <div className="flex items-center space-x-2">
                          <span className="inline-block w-2 h-2 bg-red-600 rounded-full animate-pulse"></span>
                          <span className="text-xs font-bold text-red-500">LIVE</span>
                        </div>
                        <div className="text-xs text-right text-gray-400">
                          {sports.find((s: any) => s.id === event.sportId)?.name || 'Sport'}
                        </div>
                      </div>
                      
                      {/* Team names with neon scores */}
                      <div className="px-4 py-3 bg-gradient-to-b from-slate-900/50 to-blue-900/30">
                        <div className="grid grid-cols-1 gap-2">
                          <div className="flex items-center justify-between">
                            <div className="text-white font-bold truncate max-w-[70%]">{event.homeTeam}</div>
                            <div className="odds-value text-lg">{
                              typeof event.score === 'string' ? event.score.split(' - ')[0] : 
                              event.score?.home || event.homeScore || "0"
                            }</div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-white font-bold truncate max-w-[70%]">{event.awayTeam}</div>
                            <div className="odds-value text-lg">{
                              typeof event.score === 'string' ? event.score.split(' - ')[1] : 
                              event.score?.away || event.awayScore || "0"
                            }</div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Betting options with better visibility and consistent sizing */}
                      <div className="p-0 m-0 bg-[#0a0e14]">
                        <div className="flex w-full my-0">
                        {event.markets && event.markets[0]?.outcomes ? (
                          event.markets[0].outcomes.map((outcome: any, idx: number) => (
                            <BettingButton
                              key={outcome.id || idx}
                              name={outcome.name.length > 8 ? outcome.name.substring(0, 8) + '.' : outcome.name}
                              odds={outcome.odds}
                              onClick={() => handleBetSelection(event, event.markets[0], outcome)}
                            />
                          ))
                        ) : (
                          <>
                            <BettingButton
                              name="1"
                              odds={2.10}
                              onClick={() => {
                                const fakeOutcome = {id: `home-${event.id}`, name: "1", odds: 2.10};
                                handleBetSelection(event, {id: event.id, name: "Match Result"}, fakeOutcome);
                              }}
                            />
                            <BettingButton
                              name="X"
                              odds={3.25}
                              onClick={() => {
                                const fakeOutcome = {id: `draw-${event.id}`, name: "X", odds: 3.25};
                                handleBetSelection(event, {id: event.id, name: "Match Result"}, fakeOutcome);
                              }}
                            />
                            <BettingButton
                              name="2"
                              odds={3.40}
                              onClick={() => {
                                const fakeOutcome = {id: `away-${event.id}`, name: "2", odds: 3.40};
                                handleBetSelection(event, {id: event.id, name: "Match Result"}, fakeOutcome);
                              }}
                            />
                          </>
                        )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Upcoming Events By Sport */}
            <div>
              <h2 className="text-xl font-semibold text-white mb-4">Popular Events</h2>
              
              {upcomingEventsLoading ? (
                <div className="flex justify-center items-center h-40">
                  <div className="animate-spin w-8 h-8 border-4 border-[#00ffff] border-t-transparent rounded-full"></div>
                </div>
              ) : upcomingEvents.length > 0 ? (
                <div className="space-y-6">
                  {/* Group events by sport */}
                  {sports.slice(0, 3).map((sport: any) => {
                    const sportEvents = upcomingEvents.filter((event: any) => event.sportId === sport.id);
                    if (sportEvents.length === 0) return null;
                    
                    return (
                      <div key={sport.id} className="border border-[#1e3a3f] rounded-md overflow-hidden">
                        <div className="bg-[#061118] px-4 py-3 flex justify-between items-center">
                          <h3 className="font-semibold text-white">{sport.name}</h3>
                          <Button 
                            variant="link" 
                            className="text-[#00ffff] px-0 hover:text-[#00d8d8]"
                            onClick={(e) => {
                              e.preventDefault(); 
                              // This will just be a button to see more events
                              // We're NOT navigating to a different page
                            }}
                          >
                            See More
                          </Button>
                        </div>
                        
                        <div className="divide-y divide-[#1e3a3f]">
                          {sportEvents.slice(0, 3).map((event: any) => (
                            <div key={event.id} className="bg-[#061118] border-b border-[#1e3a3f] hover:bg-[#0b1618]">
                              {/* Header with time and league */}
                              <div className="px-3 py-2 flex justify-between items-center bg-[#061118] border-b border-[#1e3a3f]">
                                <div className="flex items-center space-x-2">
                                  <span className="text-xs font-medium text-cyan-300">
                                    {format(new Date(event.startTime), 'dd MMM HH:mm')}
                                  </span>
                                </div>
                                <div className="text-xs text-right text-gray-400">
                                  {event.leagueName || sport.name}
                                </div>
                              </div>
                              
                              {/* Team names with FULL visibility */}
                              <div className="px-3 py-0 bg-[#0a0e14]">
                                <div className="grid grid-cols-1 gap-0">
                                  <div className="w-full h-5">
                                    <div className="text-white text-xs font-semibold truncate max-w-[90%]">{event.homeTeam}</div>
                                  </div>
                                  <div className="w-full h-5">
                                    <div className="text-white text-xs font-semibold truncate max-w-[90%]">{event.awayTeam}</div>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Betting options with better visibility and sizing */}
                              <div className="p-0 m-0 bg-[#0a0e14]">
                                <div className="flex w-full my-0">
                                {event.markets && event.markets[0]?.outcomes ? (
                                  event.markets[0].outcomes.map((outcome: any, idx: number) => (
                                    <BettingButton
                                      key={outcome.id || idx}
                                      name={outcome.name.length > 8 ? outcome.name.substring(0, 8) + '.' : outcome.name}
                                      odds={outcome.odds}
                                      onClick={() => handleBetSelection(event, event.markets[0], outcome)}
                                    />
                                  ))
                                ) : (
                                  <>
                                    <BettingButton
                                      name="1"
                                      odds={2.10}
                                      onClick={() => {
                                        const fakeOutcome = {id: `home-${event.id}`, name: "1", odds: 2.10};
                                        handleBetSelection(event, {id: event.id, name: "Match Result"}, fakeOutcome);
                                      }}
                                    />
                                    <BettingButton
                                      name="X"
                                      odds={3.25}
                                      onClick={() => {
                                        const fakeOutcome = {id: `draw-${event.id}`, name: "X", odds: 3.25};
                                        handleBetSelection(event, {id: event.id, name: "Match Result"}, fakeOutcome);
                                      }}
                                    />
                                    <BettingButton
                                      name="2"
                                      odds={3.40}
                                      onClick={() => {
                                        const fakeOutcome = {id: `away-${event.id}`, name: "2", odds: 3.40};
                                        handleBetSelection(event, {id: event.id, name: "Match Result"}, fakeOutcome);
                                      }}
                                    />
                                  </>
                                )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500">
                  No upcoming events found.
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Right sidebar with bet slip */}
        <div className="w-80 bg-[#061118] border-l border-[#1e3a3f] p-4 flex flex-col gap-4">
          {/* Bet Slip */}
          <BetSlip />
        </div>
      </div>
    </Layout>
  );
}