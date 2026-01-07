import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Search, Clock, TrendingUp, Wallet, LogOut, RefreshCw } from "lucide-react";
import { useBetting } from "@/context/BettingContext";
import { useToast } from "@/hooks/use-toast";
import { useCurrentAccount, useDisconnectWallet, useSuiClientQuery } from "@mysten/dapp-kit";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import Footer from "@/components/layout/Footer";
import { useLiveEvents, useUpcomingEvents } from "@/hooks/useEvents";
import { useQuery } from "@tanstack/react-query";
const suibetsLogo = "/images/suibets-logo.png";
const suibetsHeroBg = "/images/hero-bg.png";

const SPORTS_LIST = [
  { id: 1, name: "Football", icon: "⚽" },
  { id: 2, name: "Basketball", icon: "🏀" },
  { id: 3, name: "Tennis", icon: "🎾" },
  { id: 4, name: "Baseball", icon: "⚾" },
  { id: 5, name: "Hockey", icon: "🏒" },
  { id: 6, name: "MMA", icon: "🥊" },
  { id: 7, name: "Horse Racing", icon: "🏇" },
  { id: 8, name: "Esports", icon: "🎮" },
  { id: 9, name: "Cricket", icon: "🏏" },
  { id: 10, name: "Rugby", icon: "🏉" },
  { id: 11, name: "American Football", icon: "🏈" },
  { id: 12, name: "Golf", icon: "⛳" },
  { id: 13, name: "Volleyball", icon: "🏐" },
  { id: 14, name: "Badminton", icon: "🏸" },
  { id: 15, name: "Table Tennis", icon: "🏓" },
  { id: 16, name: "Athletics", icon: "🏃" },
  { id: 17, name: "Cycling", icon: "🚴" },
  { id: 18, name: "Boxing", icon: "🥊" },
  { id: 19, name: "Wrestling", icon: "🤼" },
  { id: 20, name: "Snooker", icon: "🎱" },
  { id: 21, name: "Darts", icon: "🎯" },
  { id: 22, name: "Motorsports", icon: "🏎️" },
  { id: 23, name: "F1 Racing", icon: "🏁" },
];

interface Outcome {
  id: string;
  name: string;
  odds: number;
  probability?: number;
}

interface Market {
  id: string;
  name: string;
  outcomes: Outcome[];
}

interface Event {
  id: string | number;
  homeTeam: string;
  awayTeam: string;
  leagueName?: string;
  league?: string;
  startTime: string;
  isLive: boolean;
  score?: string;
  homeScore?: number;
  awayScore?: number;
  minute?: string;
  status?: string;
  markets?: Market[];
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  sportId: number;
}

export default function CleanHome() {
  const [, setLocation] = useLocation();
  const [selectedSport, setSelectedSport] = useState<number | null>(1);
  const [activeTab, setActiveTab] = useState<"live" | "upcoming">("live");
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const matchesSectionRef = useRef<HTMLDivElement>(null);

  const scrollToMatches = () => {
    matchesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleTabClick = (tab: "live" | "upcoming") => {
    setActiveTab(tab);
    setTimeout(() => scrollToMatches(), 100);
  };
  
  // Use dapp-kit for wallet state
  const currentAccount = useCurrentAccount();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const walletAddress = currentAccount?.address;
  const isConnected = !!walletAddress;
  
  // Fetch on-chain wallet SUI balance
  const { data: onChainBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '' },
    { enabled: !!walletAddress }
  );
  
  // Fetch on-chain SBETS token balance
  const SBETS_COIN_TYPE = '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS';
  const { data: onChainSbetsBalance } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '', coinType: SBETS_COIN_TYPE },
    { enabled: !!walletAddress }
  );
  
  // Convert from MIST to SUI (1 SUI = 1,000,000,000 MIST)
  const walletSuiBalance = onChainBalance?.totalBalance 
    ? Number(onChainBalance.totalBalance) / 1_000_000_000 
    : 0;
  
  // SBETS token balance (assuming 9 decimals like SUI)
  const walletSbetsBalance = onChainSbetsBalance?.totalBalance 
    ? Number(onChainSbetsBalance.totalBalance) / 1_000_000_000 
    : 0;
  
  // Fetch platform deposited balance from API (what's available to bet)
  // Refetch every 30 seconds to show updated balances after settlements
  const { data: balanceData } = useQuery<{ SUI: number; SBETS: number; suiBalance: number; sbetsBalance: number }>({
    queryKey: [`/api/user/balance?userId=${walletAddress}`],
    enabled: !!walletAddress,
    refetchInterval: 30000, // Auto-refresh every 30 seconds to show settled bet winnings
  });
  
  const platformBalances = {
    SUI: balanceData?.SUI ?? balanceData?.suiBalance ?? 0,
    SBETS: balanceData?.SBETS ?? balanceData?.sbetsBalance ?? 0
  };
  const disconnect = () => disconnectWallet();

  const { data: liveEvents = [], isLoading: liveLoading, refetch: refetchLive } = useLiveEvents(selectedSport);
  const { data: upcomingEvents = [], isLoading: upcomingLoading, refetch: refetchUpcoming } = useUpcomingEvents(selectedSport);

  const events = activeTab === "live" ? liveEvents : upcomingEvents;
  const isLoading = activeTab === "live" ? liveLoading : upcomingLoading;

  const handleSportClick = (sportId: number) => {
    setSelectedSport(sportId);
  };

  const handleConnectWallet = () => {
    // Open the wallet connection modal
    setIsWalletModalOpen(true);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <div className="min-h-screen" data-testid="clean-home">
      {/* Top Navigation Bar */}
      <nav className="bg-black/40 backdrop-blur-md border-b border-cyan-900/30 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <img src={suibetsLogo} alt="SuiBets" className="h-10 w-auto" />
          </div>

          {/* Center Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-cyan-400 hover:text-cyan-300 transition-colors text-sm font-medium" data-testid="nav-bets">Bets</Link>
            <Link href="/dashboard" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-dashboard">Dashboard</Link>
            <Link href="/bet-history" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-my-bets">My Bets</Link>
            <Link href="/activity" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-activity">Activity</Link>
            <Link href="/deposits-withdrawals" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-withdraw">Withdraw</Link>
            <Link href="/parlay" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-parlays">Parlays</Link>
            <Link href="/whitepaper" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-whitepaper">Whitepaper</Link>
          </div>

          {/* Right Side - Wallet */}
          <div className="flex items-center gap-4">
            <button className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-4 py-2 rounded-lg text-sm transition-colors" data-testid="btn-buy-now">
              Buy Now
            </button>
            {isConnected && walletAddress ? (
              <>
                <div className="text-right">
                  <div className="text-cyan-400 text-xs" title="Platform balance (deposited for betting)">
                    💰 {platformBalances.SUI.toFixed(4)} SUI | {platformBalances.SBETS.toFixed(2)} SBETS
                  </div>
                  <div className="text-green-400 text-xs" title="Wallet balance (on-chain)">
                    🔗 Wallet: {walletSuiBalance.toFixed(4)} SUI | {walletSbetsBalance.toFixed(2)} SBETS
                  </div>
                  <div className="text-gray-500 text-xs">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
                </div>
                <button 
                  onClick={() => window.location.reload()} 
                  className="text-gray-400 hover:text-white p-2"
                  data-testid="btn-refresh"
                >
                  <RefreshCw size={18} />
                </button>
                <button 
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm"
                  data-testid="btn-disconnect"
                >
                  <LogOut size={16} />
                  Disconnect
                </button>
              </>
            ) : (
              <button 
                onClick={handleConnectWallet}
                className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-4 py-2 rounded-lg text-sm"
                data-testid="btn-connect-wallet"
              >
                <Wallet size={16} />
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Banner */}
      <div className="relative w-full overflow-hidden" data-testid="hero-banner">
        <div 
          className="w-full h-64 md:h-80 lg:h-96 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${suibetsHeroBg})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black"></div>
          <div className="relative h-full flex flex-col items-center justify-end text-center px-4 pb-8">
            <p className="text-gray-300 text-lg md:text-xl max-w-2xl mb-6">
              The Future of Sports Betting on Sui Blockchain
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => handleTabClick("live")}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-3 rounded-lg transition-all"
                data-testid="hero-btn-live"
              >
                🔴 Live Matches
              </button>
              <button 
                onClick={() => handleTabClick("upcoming")}
                className="border border-cyan-500 text-cyan-400 hover:bg-cyan-500/10 font-bold px-6 py-3 rounded-lg transition-all"
                data-testid="hero-btn-upcoming"
              >
                📅 Upcoming
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Search teams, leagues..."
              className="w-full bg-[#111111] border border-cyan-900/30 rounded-lg py-3 pl-12 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              data-testid="input-search"
            />
          </div>
        </div>

        {/* Sports - Horizontal scroll on mobile, wrapping grid on desktop */}
        <div className="mb-4 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
          <div className="flex gap-2 md:flex-wrap md:gap-3 w-max md:w-auto">
            {SPORTS_LIST.map((sport) => (
              <button
                key={sport.id}
                onClick={() => handleSportClick(sport.id)}
                className={`py-2 px-3 md:py-3 md:px-4 rounded-lg whitespace-nowrap text-sm md:text-base transition-all flex-shrink-0 md:flex-shrink ${
                  selectedSport === sport.id
                    ? "bg-cyan-500 text-black font-bold"
                    : "bg-[#111111] text-gray-300 hover:bg-[#1a1a1a] border border-cyan-900/30"
                }`}
                data-testid={`sport-btn-${sport.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <span className="mr-1 md:mr-2">{sport.icon}</span>
                {sport.name}
              </button>
            ))}
          </div>
        </div>

        {/* Live / Upcoming Tabs */}
        <div ref={matchesSectionRef} className="flex gap-2 mb-4 scroll-mt-4">
          <button
            onClick={() => handleTabClick("live")}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === "live"
                ? "bg-[#111111] text-cyan-400 border border-cyan-500"
                : "bg-transparent text-gray-400 hover:text-white"
            }`}
            data-testid="tab-live"
          >
            <Clock size={16} />
            Live ({liveEvents.length})
          </button>
          <button
            onClick={() => handleTabClick("upcoming")}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === "upcoming"
                ? "bg-[#111111] text-cyan-400 border border-cyan-500"
                : "bg-transparent text-gray-400 hover:text-white"
            }`}
            data-testid="tab-upcoming"
          >
            <TrendingUp size={16} />
            Upcoming ({upcomingEvents.length})
          </button>
        </div>

        {/* Events List */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-400">Loading events...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 bg-[#111111] rounded-xl border border-cyan-900/30">
              <p className="text-gray-400 mb-2">No {activeTab} events available</p>
              <p className="text-gray-500 text-sm">Check back later for more events</p>
            </div>
          ) : (
            events.map((event, index) => (
              <EventCard 
                key={`${event.sportId}-${event.id}-${index}`} 
                event={event} 
              />
            ))
          )}
        </div>
      </div>
      
      {/* Wallet Connection Modal */}
      <ConnectWalletModal 
        isOpen={isWalletModalOpen} 
        onClose={() => setIsWalletModalOpen(false)} 
      />
      
      {/* Footer */}
      <Footer />
    </div>
  );
}

interface EventCardProps {
  event: Event;
}

function EventCard({ event }: EventCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [stake, setStake] = useState<string>("10");
  const [isExpanded, setIsExpanded] = useState(false);
  const { addBet } = useBetting();
  const { toast } = useToast();

  const getOddsFromMarkets = () => {
    const defaultOdds = { home: 2.05, draw: 3.40, away: 3.00 };
    
    if (!event.markets || event.markets.length === 0) {
      return { 
        home: event.homeOdds || defaultOdds.home, 
        draw: event.drawOdds || defaultOdds.draw, 
        away: event.awayOdds || defaultOdds.away 
      };
    }
    
    const matchWinner = event.markets.find(m => m.name === "Match Result" || m.name === "Match Winner");
    if (matchWinner && matchWinner.outcomes && matchWinner.outcomes.length > 0) {
      const homeOutcome = matchWinner.outcomes.find(o => o.name === event.homeTeam);
      const drawOutcome = matchWinner.outcomes.find(o => o.name === "Draw");
      const awayOutcome = matchWinner.outcomes.find(o => o.name === event.awayTeam);
      return {
        home: (homeOutcome?.odds && !isNaN(homeOutcome.odds)) ? homeOutcome.odds : defaultOdds.home,
        draw: (drawOutcome?.odds && !isNaN(drawOutcome.odds)) ? drawOutcome.odds : defaultOdds.draw,
        away: (awayOutcome?.odds && !isNaN(awayOutcome.odds)) ? awayOutcome.odds : defaultOdds.away
      };
    }
    return defaultOdds;
  };

  const odds = getOddsFromMarkets();

  const getOdds = (outcome: string): number => {
    switch (outcome) {
      case "home": return odds.home;
      case "draw": return odds.draw;
      case "away": return odds.away;
      default: return 2.0;
    }
  };

  const handleOutcomeClick = (outcome: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedOutcome(outcome === selectedOutcome ? null : outcome);
  };

  const handleBetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedOutcome) {
      const selectedOdds = getOdds(selectedOutcome);
      const selectionName = selectedOutcome === "home" 
        ? event.homeTeam 
        : selectedOutcome === "away" 
          ? event.awayTeam 
          : "Draw";
      
      const betId = `${event.id}-${selectedOutcome}-${Date.now()}`;
      
      addBet({
        id: betId,
        eventId: String(event.id),
        eventName: `${event.homeTeam} vs ${event.awayTeam}`,
        selectionName,
        odds: selectedOdds,
        stake: parseFloat(stake) || 10,
        market: "Match Result",
        isLive: event.isLive || false,
      });
      
      setSelectedOutcome(null);
    }
  };

  const parseScore = () => {
    if (event.score) {
      const parts = event.score.split(" - ");
      return { home: parseInt(parts[0]) || 0, away: parseInt(parts[1]) || 0 };
    }
    return { home: event.homeScore || 0, away: event.awayScore || 0 };
  };

  const score = parseScore();
  const leagueName = event.leagueName || event.league || "League";

  const potentialWin = selectedOutcome 
    ? (parseFloat(stake) * getOdds(selectedOutcome)).toFixed(2) 
    : "0";

  const formatDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      if (isToday) {
        return `Today ${timeStr}`;
      } else if (isTomorrow) {
        return `Tomorrow ${timeStr}`;
      } else {
        const dayStr = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        return `${dayStr} ${timeStr}`;
      }
    } catch {
      return '';
    }
  };

  return (
    <div 
      className="bg-[#111111] rounded-xl border border-cyan-900/30 overflow-hidden hover:border-cyan-500/50 transition-all"
      data-testid={`event-card-${event.id}`}
    >
      {/* League Header with Date/Time */}
      <div 
        className="px-4 py-2 border-b border-cyan-900/30 flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {event.isLive && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
          <span className="text-cyan-400 text-sm">{leagueName}</span>
        </div>
        <div className="flex items-center gap-3">
          {event.isLive ? (
            <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded font-medium">
              {event.minute ? `${event.minute}'` : 'LIVE'}
            </span>
          ) : (
            <span className="text-yellow-400 text-xs font-medium bg-yellow-500/10 px-2 py-1 rounded">
              {formatDateTime(event.startTime)}
            </span>
          )}
          <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </div>

      {/* Match Info */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            {event.isLive ? (
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block bg-red-500 text-white text-xs px-2 py-1 rounded font-bold">
                  LIVE {event.minute ? `${event.minute}'` : ''}
                </span>
                <span className="text-cyan-400 text-2xl font-bold">
                  {score.home} - {score.away}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <Clock size={14} className="text-yellow-400" />
                <span className="text-yellow-400 text-sm font-medium">
                  {formatDateTime(event.startTime)}
                </span>
              </div>
            )}
            <h3 className="text-white font-semibold text-lg mb-1">
              {event.homeTeam} vs {event.awayTeam}
            </h3>
            <p className="text-gray-500 text-sm">{leagueName}</p>
          </div>

          {/* Odds Cards */}
          <div className="flex gap-2">
            <div 
              className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                selectedOutcome === "draw" ? "ring-2 ring-yellow-500" : "hover:bg-[#222222]"
              }`}
              onClick={(e) => handleOutcomeClick("draw", e)}
              data-testid={`odds-draw-${event.id}`}
            >
              <div className="text-yellow-400 text-xs mb-1">Draw</div>
              <div className="text-yellow-400 text-xl font-bold">{odds.draw.toFixed(2)}</div>
            </div>
            <div 
              className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                selectedOutcome === "home" ? "ring-2 ring-cyan-500" : "hover:bg-[#222222]"
              }`}
              onClick={(e) => handleOutcomeClick("home", e)}
              data-testid={`odds-home-${event.id}`}
            >
              <div className="text-cyan-400 text-xs mb-1">Home</div>
              <div className="text-cyan-400 text-xl font-bold">{odds.home.toFixed(2)}</div>
              <div className="text-gray-500 text-xs">{event.homeTeam?.split(' ')[0]}</div>
            </div>
            <div 
              className={`bg-[#1a1a1a] rounded-lg p-3 min-w-[70px] text-center cursor-pointer transition-all ${
                selectedOutcome === "away" ? "ring-2 ring-cyan-500" : "hover:bg-[#222222]"
              }`}
              onClick={(e) => handleOutcomeClick("away", e)}
              data-testid={`odds-away-${event.id}`}
            >
              <div className="text-white text-xs mb-1">Away</div>
              <div className="text-white text-xl font-bold">{odds.away.toFixed(2)}</div>
              <div className="text-gray-500 text-xs">{event.awayTeam?.split(' ')[0]}</div>
            </div>
          </div>
        </div>

        {/* Bet Button */}
        <div className="flex justify-center mb-4">
          <button 
            className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-2 rounded-lg flex items-center gap-2 transition-all"
            onClick={handleBetClick}
            data-testid={`btn-bet-${event.id}`}
          >
            ✓ Bet
          </button>
          <button 
            className={`text-sm ml-4 transition-all ${selectedOutcome ? 'text-cyan-400' : 'text-gray-500 hover:text-cyan-400'}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!selectedOutcome) {
                toast({
                  title: "Select a team first",
                  description: "Click on Home, Draw, or Away odds above to select your pick",
                });
              } else {
                handleBetClick(e);
              }
            }}
            data-testid={`btn-select-team-${event.id}`}
          >
            {selectedOutcome ? '+ Add to slip' : '+ Select team'}
          </button>
        </div>

        {/* Betting Panel (shown when outcome selected) */}
        {selectedOutcome && (
          <div className="border-t border-cyan-900/30 pt-4 mt-4">
            <div className="bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded inline-block mb-4 text-sm font-medium">
              Match Winner
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Pick Options */}
              <div>
                <div className="text-gray-400 text-sm mb-2">Pick</div>
                <div className="space-y-2">
                  {["home", "draw", "away"].map((outcome) => (
                    <button
                      key={outcome}
                      onClick={(e) => handleOutcomeClick(outcome, e)}
                      className={`w-full py-2 px-4 rounded-lg text-center transition-all ${
                        selectedOutcome === outcome
                          ? "bg-cyan-500 text-black font-bold"
                          : "bg-[#1a1a1a] text-gray-300 hover:bg-[#222222]"
                      }`}
                      data-testid={`pick-${outcome}-${event.id}`}
                    >
                      {outcome === "home" ? event.homeTeam : outcome === "away" ? event.awayTeam : "Draw"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stake & Potential Win */}
              <div>
                <div className="text-gray-400 text-sm mb-2">Stake (SUI)</div>
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-cyan-900/30 rounded-lg py-2 px-4 text-white mb-4"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`input-stake-${event.id}`}
                />
                
                <div className="text-gray-400 text-sm mb-2">Odds</div>
                <div className="bg-[#1a1a1a] rounded-lg py-2 px-4 text-cyan-400 mb-4">
                  {getOdds(selectedOutcome).toFixed(2)}
                </div>
                
                <div className="text-gray-400 text-sm mb-2">To Win</div>
                <div className="bg-cyan-500 rounded-lg py-3 px-4 text-black font-bold text-center">
                  {potentialWin} SUI
                </div>
              </div>
            </div>

            {/* Place Bet Button */}
            <button 
              className="w-full mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-3 rounded-lg transition-all"
              onClick={handleBetClick}
              data-testid={`btn-place-bet-${event.id}`}
            >
              Place Bet
            </button>
          </div>
        )}

        {/* Expanded Markets Section */}
        {isExpanded && (
          <div className="border-t border-cyan-900/30 pt-4 mt-4">
            <h4 className="text-cyan-400 font-semibold mb-3">All Markets</h4>
            
            {/* Over/Under Markets */}
            <div className="mb-4">
              <div className="text-gray-400 text-sm mb-2">Over/Under 2.5 Goals</div>
              <div className="flex gap-2">
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">Over 2.5</span>
                  <div className="text-cyan-400 font-bold">{(odds.home * 0.9).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">Under 2.5</span>
                  <div className="text-cyan-400 font-bold">{(odds.away * 1.1).toFixed(2)}</div>
                </button>
              </div>
            </div>

            {/* Both Teams to Score */}
            <div className="mb-4">
              <div className="text-gray-400 text-sm mb-2">Both Teams to Score</div>
              <div className="flex gap-2">
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">Yes</span>
                  <div className="text-cyan-400 font-bold">{(1.85).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">No</span>
                  <div className="text-cyan-400 font-bold">{(1.95).toFixed(2)}</div>
                </button>
              </div>
            </div>

            {/* Double Chance */}
            <div className="mb-4">
              <div className="text-gray-400 text-sm mb-2">Double Chance</div>
              <div className="flex gap-2">
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">1X</span>
                  <div className="text-cyan-400 font-bold">{(1.35).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">12</span>
                  <div className="text-cyan-400 font-bold">{(1.25).toFixed(2)}</div>
                </button>
                <button className="flex-1 bg-[#1a1a1a] hover:bg-[#222222] text-white py-2 px-4 rounded-lg text-center transition-all">
                  <span className="text-xs text-gray-400">X2</span>
                  <div className="text-cyan-400 font-bold">{(1.45).toFixed(2)}</div>
                </button>
              </div>
            </div>

            {/* Match Info */}
            <div className="bg-[#0a0a0a] rounded-lg p-3 mt-4">
              <div className="text-gray-400 text-xs mb-1">Match ID</div>
              <div className="text-white text-sm font-mono">{event.id}</div>
              <div className="text-gray-400 text-xs mt-2 mb-1">Start Time</div>
              <div className="text-white text-sm">{new Date(event.startTime).toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}