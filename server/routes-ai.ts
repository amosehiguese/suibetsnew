import { Router, Request, Response } from 'express';

const router = Router();

// AI Betting Suggestion endpoint with provider selection
router.post('/api/ai/betting-suggestion', async (req: Request, res: Response) => {
  try {
    const { eventName, sport, homeTeam, awayTeam, provider = 'openai' } = req.body;

    let content = '';

    // Route to different AI provider based on request
    if (provider === 'anthropic') {
      content = await getAnthropicSuggestion(sport, eventName, homeTeam, awayTeam);
    } else if (provider === 'gemini') {
      content = await getGeminiSuggestion(sport, eventName, homeTeam, awayTeam);
    } else {
      // Default to OpenAI
      content = await getOpenAISuggestion(sport, eventName, homeTeam, awayTeam);
    }

    if (!content) {
      return res.json({ suggestions: [] });
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [] };

    res.json(suggestions);
  } catch (error) {
    console.error('AI suggestion error:', error);
    res.json({ suggestions: [] });
  }
});

// OpenAI - GPT-4o Mini (Fast & Free)
async function getOpenAISuggestion(sport: string, eventName: string, homeTeam: string, awayTeam: string): Promise<string> {
  try {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert sports betting advisor. Analyze sports events and provide betting recommendations with confidence scores and reasoning. Return ONLY valid JSON.`,
          },
          {
            role: 'user',
            content: `Analyze this ${sport} event and provide betting recommendations:
Event: ${eventName}
${homeTeam ? `Home Team: ${homeTeam}` : ''}
${awayTeam ? `Away Team: ${awayTeam}` : ''}

Provide 2-3 betting recommendations in this JSON format:
{
  "suggestions": [
    {
      "market": "Market Name",
      "recommendation": "Specific bet recommendation",
      "confidence": 0.85,
      "reasoning": "Brief explanation"
    }
  ]
}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    const data = await aiResponse.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('OpenAI error:', error);
    return '';
  }
}

// Anthropic - Claude (Better Reasoning)
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
          max_tokens: 500,
          system: `You are an expert sports betting advisor. Analyze sports events and provide betting recommendations with confidence scores and reasoning. Return ONLY valid JSON.`,
          messages: [
            {
              role: 'user',
              content: `Analyze this ${sport} event and provide betting recommendations:
Event: ${eventName}
${homeTeam ? `Home Team: ${homeTeam}` : ''}
${awayTeam ? `Away Team: ${awayTeam}` : ''}

Provide 2-3 betting recommendations in this JSON format:
{
  "suggestions": [
    {
      "market": "Market Name",
      "recommendation": "Specific bet recommendation",
      "confidence": 0.85,
      "reasoning": "Brief explanation"
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

// Gemini - Google (Fast & Powerful)
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
                  text: `You are an expert sports betting advisor. Analyze this ${sport} event and provide betting recommendations with confidence scores and reasoning. Return ONLY valid JSON.

Event: ${eventName}
${homeTeam ? `Home Team: ${homeTeam}` : ''}
${awayTeam ? `Away Team: ${awayTeam}` : ''}

Provide 2-3 betting recommendations in this JSON format:
{
  "suggestions": [
    {
      "market": "Market Name",
      "recommendation": "Specific bet recommendation",
      "confidence": 0.85,
      "reasoning": "Brief explanation"
    }
  ]
}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
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

// ── AI Agent Endpoint ─────────────────────────────────────────────────────────
// Parses user intent and returns the action + params to execute on the frontend
router.post('/api/ai/agent', async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body as { message: string; context?: any };

    const systemPrompt = `You are SuiBets AI Agent — an intelligent sports betting assistant with access to 10 analysis modules.

Available actions you can trigger:
- value_bets: Scan all markets for edges where AI probability > market probability
- monte_carlo: Run Monte Carlo match simulation (returns win probability with confidence intervals)
- arbitrage: Find risk-free betting opportunities across markets
- odds_movement: Detect sharp money, insider signals, unusual market shifts
- live_signals: Analyse live matches for in-play betting opportunities
- predictions: Generate match prediction with stats breakdown for a specific event
- marketplace: Rank today's best bets by composite AI score
- portfolio: Analyse current bet portfolio risk and exposure
- run_all: Run all modules at once (comprehensive scan)
- chat: General betting question / explanation (no specific module needed)

When user says things like:
- "find value bets" / "any edges?" / "good bets today" → value_bets
- "simulate" / "monte carlo" / "run simulation" → monte_carlo
- "arbitrage" / "risk free" / "arb" → arbitrage
- "odds movement" / "sharp money" / "line movement" → odds_movement
- "live" / "in-play" / "live signals" → live_signals
- "predict" / "analyse match" / "who will win" → predictions
- "top picks" / "best bets" / "marketplace" / "rankings" → marketplace
- "portfolio" / "risk" / "exposure" → portfolio
- "run all" / "full scan" / "everything" / "do it all" → run_all
- anything else → chat

Return ONLY valid JSON with no markdown:
{
  "action": "<action_name>",
  "message": "<friendly 1-2 sentence explanation of what you're doing>",
  "params": {
    "sport": "<detected sport if mentioned, else 'football'>",
    "team": "<detected team name if mentioned, else null>",
    "prob": <detected probability if mentioned, else 0.6>,
    "runs": <simulation runs if mentioned, else 50000>
  }
}`;

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    const data = await aiResponse.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ action: 'chat', message: content, params: {} });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (error) {
    console.error('AI agent error:', error);
    res.json({
      action: 'chat',
      message: "I'm ready to help! Try asking me to 'find value bets', 'run all analysis', or 'predict a match'.",
      params: {}
    });
  }
});

// ── AI Agent Predictions endpoint (detailed match analysis) ───────────────────
router.post('/api/ai/agent/predict', async (req: Request, res: Response) => {
  try {
    const { homeTeam, awayTeam, sport, odds } = req.body;

    const prompt = `You are an expert sports analyst. Provide a detailed prediction for this match.

Match: ${homeTeam} vs ${awayTeam}
Sport: ${sport}
Current Odds: Home ${odds?.home || 'N/A'} | Draw ${odds?.draw || 'N/A'} | Away ${odds?.away || 'N/A'}

Return ONLY valid JSON:
{
  "prediction": "Home Win" | "Draw" | "Away Win",
  "confidence": <0.0-1.0>,
  "homeWinProb": <0.0-1.0>,
  "drawProb": <0.0-1.0>,
  "awayWinProb": <0.0-1.0>,
  "keyFactors": ["factor 1", "factor 2", "factor 3"],
  "recommendedBet": "specific bet recommendation",
  "reasoning": "2-3 sentence analysis",
  "riskLevel": "Low" | "Medium" | "High"
}`;

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 400,
      }),
    });

    const data = await aiResponse.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    res.json(result || {
      prediction: 'Home Win', confidence: 0.6,
      homeWinProb: 0.55, drawProb: 0.25, awayWinProb: 0.20,
      keyFactors: ['Home advantage', 'Recent form', 'Head-to-head record'],
      recommendedBet: `${homeTeam} Win`,
      reasoning: 'Based on available data, the home team has a statistical edge.',
      riskLevel: 'Medium'
    });
  } catch (error) {
    console.error('AI predict error:', error);
    res.status(500).json({ error: 'Prediction failed' });
  }
});

export default router;
