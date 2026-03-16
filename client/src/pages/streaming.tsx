import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/layout/Layout';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, Tv, Radio, Eye, ArrowLeft, Monitor, Signal, Clock } from 'lucide-react';

interface StreamTeam {
  name: string;
  badge: string;
}

interface StreamSource {
  source: string;
  id: string;
}

interface StreamMatch {
  id: string;
  title: string;
  category: string;
  date: number;
  popular: boolean;
  teams: {
    home: StreamTeam;
    away: StreamTeam;
  };
  sources: StreamSource[];
}

interface StreamInfo {
  id: string;
  streamNo: number;
  language: string;
  hd: boolean;
  embedUrl: string;
  source: string;
  viewers: number;
}

type ViewMode = 'list' | 'watching';

export default function StreamingPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedMatch, setSelectedMatch] = useState<StreamMatch | null>(null);
  const [selectedStream, setSelectedStream] = useState<StreamInfo | null>(null);
  const [activeSourceIdx, setActiveSourceIdx] = useState(0);

  const { data: liveMatches = [], isLoading: loadingLive } = useQuery<StreamMatch[]>({
    queryKey: ['/api/streaming/football'],
    refetchInterval: 60000,
  });

  const currentSource = selectedMatch?.sources?.[activeSourceIdx];

  const { data: streams = [], isLoading: loadingStreams } = useQuery<StreamInfo[]>({
    queryKey: ['/api/streaming/stream', currentSource?.source, currentSource?.id],
    queryFn: async () => {
      if (!currentSource) return [];
      const res = await fetch(`/api/streaming/stream/${currentSource.source}/${currentSource.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentSource && viewMode === 'watching',
    refetchInterval: 120000,
  });

  useEffect(() => {
    if (streams.length > 0 && !selectedStream) {
      setSelectedStream(streams[0]);
    }
  }, [streams, selectedStream]);

  const handleWatchMatch = (match: StreamMatch) => {
    setSelectedMatch(match);
    setSelectedStream(null);
    setActiveSourceIdx(0);
    setViewMode('watching');
  };

  const handleBackToList = () => {
    setViewMode('list');
    setSelectedMatch(null);
    setSelectedStream(null);
    setActiveSourceIdx(0);
  };

  const isLive = (date: number) => {
    const now = Date.now();
    const diff = now - date;
    return diff >= 0 && diff < 3 * 60 * 60 * 1000;
  };

  const getMatchTime = (date: number) => {
    const now = Date.now();
    const diff = now - date;
    if (diff < 0) {
      return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    const mins = Math.floor(diff / 60000);
    if (mins > 90) return 'FT';
    if (mins > 45 && mins < 50) return 'HT';
    return `${mins}'`;
  };

  const liveNow = liveMatches.filter(m => isLive(m.date));
  const upcoming = liveMatches.filter(m => !isLive(m.date));

  if (viewMode === 'watching' && selectedMatch) {
    return (
      <Layout title="Streaming" showBackButton={false}>
        <div className="max-w-5xl mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToList}
              className="flex items-center gap-1.5 text-[#00d0ff] hover:text-white text-sm font-medium transition-colors"
              data-testid="button-back-to-streams"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Streams
            </button>
            <span className="text-gray-600">·</span>
            <h2 className="text-base font-bold text-white truncate">{selectedMatch.title}</h2>
            {isLive(selectedMatch.date) && (
              <span className="flex items-center gap-1 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                LIVE {getMatchTime(selectedMatch.date)}
              </span>
            )}
          </div>

          <div className="relative w-full bg-[#060f14] rounded-2xl overflow-hidden border border-white/5" style={{ paddingBottom: '56.25%' }}>
            {loadingStreams ? (
              <div className="absolute inset-0 flex items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-[#00d0ff]" />
                <span className="text-gray-400">Loading stream sources…</span>
              </div>
            ) : streams.length > 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#0a1a24] to-[#060f14]">
                <div className="w-16 h-16 rounded-2xl bg-[#00d0ff]/10 border border-[#00d0ff]/20 flex items-center justify-center mb-5">
                  <Tv className="h-8 w-8 text-[#00d0ff]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">{selectedMatch.title}</h3>
                <p className="text-gray-500 text-sm mb-6">
                  {streams.length} stream{streams.length > 1 ? 's' : ''} available · Click to open full-screen
                </p>
                <a
                  href={(() => {
                    const s = selectedStream || streams[0];
                    try {
                      const url = new URL(s.embedUrl);
                      const parts = url.pathname.split('/').filter(Boolean);
                      const source = parts[1] || 'alpha';
                      const id = parts[2] || '';
                      const num = parts[3] || '1';
                      return `/watch/${source}/${id}/${num}`;
                    } catch { return '#'; }
                  })()}
                  className="inline-flex items-center gap-2.5 bg-gradient-to-r from-[#0055cc] to-[#0088ff] hover:from-[#0066dd] hover:to-[#0099ff] text-white font-bold px-10 py-3.5 rounded-xl text-base transition-all shadow-lg shadow-blue-900/40 no-underline"
                  data-testid="button-play-stream"
                >
                  <Play className="h-5 w-5 fill-white" />
                  Play Stream
                </a>
                <p className="text-gray-600 text-xs mt-3">Opens with a back button to return here</p>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-3">
                <Tv className="h-12 w-12" />
                <p className="text-sm">No stream available for this match</p>
              </div>
            )}
          </div>

          {streams.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Available Streams</p>
              <div className="flex flex-wrap gap-2">
                {streams.map((stream) => {
                  let watchUrl = '#';
                  try {
                    const url = new URL(stream.embedUrl);
                    const parts = url.pathname.split('/').filter(Boolean);
                    watchUrl = `/watch/${parts[1] || 'alpha'}/${parts[2] || ''}/${parts[3] || '1'}`;
                  } catch {}
                  return (
                    <a
                      key={`${stream.source}-${stream.streamNo}`}
                      href={watchUrl}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm no-underline transition-all ${
                        selectedStream?.streamNo === stream.streamNo
                          ? "bg-[#00d0ff]/10 border border-[#00d0ff]/30 text-[#00d0ff]"
                          : "border border-white/10 text-gray-400 hover:border-white/20 hover:text-white"
                      }`}
                      data-testid={`button-stream-${stream.streamNo}`}
                    >
                      <Monitor className="h-3 w-3" />
                      Stream {stream.streamNo}
                      {stream.hd && <span className="text-[10px] text-green-400 font-bold">HD</span>}
                      <span className="flex items-center gap-0.5 text-[10px] opacity-60">
                        <Eye className="h-2.5 w-2.5" />
                        {stream.viewers}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {selectedMatch.sources.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Stream Sources</p>
              <div className="flex flex-wrap gap-2">
                {selectedMatch.sources.map((src, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setActiveSourceIdx(idx);
                      setSelectedStream(null);
                    }}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activeSourceIdx === idx
                        ? "bg-[#00d0ff]/10 border border-[#00d0ff]/30 text-[#00d0ff]"
                        : "border border-white/10 text-gray-400 hover:border-white/20 hover:text-white"
                    }`}
                    data-testid={`button-source-${idx}`}
                  >
                    {src.source}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Streaming">
      <div className="max-w-6xl mx-auto space-y-7">

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Tv className="h-4 w-4 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Live Streams</h1>
          {!loadingLive && (
            <span className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              <Radio className="h-3 w-3" />
              {liveNow.length} Live
            </span>
          )}
        </div>

        {loadingLive ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-[#00d0ff]" />
            <span className="text-gray-500 text-sm">Loading matches…</span>
          </div>
        ) : liveMatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
              <Tv className="h-8 w-8 text-gray-600" />
            </div>
            <div className="text-center">
              <p className="text-gray-400 font-medium">No football streams available right now</p>
              <p className="text-gray-600 text-sm mt-1">Check back during match times for live streams</p>
            </div>
          </div>
        ) : (
          <>
            {liveNow.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Live Now</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {liveNow.map(match => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      isLive={true}
                      matchTime={getMatchTime(match.date)}
                      onWatch={() => handleWatchMatch(match)}
                    />
                  ))}
                </div>
              </div>
            )}

            {upcoming.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-gray-500" />
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                    Today's Matches
                    <span className="ml-1.5 text-gray-600 font-normal normal-case">({upcoming.length})</span>
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {upcoming.map(match => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      isLive={false}
                      matchTime={getMatchTime(match.date)}
                      onWatch={() => handleWatchMatch(match)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function MatchCard({ match, isLive, matchTime, onWatch }: {
  match: StreamMatch;
  isLive: boolean;
  matchTime: string;
  onWatch: () => void;
}) {
  const homeTeam = match.teams?.home?.name || match.title?.split(' vs ')?.[0] || 'TBD';
  const awayTeam = match.teams?.away?.name || match.title?.split(' vs ')?.[1] || 'TBD';

  return (
    <div
      className="group relative bg-[#0b1822] border border-white/[0.06] rounded-xl overflow-hidden hover:border-[#00d0ff]/30 hover:bg-[#0d1f2e] transition-all cursor-pointer"
      onClick={onWatch}
      data-testid={`card-match-${match.id}`}
    >
      {isLive && (
        <div className="absolute inset-0 bg-gradient-to-b from-red-900/10 to-transparent pointer-events-none" />
      )}

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between min-h-[22px]">
          <div className="flex items-center gap-1.5">
            {isLive && (
              <span className="inline-flex items-center gap-1 bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded">
                <Signal className="h-2.5 w-2.5" />
                {matchTime}
              </span>
            )}
            {match.popular && (
              <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">
                Popular
              </span>
            )}
          </div>
          {!isLive && (
            <span className="text-xs text-gray-500 font-mono">{matchTime}</span>
          )}
        </div>

        <div className="flex items-center gap-2 py-1">
          <div className="flex-1 text-right">
            <p className="text-sm font-semibold text-white leading-tight" title={homeTeam}>
              {homeTeam.length > 18 ? homeTeam.slice(0, 17) + '…' : homeTeam}
            </p>
          </div>
          <div className="shrink-0 w-7 h-5 flex items-center justify-center">
            <span className="text-[10px] text-gray-600 font-bold">VS</span>
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-white leading-tight" title={awayTeam}>
              {awayTeam.length > 18 ? awayTeam.slice(0, 17) + '…' : awayTeam}
            </p>
          </div>
        </div>

        <button
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#0055cc] to-[#0077ee] hover:from-[#0066dd] hover:to-[#0088ff] text-white text-sm font-bold py-2.5 rounded-lg transition-all group-hover:shadow-md group-hover:shadow-blue-900/30"
          data-testid={`button-watch-${match.id}`}
        >
          <Play className="h-3.5 w-3.5 fill-white" />
          Watch Stream
          {match.sources.length > 1 && (
            <span className="text-[10px] opacity-70 font-normal">({match.sources.length} sources)</span>
          )}
        </button>
      </div>
    </div>
  );
}
