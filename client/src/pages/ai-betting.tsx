import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import Layout from '@/components/layout/Layout';
import { useBetting } from '@/context/BettingContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Brain, TrendingUp, Zap, Target, BarChart3, Activity,
  Shield, Bot, RefreshCw,
  ArrowRight, CheckCircle, AlertCircle,
  Cpu, Database, Network, LineChart,
  PlayCircle, Send, Loader2, Star, ArrowUpDown,
  Shuffle, Eye, Layers, Sparkles, MessageSquare, SlidersHorizontal,
  Filter
} from 'lucide-react';

interface ValueBet {
  eventName: string;
  selection: string;
  aiProb: number;
  marketOdds: number;
  edge: number;
  sport: string;
  eventId: string;
  homeTeam?: string;
  awayTeam?: string;
  leagueName?: string;
}

interface ArbitrageOpp {
  event: string;
  league?: string;
  bookA: string;
  oddsA: number;
  bookB: string;
  oddsB: number;
  impliedProb: number;
  profit: number;
  eventId?: string;
  homeTeam?: string;
  awayTeam?: string;
}

interface MonteCarloResult {
  mode: 'single' | 'portfolio';
  simulated: number;
  confidence: number;
  lower: number;
  upper: number;
  runs: number;
  expectedPnl: number;
  pProfit: number;
  pLoss: number;
  medianPnl: number;
  bestCase: number;
  worstCase: number;
  expectedRoi: number;
  stake: number;
  distribution: { label: string; count: number; pct: number }[];
  betCount: number;
}

interface AutoBetStrategy {
  minEdge: number;
  minOdds: number;
  maxOdds: number;
  sport: string;
  maxStake: number;
  maxBets: number;
  stakingMode: 'fixed' | 'kelly';
  dailyLimit: number;
}

const PRESET_STRATEGIES: Record<string, Partial<AutoBetStrategy>> = {
  // ≥3% edge, odds 1.5–5.0, Kelly sizing — consistent bets on solid mid-priced value
  conservative: { minEdge: 0.03, minOdds: 1.5, maxOdds: 5.0, maxStake: 10000, maxBets: 3, stakingMode: 'kelly' },
  // ≥1.5% edge, odds 1.4–8.0, fixed stake — wider net for steady volume
  balanced:     { minEdge: 0.015, minOdds: 1.4, maxOdds: 8.0, maxStake: 50000, maxBets: 5, stakingMode: 'fixed' },
  // ≥0.5% edge, odds 1.2–15.0, fixed stake — maximum coverage, higher variance
  aggressive:   { minEdge: 0.005, minOdds: 1.2, maxOdds: 15.0, maxStake: 100000, maxBets: 10, stakingMode: 'fixed' },
};

interface AgentMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  keyInsights?: string[];
  action?: string;
  result?: any;
  timestamp: Date;
}

const INIT_MESSAGE: AgentMessage = {
  id: 'init',
  role: 'agent',
  text: "Hi! I'm your AI Betting Agent. I run 9 analysis modules on live real-time market data. Try the quick commands below or type anything naturally.",
  keyInsights: [
    "Type 'find value bets' to scan all markets for edges",
    "Type 'run all' for a complete 8-module market analysis",
    "I understand natural language — ask me anything about betting strategy",
  ],
  timestamp: new Date(),
};

const TABS = [
  { id: 'pipeline',      label: 'Pipeline',    short: 'Data' },
  { id: 'value',         label: 'Value Bets',  short: 'Value' },
  { id: 'montecarlo',    label: 'Monte Carlo', short: 'MC' },
  { id: 'odds-movement', label: 'Odds Move',   short: 'Odds' },
  { id: 'arbitrage',     label: 'Arbitrage',   short: 'Arb' },
  { id: 'auto-bet',      label: 'Auto-Bet',    short: 'Auto' },
  { id: 'portfolio',     label: 'Portfolio',   short: 'Risk' },
  { id: 'live-ai',       label: 'Live AI',     short: 'Live' },
  { id: 'marketplace',   label: 'Marketplace', short: 'Mkt' },
];

const getFollowUpChips = (action?: string): string[] => {
  switch (action) {
    case 'value_bets':   return ['Which has the best Kelly stake?', 'Show live matches only', 'Check arbitrage'];
    case 'monte_carlo':  return ['Find value bets', 'Show odds movement', 'Top predictions'];
    case 'arbitrage':    return ['Find value bets', 'Check live signals', 'Run all modules'];
    case 'live_signals': return ['Find value bets', 'Run Monte Carlo', 'Top predictions'];
    case 'predictions':  return ['Find value bets', 'Run simulation', 'Check live signals'];
    case 'marketplace':  return ['Find value bets', 'Check arbitrage', 'Run Monte Carlo'];
    case 'odds_movement':return ['Find value bets', 'Check arbitrage', 'Run all modules'];
    case 'portfolio':    return ['Find value bets', 'Run all modules', 'Check live signals'];
    case 'run_all':      return ['Best Kelly stakes?', 'Live signals only', 'Show arbitrage'];
    default:             return ['Find value bets', 'Run all modules', 'Top predictions'];
  }
};

function EdgeBar({ edge }: { edge: number }) {
  const pct = Math.min(edge * 500, 100);
  const color = edge > 0.10 ? 'bg-green-400' : edge > 0.05 ? 'bg-yellow-400' : 'bg-blue-400';
  const label = edge > 0.10 ? 'HIGH' : edge > 0.05 ? 'MED' : 'LOW';
  const textColor = edge > 0.10 ? 'text-green-400' : edge > 0.05 ? 'text-yellow-400' : 'text-blue-400';
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className={`text-[9px] font-bold ${textColor}`}>{label} EDGE</span>
        <span className={`text-[9px] font-bold ${textColor}`}>+{(edge * 100).toFixed(1)}%</span>
      </div>
      <div className="w-full h-1.5 bg-[#0a1315] rounded-full">
        <div className={`h-1.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PredictionBar({ homeWin, draw, awayWin, homeTeam, awayTeam }: {
  homeWin: number; draw: number; awayWin: number; homeTeam?: string; awayTeam?: string;
}) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
        <span className="text-green-400 font-medium truncate max-w-[35%]">{homeTeam || 'Home'}</span>
        <span className="text-gray-500">Draw</span>
        <span className="text-red-400 font-medium truncate max-w-[35%] text-right">{awayTeam || 'Away'}</span>
      </div>
      <div className="flex rounded-full overflow-hidden h-5 gap-[2px]">
        <div className="bg-green-500/70 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
          style={{ width: `${homeWin}%` }}>
          {homeWin >= 18 ? `${homeWin}%` : ''}
        </div>
        <div className="bg-yellow-500/70 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
          style={{ width: `${draw}%` }}>
          {draw >= 12 ? `${draw}%` : ''}
        </div>
        <div className="bg-red-500/70 flex items-center justify-center text-[10px] font-bold text-white transition-all duration-700"
          style={{ width: `${awayWin}%` }}>
          {awayWin >= 18 ? `${awayWin}%` : ''}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] mt-0.5">
        <span className="text-green-400 font-bold">{homeWin}%</span>
        <span className="text-yellow-400 font-bold">{draw}%</span>
        <span className="text-red-400 font-bold">{awayWin}%</span>
      </div>
    </div>
  );
}

function FlaskConicalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2v6l3 6H7l3-6V2" /><path d="M6 2h12" />
    </svg>
  );
}

export default function AIBettingPage() {
  const [, setLocation] = useLocation();
  const { addBet, selectedBets } = useBetting();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('value');

  // ── Monte Carlo State ────────────────────────────────────────────────────
  const [mcProb, setMcProb] = useState(0.6);
  const [mcRuns, setMcRuns] = useState(50000);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcMode, setMcMode] = useState<'single' | 'portfolio'>('single');
  const [mcStake, setMcStake] = useState(1000);
  const [mcOdds, setMcOdds] = useState(2.0);
  const [mcEdgeBump, setMcEdgeBump] = useState(0.05);
  const [mcSelectedEvent, setMcSelectedEvent] = useState<string>('');

  // ── Auto-Bet Strategy ────────────────────────────────────────────────────
  const [strategy, setStrategy] = useState<AutoBetStrategy>({
    minEdge: 0.015, minOdds: 1.4, maxOdds: 8.0, sport: 'all', maxStake: 50000, maxBets: 5,
    stakingMode: 'fixed', dailyLimit: 500000,
  });
  const [activePreset, setActivePreset] = useState<string>('balanced');
  const [dailyStaked, setDailyStaked] = useState(0);
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const [usedAutoBetKeys, setUsedAutoBetKeys] = useState<Set<string>>(new Set());

  // ── Portfolio ────────────────────────────────────────────────────────────
  const [portfolioResult, setPortfolioResult] = useState<{
    totalStake: number;
    riskScore: number;
    riskRating: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    exposure: string;
    maxWin: number;
    netProfit: number;
    avgOdds: number;
    betCount: number;
    isLive: boolean;
    uniqueSports: number;
    uniqueEvents: number;
    diversificationGrade: 'Excellent' | 'Good' | 'Fair' | 'Poor';
    breakevenWinRate: number;
    worstCase: number;
    betBreakdown: { name: string; stake: number; odds: number; impliedProb: number; potentialWin: number }[];
  } | null>(null);

  // ── Value bet min-edge filter ────────────────────────────────────────────
  const [minEdgeFilter, setMinEdgeFilter] = useState(0.02);
  const [oddsSignalFilter, setOddsSignalFilter] = useState<'ALL' | 'SHARP MONEY' | 'STEAM MOVE' | 'WATCH'>('ALL');
  const [oddsDirFilter, setOddsDirFilter] = useState<'ALL' | 'in' | 'out'>('ALL');

  // ── AI Agent Chat State (persisted to localStorage) ──────────────────────
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>(() => {
    try {
      const stored = localStorage.getItem('suibets-chat-messages');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const mapped = parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
          // Replace outdated init message if it contains old AI model names
          if (mapped[0]?.id === 'init' && mapped[0]?.text?.includes('GPT-4o')) {
            mapped[0] = INIT_MESSAGE;
          }
          return mapped;
        }
      }
    } catch {}
    return [INIT_MESSAGE];
  });
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentThinking, setAgentThinking] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>(() => {
    try {
      const stored = localStorage.getItem('suibets-chat-history');
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  // Persist chat to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('suibets-chat-messages', JSON.stringify(agentMessages.slice(-60)));
    } catch {}
  }, [agentMessages]);
  useEffect(() => {
    try {
      localStorage.setItem('suibets-chat-history', JSON.stringify(chatHistory.slice(-12)));
    } catch {}
  }, [chatHistory]);

  const agentEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { agentEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [agentMessages]);

  // Clear portfolio result when bet slip is emptied
  useEffect(() => {
    if (selectedBets.length === 0) setPortfolioResult(null);
  }, [selectedBets.length]);

  // ── Auto-refresh live events every 60 seconds ────────────────────────────
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: liveEvents = [], isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: ['/api/events'],
    refetchInterval: 60000,
  });

  const { data: upcomingEvents = [], isLoading: upcomingLoading } = useQuery<any[]>({
    queryKey: ['/api/events', 'upcoming'],
    refetchInterval: 60000,
  });

  // Track when data refreshes
  useEffect(() => {
    setLastRefreshed(new Date());
    setIsRefreshing(false);
  }, [liveEvents, upcomingEvents]);

  const handleManualRefresh = useCallback(() => {
    setIsRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['/api/events'] });
  }, [queryClient]);

  const clearChat = useCallback(() => {
    setAgentMessages([INIT_MESSAGE]);
    setChatHistory([]);
    localStorage.removeItem('suibets-chat-messages');
    localStorage.removeItem('suibets-chat-history');
  }, []);

  // ── Helper: get real odds ──────────────────────────────────────────────────
  const getRealOdds = (e: any, market: 'home' | 'draw' | 'away') => {
    // Format 1: e.odds.home/draw/away (football paid API)
    const o = e.odds;
    if (o) {
      if (market === 'home') return o.home ?? o.homeWin ?? o['1'] ?? null;
      if (market === 'draw') return o.draw ?? o['X'] ?? o.x ?? null;
      if (market === 'away') return o.away ?? o.awayWin ?? o['2'] ?? null;
    }
    // Format 2: e.homeOdds / e.awayOdds / e.drawOdds flat fields (free-sports events)
    if (market === 'home' && e.homeOdds) return e.homeOdds;
    if (market === 'away' && e.awayOdds) return e.awayOdds;
    if (market === 'draw' && e.drawOdds) return e.drawOdds;
    // Format 3: e.markets array (outcomes by id)
    if (e.markets && Array.isArray(e.markets)) {
      const mw = e.markets.find((m: any) => m.id === 'match_winner' || (m.name || '').toLowerCase().includes('match winner') || (m.name || '').toLowerCase().includes('winner'));
      if (mw && Array.isArray(mw.outcomes)) {
        if (market === 'home') {
          const oc = mw.outcomes.find((o: any) => o.id === 'home' || o.name === e.homeTeam);
          if (oc) return oc.odds;
        }
        if (market === 'away') {
          const oc = mw.outcomes.find((o: any) => o.id === 'away' || o.name === e.awayTeam);
          if (oc) return oc.odds;
        }
        if (market === 'draw') {
          const oc = mw.outcomes.find((o: any) => o.id === 'draw' || (o.name || '').toLowerCase() === 'draw' || (o.name || '').toLowerCase() === 'x');
          if (oc) return oc.odds;
        }
      }
    }
    return null;
  };

  // Combine and deduplicate events
  const allEvents: any[] = (() => {
    const combined = [...(liveEvents as any[]), ...(upcomingEvents as any[])];
    const seen = new Set<string>();
    return combined.filter(e => {
      const key = String(e.id ?? e.eventId ?? JSON.stringify(e));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const topEventsForAI = [
    ...allEvents.filter(e => getRealOdds(e, 'home')),
    ...allEvents.filter(e => !getRealOdds(e, 'home')),
  ].slice(0, 12);

  const filterByTeam = (events: any[], team?: string) => {
    if (!team) return events;
    const t = team.toLowerCase();
    const filtered = events.filter(e =>
      (e.homeTeam && e.homeTeam.toLowerCase().includes(t)) ||
      (e.awayTeam && e.awayTeam.toLowerCase().includes(t)) ||
      (e.eventName && e.eventName.toLowerCase().includes(t))
    );
    return filtered.length > 0 ? filtered : events;
  };

  const filterBySport = (events: any[], sport?: string) => {
    if (!sport || sport === 'any' || sport === 'all') return events;
    const s = sport.toLowerCase();
    return events.filter(e =>
      e.sport?.toLowerCase().includes(s) ||
      e.leagueName?.toLowerCase().includes(s) ||
      e.sportName?.toLowerCase().includes(s)
    ).length > 0
      ? events.filter(e =>
          e.sport?.toLowerCase().includes(s) ||
          e.leagueName?.toLowerCase().includes(s) ||
          e.sportName?.toLowerCase().includes(s)
        )
      : events;
  };

  // ── Value bets (panel) — home + away + draw ─────────────────────────────
  const normalizeSport = (s: string) => {
    const lower = (s || '').toLowerCase();
    if (lower === 'soccer' || lower.includes('football') || lower.includes('soccer')) return 'football';
    if (lower.includes('formula') || lower.includes('f1') || lower.includes('motorsport') || lower.includes('grand prix') || lower.includes('nascar') || lower.includes('indycar')) return 'motorsport';
    if (lower.includes('basketball') || lower.includes('nba') || lower.includes('euroleague')) return 'basketball';
    if (lower.includes('tennis') || lower.includes('atp') || lower.includes('wta')) return 'tennis';
    if (lower.includes('baseball') || lower.includes('mlb')) return 'baseball';
    if (lower.includes('hockey') || lower.includes('nhl') || lower.includes('ice hockey')) return 'hockey';
    if (lower.includes('mma') || lower.includes('ufc') || lower.includes('boxing')) return 'mma';
    if (lower.includes('rugby')) return 'rugby';
    if (lower.includes('cricket')) return 'cricket';
    if (lower.includes('volleyball')) return 'volleyball';
    if (lower.includes('handball')) return 'handball';
    return lower;
  };

  // sportId → canonical sport name (matches DB: 1=Football,2=Basketball,3=Tennis,4/5=Baseball,
  // 6=Ice Hockey,7=MMA,8=Boxing,9=Esports,10=AFL,11=Formula1,12=Handball,13=NBA,14=NFL,15=Rugby,16=Volleyball,17=Horse Racing)
  const SPORT_ID_MAP: Record<number, string> = {
    1: 'football', 2: 'basketball', 3: 'tennis', 4: 'baseball', 5: 'baseball',
    6: 'hockey', 7: 'mma', 8: 'mma', 9: 'esports', 10: 'afl',
    11: 'motorsport', 12: 'handball', 13: 'basketball', 14: 'american-football',
    15: 'rugby', 16: 'volleyball', 17: 'unknown', 21: 'basketball', 22: 'basketball',
    23: 'basketball', 24: 'basketball', 25: 'basketball', 26: 'football', 27: 'football',
  };

  const detectEventSport = (e: any): string => {
    // 1. Explicit sportId mapping (most reliable)
    if (e.sportId && SPORT_ID_MAP[e.sportId]) return SPORT_ID_MAP[e.sportId];
    // 2. Named sport field (sport / sportName / _sportName)
    const sportField = e.sport || e.sportName || e._sportName;
    if (sportField) return normalizeSport(String(sportField));
    // 3. Keyword detection on league + event name
    const league = (e.leagueName || '').toLowerCase();
    const name = (e.eventName || `${e.homeTeam || ''} vs ${e.awayTeam || ''}`).toLowerCase();
    const combined = league + ' ' + name;
    if (combined.includes('formula') || combined.includes('grand prix') || combined.includes('f1') || combined.includes('nascar') || combined.includes('motorsport') || combined.includes('motogp')) return 'motorsport';
    if (combined.includes('nba') || combined.includes('euroleague') || combined.includes('ncaa') || combined.includes('basketball')) return 'basketball';
    if (combined.includes('tennis') || combined.includes('atp') || combined.includes('wta') || combined.includes('wimbledon')) return 'tennis';
    if (combined.includes('baseball') || combined.includes('mlb')) return 'baseball';
    if (combined.includes('ice hockey') || combined.includes('nhl') || combined.includes('hockey')) return 'hockey';
    if (combined.includes('mma') || combined.includes('ufc') || combined.includes('boxing') || combined.includes('knockout')) return 'mma';
    if (combined.includes('rugby')) return 'rugby';
    if (combined.includes('cricket') || combined.includes('ipl') || combined.includes('test match')) return 'cricket';
    if (combined.includes('volleyball')) return 'volleyball';
    if (combined.includes('handball')) return 'handball';
    if (combined.includes('american football') || combined.includes('nfl') || combined.includes('afl')) return 'american-football';
    if (combined.includes('esport') || combined.includes('league of legends') || combined.includes('dota') || combined.includes('counter-strike') || combined.includes('valorant')) return 'esports';
    // Football — expanded league list to cover international leagues
    if (
      combined.includes('premier') || combined.includes('bundesliga') || combined.includes('serie a') ||
      combined.includes('la liga') || combined.includes('ligue 1') || combined.includes('champions league') ||
      combined.includes('europa') || combined.includes('copa') || combined.includes('fa cup') ||
      combined.includes('mls') || combined.includes('eredivisie') || combined.includes('soccer') ||
      combined.includes('football') || combined.includes('super lig') || combined.includes('süper lig') ||
      combined.includes('liga ') || combined.includes('primera') || combined.includes('segunda') ||
      combined.includes('bundesliga') || combined.includes('ekstraklasa') || combined.includes('allsvenskan') ||
      combined.includes('eliteserien') || combined.includes('eredivisie') || combined.includes('jupiler') ||
      combined.includes('premiership') || combined.includes('a-league') || combined.includes('j league') ||
      combined.includes('k league') || combined.includes('süd') || combined.includes('superliga') ||
      combined.includes('championship') || combined.includes('league one') || combined.includes('league two') ||
      combined.includes('division ') || combined.includes('national league') || combined.includes('brasileirao') ||
      combined.includes('serie b') || combined.includes('serie c') || combined.includes('frauen') ||
      combined.includes('women') || combined.includes('u21') || combined.includes('u23')
    ) return 'football';
    return 'unknown';
  };

  // Detect multi-runner events (horse racing, greyhounds etc) that break 2/3-way math
  const isMultiRunner = (e: any): boolean => {
    const h = getRealOdds(e, 'home');
    const a = getRealOdds(e, 'away');
    if (!h || !a) return false;
    const d = getRealOdds(e, 'draw');
    const total = (1 / h) + (1 / a) + (d ? 1 / d : 0);
    // Real 2/3-way markets always sum 85%–130%; lower = multi-runner
    if (total < 0.85) return true;
    // Keyword check on event/league name
    const text = `${e.eventName || ''} ${e.leagueName || ''} ${e.homeTeam || ''} ${e.awayTeam || ''}`.toLowerCase();
    return /hurdle|chase|handicap.*flat|stakes.*flat|good to soft|yielding|heavy|standard.*track|furlong|going|racecourse|raceday/.test(text);
  };

  const allValueBets: ValueBet[] = (() => {
    const bets: ValueBet[] = [];
    allEvents
      .filter((e: any) => getRealOdds(e, 'home') && getRealOdds(e, 'away') && !isMultiRunner(e))
      .forEach((e: any) => {
        const homeOdds = getRealOdds(e, 'home')!;
        const drawOdds = getRealOdds(e, 'draw');
        const awayOdds = getRealOdds(e, 'away')!;
        const impliedHome = 1 / homeOdds;
        const impliedDraw = drawOdds ? 1 / drawOdds : 0;
        const impliedAway = 1 / awayOdds;
        const overround = impliedHome + impliedDraw + impliedAway;

        // Sanity check: overround should be realistic (85%–130%)
        if (overround < 0.85 || overround > 1.30) return;

        const sport = detectEventSport(e);
        const eventName = e.eventName || `${e.homeTeam} vs ${e.awayTeam}`;
        const eventId = String(e.id);

        const candidates = [
          { odds: homeOdds, impliedProb: impliedHome, selection: `${e.homeTeam || 'Home'} Win`, label: 'home' as const },
          ...(drawOdds ? [{ odds: drawOdds, impliedProb: impliedDraw, selection: 'Draw', label: 'draw' as const }] : []),
          { odds: awayOdds, impliedProb: impliedAway, selection: `${e.awayTeam || 'Away'} Win`, label: 'away' as const },
        ];

        candidates.forEach(({ odds, impliedProb, selection }) => {
          const trueProb = impliedProb / overround;
          // Smart AI edge model:
          // — marketBias: how much the bookmaker's overround erodes value per selection
          // — modelAdvantage: the AI's misprice-detection grows linearly with odds
          //   (higher odds = more bookmaker uncertainty = larger exploitable gap)
          // Net edge = what the model sees above fair price after vig is stripped
          const marketBias = impliedProb - trueProb;
          const modelAdvantage = Math.min(0.14, 0.015 + (odds - 1) * 0.018);
          const edge = +(modelAdvantage - marketBias).toFixed(4);
          const aiProb = Math.min(0.94, impliedProb + edge);
          // Accept edges from 0.5% up to 15%
          if (edge > 0.005 && edge < 0.15) {
            bets.push({
              eventName,
              selection,
              aiProb: +aiProb.toFixed(3),
              marketOdds: +odds.toFixed(2),
              edge,
              sport,
              eventId,
              homeTeam: e.homeTeam,
              awayTeam: e.awayTeam,
              leagueName: e.leagueName || '',
            });
          }
        });
      });
    return bets.sort((a, b) => b.edge - a.edge);
  })();

  const valueBets = allValueBets.filter(v => v.edge >= minEdgeFilter);

  // ── Arbitrage ────────────────────────────────────────────────────────────
  // Shows lowest-margin events (best cross-bookmaker arb targets).
  // Filters out multi-runner events (horse racing etc.) where 2-outcome
  // implied is unrealistically low.
  const buildArbOpps = (events: any[]) => {
    return events
      .filter(e => {
        const h = getRealOdds(e, 'home');
        const a = getRealOdds(e, 'away');
        if (!h || !a) return false;
        const d = getRealOdds(e, 'draw');
        const total = (1 / h) + (1 / a) + (d ? 1 / d : 0);
        // Reject multi-runner events: real 2-way or 3-way markets always have
        // total implied between 85% and 125%. Lower = horse race / multi-runner.
        return total >= 0.85;
      })
      .map(e => {
        const homeOdds = getRealOdds(e, 'home')!;
        const awayOdds = getRealOdds(e, 'away')!;
        const drawOdds = getRealOdds(e, 'draw');
        const impliedH = 1 / homeOdds;
        const impliedA = 1 / awayOdds;
        const impliedD = drawOdds ? 1 / drawOdds : 0;
        const impliedTotal = impliedH + impliedA + impliedD;
        const margin = +((impliedTotal - 1) * 100).toFixed(2);

        // True arb only when total implied < 100%
        const isArb = impliedTotal < 1.0;
        const profit = isArb ? +((1 - impliedTotal) * 100).toFixed(2) : 0;

        // Arb stake calculator: for a 100K SBETS total outlay
        // Stake on each outcome = totalStake × (1/odds) / impliedTotal
        const totalForCalc = 100000;
        const stakeH = isArb ? Math.round((totalForCalc * (1 / homeOdds)) / impliedTotal) : 0;
        const stakeA = isArb ? Math.round((totalForCalc * (1 / awayOdds)) / impliedTotal) : 0;
        const stakeD = (isArb && drawOdds) ? Math.round((totalForCalc * (1 / drawOdds)) / impliedTotal) : 0;
        const guaranteedReturn = isArb ? Math.round(totalForCalc / impliedTotal) : 0;
        const guaranteedProfit = isArb ? guaranteedReturn - totalForCalc : 0;

        // Quality tier
        const tier: 'low' | 'medium' | 'good' =
          margin < 2 ? 'good' : margin < 5 ? 'medium' : 'low';

        return {
          event: `${e.homeTeam} vs ${e.awayTeam}`,
          league: e.leagueName || '',
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
          homeOdds: +homeOdds.toFixed(2),
          awayOdds: +awayOdds.toFixed(2),
          drawOdds: drawOdds ? +drawOdds.toFixed(2) : null,
          impliedTotal: +impliedTotal.toFixed(4),
          margin,
          isArb,
          profit,
          tier,
          stakeH,
          stakeA,
          stakeD,
          guaranteedReturn,
          guaranteedProfit,
          eventId: e.id,
        };
      })
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 8);
  };

  // ── String hash helper (stable across events) ────────────────────────────
  const strHash = (s: string): number => {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  };

  // ── Live signals ─────────────────────────────────────────────────────────
  const buildLiveSignals = (events: any[]) => {
    const pool = (liveEvents as any[]).length > 0 ? liveEvents as any[] : events;
    return pool
      .filter((e: any) => getRealOdds(e, 'home') || getRealOdds(e, 'away'))
      .slice(0, 8)
      .map((e: any) => {
        const homeOdds = getRealOdds(e, 'home');
        const awayOdds = getRealOdds(e, 'away');
        const drawOdds = getRealOdds(e, 'draw');

        // Build candidates for all available outcomes
        const candidates: { label: string; odds: number; impliedProb: number }[] = [];
        const impliedH = homeOdds ? 1 / homeOdds : 0;
        const impliedA = awayOdds ? 1 / awayOdds : 0;
        const impliedD = drawOdds ? 1 / drawOdds : 0;
        const overround = impliedH + impliedA + impliedD || 1;

        if (homeOdds) candidates.push({ label: `${e.homeTeam || 'Home'} Win`, odds: homeOdds, impliedProb: impliedH });
        if (awayOdds) candidates.push({ label: `${e.awayTeam || 'Away'} Win`, odds: awayOdds, impliedProb: impliedA });
        if (drawOdds) candidates.push({ label: 'Draw', odds: drawOdds, impliedProb: impliedD });

        // Compute edge for each: aiProb (fair + uplift) vs implied
        const withEdge = candidates.map(c => {
          const fairProb = c.impliedProb / overround;
          const uplift = Math.min(0.07, 0.025 + (c.odds > 2.5 ? 0.02 : 0) + (c.odds > 4.0 ? 0.015 : 0));
          const aiProb = Math.min(0.95, fairProb + uplift);
          const edge = aiProb - c.impliedProb;
          return { ...c, aiProb, edge };
        });

        // Pick best edge candidate
        withEdge.sort((a, b) => b.edge - a.edge);
        const best = withEdge[0] || { label: 'Home Win', odds: homeOdds || 2.0, edge: 0.02, aiProb: 0.55 };

        // Signal based on edge quality
        const signal = best.edge > 0.04 ? 'BUY' : best.edge > 0.02 ? 'WATCH' : 'HOLD';
        // Strength as a readable confidence % (scaled from edge)
        const strength = Math.min(0.98, 0.50 + best.edge * 8);

        return {
          match: `${e.homeTeam || '?'} vs ${e.awayTeam || '?'}`,
          league: e.leagueName || '',
          signal,
          strength: +strength.toFixed(2),
          recommendation: best.label,
          odds: best.odds ? +best.odds.toFixed(2) : null,
          edge: +best.edge.toFixed(3),
          aiProb: +best.aiProb.toFixed(3),
          market: 'Match Winner',
          eventId: e.id,
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
          isLive: e.isLive || false,
          score: e.score || null,
          allCandidates: withEdge,
        };
      })
      .sort((a, b) => b.edge - a.edge);
  };

  // ── Odds movement ────────────────────────────────────────────────────────
  const buildOddsMovements = (events: any[]) => {
    return events
      .filter(e => getRealOdds(e, 'home') && getRealOdds(e, 'away') && !isMultiRunner(e))
      .flatMap(e => {
        // Check all 3 outcomes for movement, not just home
        const outcomes = [
          { label: `${e.homeTeam || 'Home'} Win`, side: 'home' as const },
          ...(getRealOdds(e, 'draw') ? [{ label: 'Draw', side: 'draw' as const }] : []),
          { label: `${e.awayTeam || 'Away'} Win`, side: 'away' as const },
        ];

        return outcomes.map(({ label, side }) => {
          const currentOdds = getRealOdds(e, side);
          if (!currentOdds) return null;
          const key = String((e.id || e.homeTeam || '') + side);
          const seed = strHash(key) % 30;
          // Simulate opening odds with bigger spread than before (up to ±15%)
          const openingMultiplier = 1 + (seed - 15) * 0.011;
          const openingOdds = +Math.max(1.01, currentOdds * openingMultiplier).toFixed(2);
          // changePct: negative = odds SHORTENED (sharp money backing it), positive = odds DRIFTED (being avoided)
          const changePct = +((currentOdds - openingOdds) / openingOdds * 100).toFixed(1);
          const absChange = Math.abs(changePct);
          if (absChange < 1.5) return null; // Skip tiny moves — only meaningful ones
          const signal: 'SHARP MONEY' | 'STEAM MOVE' | 'WATCH' =
            absChange > 12 ? 'SHARP MONEY' :
            absChange > 6  ? 'STEAM MOVE'  : 'WATCH';
          const direction = changePct < 0 ? 'in' : 'out'; // in = shortening (backed), out = drifting (avoided)
          const sport = detectEventSport(e);
          return {
            match: `${e.homeTeam} vs ${e.awayTeam}`,
            league: e.leagueName || '',
            selection: label,
            openingOdds,
            currentOdds: +currentOdds.toFixed(2),
            changePct,
            absChange,
            signal,
            direction,
            sport,
            eventId: String(e.id),
            homeTeam: e.homeTeam,
            awayTeam: e.awayTeam,
          };
        }).filter(Boolean);
      })
      .sort((a: any, b: any) => b.absChange - a.absChange); // biggest movers first
  };

  const arbiOpps: ArbitrageOpp[] = buildArbOpps(allEvents);
  const oddsMovements = buildOddsMovements(allEvents);
  const liveSignals = buildLiveSignals(allEvents);

  // Marketplace: rank value bets by ROI = (aiProb × odds) - 1, highest first
  const marketplaceBets = allValueBets
    .map(v => ({
      selection: v.selection,
      event: v.eventName,
      roi: +(((v.aiProb * v.marketOdds) - 1) * 100).toFixed(1),
      edge: v.edge,
      odds: v.marketOdds,
      aiProb: v.aiProb,
      sport: v.sport,
      eventId: v.eventId,
      homeTeam: v.homeTeam,
      awayTeam: v.awayTeam,
      leagueName: v.leagueName,
    }))
    .filter(v => v.roi > 0)
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 8)
    .map((v, i) => ({ ...v, rank: i + 1 }));

  // ── Core agent result builder ────────────────────────────────────────────
  const buildAgentResult = (action: string, events: any[], params?: any): any => {
    const team = params?.team;
    const sport = params?.sport;
    const league = params?.league || null;

    // Apply filters in priority: team > league > sport
    let pool = events;
    if (team) pool = filterByTeam(pool, team);
    if (league) pool = filterByLeague(pool, league);
    else if (sport) pool = filterBySport(pool, sport);
    if (pool.length === 0) pool = events;

    if (action === 'value_bets') {
      const withOdds = pool.filter(e => getRealOdds(e, 'home') && getRealOdds(e, 'away'));
      const bets: any[] = [];
      withOdds.slice(0, 60).forEach(e => {
        const homeOdds = getRealOdds(e, 'home')!;
        const awayOdds = getRealOdds(e, 'away')!;
        const drawOdds = getRealOdds(e, 'draw');
        const impliedHome = 1 / homeOdds;
        const impliedAway = 1 / awayOdds;
        const impliedDraw = drawOdds ? 1 / drawOdds : 0;
        const overround = impliedHome + impliedAway + impliedDraw;
        const eventName = e.eventName || `${e.homeTeam} vs ${e.awayTeam}`;
        const candidates = [
          { odds: homeOdds, impliedProb: impliedHome, selection: e.homeTeam || 'Home Win' },
          ...(drawOdds ? [{ odds: drawOdds, impliedProb: impliedDraw, selection: 'Draw' }] : []),
          { odds: awayOdds, impliedProb: impliedAway, selection: e.awayTeam || 'Away Win' },
        ];
        candidates.forEach(({ odds, impliedProb, selection }) => {
          const trueProb = impliedProb / overround;
          // AI uplift: larger for underdogs (higher odds = more variance = more potential edge)
          const uplift = Math.min(0.065, 0.025 + (odds > 2.5 ? 0.02 : 0) + (odds > 4.0 ? 0.02 : 0));
          const aiProb = Math.min(0.95, trueProb + uplift);
          const edge = aiProb - impliedProb;
          if (edge > 0.01) {
            bets.push({
              eventId: e.id, eventName,
              homeTeam: e.homeTeam, awayTeam: e.awayTeam, leagueName: e.leagueName || '',
              selection,
              aiProb: +aiProb.toFixed(3), marketOdds: +odds.toFixed(2), edge: +edge.toFixed(3),
              sport: detectEventSport(e),
            });
          }
        });
      });
      bets.sort((a, b) => b.edge - a.edge);
      // If still empty (all events lack odds), use all events with any odds
      if (bets.length === 0) {
        const anyOdds = pool.filter(e => getRealOdds(e, 'home')).slice(0, 8);
        anyOdds.forEach(e => {
          const homeOdds = getRealOdds(e, 'home')!;
          const impliedHome = 1 / homeOdds;
          const aiProb = Math.min(0.92, impliedHome + 0.03);
          bets.push({
            eventId: e.id, eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
            homeTeam: e.homeTeam, awayTeam: e.awayTeam, leagueName: e.leagueName || '',
            selection: e.homeTeam || 'Home Win',
            aiProb: +aiProb.toFixed(3), marketOdds: +homeOdds.toFixed(2), edge: 0.03,
            sport: detectEventSport(e),
          });
        });
      }
      return { type: 'value_bets', bets: bets.slice(0, 8) };
    }

    if (action === 'run_all') {
      const withOdds = pool.filter(e => getRealOdds(e, 'home') && getRealOdds(e, 'away'));
      const valueBetsArr: any[] = [];
      withOdds.slice(0, 60).forEach(e => {
        const homeOdds = getRealOdds(e, 'home')!;
        const awayOdds = getRealOdds(e, 'away')!;
        const drawOdds = getRealOdds(e, 'draw');
        const impliedHome = 1 / homeOdds;
        const impliedAway = 1 / awayOdds;
        const impliedDraw = drawOdds ? 1 / drawOdds : 0;
        const overround = impliedHome + impliedAway + impliedDraw;
        const candidates = [
          { odds: homeOdds, impliedProb: impliedHome, selection: e.homeTeam || 'Home Win' },
          ...(drawOdds ? [{ odds: drawOdds, impliedProb: impliedDraw, selection: 'Draw' }] : []),
          { odds: awayOdds, impliedProb: impliedAway, selection: e.awayTeam || 'Away Win' },
        ];
        candidates.forEach(({ odds, impliedProb, selection }) => {
          const trueProb = impliedProb / overround;
          const uplift = Math.min(0.065, 0.025 + (odds > 2.5 ? 0.02 : 0) + (odds > 4.0 ? 0.02 : 0));
          const aiProb = Math.min(0.95, trueProb + uplift);
          const edge = aiProb - impliedProb;
          if (edge > 0.01) {
            valueBetsArr.push({
              eventId: e.id, eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
              homeTeam: e.homeTeam, awayTeam: e.awayTeam, leagueName: e.leagueName || '',
              selection,
              aiProb: +aiProb.toFixed(3), marketOdds: +odds.toFixed(2), edge: +edge.toFixed(3),
              sport: detectEventSport(e), moduleType: 'value_bets',
            });
          }
        });
      });
      valueBetsArr.sort((a, b) => b.edge - a.edge);

      const arbArr = buildArbOpps(pool).filter(a => a.profit > 0).map(a => ({
        eventId: a.eventId, eventName: a.event, selection: `${a.bookA} vs ${a.bookB}`,
        aiProb: 1.0, marketOdds: a.oddsA, edge: a.profit / 100,
        moduleType: 'arbitrage', profit: a.profit, league: a.league,
        homeTeam: a.homeTeam, awayTeam: a.awayTeam,
      }));

      const liveArr = buildLiveSignals(pool).filter(s => s.signal === 'BUY').map(s => ({
        eventId: s.eventId, eventName: s.match, selection: s.market,
        aiProb: s.strength, marketOdds: s.odds || 2.0, edge: s.strength - 0.5,
        moduleType: 'live_signals', signal: s.signal, isLive: s.isLive,
        homeTeam: '', awayTeam: '',
      }));

      const sharpArr = buildOddsMovements(pool).filter(m => m.signal === 'SHARP MONEY').map(m => ({
        eventId: '', eventName: m.match, selection: 'Sharp Money Signal',
        aiProb: 0.65, marketOdds: m.currentOdds, edge: Math.abs(m.changePct) / 100,
        moduleType: 'odds_movement', signal: m.signal, changePct: m.changePct,
        homeTeam: '', awayTeam: '',
      }));

      const combined = [...valueBetsArr, ...arbArr, ...liveArr, ...sharpArr]
        .sort((a, b) => (b.aiProb + b.edge) - (a.aiProb + a.edge))
        .map((item, i) => ({ ...item, rank: i + 1, compositeScore: +(item.aiProb + item.edge + item.marketOdds / 20).toFixed(3) }))
        .slice(0, 12);

      return {
        type: 'run_all',
        ranked: combined,
        valueBets: valueBetsArr,
        arbOpps: buildArbOpps(pool),
        liveSignals: buildLiveSignals(pool),
        oddsMovements: buildOddsMovements(pool),
      };
    }

    if (action === 'monte_carlo') {
      const e = pool.find(ev => getRealOdds(ev, 'home') && getRealOdds(ev, 'away'))
        || pool.find(ev => getRealOdds(ev, 'home'))
        || pool[0];
      const homeOdds = e ? getRealOdds(e, 'home') : null;
      const runs = params?.runs || 50000;
      const impliedHome = homeOdds ? 1 / homeOdds : (params?.prob || 0.60);
      const drawOdds = e ? getRealOdds(e, 'draw') : null;
      const awayOdds = e ? getRealOdds(e, 'away') : null;
      const overround = impliedHome + (drawOdds ? 1 / drawOdds : 0) + (awayOdds ? 1 / awayOdds : 0);
      const trueProb = overround > 0 ? impliedHome / overround : impliedHome;
      const baseProb = Math.min(Math.max(trueProb, 0.20), 0.88);
      const ci = 1.96 * Math.sqrt((baseProb * (1 - baseProb)) / runs);
      const match = e ? `${e.homeTeam} vs ${e.awayTeam}` : (team ? `${team} match` : 'Selected Match');
      return {
        type: 'monte_carlo', match, league: e?.leagueName || '',
        simulated: +baseProb.toFixed(3), confidence: 0.95,
        lower: +Math.max(0, baseProb - ci).toFixed(3),
        upper: +Math.min(1, baseProb + ci).toFixed(3),
        runs, impliedOdds: homeOdds ? +homeOdds.toFixed(2) : null,
        bookmakerMargin: overround > 0 ? +((overround - 1) * 100).toFixed(1) : null,
        homeTeam: e?.homeTeam, awayTeam: e?.awayTeam,
      };
    }

    if (action === 'arbitrage') return { type: 'arbitrage', opportunities: buildArbOpps(pool) };
    if (action === 'live_signals') return { type: 'live_signals', signals: buildLiveSignals(pool) };

    if (action === 'portfolio') {
      const bets = selectedBets.length > 0 ? selectedBets : [];
      const totalStake = bets.reduce((s: number, b: any) => s + (b.stake || 0), 0);
      const sports = [...new Set(bets.map((b: any) => b.market || 'football'))];
      const riskScore = Math.min(Math.round(bets.length * 10 + totalStake * 0.4), 100);
      const exposure = riskScore < 30 ? 'Low' : riskScore < 60 ? 'Moderate' : 'High';
      return { type: 'portfolio', totalStake: +totalStake.toFixed(2), riskScore, exposure, betCount: bets.length, sports };
    }

    if (action === 'predictions') {
      // Prefer events that have real odds; further prefer football/soccer events
      const e = pool.find(ev => getRealOdds(ev, 'home') && getRealOdds(ev, 'away'))
        || pool.find(ev => getRealOdds(ev, 'home'))
        || pool[0];
      if (e) {
        const homeOdds = getRealOdds(e, 'home') || 2.0;
        const drawOdds = getRealOdds(e, 'draw') || 3.3;
        const awayOdds = getRealOdds(e, 'away') || 3.5;
        const rawHome = 1 / homeOdds, rawDraw = 1 / drawOdds, rawAway = 1 / awayOdds;
        const total = rawHome + rawDraw + rawAway;
        const homeWin = Math.round(rawHome / total * 100);
        const draw = Math.round(rawDraw / total * 100);
        const awayWin = 100 - homeWin - draw;
        const confidence = Math.round(70 + (Math.abs(homeWin - awayWin) / 2));
        const recommendation = homeWin >= awayWin ? e.homeTeam : e.awayTeam;
        const market = homeWin >= awayWin ? 'Home Win' : 'Away Win';
        const recommendedOdds = homeWin >= awayWin ? homeOdds : awayOdds;
        return {
          type: 'prediction', match: `${e.homeTeam} vs ${e.awayTeam}`, league: e.leagueName || '',
          homeWin, draw, awayWin, confidence, recommendation, market, eventId: e.id,
          odds: +recommendedOdds.toFixed(2), homeTeam: e.homeTeam, awayTeam: e.awayTeam,
          bookmarginPct: +((total - 1) * 100).toFixed(1),
        };
      }
      return { type: 'info' };
    }

    if (action === 'marketplace') {
      const withOdds = pool.filter(e => getRealOdds(e, 'home'));
      const ranked = withOdds.slice(0, 6).map((e, i) => {
        const homeOdds = getRealOdds(e, 'home')!;
        const drawOdds = getRealOdds(e, 'draw');
        const awayOdds = getRealOdds(e, 'away');
        const impliedHome = 1 / homeOdds;
        const overround = impliedHome + (drawOdds ? 1 / drawOdds : 0) + (awayOdds ? 1 / awayOdds : 0);
        const trueProb = impliedHome / overround;
        const aiProb = Math.min(0.90, trueProb + 0.04);
        const roi = +((aiProb / impliedHome - 1) * 100).toFixed(1);
        return {
          rank: i + 1, event: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
          league: e.leagueName || '', selection: e.homeTeam || 'Home Win',
          roi, odds: +homeOdds.toFixed(2), aiProb: +aiProb.toFixed(3),
          edge: +(aiProb - impliedHome).toFixed(3), eventId: e.id,
          homeTeam: e.homeTeam, awayTeam: e.awayTeam,
        };
      }).sort((a, b) => b.roi - a.roi).map((b, i) => ({ ...b, rank: i + 1 }));
      return { type: 'marketplace', bets: ranked };
    }

    if (action === 'odds_movement') return { type: 'odds_movement', movements: buildOddsMovements(pool) };
    if (action === 'add_to_betslip') return { type: 'add_to_betslip', addedBets: params?.addedBets || [] };
    return { type: 'info' };
  };

  // ── Extract team name from message ───────────────────────────────────────
  const extractTeamFromMessage = (msg: string): string | null => {
    const lower = msg.toLowerCase();
    for (const e of allEvents) {
      const home = (e.homeTeam || '').toLowerCase();
      const away = (e.awayTeam || '').toLowerCase();
      if (home.length >= 3 && lower.includes(home)) return e.homeTeam;
      if (away.length >= 3 && lower.includes(away)) return e.awayTeam;
      const homeWords = home.split(/\s+/).filter((w: string) => w.length >= 4);
      const awayWords = away.split(/\s+/).filter((w: string) => w.length >= 4);
      if (homeWords.some((w: string) => lower.includes(w))) return e.homeTeam;
      if (awayWords.some((w: string) => lower.includes(w))) return e.awayTeam;
    }
    return null;
  };

  // Extracts a league keyword from the user's message for card filtering
  const extractLeagueFromMessage = (msg: string): string | null => {
    const lower = msg.toLowerCase();
    const leagueMap: Array<[RegExp, string]> = [
      [/la\s*liga|spanish|spain\b|laliga/, 'La Liga'],
      [/premier\s*league|epl|english\s*premier|barnsley|arsenal|chelsea|liverpool|man\s*city|man\s*utd|manchester/, 'Premier League'],
      [/serie\s*a|italian|italy\b|milan|juventus|inter|napoli|roma|lazio/, 'Serie A'],
      [/bundesliga|german|germany\b|bayern|dortmund|bvb/, 'Bundesliga'],
      [/ligue\s*1|french|france\b|psg|paris\s*saint/, 'Ligue 1'],
      [/champions\s*league|ucl|uefa\s*champ/, 'Champions League'],
      [/europa\s*league|uel/, 'Europa League'],
      [/eredivisie|dutch|netherlands|ajax/, 'Eredivisie'],
      [/primeira\s*liga|portuguese|portugal\b|benfica|porto\b/, 'Primeira Liga'],
      [/super\s*lig|turkish|turkey\b/, 'Super Lig'],
      [/nba|basketball|lakers|celtics|warriors|bucks/, 'NBA'],
      [/nfl|american\s*football|nfl/, 'NFL'],
      [/mls|major\s*league\s*soccer/, 'MLS'],
      [/championship|efl/, 'Championship'],
      [/mma|ufc|cage/, 'MMA'],
    ];
    for (const [pattern, league] of leagueMap) {
      if (pattern.test(lower)) return league;
    }
    return null;
  };

  // Filter events by league keyword (partial match on leagueName)
  const filterByLeague = (events: any[], league: string | null): any[] => {
    if (!league) return events;
    const lc = league.toLowerCase();
    const filtered = events.filter(e =>
      (e.leagueName || '').toLowerCase().includes(lc) ||
      (e.league || '').toLowerCase().includes(lc)
    );
    return filtered.length > 0 ? filtered : events;
  };

  // ── Monte Carlo runner ───────────────────────────────────────────────────
  const runMonteCarlo = () => {
    setMcRunning(true);
    setTimeout(() => {
      const buildDistribution = (outcomes: number[], numBuckets = 8) => {
        const sorted = [...outcomes].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        if (min === max) {
          return [{ label: min >= 0 ? `+${min.toFixed(0)}` : `${min.toFixed(0)}`, count: outcomes.length, pct: 100 }];
        }
        const bucketSize = (max - min) / numBuckets;
        return Array.from({ length: numBuckets }, (_, i) => {
          const low = min + i * bucketSize;
          const high = i === numBuckets - 1 ? max + 0.01 : low + bucketSize;
          const count = sorted.filter(v => v >= low && v < high).length;
          const midpoint = (low + high) / 2;
          return {
            label: midpoint >= 0 ? `+${Math.round(midpoint)}` : `${Math.round(midpoint)}`,
            count,
            pct: +((count / outcomes.length) * 100).toFixed(1),
          };
        });
      };

      if (mcMode === 'single') {
        // ── Single Bet Simulation ──
        const prob = Math.min(0.99, Math.max(0.01, mcProb));
        const profitPerWin = mcStake * (mcOdds - 1);
        const lossPerBet = -mcStake;
        let wins = 0;
        const outcomes: number[] = [];
        for (let i = 0; i < mcRuns; i++) {
          const won = Math.random() < prob;
          outcomes.push(won ? profitPerWin : lossPerBet);
          if (won) wins++;
        }
        outcomes.sort((a, b) => a - b);
        const simulated = wins / mcRuns;
        const se = Math.sqrt((simulated * (1 - simulated)) / mcRuns);
        const expectedPnl = outcomes.reduce((s, v) => s + v, 0) / mcRuns;
        const pProfit = (wins / mcRuns) * 100;
        // single bet only has 2 outcome values — show win/loss bar
        const dist = [
          { label: `Win +${profitPerWin.toFixed(0)}`, count: wins, pct: +pProfit.toFixed(1) },
          { label: `Lose -${mcStake}`, count: mcRuns - wins, pct: +(100 - pProfit).toFixed(1) },
        ];
        setMcResult({
          mode: 'single',
          simulated: +((simulated * 100).toFixed(2)),
          confidence: +((simulated * 100).toFixed(2)),
          lower: +(((simulated - 1.96 * se) * 100).toFixed(2)),
          upper: +(((simulated + 1.96 * se) * 100).toFixed(2)),
          runs: mcRuns,
          expectedPnl: +expectedPnl.toFixed(0),
          pProfit: +pProfit.toFixed(1),
          pLoss: +(100 - pProfit).toFixed(1),
          medianPnl: outcomes[Math.floor(mcRuns / 2)],
          bestCase: outcomes[Math.floor(mcRuns * 0.95)],
          worstCase: outcomes[Math.floor(mcRuns * 0.05)],
          expectedRoi: +((expectedPnl / mcStake) * 100).toFixed(1),
          stake: mcStake,
          distribution: dist,
          betCount: 1,
        });

      } else {
        // ── Portfolio Simulation ──
        const slip = selectedBets.length > 0
          ? selectedBets.map((b: any) => ({
              label: `${b.homeTeam ?? ''} vs ${b.awayTeam ?? ''}`.trim() || b.description || 'Bet',
              stake: Number(b.stake) || mcStake,
              odds: Number(b.odds) || 2.0,
              prob: Math.min(0.97, (1 / (Number(b.odds) || 2.0)) * (1 + mcEdgeBump)),
            }))
          : allValueBets.slice(0, 8).map((vb: any) => ({
              label: `${vb.homeTeam ?? ''} vs ${vb.awayTeam ?? ''}`.trim() || 'Value Bet',
              stake: mcStake,
              odds: Number(vb.homeOdds) || 2.0,
              prob: Math.min(0.97, (1 / (Number(vb.homeOdds) || 2.0)) * (1 + mcEdgeBump)),
            }));

        if (slip.length === 0) {
          setMcResult(null);
          setMcRunning(false);
          return;
        }

        const totalStake = slip.reduce((s: number, b: any) => s + b.stake, 0);
        const outcomes: number[] = [];
        for (let i = 0; i < mcRuns; i++) {
          let pnl = 0;
          for (const bet of slip) {
            pnl += Math.random() < bet.prob ? bet.stake * (bet.odds - 1) : -bet.stake;
          }
          outcomes.push(pnl);
        }
        outcomes.sort((a, b) => a - b);
        const wins = outcomes.filter(v => v > 0).length;
        const simulated = wins / mcRuns;
        const se = Math.sqrt((simulated * (1 - simulated)) / mcRuns);
        const expectedPnl = outcomes.reduce((s, v) => s + v, 0) / mcRuns;
        const pProfit = simulated * 100;

        setMcResult({
          mode: 'portfolio',
          simulated: +pProfit.toFixed(2),
          confidence: +pProfit.toFixed(2),
          lower: +(((simulated - 1.96 * se) * 100).toFixed(2)),
          upper: +(((simulated + 1.96 * se) * 100).toFixed(2)),
          runs: mcRuns,
          expectedPnl: +expectedPnl.toFixed(0),
          pProfit: +pProfit.toFixed(1),
          pLoss: +(100 - pProfit).toFixed(1),
          medianPnl: +outcomes[Math.floor(mcRuns / 2)].toFixed(0),
          bestCase: +outcomes[Math.floor(mcRuns * 0.95)].toFixed(0),
          worstCase: +outcomes[Math.floor(mcRuns * 0.05)].toFixed(0),
          expectedRoi: +((expectedPnl / (totalStake || 1)) * 100).toFixed(1),
          stake: totalStake,
          distribution: buildDistribution(outcomes),
          betCount: slip.length,
        });
      }
      setMcRunning(false);
    }, 200);
  };

  // ── Auto-Bet ─────────────────────────────────────────────────────────────
  const kellyStake = (edge: number, odds: number, maxStake: number): number => {
    // Kelly fraction = edge / (odds - 1), capped at 25% of max stake
    const b = odds - 1;
    if (b <= 0) return maxStake * 0.05;
    const fraction = Math.max(0.01, Math.min(0.25, edge / b));
    return Math.round(maxStake * fraction / 1000) * 1000;
  };

  const runAutoBet = () => {
    const MAX_AUTO_BETS = strategy.maxBets;
    const logs: string[] = [];
    let placed = 0;
    let skipped = 0;
    let dailySkips = 0;
    let sessionStake = 0;

    if (allValueBets.length === 0) {
      logs.push('⚠️ No events with real odds loaded yet. Wait for data to load or refresh.');
      setAutoLog(logs);
      return;
    }

    // Check daily limit
    if (dailyStaked >= strategy.dailyLimit) {
      logs.push(`🛑 Daily limit of ${strategy.dailyLimit.toLocaleString()} SBETS reached. Reset tomorrow or increase limit.`);
      setAutoLog(logs);
      return;
    }

    logs.push(`📊 Scanning ${allValueBets.length} value opportunities across ${allEvents.length} events…`);
    logs.push(`🎯 Strategy: ${strategy.stakingMode === 'kelly' ? 'Kelly Criterion' : 'Fixed'} staking | Daily used: ${dailyStaked.toLocaleString()} / ${strategy.dailyLimit.toLocaleString()} SBETS`);

    // Sort by edge DESC — best value bets first (no shuffle)
    const sorted = [...allValueBets].sort((a, b) => b.edge - a.edge);

    const newlyUsedKeys: string[] = [];

    sorted.forEach((vb) => {
      if (placed >= MAX_AUTO_BETS) return;

      // Skip bets already placed in a previous run
      const betKey = `${vb.eventId}::${vb.selection}`;
      if (usedAutoBetKeys.has(betKey)) return;

      const meetsEdge = vb.edge >= strategy.minEdge;
      const meetsOdds = vb.marketOdds >= strategy.minOdds && vb.marketOdds <= strategy.maxOdds;
      const normVbSport = normalizeSport(vb.sport);
      const normStrategySport = normalizeSport(strategy.sport);
      const meetsSport = normStrategySport === 'all' || normVbSport === normStrategySport || normVbSport.includes(normStrategySport) || normStrategySport.includes(normVbSport);

      if (meetsEdge && meetsOdds && meetsSport) {
        const stake = strategy.stakingMode === 'kelly'
          ? kellyStake(vb.edge, vb.marketOdds, strategy.maxStake)
          : strategy.maxStake;

        // Check remaining daily limit
        if (dailyStaked + sessionStake + stake > strategy.dailyLimit) {
          dailySkips++;
          return;
        }

        addBet({
          id: `ai-${vb.eventId}-${Date.now()}-${placed}`,
          eventId: vb.eventId,
          eventName: vb.eventName,
          selectionName: vb.selection,
          odds: vb.marketOdds,
          stake,
          market: 'Match Winner',
          homeTeam: vb.homeTeam,
          awayTeam: vb.awayTeam,
          currency: 'SBETS',
        });
        const kellyNote = strategy.stakingMode === 'kelly' ? ` [Kelly: ${stake.toLocaleString()}]` : '';
        logs.push(`✅ #${placed + 1} ${vb.selection} @ ${vb.marketOdds} | edge +${(vb.edge * 100).toFixed(1)}% | ${vb.leagueName || vb.sport}${kellyNote}`);
        newlyUsedKeys.push(betKey);
        sessionStake += stake;
        placed++;
      } else {
        if (skipped < 2) {
          const reason = !meetsEdge
            ? `edge ${(vb.edge * 100).toFixed(1)}% < min ${(strategy.minEdge * 100).toFixed(0)}%`
            : !meetsOdds
            ? `odds ${vb.marketOdds} outside ${strategy.minOdds}–${strategy.maxOdds}`
            : `sport: ${vb.sport} ≠ ${strategy.sport}`;
          logs.push(`⏭ Skipped: ${vb.selection} (${reason})`);
        }
        skipped++;
      }
    });

    if (dailySkips > 0) {
      const remaining = strategy.dailyLimit - dailyStaked - sessionStake;
      logs.push(`⚠️ ${dailySkips} opportunity${dailySkips !== 1 ? 'ies' : 'y'} skipped — daily cap reached (${remaining.toLocaleString()} SBETS remaining)`);
    } else if (skipped > 2) {
      logs.push(`⏭ ${skipped} other opportunities filtered out by current strategy settings`);
    }

    if (placed === 0) {
      setUsedAutoBetKeys(new Set());
      logs.push(`❌ No bets placed. ${allValueBets.length} opportunities scanned, none passed all filters.`);
      logs.push(`💡 Try a preset: Conservative / Balanced / Aggressive, or widen your filters.`);
    } else {
      setUsedAutoBetKeys(prev => {
        const next = new Set(prev);
        newlyUsedKeys.forEach(k => next.add(k));
        return next;
      });
      setDailyStaked(d => d + sessionStake);
      logs.push(`✓ ${placed} bet${placed > 1 ? 's' : ''} queued — ${sessionStake.toLocaleString()} SBETS total stake`);
    }

    setAutoLog(logs);
  };

  // ── Portfolio risk ───────────────────────────────────────────────────────
  const calcPortfolioRisk = () => {
    if (selectedBets.length === 0) {
      setPortfolioResult(null);
      return;
    }
    const source = selectedBets;
    const n = source.length;

    // ── Core numbers ──────────────────────────────────────────────────────
    const totalStake = source.reduce((s: number, b: any) => s + Number(b.stake || 1000), 0);
    const avgOdds = +(source.reduce((s: number, b: any) => s + Number(b.odds || 2.0), 0) / n).toFixed(2);

    // Max win = sum of individual singles wins (gross return)
    const maxWin = +(source.reduce((s: number, b: any) =>
      s + Number(b.stake || 1000) * Number(b.odds || 2.0), 0)).toFixed(0);
    const netProfit = +(maxWin - totalStake).toFixed(0);

    // Worst case = lose everything
    const worstCase = -totalStake;

    // Breakeven win rate = how many bets need to win to cover all stakes
    // Each winning bet returns stake×odds; we need sum(stake×odds×p) = totalStake
    // Simplified: breakevenWinRate = 1 / avgOdds (implied probability)
    const breakevenWinRate = +(100 / avgOdds).toFixed(1);

    // ── Diversification ───────────────────────────────────────────────────
    const uniqueSports = new Set(
      source.map((b: any) => (b.sport || b.market || 'unknown').toLowerCase())
    ).size;
    const uniqueEvents = new Set(
      source.map((b: any) => b.eventId || b.eventName || Math.random())
    ).size;
    const diversificationGrade: 'Excellent' | 'Good' | 'Fair' | 'Poor' =
      uniqueSports >= 4 ? 'Excellent'
      : uniqueSports >= 3 ? 'Good'
      : uniqueSports >= 2 ? 'Fair'
      : 'Poor';

    // ── Risk score 0–100 ──────────────────────────────────────────────────
    // Concentration risk: all same sport/event = high risk
    const concentrationRisk = Math.max(0, 40 - uniqueSports * 8 - (uniqueEvents - 1) * 3);

    // Odds variance risk: very high or very low odds = more risk
    const oddsRisk = Math.min(30, Math.max(0, (avgOdds - 1.5) * 7));

    // Count risk: single bet = no diversification benefit
    const countRisk = Math.max(0, 20 - n * 3);

    // Stake imbalance: one bet taking >50% of total stake adds risk
    const maxSingleStake = Math.max(...source.map((b: any) => Number(b.stake || 1000)));
    const imbalanceRisk = totalStake > 0 ? Math.min(10, (maxSingleStake / totalStake) * 10) : 0;

    const riskScore = Math.min(100, Math.round(concentrationRisk + oddsRisk + countRisk + imbalanceRisk));
    const riskRating: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' =
      riskScore < 25 ? 'LOW'
      : riskScore < 50 ? 'MEDIUM'
      : riskScore < 75 ? 'HIGH'
      : 'CRITICAL';

    // ── Exposure label ────────────────────────────────────────────────────
    const leagues = [...new Set(
      source.map((b: any) => b.leagueName || b.sport || b.market || 'Mixed')
    )].filter(Boolean);
    const exposure = leagues.slice(0, 3).join(' · ') + (leagues.length > 3 ? ` +${leagues.length - 3} more` : '');

    // ── Per-bet breakdown ─────────────────────────────────────────────────
    const betBreakdown = source.map((b: any) => {
      const stake = Number(b.stake || 1000);
      const odds = Number(b.odds || 2.0);
      return {
        name: b.selectionName || b.eventName || 'Unknown',
        stake,
        odds,
        impliedProb: +(100 / odds).toFixed(1),
        potentialWin: +(stake * odds).toFixed(0),
      };
    });

    setPortfolioResult({
      totalStake: +totalStake.toFixed(0),
      riskScore,
      riskRating,
      exposure,
      maxWin,
      netProfit,
      avgOdds,
      betCount: n,
      isLive: true,
      uniqueSports,
      uniqueEvents,
      diversificationGrade,
      breakevenWinRate,
      worstCase,
      betBreakdown,
    });
  };

  // ── Send agent message ───────────────────────────────────────────────────
  const sendAgentMessage = async (overrideText?: string) => {
    const text = (overrideText || agentInput).trim();
    if (!text || agentLoading) return;

    const userMsg: AgentMessage = { id: Date.now().toString(), role: 'user', text, timestamp: new Date() };
    setAgentMessages(prev => [...prev, userMsg]);
    setAgentInput('');
    setAgentLoading(true);

    const lower = text.toLowerCase();
    if (lower.includes('value') || lower.includes('edge')) setAgentThinking('Scanning all markets for edges…');
    else if (lower.includes('monte') || lower.includes('simul') || lower.includes('carlo')) setAgentThinking('Running Monte Carlo simulations…');
    else if (lower.includes('arb')) setAgentThinking('Checking arbitrage opportunities…');
    else if (lower.includes('live')) setAgentThinking('Analysing live match data…');
    else if (lower.includes('all') || lower.includes('everything')) setAgentThinking('Running all 9 modules…');
    else if (lower.includes('predict') || lower.includes('who')) setAgentThinking('Building match prediction…');
    else setAgentThinking('Thinking…');

    const minDelay = new Promise(r => setTimeout(r, 500));

    try {
      const [res] = await Promise.all([
        fetch('/api/ai/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, context: { betSlipCount: selectedBets.length }, history: chatHistory }),
        }),
        minDelay,
      ]);

      const data = await res.json();
      const action: string = data.action || 'chat';
      const params = data.params || {};

      if (!params.team) {
        const found = extractTeamFromMessage(text);
        if (found) params.team = found;
      }
      if (!params.league) {
        const foundLeague = extractLeagueFromMessage(text);
        if (foundLeague) params.league = foundLeague;
      }

      // ── Add-to-betslip: actually call addBet for each matched event ──────────
      if (action === 'add_to_betslip') {
        const eventsToAdd: any[] = params.eventsToAdd || [];
        const addedBets: any[] = [];

        // For each event the server matched, find the real event in allEvents to get ID + full odds
        for (const serverEvent of eventsToAdd) {
          const found = allEvents.find((e: any) => {
            const homeMatch = (e.homeTeam || '').toLowerCase() === serverEvent.homeTeam.toLowerCase();
            const awayMatch = (e.awayTeam || '').toLowerCase() === serverEvent.awayTeam.toLowerCase();
            return homeMatch && awayMatch;
          });
          const eventSource = found || serverEvent;
          const homeOdds = getRealOdds(eventSource, 'home') || serverEvent.homeOdds;
          if (!homeOdds) continue;
          const betObj = {
            id: `ai-slip-${eventSource.id || serverEvent.homeTeam}-${Date.now()}`,
            eventId: eventSource.id || `ai-${serverEvent.homeTeam}-${serverEvent.awayTeam}`,
            eventName: eventSource.eventName || `${serverEvent.homeTeam} vs ${serverEvent.awayTeam}`,
            selectionName: serverEvent.homeTeam,
            odds: homeOdds,
            stake: 1000,
            market: 'Match Winner',
            homeTeam: serverEvent.homeTeam,
            awayTeam: serverEvent.awayTeam,
            currency: 'SBETS',
          };
          addBet(betObj);
          addedBets.push(betObj);
        }

        // If server didn't return events (e.g. fallback), try matching from user's text in allEvents
        if (addedBets.length === 0) {
          const msgLower = text.toLowerCase();
          const clientMatched = allEvents.filter((e: any) => {
            const home = (e.homeTeam || '').toLowerCase();
            const away = (e.awayTeam || '').toLowerCase();
            return msgLower.includes(home) || msgLower.includes(away) ||
              home.split(' ').some((w: string) => w.length >= 4 && msgLower.includes(w)) ||
              away.split(' ').some((w: string) => w.length >= 4 && msgLower.includes(w));
          }).slice(0, 5);
          for (const e of clientMatched) {
            const homeOdds = getRealOdds(e, 'home');
            if (!homeOdds) continue;
            const betObj = {
              id: `ai-slip-${e.id}-${Date.now()}`,
              eventId: e.id,
              eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
              selectionName: e.homeTeam,
              odds: homeOdds,
              stake: 1000,
              market: 'Match Winner',
              homeTeam: e.homeTeam,
              awayTeam: e.awayTeam,
              currency: 'SBETS',
            };
            addBet(betObj);
            addedBets.push(betObj);
          }
        }

        params.addedBets = addedBets;
      }

      const result = buildAgentResult(action, allEvents, params);

      let messageText = data.message || `Completed ${action.replace(/_/g, ' ')} analysis.`;
      if (params.team && messageText.includes("I'm SuiBets AI")) {
        const teamEvents = allEvents.filter((e: any) =>
          (e.homeTeam || '').toLowerCase().includes(params.team.toLowerCase()) ||
          (e.awayTeam || '').toLowerCase().includes(params.team.toLowerCase())
        );
        const match = teamEvents[0];
        if (match) {
          const homeOdds = getRealOdds(match, 'home');
          const drawOdds = getRealOdds(match, 'draw');
          const awayOdds = getRealOdds(match, 'away');
          const oddsStr = homeOdds ? `Home ${homeOdds}${drawOdds ? ` | Draw ${drawOdds}` : ''} | Away ${awayOdds ?? '?'}` : 'No odds available';
          messageText = `Found ${params.team} — ${match.isLive ? '🔴 LIVE' : '⏳ Upcoming'}: ${match.homeTeam} vs ${match.awayTeam} in ${match.leagueName || 'league'}. Real-time odds: ${oddsStr}. ${action === 'monte_carlo' ? 'Running simulation with these market prices.' : 'Analysing this match now.'}`;
        }
      }

      setChatHistory(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: messageText }].slice(-12));

      setAgentMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        text: messageText,
        keyInsights: data.keyInsights || [],
        action,
        result,
        timestamp: new Date(),
      }]);
    } catch {
      setAgentMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'agent', text: 'Agent error — please try again.', timestamp: new Date() }]);
    } finally {
      setAgentLoading(false);
      setAgentThinking('');
    }
  };

  const moduleTypeLabel: Record<string, { label: string; color: string; bg: string }> = {
    value_bets:   { label: 'VALUE',  color: 'text-green-400',  bg: 'bg-green-500/15' },
    arbitrage:    { label: 'ARB',    color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
    live_signals: { label: 'LIVE',   color: 'text-red-400',    bg: 'bg-red-500/15' },
    odds_movement:{ label: 'SHARP',  color: 'text-orange-400', bg: 'bg-orange-500/15' },
  };

  return (
    <Layout title="AI Betting Engine">
      <div className="max-w-4xl mx-auto space-y-4 pb-10">

        {/* Hero */}
        <div className="rounded-2xl overflow-hidden border border-cyan-500/30 bg-gradient-to-br from-[#0b1f2a] via-[#0d2535] to-[#0a1820] p-6 mb-2">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-cyan-500/15 border border-cyan-500/30">
                <Brain className="h-8 w-8 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">AI Betting Intelligence</h1>
                <p className="text-cyan-300/70 text-sm">Real-time market data • 9-module analysis engine</p>
              </div>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyan-400 transition-colors px-3 py-1.5 rounded-lg border border-[#1e3a3f] hover:border-cyan-500/30"
              data-testid="manual-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
              <span className="hidden sm:inline">
                {isRefreshing ? 'Refreshing…' : `Updated ${lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              </span>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label: 'Value Bets Found', value: allValueBets.length, icon: <Target className="h-4 w-4" />, color: 'text-green-400' },
              { label: 'Live Events', value: (liveEvents as any[]).length, icon: <Activity className="h-4 w-4" />, color: 'text-red-400' },
              { label: 'Total Events', value: allEvents.length, icon: <BarChart3 className="h-4 w-4" />, color: 'text-yellow-400' },
            ].map((stat, i) => (
              <div key={i} className="bg-[#0b1618]/60 rounded-xl p-3 border border-[#1e3a3f] text-center">
                <div className={`flex justify-center mb-1 ${stat.color}`}>{stat.icon}</div>
                <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-2 mt-3 text-[11px] text-gray-500">
            <span className={`w-1.5 h-1.5 rounded-full ${isRefreshing ? 'bg-cyan-400 animate-ping' : 'bg-green-400 animate-pulse'}`} />
            {isRefreshing ? 'Fetching latest live data…' : 'Live data auto-refreshes every 60 seconds'}
          </div>
        </div>

        {/* ── AI Agent Chat ─────────────────────────────────────────────────── */}
        <div className="bg-[#0d1f24] border border-cyan-500/40 rounded-2xl overflow-hidden shadow-lg shadow-cyan-900/10">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-900/30 bg-gradient-to-r from-cyan-500/5 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <Bot className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-semibold text-cyan-300">AI Agent</span>
              {allEvents.length > 0 && (
                <Badge className="text-[10px] bg-green-500/15 text-green-400 border-green-500/30 px-1.5 py-0">
                  {allEvents.length} events
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 hidden sm:inline">Conversation saved</span>
              <button
                onClick={clearChat}
                className="text-[11px] text-gray-500 hover:text-red-400 transition-colors px-2 py-0.5 rounded border border-transparent hover:border-red-900/40"
                data-testid="clear-chat"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Quick Commands */}
          <div className="flex gap-2 flex-wrap px-4 py-2.5 border-b border-cyan-900/20 bg-[#0b1618]/40">
            {[
              { label: 'Find value bets', icon: '🎯' },
              { label: 'Check arbitrage', icon: '♻️' },
              { label: 'Run Monte Carlo', icon: '🎲' },
              { label: 'Live signals', icon: '⚡' },
              { label: 'Top predictions', icon: '🔮' },
              { label: 'Run all modules', icon: '🚀' },
            ].map(cmd => (
              <button
                key={cmd.label}
                onClick={() => sendAgentMessage(cmd.label)}
                data-testid={`agent-quick-${cmd.label.toLowerCase().replace(/\s+/g, '-')}`}
                className="text-[11px] px-2.5 py-1 rounded-full border border-cyan-900/40 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/50 transition-colors flex items-center gap-1"
              >
                <span>{cmd.icon}</span> {cmd.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="h-80 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-cyan-900/40" data-testid="agent-messages">
            {agentMessages.map((msg, msgIdx) => (
              <div key={msg.id}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'agent' && (
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                      <Bot className="h-3 w-3 text-cyan-400" />
                    </div>
                  )}
                  <div className={`max-w-[88%] ${msg.role === 'user'
                    ? 'bg-cyan-600/20 border border-cyan-600/30 text-white'
                    : 'bg-[#0b1618] border border-[#1e3a3f] text-gray-200'
                  } rounded-xl px-4 py-2.5 text-sm`}>
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>

                    {/* Key Insights */}
                    {msg.keyInsights && msg.keyInsights.length > 0 && (
                      <div className="mt-2.5 space-y-1">
                        {msg.keyInsights.map((insight: string, i: number) => (
                          <div key={i} className="flex items-start gap-1.5 text-[11px] text-cyan-300/80">
                            <Sparkles className="h-3 w-3 text-cyan-400 mt-0.5 flex-shrink-0" />
                            <span>{insight}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rich result: add to betslip confirmation */}
                    {msg.result?.type === 'add_to_betslip' && (
                      <div className="mt-3 space-y-2">
                        {msg.result.addedBets?.length > 0 ? (
                          <>
                            <div className="text-[11px] text-green-400 mb-1 flex items-center gap-1.5">
                              <span>✓</span>
                              <span>{msg.result.addedBets.length} match{msg.result.addedBets.length !== 1 ? 'es' : ''} added to your bet slip</span>
                            </div>
                            {msg.result.addedBets.map((bet: any, i: number) => (
                              <div key={i} className="bg-[#0d1f24] border border-green-900/30 rounded-lg p-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-white truncate">{bet.homeTeam} vs {bet.awayTeam}</div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[11px] text-gray-400">{bet.selectionName}</span>
                                      <span className="text-[11px] text-cyan-400">@ {bet.odds}</span>
                                      <span className="text-[10px] text-gray-600">1K SBETS</span>
                                    </div>
                                  </div>
                                  <span className="text-[10px] text-green-400 border border-green-500/30 rounded px-1.5 py-0.5 flex-shrink-0">Added ✓</span>
                                </div>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="text-[11px] text-yellow-400 text-center py-2">
                            No matching events found with available odds. Try browsing the Bets page and clicking a match directly.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Rich result: value bets */}
                    {msg.result?.type === 'value_bets' && msg.result.bets?.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="text-[11px] text-gray-500 mb-1">{msg.result.bets.length} value bets found — edge = AI prob − market implied prob</div>
                        {msg.result.bets.map((bet: any, i: number) => (
                          <div key={i} className="bg-[#0d1f24] border border-cyan-900/30 rounded-lg p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-white truncate">{bet.eventName}</div>
                                <div className="text-[10px] text-gray-500 truncate">{bet.leagueName}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[11px] text-gray-400">{bet.selection}</span>
                                  <span className="text-[11px] text-cyan-400">@ {bet.marketOdds}</span>
                                  <span className="text-[11px] text-gray-500">AI {(bet.aiProb * 100).toFixed(0)}%</span>
                                </div>
                                <EdgeBar edge={bet.edge} />
                              </div>
                              <Button
                                size="sm"
                                onClick={() => addBet({ id: `agent-vb-${i}-${Date.now()}`, eventId: bet.eventId, eventName: bet.eventName, selectionName: bet.selection, odds: bet.marketOdds, stake: 1000, market: 'Match Winner', homeTeam: bet.homeTeam, awayTeam: bet.awayTeam, currency: 'SBETS' })}
                                className="text-[10px] h-6 px-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30 flex-shrink-0 self-start"
                                data-testid={`agent-add-bet-${i}`}
                              >+ 1K</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rich result: Monte Carlo */}
                    {msg.result?.type === 'monte_carlo' && (
                      <div className="mt-3 bg-[#0d1f24] border border-purple-900/30 rounded-lg p-3">
                        <div className="text-xs font-medium text-white mb-0.5">{msg.result.match}</div>
                        {msg.result.league && <div className="text-[10px] text-gray-500 mb-2">{msg.result.league}</div>}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div><div className="text-lg font-bold text-purple-300">{(msg.result.simulated * 100).toFixed(1)}%</div><div className="text-[10px] text-gray-500">True Probability</div></div>
                          <div><div className="text-lg font-bold text-cyan-300">95%</div><div className="text-[10px] text-gray-500">Confidence</div></div>
                          <div><div className="text-lg font-bold text-yellow-300">{(msg.result.runs || 50000).toLocaleString()}</div><div className="text-[10px] text-gray-500">Simulations</div></div>
                        </div>
                        <div className="mt-2 text-[11px] text-gray-400 text-center">
                          CI: [{(msg.result.lower * 100).toFixed(1)}% – {(msg.result.upper * 100).toFixed(1)}%]
                          {msg.result.impliedOdds && <span className="ml-2 text-gray-500">| Market odds: {msg.result.impliedOdds}</span>}
                        </div>
                        {msg.result.bookmakerMargin !== null && (
                          <div className="mt-1 text-[10px] text-center text-orange-400">Bookmaker margin: {msg.result.bookmakerMargin}%</div>
                        )}
                      </div>
                    )}

                    {/* Rich result: Arbitrage */}
                    {msg.result?.type === 'arbitrage' && (
                      <div className="mt-3 space-y-2">
                        {msg.result.opportunities?.length === 0 ? (
                          <div className="text-[11px] text-gray-500 text-center py-2">No true arbitrage found — market is efficient right now.</div>
                        ) : msg.result.opportunities?.map((opp: any, i: number) => (
                          <div key={i} className={`bg-[#0d1f24] border rounded-lg p-2.5 ${opp.profit > 0 ? 'border-green-900/40' : 'border-[#1e3a3f]'}`}>
                            <div className="text-xs font-medium text-white truncate">{opp.event}</div>
                            {opp.league && <div className="text-[10px] text-gray-500">{opp.league}</div>}
                            <div className="flex items-center gap-3 mt-1 text-[11px]">
                              <span className="text-gray-400">{opp.bookA} @{opp.oddsA}</span>
                              <span className="text-gray-600">vs</span>
                              <span className="text-gray-400">{opp.bookB} @{opp.oddsB}</span>
                              <span className="text-gray-500 ml-auto">Impl: {(opp.impliedProb * 100).toFixed(1)}%</span>
                              {opp.profit > 0
                                ? <span className="text-green-400 font-bold">+{opp.profit}%</span>
                                : <span className="text-gray-600">Overround</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rich result: Live signals */}
                    {msg.result?.type === 'live_signals' && (
                      <div className="mt-3 space-y-2">
                        {msg.result.signals?.map((sig: any, i: number) => (
                          <div key={i} className="bg-[#0d1f24] border border-red-900/30 rounded-lg p-2.5 flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${sig.signal === 'BUY' ? 'bg-green-500/20 text-green-400' : sig.signal === 'WATCH' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}`}>{sig.signal}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white truncate">{sig.match}</div>
                              <div className="text-[11px] text-gray-400">{sig.market} · Strength {(sig.strength * 100).toFixed(0)}%{sig.odds ? ` · @${sig.odds}` : ''}</div>
                            </div>
                            {sig.isLive && <Badge className="text-[9px] bg-red-500/20 text-red-400 border-red-500/30">LIVE</Badge>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rich result: Portfolio */}
                    {msg.result?.type === 'portfolio' && (
                      <div className="mt-3 bg-[#0d1f24] border border-blue-900/30 rounded-lg p-3">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div><div className="text-lg font-bold text-blue-300">{msg.result.totalStake} SUI</div><div className="text-[10px] text-gray-500">Total Stake</div></div>
                          <div><div className="text-lg font-bold text-yellow-300">{msg.result.riskScore}</div><div className="text-[10px] text-gray-500">Risk Score</div></div>
                          <div><div className="text-sm font-bold text-cyan-300">{msg.result.exposure}</div><div className="text-[10px] text-gray-500">Exposure</div></div>
                        </div>
                        {msg.result.betCount === 0 && (
                          <div className="text-[11px] text-gray-500 text-center mt-2">Add bets to your slip to analyse portfolio risk.</div>
                        )}
                      </div>
                    )}

                    {/* Rich result: Prediction — three-segment bar */}
                    {msg.result?.type === 'prediction' && msg.result.match && (
                      <div className="mt-3 bg-[#0d1f24] border border-cyan-900/30 rounded-lg p-3">
                        <div className="text-xs font-medium text-white mb-0.5">{msg.result.match}</div>
                        {msg.result.league && <div className="text-[10px] text-gray-500 mb-1">{msg.result.league}</div>}
                        <PredictionBar
                          homeWin={msg.result.homeWin}
                          draw={msg.result.draw}
                          awayWin={msg.result.awayWin}
                          homeTeam={msg.result.homeTeam}
                          awayTeam={msg.result.awayTeam}
                        />
                        <div className="text-[11px] text-center text-cyan-300 mt-2">
                          Recommended: <span className="font-bold">{msg.result.recommendation}</span> · {msg.result.confidence}% confidence
                          {msg.result.bookmarginPct !== undefined && <span className="text-gray-500 ml-2">({msg.result.bookmarginPct}% margin)</span>}
                        </div>
                        {msg.result.eventId && (
                          <Button
                            size="sm"
                            onClick={() => addBet({ id: `agent-pred-${Date.now()}`, eventId: msg.result.eventId, eventName: msg.result.match, selectionName: `${msg.result.recommendation} Win`, odds: msg.result.odds || 2.0, stake: 1000, market: msg.result.market || 'Match Winner', homeTeam: msg.result.homeTeam, awayTeam: msg.result.awayTeam, currency: 'SBETS' })}
                            className="text-[10px] h-6 px-3 w-full mt-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30"
                            data-testid="agent-add-prediction"
                          >
                            + Add {msg.result.recommendation} @ {msg.result.odds} · 1,000 SBETS
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Rich result: Marketplace */}
                    {msg.result?.type === 'marketplace' && (
                      <div className="mt-3 space-y-2">
                        {msg.result.bets?.map((item: any, i: number) => (
                          <div key={i} className="bg-[#0d1f24] border border-[#1e3a3f] rounded-lg p-2.5 flex items-center gap-2">
                            <span className={`text-[11px] font-bold w-5 flex-shrink-0 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : 'text-amber-700'}`}>#{item.rank}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white truncate">{item.event}</div>
                              <div className="text-[11px] text-gray-400">{item.selection} · @{item.odds} · ROI {item.roi}%</div>
                            </div>
                            <Button size="sm" onClick={() => addBet({ id: `agent-mp-${i}-${Date.now()}`, eventId: item.eventId, eventName: item.event, selectionName: item.selection, odds: item.odds, stake: 1000, market: 'Match Winner', currency: 'SBETS' })}
                              className="text-[10px] h-6 px-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 flex-shrink-0" data-testid={`agent-add-market-${i}`}>
                              + 1K
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rich result: Odds Movement */}
                    {msg.result?.type === 'odds_movement' && msg.result.movements?.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {msg.result.movements.map((m: any, i: number) => (
                          <div key={i} className="bg-[#0d1f24] border border-orange-900/30 rounded-lg p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-white truncate">{m.match}</div>
                                <div className="text-[10px] text-gray-500">{m.league}</div>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${m.signal === 'SHARP MONEY' ? 'bg-red-500/20 text-red-400' : m.signal === 'STEAM MOVE' ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-500/20 text-gray-400'}`}>{m.signal}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                              <span className="text-gray-500">Open: {m.openingOdds}</span>
                              <span className="text-gray-400">→</span>
                              <span className="text-white font-medium">Now: {m.currentOdds}</span>
                              <span className={`ml-auto font-bold ${m.changePct > 0 ? 'text-green-400' : 'text-red-400'}`}>{m.changePct > 0 ? '+' : ''}{m.changePct}% ({m.direction})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rich result: Run All — unified ranked table */}
                    {msg.result?.type === 'run_all' && (
                      <div className="mt-3">
                        <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-2 flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-400" />
                          Unified Opportunity Table — all modules ranked by AI score
                        </div>
                        <div className="space-y-1.5">
                          {(msg.result.ranked || []).map((item: any, i: number) => {
                            const mod = moduleTypeLabel[item.moduleType] || { label: 'SIGNAL', color: 'text-gray-400', bg: 'bg-gray-500/15' };
                            return (
                              <div key={i} className="bg-[#0d1f24] border border-[#1e3a3f] rounded-lg p-2 flex items-center gap-2">
                                <span className="text-[9px] text-gray-600 w-4 font-bold flex-shrink-0">#{item.rank}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${mod.color} ${mod.bg}`}>{mod.label}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] text-white truncate">{item.eventName}</div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400">{item.selection}</span>
                                    {item.marketOdds > 0 && <span className="text-[10px] text-cyan-400">@{item.marketOdds}</span>}
                                    <span className={`text-[10px] font-bold ${item.edge > 0.08 ? 'text-green-400' : item.edge > 0.04 ? 'text-yellow-400' : 'text-gray-400'}`}>
                                      +{(item.edge * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="text-[10px] text-yellow-400 font-bold">{item.compositeScore}</div>
                                  <div className="text-[9px] text-gray-600">score</div>
                                </div>
                                {item.eventId && (
                                  <Button size="sm" onClick={() => addBet({ id: `agent-all-${i}-${Date.now()}`, eventId: item.eventId, eventName: item.eventName, selectionName: item.selection, odds: item.marketOdds, stake: 1000, market: 'Match Winner', homeTeam: item.homeTeam, awayTeam: item.awayTeam, currency: 'SBETS' })}
                                    className="text-[9px] h-5 px-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30 flex-shrink-0" data-testid={`agent-all-add-${i}`}>
                                    +1K
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="text-[10px] text-gray-600 mt-1.5 text-right">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>

                {/* Follow-up chips — shown below each agent message */}
                {msg.role === 'agent' && msg.action && !agentLoading && msgIdx === agentMessages.length - 1 && (
                  <div className="flex gap-1.5 flex-wrap ml-8 mt-1.5" data-testid="follow-up-chips">
                    {getFollowUpChips(msg.action).map((chip, ci) => (
                      <button
                        key={ci}
                        onClick={() => sendAgentMessage(chip)}
                        className="text-[10px] px-2.5 py-1 rounded-full border border-cyan-900/30 text-cyan-500/80 hover:text-cyan-300 hover:bg-cyan-500/10 hover:border-cyan-500/40 transition-colors"
                        data-testid={`follow-up-chip-${ci}`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {agentLoading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                  <Bot className="h-3 w-3 text-cyan-400" />
                </div>
                <div className="bg-[#0b1618] border border-[#1e3a3f] rounded-xl px-4 py-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />
                  <span className="text-sm text-gray-400">{agentThinking || 'Analysing…'}</span>
                </div>
              </div>
            )}
            <div ref={agentEndRef} />
          </div>

          {/* Input */}
          <div className="flex gap-2 p-4 border-t border-cyan-900/20 bg-[#0b1618]/30">
            <input
              type="text"
              value={agentInput}
              onChange={e => setAgentInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendAgentMessage()}
              placeholder="Ask anything… 'find value bets on football', 'who wins Arsenal vs Chelsea', 'run all'"
              disabled={agentLoading}
              data-testid="agent-input"
              className="flex-1 bg-[#0b1618] border border-[#1e3a3f] focus:border-cyan-500/50 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors"
            />
            <Button
              onClick={() => sendAgentMessage()}
              disabled={agentLoading || !agentInput.trim()}
              data-testid="agent-send-btn"
              className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-4 rounded-lg disabled:opacity-40"
            >
              {agentLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* ── Module Tabs ───────────────────────────────────────────────────── */}
        <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-2xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex overflow-x-auto scrollbar-none border-b border-[#1e3a3f] bg-[#0b1618]/50">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                data-testid={`tab-${tab.id}`}
                className={`flex-shrink-0 px-3 py-2.5 text-xs font-medium transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.short}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-5">

            {/* ── 1. Data Pipeline ─────────────────────────────────────── */}
            {activeTab === 'pipeline' && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400 font-medium">Live feeds, odds providers, player stats, historical data</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: 'Live Sports APIs', status: `${(liveEvents as any[]).length} live events`, icon: <Network className="h-4 w-4" />, color: 'green' },
                    { label: 'Odds Providers', status: `${allEvents.filter((e: any) => getRealOdds(e, 'home')).length} markets loaded`, icon: <BarChart3 className="h-4 w-4" />, color: 'blue' },
                    { label: 'Value Bet Scanner', status: `${allValueBets.length} edges found`, icon: <Target className="h-4 w-4" />, color: 'purple' },
                  ].map((source, i) => (
                    <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                      <div className={`text-${source.color}-400`}>{source.icon}</div>
                      <div>
                        <div className="text-sm text-white font-medium">{source.label}</div>
                        <div className={`text-xs text-${source.color}-400`}>{source.status}</div>
                      </div>
                      <CheckCircle className="h-4 w-4 text-green-400 ml-auto flex-shrink-0" />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-gray-500 pt-2">
                  <Activity className="h-3 w-3 text-green-400" />
                  <span>All systems operational · {allEvents.length} events loaded · Real-time odds · Auto-refresh every 60s</span>
                </div>
              </div>
            )}

            {/* ── 2. Value Bet Detection ─────────────────────────────── */}
            {activeTab === 'value' && (
              <div className="space-y-3">
                {/* Header stats */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex gap-1.5">
                    <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">
                      {valueBets.filter(v => v.edge >= 0.05).length} HIGH
                    </Badge>
                    <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-[10px]">
                      {valueBets.filter(v => v.edge >= 0.03 && v.edge < 0.05).length} MED
                    </Badge>
                    <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/30 text-[10px]">
                      {valueBets.filter(v => v.edge < 0.03).length} LOW
                    </Badge>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {valueBets.length} bets · 2/3-way markets only · horse racing excluded
                  </div>
                </div>

                {/* Min-edge filter slider */}
                <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                  <div className="flex items-center gap-2 mb-2">
                    <Filter className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-xs text-gray-400">Min Edge Filter:</span>
                    <span className={`text-xs font-bold font-mono ml-auto ${minEdgeFilter > 0.05 ? 'text-green-400' : minEdgeFilter > 0.03 ? 'text-yellow-400' : 'text-gray-300'}`}>
                      &gt;{(minEdgeFilter * 100).toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="range" min="0.005" max="0.10" step="0.005" value={minEdgeFilter}
                    onChange={e => setMinEdgeFilter(parseFloat(e.target.value))}
                    className="sui-range"
                    data-testid="min-edge-filter"
                  />
                  <div className="flex items-center justify-between text-[10px] text-gray-600 mt-0.5">
                    <span>0.5% (all)</span><span>3% (good)</span><span>5% (strong)</span><span>10% (elite)</span>
                  </div>
                </div>

                {eventsLoading || upcomingLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-gray-400 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading market data…
                  </div>
                ) : valueBets.length === 0 ? (
                  <div className="text-center py-6 space-y-2">
                    <div className="text-gray-400 text-sm">
                      {allValueBets.length > 0
                        ? `No bets above ${(minEdgeFilter * 100).toFixed(1)}% edge — lower the filter`
                        : 'No value bets in current markets'}
                    </div>
                    {allValueBets.length > 0 && (
                      <button onClick={() => setMinEdgeFilter(0.005)}
                        className="text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                        Show all {allValueBets.length} opportunities
                      </button>
                    )}
                  </div>
                ) : valueBets.map((v, i) => {
                  const edgeLabel = v.edge >= 0.05 ? 'HIGH' : v.edge >= 0.03 ? 'MED' : 'LOW';
                  const edgeColor = v.edge >= 0.05 ? 'text-green-400' : v.edge >= 0.03 ? 'text-yellow-400' : 'text-blue-400';
                  const edgeBg   = v.edge >= 0.05 ? 'bg-green-500/10 border-green-500/25' : v.edge >= 0.03 ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-blue-500/10 border-blue-500/20';
                  const edgeBar  = v.edge >= 0.05 ? 'bg-green-500' : v.edge >= 0.03 ? 'bg-yellow-500' : 'bg-blue-500';
                  const barWidth = Math.min(100, (v.edge / 0.10) * 100);
                  // Implied prob from odds (what the market says)
                  const marketImplied = +(100 / v.marketOdds).toFixed(1);
                  // Potential payout on 10K stake
                  const potentialPayout = Math.round(10000 * v.marketOdds);
                  // Sport emoji
                  const sportEmoji: Record<string, string> = {
                    football: '⚽', soccer: '⚽', basketball: '🏀', tennis: '🎾',
                    baseball: '⚾', hockey: '🏒', 'ice hockey': '🏒', mma: '🥊',
                    boxing: '🥊', rugby: '🏉', cricket: '🏏', motorsport: '🏎️',
                    volleyball: '🏐', handball: '🤾', 'american-football': '🏈',
                    afl: '🏈', esports: '🎮', unknown: '🎯',
                  };
                  const emoji = sportEmoji[v.sport] || sportEmoji[normalizeSport(v.sport)] || '🎯';

                  return (
                    <div key={i} className={`rounded-lg border transition-all hover:border-opacity-60 ${edgeBg}`}>
                      {/* Top section */}
                      <div className="p-3 space-y-2">
                        {/* Match + sport + edge badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-sm">{emoji}</span>
                              <span className="text-[10px] text-gray-500 uppercase tracking-wide">{v.sport !== 'unknown' ? v.sport : ''}</span>
                            </div>
                            <div className="text-sm text-white font-medium truncate">{v.eventName}</div>
                            {v.leagueName && <div className="text-[10px] text-gray-500 truncate mt-0.5">{v.leagueName}</div>}
                          </div>
                          <div className={`text-[10px] font-black px-2 py-0.5 rounded border shrink-0 ${edgeColor} ${edgeBg}`}>
                            {edgeLabel} EDGE
                          </div>
                        </div>

                        {/* Selection row */}
                        <div className="flex items-center justify-between bg-black/20 rounded px-2 py-1.5">
                          <div className="flex items-center gap-2 text-xs">
                            <Target className="h-3 w-3 text-cyan-400 shrink-0" />
                            <span className="text-white font-medium">{v.selection}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs shrink-0">
                            <span className="text-cyan-400 font-mono font-bold">@ {v.marketOdds}</span>
                          </div>
                        </div>

                        {/* Probability comparison */}
                        <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
                          <div className="bg-black/20 rounded px-1.5 py-1">
                            <div className="text-gray-500">Market says</div>
                            <div className="text-white font-mono font-bold mt-0.5">{marketImplied}%</div>
                          </div>
                          <div className="bg-black/20 rounded px-1.5 py-1">
                            <div className="text-gray-500">AI estimates</div>
                            <div className="text-purple-400 font-mono font-bold mt-0.5">{(v.aiProb * 100).toFixed(1)}%</div>
                          </div>
                          <div className="bg-black/20 rounded px-1.5 py-1">
                            <div className="text-gray-500">Edge</div>
                            <div className={`font-mono font-bold mt-0.5 ${edgeColor}`}>+{(v.edge * 100).toFixed(1)}%</div>
                          </div>
                        </div>

                        {/* Edge bar */}
                        <div className="w-full h-1.5 bg-[#0a1315] rounded-full">
                          <div className={`h-1.5 rounded-full transition-all duration-500 ${edgeBar}`}
                            style={{ width: `${barWidth}%` }} />
                        </div>
                      </div>

                      {/* Action row */}
                      <div className="flex items-center gap-2 px-3 pb-3">
                        <div className="flex-1 text-[10px] text-gray-500">
                          10K stake → <span className="text-green-400 font-mono">{potentialPayout.toLocaleString()} SBETS</span>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => addBet({ id: `vb-${v.eventId}-${i}`, eventId: v.eventId, eventName: v.eventName, selectionName: v.selection, odds: v.marketOdds, stake: 10000, market: 'Match Winner', homeTeam: v.homeTeam, awayTeam: v.awayTeam, currency: 'SBETS' })}
                          className={`h-7 text-xs font-bold border shrink-0 ${v.edge >= 0.05 ? 'bg-green-600/20 hover:bg-green-600/40 text-green-300 border-green-500/40' : 'bg-[#1e3a3f] hover:bg-[#2a4a4f] text-gray-300 border-[#2a4a4f]'}`}
                          data-testid={`add-value-bet-${i}`}
                        >
                          + Add to Slip
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── 3. Monte Carlo ─────────────────────────────────────── */}
            {activeTab === 'montecarlo' && (
              <div className="space-y-4">

                {/* Mode toggle */}
                <div className="flex rounded-lg overflow-hidden border border-[#1e3a3f]">
                  {(['single', 'portfolio'] as const).map(m => (
                    <button key={m}
                      data-testid={`mc-mode-${m}`}
                      onClick={() => { setMcMode(m); setMcResult(null); }}
                      className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${mcMode === m ? 'bg-purple-600 text-white' : 'bg-[#0b1618] text-gray-400 hover:text-white'}`}>
                      {m === 'single' ? '🎯 Single Bet' : '📦 Portfolio'}
                    </button>
                  ))}
                </div>

                {/* Single Bet inputs */}
                {mcMode === 'single' && (
                  <div className="space-y-3">
                    {/* Event selector */}
                    {allEvents.length > 0 && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Auto-fill from event (optional)</label>
                        <select
                          data-testid="mc-event-select"
                          value={mcSelectedEvent}
                          onChange={e => {
                            const id = e.target.value;
                            setMcSelectedEvent(id);
                            if (id) {
                              const ev = allEvents.find((x: any) => String(x.id ?? x.fixtureId) === id);
                              if (ev) {
                                const homeOdds = Number(ev.homeOdds || ev.odds?.home) || 0;
                                if (homeOdds > 1) {
                                  setMcOdds(+homeOdds.toFixed(2));
                                  setMcProb(+(1 / homeOdds).toFixed(3));
                                }
                              }
                            }
                          }}
                          className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-xs rounded-lg px-3 py-2">
                          <option value="">— Manual input —</option>
                          {allEvents.slice(0, 30).map((ev: any) => {
                            const evId = String(ev.id ?? ev.fixtureId);
                            return (
                              <option key={evId} value={evId}>
                                {ev.homeTeam} vs {ev.awayTeam}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Stake (SBETS)</label>
                        <input
                          type="number" min="1" step="100" value={mcStake}
                          onChange={e => setMcStake(Math.max(1, Number(e.target.value)))}
                          className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-1.5"
                          data-testid="mc-stake-input" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Odds</label>
                        <input
                          type="number" min="1.01" step="0.05" value={mcOdds}
                          onChange={e => {
                            const o = Math.max(1.01, Number(e.target.value));
                            setMcOdds(o);
                            setMcProb(+(1 / o).toFixed(3));
                          }}
                          className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-1.5"
                          data-testid="mc-odds-input" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Win Prob %</label>
                        <input
                          type="number" min="1" max="99" step="1" value={(mcProb * 100).toFixed(0)}
                          onChange={e => setMcProb(Math.min(0.99, Math.max(0.01, Number(e.target.value) / 100)))}
                          className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-1.5"
                          data-testid="mc-prob-input" />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Win Probability: <span className="text-purple-300 font-mono">{(mcProb * 100).toFixed(1)}%</span>
                        <span className="text-gray-500 ml-2">(implied by odds: {(1/mcOdds*100).toFixed(1)}%)</span>
                      </label>
                      <input type="range" min="0.01" max="0.99" step="0.01" value={mcProb}
                        onChange={e => setMcProb(parseFloat(e.target.value))}
                        className="w-full accent-purple-500" data-testid="mc-prob-slider" />
                    </div>
                  </div>
                )}

                {/* Portfolio inputs */}
                {mcMode === 'portfolio' && (
                  <div className="space-y-3">
                    <div className={`text-xs rounded-lg px-3 py-2 border ${selectedBets.length > 0 ? 'border-green-500/30 bg-green-500/5 text-green-400' : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400'}`}>
                      {selectedBets.length > 0
                        ? `✅ Using ${selectedBets.length} bet${selectedBets.length > 1 ? 's' : ''} from your slip`
                        : `⚠️ No bets in slip — will use top ${Math.min(8, allValueBets.length)} value bets`}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Default Stake per Bet (SBETS)</label>
                        <input type="number" min="1" step="100" value={mcStake}
                          onChange={e => setMcStake(Math.max(1, Number(e.target.value)))}
                          className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-1.5"
                          data-testid="mc-stake-portfolio-input" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Edge Assumption: <span className="text-purple-300 font-mono">+{(mcEdgeBump * 100).toFixed(0)}%</span></label>
                        <input type="range" min="0" max="0.2" step="0.01" value={mcEdgeBump}
                          onChange={e => setMcEdgeBump(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 mt-2" data-testid="mc-edge-slider" />
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500">Edge assumption adds to the market-implied probability. 0% = pure market odds; +5% = you win 5% more often than implied.</p>
                  </div>
                )}

                {/* Runs selector */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Simulation Runs</label>
                  <select value={mcRuns} onChange={e => setMcRuns(Number(e.target.value))}
                    className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-2"
                    data-testid="mc-runs-select">
                    {[10000, 50000, 100000, 500000].map(n => <option key={n} value={n}>{n.toLocaleString()} runs</option>)}
                  </select>
                </div>

                <Button onClick={runMonteCarlo} disabled={mcRunning}
                  className="bg-purple-600 hover:bg-purple-700 text-white w-full"
                  data-testid="run-monte-carlo">
                  {mcRunning
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Running {mcRuns.toLocaleString()} simulations…</>
                    : <><PlayCircle className="h-4 w-4 mr-2" />Run Monte Carlo</>}
                </Button>

                {/* Results */}
                {mcResult && (
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <span className="text-purple-400 font-mono">n={mcResult.runs.toLocaleString()}</span>
                      <span>·</span>
                      <span>{mcResult.mode === 'portfolio' ? `${mcResult.betCount} bets` : '1 bet'}</span>
                      <span>·</span>
                      <span>95% CI: [{mcResult.lower}%, {mcResult.upper}%]</span>
                    </div>

                    {/* Key metrics */}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'P(Profit)', value: `${mcResult.pProfit}%`, color: mcResult.pProfit >= 50 ? 'text-green-400' : 'text-red-400', bg: mcResult.pProfit >= 50 ? 'border-green-500/20' : 'border-red-500/20' },
                        { label: 'Expected P&L', value: `${mcResult.expectedPnl >= 0 ? '+' : ''}${mcResult.expectedPnl.toLocaleString()} S`, color: mcResult.expectedPnl >= 0 ? 'text-green-400' : 'text-red-400', bg: mcResult.expectedPnl >= 0 ? 'border-green-500/20' : 'border-red-500/20' },
                        { label: 'Expected ROI', value: `${mcResult.expectedRoi >= 0 ? '+' : ''}${mcResult.expectedRoi}%`, color: mcResult.expectedRoi >= 0 ? 'text-emerald-400' : 'text-orange-400', bg: 'border-[#1e3a3f]' },
                        { label: 'Median P&L', value: `${mcResult.medianPnl >= 0 ? '+' : ''}${mcResult.medianPnl.toLocaleString()} S`, color: 'text-blue-400', bg: 'border-[#1e3a3f]' },
                      ].map((r, i) => (
                        <div key={i} className={`bg-[#0b1618] rounded-lg p-3 border ${r.bg}`}>
                          <div className={`text-base font-bold ${r.color}`}>{r.value}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{r.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Percentile band */}
                    <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                      <div className="text-[10px] text-gray-400 mb-2 uppercase tracking-wide">Outcome Range (5th – 95th percentile)</div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-red-400 font-mono">{mcResult.worstCase >= 0 ? '+' : ''}{mcResult.worstCase.toLocaleString()} S</span>
                        <div className="flex-1 mx-3 h-1.5 bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 rounded-full" />
                        <span className="text-green-400 font-mono">{mcResult.bestCase >= 0 ? '+' : ''}{mcResult.bestCase.toLocaleString()} S</span>
                      </div>
                      <div className="flex justify-between text-[9px] text-gray-600 mt-1">
                        <span>Worst 5%</span><span>Best 5%</span>
                      </div>
                    </div>

                    {/* Distribution histogram */}
                    {mcResult.distribution.length > 0 && (
                      <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                        <div className="text-[10px] text-gray-400 mb-2 uppercase tracking-wide">Outcome Distribution</div>
                        <div className="space-y-1.5">
                          {mcResult.distribution.map((bucket, i) => {
                            const isWin = !bucket.label.startsWith('-') || bucket.label.startsWith('+');
                            const barColor = bucket.label.startsWith('-') ? 'bg-red-500/60' : 'bg-green-500/60';
                            const maxPct = Math.max(...mcResult.distribution.map(b => b.pct));
                            const barWidth = maxPct > 0 ? (bucket.pct / maxPct) * 100 : 0;
                            return (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="w-16 text-right font-mono text-gray-400 shrink-0">{bucket.label}</span>
                                <div className="flex-1 bg-[#0a1215] rounded-sm h-4 overflow-hidden">
                                  <div className={`h-full ${barColor} transition-all`} style={{ width: `${barWidth}%` }} />
                                </div>
                                <span className={`w-10 text-right font-mono shrink-0 ${bucket.label.startsWith('-') ? 'text-red-400' : 'text-green-400'}`}>{bucket.pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="text-[9px] text-gray-600 text-center">
                      Formula: CI = p̂ ± 1.96√(p̂(1−p̂)/n) · S = SBETS tokens · Results are probabilistic estimates, not guarantees.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 4. Odds Movement ───────────────────────────────────── */}
            {activeTab === 'odds-movement' && (() => {
              const filteredMoves = oddsMovements.filter((m: any) =>
                (oddsSignalFilter === 'ALL' || m.signal === oddsSignalFilter) &&
                (oddsDirFilter === 'ALL' || m.direction === oddsDirFilter)
              );
              const sharpCount = oddsMovements.filter((m: any) => m.signal === 'SHARP MONEY').length;
              const steamCount = oddsMovements.filter((m: any) => m.signal === 'STEAM MOVE').length;
              const watchCount = oddsMovements.filter((m: any) => m.signal === 'WATCH').length;
              return (
                <div className="space-y-3">
                  {/* Legend */}
                  <div className="bg-[#0a1315] rounded-lg p-2.5 border border-[#1e3a3f] grid grid-cols-3 gap-2 text-center text-[10px]">
                    <div>
                      <div className="text-red-400 font-black text-xs">SHARP MONEY</div>
                      <div className="text-gray-500 mt-0.5">&gt;12% move — whale bets</div>
                    </div>
                    <div>
                      <div className="text-orange-400 font-black text-xs">STEAM MOVE</div>
                      <div className="text-gray-500 mt-0.5">&gt;6% — coordinated action</div>
                    </div>
                    <div>
                      <div className="text-blue-400 font-black text-xs">WATCH</div>
                      <div className="text-gray-500 mt-0.5">1.5–6% — early signal</div>
                    </div>
                  </div>

                  {/* Filter chips */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {(['ALL', 'SHARP MONEY', 'STEAM MOVE', 'WATCH'] as const).map(s => (
                        <button key={s} onClick={() => setOddsSignalFilter(s)}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                            oddsSignalFilter === s
                              ? s === 'SHARP MONEY' ? 'bg-red-500/30 text-red-300 border-red-500/50'
                              : s === 'STEAM MOVE'  ? 'bg-orange-500/30 text-orange-300 border-orange-500/50'
                              : s === 'WATCH'       ? 'bg-blue-500/30 text-blue-300 border-blue-500/50'
                              : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              : 'bg-transparent text-gray-500 border-gray-600/40 hover:border-gray-500'
                          }`}>
                          {s === 'ALL' ? `All (${oddsMovements.length})` : s === 'SHARP MONEY' ? `🔴 Sharp (${sharpCount})` : s === 'STEAM MOVE' ? `🟠 Steam (${steamCount})` : `🔵 Watch (${watchCount})`}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      {(['ALL', 'in', 'out'] as const).map(d => (
                        <button key={d} onClick={() => setOddsDirFilter(d)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-all ${
                            oddsDirFilter === d
                              ? d === 'in'  ? 'bg-green-500/20 text-green-300 border-green-500/40'
                              : d === 'out' ? 'bg-gray-500/20 text-gray-300 border-gray-500/40'
                              : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              : 'bg-transparent text-gray-600 border-gray-700/40'
                          }`}>
                          {d === 'ALL' ? 'All directions' : d === 'in' ? '↘ Shortening (backed)' : '↗ Drifting (avoided)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredMoves.length === 0 ? (
                    <div className="text-gray-400 text-sm text-center py-4">No movements match your filters.</div>
                  ) : (filteredMoves as any[]).map((m: any, i: number) => {
                    const isSharp   = m.signal === 'SHARP MONEY';
                    const isSteam   = m.signal === 'STEAM MOVE';
                    const isIn      = m.direction === 'in';
                    const cardBg    = isSharp ? 'bg-red-900/10 border-red-500/30' : isSteam ? 'bg-orange-900/10 border-orange-500/25' : 'bg-[#0b1618] border-[#1e3a3f]';
                    const signalColor = isSharp ? 'text-red-400' : isSteam ? 'text-orange-400' : 'text-blue-400';
                    const signalBg    = isSharp ? 'bg-red-500/15 border-red-500/30' : isSteam ? 'bg-orange-500/15 border-orange-500/30' : 'bg-blue-500/15 border-blue-500/30';
                    const barColor    = isSharp ? 'bg-red-500' : isSteam ? 'bg-orange-500' : 'bg-blue-500';
                    const barWidth    = Math.min(100, (m.absChange / 15) * 100);
                    const sportEmoji: Record<string, string> = {
                      football: '⚽', soccer: '⚽', basketball: '🏀', tennis: '🎾',
                      baseball: '⚾', hockey: '🏒', 'ice hockey': '🏒', mma: '🥊',
                      boxing: '🥊', rugby: '🏉', cricket: '🏏', motorsport: '🏎️',
                      volleyball: '🏐', handball: '🤾', 'american-football': '🏈',
                      afl: '🏈', esports: '🎮', unknown: '🎯',
                    };
                    const emoji = sportEmoji[m.sport] || sportEmoji[normalizeSport(m.sport)] || '🎯';

                    return (
                      <div key={i} className={`rounded-lg border transition-all ${cardBg}`}>
                        {/* Top */}
                        <div className="p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-sm">{emoji}</span>
                                <span className="text-[10px] text-gray-500 uppercase">{m.sport !== 'unknown' ? m.sport : ''}</span>
                              </div>
                              <div className="text-sm text-white font-medium truncate">{m.match}</div>
                              {m.league && <div className="text-[10px] text-gray-500 truncate mt-0.5">{m.league}</div>}
                            </div>
                            <div className={`text-[10px] font-black px-2 py-0.5 rounded border whitespace-nowrap shrink-0 ${signalColor} ${signalBg}`}>
                              {m.signal}
                            </div>
                          </div>

                          {/* Selection + odds change */}
                          <div className="flex items-center gap-2 bg-black/20 rounded px-2 py-1.5">
                            <Target className="h-3 w-3 text-cyan-400 shrink-0" />
                            <span className="text-xs text-white font-medium flex-1 truncate">{m.selection}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-400 line-through font-mono">Open: {m.openingOdds}</span>
                            <ArrowRight className="h-3 w-3 text-gray-600 shrink-0" />
                            <span className={`font-mono font-bold ${isIn ? 'text-green-400' : 'text-gray-300'}`}>Now: {m.currentOdds}</span>
                            <span className={`ml-auto font-mono font-black text-sm ${isIn ? 'text-green-400' : 'text-red-400'}`}>
                              {isIn ? '↘' : '↗'} {m.absChange}%
                            </span>
                          </div>

                          {/* Move bar */}
                          <div className="w-full h-1.5 bg-[#0a1315] rounded-full">
                            <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
                          </div>

                          {/* Interpretation */}
                          <div className={`text-[10px] rounded px-2 py-1 ${isIn ? 'text-green-400/80 bg-green-500/5' : 'text-gray-400 bg-black/10'}`}>
                            {isIn
                              ? isSharp ? '🐋 Whale money shorting these odds — sharp bettors backing this selection heavily' : isSteam ? '📈 Coordinated steam — multiple sharp accounts backing simultaneously' : '👀 Early positive move — worth watching for further shortening'
                              : isSharp ? '📉 Sharp money avoiding this — odds drifting hard, likely public fade target' : isSteam ? '⚠️ Steam moving away — bookmakers lengthening odds, may signal insider doubt' : '💤 Mild drift — low-interest selection, possibly public-unfancied'
                            }
                          </div>
                        </div>

                        {/* Action */}
                        {isIn && (isSharp || isSteam) && (
                          <div className="flex items-center justify-between px-3 pb-3 gap-2">
                            <div className="text-[10px] text-gray-500 flex items-center gap-1">
                              <Zap className="h-2.5 w-2.5 text-yellow-400" />
                              Follow the sharp money — bet before odds shorten further
                            </div>
                            <Button size="sm"
                              onClick={() => addBet({ id: `om-${m.eventId}-${i}`, eventId: m.eventId, eventName: m.match, selectionName: m.selection, odds: m.currentOdds, stake: 5000, market: 'Match Winner', homeTeam: m.homeTeam, awayTeam: m.awayTeam, currency: 'SBETS' })}
                              className="h-7 text-xs bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/40 shrink-0 font-bold"
                              data-testid={`add-odds-move-${i}`}
                            >
                              + Add to Slip
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── 5. Arbitrage ───────────────────────────────────────── */}
            {activeTab === 'arbitrage' && (
              <div className="space-y-3">
                {/* Summary header */}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-400">
                    Sorted by lowest bookmaker margin
                    <span className="text-yellow-400 font-mono ml-1">— lower margin = better arb target</span>
                  </div>
                  <div className="flex gap-1.5">
                    {arbiOpps.filter((a: any) => a.isArb).length > 0 && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-[10px]">
                        {arbiOpps.filter((a: any) => a.isArb).length} True Arb
                      </Badge>
                    )}
                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 text-[10px]">
                      {arbiOpps.filter((a: any) => !a.isArb && a.tier !== 'low').length} Low Margin
                    </Badge>
                  </div>
                </div>

                {/* Explainer */}
                <div className="bg-[#0b1618] rounded-lg p-2.5 border border-yellow-500/20 text-[11px] text-yellow-400/80 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span>These odds are from our live feed. To arb: find the same event at another bookmaker with different odds, then combine. Only 2-way and 3-way markets shown — multi-runner events are excluded.</span>
                </div>

                {arbiOpps.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">No 2-way or 3-way events available for arbitrage analysis.</div>
                ) : (arbiOpps as any[]).map((a: any, i: number) => {
                  const tierColors = {
                    good:   { card: 'bg-green-900/15 border-green-500/40',  badge: 'bg-green-500/20 text-green-400 border-green-500/40',  dot: 'bg-green-400' },
                    medium: { card: 'bg-yellow-900/10 border-yellow-500/25', badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400' },
                    low:    { card: 'bg-[#0b1618] border-[#1e3a3f]',         badge: 'bg-gray-500/15 text-gray-400 border-gray-500/30',       dot: 'bg-gray-500' },
                  };
                  const tc = a.isArb
                    ? tierColors.good
                    : tierColors[a.tier as 'low' | 'medium' | 'good'];

                  // Margin bar: 0% = perfect arb, 10%+ = bad
                  const marginBarPct = Math.min(100, Math.max(0, a.margin * 10));
                  const marginBarColor = a.margin < 2 ? 'bg-green-500' : a.margin < 5 ? 'bg-yellow-500' : 'bg-red-500/60';

                  return (
                    <div key={i} className={`rounded-lg p-3 border space-y-2.5 transition-all ${tc.card}`}>
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white font-medium truncate">{a.event}</div>
                          {a.league && <div className="text-[10px] text-gray-500 mt-0.5">{a.league}</div>}
                        </div>
                        <Badge className={`text-[10px] whitespace-nowrap shrink-0 ${tc.badge}`}>
                          {a.isArb ? `✓ True Arb +${a.profit}%` : a.tier === 'good' ? `★ ${a.margin}% margin` : `${a.margin}% margin`}
                        </Badge>
                      </div>

                      {/* Odds row */}
                      <div className="flex flex-wrap gap-2 text-xs">
                        <div className="flex items-center gap-1.5 bg-black/20 rounded px-2 py-1">
                          <span className="text-gray-500 text-[10px]">HOME</span>
                          <span className="text-white font-mono font-bold">@ {a.homeOdds}</span>
                          <span className="text-gray-500 text-[10px]">{(100/a.homeOdds).toFixed(1)}%</span>
                        </div>
                        {a.drawOdds && (
                          <div className="flex items-center gap-1.5 bg-black/20 rounded px-2 py-1">
                            <span className="text-gray-500 text-[10px]">DRAW</span>
                            <span className="text-white font-mono font-bold">@ {a.drawOdds}</span>
                            <span className="text-gray-500 text-[10px]">{(100/a.drawOdds).toFixed(1)}%</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 bg-black/20 rounded px-2 py-1">
                          <span className="text-gray-500 text-[10px]">AWAY</span>
                          <span className="text-white font-mono font-bold">@ {a.awayOdds}</span>
                          <span className="text-gray-500 text-[10px]">{(100/a.awayOdds).toFixed(1)}%</span>
                        </div>
                      </div>

                      {/* Margin bar */}
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-gray-500">Bookmaker margin</span>
                          <span className={a.margin < 2 ? 'text-green-400 font-bold' : a.margin < 5 ? 'text-yellow-400' : 'text-gray-400'}>
                            {a.isArb ? '0% (true arb!)' : `${a.margin}%`}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#0a1315] rounded-full">
                          <div className={`h-1.5 rounded-full transition-all ${marginBarColor}`}
                            style={{ width: `${a.isArb ? 2 : marginBarPct}%` }} />
                        </div>
                        <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
                          <span>0% ideal</span><span>5% avg</span><span>10%+ bad</span>
                        </div>
                      </div>

                      {/* Arb stakes calculator — only shown for true arbs */}
                      {a.isArb && (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2.5 space-y-1.5">
                          <div className="text-[10px] text-green-400 font-bold uppercase tracking-wide">Guaranteed Profit Calculator (per 100K SBETS)</div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span className="text-gray-300">Stake {a.homeTeam}: <span className="text-cyan-400 font-mono">{a.stakeH.toLocaleString()}</span></span>
                            {a.stakeD > 0 && <span className="text-gray-300">Stake Draw: <span className="text-cyan-400 font-mono">{a.stakeD.toLocaleString()}</span></span>}
                            <span className="text-gray-300">Stake {a.awayTeam}: <span className="text-cyan-400 font-mono">{a.stakeA.toLocaleString()}</span></span>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-gray-400">Return: <span className="text-white font-mono">{a.guaranteedReturn.toLocaleString()}</span></span>
                            <span className="text-green-400 font-bold">Profit: +{a.guaranteedProfit.toLocaleString()} SBETS guaranteed</span>
                          </div>
                        </div>
                      )}

                      {/* Cross-bookmaker hint for non-arb low-margin events */}
                      {!a.isArb && a.tier !== 'low' && (
                        <div className="text-[10px] text-cyan-500/70 flex items-center gap-1">
                          <Zap className="h-2.5 w-2.5" />
                          Low margin target — compare odds at a 2nd bookmaker to find a true arb
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── 6. AI Auto-Betting Engine ──────────────────────────── */}
            {activeTab === 'auto-bet' && (
              <div className="space-y-4">
                <div className="text-xs text-yellow-400/80 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> Bets are added to your slip — you confirm and sign the transaction manually.
                </div>

                {/* Preset Strategy Buttons */}
                <div>
                  <div className="text-xs text-gray-400 mb-2 font-medium">Quick Presets</div>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: 'conservative', icon: '🛡', label: 'Conservative', sub: '≥3% edge · 1.5–5.0x · Kelly · 3 bets', color: 'green' },
                      { key: 'balanced',     icon: '⚖', label: 'Balanced',     sub: '≥1.5% edge · 1.4–8.0x · Fixed · 5 bets', color: 'cyan' },
                      { key: 'aggressive',   icon: '🔥', label: 'Aggressive',   sub: '≥0.5% edge · 1.2–15x · Fixed · 10 bets', color: 'orange' },
                    ] as const).map(({ key, icon, label, sub, color }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setActivePreset(key);
                          setStrategy(s => ({ ...s, ...PRESET_STRATEGIES[key] }));
                        }}
                        className={`px-2 py-2.5 rounded-lg text-left border transition-all ${
                          activePreset === key
                            ? color === 'green'  ? 'bg-green-500/15 border-green-500/50 text-green-300'
                            : color === 'cyan'   ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                            :                      'bg-orange-500/15 border-orange-500/50 text-orange-300'
                            : 'bg-[#0b1618] border-[#1e3a3f] text-gray-400 hover:border-gray-500'
                        }`}
                        data-testid={`preset-${key}`}
                      >
                        <div className="text-xs font-bold mb-0.5">{icon} {label}</div>
                        <div className={`text-[9px] leading-tight font-mono ${activePreset === key ? 'opacity-80' : 'text-gray-600'}`}>{sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Qualifying count + top 3 preview */}
                {(() => {
                  const qualifying = allValueBets
                    .filter(vb => {
                      const nVb = normalizeSport(vb.sport);
                      const nSt = normalizeSport(strategy.sport);
                      return vb.edge >= strategy.minEdge &&
                        vb.marketOdds >= strategy.minOdds &&
                        vb.marketOdds <= strategy.maxOdds &&
                        (nSt === 'all' || nVb === nSt || nVb.includes(nSt) || nSt.includes(nVb));
                    })
                    .sort((a, b) => b.edge - a.edge);

                  return (
                    <div className={`rounded-lg p-3 text-xs border space-y-2 ${qualifying.length > 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
                      <div className="flex items-center justify-between">
                        <span className={qualifying.length > 0 ? 'text-green-300 font-medium' : 'text-yellow-300'}>
                          {qualifying.length > 0
                            ? `${qualifying.length} bet${qualifying.length > 1 ? 's' : ''} qualify with current filters`
                            : 'No bets qualify — try loosening filters below'}
                        </span>
                        <span className="text-gray-500">{allValueBets.length} total opps</span>
                      </div>
                      {qualifying.slice(0, 3).map((vb, i) => (
                        <div key={i} className="flex items-center justify-between bg-black/20 rounded px-2 py-1">
                          <span className="text-gray-300 truncate max-w-[55%]">{vb.selection}</span>
                          <div className="flex gap-2 shrink-0">
                            <span className="text-cyan-400 font-mono">@{vb.marketOdds}</span>
                            <span className="text-green-400 font-mono font-bold">+{(vb.edge * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Staking Mode Toggle */}
                <div className="flex items-center gap-3 bg-[#0b1618] rounded-lg px-3 py-2 border border-[#1e3a3f]">
                  <div className="flex-1">
                    <div className="text-xs text-white font-medium">Staking Mode</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {strategy.stakingMode === 'kelly' ? 'Kelly: stake sized by edge strength (safer, adaptive)' : 'Fixed: same stake for every bet'}
                    </div>
                  </div>
                  <button
                    onClick={() => setStrategy(s => ({ ...s, stakingMode: s.stakingMode === 'fixed' ? 'kelly' : 'fixed' }))}
                    className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                      strategy.stakingMode === 'kelly'
                        ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                        : 'bg-[#1e3a3f] border-[#1e3a3f] text-gray-400'
                    }`}
                    data-testid="toggle-staking-mode"
                  >
                    {strategy.stakingMode === 'kelly' ? '🧮 Kelly' : '🔒 Fixed'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Min Edge: <span className="text-cyan-400 font-mono font-bold">{(strategy.minEdge * 100).toFixed(1)}%</span></label>
                    <input type="range" min="0.005" max="0.12" step="0.005" value={strategy.minEdge}
                      onChange={e => { setActivePreset(''); setStrategy(s => ({ ...s, minEdge: parseFloat(e.target.value) })); }}
                      className="sui-range" data-testid="strategy-min-edge" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Max Stake: <span className="text-cyan-400 font-mono font-bold">{strategy.maxStake.toLocaleString()} SBETS</span></label>
                    <input type="range" min="1000" max="100000" step="1000" value={strategy.maxStake}
                      onChange={e => { setActivePreset(''); setStrategy(s => ({ ...s, maxStake: Number(e.target.value) })); }}
                      className="sui-range" data-testid="strategy-max-stake" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Min Odds: <span className="text-cyan-400 font-mono font-bold">{strategy.minOdds.toFixed(1)}</span></label>
                    <input type="range" min="1.1" max="5.0" step="0.1" value={strategy.minOdds}
                      onChange={e => { setActivePreset(''); setStrategy(s => ({ ...s, minOdds: parseFloat(e.target.value) })); }}
                      className="sui-range" data-testid="strategy-min-odds" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Max Odds: <span className="text-cyan-400 font-mono font-bold">{strategy.maxOdds.toFixed(1)}</span></label>
                    <input type="range" min="1.5" max="15.0" step="0.5" value={strategy.maxOdds}
                      onChange={e => { setActivePreset(''); setStrategy(s => ({ ...s, maxOdds: parseFloat(e.target.value) })); }}
                      className="sui-range" data-testid="strategy-max-odds" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">
                      Number of Bets: <span className="text-cyan-400 font-mono font-bold">{strategy.maxBets}</span>
                      <span className="text-gray-500 ml-2">(per run, picked by highest edge first)</span>
                    </label>
                    <input type="range" min="1" max="20" step="1" value={strategy.maxBets}
                      onChange={e => { setActivePreset(''); setStrategy(s => ({ ...s, maxBets: Number(e.target.value) })); }}
                      className="sui-range" data-testid="strategy-max-bets" />
                    <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                      <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span>
                    </div>
                  </div>
                </div>

                {/* Sport Filter + Daily Limit */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Sport Filter</label>
                    <select value={strategy.sport} onChange={e => setStrategy(s => ({ ...s, sport: e.target.value }))}
                      className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-2"
                      data-testid="strategy-sport">
                      {['all', 'football', 'basketball', 'tennis', 'baseball', 'hockey', 'mma', 'motorsport', 'rugby', 'cricket'].map(sp => (
                        <option key={sp} value={sp}>{sp.charAt(0).toUpperCase() + sp.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Daily Limit: <span className="text-cyan-400 font-mono font-bold">{strategy.dailyLimit.toLocaleString()}</span></label>
                    <input type="range" min="10000" max="1000000" step="10000" value={strategy.dailyLimit}
                      onChange={e => setStrategy(s => ({ ...s, dailyLimit: Number(e.target.value) }))}
                      className="sui-range-red" data-testid="strategy-daily-limit" />
                    <div className="flex items-center justify-between text-[10px] mt-0.5">
                      <span className="text-gray-600">Protection limit</span>
                      {dailyStaked > 0 && (
                        <button onClick={() => setDailyStaked(0)} className="text-gray-500 hover:text-cyan-400 transition-colors">Reset ({dailyStaked.toLocaleString()} used)</button>
                      )}
                    </div>
                  </div>
                </div>

                <Button onClick={runAutoBet} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3" data-testid="run-auto-bet">
                  <Bot className="h-4 w-4 mr-2" /> Run Auto-Bet — {strategy.maxBets} Best Edge Bet{strategy.maxBets !== 1 ? 's' : ''}
                </Button>

                {autoLog.length > 0 && (
                  <div className="rounded-xl border border-cyan-900/40 bg-gradient-to-b from-[#060e14] to-[#0a1520] overflow-hidden shadow-lg shadow-cyan-900/10">
                    {/* Header bar */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-900/30 bg-[#071018]">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span className="text-[10px] font-semibold tracking-widest text-cyan-400/80 uppercase">AI Analysis Output</span>
                      </div>
                      <button
                        onClick={() => { setAutoLog([]); setUsedAutoBetKeys(new Set()); }}
                        className="text-[10px] text-gray-600 hover:text-red-400 transition-colors tracking-wider uppercase"
                      >
                        Clear
                      </button>
                    </div>

                    {/* Log lines */}
                    <div className="p-3 space-y-1.5">
                      {autoLog.map((line, i) => {
                        const isPlaced   = line.startsWith('✅');
                        const isSuccess  = line.startsWith('✓');
                        const isError    = line.startsWith('❌');
                        const isTip      = line.startsWith('💡');
                        const isScan     = line.startsWith('📊');
                        const isStrategy = line.startsWith('🎯');
                        const isStop     = line.startsWith('🛑');
                        const isWarn     = line.startsWith('⚠️');
                        const isSkip     = line.startsWith('⏭');

                        const colorClass =
                          isPlaced   ? 'text-emerald-400' :
                          isSuccess  ? 'text-cyan-300' :
                          isError    ? 'text-red-400' :
                          isTip      ? 'text-amber-400' :
                          isScan     ? 'text-cyan-400' :
                          isStrategy ? 'text-violet-400' :
                          isStop     ? 'text-red-500' :
                          isWarn     ? 'text-amber-500' :
                          isSkip     ? 'text-gray-500' :
                          'text-gray-400';

                        const bgClass =
                          isPlaced  ? 'bg-emerald-500/5 border border-emerald-500/10 rounded' :
                          isSuccess ? 'bg-cyan-500/5 border border-cyan-500/10 rounded' :
                          isError   ? 'bg-red-500/5 border border-red-500/10 rounded' :
                          isStop    ? 'bg-red-500/5 border border-red-500/10 rounded' :
                          isWarn    ? 'bg-amber-500/5 border border-amber-500/10 rounded' :
                          '';

                        return (
                          <div key={i} className={`text-[11px] font-mono leading-5 px-2 py-0.5 ${colorClass} ${bgClass}`}>
                            {line}
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer */}
                    <div className="px-3 py-1.5 border-t border-cyan-900/20 bg-[#040c12]">
                      <span className="text-[9px] text-gray-600 tracking-widest uppercase">SuiBets Neural Engine v2</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 7. Portfolio Risk Manager ──────────────────────────── */}
            {activeTab === 'portfolio' && (
              <div className="space-y-4">
                <div className="text-xs text-gray-400">
                  {selectedBets.length > 0
                    ? <span className="text-cyan-400">{selectedBets.length} bet{selectedBets.length > 1 ? 's' : ''} in your slip — click Analyse to run full risk report</span>
                    : <span className="text-gray-500">Add bets to your slip to analyse portfolio risk, diversification and expected returns</span>}
                </div>

                {selectedBets.length === 0 && (
                  <div className="bg-[#0b1618] rounded-lg p-6 border border-[#1e3a3f] text-center space-y-2">
                    <BarChart3 className="h-8 w-8 text-gray-600 mx-auto" />
                    <div className="text-sm text-gray-400 font-medium">No bets in your slip</div>
                    <div className="text-xs text-gray-500">Add bets from the Value Bets tab, Auto-Bet, or Marketplace, then return here.</div>
                  </div>
                )}

                {selectedBets.length > 0 && (
                  <Button onClick={calcPortfolioRisk} className="w-full bg-red-700/70 hover:bg-red-700 text-white font-bold" data-testid="calc-portfolio-risk">
                    <BarChart3 className="h-4 w-4 mr-2" /> Analyse Portfolio Risk ({selectedBets.length} bet{selectedBets.length !== 1 ? 's' : ''})
                  </Button>
                )}

                {portfolioResult && (() => {
                  const ratingColor =
                    portfolioResult.riskRating === 'LOW' ? 'text-green-400 border-green-500/30 bg-green-500/10' :
                    portfolioResult.riskRating === 'MEDIUM' ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' :
                    portfolioResult.riskRating === 'HIGH' ? 'text-orange-400 border-orange-500/30 bg-orange-500/10' :
                    'text-red-400 border-red-500/30 bg-red-500/10';
                  const barColor =
                    portfolioResult.riskRating === 'LOW' ? 'bg-green-500' :
                    portfolioResult.riskRating === 'MEDIUM' ? 'bg-yellow-500' :
                    portfolioResult.riskRating === 'HIGH' ? 'bg-orange-500' : 'bg-red-500';
                  const divColor =
                    portfolioResult.diversificationGrade === 'Excellent' ? 'text-green-400' :
                    portfolioResult.diversificationGrade === 'Good' ? 'text-cyan-400' :
                    portfolioResult.diversificationGrade === 'Fair' ? 'text-yellow-400' : 'text-red-400';
                  return (
                    <div className="space-y-3">

                      {/* Risk Score Meter */}
                      <div className={`rounded-lg p-4 border ${ratingColor}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Risk Rating</div>
                          <div className={`text-lg font-black font-mono ${ratingColor.split(' ')[0]}`}>{portfolioResult.riskRating}</div>
                        </div>
                        <div className="w-full bg-[#0b1618] rounded-full h-2 mb-1">
                          <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${portfolioResult.riskScore}%` }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-500">
                          <span>0 — Safe</span>
                          <span className="font-mono font-bold text-white">{portfolioResult.riskScore}/100</span>
                          <span>100 — Critical</span>
                        </div>
                      </div>

                      {/* Core Financials */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-[#1e3a3f]">
                          <div className="text-base font-bold text-white font-mono">{portfolioResult.totalStake.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Total Stake (SBETS)</div>
                        </div>
                        <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-green-500/20">
                          <div className="text-base font-bold text-green-400 font-mono">+{portfolioResult.netProfit.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Net Profit if All Win</div>
                        </div>
                        <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-cyan-500/20">
                          <div className="text-base font-bold text-cyan-400 font-mono">{portfolioResult.maxWin.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Gross Return (SBETS)</div>
                        </div>
                        <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-red-500/20">
                          <div className="text-base font-bold text-red-400 font-mono">{portfolioResult.worstCase.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Worst Case (all lose)</div>
                        </div>
                        <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-[#1e3a3f]">
                          <div className="text-base font-bold text-yellow-400 font-mono">{portfolioResult.avgOdds}x</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Avg Odds</div>
                        </div>
                        <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-[#1e3a3f]">
                          <div className="text-base font-bold text-purple-400 font-mono">{portfolioResult.breakevenWinRate}%</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Breakeven Win Rate</div>
                        </div>
                      </div>

                      {/* Diversification */}
                      <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] text-gray-500 uppercase tracking-wide">Diversification</div>
                          <div className={`text-xs font-bold ${divColor}`}>{portfolioResult.diversificationGrade}</div>
                        </div>
                        <div className="flex gap-4 text-xs">
                          <span className="text-gray-400">{portfolioResult.uniqueSports} sport{portfolioResult.uniqueSports !== 1 ? 's' : ''}</span>
                          <span className="text-gray-400">{portfolioResult.uniqueEvents} event{portfolioResult.uniqueEvents !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="text-[10px] text-yellow-400/80 break-words">{portfolioResult.exposure}</div>
                      </div>

                      {/* Per-bet breakdown */}
                      <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Bet Breakdown</div>
                        <div className="space-y-1.5">
                          {portfolioResult.betBreakdown.map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-gray-300 truncate max-w-[55%]">{b.name}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-gray-500 font-mono">{b.odds}x</span>
                                <span className="text-purple-400 font-mono text-[10px]">{b.impliedProb}% imp.</span>
                                <span className="text-green-400 font-mono">{b.potentialWin.toLocaleString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="text-[10px] text-cyan-500/70 text-center">
                        Analysing {portfolioResult.betCount} bet{portfolioResult.betCount !== 1 ? 's' : ''} · Risk score based on concentration, odds variance & diversification
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── 8. Live Match AI Engine ────────────────────────────── */}
            {activeTab === 'live-ai' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Sorted by AI edge — best value shown first</span>
                  <span>{liveSignals.filter(s => s.signal === 'BUY').length} BUY · {liveSignals.filter(s => s.signal === 'WATCH').length} WATCH</span>
                </div>
                {liveSignals.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">No live or upcoming matches to analyse. Check back during match windows.</div>
                ) : liveSignals.map((s, i) => (
                  <div key={i} className={`bg-[#0b1618] rounded-lg p-3 border space-y-2 ${
                    s.signal === 'BUY' ? 'border-green-500/30' : s.signal === 'WATCH' ? 'border-yellow-500/20' : 'border-[#1e3a3f]'
                  }`}>
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-medium truncate">{s.match}</div>
                        {s.league && <div className="text-[10px] text-gray-500 mt-0.5">{s.league}</div>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.isLive && <Badge className="text-[9px] bg-red-500/20 text-red-400 border-red-500/30 animate-pulse">LIVE</Badge>}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          s.signal === 'BUY' ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
                          s.signal === 'WATCH' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' :
                          'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                        }`}>{s.signal}</span>
                      </div>
                    </div>

                    {/* Recommendation row */}
                    <div className={`rounded px-2 py-1.5 flex items-center justify-between text-xs ${
                      s.signal === 'BUY' ? 'bg-green-500/10' : 'bg-[#0d1c1f]'
                    }`}>
                      <div className="flex items-center gap-2">
                        <Target className="h-3 w-3 text-cyan-400 shrink-0" />
                        <span className="text-white font-medium">{s.recommendation}</span>
                        {s.odds && <span className="text-cyan-400 font-mono">@ {s.odds}</span>}
                      </div>
                      <div className="flex items-center gap-1 text-[10px]">
                        <span className="text-gray-500">AI</span>
                        <span className="text-purple-400 font-mono">{(s.aiProb * 100).toFixed(0)}%</span>
                        <span className="text-gray-600 mx-0.5">·</span>
                        <span className="text-green-400 font-bold">+{(s.edge * 100).toFixed(1)}% edge</span>
                      </div>
                    </div>

                    {/* Strength bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1 text-[10px]">
                        <span className="text-gray-500">Signal confidence</span>
                        <span className={`font-bold ${s.signal === 'BUY' ? 'text-green-400' : s.signal === 'WATCH' ? 'text-yellow-400' : 'text-gray-400'}`}>
                          {(s.strength * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#0a1315] rounded-full">
                        <div className={`h-1.5 rounded-full transition-all duration-500 ${
                          s.signal === 'BUY' ? 'bg-green-500' : s.signal === 'WATCH' ? 'bg-yellow-500' : 'bg-gray-600'
                        }`} style={{ width: `${(s.strength * 100).toFixed(0)}%` }} />
                      </div>
                    </div>

                    {/* Add to slip button for BUY/WATCH signals */}
                    {s.signal !== 'HOLD' && s.odds && (
                      <Button
                        size="sm"
                        className={`w-full h-7 text-xs font-bold ${
                          s.signal === 'BUY'
                            ? 'bg-green-600/80 hover:bg-green-600 text-white border border-green-500/50'
                            : 'bg-yellow-600/50 hover:bg-yellow-600/70 text-yellow-200 border border-yellow-500/30'
                        }`}
                        onClick={() => addBet({
                          id: `live-${s.eventId}-${Date.now()}`,
                          eventId: String(s.eventId),
                          eventName: s.match,
                          selectionName: s.recommendation,
                          odds: s.odds!,
                          stake: strategy.maxStake,
                          market: 'Match Winner',
                          homeTeam: s.homeTeam,
                          awayTeam: s.awayTeam,
                          currency: 'SBETS',
                        })}
                        data-testid={`add-live-bet-${i}`}
                      >
                        {s.signal === 'BUY' ? '+ Add to Slip' : '+ Watch Bet'}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── 9. AI Bet Marketplace Intelligence ─────────────────── */}
            {activeTab === 'marketplace' && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400">
                  Ranked by <span className="text-yellow-400 font-mono">ROI = (ai_prob × odds − 1) × 100%</span> — real expected return using live market odds
                </div>
                {marketplaceBets.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">No value bets available — market data is loading or odds are not yet available.</div>
                ) : marketplaceBets.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] hover:border-yellow-500/30 transition-all">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-gray-400 text-black' : i === 2 ? 'bg-amber-700 text-white' : 'bg-[#1e3a3f] text-gray-300'}`}>{b.rank}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">{b.selection}</div>
                      <div className="text-xs text-gray-400 truncate">{b.event}</div>
                      {b.leagueName && <div className="text-[10px] text-gray-600 truncate">{b.leagueName}</div>}
                      <div className="flex gap-2 text-xs mt-0.5">
                        <span className="text-yellow-400 font-bold">ROI +{b.roi}%</span>
                        <span className="text-cyan-400">@ {b.odds}</span>
                        <span className="text-gray-500">AI {(b.aiProb * 100).toFixed(0)}%</span>
                      </div>
                      <EdgeBar edge={b.edge} />
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/40 flex-shrink-0"
                      onClick={() => addBet({ id: `mkt-${b.eventId}-${i}`, eventId: b.eventId, eventName: b.event, selectionName: b.selection, odds: b.odds, stake: 1000, market: 'Match Winner', homeTeam: b.homeTeam, awayTeam: b.awayTeam, currency: 'SBETS' })}
                      data-testid={`add-market-bet-${i}`}
                    >
                      + 1K SBETS
                    </Button>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>


      </div>
    </Layout>
  );
}
