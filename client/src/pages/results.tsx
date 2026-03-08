import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/layout/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';
import { Trophy, Calendar, Search, Filter, CheckCircle } from 'lucide-react';

export default function ResultsPage() {
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('week');

  // Fetch completed events/results from settled_events table
  const { data: results = [], isLoading, error } = useQuery({
    queryKey: ['/api/events/results', selectedSport, dateFilter],
    queryFn: async () => {
      try {
        // Fetch from the dedicated results endpoint with actual scores
        const response = await apiRequest('GET', `/api/events/results?period=${dateFilter}`);
        if (!response.ok) {
          throw new Error('Failed to fetch results');
        }
        
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (err) {
        console.error('Error fetching results:', err);
        return [];
      }
    },
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  // Show error if needed
  if (error) {
    console.warn('Results page error:', error);
  }

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

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  }

  function getWinner(event: any): string {
    // Handle various score field names from different APIs
    const homeScore = parseInt(event.homeScore || event.homeTeamScore || event.score?.home || '0') || 0;
    const awayScore = parseInt(event.awayScore || event.awayTeamScore || event.score?.away || '0') || 0;
    
    if (homeScore === 0 && awayScore === 0) return 'TBD';
    
    if (homeScore > awayScore) return event.homeTeam;
    if (awayScore > homeScore) return event.awayTeam;
    return 'Draw';
  }

  function getScoreDisplay(event: any): string {
    const homeScore = event.homeScore || event.homeTeamScore || event.score?.home || '-';
    const awayScore = event.awayScore || event.awayTeamScore || event.score?.away || '-';
    return `${homeScore} - ${awayScore}`;
  }

  // Get unique sports from results
  const availableSports = [
    { id: 'all', name: 'All Sports' },
    ...Array.from(new Set(results.map(event => event.sportId)))
      .map(sportId => ({
        id: sportId.toString(),
        name: getSportName(sportId)
      }))
  ];

  // Filter results
  const filteredResults = results.filter(event => {
    const matchesSport = selectedSport === 'all' || event.sportId.toString() === selectedSport;
    const matchesSearch = searchTerm === '' || 
      event.homeTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.awayTeam.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (event.league && event.league.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesSport && matchesSearch;
  });

  return (
    <Layout title="Results">
      <div className="min-h-screen bg-[#0b1618] text-white py-6">
        <div className="container mx-auto px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Trophy className="h-8 w-8 text-yellow-500" />
              <div>
                <h1 className="text-3xl font-bold text-cyan-400">Match Results</h1>
                <p className="text-gray-400">Completed sporting events and final scores</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                {filteredResults.length} results
              </Badge>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* Sports Filter */}
            <Card className="bg-[#112225] border-[#1e3a3f]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-cyan-300">
                  <Filter className="h-5 w-5 mr-2" />
                  Sport
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {availableSports.slice(0, 5).map((sport) => (
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
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Date Filter */}
            <Card className="bg-[#112225] border-[#1e3a3f]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-cyan-300">
                  <Calendar className="h-5 w-5 mr-2" />
                  Time Period
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'today', name: 'Today' },
                    { id: 'week', name: 'This Week' },
                    { id: 'month', name: 'This Month' }
                  ].map((filter) => (
                    <Button
                      key={filter.id}
                      variant={dateFilter === filter.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setDateFilter(filter.id)}
                      className={`${
                        dateFilter === filter.id 
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

            {/* Search */}
            <Card className="bg-[#112225] border-[#1e3a3f]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-cyan-300">
                  <Search className="h-5 w-5 mr-2" />
                  Search
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search teams or leagues..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-[#0b1618] border-[#1e3a3f] text-white"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Loading State */}
          {isLoading && (
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

          {/* Results Grid */}
          {!isLoading && filteredResults.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredResults.map((result) => (
                <Card key={result.id} className="bg-[#112225] border-[#1e3a3f] hover:border-yellow-500/50 transition-colors">
                  <CardHeader className="border-b border-[#1e3a3f] pb-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Final
                      </Badge>
                      <span className="text-sm text-gray-400">
                        {getSportName(result.sportId)}
                      </span>
                    </div>
                    
                    <CardTitle className="text-white text-lg">
                      {result.homeTeam} vs {result.awayTeam}
                    </CardTitle>
                    
                    {result.league && (
                      <p className="text-sm text-gray-400">{result.league}</p>
                    )}
                  </CardHeader>
                  
                  <CardContent className="p-4">
                    {/* Final Score */}
                    <div className="mb-4 p-4 bg-[#0b1618] rounded border border-[#1e3a3f]">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className={`text-2xl font-bold ${
                            getWinner(result) === result.homeTeam ? 'text-green-400' : 'text-gray-400'
                          }`}>
                            {result.homeScore || 0}
                          </div>
                          <div className="text-sm text-gray-400">
                            {result.homeTeam}
                          </div>
                          {getWinner(result) === result.homeTeam && (
                            <Trophy className="h-4 w-4 text-yellow-500 mx-auto mt-1" />
                          )}
                        </div>
                        <div>
                          <div className="text-cyan-400 font-bold text-lg">
                            FINAL
                          </div>
                          <div className="text-xs text-gray-500">
                            {getWinner(result) === 'Draw' ? 'Draw' : 'Result'}
                          </div>
                        </div>
                        <div>
                          <div className={`text-2xl font-bold ${
                            getWinner(result) === result.awayTeam ? 'text-green-400' : 'text-gray-400'
                          }`}>
                            {result.awayScore || 0}
                          </div>
                          <div className="text-sm text-gray-400">
                            {result.awayTeam}
                          </div>
                          {getWinner(result) === result.awayTeam && (
                            <Trophy className="h-4 w-4 text-yellow-500 mx-auto mt-1" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Match Info */}
                    <div className="text-xs text-gray-500 text-center">
                      Completed: {formatDate(result.startTime || result.endTime)}
                    </div>

                    {/* Winner Highlight */}
                    {getWinner(result) !== 'TBD' && getWinner(result) !== 'Draw' && (
                      <div className="mt-3 text-center">
                        <Badge className="bg-green-600 text-white">
                          <Trophy className="h-3 w-3 mr-1" />
                          Winner: {getWinner(result)}
                        </Badge>
                      </div>
                    )}
                    
                    {getWinner(result) === 'Draw' && (
                      <div className="mt-3 text-center">
                        <Badge variant="outline" className="border-gray-500 text-gray-400">
                          Match Drawn
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* No Results */}
          {!isLoading && filteredResults.length === 0 && (
            <Card className="bg-[#112225] border-[#1e3a3f] text-center py-12">
              <CardContent>
                <Trophy className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-400 mb-2">
                  No Results Found
                </h3>
                <p className="text-gray-500 mb-6">
                  {searchTerm 
                    ? `No results found for "${searchTerm}"`
                    : 'No completed matches found for the selected filters.'
                  }
                </p>
                <div className="flex justify-center space-x-4">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setSelectedSport('all');
                      setSearchTerm('');
                      setDateFilter('week');
                    }}
                    className="border-[#1e3a3f] text-cyan-400 hover:border-cyan-400"
                  >
                    Clear Filters
                  </Button>
                  <Button 
                    onClick={() => window.location.reload()}
                    className="bg-cyan-600 hover:bg-cyan-700"
                  >
                    Refresh Results
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