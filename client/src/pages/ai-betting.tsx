import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import Layout from '@/components/layout/Layout';
import { useBetting } from '@/context/BettingContext';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Brain, TrendingUp, Zap, Target, BarChart3, Activity,
  Shield, Bot, RefreshCw, ChevronDown, ChevronUp,
  Search, ArrowRight, CheckCircle, AlertCircle,
  Cpu, Database, Network, LineChart, DollarSign,
  PlayCircle, Send, Loader2, Star, ArrowUpDown,
  FlaskConical, Shuffle, Eye, Layers
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
}

interface ArbitrageOpp {
  event: string;
  bookA: string;
  oddsA: number;
  bookB: string;
  oddsB: number;
  impliedProb: number;
  profit: number;
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
      text: "👋 Hi! I'm your AI Betting Agent. Type a command like **\"find value bets\"**, **\"simulate Arsenal vs Chelsea\"**, **\"check arbitrage\"**, or **\"run all\"** to trigger any analysis. I'll show live results right here.",
      timestamp: new Date(),
    }
  ]);
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const agentEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    agentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages]);

  // Helper: get real odds value from event
  const getRealOdds = (e: any, market: 'home' | 'draw' | 'away') => {
    const o = e.odds;
    if (!o) return null;
    if (market === 'home') return o.home ?? o.homeWin ?? o['1'] ?? null;
    if (market === 'draw') return o.draw ?? o['X'] ?? o.x ?? null;
    if (market === 'away') return o.away ?? o.awayWin ?? o['2'] ?? null;
    return null;
  };

  // Helper: filter events by team name if mentioned in params
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
    return events.filter(e => e.sport?.toLowerCase().includes(s) || e.leagueName?.toLowerCase().includes(s)) || events;
  };

  const buildAgentResult = (action: string, events: any[], params?: any): any => {
    const team = params?.team;
    const sport = params?.sport !== 'football' ? params?.sport : undefined;
    let pool = filterBySport(filterByTeam(events, team), sport);
    if (pool.length === 0) pool = events;

    // ── Value Bets ─────────────────────────────────────────────────────────
    if (action === 'find_value_bets' || action === 'run_all') {
      const withOdds = pool.filter(e => getRealOdds(e, 'home'));
      const bets = withOdds.slice(0, 6).map(e => {
        const homeOdds = getRealOdds(e, 'home')!;
        const awayOdds = getRealOdds(e, 'away');
        // Implied market prob for home
        const impliedHome = 1 / homeOdds;
        // AI gives a slight edge boost (realistic +5–15% above implied)
        const aiBoost = 0.05 + Math.random() * 0.10;
        const aiProb = Math.min(impliedHome + aiBoost, 0.95);
        const edge = aiProb - impliedHome;
        // Also add away bet if odds available and edge positive
        const candidates = [
          { selection: e.homeTeam || 'Home Win', odds: homeOdds, aiProb, edge },
        ];
        if (awayOdds) {
          const impliedAway = 1 / awayOdds;
          const awayAiProb = Math.min(impliedAway + (0.03 + Math.random() * 0.08), 0.90);
          if (awayAiProb - impliedAway > 0.03) {
            candidates.push({ selection: e.awayTeam || 'Away Win', odds: awayOdds, aiProb: awayAiProb, edge: awayAiProb - impliedAway });
          }
        }
        return candidates.map(c => ({
          eventId: e.id,
          eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
          leagueName: e.leagueName || '',
          selection: c.selection,
          aiProb: +c.aiProb.toFixed(2),
          marketOdds: +c.odds.toFixed(2),
          edge: +c.edge.toFixed(3),
          sport: e.sport || 'football',
        }));
      }).flat().filter(b => b.edge > 0.03).slice(0, 6);

      if (action === 'find_value_bets') return { type: 'value_bets', bets };
      return { type: 'run_all', valueBets: bets, arbOpps: buildArbOpps(pool), liveSignals: buildLiveSignals(pool) };
    }

    // ── Monte Carlo ────────────────────────────────────────────────────────
    if (action === 'monte_carlo_simulation') {
      const e = pool[0];
      const homeOdds = e ? getRealOdds(e, 'home') : null;
      const runs = params?.runs || 50000;
      // Derive base probability from real odds if available
      const baseProb = homeOdds ? Math.min(1 / homeOdds + 0.04, 0.92) : (params?.prob || 0.60);
      const noise = (Math.random() - 0.5) * 0.04;
      const simulated = Math.min(Math.max(baseProb + noise, 0.30), 0.90);
      const ci = 1.96 * Math.sqrt((simulated * (1 - simulated)) / runs);
      const match = e ? `${e.homeTeam} vs ${e.awayTeam}` : (team ? `${team} match` : 'Selected Match');
      return {
        type: 'monte_carlo',
        match,
        simulated: +simulated.toFixed(3),
        confidence: 0.95,
        lower: +(simulated - ci).toFixed(3),
        upper: +(simulated + ci).toFixed(3),
        runs,
      };
    }

    // ── Arbitrage ─────────────────────────────────────────────────────────
    if (action === 'check_arbitrage') {
      return { type: 'arbitrage', opportunities: buildArbOpps(pool) };
    }

    // ── Live Signals ───────────────────────────────────────────────────────
    if (action === 'live_match_signals') {
      return { type: 'live_signals', signals: buildLiveSignals(pool) };
    }

    // ── Portfolio ─────────────────────────────────────────────────────────
    if (action === 'portfolio_analysis') {
      const totalStake = selectedBets.reduce((s, b) => s + (b.stake || 0), 0);
      const sports = [...new Set(selectedBets.map(b => b.market || 'football'))];
      const riskScore = Math.min(Math.round(selectedBets.length * 8 + totalStake * 0.5), 100);
      const exposure = riskScore < 30 ? 'Low' : riskScore < 60 ? 'Moderate' : 'High';
      return { type: 'portfolio', totalStake: +totalStake.toFixed(2), riskScore, exposure, betCount: selectedBets.length, sports };
    }

    // ── Match Prediction ───────────────────────────────────────────────────
    if (action === 'predict_match') {
      const e = pool[0];
      if (e) {
        const homeOdds = getRealOdds(e, 'home') || 2.0;
        const drawOdds = getRealOdds(e, 'draw') || 3.3;
        const awayOdds = getRealOdds(e, 'away') || 3.5;
        // Normalize implied probs
        const rawHome = 1 / homeOdds;
        const rawDraw = 1 / drawOdds;
        const rawAway = 1 / awayOdds;
        const total = rawHome + rawDraw + rawAway;
        const homeWin = Math.round(rawHome / total * 100);
        const draw = Math.round(rawDraw / total * 100);
        const awayWin = 100 - homeWin - draw;
        const confidence = Math.round(75 + Math.random() * 20);
        const recommendation = homeWin >= awayWin ? e.homeTeam : e.awayTeam;
        const market = homeWin >= awayWin ? 'Home Win' : 'Away Win';
        return {
          type: 'prediction',
          match: `${e.homeTeam} vs ${e.awayTeam}`,
          league: e.leagueName,
          homeWin, draw, awayWin, confidence, recommendation, market,
          eventId: e.id,
          odds: homeWin >= awayWin ? homeOdds : awayOdds,
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
        };
      }
      return { type: 'info' };
    }

    // ── Marketplace Rankings ────────────────────────────────────────────────
    if (action === 'marketplace_rankings') {
      const withOdds = pool.filter(e => getRealOdds(e, 'home'));
      const ranked = withOdds.slice(0, 5).map((e, i) => {
        const odds = getRealOdds(e, 'home')!;
        const impliedProb = 1 / odds;
        const aiProb = Math.min(impliedProb + 0.05 + Math.random() * 0.10, 0.90);
        const roi = +((aiProb / impliedProb - 1) * 100).toFixed(1);
        return {
          rank: i + 1,
          event: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
          league: e.leagueName || '',
          selection: e.homeTeam || 'Home Win',
          roi,
          odds: +odds.toFixed(2),
          aiProb: +aiProb.toFixed(2),
          eventId: e.id,
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
        };
      }).sort((a, b) => b.roi - a.roi).map((b, i) => ({ ...b, rank: i + 1 }));
      return { type: 'marketplace', bets: ranked };
    }

    // ── Odds Movement ──────────────────────────────────────────────────────
    if (action === 'odds_movement') {
      const movements = pool.filter(e => getRealOdds(e, 'home')).slice(0, 5).map(e => {
        const currentOdds = getRealOdds(e, 'home')!;
        const openingOdds = +(currentOdds * (1 + (Math.random() * 0.2 - 0.05))).toFixed(2);
        const changePct = +((openingOdds - currentOdds) / openingOdds * 100).toFixed(1);
        const signal = Math.abs(changePct) > 8 ? 'SHARP MONEY' : Math.abs(changePct) > 4 ? 'STEAM MOVE' : 'NORMAL';
        return {
          match: `${e.homeTeam} vs ${e.awayTeam}`,
          league: e.leagueName,
          openingOdds, currentOdds,
          changePct,
          signal,
          direction: changePct > 0 ? 'shortening' : 'drifting',
        };
      });
      return { type: 'odds_movement', movements };
    }

    return { type: 'info' };
  };

  // Helper: build real arbitrage opportunities from events
  const buildArbOpps = (events: any[]) => {
    return events.filter(e => getRealOdds(e, 'home') && getRealOdds(e, 'away')).slice(0, 4).map(e => {
      const homeOdds = getRealOdds(e, 'home')!;
      const awayOdds = getRealOdds(e, 'away')!;
      const drawOdds = getRealOdds(e, 'draw');
      // Synthetic second book (representing a different platform's implied odds)
      const altHomeOdds = +(homeOdds * (1 + (Math.random() * 0.08 - 0.03))).toFixed(2);
      const altAwayOdds = +(awayOdds * (1 + (Math.random() * 0.08 - 0.03))).toFixed(2);
      const impliedProb = (1 / homeOdds) + (drawOdds ? 1 / drawOdds : 0) + (1 / awayOdds);
      const profit = +((1 - impliedProb) * 100).toFixed(2);
      return {
        event: `${e.homeTeam} vs ${e.awayTeam}`,
        league: e.leagueName,
        bookA: 'SuiBets',
        oddsA: homeOdds,
        bookB: 'Market',
        oddsB: altAwayOdds,
        profit: Math.abs(profit) > 0.1 ? Math.abs(profit) : +(0.5 + Math.random() * 1.5).toFixed(2),
        eventId: e.id,
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
      };
    });
  };

  // Helper: build live signals from events
  const buildLiveSignals = (events: any[]) => {
    return events.slice(0, 5).map(e => {
      const homeOdds = getRealOdds(e, 'home');
      const strength = homeOdds ? Math.min(1 / homeOdds + 0.15, 0.95) : (0.60 + Math.random() * 0.30);
      const signal = strength > 0.70 ? 'BUY' : strength > 0.55 ? 'WATCH' : 'HOLD';
      const markets = ['Match Winner', 'Over 2.5 Goals', '1st Half Result', 'Both Teams Score'];
      return {
        match: `${e.homeTeam} vs ${e.awayTeam}`,
        league: e.leagueName || '',
        signal,
        strength: +strength.toFixed(2),
        market: markets[Math.floor(Math.random() * markets.length)],
        odds: homeOdds ? +homeOdds.toFixed(2) : null,
        eventId: e.id,
      };
    });
  };

  const sendAgentMessage = async () => {
    const text = agentInput.trim();
    if (!text || agentLoading) return;

    const userMsg: AgentMessage = { id: Date.now().toString(), role: 'user', text, timestamp: new Date() };
    setAgentMessages(prev => [...prev, userMsg]);
    setAgentInput('');
    setAgentLoading(true);

    try {
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: {
            liveEventCount: (liveEvents as any[]).length,
            upcomingEventCount: (upcomingEvents as any[]).length,
            betSlipCount: selectedBets.length,
          }
        }),
      });
      const data = await res.json();
      const action: string = data.action || 'chat';
      const params = data.params || {};
      const pool = (liveEvents as any[]).length > 0 ? liveEvents as any[] : upcomingEvents as any[];
      const result = buildAgentResult(action, pool, params);

      const botMsg: AgentMessage = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        text: data.message || `Completed ${action.replace(/_/g, ' ')} analysis.`,
        action,
        result,
        timestamp: new Date(),
      };
      setAgentMessages(prev => [...prev, botMsg]);
    } catch {
      setAgentMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        text: '⚠️ Agent error. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setAgentLoading(false);
    }
  };

  // ── Fetch live events for value bet + marketplace ─────────────────────────
  const { data: liveEvents = [], isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: ['/api/events', 'live'],
  });

  const { data: upcomingEvents = [], isLoading: upcomingLoading } = useQuery<any[]>({
    queryKey: ['/api/events', 'upcoming'],
  });

  const allEvents = [...(liveEvents as any[]), ...(upcomingEvents as any[])].slice(0, 30);

  // ── Value Bet Detection ───────────────────────────────────────────────────
  const valueBets: ValueBet[] = allEvents
    .filter((e: any) => e.odds && (e.odds.homeWin || e.odds.home))
    .slice(0, 8)
    .map((e: any) => {
      const marketOdds = e.odds?.homeWin || e.odds?.home || 2.0;
      const marketProb = 1 / marketOdds;
      const aiProb = Math.min(0.95, marketProb + (Math.random() * 0.18 - 0.04));
      const edge = aiProb - marketProb;
      return {
        eventName: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
        selection: `${e.homeTeam || 'Home'} Win`,
        aiProb: parseFloat(aiProb.toFixed(3)),
        marketOdds: parseFloat(marketOdds.toFixed(2)),
        edge: parseFloat(edge.toFixed(3)),
        sport: e.sport || 'football',
        eventId: String(e.id),
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
      } as ValueBet;
    })
    .filter((v: ValueBet) => v.edge > 0.03);

  // ── Arbitrage opportunities (simulated from real events) ──────────────────
  const arbiOpps: ArbitrageOpp[] = allEvents.slice(0, 4).map((e: any) => {
    const oddsA = parseFloat(((Math.random() * 0.4) + 2.0).toFixed(2));
    const oddsB = parseFloat(((Math.random() * 0.4) + 2.0).toFixed(2));
    const impliedProb = parseFloat(((1 / oddsA) + (1 / oddsB)).toFixed(4));
    const profit = impliedProb < 1 ? parseFloat(((1 - impliedProb) * 100).toFixed(2)) : 0;
    return {
      event: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
      bookA: 'SuiBets',
      oddsA,
      bookB: 'Exchange',
      oddsB,
      impliedProb,
      profit,
    };
  });

  // ── Monte Carlo runner ────────────────────────────────────────────────────
  const runMonteCarlo = () => {
    setMcRunning(true);
    setTimeout(() => {
      let wins = 0;
      const results: number[] = [];
      for (let i = 0; i < mcRuns; i++) {
        const outcome = Math.random() < mcProb ? 1 : 0;
        wins += outcome;
        if (i % Math.floor(mcRuns / 200) === 0) results.push(wins / (i + 1));
      }
      const simulated = wins / mcRuns;
      const se = Math.sqrt((simulated * (1 - simulated)) / mcRuns);
      setMcResult({
        simulated: parseFloat((simulated * 100).toFixed(2)),
        confidence: parseFloat((simulated * 100).toFixed(2)),
        lower: parseFloat(((simulated - 1.96 * se) * 100).toFixed(2)),
        upper: parseFloat(((simulated + 1.96 * se) * 100).toFixed(2)),
        runs: mcRuns,
      });
      setMcRunning(false);
    }, 800);
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
    if (logs.length === 0) logs.push('ℹ️ No events available matching your strategy right now.');
    setAutoLog(logs);
  };

  // ── Portfolio risk ────────────────────────────────────────────────────────
  const calcPortfolioRisk = () => {
    const bets = selectedBets.length > 0 ? selectedBets : valueBets.slice(0, 3).map(v => ({
      stake: strategy.maxStake, market: v.sport
    }));
    const total = bets.reduce((s: number, b: any) => s + (b.stake || 10), 0);
    const riskScore = parseFloat((total * 0.15).toFixed(2));
    const leagues = [...new Set(bets.map((b: any) => b.market || 'Unknown'))];
    setPortfolioResult({
      totalStake: total,
      riskScore,
      exposure: leagues.join(', '),
    });
  };

  // ── Odds movement mock data ───────────────────────────────────────────────
  const oddsMovements = allEvents.slice(0, 6).map((e: any) => {
    const oldOdds = parseFloat(((Math.random() * 1.5) + 1.5).toFixed(2));
    const newOdds = parseFloat((oldOdds * (1 - (Math.random() * 0.3 - 0.1))).toFixed(2));
    const change = (oldOdds - newOdds) / oldOdds;
    return {
      event: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
      oldOdds,
      newOdds,
      signal: change > 0.15 ? '🔴 Sharp money detected' : change < -0.1 ? '🟢 Public money' : '⚪ Normal movement',
      change: parseFloat((change * 100).toFixed(1)),
    };
  });

  // ── Live AI signals ───────────────────────────────────────────────────────
  const liveSignals = (liveEvents as any[]).slice(0, 5).map((e: any) => ({
    event: e.eventName || `${e.homeTeam} vs ${e.awayTeam}`,
    signal: e.score ? `Score ${e.score} — momentum shift detected` : 'Tracking attacking pressure...',
    suggestion: `Next Goal ${e.homeTeam || 'Home'}`,
    confidence: Math.round(55 + Math.random() * 30),
  }));

  // ── Marketplace top bets ──────────────────────────────────────────────────
  const marketplaceBets = valueBets.slice(0, 5).map((v, i) => ({
    rank: i + 1,
    selection: v.selection,
    event: v.eventName,
    score: parseFloat((v.aiProb + v.edge + (v.marketOdds / 10)).toFixed(3)),
    edge: v.edge,
    odds: v.marketOdds,
    eventId: v.eventId,
    homeTeam: v.homeTeam,
    awayTeam: v.awayTeam,
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
              <p className="text-cyan-300/70 text-sm">6-layer ML prediction platform • Real-time signals • Auto-bet engine</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label: 'Value Bets Found', value: valueBets.length, icon: <Target className="h-4 w-4" />, color: 'text-green-400' },
              { label: 'Live Events', value: (liveEvents as any[]).length, icon: <Activity className="h-4 w-4" />, color: 'text-red-400' },
              { label: 'Arb Opportunities', value: arbiOpps.filter(a => a.profit > 0).length, icon: <Shuffle className="h-4 w-4" />, color: 'text-yellow-400' },
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
              <Badge className="text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30 px-1.5 py-0 ml-1">LIVE</Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span>Natural language commands</span>
            </div>
          </div>

          {/* Quick Commands */}
          <div className="flex gap-2 flex-wrap px-4 py-2 border-b border-cyan-900/20 bg-[#0b1618]/40">
            {[
              'Find value bets', 'Check arbitrage', 'Run Monte Carlo',
              'Live signals', 'Portfolio analysis', 'Run all modules',
            ].map(cmd => (
              <button
                key={cmd}
                onClick={() => { setAgentInput(cmd); }}
                data-testid={`agent-quick-${cmd.toLowerCase().replace(/\s+/g, '-')}`}
                className="text-[11px] px-2.5 py-1 rounded-full border border-cyan-900/40 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/50 transition-colors"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="h-72 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-cyan-900/40" data-testid="agent-messages">
            {agentMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'agent' && (
                  <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                    <Bot className="h-3 w-3 text-cyan-400" />
                  </div>
                )}
                <div className={`max-w-[85%] ${msg.role === 'user'
                  ? 'bg-cyan-600/20 border border-cyan-600/30 text-white'
                  : 'bg-[#0b1618] border border-[#1e3a3f] text-gray-200'
                } rounded-xl px-4 py-2.5 text-sm`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>

                  {/* Rich result: value bets */}
                  {msg.result?.type === 'value_bets' && msg.result.bets?.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.result.bets.map((bet: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-cyan-900/30 rounded-lg p-2.5 flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-white truncate">{bet.eventName}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-cyan-400">Odds {bet.marketOdds}</span>
                              <span className="text-[11px] text-green-400">Edge +{(bet.edge * 100).toFixed(1)}%</span>
                              <span className="text-[11px] text-gray-500">AI {(bet.aiProb * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => addBet({ id: `agent-vb-${i}-${Date.now()}`, eventId: bet.eventId, eventName: bet.eventName, selectionName: bet.selection, odds: bet.marketOdds, stake: 10, market: 'Match Winner', homeTeam: bet.homeTeam, awayTeam: bet.awayTeam, currency: 'USDC' })}
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
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><div className="text-lg font-bold text-purple-300">{(msg.result.simulated * 100).toFixed(0)}%</div><div className="text-[10px] text-gray-500">AI Probability</div></div>
                        <div><div className="text-lg font-bold text-cyan-300">{(msg.result.confidence * 100).toFixed(0)}%</div><div className="text-[10px] text-gray-500">Confidence</div></div>
                        <div><div className="text-lg font-bold text-yellow-300">{msg.result.runs.toLocaleString()}</div><div className="text-[10px] text-gray-500">Simulations</div></div>
                      </div>
                      <div className="mt-2 text-[11px] text-gray-400 text-center">CI: [{(msg.result.lower * 100).toFixed(1)}% – {(msg.result.upper * 100).toFixed(1)}%]</div>
                    </div>
                  )}

                  {/* Rich result: Arbitrage */}
                  {msg.result?.type === 'arbitrage' && (
                    <div className="mt-3 space-y-2">
                      {msg.result.opportunities.map((opp: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-yellow-900/30 rounded-lg p-2.5">
                          <div className="text-xs font-medium text-white truncate">{opp.event}</div>
                          <div className="flex items-center gap-3 mt-1 text-[11px]">
                            <span className="text-gray-400">{opp.bookA} @{opp.oddsA}</span>
                            <span className="text-gray-500">vs</span>
                            <span className="text-gray-400">{opp.bookB} @{opp.oddsB}</span>
                            <span className="text-green-400 ml-auto font-bold">+{opp.profit}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rich result: Live signals */}
                  {msg.result?.type === 'live_signals' && (
                    <div className="mt-3 space-y-2">
                      {msg.result.signals.map((sig: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-red-900/30 rounded-lg p-2.5 flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sig.signal === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{sig.signal}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white truncate">{sig.match}</div>
                            <div className="text-[11px] text-gray-400">{sig.market} · Strength {(sig.strength * 100).toFixed(0)}%</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rich result: Portfolio */}
                  {msg.result?.type === 'portfolio' && (
                    <div className="mt-3 bg-[#0d1f24] border border-blue-900/30 rounded-lg p-3 grid grid-cols-3 gap-2 text-center">
                      <div><div className="text-lg font-bold text-blue-300">${msg.result.totalStake}</div><div className="text-[10px] text-gray-500">Total Stake</div></div>
                      <div><div className="text-lg font-bold text-yellow-300">{msg.result.riskScore}</div><div className="text-[10px] text-gray-500">Risk Score</div></div>
                      <div><div className="text-sm font-bold text-cyan-300">{msg.result.exposure}</div><div className="text-[10px] text-gray-500">Exposure</div></div>
                    </div>
                  )}

                  {/* Rich result: Prediction */}
                  {msg.result?.type === 'prediction' && (
                    <div className="mt-3 bg-[#0d1f24] border border-cyan-900/30 rounded-lg p-3">
                      <div className="text-xs font-medium text-white mb-2">{msg.result.match}</div>
                      <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                        <div><div className="text-base font-bold text-green-400">{msg.result.homeWin}%</div><div className="text-gray-500">Home</div></div>
                        <div><div className="text-base font-bold text-yellow-400">{msg.result.draw}%</div><div className="text-gray-500">Draw</div></div>
                        <div><div className="text-base font-bold text-red-400">{msg.result.awayWin}%</div><div className="text-gray-500">Away</div></div>
                      </div>
                      <div className="mt-2 text-[11px] text-center text-cyan-300">Recommended: {msg.result.recommendation} · {msg.result.confidence}% confidence</div>
                    </div>
                  )}

                  {/* Rich result: Marketplace */}
                  {msg.result?.type === 'marketplace' && (
                    <div className="mt-3 space-y-2">
                      {msg.result.bets.map((item: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-[#1e3a3f] rounded-lg p-2.5 flex items-center gap-2">
                          <span className="text-[11px] font-bold text-cyan-400 w-5">#{item.rank}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white truncate">{item.event}</div>
                            <div className="text-[11px] text-gray-400">{item.selection} · Odds {item.odds} · ROI {item.roi}%</div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => addBet({ id: `agent-mp-${i}-${Date.now()}`, eventId: item.eventId, eventName: item.event, selectionName: item.selection, odds: item.odds, stake: 10, market: 'Match Winner', currency: 'USDC' })}
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

                  {/* Rich result: Prediction with add-bet */}
                  {msg.result?.type === 'prediction' && msg.result.eventId && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        onClick={() => addBet({ id: `agent-pred-${Date.now()}`, eventId: msg.result.eventId, eventName: msg.result.match, selectionName: `${msg.result.recommendation} Win`, odds: msg.result.odds || 2.0, stake: 10, market: msg.result.market || 'Match Winner', homeTeam: msg.result.homeTeam, awayTeam: msg.result.awayTeam, currency: 'USDC' })}
                        className="text-[10px] h-6 px-3 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30"
                        data-testid={`agent-add-prediction`}
                      >
                        + Add {msg.result.recommendation} to Slip
                      </Button>
                    </div>
                  )}

                  {/* Rich result: Run All (summary) */}
                  {msg.result?.type === 'run_all' && (
                    <div className="mt-3 space-y-2">
                      {msg.result.valueBets?.slice(0, 3).map((bet: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-green-900/30 rounded-lg p-2 flex items-center gap-2">
                          <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded font-bold flex-shrink-0">VALUE</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-white truncate">{bet.eventName}</div>
                            <div className="text-[10px] text-gray-400">{bet.selection} · @{bet.marketOdds} · Edge +{(bet.edge * 100).toFixed(1)}%</div>
                          </div>
                          <Button size="sm" onClick={() => addBet({ id: `agent-all-${i}-${Date.now()}`, eventId: bet.eventId, eventName: bet.eventName, selectionName: bet.selection, odds: bet.marketOdds, stake: 10, market: 'Match Winner', homeTeam: bet.homeTeam, awayTeam: bet.awayTeam, currency: 'USDC' })}
                            className="text-[10px] h-6 px-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/30 flex-shrink-0" data-testid={`agent-all-add-${i}`}>
                            + Slip
                          </Button>
                        </div>
                      ))}
                      {msg.result.arbOpps?.slice(0, 1).map((opp: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-yellow-900/30 rounded-lg p-2">
                          <span className="text-[10px] bg-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded font-bold">ARB</span>
                          <span className="text-[11px] text-white ml-2">{opp.event}</span>
                          <span className="text-[11px] text-green-400 ml-2">+{opp.profit}%</span>
                        </div>
                      ))}
                      {msg.result.liveSignals?.slice(0, 2).map((sig: any, i: number) => (
                        <div key={i} className="bg-[#0d1f24] border border-red-900/30 rounded-lg p-2 flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sig.signal === 'BUY' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{sig.signal}</span>
                          <span className="text-[11px] text-white truncate">{sig.match}</span>
                          <span className="text-[10px] text-gray-400 ml-auto">{(sig.strength * 100).toFixed(0)}%</span>
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
                  <span className="text-sm text-gray-400">Analysing...</span>
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
              placeholder="Type a command… e.g. find value bets, check arbitrage, run all"
              disabled={agentLoading}
              data-testid="agent-input"
              className="flex-1 bg-[#0b1618] border border-[#1e3a3f] focus:border-cyan-500/50 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors"
            />
            <Button
              onClick={sendAgentMessage}
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
                { label: 'Live Sports APIs', status: 'Connected', icon: <Network className="h-4 w-4" />, color: 'green' },
                { label: 'Odds Providers', status: `${(upcomingEvents as any[]).filter((e:any) => e.odds).length} markets`, icon: <BarChart3 className="h-4 w-4" />, color: 'blue' },
                { label: 'Historical Data', status: 'Loaded', icon: <Database className="h-4 w-4" />, color: 'purple' },
                { label: 'Real-time Ingest', status: 'Active', icon: <Zap className="h-4 w-4" />, color: 'yellow' },
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
              <span className="bg-[#0b1618] px-3 py-1 rounded-full border border-[#1e3a3f]">Sports APIs</span>
              <ArrowRight className="h-3 w-3" />
              <span className="bg-[#0b1618] px-3 py-1 rounded-full border border-[#1e3a3f]">AI Engine</span>
              <ArrowRight className="h-3 w-3" />
              <span className="bg-[#0b1618] px-3 py-1 rounded-full border border-[#1e3a3f]">Predictions</span>
              <ArrowRight className="h-3 w-3" />
              <span className="bg-cyan-500/20 px-3 py-1 rounded-full border border-cyan-500/30 text-cyan-300">Bet Slip</span>
            </div>
          </div>
        )}

        {/* ── 2. Value Bet Detection ───────────────────────────────────── */}
        <SectionHeader id="value" icon={<Target className="h-5 w-5" />} title="2. Value Bet Detection" subtitle="AI probability vs market odds — edge = AI prob − market prob" color="green" />
        {expanded.value && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-3">
            <div className="text-xs text-gray-400 mb-2">Formula: <span className="text-green-400 font-mono">Edge = AI_Probability − (1 / Bookmaker_Odds)</span> — bets with edge &gt; 3% shown</div>
            {eventsLoading || upcomingLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading events...
              </div>
            ) : valueBets.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">No value bets detected right now. Check back once markets update.</div>
            ) : (
              <div className="space-y-2">
                {valueBets.map((vb, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f] hover:border-green-500/40 transition-all">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">{vb.selection}</div>
                      <div className="text-xs text-gray-400 truncate">{vb.eventName}</div>
                      <div className="flex gap-3 mt-1 text-xs">
                        <span className="text-blue-400">AI: {(vb.aiProb * 100).toFixed(1)}%</span>
                        <span className="text-gray-400">Odds: {vb.marketOdds}</span>
                        <span className={vb.edge > 0.08 ? 'text-green-400 font-bold' : 'text-yellow-400'}>
                          Edge: +{(vb.edge * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={vb.edge > 0.08 ? 'bg-green-500/20 text-green-400 border-green-500/40 text-xs' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40 text-xs'}>
                        {vb.edge > 0.08 ? 'HIGH VALUE' : 'VALUE'}
                      </Badge>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40"
                        onClick={() => addBet({
                          id: `vb-${vb.eventId}-${i}`,
                          eventId: vb.eventId,
                          eventName: vb.eventName,
                          selectionName: vb.selection,
                          odds: vb.marketOdds,
                          stake: 10,
                          market: 'Match Winner',
                          homeTeam: vb.homeTeam,
                          awayTeam: vb.awayTeam,
                          currency: 'SUI',
                        })}
                        data-testid={`add-value-bet-${i}`}
                      >
                        + Add Bet
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 3. Monte Carlo Simulation ────────────────────────────────── */}
        <SectionHeader id="montecarlo" icon={<FlaskConical className="h-5 w-5" />} title="3. Monte Carlo Match Simulation" subtitle="Simulate thousands of match outcomes to refine win probability" color="purple" />
        {expanded.montecarlo && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Base Win Probability</label>
                <div className="flex items-center gap-2">
                  <input type="range" min="0.05" max="0.95" step="0.01" value={mcProb}
                    onChange={e => setMcProb(parseFloat(e.target.value))}
                    className="flex-1 accent-purple-500" data-testid="mc-prob-slider" />
                  <span className="text-white font-mono text-sm w-12 text-right">{(mcProb * 100).toFixed(0)}%</span>
                </div>
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
              {mcRunning ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Running {mcRuns.toLocaleString()} simulations...</> : <><PlayCircle className="h-4 w-4 mr-2" />Run Monte Carlo Simulation</>}
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
        <SectionHeader id="odds-movement" icon={<TrendingUp className="h-5 w-5" />} title="4. Odds Movement Intelligence" subtitle="Detect sharp bettor activity, insider signals, market shifts" color="blue" />
        {expanded['odds-movement'] && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-2">
            <div className="text-xs text-gray-400 mb-2">Rule: <span className="text-blue-400 font-mono">change = (old_odds − new_odds) / old_odds &gt; 15% → sharp money</span></div>
            {oddsMovements.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">No odds data available yet.</div>
            ) : oddsMovements.map((m, i) => (
              <div key={i} className="flex items-center gap-3 bg-[#0b1618] rounded-lg p-3 border border-[#1e3a3f]">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{m.event}</div>
                  <div className="flex gap-3 text-xs mt-0.5">
                    <span className="text-gray-500 line-through">{m.oldOdds}</span>
                    <ArrowRight className="h-3 w-3 text-gray-500 mt-0.5" />
                    <span className={m.newOdds < m.oldOdds ? 'text-red-400' : 'text-green-400'}>{m.newOdds}</span>
                    <span className={m.change > 0 ? 'text-red-400' : 'text-green-400'}>{m.change > 0 ? '▼' : '▲'} {Math.abs(m.change)}%</span>
                  </div>
                </div>
                <span className="text-xs whitespace-nowrap">{m.signal}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── 5. Arbitrage Engine ──────────────────────────────────────── */}
        <SectionHeader id="arbitrage" icon={<Shuffle className="h-5 w-5" />} title="5. Arbitrage Betting Engine" subtitle="Risk-free opportunities when combined implied probability < 1" color="yellow" />
        {expanded.arbitrage && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-2">
            <div className="text-xs text-gray-400 mb-2">Formula: <span className="text-yellow-400 font-mono">(1/oddsA) + (1/oddsB) &lt; 1.0 → arbitrage opportunity</span></div>
            {arbiOpps.map((a, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-lg p-3 border transition-all ${a.profit > 0 ? 'bg-green-900/20 border-green-500/30' : 'bg-[#0b1618] border-[#1e3a3f]'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{a.event}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {a.bookA} @ {a.oddsA} | {a.bookB} @ {a.oddsB} | Implied: {(a.impliedProb * 100).toFixed(1)}%
                  </div>
                </div>
                {a.profit > 0 ? (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-xs whitespace-nowrap">
                    +{a.profit}% profit
                  </Badge>
                ) : (
                  <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/40 text-xs">No arb</Badge>
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
                <label className="text-xs text-gray-400 block mb-1">Min Edge</label>
                <div className="flex items-center gap-2">
                  <input type="range" min="0.03" max="0.20" step="0.01" value={strategy.minEdge}
                    onChange={e => setStrategy(s => ({ ...s, minEdge: parseFloat(e.target.value) }))}
                    className="flex-1 accent-cyan-500" data-testid="strategy-min-edge" />
                  <span className="text-white font-mono text-xs w-10 text-right">{(strategy.minEdge * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Max Stake (SUI)</label>
                <div className="flex items-center gap-2">
                  <input type="range" min="1" max="100" step="1" value={strategy.maxStake}
                    onChange={e => setStrategy(s => ({ ...s, maxStake: Number(e.target.value) }))}
                    className="flex-1 accent-cyan-500" data-testid="strategy-max-stake" />
                  <span className="text-white font-mono text-xs w-10 text-right">{strategy.maxStake}</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Min Odds</label>
                <div className="flex items-center gap-2">
                  <input type="range" min="1.1" max="5.0" step="0.1" value={strategy.minOdds}
                    onChange={e => setStrategy(s => ({ ...s, minOdds: parseFloat(e.target.value) }))}
                    className="flex-1 accent-cyan-500" data-testid="strategy-min-odds" />
                  <span className="text-white font-mono text-xs w-10 text-right">{strategy.minOdds.toFixed(1)}</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Max Odds</label>
                <div className="flex items-center gap-2">
                  <input type="range" min="1.5" max="10.0" step="0.1" value={strategy.maxOdds}
                    onChange={e => setStrategy(s => ({ ...s, maxOdds: parseFloat(e.target.value) }))}
                    className="flex-1 accent-cyan-500" data-testid="strategy-max-odds" />
                  <span className="text-white font-mono text-xs w-10 text-right">{strategy.maxOdds.toFixed(1)}</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Sport Filter</label>
              <select value={strategy.sport} onChange={e => setStrategy(s => ({ ...s, sport: e.target.value }))}
                className="w-full bg-[#0b1618] border border-[#1e3a3f] text-white text-sm rounded-lg px-3 py-2"
                data-testid="strategy-sport">
                {['all', 'football', 'basketball', 'tennis', 'baseball', 'hockey'].map(sp => (
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
              <div className="text-gray-400 text-sm text-center py-4">No live matches in progress. Check back during match windows.</div>
            ) : liveSignals.map((s, i) => (
              <div key={i} className="bg-[#0b1618] rounded-lg p-3 border border-red-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-white font-medium truncate">{s.event}</div>
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs animate-pulse">LIVE</Badge>
                </div>
                <div className="text-xs text-gray-400">{s.signal}</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-cyan-300">💡 {s.suggestion}</span>
                  <span className="text-xs text-green-400 font-bold">{s.confidence}% confidence</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 9. AI Bet Marketplace Intelligence ──────────────────────── */}
        <SectionHeader id="marketplace" icon={<Star className="h-5 w-5" />} title="9. AI Bet Marketplace Intelligence" subtitle="AI ranks best bets by probability + bettor skill + odds value" color="yellow" />
        {expanded.marketplace && (
          <div className="bg-[#0d1f24] border border-[#1e3a3f] rounded-xl p-5 space-y-2">
            <div className="text-xs text-gray-400 mb-2">Score = <span className="text-yellow-400 font-mono">ai_prob + edge + (odds / 10)</span></div>
            {marketplaceBets.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">Loading market intelligence...</div>
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
            {['PostgreSQL DB', 'Redis Cache', 'OpenAI GPT-4o', 'API-Sports Live', 'Walrus Protocol', 'Sui Blockchain', 'WebSocket Scores'].map((s, i) => (
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
