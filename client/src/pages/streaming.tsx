import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Layout from '@/components/layout/Layout';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Play, Tv, Radio, Eye, ArrowLeft, Monitor, Signal,
  Clock, Trophy, ExternalLink, Star, Zap
} from 'lucide-react';

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
  poster?: string;
  isChannel?: boolean;
  externalUrl?: string;
  teams?: {
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

type SportTab = 'football' | 'basketball' | 'baseball' | 'cricket' | 'horse-racing';

const SPORTS: { key: SportTab; label: string; emoji: string; color: string; border: string }[] = [
  { key: 'football',     label: 'Football',     emoji: '⚽', color: 'text-green-400',  border: 'border-green-500/40' },
  { key: 'basketball',   label: 'Basketball',   emoji: '🏀', color: 'text-orange-400', border: 'border-orange-500/40' },
  { key: 'baseball',     label: 'Baseball',     emoji: '⚾', color: 'text-blue-400',   border: 'border-blue-500/40' },
  { key: 'cricket',      label: 'Cricket',      emoji: '🏏', color: 'text-yellow-400', border: 'border-yellow-500/40' },
  { key: 'horse-racing', label: 'Horse Racing', emoji: '🏇', color: 'text-purple-400', border: 'border-purple-500/40' },
];

function useStreamMatches(sport: SportTab) {
  return useQuery<StreamMatch[]>({
    queryKey: [`/api/streaming/${sport}`],
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

function isLive(date: number) {
  if (!date || date === 0) return true; // channels with date=0 are always "live"
  const diff = Date.now() - date;
  return diff >= 0 && diff < 3 * 60 * 60 * 1000;
}

function getMatchTime(date: number): string {
  if (!date || date === 0) return 'LIVE';
  const diff = Date.now() - date;
  if (diff < 0) {
    return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  const mins = Math.floor(diff / 60000);
  if (mins > 90) return 'FT';
  if (mins > 45 && mins < 50) return 'HT';
  return `${mins}'`;
}

function getWatchUrl(match: StreamMatch, sourceIdx = 0): string {
  if (match.externalUrl) return match.externalUrl;
  const src = match.sources?.[sourceIdx];
  if (!src) return '#';
  return `/watch/${src.source}/${src.id}/1`;
}

export default function StreamingPage() {
  const [activeTab, setActiveTab] = useState<SportTab>('football');
  const [watchingMatch, setWatchingMatch] = useState<StreamMatch | null>(null);
  const [activeSourceIdx, setActiveSourceIdx] = useState(0);

  const { data: matches = [], isLoading } = useStreamMatches(activeTab);
  const activeSport = SPORTS.find(s => s.key === activeTab)!;

  const currentSource = watchingMatch?.sources?.[activeSourceIdx];

  const { data: streams = [], isLoading: loadingStreams } = useQuery<StreamInfo[]>({
    queryKey: ['/api/streaming/stream', currentSource?.source, currentSource?.id],
    queryFn: async () => {
      if (!currentSource) return [];
      const res = await fetch(`/api/streaming/stream/${currentSource.source}/${currentSource.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentSource && !!watchingMatch && !watchingMatch.externalUrl,
    refetchInterval: 120000,
  });

  useEffect(() => {
    setWatchingMatch(null);
    setActiveSourceIdx(0);
  }, [activeTab]);

  const liveNow = matches.filter(m => isLive(m.date));
  const upcoming = matches.filter(m => !isLive(m.date));
  const popular = matches.filter(m => m.popular);

  // ── Watching View ────────────────────────────────────────────────
  if (watchingMatch) {
    const live = isLive(watchingMatch.date);
    const homeTeam = watchingMatch.teams?.home?.name || watchingMatch.title?.split(' vs ')?.[0] || '';
    const awayTeam = watchingMatch.teams?.away?.name || watchingMatch.title?.split(' vs ')?.[1] || '';

    return (
      <Layout title="Streaming" showBackButton={false}>
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Back bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => { setWatchingMatch(null); setActiveSourceIdx(0); }}
              className="flex items-center gap-1.5 text-[#00d0ff] hover:text-white text-sm font-medium transition-colors"
              data-testid="button-back-to-streams"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Streams
            </button>
            <span className="text-gray-600">·</span>
            <span className="text-sm font-bold text-white truncate">{watchingMatch.title}</span>
            {live && (
              <span className="flex items-center gap-1 bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                LIVE {getMatchTime(watchingMatch.date)}
              </span>
            )}
          </div>

          {/* Player area */}
          <div className="relative w-full bg-[#060f14] rounded-2xl overflow-hidden border border-white/5" style={{ paddingBottom: '56.25%' }}>
            {loadingStreams ? (
              <div className="absolute inset-0 flex items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-[#00d0ff]" />
                <span className="text-gray-400">Loading stream sources…</span>
              </div>
            ) : watchingMatch.externalUrl ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#0a1a24] to-[#060f14] gap-5">
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-400/20 flex items-center justify-center">
                  <span className="text-3xl">🏇</span>
                </div>
                <div className="text-center space-y-1">
                  <p className="text-lg font-bold text-white">{watchingMatch.title}</p>
                  <p className="text-sm text-gray-400">Opens in a new tab</p>
                </div>
                <a
                  href={watchingMatch.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white font-bold px-8 py-3.5 rounded-xl transition-all shadow-lg no-underline"
                  data-testid="button-open-external-stream"
                >
                  <ExternalLink className="h-5 w-5" />
                  Watch Live
                </a>
              </div>
            ) : streams.length > 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#0a1a24] to-[#060f14]">
                <div className="w-16 h-16 rounded-2xl bg-[#00d0ff]/10 border border-[#00d0ff]/20 flex items-center justify-center mb-5">
                  <Tv className="h-8 w-8 text-[#00d0ff]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">{watchingMatch.title}</h3>
                <p className="text-gray-500 text-sm mb-6">
                  {streams.length} stream{streams.length > 1 ? 's' : ''} available
                </p>
                <a
                  href={getWatchUrl(watchingMatch, activeSourceIdx)}
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
                <p className="text-sm">No stream available for this match right now</p>
                <a
                  href={getWatchUrl(watchingMatch, 0)}
                  className="text-[#00d0ff] hover:text-white text-sm transition-colors no-underline"
                >
                  Try direct stream →
                </a>
              </div>
            )}
          </div>

          {/* Stream selector */}
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
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm no-underline border border-white/10 text-gray-400 hover:border-[#00d0ff]/30 hover:text-[#00d0ff] transition-all"
                      data-testid={`button-stream-${stream.streamNo}`}
                    >
                      <Monitor className="h-3 w-3" />
                      Stream {stream.streamNo}
                      {stream.hd && <span className="text-[10px] text-green-400 font-bold">HD</span>}
                      <span className="flex items-center gap-0.5 text-[10px] opacity-60">
                        <Eye className="h-2.5 w-2.5" />{stream.viewers}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Source selector */}
          {watchingMatch.sources.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Stream Sources</p>
              <div className="flex flex-wrap gap-2">
                {watchingMatch.sources.map((src, idx) => (
                  <button
                    key={idx}
                    onClick={() => { setActiveSourceIdx(idx); }}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activeSourceIdx === idx
                        ? 'bg-[#00d0ff]/10 border border-[#00d0ff]/30 text-[#00d0ff]'
                        : 'border border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
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

  // ── List View ────────────────────────────────────────────────────
  return (
    <Layout title="Streaming">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Tv className="h-4.5 w-4.5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">Live Streams</h1>
            <p className="text-xs text-gray-500">Free live sports streaming via streamed.pk</p>
          </div>
          {!isLoading && liveNow.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              <Radio className="h-3 w-3" />
              {liveNow.length} Live
            </span>
          )}
        </div>

        {/* Sport tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {SPORTS.map(sport => (
            <button
              key={sport.key}
              onClick={() => setActiveTab(sport.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                activeTab === sport.key
                  ? `bg-white/8 ${sport.border} ${sport.color}`
                  : 'border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/10 hover:bg-white/4'
              }`}
              data-testid={`tab-sport-${sport.key}`}
            >
              <span>{sport.emoji}</span>
              {sport.label}
              {activeTab === sport.key && !isLoading && (
                <span className={`text-[10px] font-bold opacity-70`}>
                  {matches.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-[#00d0ff]" />
            <span className="text-gray-500 text-sm">Loading {activeSport.label} streams…</span>
          </div>
        ) : matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-3xl">
              {activeSport.emoji}
            </div>
            <div className="text-center">
              <p className="text-gray-400 font-medium">No {activeSport.label} streams right now</p>
              <p className="text-gray-600 text-sm mt-1">Check back during match times for live streams</p>
            </div>
          </div>
        ) : (
          <div className="space-y-7">
            {/* Popular / Featured row */}
            {popular.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Star className="h-3.5 w-3.5 text-amber-400" />
                  <h2 className="text-xs font-bold text-amber-400 uppercase tracking-widest">Featured</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {popular.slice(0, 6).map(match => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      live={isLive(match.date)}
                      matchTime={getMatchTime(match.date)}
                      sportColor={activeSport.color}
                      onWatch={() => { setWatchingMatch(match); setActiveSourceIdx(0); }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Live Now */}
            {liveNow.filter(m => !m.popular).length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <h2 className="text-xs font-bold text-red-400 uppercase tracking-widest">
                    Live Now
                    <span className="ml-2 text-gray-600 font-normal normal-case">
                      ({liveNow.filter(m => !m.popular).length})
                    </span>
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {liveNow.filter(m => !m.popular).map(match => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      live={true}
                      matchTime={getMatchTime(match.date)}
                      sportColor={activeSport.color}
                      onWatch={() => { setWatchingMatch(match); setActiveSourceIdx(0); }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Upcoming / Today */}
            {upcoming.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-gray-500" />
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Today's Matches
                    <span className="ml-2 text-gray-600 font-normal normal-case">({upcoming.length})</span>
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {upcoming.map(match => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      live={false}
                      matchTime={getMatchTime(match.date)}
                      sportColor={activeSport.color}
                      onWatch={() => { setWatchingMatch(match); setActiveSourceIdx(0); }}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-[11px] text-gray-700 pb-2">
          Streams provided by streamed.pk · External links open in a new tab · Content availability may vary
        </p>
      </div>
    </Layout>
  );
}

function MatchCard({
  match, live, matchTime, sportColor, onWatch
}: {
  match: StreamMatch;
  live: boolean;
  matchTime: string;
  sportColor: string;
  onWatch: () => void;
}) {
  const homeTeam = match.teams?.home?.name || match.title?.split(' vs ')?.[0] || match.title || 'TBD';
  const awayTeam = match.teams?.away?.name || match.title?.split(' vs ')?.[1] || '';
  const isChannel = match.isChannel;
  const sourcesCount = match.sources?.length ?? 0;

  const handleClick = () => {
    if (match.externalUrl) {
      window.open(match.externalUrl, '_blank', 'noopener,noreferrer');
    } else {
      onWatch();
    }
  };

  return (
    <div
      className={`group relative bg-[#0b1822] border rounded-xl overflow-hidden hover:bg-[#0d1f2e] transition-all cursor-pointer ${
        live ? 'border-red-900/40 hover:border-red-500/30' : 'border-white/[0.06] hover:border-white/10'
      }`}
      onClick={handleClick}
      data-testid={`card-match-${match.id}`}
    >
      {live && <div className="absolute inset-0 bg-gradient-to-b from-red-900/8 to-transparent pointer-events-none" />}
      {match.popular && <div className="absolute inset-0 bg-gradient-to-b from-amber-900/5 to-transparent pointer-events-none" />}

      <div className="p-4 space-y-3">
        {/* Top row: badges + time */}
        <div className="flex items-center justify-between min-h-[22px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            {live && (
              <span className="inline-flex items-center gap-1 bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded">
                <Signal className="h-2.5 w-2.5" />
                {matchTime}
              </span>
            )}
            {match.popular && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded">
                <Star className="h-2.5 w-2.5" />
                Popular
              </span>
            )}
            {isChannel && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/25 px-1.5 py-0.5 rounded">
                <Tv className="h-2.5 w-2.5" />
                Channel
              </span>
            )}
          </div>
          {!live && match.date > 0 && (
            <span className="text-xs text-gray-500 font-mono">{matchTime}</span>
          )}
        </div>

        {/* Teams */}
        {isChannel ? (
          <div className="py-1 text-center">
            <p className={`text-sm font-bold ${sportColor}`}>{homeTeam}</p>
            <p className="text-xs text-gray-500 mt-0.5">{awayTeam}</p>
          </div>
        ) : (
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
                {awayTeam ? (awayTeam.length > 18 ? awayTeam.slice(0, 17) + '…' : awayTeam) : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Watch button */}
        <button
          className={`w-full flex items-center justify-center gap-2 text-white text-sm font-bold py-2.5 rounded-lg transition-all group-hover:shadow-md ${
            isChannel
              ? 'bg-gradient-to-r from-purple-700 to-purple-600 hover:from-purple-600 hover:to-purple-500 group-hover:shadow-purple-900/30'
              : 'bg-gradient-to-r from-[#0055cc] to-[#0077ee] hover:from-[#0066dd] hover:to-[#0088ff] group-hover:shadow-blue-900/30'
          }`}
          data-testid={`button-watch-${match.id}`}
        >
          {isChannel ? (
            <>
              <ExternalLink className="h-3.5 w-3.5" />
              Watch Channel
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-white" />
              Watch Stream
              {sourcesCount > 1 && (
                <span className="text-[10px] opacity-60 font-normal">({sourcesCount} sources)</span>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
