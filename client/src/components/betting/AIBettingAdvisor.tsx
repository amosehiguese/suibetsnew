import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Loader } from 'lucide-react';

interface AISuggestion {
  market: string;
  recommendation: string;
  confidence: number;
  reasoning: string;
}

interface AIBettingAdvisorProps {
  eventName: string;
  sport: string;
  teams?: { home: string; away: string };
}

type AIProvider = 'openai' | 'groq' | 'gemini' | 'deepseek' | 'anthropic';

export function AIBettingAdvisor({ eventName, sport, teams }: AIBettingAdvisorProps) {
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('openai');

  const { mutate: getAISuggestion, isPending } = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/ai/betting-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName,
          sport,
          homeTeam: teams?.home,
          awayTeam: teams?.away,
          provider: selectedProvider,
        }),
      });
      if (!response.ok) throw new Error('Failed to get AI suggestion');
      return response.json();
    },
    onSuccess: (data) => setSuggestions(data.suggestions || []),
  });

  return (
    <div className="bg-gradient-to-br from-blue-950/40 to-slate-900/60 rounded-2xl border-2 border-blue-500/40 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="flex items-center gap-2 text-lg font-bold text-blue-300">
          <Sparkles className="w-5 h-5 text-blue-400" />
          AI Advisor
        </h3>
        <button
          onClick={() => getAISuggestion()}
          disabled={isPending}
          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold rounded-lg text-sm transition-all hover:scale-105 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
        >
          {isPending ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Analyze
            </>
          )}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-3">
          {suggestions.map((sug, idx) => (
            <div
              key={idx}
              className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 hover:bg-blue-500/15 transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="font-bold text-blue-300">{sug.market}</span>
                <span className="text-xs bg-blue-600/50 text-blue-100 px-2 py-1 rounded">
                  {Math.round(sug.confidence * 100)}% confidence
                </span>
              </div>
              <p className="text-cyan-200 font-semibold text-sm mb-1">{sug.recommendation}</p>
              <p className="text-xs text-gray-400">{sug.reasoning}</p>
            </div>
          ))}
        </div>
      )}

      {suggestions.length === 0 && !isPending && (
        <p className="text-gray-400 text-sm text-center py-4">Click "Get Advice" to receive AI-powered betting recommendations</p>
      )}
    </div>
  );
}
