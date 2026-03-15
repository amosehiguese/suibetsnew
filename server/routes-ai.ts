import { Router, Request, Response } from 'express';
import OpenAI from 'openai';

// Resolve the OpenAI API key from multiple possible env var names
const resolveOpenAIKey = () =>
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.OPEN_AI_API_KEY ||
  '';

const getOpenAIClient = () => new OpenAI({ apiKey: resolveOpenAIKey() });

const router = Router();

// AI Betting Suggestion endpoint with provider selection
router.post('/api/ai/betting-suggestion', async (req: Request, res: Response) => {
  try {
    const { eventName, sport, homeTeam, awayTeam, provider = 'openai' } = req.body;

    let content = '';

    if (provider === 'anthropic') {
      content = await getAnthropicSuggestion(sport, eventName, homeTeam, awayTeam);
    } else if (provider === 'gemini') {
      content = await getGeminiSuggestion(sport, eventName, homeTeam, awayTeam);
    } else {
      content = await getOpenAISuggestion(sport, eventName, homeTeam, awayTeam);
    }

    if (!content) {
      return res.json({ suggestions: [] });
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [] };

    res.json(suggestions);
  } catch (error) {
    console.error('AI suggestion error:', error);
    res.json({ suggestions: [] });
  }
});

// OpenAI - GPT-4o
async function getOpenAISuggestion(sport: string, eventName: string, homeTeam: string, awayTeam: string): Promise<string> {
  const apiKey = resolveOpenAIKey();
  if (!apiKey) return '';
  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an elite sports betting analyst with deep expertise in probability theory, market inefficiencies, and value betting. You use sharp-money concepts, implied probability analysis, and statistical modeling. Return ONLY valid JSON with no markdown.`,
          },
          {
            role: 'user',
            content: `Analyze this ${sport} event and provide sharp betting recommendations:
Event: ${eventName}
${homeTeam ? `Home Team: ${homeTeam}` : ''}
${awayTeam ? `Away Team: ${awayTeam}` : ''}

Provide 3 betting recommendations across different markets. For each, calculate:
- implied probability from market odds
- your true probability estimate
- edge = true_prob - implied_prob
- kelly criterion stake suggestion

Return JSON:
{
  "suggestions": [
    {
      "market": "Market Name",
      "recommendation": "Specific bet selection",
      "confidence": 0.82,
      "edge": 0.07,
      "kellyFraction": 0.05,
      "reasoning": "Detailed 2-3 sentence analysis with specific statistical reasoning"
    }
  ]
}`,
          },
        ],
        temperature: 0.4,
        max_tokens: 600,
      });

    return completion.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('OpenAI error:', error);
    return '';
  }
}

// Anthropic - Claude
async function getAnthropicSuggestion(sport: string, eventName: string, homeTeam: string, awayTeam: string): Promise<string> {
  try {
    const response = await fetch(
      `${process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 600,
          system: `You are an elite sports betting analyst with deep expertise in probability theory, market inefficiencies, and value betting. Return ONLY valid JSON with no markdown.`,
          messages: [
            {
              role: 'user',
              content: `Analyze this ${sport} event and provide sharp betting recommendations:
Event: ${eventName}
${homeTeam ? `Home Team: ${homeTeam}` : ''}
${awayTeam ? `Away Team: ${awayTeam}` : ''}

Return JSON:
{
  "suggestions": [
    {
      "market": "Market Name",
      "recommendation": "Specific bet",
      "confidence": 0.82,
      "edge": 0.07,
      "reasoning": "Detailed analysis"
    }
  ]
}`,
            },
          ],
        }),
      }
    );

    const data = await response.json() as any;
    return data.content?.[0]?.text || '';
  } catch (error) {
    console.error('Anthropic error:', error);
    return '';
  }
}

// Gemini - Google
async function getGeminiSuggestion(sport: string, eventName: string, homeTeam: string, awayTeam: string): Promise<string> {
  try {
    const response = await fetch(
      `${process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/gemini-2.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': process.env.AI_INTEGRATIONS_GEMINI_API_KEY || '',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are an elite sports betting analyst. Analyze this ${sport} event and provide betting recommendations. Return ONLY valid JSON.

Event: ${eventName}
${homeTeam ? `Home Team: ${homeTeam}` : ''}
${awayTeam ? `Away Team: ${awayTeam}` : ''}

Return JSON:
{
  "suggestions": [
    {
      "market": "Market Name",
      "recommendation": "Specific bet",
      "confidence": 0.82,
      "edge": 0.07,
      "reasoning": "Detailed analysis"
    }
  ]
}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 600,
          },
        }),
      }
    );

    const data = await response.json() as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (error) {
    console.error('Gemini error:', error);
    return '';
  }
}

// ── Smart keyword-based intent detector (used when no OpenAI key) ─────────────
type AgentContext = {
  liveEventCount?: number;
  upcomingEventCount?: number;
  betSlipCount?: number;
  topEvents?: Array<{
    homeTeam: string;
    awayTeam: string;
    leagueName?: string;
    sport?: string;
    odds?: { home?: number; draw?: number; away?: number; homeWin?: number; awayWin?: number };
    isLive?: boolean;
    score?: string;
  }>;
};

function buildSmartFallback(message: string, context?: AgentContext): any {
  const lower = message.toLowerCase();

  // Detect action from keywords — run_all checked FIRST (highest specificity)
  let action = 'chat';
  if (/run all|full scan|all module|do everything|comprehens|complete scan/.test(lower) || (lower.includes('everything') && lower.includes('run'))) action = 'run_all';
  else if (/\barb\b|arbitrage|risk.free|guaranteed|no.risk|lock profit/.test(lower)) action = 'arbitrage';
  else if (/value|edge|good bet|what should|any tip|best value|find bet/.test(lower)) action = 'value_bets';
  else if (/simulat|monte.carlo|run sim|how likely/.test(lower)) action = 'monte_carlo';
  else if (/movement|sharp money|steam|line move|odds change|insider/.test(lower)) action = 'odds_movement';
  else if (/\blive\b|in.play|live signal|live bet/.test(lower) && !/\bdeliver\b|\believe\b/.test(lower)) action = 'live_signals';
  else if (/predict|who wins|who will|forecast|who should i bet|preview/.test(lower)) action = 'predictions';
  else if (/top pick|best bet|market place|ranking|\brank\b|top bet/.test(lower)) action = 'marketplace';
  else if (/portfolio|exposure|how much at risk|my bets|balance|kelly stake/.test(lower)) action = 'portfolio';
  else if (/probability|chance|simulate|simulation/.test(lower)) action = 'monte_carlo';

  // Detect sport
  let sport = 'football';
  if (/basketball|nba/.test(lower)) sport = 'basketball';
  else if (/tennis/.test(lower)) sport = 'tennis';
  else if (/baseball/.test(lower)) sport = 'baseball';
  else if (/hockey|nhl/.test(lower)) sport = 'hockey';
  else if (/mma|ufc|boxing|fight/.test(lower)) sport = 'mma';
  else if (/all sport|every sport/.test(lower)) sport = 'all';

  // Pick a featured live event from context for specific responses
  const liveCount = context?.liveEventCount ?? 0;
  const upcomingCount = context?.upcomingEventCount ?? 0;
  const events = context?.topEvents ?? [];
  const liveEvents = events.filter(e => e.isLive);
  const featured = liveEvents[0] ?? events[0];

  const featuredStr = featured
    ? `${featured.homeTeam} vs ${featured.awayTeam}${featured.isLive ? ` [LIVE ${featured.score ?? ''}]` : ''}`
    : 'current markets';

  const homeOdds = featured?.odds?.home ?? featured?.odds?.homeWin;
  const awayOdds = featured?.odds?.away ?? featured?.odds?.awayWin;
  const drawOdds = featured?.odds?.draw;
  const oddsStr = homeOdds ? `(H: ${homeOdds}${drawOdds ? ` D: ${drawOdds}` : ''} A: ${awayOdds ?? '?'})` : '';

  const actionMessages: Record<string, { message: string; insights: string[] }> = {
    value_bets: {
      message: `Scanning ${liveCount + upcomingCount} live & upcoming markets for value edges. Real bookmaker odds are loaded — running implied probability vs true probability comparison now. ${featured ? `Top candidate: ${featuredStr} ${oddsStr}.` : ''}`,
      insights: [
        `${liveCount} live events are active — in-play markets often have stale odds`,
        featured ? `${featured.homeTeam} vs ${featured.awayTeam}: home implied prob = ${homeOdds ? (100 / homeOdds).toFixed(1) : 'N/A'}%` : 'Scanning all markets for overround inefficiencies',
        'Kelly Criterion applied to all edges — risk-adjusted stake sizing shown',
      ],
    },
    monte_carlo: {
      message: `Running Monte Carlo simulation with 50,000 iterations across ${liveCount + upcomingCount} events. ${featured ? `Starting with ${featuredStr} ${oddsStr}.` : ''} Probability distributions and 95% confidence intervals will be computed from live bookmaker data.`,
      insights: [
        'Using real bookmaker odds to derive true probabilities (removing overround)',
        featured && homeOdds ? `${featured.homeTeam} base win prob ≈ ${(100 / homeOdds / (1 / (homeOdds || 1) + (drawOdds ? 1 / drawOdds : 0) + 1 / (awayOdds || 3)) * 100).toFixed(1)}%` : 'Simulation seeded by real market prices',
        'Results include variance bands — useful for deciding bet size',
      ],
    },
    arbitrage: {
      message: `Scanning ${liveCount + upcomingCount} markets for arb opportunities where bookmaker margins leave gaps. ${liveCount > 0 ? `${liveCount} live events are highest priority — live arb windows close fast.` : ''} Any opportunity found will guarantee profit regardless of outcome.`,
      insights: [
        'Arb = sum(1/odds) < 1.0 across all outcomes',
        liveCount > 0 ? `${liveCount} live markets checked first — they update every 30–60s` : `${upcomingCount} upcoming events analysed for pre-match arb`,
        'Guaranteed profit margins shown after stake calculator applied',
      ],
    },
    odds_movement: {
      message: `Analysing odds movement patterns across ${liveCount + upcomingCount} markets. ${featured ? `${featuredStr} ${oddsStr} is being tracked for sharp money signals.` : ''} Steam moves and line shifts indicate professional bettor activity.`,
      insights: [
        'Sharp money = significant odds drop (>8%) without news catalyst',
        featured ? `${featured.homeTeam} vs ${featured.awayTeam} movement indexed against opening line` : 'All markets scored for movement velocity',
        'Consensus sharp side shown with confidence indicator',
      ],
    },
    live_signals: {
      message: `${liveCount > 0 ? `${liveCount} live matches active right now.` : 'No live events at the moment.'} ${featured?.isLive ? `${featuredStr} — analysing possession, pressure and xG in real time.` : ''} In-play signals are updated continuously for momentum-based edges.`,
      insights: [
        liveCount > 0 ? `${liveCount} live markets with real-time odds` : 'Upcoming events flagged for pre-match entry signals',
        featured?.isLive ? `${featured.homeTeam} vs ${featured.awayTeam}: live score ${featured.score ?? 'N/A'}` : 'Live data ingestion begins at kick-off',
        'Momentum score = possession × shots-on-target weighting',
      ],
    },
    predictions: {
      message: `Generating deep match predictions from ${liveCount + upcomingCount} available events. ${featured ? `Leading analysis: ${featuredStr} ${oddsStr}.` : ''} Results include win/draw/loss probabilities and a recommended selection with reasoning.`,
      insights: [
        featured ? `Market favourite: ${homeOdds && awayOdds && homeOdds < awayOdds ? featured.homeTeam : featured ? featured.awayTeam : 'TBD'} based on bookmaker odds` : 'Prediction engine loaded',
        'Historical H2H, form, and market efficiency all weighted',
        'Recommended selection shown with Kelly stake suggestion',
      ],
    },
    marketplace: {
      message: `Ranking today's ${liveCount + upcomingCount} markets by composite AI score. ${featured ? `Featured: ${featuredStr} ${oddsStr}.` : ''} Bets are sorted by edge size × confidence — highest scoring opportunities shown first.`,
      insights: [
        'Score = (true_prob / implied_prob - 1) × confidence',
        `${liveCount} live + ${upcomingCount} upcoming events ranked`,
        'Top 5 bets shown with stake allocation and expected value',
      ],
    },
    portfolio: {
      message: `Analysing your active bet portfolio. Current slip has ${context?.betSlipCount ?? 0} selections. Showing total exposure, Kelly-optimal stake per bet, and diversification score across markets.`,
      insights: [
        `${context?.betSlipCount ?? 0} active selections on the bet slip`,
        'Kelly Criterion applied to each bet based on real edge',
        'Correlation risk between bets identified — avoid parlay correlation traps',
      ],
    },
    run_all: {
      message: `Executing full 8-module AI scan across ${liveCount + upcomingCount} live & upcoming markets. Value bets, arbitrage, Monte Carlo, live signals, odds movement, predictions, marketplace ranking, and portfolio analysis all running simultaneously.`,
      insights: [
        `${liveCount} live events + ${upcomingCount} upcoming events in scope`,
        'All 8 modules fire in parallel — results merged by confidence score',
        'Best opportunity from each module surfaced at the top',
      ],
    },
    chat: {
      message: `I'm SuiBets AI — your real-time sports betting intelligence assistant. I have ${liveCount + upcomingCount} live & upcoming events loaded with real bookmaker odds. Ask me to find value bets, run simulations, scan for arbitrage, analyse odds movement, or get live signals.`,
      insights: [
        `${liveCount} live events + ${upcomingCount} upcoming events ready to analyse`,
        'Try: "Find value bets", "Run Monte Carlo on Man City", "Show arbitrage", "Run all"',
        'All analysis uses real bookmaker odds — zero mock data',
      ],
    },
  };

  const resp = actionMessages[action] ?? actionMessages.chat;
  return {
    action,
    message: resp.message,
    keyInsights: resp.insights,
    params: {
      sport,
      team: null,
      prob: 0.6,
      runs: 50000,
      league: null,
    },
  };
}

// ── AI Agent Endpoint ─────────────────────────────────────────────────────────
router.post('/api/ai/agent', async (req: Request, res: Response) => {
  try {
    const { message, context, history } = req.body as {
      message: string;
      context?: {
        liveEventCount?: number;
        upcomingEventCount?: number;
        betSlipCount?: number;
        topEvents?: Array<{
          homeTeam: string;
          awayTeam: string;
          leagueName?: string;
          sport?: string;
          odds?: { home?: number; draw?: number; away?: number; homeWin?: number; awayWin?: number };
          isLive?: boolean;
          score?: string;
        }>;
      };
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    // Build events context string for the AI
    let eventsContext = '';
    if (context?.topEvents && context.topEvents.length > 0) {
      eventsContext = '\n\nCURRENT LIVE & UPCOMING EVENTS (use these for specific analysis):\n';
      context.topEvents.slice(0, 12).forEach((e, i) => {
        const homeOdds = e.odds?.home ?? e.odds?.homeWin;
        const drawOdds = e.odds?.draw;
        const awayOdds = e.odds?.away ?? e.odds?.awayWin;
        const oddsStr = homeOdds
          ? `Odds: H ${homeOdds}${drawOdds ? ` | D ${drawOdds}` : ''} | A ${awayOdds || '?'}`
          : 'Odds: N/A';
        const liveStr = e.isLive ? '[LIVE' + (e.score ? ` ${e.score}` + ']' : ']') : '[Upcoming]';
        eventsContext += `${i + 1}. ${e.homeTeam} vs ${e.awayTeam} ${liveStr} | ${e.leagueName || e.sport || 'Football'} | ${oddsStr}\n`;
      });
    }

    const systemPrompt = `You are SuiBets AI Agent — the world's most advanced sports betting intelligence system, powered by real-time market data, statistical modeling, and deep sports expertise.

TODAY'S PLATFORM STATS:
- Live events: ${context?.liveEventCount ?? 0}
- Upcoming events: ${context?.upcomingEventCount ?? 0}
- Active bet slip selections: ${context?.betSlipCount ?? 0}${eventsContext}

AVAILABLE ACTIONS:
- value_bets: Scan all markets for edges where AI true-probability > market implied-probability. Identify best value using Kelly Criterion logic.
- monte_carlo: Run Monte Carlo match simulation with 50,000+ iterations. Returns probability distribution with 95% confidence intervals.
- arbitrage: Find risk-free opportunities where sum of (1/odds) < 1.0 across outcomes. Real guaranteed profit scenarios.
- odds_movement: Detect sharp money, steam moves, and insider signals. Analyse opening vs current odds movement patterns.
- live_signals: Analyse live match data — possession, xG, pressure index — for in-play betting opportunities with momentum signals.
- predictions: Deep match prediction with win/draw/loss probabilities, key factors, and recommended selection.
- marketplace: Rank today's top bets by composite AI score = (true_prob / implied_prob - 1) × confidence.
- portfolio: Analyse current bet portfolio — total exposure, risk-adjusted Kelly stake, diversification score.
- run_all: Execute complete 8-module scan simultaneously. Returns best value bets, top arb, live signals in one shot.
- chat: Answer general betting questions, explain concepts, strategy advice.

INTENT MAPPING (be strict and precise):
"find value" / "value bets" / "edges" / "good bets" / "what should I bet" / "any tips" → value_bets
"simulate" / "monte carlo" / "simulation" / "probability" / "run sim" / "[team] vs [team]" probability → monte_carlo
"arbitrage" / "arb" / "risk free" / "guaranteed profit" / "no-risk" → arbitrage
"odds movement" / "sharp money" / "line movement" / "steam move" / "who's betting on" → odds_movement
"live" / "in-play" / "happening now" / "current match" / "live signal" / "live bet" → live_signals
"predict" / "who wins" / "who will win" / "forecast" / "analyse [team]" / "prediction for" → predictions
"top picks" / "best bets" / "marketplace" / "rankings" / "top bets" / "rank" → marketplace
"portfolio" / "risk" / "exposure" / "how much at risk" / "my bets" / "balance" → portfolio
"run all" / "everything" / "full scan" / "all modules" / "do everything" / "comprehensive" → run_all
anything else / questions / explanations → chat

RESPONSE QUALITY STANDARDS:
1. Always reference specific real events from the context when relevant
2. For value_bets/predictions: cite specific odds and calculated edge percentages
3. For monte_carlo: explain what the probability means in betting terms
4. For chat: give expert-level analysis with actionable insights
5. Your message must be informative and specific — never generic
6. When a team is mentioned, find it in the events list and reference real odds

EDGE CASE HANDLING:
- If user asks about a specific team not in events, still trigger the right action and note we'll scan all available markets
- If user says "yes" / "ok" / "do it" after a suggestion, re-trigger the same action type
- If user asks "what can you do" / "help" → chat with a detailed capability overview
- If user mixes requests ("value bets and arbitrage"), choose the primary intent (value_bets)
- Numbers in user message (e.g. "75% probability") → extract as prob param for monte_carlo

Return ONLY valid JSON with absolutely no markdown, no code blocks:
{
  "action": "<action_name>",
  "message": "<expert 2-3 sentence response — specific, data-driven, references real events or computed values>",
  "keyInsights": ["<insight 1>", "<insight 2>", "<insight 3>"],
  "params": {
    "sport": "<detected sport: football|basketball|tennis|baseball|hockey|mma|all>",
    "team": "<detected team name or null>",
    "prob": <detected probability 0.0-1.0 or 0.6>,
    "runs": <simulation runs or 50000>,
    "league": "<detected league name or null>"
  }
}`;

    // Build messages array with conversation history
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history for context-aware responses
    if (history && history.length > 0) {
      history.slice(-6).forEach(h => {
        messages.push({ role: h.role, content: h.content });
      });
    }

    messages.push({ role: 'user', content: message });

    // ── Try GPT-4o first, fall back to smart keyword parser ───────────────
    const apiKey = resolveOpenAIKey();
    let parsed: any = null;

    if (apiKey) {
      try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages,
          temperature: 0.25,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        });
        const content = completion.choices?.[0]?.message?.content || '';
        if (content) {
          try { parsed = JSON.parse(content); }
          catch { const m = content.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
        }
      } catch (err: any) {
        console.error('[AI Agent] OpenAI error:', err.message || err);
      }
    }

    // ── Smart keyword-based fallback ──────────────────────────────────────
    if (!parsed) {
      parsed = buildSmartFallback(message, context);
    }

    // Validate and normalise the action
    const validActions = ['value_bets', 'monte_carlo', 'arbitrage', 'odds_movement', 'live_signals', 'predictions', 'marketplace', 'portfolio', 'run_all', 'chat'];
    if (!validActions.includes(parsed.action)) {
      parsed.action = 'chat';
    }

    res.json(parsed);
  } catch (error) {
    console.error('AI agent error:', error);
    res.json({
      action: 'chat',
      message: "I'm ready to help analyse the markets. Try: 'find value bets', 'check arbitrage', 'run Monte Carlo simulation', or 'run all modules'.",
      keyInsights: ["Use 'run all' for a comprehensive market scan", "Ask about specific teams for targeted analysis"],
      params: { sport: 'football', prob: 0.6, runs: 50000 }
    });
  }
});

// ── AI Agent Predictions endpoint (detailed match analysis) ───────────────────
router.post('/api/ai/agent/predict', async (req: Request, res: Response) => {
  try {
    const { homeTeam, awayTeam, sport, odds, league } = req.body;

    // Calculate implied probabilities from real odds
    const homeOdds = odds?.home || odds?.homeWin || 2.0;
    const drawOdds = odds?.draw || 3.3;
    const awayOdds = odds?.away || odds?.awayWin || 3.5;

    const impliedHome = 1 / homeOdds;
    const impliedDraw = 1 / drawOdds;
    const impliedAway = 1 / awayOdds;
    const overround = impliedHome + impliedDraw + impliedAway;

    // Normalised true implied probs (removing bookmaker margin)
    const trueHome = (impliedHome / overround * 100).toFixed(1);
    const trueDraw = (impliedDraw / overround * 100).toFixed(1);
    const trueAway = (impliedAway / overround * 100).toFixed(1);

    const prompt = `You are an elite sports analyst. Provide a deep prediction for this ${sport || 'football'} match.

Match: ${homeTeam} vs ${awayTeam}
${league ? `League: ${league}` : ''}
Market Odds: Home ${homeOdds} | Draw ${drawOdds} | Away ${awayOdds}
Market Implied Probabilities (overround removed): Home ${trueHome}% | Draw ${trueDraw}% | Away ${trueAway}%
Bookmaker Margin: ${((overround - 1) * 100).toFixed(1)}%

Your task: Provide your TRUE probability estimates (may differ from market), identify if there is value, and give a specific recommendation.

Return ONLY valid JSON:
{
  "prediction": "Home Win" | "Draw" | "Away Win",
  "confidence": <0.0-1.0, your confidence in this prediction>,
  "homeWinProb": <your true probability 0.0-1.0>,
  "drawProb": <your true probability 0.0-1.0>,
  "awayWinProb": <your true probability 0.0-1.0>,
  "marketEdge": <positive = value, negative = no value, e.g. 0.07 means 7% edge>,
  "valueExists": <true|false>,
  "keyFactors": ["factor 1", "factor 2", "factor 3", "factor 4"],
  "recommendedBet": "specific bet description",
  "reasoning": "3-4 sentence expert analysis referencing odds, form, and statistical reasoning",
  "riskLevel": "Low" | "Medium" | "High",
  "kellyStake": <recommended Kelly fraction 0.0-0.25>
}`;

    const apiKey2 = resolveOpenAIKey();
    let content = '';
    if (apiKey2) {
      try {
        const openai2 = getOpenAIClient();
        const completion2 = await openai2.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        });
        content = completion2.choices?.[0]?.message?.content || '';
      } catch (err: any) {
        console.error('[AI Prediction] OpenAI error:', err.message || err);
      }
    }

    let result: any;
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    }

    if (!result) {
      // Fallback based on real odds math
      const bestOdds = Math.min(homeOdds, awayOdds);
      const isFavHome = homeOdds <= awayOdds;
      return res.json({
        prediction: isFavHome ? 'Home Win' : 'Away Win',
        confidence: parseFloat((impliedHome > impliedAway ? impliedHome : impliedAway).toFixed(2)),
        homeWinProb: parseFloat(impliedHome.toFixed(3)),
        drawProb: parseFloat(impliedDraw.toFixed(3)),
        awayWinProb: parseFloat(impliedAway.toFixed(3)),
        marketEdge: 0.0,
        valueExists: false,
        keyFactors: ['Market implied probability', 'Odds structure', 'Bookmaker margin', 'Statistical baseline'],
        recommendedBet: isFavHome ? `${homeTeam} Win @ ${homeOdds}` : `${awayTeam} Win @ ${awayOdds}`,
        reasoning: `Market odds imply ${trueHome}% home / ${trueDraw}% draw / ${trueAway}% away. Bookmaker margin is ${((overround - 1) * 100).toFixed(1)}%.`,
        riskLevel: 'Medium',
        kellyStake: 0.03,
      });
    }

    res.json(result);
  } catch (error) {
    console.error('AI predict error:', error);
    res.status(500).json({ error: 'Prediction failed' });
  }
});

export default router;
