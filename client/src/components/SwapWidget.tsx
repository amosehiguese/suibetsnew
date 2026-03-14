import { useState, useEffect, useCallback, useRef } from "react";
import { MetaAg, type MetaQuote, EProvider } from "@7kprotocol/sdk-ts";
import { Transaction } from "@mysten/sui/transactions";
import { useCurrentAccount, useSignTransaction } from "@mysten/dapp-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, RefreshCw, Zap, ExternalLink, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SBETS_TOKEN_ADDR = "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS";
const SUI_TYPE = "0x2::sui::SUI";

const ag = new MetaAg({
  slippageBps: 100,
  providers: {
    [EProvider.BLUEFIN7K]: {},
    [EProvider.CETUS]: {},
    [EProvider.OKX]: {},
  },
});

function getRawAmountOut(q: any): string | null {
  if (q == null) return null;
  const raw =
    q.amountOut ??
    q.coinAmountOut ??
    q.outputAmount ??
    q.amount_out ??
    q.returnAmount ??
    q.outputCoinAmount ??
    q.estimatedAmountOut ??
    q.toAmount ??
    null;
  if (raw != null) return String(raw);
  const inner = q.quote ?? q.data ?? q.result ?? null;
  if (!inner) return null;
  const innerRaw =
    inner.amountOut ??
    inner.coinAmountOut ??
    inner.outputAmount ??
    inner.amount_out ??
    inner.returnAmount ??
    inner.outputCoinAmount ??
    inner.estimatedAmountOut ??
    inner.toAmount ??
    null;
  return innerRaw != null ? String(innerRaw) : null;
}

function getAmountOut(q: MetaQuote): string | null {
  const raw = getRawAmountOut(q as any);
  if (raw == null) return null;
  const num = Number(raw);
  if (isNaN(num) || num === 0) return null;
  return (num / 1e9).toFixed(4);
}

function getProviderLabel(provider: string): string {
  const map: Record<string, string> = {
    BLUEFIN7K: "Bluefin 7k",
    CETUS: "Cetus",
    FLOWX: "FlowX",
    OKX: "OKX",
  };
  return map[provider] ?? provider;
}

export function SwapWidget() {
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;
  const { mutateAsync: signTx } = useSignTransaction();
  const { toast } = useToast();

  const [suiAmount, setSuiAmount] = useState("1");
  const [sbetsOut, setSbetsOut] = useState("");
  const [quote, setQuote] = useState<MetaQuote | null>(null);
  const [quotes, setQuotes] = useState<MetaQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [txDigest, setTxDigest] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchQuote = useCallback(async (amount: string) => {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setSbetsOut("");
      setQuote(null);
      setQuotes([]);
      setQuoteError("");
      return;
    }

    setLoading(true);
    setQuoteError("");
    setSbetsOut("");

    try {
      const amountIn = BigInt(Math.floor(num * 1_000_000_000)).toString();
      const signer = walletAddress ?? "0x0000000000000000000000000000000000000000000000000000000000000001";

      const results = await ag.quote({
        coinTypeIn: SUI_TYPE,
        coinTypeOut: SBETS_TOKEN_ADDR,
        amountIn,
        signer,
        timeout: 8000,
      });

      if (!results || results.length === 0) {
        setQuoteError("No route found. The SBETS pool may have low liquidity.");
        return;
      }

      setQuotes(results);
      const best = results[0];
      setQuote(best);

      const out = getAmountOut(best);
      if (out) setSbetsOut(out);
      else {
        const fallback = results.find(r => getAmountOut(r) !== null);
        if (fallback) {
          setQuote(fallback);
          setSbetsOut(getAmountOut(fallback)!);
        } else {
          setQuoteError("Could not read output amount. Try again.");
        }
      }
    } catch (err: any) {
      console.error("Quote error:", err);
      setQuoteError("Failed to fetch quote — check your connection.");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(suiAmount), 700);
    return () => clearTimeout(debounceRef.current);
  }, [suiAmount, fetchQuote]);

  const handleSwap = async () => {
    if (!walletAddress || !quote) return;
    setSwapping(true);
    setTxDigest("");

    try {
      const digest = await ag.fastSwap({
        quote,
        signer: walletAddress,
        signTransaction: async (txBytes: string) => {
          const tx = Transaction.from(txBytes);
          const result = await signTx({ transaction: tx });
          return result;
        },
      });

      setTxDigest(digest);
      toast({
        title: "Swap Successful!",
        description: `SUI → SBETS confirmed on-chain`,
      });
      setSuiAmount("1");
      setSbetsOut("");
      setQuote(null);
      setQuotes([]);
    } catch (err: any) {
      console.error("Swap error:", err);
      toast({
        title: "Swap Failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setSwapping(false);
    }
  };

  const canSwap = !!walletAddress && !!quote && !swapping && !loading && !!sbetsOut;

  return (
    <div className="bg-[#0e1e24] border border-white/5 rounded-xl p-6 flex flex-col" data-testid="card-swap-widget">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#00d0ff]/10 flex items-center justify-center">
            <Zap className="h-3.5 w-3.5 text-[#00d0ff]" />
          </div>
          <span className="font-bold text-white">Quick Swap</span>
          <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full font-semibold">
            IN-APP
          </span>
        </div>
        <button
          onClick={() => fetchQuote(suiAmount)}
          disabled={loading}
          className="text-gray-500 hover:text-white transition-colors p-1"
          title="Refresh quote"
          data-testid="button-refresh-quote"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-[#00d0ff]" : ""}`} />
        </button>
      </div>

      {/* From: SUI */}
      <div className="bg-[#060f14] border border-white/5 rounded-xl p-4 mb-2">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>You pay</span>
          <span>SUI</span>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={suiAmount}
            onChange={(e) => setSuiAmount(e.target.value)}
            className="bg-transparent border-none text-2xl font-bold text-white p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 min-w-0"
            placeholder="0.0"
            min="0"
            step="0.1"
            data-testid="input-sui-amount"
          />
          <div className="flex items-center gap-2 bg-[#0e1e24] border border-white/5 rounded-lg px-3 py-2 shrink-0">
            <div className="w-5 h-5 rounded-full bg-[#6fbcf0] flex items-center justify-center">
              <span className="text-[10px] font-black text-black">S</span>
            </div>
            <span className="text-sm font-bold text-white">SUI</span>
          </div>
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center my-1">
        <div className="w-7 h-7 rounded-lg bg-[#060f14] border border-white/5 flex items-center justify-center">
          <ArrowDown className="h-4 w-4 text-gray-500" />
        </div>
      </div>

      {/* To: SBETS */}
      <div className="bg-[#060f14] border border-white/5 rounded-xl p-4 mb-4">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-gray-500">You receive</span>
          {quote && !loading && (
            <span className="text-[#00d0ff] font-medium">
              via {getProviderLabel((quote as any).provider)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="h-8 w-28 bg-white/5 rounded-lg animate-pulse" />
            ) : (
              <span className={`text-2xl font-bold ${sbetsOut ? "text-white" : "text-gray-600"}`}>
                {sbetsOut || "0.0"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 bg-[#0e1e24] border border-white/5 rounded-lg px-3 py-2 shrink-0">
            <div className="w-5 h-5 rounded-full bg-[#00d0ff]/20 border border-[#00d0ff]/30 flex items-center justify-center">
              <span className="text-[10px] font-black text-[#00d0ff]">S</span>
            </div>
            <span className="text-sm font-bold text-white">SBETS</span>
          </div>
        </div>
      </div>

      {/* Multiple routes */}
      {quotes.length > 1 && !loading && (
        <div className="flex gap-1 mb-4 flex-wrap">
          {quotes.map((q, i) => {
            const out = getAmountOut(q);
            const label = getProviderLabel((q as any).provider);
            const isSelected = q === quote;
            return (
              <button
                key={i}
                onClick={() => {
                  setQuote(q);
                  if (out) setSbetsOut(out);
                }}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  isSelected
                    ? "bg-[#00d0ff]/10 border-[#00d0ff]/30 text-[#00d0ff]"
                    : "bg-white/[0.03] border-white/5 text-gray-400 hover:text-white"
                }`}
              >
                {label} {out ? `→ ${out}` : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* Error */}
      {quoteError && (
        <p className="text-xs text-red-400 mb-3 text-center">{quoteError}</p>
      )}

      {/* Success */}
      {txDigest && (
        <a
          href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-green-400 mb-3 hover:text-green-300 transition-colors"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Swap confirmed — View on Suiscan
          <ExternalLink className="h-3 w-3 opacity-70" />
        </a>
      )}

      {/* Swap Button */}
      {!walletAddress ? (
        <div className="text-center py-2">
          <p className="text-sm text-gray-400">Connect your Sui wallet to swap</p>
        </div>
      ) : (
        <Button
          className="w-full bg-[#0066cc] hover:bg-[#0055bb] text-white font-bold gap-2 h-11"
          onClick={handleSwap}
          disabled={!canSwap}
          data-testid="button-execute-swap"
        >
          {swapping ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Swapping on Sui...
            </>
          ) : !sbetsOut && !loading ? (
            "Enter amount"
          ) : loading ? (
            "Fetching best rate..."
          ) : (
            `Swap ${suiAmount} SUI → ${sbetsOut} SBETS`
          )}
        </Button>
      )}

      <p className="text-[11px] text-gray-600 text-center mt-3">
        Best rate via 7k aggregator · 1% slippage · Sui Mainnet · No fees
      </p>
    </div>
  );
}
