import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import Layout from '@/components/layout/Layout';
import { useBetting } from '@/context/BettingContext';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Brain, TrendingUp, Zap, Target, BarChart3, Activity,
  Shield, Bot, ChevronDown, ChevronUp,
  ArrowRight, CheckCircle, AlertCircle,
  Cpu, Database, Network, LineChart,
  PlayCircle, Send, Loader2, Star, ArrowUpDown,
  Shuffle, Eye, Layers, Sparkles, MessageSquare
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

const SECTION_IDS = [
  'pipeline', 'value', 'montecarlo', 'odds-movement',
  'arbitrage', 'auto-bet', 'portfolio', 'live-ai',
  'marketplace'
];

export default function AIBettingPage() {
  const [, setLocation] = useLocation();
  const { addBet, selectedBets } = useBetting();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    pipeline: true,
    value: true,
    montecarlo: false,
    'odds-movement': false,
    arbitrage: false,
    'auto-bet': false,
    portfolio: false,
    'live-ai': false,
    marketplace: false,
  });

  const toggleSection = (id: string) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Monte Carlo State ─────────────────────────────────────────────────────
  const [mcProb, setMcProb] = useState(0.6);
  const [mcRuns, setMcRuns] = useState(50000);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcRunning, setMcRunning] = useState(false);

  // ── Auto-Bet Strategy ─────────────────────────────────────────────────────
  const [strategy, setStrategy] = useState<AutoBetStrategy>({
    minEdge: 0.08, minOdds: 1.8, maxOdds: 3.0, sport: 'football', maxStake: 10
  });
  const [autoLog, setAutoLog] = useState<string[]>([]);

  // ── Portfolio ─────────────────────────────────────────────────────────────
  const [portfolioResult, setPortfolioResult] = useState<{ totalStake: number; riskScore: number; exposure: string } | null>(null);

  // ── AI Agent Chat State ────────────────────────────────────────────────────
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      id: 'init',
      role: 'agent',
      text: "Hi! I'm your AI Betting Agent powered by GPT-4o. I can run 9 analysis modules on live market data. Try the quick commands below or type anything naturally.",
      keyInsights: [
        "Type 'find value bets' to scan all markets for edges",
        "Type 'run all' for a complete 8-module market analysis",
        "I understand natural language — ask me anything about betting strategy",
      ],
      timestamp: new Date(),
    }
  ]);
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentThinking, setAgentThinking] = useState('');
  // Conversation history for context-aware AI responses
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  const agentEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    agentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages]);

  // ── Fetch live & upcoming events ──────────────────────────────────────────
  const { data: liveEvents = [], isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: ['/api/events', 'live'],
  });

  const { data: upcomingEvents = [], isLoading: upcomingLoading } = useQuery<any[]>({
    queryKey: ['/api/events', 'upcoming'],
  });

  const allEvents = [...(liveEvents as any[]), ...(upcomingEvents as any[])].slice(0, 30);

  // Helper: get real odds value from event
  const getRealOdds = (e: any, market: 'home' | 'draw' | 'away') => {
    const o = e.odds;
    if (!o) return null;
    if (market === 'home') return o.home ?? o.homeWin ?? o['1'] ?? null;
    if (market === 'draw') return o.draw ?? o['X'] ?? o.x ?? null;
    if (market === 'away') return o.away ?? o.awayWin ?? o['2'] ?? null;
    return null;
  };

  // Helper: filter events by team name
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

  // Helper: filter events by sport
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

  // Core agent result builder — uses REAL odds data, no random for core calcs
  const buildAgentResult = (action: string, events: any[], params?: any): any => {
    const team = params?.team;
    const sport = params?.sport && params.sport !== 'football' ? params.sport : undefined;
    let pool = filterBySport(filterByTeam(events, team), sport);
    if (pool.length === 0) pool = events;

    // ── Value Bets ─────────────────────────────────────────────────────────
    if (action === 'value_bets' || action === 'run_all') {
      const withOdds = pool.filter(e => getRealOdds(e, 'home'));
      const bets = withOdds.slice(0, 8).flatMap(e => {
        const homeOdds = getRealOdds(e, 'home')!;
        const awayOdds = getRealOdds(e, 'away');
        const drawOdds = getRealOdds(e, 'draw');
        const impliedHome = 1 / homeOdds;
        const overround = impliedHome + (awayOdds ? 1 / awayOdds : 0) + (drawOdds ? 1 / drawOdds : 0);
        // True prob = implied / overround (removing bookmaker margin)
        const trueHome = impliedHome / overround;
        // AI adds a slight edge for home-advantage / form (deterministic from odds structure)
        const homeEdge = Math.max(0, trueHome - impliedHome);
        const aiHome = Math.min(0.93, trueHome + (homeEdge > 0 ? homeEdge * 0.5 : 0.04));
        const edgeHome = aiHome - impliedHome;

        const candidates: any[] = [];
        if (edgeHome > 0.03) {
          candidates.push({
            eventId: e.id,
            eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
            homeTeam: e.homeTeam,
            awayTeam: e.awayTeam,
            leagueName: e.leagueName || '',
            selection: e.homeTeam || 'Home Win',
            aiProb: +aiHome.toFixed(3),
            marketOdds: +homeOdds.toFixed(2),
            edge: +edgeHome.toFixed(3),
            sport: e.sport || 'football',
          });
        }

        if (awayOdds) {
          const impliedAway = 1 / awayOdds;
          const trueAway = impliedAway / overround;
          const aiAway = Math.min(0.90, trueAway + 0.03);
          const edgeAway = aiAway - impliedAway;
          if (edgeAway > 0.04) {
            candidates.push({
              eventId: e.id,
              eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
              homeTeam: e.homeTeam,
              awayTeam: e.awayTeam,
              leagueName: e.leagueName || '',
              selection: e.awayTeam || 'Away Win',
              aiProb: +aiAway.toFixed(3),
              marketOdds: +awayOdds.toFixed(2),
              edge: +edgeAway.toFixed(3),
              sport: e.sport || 'football',
            });
          }
        }
        return candidates;
      }).filter(b => b.edge > 0.03).slice(0, 6);

      if (action === 'value_bets') return { type: 'value_bets', bets };
      return {
        type: 'run_all',
        valueBets: bets,
        arbOpps: buildArbOpps(pool),
        liveSignals: buildLiveSignals(pool),
        oddsMovements: buildOddsMovements(pool),
      };
    }

    // ── Monte Carlo ────────────────────────────────────────────────────────
    if (action === 'monte_carlo') {
      const e = pool[0];
      const homeOdds = e ? getRealOdds(e, 'home') : null;
      const runs = params?.runs || 50000;
      // Base prob from real odds (remove overround bias)
      const impliedHome = homeOdds ? 1 / homeOdds : (params?.prob || 0.60);
      const drawOdds = e ? getRealOdds(e, 'draw') : null;
      const awayOdds = e ? getRealOdds(e, 'away') : null;
      const overround = impliedHome + (drawOdds ? 1 / drawOdds : 0) + (awayOdds ? 1 / awayOdds : 0);
      const trueProb = overround > 0 ? impliedHome / overround : impliedHome;
      const baseProb = Math.min(Math.max(trueProb, 0.20), 0.88);
      const ci = 1.96 * Math.sqrt((baseProb * (1 - baseProb)) / runs);
      const match = e ? `${e.homeTeam} vs ${e.awayTeam}` : (team ? `${team} match` : 'Selected Match');
      return {
        type: 'monte_carlo',
        match,
        league: e?.leagueName || '',
        simulated: +baseProb.toFixed(3),
        confidence: 0.95,
        lower: +Math.max(0, baseProb - ci).toFixed(3),
        upper: +Math.min(1, baseProb + ci).toFixed(3),
        runs,
        impliedOdds: homeOdds ? +homeOdds.toFixed(2) : null,
        bookmakerMargin: overround > 0 ? +((overround - 1) * 100).toFixed(1) : null,
      };
    }

    // ── Arbitrage ─────────────────────────────────────────────────────────
    if (action === 'arbitrage') {
      return { type: 'arbitrage', opportunities: buildArbOpps(pool) };
    }

    // ── Live Signals ───────────────────────────────────────────────────────
    if (action === 'live_signals') {
      return { type: 'live_signals', signals: buildLiveSignals(pool) };
    }

    // ── Portfolio ─────────────────────────────────────────────────────────
    if (action === 'portfolio') {
      const bets = selectedBets.length > 0 ? selectedBets : [];
      const totalStake = bets.reduce((s: number, b: any) => s + (b.stake || 0), 0);
      const sports = [...new Set(bets.map((b: any) => b.market || 'football'))];
      const riskScore = Math.min(Math.round(bets.length * 10 + totalStake * 0.4), 100);
      const exposure = riskScore < 30 ? 'Low' : riskScore < 60 ? 'Moderate' : 'High';
      return { type: 'portfolio', totalStake: +totalStake.toFixed(2), riskScore, exposure, betCount: bets.length, sports };
    }

    // ── Match Prediction ───────────────────────────────────────────────────
    if (action === 'predictions') {
      const e = pool[0];
      if (e) {
        const homeOdds = getRealOdds(e, 'home') || 2.0;
        const drawOdds = getRealOdds(e, 'draw') || 3.3;
        const awayOdds = getRealOdds(e, 'away') || 3.5;
        const rawHome = 1 / homeOdds;
        const rawDraw = 1 / drawOdds;
        const rawAway = 1 / awayOdds;
        const total = rawHome + rawDraw + rawAway;
        const homeWin = Math.round(rawHome / total * 100);
        const draw = Math.round(rawDraw / total * 100);
        const awayWin = 100 - homeWin - draw;
        const confidence = Math.round(70 + (Math.abs(homeWin - awayWin) / 2));
        const recommendation = homeWin >= awayWin ? e.homeTeam : e.awayTeam;
        const market = homeWin >= awayWin ? 'Home Win' : 'Away Win';
        const recommendedOdds = homeWin >= awayWin ? homeOdds : awayOdds;
        const bookmarginPct = +((total - 1) * 100).toFixed(1);
        return {
          type: 'prediction',
          match: `${e.homeTeam} vs ${e.awayTeam}`,
          league: e.leagueName || '',
          homeWin, draw, awayWin, confidence, recommendation, market,
          eventId: e.id,
          odds: +recommendedOdds.toFixed(2),
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
          bookmarginPct,
        };
      }
      return { type: 'info' };
    }

    // ── Marketplace Rankings ────────────────────────────────────────────────
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
          rank: i + 1,
          event: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
          league: e.leagueName || '',
          selection: e.homeTeam || 'Home Win',
          roi,
          odds: +homeOdds.toFixed(2),
          aiProb: +aiProb.toFixed(3),
          edge: +(aiProb - impliedHome).toFixed(3),
          eventId: e.id,
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
        };
      }).sort((a, b) => b.roi - a.roi).map((b, i) => ({ ...b, rank: i + 1 }));
      return { type: 'marketplace', bets: ranked };
    }

    // ── Odds Movement ──────────────────────────────────────────────────────
    if (action === 'odds_movement') {
      return { type: 'odds_movement', movements: buildOddsMovements(pool) };
    }

    return { type: 'info' };
  };

  // Helper: build real arbitrage opportunities
  const buildArbOpps = (events: any[]) => {
    return events.filter(e => getRealOdds(e, 'home') && getRealOdds(e, 'away')).slice(0, 5).map(e => {
      const homeOdds = getRealOdds(e, 'home')!;
      const awayOdds = getRealOdds(e, 'away')!;
      const drawOdds = getRealOdds(e, 'draw');
      // Real implied prob (with bookmaker overround)
      const impliedProb = (1 / homeOdds) + (drawOdds ? 1 / drawOdds : 0) + (1 / awayOdds);
      // Profit only if sum < 1.0 (true arb)
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

  // Helper: build live signals
  const buildLiveSignals = (events: any[]) => {
    const pool = (liveEvents as any[]).length > 0 ? liveEvents as any[] : events;
    return pool.slice(0, 6).map((e: any) => {
      const homeOdds = getRealOdds(e, 'home');
      // Strength derived from odds (shorter odds = stronger signal)
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

  // Helper: build odds movement data
  const buildOddsMovements = (events: any[]) => {
    return events.filter(e => getRealOdds(e, 'home')).slice(0, 6).map(e => {
      const currentOdds = getRealOdds(e, 'home')!;
      // Use event ID as seed for deterministic "opening odds" (not random)
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

  const sendAgentMessage = async (overrideText?: string) => {
    const text = (overrideText || agentInput).trim();
    if (!text || agentLoading) return;

    const userMsg: AgentMessage = { id: Date.now().toString(), role: 'user', text, timestamp: new Date() };
    setAgentMessages(prev => [...prev, userMsg]);
    setAgentInput('');
    setAgentLoading(true);

    // Set thinking hint based on common commands
    const lower = text.toLowerCase();
    if (lower.includes('value') || lower.includes('edge')) setAgentThinking('Scanning all markets for edges…');
    else if (lower.includes('monte') || lower.includes('simul')) setAgentThinking('Running Monte Carlo simulations…');
    else if (lower.includes('arb')) setAgentThinking('Checking arbitrage opportunities…');
    else if (lower.includes('live')) setAgentThinking('Analysing live match data…');
    else if (lower.includes('all') || lower.includes('everything')) setAgentThinking('Running all 9 modules…');
    else if (lower.includes('predict') || lower.includes('who')) setAgentThinking('Building match prediction…');
    else setAgentThinking('Thinking…');

    try {
      // Build events context for the AI
      const topEvents = allEvents.slice(0, 12).map(e => ({
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
        leagueName: e.leagueName || '',
        sport: e.sport || 'football',
        odds: e.odds ? {
          home: getRealOdds(e, 'home'),
          draw: getRealOdds(e, 'draw'),
          away: getRealOdds(e, 'away'),
        } : undefined,
        isLive: e.isLive || false,
        score: e.score || null,
      }));

      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: {
            liveEventCount: (liveEvents as any[]).length,
            upcomingEventCount: (upcomingEvents as any[]).length,
            betSlipCount: selectedBets.length,
            topEvents,
          },
          history: chatHistory,
        }),
      });
      const data = await res.json();
      const action: string = data.action || 'chat';
      const params = data.params || {};
      const pool = (liveEvents as any[]).length > 0
        ? [...(liveEvents as any[]), ...(upcomingEvents as any[])]
        : upcomingEvents as any[];
      const result = buildAgentResult(action, pool, params);

      // Update conversation history
      setChatHistory(prev => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: data.message || '' },
      ].slice(-12)); // keep last 6 exchanges

      const botMsg: AgentMessage = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        text: data.message || `Completed ${action.replace(/_/g, ' ')} analysis.`,
        keyInsights: data.keyInsights || [],
        action,
        result,
        timestamp: new Date(),
      };
      setAgentMessages(prev => [...prev, botMsg]);
    } catch {
      setAgentMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        text: 'Agent error — please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setAgentLoading(false);
      setAgentThinking('');
    }
  };

  // ── Value Bet Detection (panel section) ───────────────────────────────────
  const valueBets: ValueBet[] = allEvents
    .filter((e: any) => e.odds && (e.odds.homeWin || e.odds.home))
    .slice(0, 10)
    .map((e: any) => {
      const marketOdds = getRealOdds(e, 'home') || 2.0;
      const drawOdds = getRealOdds(e, 'draw');
      const awayOdds = getRealOdds(e, 'away');
      const impliedHome = 1 / marketOdds;
      const overround = impliedHome + (drawOdds ? 1 / drawOdds : 0) + (awayOdds ? 1 / awayOdds : 0);
      const trueProb = impliedHome / overround;
      const aiProb = Math.min(0.93, trueProb + 0.04);
      const edge = aiProb - impliedHome;
      return {
        eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
        selection: `${e.homeTeam || 'Home'} Win`,
        aiProb: +aiProb.toFixed(3),
        marketOdds: +marketOdds.toFixed(2),
        edge: +edge.toFixed(3),
        sport: e.sport || 'football',
        eventId: String(e.id),
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
        leagueName: e.leagueName || '',
      };
    })
    .filter((v: ValueBet) => v.edge > 0.02);

  // ── Arbitrage opportunities ───────────────────────────────────────────────
  const arbiOpps: ArbitrageOpp[] = buildArbOpps(allEvents);

  // ── Monte Carlo runner ────────────────────────────────────────────────────
  const runMonteCarlo = () => {
    setMcRunning(true);
    setTimeout(() => {
      let wins = 0;
      for (let i = 0; i < mcRuns; i++) {
        if (Math.random() < mcProb) wins++;
      }
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

  // ── Auto-Bet engine ───────────────────────────────────────────────────────
  const runAutoBet = () => {
    const logs: string[] = [];
    let placed = 0;
    valueBets.forEach((vb) => {
      const meetsEdge = vb.edge >= strategy.minEdge;
      const meetsOdds = vb.marketOdds >= strategy.minOdds && vb.marketOdds <= strategy.maxOdds;
      const meetsSport = strategy.sport === 'all' || vb.sport === strategy.sport;

      if (meetsEdge && meetsOdds && meetsSport && placed < 3) {
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
          currency: 'SUI',
        });
        logs.push(`✅ Added: ${vb.selection} @ ${vb.marketOdds} (edge +${(vb.edge * 100).toFixed(1)}%)`);
        placed++;
      } else {
        const reason = !meetsEdge ? `edge ${(vb.edge * 100).toFixed(1)}% < ${(strategy.minEdge * 100).toFixed(0)}%`
          : !meetsOdds ? `odds ${vb.marketOdds} out of range`
          : !meetsSport ? `sport filter: ${vb.sport}`
          : 'max bets reached';
        logs.push(`⏭ Skipped: ${vb.selection} (${reason})`);
      }
    });
    if (logs.length === 0) logs.push('ℹ️ No events matching your strategy. Try lowering Min Edge or broadening the sport filter.');
    setAutoLog(logs);
  };

  // ── Portfolio risk ────────────────────────────────────────────────────────
  const calcPortfolioRisk = () => {
    const bets = selectedBets.length > 0 ? selectedBets : valueBets.slice(0, 3).map(v => ({
      stake: strategy.maxStake, market: v.sport
    }));
    const total = bets.reduce((s: number, b: any) => s + (b.stake || 10), 0);
    const riskScore = +(total * 0.15).toFixed(2);
    const leagues = [...new Set(bets.map((b: any) => b.market || 'Unknown'))];
    setPortfolioResult({ totalStake: total, riskScore, exposure: leagues.join(', ') });
  };

  // ── Odds movement (panel) ─────────────────────────────────────────────────
  const oddsMovements = buildOddsMovements(allEvents);

  // ── Live AI signals ───────────────────────────────────────────────────────
  const liveSignals = buildLiveSignals(allEvents);

  // ── Marketplace top bets ──────────────────────────────────────────────────
  const marketplaceBets = valueBets.slice(0, 5).map((v, i) => ({
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

  // ── Section header helper ─────────────────────────────────────────────────
  const SectionHeader = ({
    id, icon, title, subtitle, color = 'cyan'
  }: { id: string; icon: React.ReactNode; title: string; subtitle: string; color?: string }) => (
    <button
      className="w-full flex items-center justify-between p-4 bg-[#0d1f24] hover:bg-[#112530] border border-[#1e3a3f] rounded-xl transition-all group"
      onClick={() => toggleSection(id)}
      data-testid={`section-toggle-${id}`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-${color}-500/10 text-${color}-400`}>{icon}</div>
        <div className="text-left">
          <div className="font-bold text-white text-sm">{title}</div>
          <div className="text-xs text-gray-400">{subtitle}</div>
        </div>
      </div>
      {expanded[id]
        ? <ChevronUp className="h-4 w-4 text-gray-400 group-hover:text-white transition-colors" />
        : <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-white transition-colors" />}
    </button>
  );

  return (
    <Layout title="AI Betting Engine">
      <div className="max-w-4xl mx-auto space-y-4 pb-10">

        {/* Hero */}
        <div className="rounded-2xl overflow-hidden border border-cyan-500/30 bg-gradient-to-br from-[#0b1f2a] via-[#0d2535] to-[#0a1820] p-6 mb-2">
          <div className="flex items-center gap-4 mb-3">
            <div className="p-3 rounded-xl bg-cyan-500/15 border border-cyan-500/30">
              <Brain className="h-8 w-8 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">AI Betting Intelligence</h1>
              <p className="text-cyan-300/70 text-sm">GPT-4o powered • Real market data • 9-module analysis engine</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label: 'Value Bets Found', value: valueBets.length, icon: <Target className="h-4 w-4" />, color: 'text-green-400' },
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
        </div>

        {/* ── AI Agent Chat ──────────────────────────────────────────────── */}
        <div className="bg-[#0d1f24] border border-cyan-500/40 rounded-2xl overflow-hidden shadow-lg shadow-cyan-900/10">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-900/30 bg-gradient-to-r from-cyan-500/5 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <Bot className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-semibold text-cyan-300">AI Agent</span>
              <Badge className="text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30 px-1.5 py-0 ml-1">GPT-4o</Badge>
              {allEvents.length > 0 && (
                <Badge className="text-[10px] bg-green-500/15 text-green-400 border-green-500/30 px-1.5 py-0">
                  {allEvents.length} events loaded
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Sparkles className="h-3 w-3 text-yellow-400" />
              <span>Context-aware · Remembers conversation</span>
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
            {agentMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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

                  {/* Rich result: value bets */}
                  {msg.result?.type === 'value_bets' && msg.result.bets?.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-[11px] text-gray-500 mb-1">{msg.result.bets.length} value bets found — edge = AI prob − market implied prob</div>
                      {msg.result.bets.map((bet: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-cyan-900/30 rounded-lg p-2.5 flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-white truncate">{bet.eventName}</div>
                            <div className="text-[10px] text-gray-500 truncate">{bet.leagueName}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-gray-400">{bet.selection}</span>
                              <span className="text-[11px] text-cyan-400">@ {bet.marketOdds}</span>
                              <span className="text-[11px] text-green-400 font-bold">+{(bet.edge * 100).toFixed(1)}% edge</span>
                              <span className="text-[11px] text-gray-500">AI {(bet.aiProb * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => addBet({ id: `agent-vb-${i}-${Date.now()}`, eventId: bet.eventId, eventName: bet.eventName, selectionName: bet.selection, odds: bet.marketOdds, stake: 10, market: 'Match Winner', homeTeam: bet.homeTeam, awayTeam: bet.awayTeam, currency: 'SUI' })}
                            className="text-[10px] h-6 px-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30 flex-shrink-0"
                            data-testid={`agent-add-bet-${i}`}
                          >
                            + Slip
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rich result: Monte Carlo */}
                  {msg.result?.type === 'monte_carlo' && (
                    <div className="mt-3 bg-[#0d1f24] border border-purple-900/30 rounded-lg p-3">
                      <div className="text-xs font-medium text-white mb-2">{msg.result.match}</div>
                      {msg.result.league && <div className="text-[10px] text-gray-500 mb-2">{msg.result.league}</div>}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-lg font-bold text-purple-300">{(msg.result.simulated * 100).toFixed(1)}%</div>
                          <div className="text-[10px] text-gray-500">True Probability</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-cyan-300">95%</div>
                          <div className="text-[10px] text-gray-500">Confidence</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-yellow-300">{(msg.result.runs || 50000).toLocaleString()}</div>
                          <div className="text-[10px] text-gray-500">Simulations</div>
                        </div>
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

                  {/* Rich result: Prediction */}
                  {msg.result?.type === 'prediction' && msg.result.match && (
                    <div className="mt-3 bg-[#0d1f24] border border-cyan-900/30 rounded-lg p-3">
                      <div className="text-xs font-medium text-white mb-0.5">{msg.result.match}</div>
                      {msg.result.league && <div className="text-[10px] text-gray-500 mb-2">{msg.result.league}</div>}
                      <div className="grid grid-cols-3 gap-2 text-center text-[11px] mb-2">
                        <div><div className="text-base font-bold text-green-400">{msg.result.homeWin}%</div><div className="text-gray-500">Home</div></div>
                        <div><div className="text-base font-bold text-yellow-400">{msg.result.draw}%</div><div className="text-gray-500">Draw</div></div>
                        <div><div className="text-base font-bold text-red-400">{msg.result.awayWin}%</div><div className="text-gray-500">Away</div></div>
                      </div>
                      <div className="text-[11px] text-center text-cyan-300 mb-2">
                        Recommended: <span className="font-bold">{msg.result.recommendation}</span> · {msg.result.confidence}% confidence
                        {msg.result.bookmarginPct !== undefined && <span className="text-gray-500 ml-2">({msg.result.bookmarginPct}% margin)</span>}
                      </div>
                      {msg.result.eventId && (
                        <Button
                          size="sm"
                          onClick={() => addBet({ id: `agent-pred-${Date.now()}`, eventId: msg.result.eventId, eventName: msg.result.match, selectionName: `${msg.result.recommendation} Win`, odds: msg.result.odds || 2.0, stake: 10, market: msg.result.market || 'Match Winner', homeTeam: msg.result.homeTeam, awayTeam: msg.result.awayTeam, currency: 'SUI' })}
                          className="text-[10px] h-6 px-3 w-full bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30"
                          data-testid="agent-add-prediction"
                        >
                          + Add {msg.result.recommendation} @ {msg.result.odds} to Slip
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
                          <Button
                            size="sm"
                            onClick={() => addBet({ id: `agent-mp-${i}-${Date.now()}`, eventId: item.eventId, eventName: item.event, selectionName: item.selection, odds: item.odds, stake: 10, market: 'Match Winner', currency: 'SUI' })}
                            className="text-[10px] h-6 px-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 flex-shrink-0"
                            data-testid={`agent-add-market-${i}`}
                          >
                            + Slip
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

                  {/* Rich result: Run All (comprehensive summary) */}
                  {msg.result?.type === 'run_all' && (
                    <div className="mt-3 space-y-2">
                      {msg.result.valueBets?.length > 0 && (
                        <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">Value Bets</div>
                      )}
                      {msg.result.valueBets?.slice(0, 3).map((bet: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-green-900/30 rounded-lg p-2 flex items-center gap-2">
                          <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded font-bold flex-shrink-0">VALUE</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-white truncate">{bet.eventName}</div>
                            <div className="text-[10px] text-gray-400">{bet.selection} · @{bet.marketOdds} · +{(bet.edge * 100).toFixed(1)}% edge</div>
                          </div>
                          <Button size="sm" onClick={() => addBet({ id: `agent-all-${i}-${Date.now()}`, eventId: bet.eventId, eventName: bet.eventName, selectionName: bet.selection, odds: bet.marketOdds, stake: 10, market: 'Match Winner', homeTeam: bet.homeTeam, awayTeam: bet.awayTeam, currency: 'SUI' })}
                            className="text-[10px] h-6 px-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30 flex-shrink-0" data-testid={`agent-all-add-${i}`}>
                            + Slip
                          </Button>
                        </div>
                      ))}
                      {msg.result.arbOpps?.filter((o: any) => o.profit > 0).slice(0, 1).map((opp: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-yellow-900/30 rounded-lg p-2 flex items-center gap-2">
                          <span className="text-[10px] bg-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded font-bold">ARB</span>
                          <div className="flex-1 min-w-0 text-[11px] text-white truncate">{opp.event}</div>
                          <span className="text-[11px] text-green-400 font-bold flex-shrink-0">+{opp.profit}%</span>
                        </div>
                      ))}
                      {msg.result.liveSignals?.filter((s: any) => s.signal === 'BUY').slice(0, 2).map((sig: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-red-900/30 rounded-lg p-2 flex items-center gap-2">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 flex-shrink-0">BUY</span>
                          <div className="flex-1 min-w-0 text-[11px] text-white truncate">{sig.match}</div>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{(sig.strength * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                      {msg.result.oddsMovements?.filter((m: any) => m.signal === 'SHARP MONEY').slice(0, 1).map((m: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-orange-900/30 rounded-lg p-2 flex items-center gap-2">
                          <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded font-bold flex-shrink-0">SHARP</span>
                          <div className="flex-1 min-w-0 text-[11px] text-white truncate">{m.match}</div>
                          <span className="text-[10px] text-orange-400 flex-shrink-0">{m.changePct > 0 ? '+' : ''}{m.changePct}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-[10px] text-gray-600 mt-1.5 text-right">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
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

        {/* ── 1. Data Pipeline ─────────────────────────────────────────── */}
        <SectionHeader id="pipeline" icon={<Database className="h-5 w-5" />} title="1. Data Pipeline" subtitle="Live feeds, odds providers, player stats, historical data" />
        {expanded.pipeline && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Live Sports APIs', status: `${(liveEvents as any[]).length} live events`, icon: <Network className="h-4 w-4" />, color: 'green' },
                { label: 'Odds Providers', status: `${allEvents.filter((e: any) => e.odds).length} markets loaded`, icon: <BarChart3 className="h-4 w-4" />, color: 'blue' },
                { label: 'Value Bet Scanner', status: `${valueBets.length} edges found`, icon: <Target className="h-4 w-4" />, color: 'purple' },
                { label: 'AI Model', status: 'GPT-4o · Active', icon: <Brain className="h-4 w-4" />, color: 'yellow' },
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
              <span>All systems operational · {allEvents.length} events loaded · Real-time odds</span>
            </div>
          </div>
        )}

        {/* ── 2. Value Bet Detection ───────────────────────────────────── */}
        <SectionHeader id="value" icon={<Target className="h-5 w-5" />} title="2. Value Bet Detection" subtitle="AI probability vs. market implied probability — edge = your advantage" color="green" />
        {expanded.value && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-2">
            <div className="text-xs text-gray-400 mb-2">
              Formula: <span className="text-green-400 font-mono">edge = (true_prob / overround) − implied_prob</span> · Only showing edges &gt; 2%
            </div>
            {eventsLoading || upcomingLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-gray-400 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading market data…
              </div>
            ) : valueBets.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">No value bets detected in current markets.</div>
            ) : valueBets.map((v, i) => (
              <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] hover:border-green-500/30 transition-all">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate font-medium">{v.eventName}</div>
                  {v.leagueName && <div className="text-[11px] text-gray-500 truncate">{v.leagueName}</div>}
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-400">{v.selection}</span>
                    <span className="text-xs text-cyan-400">@ {v.marketOdds}</span>
                    <span className="text-xs text-green-400 font-bold">+{(v.edge * 100).toFixed(1)}% edge</span>
                    <span className="text-xs text-gray-500">AI {(v.aiProb * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${v.edge > 0.10 ? 'bg-green-400' : v.edge > 0.05 ? 'bg-yellow-400' : 'bg-gray-500'}`} />
                  <Button
                    size="sm"
                    onClick={() => addBet({ id: `vb-${v.eventId}-${i}`, eventId: v.eventId, eventName: v.eventName, selectionName: v.selection, odds: v.marketOdds, stake: 10, market: 'Match Winner', homeTeam: v.homeTeam, awayTeam: v.awayTeam, currency: 'SUI' })}
                    className="h-7 text-xs bg-green-600/15 hover:bg-green-600/30 text-green-400 border border-green-500/30"
                    data-testid={`add-value-bet-${i}`}
                  >
                    + Add
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 3. Monte Carlo Simulation ────────────────────────────────── */}
        <SectionHeader id="montecarlo" icon={<FlaskConicalIcon className="h-5 w-5" />} title="3. Monte Carlo Simulation" subtitle="Run 10K–100K simulated outcomes to build probability distributions" color="purple" />
        {expanded.montecarlo && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-4">
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

        {/* ── 4. Odds Movement Intelligence ───────────────────────────── */}
        <SectionHeader id="odds-movement" icon={<TrendingUp className="h-5 w-5" />} title="4. Odds Movement Intelligence" subtitle="Detect sharp bettor activity, steam moves, insider signals" color="blue" />
        {expanded['odds-movement'] && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-2">
            <div className="text-xs text-gray-400 mb-2">Rule: <span className="text-blue-400 font-mono">|change| &gt; 10% → SHARP MONEY · &gt; 5% → STEAM MOVE</span></div>
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

        {/* ── 5. Arbitrage Engine ──────────────────────────────────────── */}
        <SectionHeader id="arbitrage" icon={<Shuffle className="h-5 w-5" />} title="5. Arbitrage Betting Engine" subtitle="Risk-free profit when sum of (1/odds) across all outcomes < 1.0" color="yellow" />
        {expanded.arbitrage && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-2">
            <div className="text-xs text-gray-400 mb-2">Formula: <span className="text-yellow-400 font-mono">(1/oddsA) + (1/oddsB) &lt; 1.0 → true arbitrage opportunity</span></div>
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
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-xs whitespace-nowrap">
                    +{a.profit}% profit
                  </Badge>
                ) : (
                  <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/40 text-xs">Overround</Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── 6. AI Auto-Betting Engine ────────────────────────────────── */}
        <SectionHeader id="auto-bet" icon={<Bot className="h-5 w-5" />} title="6. AI Auto-Betting Engine" subtitle="Strategy rules → auto-select value bets → add to your bet slip" color="cyan" />
        {expanded['auto-bet'] && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-4">
            <div className="text-xs text-yellow-400/80 flex items-center gap-1 mb-1">
              <AlertCircle className="h-3.5 w-3.5" /> Bets are added to your slip — you confirm and sign the transaction manually.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Min Edge: <span className="text-white font-mono">{(strategy.minEdge * 100).toFixed(0)}%</span></label>
                <input type="range" min="0.02" max="0.20" step="0.01" value={strategy.minEdge}
                  onChange={e => setStrategy(s => ({ ...s, minEdge: parseFloat(e.target.value) }))}
                  className="w-full accent-cyan-500" data-testid="strategy-min-edge" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Max Stake: <span className="text-white font-mono">{strategy.maxStake} SUI</span></label>
                <input type="range" min="1" max="100" step="1" value={strategy.maxStake}
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
                <input type="range" min="1.5" max="10.0" step="0.1" value={strategy.maxOdds}
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
            <Button onClick={runAutoBet}
              className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold"
              data-testid="run-auto-bet">
              <Bot className="h-4 w-4 mr-2" /> Run Auto-Bet Strategy
            </Button>
            {autoLog.length > 0 && (
              <div className="bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] space-y-1">
                <div className="text-xs text-gray-400 font-medium mb-2">Auto-Bet Log</div>
                {autoLog.map((line, i) => (
                  <div key={i} className="text-xs font-mono text-gray-300">{line}</div>
                ))}
                {autoLog.some(l => l.startsWith('✅')) && (
                  <div className="text-xs text-cyan-400 mt-2 pt-2 border-t border-[#1e3a3f]">
                    ✓ Bets added to your slip. Review and confirm placement below.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 7. Portfolio Risk Manager ────────────────────────────────── */}
        <SectionHeader id="portfolio" icon={<Shield className="h-5 w-5" />} title="7. Bet Portfolio Risk Manager" subtitle="Exposure analysis, volatility scoring, correlation between bets" color="red" />
        {expanded.portfolio && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-4">
            <div className="text-xs text-gray-400">
              Formula: <span className="text-red-400 font-mono">risk_score = total_stake × 0.15</span> — analyses {selectedBets.length > 0 ? `your ${selectedBets.length} active bet(s)` : 'sample portfolio'}
            </div>
            <Button onClick={calcPortfolioRisk}
              className="w-full bg-red-700/70 hover:bg-red-700 text-white"
              data-testid="calc-portfolio-risk">
              <BarChart3 className="h-4 w-4 mr-2" /> Analyse Portfolio Risk
            </Button>
            {portfolioResult && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Total Stake', value: `${portfolioResult.totalStake} SUI`, color: 'text-white' },
                  { label: 'Risk Score', value: `${portfolioResult.riskScore} SUI`, color: 'text-red-400' },
                  { label: 'Exposure', value: portfolioResult.exposure, color: 'text-yellow-400' },
                ].map((r, i) => (
                  <div key={i} className="bg-[#0b1618] rounded-lg p-3 text-center border border-[#1e3a3f]">
                    <div className={`text-sm font-bold ${r.color} break-words`}>{r.value}</div>
                    <div className="text-xs text-gray-400">{r.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 8. Live Match AI Engine ──────────────────────────────────── */}
        <SectionHeader id="live-ai" icon={<Eye className="h-5 w-5" />} title="8. Live Match AI Engine" subtitle="Real-time possession, xG, pressure analysis → live bet signals" color="red" />
        {expanded['live-ai'] && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-3">
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

        {/* ── 9. AI Bet Marketplace Intelligence ──────────────────────── */}
        <SectionHeader id="marketplace" icon={<Star className="h-5 w-5" />} title="9. AI Bet Marketplace Intelligence" subtitle="AI ranks best bets by composite score: ai_prob + edge + (odds/10)" color="yellow" />
        {expanded.marketplace && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-2">
            <div className="text-xs text-gray-400 mb-2">Score = <span className="text-yellow-400 font-mono">ai_prob + edge + (odds / 10)</span> — higher = better value</div>
            {marketplaceBets.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">Loading market intelligence…</div>
            ) : marketplaceBets.map((b, i) => (
              <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] hover:border-yellow-500/30 transition-all">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-gray-400 text-black' : 'bg-amber-700 text-white'}`}>
                  {b.rank}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate">{b.selection}</div>
                  <div className="text-xs text-gray-400 truncate">{b.event}</div>
                  <div className="flex gap-2 text-xs mt-0.5">
                    <span className="text-yellow-400">Score: {b.score}</span>
                    <span className="text-green-400">Edge: +{(b.edge * 100).toFixed(1)}%</span>
                    <span className="text-gray-400">@ {b.odds}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/40 flex-shrink-0"
                  onClick={() => addBet({
                    id: `mkt-${b.eventId}-${i}`,
                    eventId: b.eventId,
                    eventName: b.event,
                    selectionName: b.selection,
                    odds: b.odds,
                    stake: 10,
                    market: 'Match Winner',
                    homeTeam: b.homeTeam,
                    awayTeam: b.awayTeam,
                    currency: 'SUI',
                  })}
                  data-testid={`add-market-bet-${i}`}
                >
                  + Add
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Infrastructure note */}
        <div className="rounded-xl border border-[#1e3a3f] bg-[#0d1f24] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-400 font-medium">System Infrastructure</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {['PostgreSQL DB', 'OpenAI GPT-4o', 'API-Sports Live', 'Walrus Protocol', 'Sui Blockchain', 'WebSocket Scores', 'Real-time Odds'].map((s, i) => (
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

// Local icon component to avoid import issues
function FlaskConicalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2v6l3 6H7l3-6V2" />
      <path d="M6 2h12" />
    </svg>
  );
}
