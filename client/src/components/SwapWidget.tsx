import { useState, useEffect, useCallback, useRef } from "react";
import { MetaAg, type MetaQuote, EProvider } from "@7kprotocol/sdk-ts";
import {
  buildTx as bluefinBuildTx,
  getQuote as bluefinGetQuote,
  Config as BluefinConfig,
} from "@bluefin-exchange/bluefin7k-aggregator-sdk";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import {
  useCurrentAccount,
  useSignTransaction,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, RefreshCw, Zap, ExternalLink, CheckCircle2, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SBETS_TOKEN_ADDR =
  "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS";
const SUI_TYPE = "0x2::sui::SUI";
const BLUEFIN_PARTNER =
  "0x17c0b1f7a6ad73f51268f16b8c06c049eecc2f28a270cdd29c06e3d2dea23302";
const MANUAL_GAS_BUDGET = 500_000_000;

const suiMainnetClient = new SuiClient({ url: getFullnodeUrl("mainnet") });
BluefinConfig.setSuiClient(suiMainnetClient);

const ag = new MetaAg({
  slippageBps: 100,
  providers: {
    [EProvider.BLUEFIN7K]: {},
    [EProvider.CETUS]: {},
  },
});

function getRawAmountOut(q: any): string | null {
  if (q == null) return null;
  const raw =
    q.amountOut ??
    q.coinAmountOut ??
    q.outputAmount ??
    q.amount_out ??
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
    inner.outputCoinAmount ??
    inner.estimatedAmountOut ??
    inner.toAmount ??
    null;
  return innerRaw != null ? String(innerRaw) : null;
}

function getAmountOut(q: any): string | null {
  const raw = getRawAmountOut(q);
  if (raw == null) return null;
  const num = Number(raw);
  if (isNaN(num) || num === 0) return null;
  return (num / 1e9).toFixed(4);
}

function getBluefinAggQuoteAmountOut(q: any): string | null {
  const raw =
    q?.returnAmountAfterCommissionWithDecimal ||
    q?.returnAmountWithDecimal ||
    null;
  if (!raw) return null;
  const num = Number(raw);
  if (isNaN(num) || num === 0) return null;
  return (num / 1e9).toFixed(4);
}

function getProviderLabel(provider: string): string {
  const map: Record<string, string> = {
    bluefin7k: "Bluefin",
    BLUEFIN7K: "Bluefin",
    cetus: "Cetus",
    CETUS: "Cetus",
    turbos: "Turbos",
    TURBOS: "Turbos",
    flowx: "FlowX",
    FLOWX: "FlowX",
    okx: "OKX",
    OKX: "OKX",
  };
  return map[provider] ?? provider;
}

function isBluefinProvider(provider: string): boolean {
  return (
    provider === "bluefin7k" ||
    provider === "BLUEFIN7K" ||
    provider === "turbos" ||
    provider === "TURBOS"
  );
}

interface TurbosRoute {
  rawQuote: any;
  amountOut: string;
}

export function SwapWidget() {
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;
  const { mutateAsync: signTx } = useSignTransaction();
  const { mutateAsync: signAndExecuteTx } = useSignAndExecuteTransaction();
  const { toast } = useToast();

  const [suiAmount, setSuiAmount] = useState("1");
  const [sbetsOut, setSbetsOut] = useState("");
  const [quote, setQuote] = useState<MetaQuote | null>(null);
  const [quotes, setQuotes] = useState<MetaQuote[]>([]);
  const [turbosRoute, setTurbosRoute] = useState<TurbosRoute | null>(null);
  const [turbosSelected, setTurbosSelected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [txDigest, setTxDigest] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchQuote = useCallback(
    async (amount: string) => {
      const num = parseFloat(amount);
      if (!amount || isNaN(num) || num <= 0) {
        setSbetsOut("");
        setQuote(null);
        setQuotes([]);
        setTurbosRoute(null);
        setTurbosSelected(false);
        setQuoteError("");
        return;
      }

      setLoading(true);
      setQuoteError("");
      setSbetsOut("");
      setTurbosRoute(null);
      setTurbosSelected(false);

      const amountIn = BigInt(Math.floor(num * 1_000_000_000)).toString();
      const signer =
        walletAddress ??
        "0x0000000000000000000000000000000000000000000000000000000000000001";

      try {
        const [agResults, turbosResult] = await Promise.allSettled([
          ag.quote({
            coinTypeIn: SUI_TYPE,
            coinTypeOut: SBETS_TOKEN_ADDR,
            amountIn,
            signer,
            timeout: 8000,
          }),
          bluefinGetQuote({
            tokenIn: SUI_TYPE,
            tokenOut: SBETS_TOKEN_ADDR,
            amountIn,
            sources: ["turbos"],
            commissionBps: 0,
          }).catch(() => null),
        ]);

        if (turbosResult.status === "fulfilled" && turbosResult.value) {
          const tq = turbosResult.value as any;
          const out = getBluefinAggQuoteAmountOut(tq);
          if (out) {
            setTurbosRoute({ rawQuote: tq, amountOut: out });
          }
        }

        if (agResults.status === "rejected") {
          setQuoteError("Failed to fetch quote — check your connection.");
          return;
        }

        const results = agResults.value;
        if (!results || results.length === 0) {
          setQuoteError("No route found. The SBETS pool may have low liquidity.");
          return;
        }

        setQuotes(results);
        const best = results[0];
        setQuote(best);

        const out = getAmountOut(best as any);
        if (out) setSbetsOut(out);
        else {
          const fallback = results.find((r) => getAmountOut(r as any) !== null);
          if (fallback) {
            setQuote(fallback);
            setSbetsOut(getAmountOut(fallback as any)!);
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
    },
    [walletAddress]
  );

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(suiAmount), 700);
    return () => clearTimeout(debounceRef.current);
  }, [suiAmount, fetchQuote]);

  const handleSwap = async () => {
    if (!walletAddress) return;
    if (!turbosSelected && !quote) return;
    setSwapping(true);
    setTxDigest("");

    try {
      let digest = "";

      if (turbosSelected && turbosRoute) {
        const { tx } = await bluefinBuildTx({
          quoteResponse: turbosRoute.rawQuote,
          accountAddress: walletAddress,
          commission: { commissionBps: 0, partner: BLUEFIN_PARTNER },
          slippage: 0.01,
        });
        tx.setGasBudget(MANUAL_GAS_BUDGET);
        const result = await signAndExecuteTx({ transaction: tx });
        digest = result.digest;
      } else if (quote) {
        const provider: string = (quote as any).provider ?? "";

        if (isBluefinProvider(provider)) {
          const rawQuote = (quote as any).quote ?? quote;
          const { tx } = await bluefinBuildTx({
            quoteResponse: rawQuote,
            accountAddress: walletAddress,
            commission: { commissionBps: 0, partner: BLUEFIN_PARTNER },
            slippage: 0.01,
          });
          tx.setGasBudget(MANUAL_GAS_BUDGET);
          const result = await signAndExecuteTx({ transaction: tx });
          digest = result.digest;
        } else {
          digest = await ag.fastSwap({
            quote,
            signer: walletAddress,
            useGasCoin: false,
            signTransaction: async (txBytes: string) => {
              const tx = Transaction.from(txBytes);
              const result = await signTx({ transaction: tx });
              return result;
            },
          });
        }
      }

      setTxDigest(digest);
      toast({
        title: "Swap Successful!",
        description: `SUI → SBETS swap confirmed on Mainnet`,
      });
      setSuiAmount("1");
      setSbetsOut("");
      setQuote(null);
      setQuotes([]);
      setTurbosRoute(null);
      setTurbosSelected(false);
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

  const canSwap =
    !!walletAddress &&
    (turbosSelected ? !!turbosRoute : !!quote) &&
    !swapping &&
    !loading &&
    !!sbetsOut;

  const selectedProvider = turbosSelected
    ? "Turbos"
    : quote
    ? getProviderLabel((quote as any).provider)
    : "";

  const displaySbetsOut = turbosSelected
    ? turbosRoute?.amountOut ?? ""
    : sbetsOut;

  return (
    <div
      className="bg-[#0e1e24] border border-white/5 rounded-xl p-6 flex flex-col"
      data-testid="card-swap-widget"
    >
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInfo((v) => !v)}
            className="text-gray-500 hover:text-[#00d0ff] transition-colors p-1"
            title="How does this work?"
            data-testid="button-swap-info"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => fetchQuote(suiAmount)}
            disabled={loading}
            className="text-gray-500 hover:text-white transition-colors p-1"
            title="Refresh quote"
            data-testid="button-refresh-quote"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin text-[#00d0ff]" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* Info Panel */}
      {showInfo && (
        <div className="bg-[#060f14] border border-[#00d0ff]/20 rounded-xl p-4 mb-4 text-xs text-gray-400 space-y-2">
          <p className="text-[#00d0ff] font-semibold text-sm mb-1">
            How this swap works
          </p>
          <p>
            This widget routes your swap{" "}
            <span className="text-white font-medium">
              directly through on-chain liquidity pools on Sui Mainnet
            </span>{" "}
            — Bluefin holds the deepest SBETS pool, Cetus and Turbos provide
            additional liquidity. The aggregator checks all routes in real time
            and selects the best rate.
          </p>
          <p>
            <span className="text-white font-medium">
              No middleman, no custodian
            </span>{" "}
            — you sign and the smart contract executes the swap atomically. Your
            wallet receives SBETS directly.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
            <span className="text-green-400 font-medium">
              Live on Sui Mainnet
            </span>
          </div>
        </div>
      )}

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
          {(quote || turbosSelected) && !loading && (
            <span className="text-[#00d0ff] font-medium">
              via {selectedProvider} Mainnet
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="h-8 w-28 bg-white/5 rounded-lg animate-pulse" />
            ) : (
              <span
                className={`text-2xl font-bold ${
                  displaySbetsOut ? "text-white" : "text-gray-600"
                }`}
              >
                {displaySbetsOut || "0.0"}
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

      {/* Routes */}
      {!loading && (
        <div className="mb-4">
          {(quotes.length > 0 || turbosRoute) && (
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5 font-semibold">
              In-app routes
            </p>
          )}
          <div className="flex gap-1 flex-wrap">
            {quotes.map((q, i) => {
              const out = getAmountOut(q as any);
              const label = getProviderLabel((q as any).provider);
              const isSelected = !turbosSelected && q === quote;
              return (
                <button
                  key={i}
                  onClick={() => {
                    setQuote(q);
                    setTurbosSelected(false);
                    if (out) setSbetsOut(out);
                  }}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    isSelected
                      ? "bg-[#00d0ff]/10 border-[#00d0ff]/30 text-[#00d0ff]"
                      : "bg-white/[0.03] border-white/5 text-gray-400 hover:text-white"
                  }`}
                  data-testid={`button-route-${label.toLowerCase()}`}
                >
                  {label} {out ? `→ ${out}` : ""}
                </button>
              );
            })}

            {/* Turbos in-app route */}
            {turbosRoute && (
              <button
                onClick={() => {
                  setTurbosSelected(true);
                  setSbetsOut(turbosRoute.amountOut);
                }}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  turbosSelected
                    ? "bg-[#00d0ff]/10 border-[#00d0ff]/30 text-[#00d0ff]"
                    : "bg-white/[0.03] border-white/5 text-gray-400 hover:text-white"
                }`}
                data-testid="button-route-turbos"
              >
                Turbos → {turbosRoute.amountOut}
              </button>
            )}
          </div>
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
              Swapping on {selectedProvider} Mainnet...
            </>
          ) : !displaySbetsOut && !loading ? (
            "Enter amount"
          ) : loading ? (
            "Fetching best rate..."
          ) : (
            `Swap ${suiAmount} SUI → ${displaySbetsOut} SBETS`
          )}
        </Button>
      )}

      <p className="text-[11px] text-gray-600 text-center mt-3">
        Powered by Bluefin · Cetus · Turbos · 7k aggregator · 1% slippage · No
        platform fees
      </p>
    </div>
  );
}
