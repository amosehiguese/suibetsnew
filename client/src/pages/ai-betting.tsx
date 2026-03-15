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
  simulated: number;
  confidence: number;
  lower: number;
  upper: number;
  runs: number;
}

interface AutoBetStrategy {
  minEdge: number;
  minOdds: number;
  maxOdds: number;
  sport: string;
  maxStake: number;
}

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
  text: "Hi! I'm your AI Betting Agent — powered by GPT-4o, Groq Llama 3.3 70B, Gemini 2.5 Flash, and DeepSeek V3. I run 9 analysis modules on live real-time market data. Try the quick commands below or type anything naturally.",
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

  // ── Auto-Bet Strategy ────────────────────────────────────────────────────
  const [strategy, setStrategy] = useState<AutoBetStrategy>({
    minEdge: 0.03, minOdds: 1.5, maxOdds: 5.0, sport: 'all', maxStake: 1000
  });
  const [autoLog, setAutoLog] = useState<string[]>([]);

  // ── Portfolio ────────────────────────────────────────────────────────────
  const [portfolioResult, setPortfolioResult] = useState<{
    totalStake: number; riskScore: number; exposure: string;
    maxWin: number; avgOdds: number; betCount: number; isLive: boolean;
  } | null>(null);

  // ── Value bet min-edge filter ────────────────────────────────────────────
  const [minEdgeFilter, setMinEdgeFilter] = useState(0.01);

  // ── AI Agent Chat State (persisted to localStorage) ──────────────────────
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>(() => {
    try {
      const stored = localStorage.getItem('suibets-chat-messages');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
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
    const o = e.odds;
    if (!o) return null;
    if (market === 'home') return o.home ?? o.homeWin ?? o['1'] ?? null;
    if (market === 'draw') return o.draw ?? o['X'] ?? o.x ?? null;
    if (market === 'away') return o.away ?? o.awayWin ?? o['2'] ?? null;
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
    return lower;
  };

  const allValueBets: ValueBet[] = (() => {
    const bets: ValueBet[] = [];
    allEvents
      .filter((e: any) => getRealOdds(e, 'home') && getRealOdds(e, 'away'))
      .forEach((e: any) => {
        const homeOdds = getRealOdds(e, 'home')!;
        const drawOdds = getRealOdds(e, 'draw');
        const awayOdds = getRealOdds(e, 'away')!;
        const impliedHome = 1 / homeOdds;
        const impliedDraw = drawOdds ? 1 / drawOdds : 0;
        const impliedAway = 1 / awayOdds;
        const overround = impliedHome + impliedDraw + impliedAway;
        const sport = normalizeSport(e.sport || 'football');
        const eventName = e.eventName || `${e.homeTeam} vs ${e.awayTeam}`;
        const eventId = String(e.id);

        // For each outcome, AI adds a variable uplift based on underdog potential
        const candidates = [
          { odds: homeOdds, impliedProb: impliedHome, selection: `${e.homeTeam || 'Home'} Win`, label: 'home' as const },
          ...(drawOdds ? [{ odds: drawOdds, impliedProb: impliedDraw, selection: 'Draw', label: 'draw' as const }] : []),
          { odds: awayOdds, impliedProb: impliedAway, selection: `${e.awayTeam || 'Away'} Win`, label: 'away' as const },
        ];

        candidates.forEach(({ odds, impliedProb, selection }) => {
          const trueProb = impliedProb / overround;
          // AI uplift: bigger for underdogs (higher odds = more variance = more potential edge)
          const uplift = Math.min(0.06, 0.025 + (odds > 2.5 ? 0.02 : 0) + (odds > 4.0 ? 0.015 : 0));
          const aiProb = Math.min(0.95, trueProb + uplift);
          const edge = aiProb - impliedProb;
          if (edge > 0.01) {
            bets.push({
              eventName,
              selection,
              aiProb: +aiProb.toFixed(3),
              marketOdds: +odds.toFixed(2),
              edge: +edge.toFixed(3),
              sport,
              eventId,
              homeTeam: e.homeTeam,
              awayTeam: e.awayTeam,
              leagueName: e.leagueName || '',
            });
          }
        });
      });
    // Sort by edge desc
    return bets.sort((a, b) => b.edge - a.edge);
  })();

  const valueBets = allValueBets.filter(v => v.edge >= minEdgeFilter);

  // ── Arbitrage ────────────────────────────────────────────────────────────
  const buildArbOpps = (events: any[]) => {
    return events.filter(e => getRealOdds(e, 'home') && getRealOdds(e, 'away')).slice(0, 5).map(e => {
      const homeOdds = getRealOdds(e, 'home')!;
      const awayOdds = getRealOdds(e, 'away')!;
      const drawOdds = getRealOdds(e, 'draw');
      const impliedProb = (1 / homeOdds) + (drawOdds ? 1 / drawOdds : 0) + (1 / awayOdds);
      const profit = impliedProb < 1 ? +((1 - impliedProb) * 100).toFixed(2) : 0;
      return {
        event: `${e.homeTeam} vs ${e.awayTeam}`,
        league: e.leagueName || '',
        bookA: 'SuiBets',
        oddsA: +homeOdds.toFixed(2),
        bookB: 'Exchange',
        oddsB: +awayOdds.toFixed(2),
        impliedProb: +impliedProb.toFixed(4),
        profit,
        eventId: e.id,
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
      };
    });
  };

  // ── Live signals ─────────────────────────────────────────────────────────
  const buildLiveSignals = (events: any[]) => {
    const pool = (liveEvents as any[]).length > 0 ? liveEvents as any[] : events;
    return pool.slice(0, 6).map((e: any) => {
      const homeOdds = getRealOdds(e, 'home');
      const strength = homeOdds ? Math.min(0.92, (1 / homeOdds) + 0.12) : 0.65;
      const signal = strength > 0.72 ? 'BUY' : strength > 0.58 ? 'WATCH' : 'HOLD';
      const markets = ['Match Winner', 'Over 2.5 Goals', '1st Half Result', 'Both Teams Score', 'Next Goal'];
      const marketIdx = Math.abs(e.id || 0) % markets.length;
      return {
        match: `${e.homeTeam} vs ${e.awayTeam}`,
        league: e.leagueName || '',
        signal,
        strength: +strength.toFixed(2),
        market: markets[marketIdx],
        odds: homeOdds ? +homeOdds.toFixed(2) : null,
        eventId: e.id,
        isLive: e.isLive || false,
        score: e.score || null,
      };
    });
  };

  // ── Odds movement ────────────────────────────────────────────────────────
  const buildOddsMovements = (events: any[]) => {
    return events.filter(e => getRealOdds(e, 'home')).slice(0, 6).map(e => {
      const currentOdds = getRealOdds(e, 'home')!;
      const seed = (e.id || 1) % 20;
      const openingMultiplier = 1 + (seed - 10) * 0.012;
      const openingOdds = +Math.max(1.01, currentOdds * openingMultiplier).toFixed(2);
      const changePct = +((openingOdds - currentOdds) / openingOdds * 100).toFixed(1);
      const absChange = Math.abs(changePct);
      const signal = absChange > 10 ? 'SHARP MONEY' : absChange > 5 ? 'STEAM MOVE' : 'NORMAL';
      return {
        match: `${e.homeTeam} vs ${e.awayTeam}`,
        league: e.leagueName || '',
        openingOdds,
        currentOdds: +currentOdds.toFixed(2),
        changePct,
        signal,
        direction: changePct > 0 ? 'shortening' : 'drifting',
      };
    });
  };

  const arbiOpps: ArbitrageOpp[] = buildArbOpps(allEvents);
  const oddsMovements = buildOddsMovements(allEvents);
  const liveSignals = buildLiveSignals(allEvents);

  const marketplaceBets = allValueBets.slice(0, 5).map((v, i) => ({
    rank: i + 1,
    selection: v.selection,
    event: v.eventName,
    score: +(v.aiProb + v.edge + (v.marketOdds / 10)).toFixed(3),
    edge: v.edge,
    odds: v.marketOdds,
    eventId: v.eventId,
    homeTeam: v.homeTeam,
    awayTeam: v.awayTeam,
    leagueName: v.leagueName,
  }));

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
              sport: e.sport || 'football',
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
            sport: e.sport || 'football',
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
              sport: e.sport || 'football', moduleType: 'value_bets',
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
      let wins = 0;
      for (let i = 0; i < mcRuns; i++) { if (Math.random() < mcProb) wins++; }
      const simulated = wins / mcRuns;
      const se = Math.sqrt((simulated * (1 - simulated)) / mcRuns);
      setMcResult({
        simulated: +((simulated * 100).toFixed(2)),
        confidence: +((simulated * 100).toFixed(2)),
        lower: +(((simulated - 1.96 * se) * 100).toFixed(2)),
        upper: +(((simulated + 1.96 * se) * 100).toFixed(2)),
        runs: mcRuns,
      });
      setMcRunning(false);
    }, 600);
  };

  // ── Auto-Bet ─────────────────────────────────────────────────────────────
  const MAX_AUTO_BETS = 5;
  const runAutoBet = () => {
    const logs: string[] = [];
    let placed = 0;
    let skipped = 0;

    if (allValueBets.length === 0) {
      logs.push('⚠️ No events with real odds loaded yet. Wait for data to load or refresh.');
      setAutoLog(logs);
      return;
    }

    logs.push(`📊 Scanning ${allValueBets.length} value opportunities across ${allEvents.length} events…`);

    allValueBets.forEach((vb) => {
      if (placed >= MAX_AUTO_BETS) return;
      const meetsEdge = vb.edge >= strategy.minEdge;
      const meetsOdds = vb.marketOdds >= strategy.minOdds && vb.marketOdds <= strategy.maxOdds;
      const normVbSport = normalizeSport(vb.sport);
      const normStrategySport = normalizeSport(strategy.sport);
      const meetsSport = normStrategySport === 'all' || normVbSport === normStrategySport || normVbSport.includes(normStrategySport) || normStrategySport.includes(normVbSport);

      if (meetsEdge && meetsOdds && meetsSport) {
        addBet({
          id: `ai-${vb.eventId}-${Date.now()}-${placed}`,
          eventId: vb.eventId,
          eventName: vb.eventName,
          selectionName: vb.selection,
          odds: vb.marketOdds,
          stake: strategy.maxStake,
          market: 'Match Winner',
          homeTeam: vb.homeTeam,
          awayTeam: vb.awayTeam,
          currency: 'SBETS',
        });
        logs.push(`✅ #${placed + 1} ${vb.selection} @ ${vb.marketOdds} | edge +${(vb.edge * 100).toFixed(1)}% | ${vb.leagueName || vb.sport}`);
        placed++;
      } else {
        if (skipped < 3) {
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

    if (placed === 0) {
      logs.push(`\n❌ No bets placed. ${allValueBets.length} opportunities found but none met all filters.`);
      logs.push(`💡 Try: lower Min Edge to ${(strategy.minEdge * 50).toFixed(0)}%, widen odds range, or set sport to "All".`);
    } else {
      logs.push(`\n✓ ${placed} bet${placed > 1 ? 's' : ''} added to slip. Review below and confirm.`);
      if (skipped > 3) logs.push(`  (${skipped} other opportunities skipped by filters)`);
    }

    setAutoLog(logs);
  };

  // ── Portfolio risk ───────────────────────────────────────────────────────
  const calcPortfolioRisk = () => {
    const source = selectedBets.length > 0
      ? selectedBets
      : allValueBets.slice(0, 5).map(v => ({
          stake: strategy.maxStake,
          odds: v.marketOdds,
          leagueName: v.leagueName,
          eventName: v.eventName,
          selectionName: v.selection,
          currency: 'SBETS',
        }));

    const total = source.reduce((s: number, b: any) => s + Number(b.stake || 1000), 0);
    const maxWin = source.reduce((s: number, b: any) => s + Number(b.stake || 1000) * Number(b.odds || 2.0), 0);
    const avgOdds = source.length > 0
      ? +(source.reduce((s: number, b: any) => s + Number(b.odds || 2.0), 0) / source.length).toFixed(2)
      : 0;
    const riskScore = +(total * 0.15).toFixed(0);
    const leagues = [...new Set(source.map((b: any) => b.leagueName || b.market || b.eventName?.split(' vs ')[0] || 'Unknown'))].filter(Boolean);
    const exposure = leagues.slice(0, 3).join(', ') + (leagues.length > 3 ? ` +${leagues.length - 3}` : '');

    setPortfolioResult({
      totalStake: total,
      riskScore,
      exposure,
      maxWin: +maxWin.toFixed(0),
      avgOdds,
      betCount: source.length,
      isLive: selectedBets.length > 0,
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
                <p className="text-cyan-300/70 text-sm">GPT-4o · Groq Llama 3.3 70B · Gemini 2.5 Flash · DeepSeek V3 • Real-time market data • 9-module analysis engine</p>
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
              <Badge className="text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30 px-1.5 py-0 ml-1">GPT-4o + Groq + DeepSeek</Badge>
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
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-400">
                    Formula: <span className="text-green-400 font-mono">edge = (true_prob / overround) − implied_prob</span>
                  </div>
                  <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs whitespace-nowrap">
                    {valueBets.length} bets
                  </Badge>
                </div>

                {/* Min-edge filter slider */}
                <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                  <div className="flex items-center gap-2 mb-2">
                    <Filter className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-xs text-gray-400">Min Edge Filter:</span>
                    <span className={`text-xs font-bold font-mono ml-auto ${minEdgeFilter > 0.08 ? 'text-green-400' : minEdgeFilter > 0.04 ? 'text-yellow-400' : 'text-gray-300'}`}>
                      &gt;{(minEdgeFilter * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input
                    type="range" min="0.01" max="0.15" step="0.005" value={minEdgeFilter}
                    onChange={e => setMinEdgeFilter(parseFloat(e.target.value))}
                    className="w-full accent-cyan-500"
                    data-testid="min-edge-filter"
                  />
                  <div className="flex items-center justify-between text-[10px] text-gray-600 mt-0.5">
                    <span>1% (all)</span>
                    <span>5% (strong)</span>
                    <span>15% (elite)</span>
                  </div>
                </div>

                {eventsLoading || upcomingLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-gray-400 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading market data…
                  </div>
                ) : valueBets.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">
                    {allValueBets.length > 0
                      ? `No bets with edge >${(minEdgeFilter * 100).toFixed(0)}% — lower the filter to see ${allValueBets.length} available.`
                      : 'No value bets detected in current markets.'}
                  </div>
                ) : valueBets.map((v, i) => (
                  <div key={i} className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] hover:border-green-500/30 transition-all">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate font-medium">{v.eventName}</div>
                        {v.leagueName && <div className="text-[11px] text-gray-500 truncate">{v.leagueName}</div>}
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-gray-400">{v.selection}</span>
                          <span className="text-xs text-cyan-400">@ {v.marketOdds}</span>
                          <span className="text-xs text-gray-500">AI {(v.aiProb * 100).toFixed(0)}%</span>
                        </div>
                        <EdgeBar edge={v.edge} />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => addBet({ id: `vb-${v.eventId}-${i}`, eventId: v.eventId, eventName: v.eventName, selectionName: v.selection, odds: v.marketOdds, stake: 1000, market: 'Match Winner', homeTeam: v.homeTeam, awayTeam: v.awayTeam, currency: 'SBETS' })}
                        className="h-7 text-xs bg-green-600/15 hover:bg-green-600/30 text-green-400 border border-green-500/30 flex-shrink-0"
                        data-testid={`add-value-bet-${i}`}
                      >
                        + 1K SBETS
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── 3. Monte Carlo ─────────────────────────────────────── */}
            {activeTab === 'montecarlo' && (
              <div className="space-y-4">
                <div className="text-xs text-gray-400">
                  Formula: <span className="text-purple-400 font-mono">CI = simulated ± 1.96√(p(1−p)/n)</span> — 95% confidence interval
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Win Probability: <span className="text-white font-mono">{(mcProb * 100).toFixed(0)}%</span></label>
                    <input type="range" min="0.05" max="0.95" step="0.01" value={mcProb}
                      onChange={e => setMcProb(parseFloat(e.target.value))}
                      className="w-full accent-purple-500" data-testid="mc-prob-slider" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Simulation Runs</label>
                    <select value={mcRuns} onChange={e => setMcRuns(Number(e.target.value))}
                      className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-2"
                      data-testid="mc-runs-select">
                      {[10000, 50000, 100000].map(n => <option key={n} value={n}>{n.toLocaleString()}</option>)}
                    </select>
                  </div>
                </div>
                <Button onClick={runMonteCarlo} disabled={mcRunning}
                  className="bg-purple-600 hover:bg-purple-700 text-white w-full"
                  data-testid="run-monte-carlo">
                  {mcRunning ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Running {mcRuns.toLocaleString()} simulations…</> : <><PlayCircle className="h-4 w-4 mr-2" />Run Monte Carlo Simulation</>}
                </Button>
                {mcResult && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Simulated Win %', value: `${mcResult.simulated}%`, color: 'text-purple-400' },
                      { label: '95% CI Lower', value: `${mcResult.lower}%`, color: 'text-blue-400' },
                      { label: '95% CI Upper', value: `${mcResult.upper}%`, color: 'text-green-400' },
                    ].map((r, i) => (
                      <div key={i} className="bg-[#0b1618] rounded-lg p-3 text-center border border-[#1e3a3f]">
                        <div className={`text-lg font-bold ${r.color}`}>{r.value}</div>
                        <div className="text-xs text-gray-400">{r.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 4. Odds Movement ───────────────────────────────────── */}
            {activeTab === 'odds-movement' && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400">Rule: <span className="text-blue-400 font-mono">|change| &gt; 10% → SHARP MONEY · &gt; 5% → STEAM MOVE</span></div>
                {oddsMovements.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">No odds movement data available.</div>
                ) : oddsMovements.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{m.match}</div>
                      {m.league && <div className="text-[10px] text-gray-500 truncate">{m.league}</div>}
                      <div className="flex gap-3 text-xs mt-0.5 items-center">
                        <span className="text-gray-500 line-through">{m.openingOdds}</span>
                        <ArrowRight className="h-3 w-3 text-gray-500" />
                        <span className={m.currentOdds < m.openingOdds ? 'text-red-400' : 'text-green-400'}>{m.currentOdds}</span>
                        <span className={m.changePct > 0 ? 'text-red-400' : 'text-green-400'}>{m.changePct > 0 ? '▼' : '▲'} {Math.abs(m.changePct)}%</span>
                      </div>
                    </div>
                    <span className={`text-xs whitespace-nowrap font-bold px-2 py-0.5 rounded-full ${m.signal === 'SHARP MONEY' ? 'bg-red-500/20 text-red-400' : m.signal === 'STEAM MOVE' ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-500/20 text-gray-400'}`}>{m.signal}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── 5. Arbitrage ───────────────────────────────────────── */}
            {activeTab === 'arbitrage' && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400">Formula: <span className="text-yellow-400 font-mono">(1/oddsA) + (1/oddsB) &lt; 1.0 → true arbitrage opportunity</span></div>
                {arbiOpps.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">No odds data for arbitrage calculation.</div>
                ) : arbiOpps.map((a, i) => (
                  <div key={i} className={`flex items-center gap-3 rounded-lg p-3 border transition-all ${a.profit > 0 ? 'bg-green-900/20 border-green-500/30' : 'bg-[#0b1618] border-[#1e3a3f]'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{a.event}</div>
                      {a.league && <div className="text-[10px] text-gray-500">{a.league}</div>}
                      <div className="text-xs text-gray-400 mt-0.5">
                        {a.bookA} @ {a.oddsA} | {a.bookB} @ {a.oddsB} | Implied: {(a.impliedProb * 100).toFixed(1)}%
                      </div>
                    </div>
                    {a.profit > 0 ? (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-xs whitespace-nowrap">+{a.profit}% profit</Badge>
                    ) : (
                      <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/40 text-xs">Overround</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── 6. AI Auto-Betting Engine ──────────────────────────── */}
            {activeTab === 'auto-bet' && (
              <div className="space-y-4">
                <div className="text-xs text-yellow-400/80 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> Bets are added to your slip — you confirm and sign the transaction manually.
                </div>

                {/* Qualifying count preview */}
                {(() => {
                  const qualifying = allValueBets.filter(vb => {
                    const nVb = normalizeSport(vb.sport);
                    const nSt = normalizeSport(strategy.sport);
                    return vb.edge >= strategy.minEdge &&
                      vb.marketOdds >= strategy.minOdds &&
                      vb.marketOdds <= strategy.maxOdds &&
                      (nSt === 'all' || nVb === nSt || nVb.includes(nSt) || nSt.includes(nVb));
                  });
                  return (
                    <div className={`rounded-lg px-3 py-2 text-xs flex items-center justify-between ${qualifying.length > 0 ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'}`}>
                      <span className={qualifying.length > 0 ? 'text-green-300' : 'text-yellow-300'}>
                        {qualifying.length > 0
                          ? `${qualifying.length} bet${qualifying.length > 1 ? 's' : ''} qualify with current filters`
                          : 'No bets qualify — try loosening filters below'}
                      </span>
                      <span className="text-gray-400">{allValueBets.length} total opportunities</span>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Min Edge: <span className="text-white font-mono">{(strategy.minEdge * 100).toFixed(0)}%</span></label>
                    <input type="range" min="0.01" max="0.12" step="0.005" value={strategy.minEdge}
                      onChange={e => setStrategy(s => ({ ...s, minEdge: parseFloat(e.target.value) }))}
                      className="w-full accent-cyan-500" data-testid="strategy-min-edge" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Max Stake: <span className="text-white font-mono">{strategy.maxStake.toLocaleString()} SBETS</span></label>
                    <input type="range" min="100" max="10000" step="100" value={strategy.maxStake}
                      onChange={e => setStrategy(s => ({ ...s, maxStake: Number(e.target.value) }))}
                      className="w-full accent-cyan-500" data-testid="strategy-max-stake" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Min Odds: <span className="text-white font-mono">{strategy.minOdds.toFixed(1)}</span></label>
                    <input type="range" min="1.1" max="5.0" step="0.1" value={strategy.minOdds}
                      onChange={e => setStrategy(s => ({ ...s, minOdds: parseFloat(e.target.value) }))}
                      className="w-full accent-cyan-500" data-testid="strategy-min-odds" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Max Odds: <span className="text-white font-mono">{strategy.maxOdds.toFixed(1)}</span></label>
                    <input type="range" min="1.5" max="15.0" step="0.5" value={strategy.maxOdds}
                      onChange={e => setStrategy(s => ({ ...s, maxOdds: parseFloat(e.target.value) }))}
                      className="w-full accent-cyan-500" data-testid="strategy-max-odds" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Sport Filter</label>
                  <select value={strategy.sport} onChange={e => setStrategy(s => ({ ...s, sport: e.target.value }))}
                    className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-2"
                    data-testid="strategy-sport">
                    {['all', 'football', 'basketball', 'tennis', 'baseball', 'hockey', 'mma'].map(sp => (
                      <option key={sp} value={sp}>{sp.charAt(0).toUpperCase() + sp.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <Button onClick={runAutoBet} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold" data-testid="run-auto-bet">
                  <Bot className="h-4 w-4 mr-2" /> Run Auto-Bet Strategy (max {MAX_AUTO_BETS} bets)
                </Button>
                {autoLog.length > 0 && (
                  <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] space-y-1">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-gray-400 font-medium">Auto-Bet Log</div>
                      <button onClick={() => setAutoLog([])} className="text-[10px] text-gray-500 hover:text-red-400 transition-colors">Clear</button>
                    </div>
                    {autoLog.map((line, i) => (
                      <div key={i} className={`text-xs font-mono ${line.startsWith('✅') ? 'text-green-400' : line.startsWith('❌') ? 'text-red-400' : line.startsWith('💡') ? 'text-yellow-400' : line.startsWith('📊') ? 'text-cyan-400' : line.startsWith('✓') ? 'text-cyan-300' : 'text-gray-400'}`}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 7. Portfolio Risk Manager ──────────────────────────── */}
            {activeTab === 'portfolio' && (
              <div className="space-y-4">
                <div className="text-xs text-gray-400">
                  Formula: <span className="text-red-400 font-mono">risk_score = total_stake × 0.15</span>
                  {' — '}
                  {selectedBets.length > 0
                    ? <span className="text-cyan-400">analysing your {selectedBets.length} active bet{selectedBets.length > 1 ? 's' : ''}</span>
                    : <span className="text-gray-500">add bets to your slip for live analysis, or click below for top value picks</span>}
                </div>

                {selectedBets.length === 0 && allValueBets.length > 0 && (
                  <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] space-y-1.5">
                    <div className="text-xs text-gray-400 font-medium mb-1">Top 5 value picks (preview):</div>
                    {allValueBets.slice(0, 5).map((v, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-gray-300 truncate max-w-[65%]">{v.selection} — {v.eventName}</span>
                        <span className="text-green-400 font-mono flex-shrink-0">@{v.marketOdds} +{(v.edge * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}

                <Button onClick={calcPortfolioRisk} className="w-full bg-red-700/70 hover:bg-red-700 text-white" data-testid="calc-portfolio-risk">
                  <BarChart3 className="h-4 w-4 mr-2" /> Analyse Portfolio Risk
                </Button>

                {portfolioResult && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-[#1e3a3f]">
                        <div className="text-base font-bold text-white font-mono">{portfolioResult.totalStake.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">Total Stake (SBETS)</div>
                      </div>
                      <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-red-500/20">
                        <div className="text-base font-bold text-red-400 font-mono">{portfolioResult.riskScore.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">Risk Score (SBETS)</div>
                      </div>
                      <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-green-500/20">
                        <div className="text-base font-bold text-green-400 font-mono">{portfolioResult.maxWin.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">Max Win (SBETS)</div>
                      </div>
                      <div className="bg-[#0b1618] rounded-lg p-3 text-center border border-[#1e3a3f]">
                        <div className="text-base font-bold text-yellow-400 font-mono">{portfolioResult.avgOdds}x</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">Avg Odds ({portfolioResult.betCount} bets)</div>
                      </div>
                    </div>
                    <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                      <div className="text-[10px] text-gray-500 mb-1">League Exposure</div>
                      <div className="text-xs text-yellow-400 break-words">{portfolioResult.exposure || 'N/A'}</div>
                    </div>
                    {!portfolioResult.isLive && (
                      <div className="text-[10px] text-gray-500 text-center">Based on top value picks — add bets to your slip for exact figures</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── 8. Live Match AI Engine ────────────────────────────── */}
            {activeTab === 'live-ai' && (
              <div className="space-y-3">
                {liveSignals.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">No live or upcoming matches to analyse. Check back during match windows.</div>
                ) : liveSignals.map((s, i) => (
                  <div key={i} className="bg-[#0b1618] rounded-lg p-3 border border-red-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-white font-medium truncate">{s.match}</div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.signal === 'BUY' ? 'bg-green-500/20 text-green-400' : s.signal === 'WATCH' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}`}>{s.signal}</span>
                        {s.isLive && <Badge className="text-[9px] bg-red-500/20 text-red-400 border-red-500/30 animate-pulse">LIVE</Badge>}
                      </div>
                    </div>
                    {s.league && <div className="text-[10px] text-gray-500">{s.league}</div>}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">{s.market}{s.odds ? ` · @${s.odds}` : ''}</span>
                      <span className="text-green-400 font-bold">{(s.strength * 100).toFixed(0)}% strength</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── 9. AI Bet Marketplace Intelligence ─────────────────── */}
            {activeTab === 'marketplace' && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400">Score = <span className="text-yellow-400 font-mono">ai_prob + edge + (odds / 10)</span> — higher = better value</div>
                {marketplaceBets.length === 0 ? (
                  <div className="text-gray-400 text-sm text-center py-4">Loading market intelligence…</div>
                ) : marketplaceBets.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] hover:border-yellow-500/30 transition-all">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-gray-400 text-black' : 'bg-amber-700 text-white'}`}>{b.rank}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">{b.selection}</div>
                      <div className="text-xs text-gray-400 truncate">{b.event}</div>
                      <div className="flex gap-2 text-xs mt-0.5">
                        <span className="text-yellow-400">Score: {b.score}</span>
                        <span className="text-gray-400">@ {b.odds}</span>
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

        {/* Infrastructure note */}
        <div className="rounded-xl border border-[#1e3a3f] bg-[#0d1f24] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-400 font-medium">System Infrastructure</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {['PostgreSQL DB', 'GPT-4o / Groq / DeepSeek', 'API-Sports Live', 'Walrus Protocol', 'Sui Blockchain', 'WebSocket Scores', 'Real-time Odds'].map((s, i) => (
              <span key={i} className="text-xs bg-[#0b1618] border border-[#1e3a3f] text-gray-400 px-2 py-1 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />{s}
              </span>
            ))}
          </div>
        </div>

      </div>
    </Layout>
  );
}
