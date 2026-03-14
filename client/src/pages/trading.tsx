import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount } from "@mysten/dapp-kit";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SwapWidget } from "@/components/SwapWidget";
import {
  ArrowUpDown, TrendingUp, Zap, Globe, ExternalLink,
  Wallet, Clock, ArrowDownLeft, ArrowUpRight, RefreshCw,
  ChevronLeft, ChevronRight, AlertCircle, BarChart2,
  Droplets, Coins, PieChart, ArrowRight, Layers, ShieldCheck,
  Users, Lock, ChevronDown, ChevronUp, BookOpen, Activity as ActivityIcon,
  CheckCircle2, Copy, TrendingDown,
} from "lucide-react";

/* ── Data hooks ─────────────────────────────────────────────────────────── */

interface PriceData {
  BTC: { price: number; change24h: number };
  ETH: { price: number; change24h: number };
  SUI: { price: number; change24h: number };
  updatedAt: number;
}

interface PoolStats {
  poolId: string;
  price: number;
  liquidity: string;
  feeRatePct: number;
  tickSpacing: number | null;
  currentTick: number | null;
  updatedAt: number;
}

function useLivePrices() {
  return useQuery<PriceData>({
    queryKey: ["/api/prices"],
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
}

function usePoolStats() {
  return useQuery<PoolStats>({
    queryKey: ["/api/bluefin/pool-stats"],
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}

/* ── SBETS Live Price Ticker ─────────────────────────────────────────────── */

function LivePricesBar() {
  const { data: prices, isLoading: pricesLoading, isFetching: pricesFetching, refetch: refetchPrices } = useLivePrices();
  const { data: pool, isLoading: poolLoading, isFetching: poolFetching, refetch: refetchPool } = usePoolStats();

  const isLoading = pricesLoading || poolLoading;
  const isFetching = pricesFetching || poolFetching;

  // SBETS price in USD = (SUI price) / (SBETS per SUI rate from pool)
  const suiUsd = prices?.SUI?.price ?? 0;
  const sbetsPerSui = pool?.price ?? 0;
  const sbetsUsd = sbetsPerSui > 0 && suiUsd > 0 ? suiUsd / sbetsPerSui : 0;
  // SUI 24h change serves as a directional proxy for SBETS
  const suiChange = prices?.SUI?.change24h ?? 0;

  const handleRefresh = () => { refetchPrices(); refetchPool(); };

  return (
    <div className="bg-[#0a1a22] border border-[#00d0ff]/20 rounded-xl px-5 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" data-testid="section-live-prices">
      <div className="flex items-center gap-2 shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">SBETS Live Price</span>
        <Badge className="bg-[#00d0ff]/10 text-[#00d0ff] border-[#00d0ff]/30 text-[10px]">Bluefin Pool</Badge>
      </div>

      {isLoading ? (
        <div className="h-8 w-48 rounded-lg bg-white/5 animate-pulse" />
      ) : sbetsUsd > 0 ? (
        <div className="flex items-center gap-4" data-testid="price-chip-sbets">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#00d0ff]/20 border border-[#00d0ff]/30 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-black text-[#00d0ff]">S</span>
            </div>
            <span className="text-sm font-bold text-white">SBETS</span>
          </div>
          <span className="text-lg font-bold font-mono text-[#00d0ff]">
            ${sbetsUsd.toFixed(6)}
          </span>
          <span className={`flex items-center gap-0.5 text-xs font-semibold ${suiChange >= 0 ? "text-green-400" : "text-red-400"}`}>
            {suiChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {suiChange >= 0 ? "+" : ""}{suiChange.toFixed(2)}% (SUI 24h)
          </span>
          {suiUsd > 0 && (
            <span className="text-[10px] text-gray-500 hidden sm:block">
              SUI: ${suiUsd.toFixed(3)}
            </span>
          )}
        </div>
      ) : (
        <span className="text-xs text-gray-500">Fetching SBETS price…</span>
      )}

      <button onClick={handleRefresh} className="text-gray-500 hover:text-white transition-colors shrink-0" data-testid="button-refresh-prices">
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-[#00d0ff]" : ""}`} />
      </button>
    </div>
  );
}

/* ── Live Pool Stats Card ───────────────────────────────────────────────── */

function PoolStatsCard() {
  const { data, isLoading, refetch, isFetching } = usePoolStats();
  const { data: prices } = useLivePrices();

  const sbetsPerSui = data?.price ?? 0;
  const suiUsd = prices?.SUI?.price ?? 0;
  const sbetsUsd = sbetsPerSui > 0 && suiUsd > 0 ? suiUsd / sbetsPerSui : 0;

  return (
    <div className="bg-[#061218] border border-[#0066cc]/30 rounded-xl px-5 py-4" data-testid="section-pool-stats">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 text-xs font-semibold uppercase tracking-wide">Live Pool</span>
          <Badge className="bg-[#0066cc]/15 text-[#60a5fa] border-[#0066cc]/30 text-[10px] font-medium">Bluefin Spot CLMM</Badge>
        </div>
        <button onClick={() => refetch()} className="text-gray-500 hover:text-white transition-colors" data-testid="button-refresh-pool-stats">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-[#00d0ff]" : ""}`} />
        </button>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-black/20 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 mb-1">SBETS/SUI Rate</p>
            <p className="text-sm font-bold text-white font-mono" data-testid="stat-sbets-rate">
              {sbetsPerSui > 0 ? sbetsPerSui.toFixed(2) : "—"}
            </p>
          </div>
          <div className="bg-black/20 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 mb-1">SBETS Price</p>
            <p className="text-sm font-bold text-[#00d0ff] font-mono" data-testid="stat-sbets-usd">
              {sbetsUsd > 0 ? `$${sbetsUsd.toFixed(6)}` : "—"}
            </p>
          </div>
          <div className="bg-black/20 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 mb-1">Fee Rate</p>
            <p className="text-sm font-bold text-green-400 font-mono" data-testid="stat-fee-rate">
              {data?.feeRatePct != null ? `${(data.feeRatePct * 100).toFixed(2)}%` : "—"}
            </p>
          </div>
          <div className="bg-black/20 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 mb-1">Pool ID</p>
            <p className="text-[10px] text-[#60a5fa] font-mono truncate" data-testid="stat-pool-id">
              {BLUEFIN_SPOT_POOL_ID.slice(0,10)}…
            </p>
          </div>
        </div>
      )}
      <a href={BLUEFIN_POOL_URL} target="_blank" rel="noopener noreferrer"
        className="text-[#0066cc] hover:text-[#60a5fa] text-xs flex items-center gap-1 mt-3 transition-colors" data-testid="link-bluefin-pool">
        View pool on Bluefin <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

/* ── LP Rewards Section ─────────────────────────────────────────────────── */

function LPSection() {
  const { data: pool } = usePoolStats();
  const { data: prices } = useLivePrices();

  const feeRatePct = pool?.feeRatePct ?? 0;
  const suiPrice = prices?.SUI?.price ?? 0;

  return (
    <div className="bg-[#0e1e24] border border-white/5 rounded-xl overflow-hidden" data-testid="section-lp-rewards">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-white/5">
        <Droplets className="h-4 w-4 text-[#00d0ff]" />
        <span className="font-semibold text-white text-sm">LP Rewards — Bluefin SBETS/SUI Pool</span>
        <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px] ml-auto">Earn Fees</Badge>
      </div>

      <div className="p-6 space-y-5">
        {/* Explainer */}
        <p className="text-sm text-gray-400 leading-relaxed">
          Provide liquidity to the <span className="text-white font-medium">SBETS/SUI CLMM pool</span> on Bluefin and earn
          trading fees every time someone swaps. As a liquidity provider you set a price range — fees only accrue when the
          market price is inside your range, so tighter ranges earn more but require more active management.
        </p>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-[#060f14] border border-white/5 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">Pool Fee Tier</p>
            <p className="text-xl font-bold text-[#00d0ff]">
              {feeRatePct > 0 ? `${(feeRatePct * 100).toFixed(2)}%` : "—"}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">per swap routed through your range</p>
          </div>
          <div className="bg-[#060f14] border border-white/5 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">SUI Price (live)</p>
            <p className="text-xl font-bold text-white font-mono">
              {suiPrice > 0 ? `$${suiPrice.toFixed(3)}` : "—"}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">use to calculate range in USD terms</p>
          </div>
          <div className="bg-[#060f14] border border-white/5 rounded-xl p-4">
            <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">Add Liquidity</p>
            <Button size="sm" className="w-full bg-[#0066cc] hover:bg-[#0055bb] text-white gap-1.5 text-xs mt-1 h-8"
              onClick={() => window.open(BLUEFIN_POOL_URL, "_blank")} data-testid="button-lp-add-liquidity">
              <Droplets className="h-3.5 w-3.5" /> Add on Bluefin <ExternalLink className="h-3 w-3 opacity-70" />
            </Button>
          </div>
        </div>

        {/* How CLMM LP works */}
        <div className="border border-white/5 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white">How CLMM Liquidity Works</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-400">
            {[
              { icon: <Layers className="h-3.5 w-3.5 text-[#00d0ff]" />, label: "Concentrated", desc: "Set a price range — your capital works only within it, maximising capital efficiency vs. full-range AMMs." },
              { icon: <Coins className="h-3.5 w-3.5 text-yellow-400" />, label: "Fee Accrual", desc: "Every swap inside your range pays you a fee. High volume × tight range = high APR." },
              { icon: <ShieldCheck className="h-3.5 w-3.5 text-green-400" />, label: "Non-Custodial", desc: "Your LP tokens are Sui objects. You can withdraw at any time — no lock-ups." },
              { icon: <TrendingUp className="h-3.5 w-3.5 text-purple-400" />, label: "IL Risk", desc: "Concentrated LPs face higher impermanent loss if the price moves outside your range. Choose your range wisely." },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">{item.icon}</span>
                <span><span className="text-white font-medium">{item.label}: </span>{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Perps Markets Section ──────────────────────────────────────────────── */

interface PerpsMarket {
  symbol: string;
  price: number;
  change24h: number;
  source: "coingecko" | "bluefin";
}

function PerpsMarketsSection() {
  const { data: prices, isLoading } = useLivePrices();

  const markets: PerpsMarket[] = prices
    ? [
        { symbol: "BTC-PERP", price: prices.BTC?.price ?? 0, change24h: prices.BTC?.change24h ?? 0, source: "coingecko" },
        { symbol: "ETH-PERP", price: prices.ETH?.price ?? 0, change24h: prices.ETH?.change24h ?? 0, source: "coingecko" },
        { symbol: "SUI-PERP", price: prices.SUI?.price ?? 0, change24h: prices.SUI?.change24h ?? 0, source: "coingecko" },
      ]
    : [];

  return (
    <div className="bg-[#0e1e24] border border-white/5 rounded-xl overflow-hidden" data-testid="section-perps-markets">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-[#00d0ff]" />
          <span className="font-semibold text-white text-sm">Perps Markets</span>
          <Badge className="bg-[#00d0ff]/10 text-[#00d0ff] border-[#00d0ff]/30 text-[10px]">Live</Badge>
        </div>
        <Button variant="outline" size="sm" className="border-white/10 bg-transparent hover:bg-white/5 text-white gap-1.5 text-xs h-7"
          onClick={() => window.open(BLUEFIN_TERMINAL, "_blank")} data-testid="button-open-perps-terminal">
          Trade on Bluefin <ExternalLink className="h-3 w-3 opacity-70" />
        </Button>
      </div>

      {isLoading ? (
        <div className="p-6 space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02]">
              <tr className="text-gray-500 text-xs border-b border-white/5">
                <th className="text-left px-6 py-3 font-medium">Market</th>
                <th className="text-right px-6 py-3 font-medium">Mark Price</th>
                <th className="text-right px-6 py-3 font-medium">24h Change</th>
                <th className="text-right px-6 py-3 font-medium">Trade</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m, i) => {
                const pos = m.change24h >= 0;
                return (
                  <tr key={m.symbol} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors" data-testid={`row-perp-${i}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#00d0ff]/10 border border-[#00d0ff]/20 flex items-center justify-center">
                          <span className="text-[10px] font-black text-[#00d0ff]">{m.symbol.slice(0,1)}</span>
                        </div>
                        <span className="text-white font-medium text-xs">{m.symbol}</span>
                        <Badge className="bg-[#0066cc]/15 text-[#60a5fa] border-[#0066cc]/20 text-[9px]">up to 20×</Badge>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-xs text-white">
                      ${m.price >= 1000 ? m.price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : m.price.toFixed(4)}
                    </td>
                    <td className={`px-6 py-4 text-right font-mono text-xs font-semibold ${pos ? "text-green-400" : "text-red-400"}`}>
                      <span className="flex items-center justify-end gap-1">
                        {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {pos ? "+" : ""}{m.change24h.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button size="sm" variant="outline"
                        className="border-white/10 bg-transparent hover:bg-white/5 text-white h-7 px-3 text-xs gap-1"
                        onClick={() => window.open(`${BLUEFIN_TERMINAL}trade/${m.symbol}`, "_blank")}
                        data-testid={`button-trade-${m.symbol.toLowerCase()}`}>
                        Trade <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-6 py-3 border-t border-white/5 bg-white/[0.01]">
        <p className="text-[10px] text-gray-500">
          Mark prices sourced from CoinGecko · Refresh every 60 s · Trade on Bluefin perps with up to 20× leverage · Non-custodial, on-chain settlement
        </p>
      </div>
    </div>
  );
}

// ─── Bluefin MAINNET — confirmed from official Bluefin v2 SDK ─────────────
const BLUEFIN_API      = "https://dapi.api.sui-prod.bluefin.io";
const BLUEFIN_TERMINAL = "https://trade.bluefin.io/";
// SUI → SBETS swap URLs — both pools are live on Sui Mainnet
const SBETS_TOKEN_ADDR = "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS";
const BLUEFIN_SPOT_POOL_ID = "0xbcda57bac902ed2207da46c11f6b8388fd2d36c45ffb9851228d607813b7ab4b";
const BLUEFIN_SWAP     = `https://trade.bluefin.io/swap?fromToken=0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI&toToken=${SBETS_TOKEN_ADDR}`;
const BLUEFIN_POOL_URL = `https://trade.bluefin.io/liquidity-pools?pool=${BLUEFIN_SPOT_POOL_ID}`;
const TURBOS_SWAP_URL  = `https://app.turbos.finance/#/trade?input=0x2::sui::SUI&output=${SBETS_TOKEN_ADDR}`;
// ─────────────────────────────────────────────────────────────────────────

interface BluefinTransaction { id: string; symbol: string; type: string; amount: string; asset: string; status: string; txHash: string; createdAt: number; }
interface BluefinUserTrade { id: string; symbol: string; orderId: string; side: string; price: string; quantity: string; fee: string; feeCurrency: string; realizedPnl: string; isMaker: boolean; createdAt: number; }
interface BluefinFundingPayment { id: string; symbol: string; positionSide: string; fundingRate: string; payment: string; status: string; createdAt: number; }

const fmt = (ts: number) => ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtNum = (v: string, dp = 4) => { const n = parseFloat(v); return isNaN(n) ? (v || "—") : n.toFixed(dp); };
const pnlColor = (v: string) => { const n = parseFloat(v); return (isNaN(n) || n === 0) ? "text-gray-400" : n > 0 ? "text-green-400" : "text-red-400"; };

function SideChip({ side }: { side: string }) {
  const s = (side || "").toUpperCase();
  return s === "BUY"
    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">BUY</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">SELL</span>;
}
function StatusChip({ s }: { s: string }) {
  const v = (s || "").toUpperCase();
  const cls = v === "COMPLETED" || v === "SUCCESS" ? "bg-green-500/20 text-green-400 border-green-500/30"
    : v === "PENDING" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : v === "FAILED" || v === "REJECTED" ? "bg-red-500/20 text-red-400 border-red-500/30"
    : "bg-gray-500/20 text-gray-400 border-gray-500/30";
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${cls}`}>{s || "—"}</span>;
}
function TxLink({ hash }: { hash: string }) {
  if (!hash) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <a href={`https://suiscan.xyz/mainnet/tx/${hash}`} target="_blank" rel="noreferrer"
      className="text-[#00d0ff] hover:underline font-mono text-xs flex items-center gap-1">
      {hash.slice(0, 8)}…{hash.slice(-6)}<ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  );
}
function TxTypeIcon({ type }: { type: string }) {
  const t = (type || "").toUpperCase();
  if (t.includes("DEPOSIT") || t.includes("CREDIT")) return <ArrowDownLeft className="h-3.5 w-3.5 text-green-400" />;
  if (t.includes("WITHDRAW") || t.includes("DEBIT")) return <ArrowUpRight className="h-3.5 w-3.5 text-red-400" />;
  return <ArrowUpDown className="h-3.5 w-3.5 text-[#00d0ff]" />;
}

async function bluefinGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BLUEFIN_API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Bluefin mainnet ${res.status}`);
  return res.json();
}

/* ── Section header ── */
function SectionHeader({ icon, title, badge, onRefresh, loading }: {
  icon: React.ReactNode; title: string; badge?: string; onRefresh?: () => void; loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold text-white text-sm">{title}</span>
        {badge && <Badge className="bg-[#00d0ff]/10 text-[#00d0ff] border-[#00d0ff]/30 text-[10px] font-medium">{badge}</Badge>}
      </div>
      {onRefresh && (
        <button onClick={onRefresh} className="text-gray-400 hover:text-white transition-colors p-1" data-testid={`refresh-${title.toLowerCase().replace(/\s/g, "-")}`}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      )}
    </div>
  );
}

function EmptyData({ msg }: { msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-500">
      <AlertCircle className="h-5 w-5 text-yellow-500/60" />
      <p className="text-sm text-center max-w-sm">{msg}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
      <RefreshCw className="h-4 w-4 animate-spin text-[#00d0ff]" />
      <span className="text-sm">Fetching from Bluefin mainnet…</span>
    </div>
  );
}

function PaginationBar({ page, count, limit, onPrev, onNext }: { page: number; count: number; limit: number; onPrev: () => void; onNext: () => void; }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-white/5">
      <span className="text-xs text-gray-500">Page {page} · {count} records · Bluefin Mainnet</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="border-white/10 bg-transparent hover:bg-white/5 h-7 px-2 text-xs"
          disabled={page <= 1} onClick={onPrev} data-testid="button-prev-page">
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <Button variant="outline" size="sm" className="border-white/10 bg-transparent hover:bg-white/5 h-7 px-2 text-xs"
          disabled={count < limit} onClick={onNext} data-testid="button-next-page">
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/* ── Transaction History (GET /userTransactionHistory) ── */
// https://bluefin-exchange.readme.io/reference/getaccounttransactionhistory
function TxHistory({ address }: { address: string }) {
  const LIMIT = 50;
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BluefinTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetched, setFetched] = useState(false);

  const load = async (p: number) => {
    setLoading(true); setError("");
    try {
      const data = await bluefinGet<BluefinTransaction[]>("/userTransactionHistory", {
        parentAddress: address, limit: String(LIMIT), pageNumber: String(p),
      });
      setRows(Array.isArray(data) ? data : []); setPage(p); setFetched(true);
    } catch (e: any) { setError(e.message); setFetched(true); }
    setLoading(false);
  };
  if (!fetched && !loading) load(1);

  return (
    <div className="bg-[#0e1e24] border border-white/5 rounded-xl overflow-hidden">
      <SectionHeader icon={<Clock className="h-4 w-4 text-[#00d0ff]" />} title="Transaction History"
        badge="Mainnet" onRefresh={() => load(page)} loading={loading} />
      <div className="overflow-x-auto">
        {loading ? <LoadingRows /> : (error || rows.length === 0) ? (
          <EmptyData msg="No transaction history found on Bluefin mainnet for this address." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02]">
              <tr className="text-gray-500 text-xs border-b border-white/5">
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Symbol</th>
                <th className="text-right px-5 py-3 font-medium">Amount</th>
                <th className="text-left px-5 py-3 font-medium">Asset</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Tx Hash</th>
                <th className="text-left px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx, i) => (
                <tr key={tx.id || i} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                  data-testid={`row-tx-${tx.id || i}`}>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1.5">
                      <TxTypeIcon type={tx.type} />
                      <span className="text-white text-xs capitalize">{tx.type || "—"}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-300 text-xs">{tx.symbol || "—"}</td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-white">{fmtNum(tx.amount)}</td>
                  <td className="px-5 py-3 text-gray-300 text-xs">{tx.asset || "—"}</td>
                  <td className="px-5 py-3"><StatusChip s={tx.status} /></td>
                  <td className="px-5 py-3"><TxLink hash={tx.txHash} /></td>
                  <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">{fmt(tx.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > 0 && <PaginationBar page={page} count={rows.length} limit={LIMIT} onPrev={() => load(page - 1)} onNext={() => load(page + 1)} />}
    </div>
  );
}

/* ── My Trades (GET /userTrades) ── */
// https://bluefin-exchange.readme.io/reference/getusertradehistory
function MyTrades({ address }: { address: string }) {
  const LIMIT = 50;
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BluefinUserTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetched, setFetched] = useState(false);

  const load = async (p: number) => {
    setLoading(true); setError("");
    try {
      const data = await bluefinGet<BluefinUserTrade[]>("/userTrades", {
        parentAddress: address, limit: String(LIMIT), pageNumber: String(p),
      });
      setRows(Array.isArray(data) ? data : []); setPage(p); setFetched(true);
    } catch (e: any) { setError(e.message); setFetched(true); }
    setLoading(false);
  };
  if (!fetched && !loading) load(1);

  return (
    <div className="bg-[#0e1e24] border border-white/5 rounded-xl overflow-hidden">
      <SectionHeader icon={<TrendingUp className="h-4 w-4 text-[#00d0ff]" />} title="My Trades"
        badge="Mainnet" onRefresh={() => load(page)} loading={loading} />
      <div className="overflow-x-auto">
        {loading ? <LoadingRows /> : (error || rows.length === 0) ? (
          <EmptyData msg="No trade history found on Bluefin mainnet for this wallet." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02]">
              <tr className="text-gray-500 text-xs border-b border-white/5">
                <th className="text-left px-5 py-3 font-medium">Symbol</th>
                <th className="text-left px-5 py-3 font-medium">Side</th>
                <th className="text-right px-5 py-3 font-medium">Price</th>
                <th className="text-right px-5 py-3 font-medium">Qty</th>
                <th className="text-right px-5 py-3 font-medium">Fee</th>
                <th className="text-right px-5 py-3 font-medium">Realized PnL</th>
                <th className="text-left px-5 py-3 font-medium">Maker</th>
                <th className="text-left px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id || i} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                  data-testid={`row-trade-${t.id || i}`}>
                  <td className="px-5 py-3 text-white text-xs font-medium">{t.symbol || "—"}</td>
                  <td className="px-5 py-3"><SideChip side={t.side} /></td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-white">{fmtNum(t.price, 2)}</td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-white">{fmtNum(t.quantity)}</td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-gray-400">{fmtNum(t.fee)} {t.feeCurrency}</td>
                  <td className={`px-5 py-3 text-right font-mono text-xs ${pnlColor(t.realizedPnl)}`}>{fmtNum(t.realizedPnl, 4)}</td>
                  <td className="px-5 py-3 text-xs text-gray-400">{t.isMaker ? "Yes" : "No"}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">{fmt(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > 0 && <PaginationBar page={page} count={rows.length} limit={LIMIT} onPrev={() => load(page - 1)} onNext={() => load(page + 1)} />}
    </div>
  );
}

/* ── Funding Rate History (GET /userFundingHistory) ── */
// https://bluefin-exchange.readme.io/reference/getaccountfundingratehistory
function FundingHistory({ address }: { address: string }) {
  const [rows, setRows] = useState<BluefinFundingPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetched, setFetched] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await bluefinGet<BluefinFundingPayment[]>("/userFundingHistory", {
        parentAddress: address, limit: "50",
      });
      setRows(Array.isArray(data) ? data : []); setFetched(true);
    } catch (e: any) { setError(e.message); setFetched(true); }
    setLoading(false);
  };
  if (!fetched && !loading) load();

  return (
    <div className="bg-[#0e1e24] border border-white/5 rounded-xl overflow-hidden">
      <SectionHeader icon={<BarChart2 className="h-4 w-4 text-[#00d0ff]" />} title="Funding Rate History"
        badge="Mainnet" onRefresh={load} loading={loading} />
      <div className="overflow-x-auto">
        {loading ? <LoadingRows /> : (error || rows.length === 0) ? (
          <EmptyData msg="No funding rate history found on Bluefin mainnet for this wallet." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02]">
              <tr className="text-gray-500 text-xs border-b border-white/5">
                <th className="text-left px-5 py-3 font-medium">Symbol</th>
                <th className="text-left px-5 py-3 font-medium">Side</th>
                <th className="text-right px-5 py-3 font-medium">Funding Rate</th>
                <th className="text-right px-5 py-3 font-medium">Payment</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                  data-testid={`row-funding-${r.id || i}`}>
                  <td className="px-5 py-3 text-white text-xs font-medium">{r.symbol || "—"}</td>
                  <td className="px-5 py-3 text-xs text-gray-300 capitalize">{r.positionSide || "—"}</td>
                  <td className="px-5 py-3 text-right font-mono text-xs text-[#00d0ff]">
                    {(parseFloat(r.fundingRate) * 100).toFixed(4)}%
                  </td>
                  <td className={`px-5 py-3 text-right font-mono text-xs ${pnlColor(r.payment)}`}>{fmtNum(r.payment)}</td>
                  <td className="px-5 py-3"><StatusChip s={r.status} /></td>
                  <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">{fmt(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ── Wallet prompt card ── */
function WalletGate({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-[#0e1e24] border border-white/5 rounded-xl p-6 flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-[#00d0ff]/10 border border-[#00d0ff]/20 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="font-semibold text-white text-sm">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
      </div>
      <div className="ml-auto shrink-0">
        <Badge className="bg-white/5 text-gray-400 border-white/10 text-[10px]">Connect wallet</Badge>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
export default function TradingPage() {
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;

  return (
    <Layout>
      <div className="min-h-screen bg-[#080f13]">
        <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">

          {/* ── Page header ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#00d0ff]/10 border border-[#00d0ff]/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-[#00d0ff]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white leading-tight">Bluefin Integration</h1>
                <p className="text-xs text-gray-400">Liquidity Network (BLN) · Sui Mainnet</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">Live on Mainnet</span>
            </div>
          </div>

          {/* ── SBETS Live Price Ticker ── */}
          <LivePricesBar />

          {/* ── Swap cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* In-App Swap Widget */}
            <SwapWidget />

            {/* Trade & Perps */}
            <div className="bg-[#0e1e24] border border-white/5 rounded-xl p-6 flex flex-col" data-testid="card-trade-perps">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-[#00d0ff]/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-[#00d0ff]" />
                </div>
                <div>
                  <p className="font-bold text-white">Trade &amp; Perps</p>
                  <p className="text-xs text-gray-400">Full Bluefin trading terminal</p>
                </div>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed mb-5 flex-1">
                Access Bluefin's full trading interface — spot markets, perpetual futures,
                and advanced order types. The deepest on-chain order book on Sui.
              </p>
              <ul className="border border-white/5 rounded-lg p-3 mb-5 space-y-2.5">
                <li className="flex items-center gap-2 text-sm text-gray-300">
                  <Zap className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                  Sub-second settlement on Sui
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-300">
                  <Globe className="h-3.5 w-3.5 text-[#00d0ff] shrink-0" />
                  Non-custodial, on-chain order book
                </li>
                <li className="flex items-center gap-2 text-sm text-gray-300">
                  <TrendingUp className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  Up to 20× leverage on perpetuals
                </li>
              </ul>
              <Button
                variant="outline"
                className="w-full border-white/10 bg-transparent hover:bg-white/5 text-white font-semibold gap-2"
                onClick={() => window.open(BLUEFIN_TERMINAL, "_blank")}
                data-testid="button-open-terminal">
                <TrendingUp className="h-4 w-4" />
                Open Bluefin Terminal
                <ExternalLink className="h-3 w-3 opacity-70" />
              </Button>
            </div>
          </div>

          {/* ── CTA banner ── */}
          <div className="bg-gradient-to-r from-[#0066cc]/20 to-[#00d0ff]/10 border border-[#00d0ff]/20 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-bold text-white text-lg">Ready to get SBETS?</p>
              <p className="text-sm text-gray-400 mt-1">
                Swap SUI → SBETS on Bluefin or Turbos — both pools live on Sui Mainnet.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button className="bg-[#0066cc] hover:bg-[#0055bb] text-white font-semibold gap-2"
                onClick={() => window.open(BLUEFIN_SWAP, "_blank")} data-testid="button-cta-swap-bluefin">
                <ArrowUpDown className="h-4 w-4" /> Bluefin <ExternalLink className="h-3 w-3 opacity-70" />
              </Button>
              <Button className="bg-[#00b896] hover:bg-[#00a07f] text-white font-semibold gap-2"
                onClick={() => window.open(TURBOS_SWAP_URL, "_blank")} data-testid="button-cta-swap-turbos">
                <ArrowUpDown className="h-4 w-4" /> Turbos <ExternalLink className="h-3 w-3 opacity-70" />
              </Button>
              <Button variant="outline" className="border-white/10 bg-transparent hover:bg-white/5 text-white font-semibold gap-2"
                onClick={() => window.open(BLUEFIN_TERMINAL, "_blank")} data-testid="button-cta-terminal">
                <TrendingUp className="h-4 w-4" /> Terminal <ExternalLink className="h-3 w-3 opacity-70" />
              </Button>
            </div>
          </div>

          {/* ── Live Pool Stats ── */}
          <PoolStatsCard />

          {/* ── How Liquidity Works ── */}
          <div className="bg-[#0e1e24] border border-white/5 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-white/5">
              <Droplets className="h-4 w-4 text-[#00d0ff]" />
              <span className="font-semibold text-white text-sm">How SuiBets Liquidity Works</span>
              <Badge className="bg-[#00d0ff]/10 text-[#00d0ff] border-[#00d0ff]/30 text-[10px] font-medium ml-1">Bluefin BLN</Badge>
            </div>

            {/* Flow steps */}
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  step: "01",
                  icon: <ArrowUpDown className="h-5 w-5 text-[#00d0ff]" />,
                  title: "Swap SUI → SBETS",
                  desc: "Users swap SUI for SBETS via the in-app DEX aggregator. Trades route through Turbos Finance's on-chain AMM pool for best execution.",
                  color: "text-[#00d0ff]",
                  border: "border-[#00d0ff]/20",
                  bg: "bg-[#00d0ff]/5",
                },
                {
                  step: "02",
                  icon: <Layers className="h-5 w-5 text-yellow-400" />,
                  title: "Place Bets On-Chain",
                  desc: "SBETS tokens power on-chain sports bets. Every bet is settled transparently via Sui smart contracts.",
                  color: "text-yellow-400",
                  border: "border-yellow-400/20",
                  bg: "bg-yellow-400/5",
                },
                {
                  step: "03",
                  icon: <Coins className="h-5 w-5 text-green-400" />,
                  title: "Fees Flow to Revenue Pool",
                  desc: "Platform fees from betting volume accumulate in the on-chain revenue pool, shared with all SBETS stakers.",
                  color: "text-green-400",
                  border: "border-green-400/20",
                  bg: "bg-green-400/5",
                },
                {
                  step: "04",
                  icon: <PieChart className="h-5 w-5 text-purple-400" />,
                  title: "Earn Revenue Share",
                  desc: "SBETS stakers earn proportional revenue share. More stake = larger share of the platform's betting income.",
                  color: "text-purple-400",
                  border: "border-purple-400/20",
                  bg: "bg-purple-400/5",
                },
              ].map((s, i) => (
                <div key={i} className={`${s.bg} border ${s.border} rounded-xl p-4 relative`}>
                  <span className={`text-[10px] font-bold ${s.color} opacity-60 mb-2 block`}>STEP {s.step}</span>
                  <div className={`w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center mb-3`}>
                    {s.icon}
                  </div>
                  <p className={`text-sm font-semibold ${s.color} mb-1.5`}>{s.title}</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{s.desc}</p>
                  {i < 3 && (
                    <ArrowRight className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 z-10" />
                  )}
                </div>
              ))}
            </div>

            {/* Liquidity mechanics row */}
            <div className="border-t border-white/5 px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#00d0ff]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldCheck className="h-4 w-4 text-[#00d0ff]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white mb-1">Non-Custodial</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    All liquidity lives on-chain in Sui smart contracts. SuiBets never holds user funds — your keys, your tokens.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Users className="h-4 w-4 text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white mb-1">Community-Owned</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    SBETS holders govern the protocol. Revenue share is distributed proportionally to all stakers on-chain.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Lock className="h-4 w-4 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white mb-1">BLN Liquidity Depth</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Bluefin's BLN provides institutional-grade liquidity for SBETS swaps — tight spreads, zero counterparty risk.
                  </p>
                </div>
              </div>
            </div>

            {/* Action footer */}
            <div className="border-t border-white/5 px-6 py-4 bg-white/[0.02] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <p className="text-xs text-gray-400">
                SBETS pools live on <span className="text-[#00d0ff] font-medium">Bluefin</span> &amp;{" "}
                <span className="text-[#00b896] font-medium">Turbos</span> — both on{" "}
                <span className="text-[#00d0ff] font-medium">Sui Mainnet</span>. Swaps settle on-chain in &lt;1 second.
              </p>
              <div className="flex gap-2 shrink-0 flex-wrap">
                <Button size="sm" className="bg-[#0066cc] hover:bg-[#0055bb] text-white gap-1.5 text-xs h-8"
                  onClick={() => window.open(BLUEFIN_SWAP, "_blank")} data-testid="button-liquidity-swap-bluefin">
                  <ArrowUpDown className="h-3.5 w-3.5" /> Bluefin
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </Button>
                <Button size="sm" className="bg-[#00b896] hover:bg-[#00a07f] text-white gap-1.5 text-xs h-8"
                  onClick={() => window.open(TURBOS_SWAP_URL, "_blank")} data-testid="button-liquidity-swap-turbos">
                  <ArrowUpDown className="h-3.5 w-3.5" /> Turbos
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </Button>
                <Button size="sm" variant="outline" className="border-white/10 bg-transparent hover:bg-white/5 text-white gap-1.5 text-xs h-8"
                  onClick={() => window.open("/staking", "_self")} data-testid="button-liquidity-stake">
                  <PieChart className="h-3.5 w-3.5" /> Stake SBETS
                </Button>
              </div>
            </div>
          </div>

          {/* ── LP Rewards ── */}
          <LPSection />

          {/* ── Perps Markets ── */}
          <PerpsMarketsSection />

          {/* ── Wallet-gated sections ── */}
          <div className="space-y-4">
            {walletAddress ? (
              <>
                <TxHistory address={walletAddress} />
                <MyTrades address={walletAddress} />
                <FundingHistory address={walletAddress} />
              </>
            ) : (
              <>
                <WalletGate
                  icon={<Clock className="h-5 w-5 text-[#00d0ff]/50" />}
                  title="Transaction History"
                  desc="Connect your Sui wallet to view your Bluefin mainnet deposit, withdrawal and transfer history." />
                <WalletGate
                  icon={<TrendingUp className="h-5 w-5 text-[#00d0ff]/50" />}
                  title="My Trades"
                  desc="Connect your Sui wallet to view your executed trades on Bluefin mainnet." />
                <WalletGate
                  icon={<BarChart2 className="h-5 w-5 text-[#00d0ff]/50" />}
                  title="Funding Rate History"
                  desc="Connect your Sui wallet to view your funding rate payments on Bluefin mainnet." />
              </>
            )}
          </div>

        </div>
      </div>
    </Layout>
  );
}
