import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { ExternalLink, TrendingUp, Zap, Globe, ArrowRightLeft } from "lucide-react";

const SBETS_TOKEN = "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS";
const BLUEFIN_TRADE_URL = "https://trade.bluefin.io";
const BLUEFIN_POOL_ID = "0xbcda57bac902ed2207da46c11f6b8388fd2d36c45ffb9851228d607813b7ab4b";
const BLUEFIN_SPOT_SWAP_URL = `https://trade.bluefin.io/#/swap?from=0x2::sui::SUI&to=${SBETS_TOKEN}`;
const BLUEFIN_POOL_URL = `https://trade.bluefin.io/liquidity-pools?pool=${BLUEFIN_POOL_ID}`;
const TURBOS_SWAP_URL = `https://app.turbos.finance/#/trade?input=0x2::sui::SUI&output=${SBETS_TOKEN}`;
const CETUS_SWAP_URL = `https://app.cetus.zone/swap?from=0x2::sui::SUI&to=${SBETS_TOKEN}`;

export default function TradePage() {
  return (
    <Layout title="">
      <div className="max-w-5xl mx-auto space-y-6 py-4">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img
              src="/logo/suibets-logo.jpg"
              alt="SuiBets"
              className="h-10 w-auto object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-2xl text-gray-400">×</span>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-blue-400" />
              </div>
              <span className="text-2xl font-bold text-blue-400">Bluefin</span>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white">Trade on Bluefin</h1>
          <p className="text-gray-400 max-w-xl mx-auto">
            SuiBets is integrated with Bluefin's Liquidity Network — swap SBETS tokens and access deep on-chain liquidity, all powered by Sui.
          </p>
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-400/30 rounded-full px-4 py-1 text-blue-300 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Powered by Bluefin + Turbos
          </div>
        </div>

        {/* Action Cards */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Buy SBETS Card */}
          <div className="bg-[#0b1618] border border-cyan-500/30 rounded-2xl p-6 space-y-4 hover:border-cyan-400/60 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center">
                <ArrowRightLeft className="h-6 w-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Buy SBETS</h2>
                <p className="text-sm text-gray-400">Swap SUI → SBETS on Sui mainnet</p>
              </div>
            </div>
            <p className="text-gray-400 text-sm">
              Acquire SBETS tokens to place bets, earn staking rewards, and collect platform revenue share. Choose your preferred Sui DEX below.
            </p>
            <div className="bg-[#112225] rounded-xl p-3 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-gray-400">
                <span>Token</span>
                <span className="text-cyan-300">SBETS</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Network</span>
                <span className="text-cyan-300">Sui Mainnet</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Contract</span>
                <span className="text-gray-500 text-[10px] truncate max-w-[160px]">0x6a4d9c...285</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-blue-500 hover:bg-blue-400 text-white font-semibold transition-all"
                onClick={() => window.open(BLUEFIN_SPOT_SWAP_URL, '_blank', 'noopener,noreferrer')}
              >
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Bluefin
                <ExternalLink className="h-3 w-3 ml-1 opacity-70" />
              </Button>
              <Button
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold transition-all"
                onClick={() => window.open(TURBOS_SWAP_URL, '_blank', 'noopener,noreferrer')}
              >
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Turbos
                <ExternalLink className="h-3 w-3 ml-1 opacity-70" />
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 font-semibold transition-all"
                onClick={() => window.open(CETUS_SWAP_URL, '_blank', 'noopener,noreferrer')}
              >
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Cetus
                <ExternalLink className="h-3 w-3 ml-1 opacity-70" />
              </Button>
            </div>
          </div>

          {/* Trade & Perps Card */}
          <div className="bg-[#0b1618] border border-cyan-500/20 rounded-2xl p-6 space-y-4 hover:border-cyan-400/40 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Trade & Perps</h2>
                <p className="text-sm text-gray-400">Full trading terminal</p>
              </div>
            </div>
            <p className="text-gray-400 text-sm">
              Access Bluefin's full trading interface — spot markets, perpetual futures, and advanced order types. The deepest on-chain order book on Sui.
            </p>
            <div className="bg-[#112225] rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-gray-300">
                <Zap className="h-3.5 w-3.5 text-yellow-400" /> Sub-second settlement on Sui
              </div>
              <div className="flex items-center gap-2 text-gray-300">
                <Globe className="h-3.5 w-3.5 text-blue-400" /> Non-custodial, on-chain order book
              </div>
              <div className="flex items-center gap-2 text-gray-300">
                <TrendingUp className="h-3.5 w-3.5 text-green-400" /> Up to 20× leverage on perps
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 hover:border-cyan-400/70 font-semibold transition-all"
              onClick={() => window.open(BLUEFIN_TRADE_URL, '_blank', 'noopener,noreferrer')}
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Open Bluefin Terminal
              <ExternalLink className="h-3.5 w-3.5 ml-2 opacity-70" />
            </Button>
          </div>
        </div>

        {/* Open Bluefin CTA Banner */}
        <div className="bg-gradient-to-r from-blue-900/40 via-blue-800/20 to-blue-900/40 border border-blue-500/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-blue-300 text-sm font-medium">Live on Bluefin</span>
            </div>
            <h3 className="text-white font-bold text-xl">Ready to trade?</h3>
            <p className="text-gray-400 text-sm max-w-sm">
              Bluefin's trading terminal opens in a new tab — connect your Sui wallet and start trading SBETS instantly.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Button
              size="lg"
              className="bg-blue-500 hover:bg-blue-400 text-white font-bold px-8 shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] transition-all"
              onClick={() => window.open(BLUEFIN_SPOT_SWAP_URL, '_blank', 'noopener,noreferrer')}
            >
              <ArrowRightLeft className="h-5 w-5 mr-2" />
              Buy SBETS (Bluefin)
              <ExternalLink className="h-4 w-4 ml-2 opacity-70" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-blue-400/50 text-blue-300 hover:bg-blue-500/10 hover:border-blue-400 font-bold px-8 transition-all"
              onClick={() => window.open(BLUEFIN_TRADE_URL, '_blank', 'noopener,noreferrer')}
            >
              <TrendingUp className="h-5 w-5 mr-2" />
              Full Terminal
              <ExternalLink className="h-4 w-4 ml-2 opacity-70" />
            </Button>
          </div>
        </div>

        {/* About Bluefin */}
        <div className="bg-gradient-to-r from-blue-900/20 via-[#0b1618] to-cyan-900/10 border border-blue-500/20 rounded-2xl p-6">
          <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
            <Globe className="h-5 w-5 text-blue-400" />
            About Bluefin Liquidity Network
          </h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-400">
            <div className="space-y-2">
              <p>
                <span className="text-blue-300 font-semibold">Bluefin's network</span> lets protocols like SuiBets tap into shared liquidity pools and trading rails — meaning SBETS holders always have deep liquidity for swaps.
              </p>
              <p>Markets built on Bluefin's infrastructure inherit its existing order book depth and trading rails on day one.</p>
            </div>
            <div className="space-y-2">
              <p>
                <span className="text-cyan-300 font-semibold">White Label</span> allows SuiBets to embed a fully branded trading experience directly within the platform — giving bettors a complete DeFi hub in one place.
              </p>
              <p>All trades settle on-chain via Sui, with non-custodial guarantees and transparent fee flows back to the SuiBets treasury.</p>
            </div>
          </div>
          {/* Live Pool Info */}
          <div className="mt-5 bg-blue-900/20 border border-blue-500/30 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span className="text-green-400 text-xs font-semibold uppercase tracking-wide">Live Pool — Bluefin Spot CLMM</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs font-mono">
              <div className="flex flex-col gap-1">
                <span className="text-gray-500">Pool</span>
                <span className="text-blue-300 break-all">{BLUEFIN_POOL_ID}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-gray-500">Pair / Fee / Tick spacing</span>
                <span className="text-cyan-300">SUI / SBETS · 0.3% · 60</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href={BLUEFIN_POOL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1 underline underline-offset-2"
              >
                View pool on Bluefin <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-gray-600">·</span>
              <a
                href={`https://suiscan.xyz/mainnet/object/${BLUEFIN_POOL_ID}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1 underline underline-offset-2"
              >
                Suiscan <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="https://bluefin.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1 underline underline-offset-2"
            >
              bluefin.io <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-gray-600">·</span>
            <a
              href="https://x.com/bluefinapp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1 underline underline-offset-2"
            >
              @bluefinapp <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

      </div>
    </Layout>
  );
}
