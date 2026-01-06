import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useWalrusProtocolContext } from '@/context/WalrusProtocolContext';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  FileText, 
  Shield, 
  Zap, 
  Lock,
  TrendingUp,
  Globe,
  Wallet,
  RefreshCw,
  ExternalLink,
  ArrowLeft
} from 'lucide-react';

export default function WhitepaperPage() {
  const [, setLocation] = useLocation();
  const { currentWallet } = useWalrusProtocolContext();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const sections = [
    {
      id: 'introduction',
      title: 'Introduction',
      icon: <FileText className="h-5 w-5 text-cyan-400" />,
      content: 'SuiBets is a decentralized sports betting platform built on the Sui blockchain. Our platform leverages the speed, security, and low transaction costs of the Sui network to provide a seamless betting experience with complete transparency and fairness.'
    },
    {
      id: 'betting-flow',
      title: 'Betting Flow (100% On-Chain)',
      icon: <TrendingUp className="h-5 w-5 text-green-400" />,
      content: `User Places Bet: Calls place_bet (SUI) or place_bet_sbets (SBETS) smart contract function. Tokens go directly to smart contract treasury. Liability is tracked on-chain: total_potential_liability += potential_payout. A Bet object is created with unique betObjectId stored in PostgreSQL for tracking.

Settlement Worker: Runs every 60 seconds, checks for settled events from API-Sports, then calls settle_bet_admin or settle_bet_sbets_admin on-chain.

If Bet WON: net_payout = potential_payout - (profit x 1%). Payout is sent directly from treasury to user wallet. Fee is added to accrued_fees. Liability is reduced.

If Bet LOST: Full stake is added to accrued_fees (platform revenue). Liability is reduced. No payout is made.

Admin Withdraws Revenue: Calls withdraw_fees or withdraw_fees_sbets to extract accumulated platform revenue.`
    },
    {
      id: 'security',
      title: 'Security Model',
      icon: <Shield className="h-5 w-5 text-red-400" />,
      content: `Capability-Based Access Control (OTW Pattern): AdminCap is a single capability minted at deployment, required for all admin operations. OracleCap can be minted by admin for settlement oracles. Private key is stored securely as a Railway secret.

80-Minute Betting Cutoff (Server-Authoritative): Event NOT found in cache results in REJECT. Cache age greater than 2 minutes results in REJECT. Live match minute >= 80 results in REJECT. Event already started (upcoming cache) results in REJECT. Client flags (isLive, matchMinute) are IGNORED - server determines status.

Rejection Codes: EVENT_NOT_FOUND, STALE_EVENT_DATA, STALE_MATCH_DATA, UNVERIFIABLE_MATCH_TIME, MATCH_TIME_EXCEEDED, EVENT_STATUS_UNCERTAIN, EVENT_VERIFICATION_ERROR.`
    },
    {
      id: 'treasury-safety',
      title: 'Treasury & Liability Safety',
      icon: <Lock className="h-5 w-5 text-purple-400" />,
      content: `Smart contract REJECTS bets if treasury cannot cover potential payout. The assertion assert!(treasury >= net_payout) is enforced on-chain before any bet is accepted. Liability is always reduced on settlement (won, lost, or voided). Treasury maintains separate balances for SUI and SBETS tokens with independent liability tracking for each.

Dual Token System: SUI bets range from 0.05 to 400 SUI. SBETS bets range from 1,000 to 50,000,000 SBETS. Each token has dedicated treasury and liability counters.

Fee Structure: 1% fee on profit only (not on stake). Winners receive stake + (profit - 1% fee). Lost stakes are added to platform revenue.`
    },
    {
      id: 'betting',
      title: 'Betting Mechanics',
      icon: <TrendingUp className="h-5 w-5 text-green-400" />,
      content: 'SuiBets offers real-time odds on 30+ sports with multiple market types including Match Winner, Handicap, Over/Under, and more. Live betting is supported with instant settlement upon match completion.'
    },
    {
      id: 'technology',
      title: 'Technology Stack',
      icon: <Zap className="h-5 w-5 text-yellow-400" />,
      content: 'Built on Sui blockchain for high throughput and low latency. Move smart contracts ensure secure and efficient execution. Integration with Walrus protocol for decentralized data storage. Real-time odds from premium sports data providers.'
    }
  ];

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleConnectWallet = () => {
    window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation('/');
    }
  };

  return (
    <div className="min-h-screen bg-black" data-testid="whitepaper-page">
      {/* Navigation */}
      <nav className="bg-[#0a0a0a] border-b border-cyan-900/30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={handleBack}
              className="p-2 text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
              data-testid="btn-back"
            >
              <ArrowLeft size={20} />
            </button>
            <Link href="/" data-testid="link-logo">
              <img src={suibetsLogo} alt="SuiBets" className="h-10 w-auto cursor-pointer" />
            </Link>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-bets">Bets</Link>
            <Link href="/dashboard" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-dashboard">Dashboard</Link>
            <Link href="/bet-history" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-my-bets">My Bets</Link>
            <Link href="/activity" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-activity">Activity</Link>
            <Link href="/deposits-withdrawals" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-withdraw">Withdraw</Link>
            <Link href="/parlay" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-parlays">Parlays</Link>
            <Link href="/whitepaper" className="text-cyan-400 text-sm font-medium" data-testid="nav-whitepaper">Whitepaper</Link>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleRefresh} className="text-gray-400 hover:text-white p-2" data-testid="btn-refresh">
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {currentWallet?.address ? (
              <span className="text-cyan-400 text-sm">{currentWallet.address.slice(0, 6)}...{currentWallet.address.slice(-4)}</span>
            ) : (
              <button onClick={handleConnectWallet} className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2" data-testid="btn-connect">
                <Wallet size={16} />
                Connect
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-cyan-500/20 rounded-xl">
            <FileText className="h-8 w-8 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">SuiBets Whitepaper</h1>
            <p className="text-gray-400">Version 1.0 - December 2025</p>
          </div>
        </div>

        {/* Hero Section */}
        <div className="bg-gradient-to-br from-cyan-900/30 to-purple-900/20 border border-cyan-500/30 rounded-2xl p-8 mb-8">
          <div className="flex items-center gap-4 mb-6">
            <Globe className="h-10 w-10 text-cyan-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">Decentralized Sports Betting</h2>
              <p className="text-gray-400">Powered by Sui Blockchain</p>
            </div>
          </div>
          <p className="text-gray-300 leading-relaxed mb-6">
            SuiBets revolutionizes sports betting by combining the excitement of real-time wagering 
            with the security and transparency of blockchain technology. Our platform uses 100% on-chain 
            settlements with only a 1% fee on profits, ensuring instant payouts directly from the 
            smart contract treasury to your wallet.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-black/50 rounded-xl border border-cyan-900/30">
              <p className="text-3xl font-bold text-cyan-400">1%</p>
              <p className="text-gray-400 text-sm">Fee on Profit</p>
            </div>
            <div className="text-center p-4 bg-black/50 rounded-xl border border-cyan-900/30">
              <p className="text-3xl font-bold text-cyan-400">30+</p>
              <p className="text-gray-400 text-sm">Sports</p>
            </div>
            <div className="text-center p-4 bg-black/50 rounded-xl border border-cyan-900/30">
              <p className="text-3xl font-bold text-cyan-400">Instant</p>
              <p className="text-gray-400 text-sm">Payouts</p>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {sections.map((section, index) => (
            <div 
              key={section.id}
              className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors"
              data-testid={`section-${section.id}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-black/50 rounded-xl">
                  {section.icon}
                </div>
                <h3 className="text-lg font-bold text-cyan-400">{index + 1}. {section.title}</h3>
              </div>
              <p className="text-gray-300 leading-relaxed pl-12">{section.content}</p>
            </div>
          ))}
        </div>

        {/* Smart Contract Addresses */}
        <div className="bg-[#111111] border border-cyan-500/30 rounded-2xl p-6 mt-8">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="h-6 w-6 text-cyan-400" />
            <h3 className="text-lg font-bold text-white">Smart Contract Addresses</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-black/50 rounded-xl">
              <span className="text-gray-400">SBETS Token</span>
              <div className="flex items-center gap-2">
                <code className="text-cyan-400 text-sm">0x6a4d9c...1a7285</code>
                <a 
                  href="https://suiscan.xyz/mainnet/object/0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300"
                  data-testid="link-sbets-token"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-black/50 rounded-xl">
              <span className="text-gray-400">Betting Platform</span>
              <div className="flex items-center gap-2">
                <code className="text-cyan-400 text-sm">0xae1b0d...4099b3</code>
                <a 
                  href="https://suiscan.xyz/mainnet/object/0xae1b0dfed589c6ce5b7dafdb7477954670f0f73530668b5476e3a429b64099b3"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300"
                  data-testid="link-betting-contract"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-black/50 rounded-xl">
              <span className="text-gray-400">Betting Package</span>
              <div className="flex items-center gap-2">
                <code className="text-cyan-400 text-sm">0xfaf371...6e8b32</code>
                <a 
                  href="https://suiscan.xyz/mainnet/object/0xfaf371c3c9fe2544cc1ce9a40b07621503b300bf3a65b8fab0dba134636e8b32"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300"
                  data-testid="link-betting-package"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
