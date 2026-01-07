import { useState, useRef, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Search, Clock, TrendingUp, TrendingDown, Wallet, LogOut, RefreshCw, Menu, X, Star, ChevronUp, ChevronDown, Trash2, Info } from "lucide-react";
import { useBetting } from "@/context/BettingContext";
import { useToast } from "@/hooks/use-toast";
import { useCurrentAccount, useDisconnectWallet, useSuiClientQuery } from "@mysten/dapp-kit";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import Footer from "@/components/layout/Footer";
import { useLiveEvents, useUpcomingEvents } from "@/hooks/useEvents";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

// Favorites management using localStorage
const FAVORITES_KEY = 'suibets_favorites';

function getFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

// Get team initials for logo placeholder
function getTeamInitials(teamName: string): string {
  const words = teamName.split(' ').filter(w => w.length > 0);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return teamName.substring(0, 2).toUpperCase();
}

// Generate consistent color from team name
function getTeamColor(teamName: string): string {
  const colors = [
    'bg-red-600', 'bg-blue-600', 'bg-green-600', 'bg-yellow-600', 
    'bg-purple-600', 'bg-pink-600', 'bg-indigo-600', 'bg-cyan-600',
    'bg-orange-600', 'bg-teal-600', 'bg-rose-600', 'bg-emerald-600'
  ];
  let hash = 0;
  for (let i = 0; i < teamName.length; i++) {
    hash = teamName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isBetSlipOpen, setIsBetSlipOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => getFavorites());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const matchesSectionRef = useRef<HTMLDivElement>(null);
  
  // Betting context for bet slip
  const { selectedBets, removeBet, clearBets } = useBetting();
  
  // Toggle favorite team
  const toggleFavorite = (teamName: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(teamName)) {
        newFavorites.delete(teamName);
      } else {
        newFavorites.add(teamName);
      }
      saveFavorites(newFavorites);
      return newFavorites;
    });
  };

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

  const rawEvents = activeTab === "live" ? liveEvents : upcomingEvents;
  const isLoading = activeTab === "live" ? liveLoading : upcomingLoading;
  
  // Filter events based on search query and favorites
  const events = useMemo(() => {
    let filtered = rawEvents;
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((e: Event) => 
        e.homeTeam.toLowerCase().includes(query) ||
        e.awayTeam.toLowerCase().includes(query) ||
        (e.leagueName || '').toLowerCase().includes(query)
      );
    }
    
    // Favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter((e: Event) => 
        favorites.has(e.homeTeam) || favorites.has(e.awayTeam)
      );
    }
    
    return filtered;
  }, [rawEvents, searchQuery, showFavoritesOnly, favorites]);

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
      <nav className="bg-black/40 backdrop-blur-md border-b border-cyan-900/30 px-4 py-3 relative z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-gray-400 hover:text-cyan-400 transition-colors"
              data-testid="btn-mobile-menu"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <img src={suibetsLogo} alt="SuiBets" className="h-10 w-auto" />
          </div>

          {/* Center Navigation - Desktop Only */}
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
          <div className="flex items-center gap-2 md:gap-4">
            <a 
              href="https://app.turbos.finance/#/trade?input=0x2::sui::SUI&output=0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-3 md:px-4 py-2 rounded-lg text-sm transition-colors"
              data-testid="btn-buy-now"
            >
              Buy Now
            </a>
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

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-black/95 backdrop-blur-md border-b border-cyan-900/30 py-4 px-4 z-50" data-testid="mobile-menu">
            <div className="flex flex-col gap-3">
              <Link href="/" onClick={() => setIsMobileMenuOpen(false)} className="text-cyan-400 hover:text-cyan-300 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-bets">Bets</Link>
              <Link href="/dashboard" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-dashboard">Dashboard</Link>
              <Link href="/bet-history" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-my-bets">My Bets</Link>
              <Link href="/activity" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-activity">Activity</Link>
              <Link href="/deposits-withdrawals" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-withdraw">Withdraw</Link>
              <Link href="/parlay" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-parlays">Parlays</Link>
              <Link href="/whitepaper" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2" data-testid="mobile-nav-whitepaper">Whitepaper</Link>
            </div>
          </div>
        )}
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
        {/* Search Bar with Favorites Toggle */}
        <div className="mb-4 flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Search teams, leagues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111111] border border-cyan-900/30 rounded-lg py-3 pl-12 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              data-testid="input-search"
            />
          </div>
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all ${
              showFavoritesOnly 
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500' 
                : 'bg-[#111111] text-gray-400 border border-cyan-900/30 hover:text-yellow-400'
            }`}
            data-testid="btn-favorites-filter"
          >
            <Star size={16} fill={showFavoritesOnly ? "currentColor" : "none"} />
            <span className="hidden md:inline">Favorites</span>
            {favorites.size > 0 && (
              <span className="bg-yellow-500/30 text-yellow-400 text-xs px-1.5 py-0.5 rounded-full">
                {favorites.size}
              </span>
            )}
          </button>
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

        {/* Events List - Grouped by League */}
        <div className="space-y-4 pb-24">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-400">Loading events...</p>
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 bg-[#111111] rounded-xl border border-cyan-900/30">
              <p className="text-gray-400 mb-2">No {activeTab} events available</p>
              <p className="text-gray-500 text-sm">
                {showFavoritesOnly ? "Star some teams to see them here!" : "Check back later for more events"}
              </p>
            </div>
          ) : (
            <LeagueGroupedEvents 
              events={events} 
              favorites={favorites} 
              toggleFavorite={toggleFavorite} 
            />
          )}
        </div>
      </div>
      
      {/* Floating Bet Slip Drawer */}
      <FloatingBetSlip 
        isOpen={isBetSlipOpen}
        onToggle={() => setIsBetSlipOpen(!isBetSlipOpen)}
        bets={selectedBets}
        onRemoveBet={removeBet}
        onClearAll={clearBets}
      />
      
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

// League priority for sorting (major leagues first)
const LEAGUE_PRIORITY: Record<string, number> = {
  'Premier League': 1,
  'La Liga': 2,
  'Serie A': 3,
  'Bundesliga': 4,
  'Ligue 1': 5,
  'Champions League': 6,
  'UEFA Champions League': 6,
  'Europa League': 7,
  'UEFA Europa League': 7,
  'FA Cup': 8,
  'Copa del Rey': 9,
  'DFB Pokal': 10,
  'Eredivisie': 11,
  'Liga Portugal': 12,
  'MLS': 13,
};

// Floating Bet Slip Drawer Component
interface FloatingBetSlipProps {
  isOpen: boolean;
  onToggle: () => void;
  bets: any[];
  onRemoveBet: (id: string) => void;
  onClearAll: () => void;
}

function FloatingBetSlip({ isOpen, onToggle, bets, onRemoveBet, onClearAll }: FloatingBetSlipProps) {
  const totalStake = bets.reduce((sum, bet) => sum + (bet.stake || 0), 0);
  const totalPotentialWin = bets.reduce((sum, bet) => sum + ((bet.stake || 0) * (bet.odds || 1)), 0);
  
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      {/* Toggle Bar - Always visible */}
      <button
        onClick={onToggle}
        className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 text-black font-bold px-4 py-3 flex items-center justify-between"
        data-testid="btn-betslip-toggle"
      >
        <div className="flex items-center gap-3">
          <span className="bg-black/20 px-2 py-0.5 rounded-full text-sm">
            {bets.length} {bets.length === 1 ? 'bet' : 'bets'}
          </span>
          <span>Bet Slip</span>
        </div>
        <div className="flex items-center gap-4">
          {bets.length > 0 && (
            <span className="text-sm">
              Potential: {totalPotentialWin.toFixed(2)} SUI
            </span>
          )}
          {isOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </div>
      </button>
      
      {/* Expandable Content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-[#0a0a0a] border-t border-cyan-900/30 overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto p-4">
              {bets.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  No bets added yet. Click on odds to add bets.
                </p>
              ) : (
                <div className="space-y-2">
                  {bets.map((bet, index) => (
                    <div 
                      key={bet.id || index}
                      className="bg-[#111111] rounded-lg p-3 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{bet.eventName}</p>
                        <p className="text-cyan-400 text-xs">{bet.selectionName} @ {bet.odds?.toFixed(2)}</p>
                      </div>
                      <button
                        onClick={() => onRemoveBet(bet.id)}
                        className="text-red-400 hover:text-red-300 p-1"
                        data-testid={`btn-remove-bet-${index}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {bets.length > 0 && (
              <div className="p-4 border-t border-cyan-900/30 flex items-center justify-between">
                <button
                  onClick={onClearAll}
                  className="text-red-400 hover:text-red-300 text-sm"
                  data-testid="btn-clear-bets"
                >
                  Clear All
                </button>
                <Link href="/parlay">
                  <span className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-2 rounded-lg text-sm cursor-pointer">
                    Place Bet
                  </span>
                </Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface LeagueGroupProps {
  leagueName: string;
  events: Event[];
  defaultExpanded?: boolean;
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
}

function LeagueGroup({ leagueName, events, defaultExpanded = false, favorites, toggleFavorite }: LeagueGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  return (
    <div className="bg-[#0a0a0a] rounded-xl border border-cyan-900/20 overflow-hidden">
      {/* League Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-[#111111] hover:bg-[#151515] transition-colors"
        data-testid={`league-header-${leagueName.replace(/\s+/g, '-').toLowerCase()}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-semibold">{leagueName}</span>
          <span className="bg-cyan-500/20 text-cyan-400 text-xs px-2 py-0.5 rounded-full">
            {events.length} {events.length === 1 ? 'match' : 'matches'}
          </span>
        </div>
        <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>
      
      {/* Events List */}
      {isExpanded && (
        <div className="divide-y divide-cyan-900/20">
          {events.map((event, index) => (
            <CompactEventCard 
              key={`${event.sportId}-${event.id}-${index}`} 
              event={event}
              favorites={favorites}
              toggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface LeagueGroupedEventsProps {
  events: Event[];
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
}

function LeagueGroupedEvents({ events, favorites, toggleFavorite }: LeagueGroupedEventsProps) {
  // Group events by league
  const groupedByLeague = events.reduce((acc, event) => {
    const league = event.leagueName || event.league || 'Other';
    if (!acc[league]) {
      acc[league] = [];
    }
    acc[league].push(event);
    return acc;
  }, {} as Record<string, Event[]>);
  
  // Sort leagues by priority (major leagues first)
  const sortedLeagues = Object.keys(groupedByLeague).sort((a, b) => {
    const priorityA = LEAGUE_PRIORITY[a] || 100;
    const priorityB = LEAGUE_PRIORITY[b] || 100;
    if (priorityA !== priorityB) return priorityA - priorityB;
    // If same priority, sort by number of matches (more matches first)
    return groupedByLeague[b].length - groupedByLeague[a].length;
  });
  
  return (
    <div className="space-y-3">
      {sortedLeagues.map((league, index) => (
        <LeagueGroup
          key={league}
          leagueName={league}
          events={groupedByLeague[league]}
          defaultExpanded={index < 3}
          favorites={favorites}
          toggleFavorite={toggleFavorite}
        />
      ))}
    </div>
  );
}

// Team Logo Placeholder Component
function TeamLogo({ teamName }: { teamName: string }) {
  return (
    <div 
      className={`w-6 h-6 rounded-full ${getTeamColor(teamName)} flex items-center justify-center flex-shrink-0`}
      title={teamName}
    >
      <span className="text-white text-[10px] font-bold">{getTeamInitials(teamName)}</span>
    </div>
  );
}

// Odds Movement Indicator Component
function OddsMovement({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'stable') return null;
  return direction === 'up' ? (
    <TrendingUp size={10} className="text-green-400" />
  ) : (
    <TrendingDown size={10} className="text-red-400" />
  );
}

// Props interface for CompactEventCard
interface CompactEventCardProps {
  event: Event;
  favorites: Set<string>;
  toggleFavorite: (teamName: string) => void;
}

// Compact event card for league-grouped view
function CompactEventCard({ event, favorites, toggleFavorite }: CompactEventCardProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const { addBet } = useBetting();
  const { toast } = useToast();
  
  const hasRealOdds = (event as any).oddsSource === 'api-sports';
  const odds = {
    home: event.homeOdds || 2.00,
    draw: event.drawOdds || 3.40,
    away: event.awayOdds || 2.00
  };
  
  // Simulated odds movement (in real app, this would compare to previous odds)
  const getOddsMovement = (oddsValue: number): 'up' | 'down' | 'stable' => {
    // Simple deterministic logic based on odds value for visual effect
    const hash = Math.floor(oddsValue * 100) % 3;
    return hash === 0 ? 'up' : hash === 1 ? 'down' : 'stable';
  };
  
  const score = {
    home: event.homeScore ?? (event.score?.split('-')[0]?.trim() || '0'),
    away: event.awayScore ?? (event.score?.split('-')[1]?.trim() || '0')
  };
  
  const isHomeFavorite = favorites.has(event.homeTeam);
  const isAwayFavorite = favorites.has(event.awayTeam);
  
  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today ${timeStr}`;
      if (isTomorrow) return `Tomorrow ${timeStr}`;
      return date.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) + ' ' + timeStr;
    } catch {
      return '';
    }
  };

  const handleOutcomeClick = (outcome: string) => {
    setSelectedOutcome(selectedOutcome === outcome ? null : outcome);
  };

  const handleQuickBet = () => {
    if (!selectedOutcome) {
      toast({ title: "Select an outcome", description: "Click Home, Draw, or Away to select" });
      return;
    }
    
    const selectedOdds = selectedOutcome === 'home' ? odds.home : selectedOutcome === 'draw' ? odds.draw : odds.away;
    const outcomeName = selectedOutcome === 'home' ? event.homeTeam : selectedOutcome === 'draw' ? 'Draw' : event.awayTeam;
    
    addBet({
      id: `${event.id}-match-winner-${selectedOutcome}`,
      eventId: String(event.id),
      eventName: `${event.homeTeam} vs ${event.awayTeam}`,
      marketId: "match-winner",
      market: "Match Winner",
      selectionId: selectedOutcome,
      selectionName: outcomeName,
      odds: selectedOdds,
    });
    
    toast({ title: "Added to bet slip", description: `${outcomeName} @ ${selectedOdds.toFixed(2)}` });
    setSelectedOutcome(null);
  };
  
  return (
    <div 
      className="px-4 py-3 hover:bg-[#111111] transition-colors relative group" 
      data-testid={`compact-event-${event.id}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center justify-between gap-2 md:gap-4">
        {/* Time / Live indicator */}
        <div className="w-16 md:w-20 flex-shrink-0">
          {event.isLive ? (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              <span className="text-red-400 text-xs font-medium">{event.minute ? `${event.minute}'` : 'LIVE'}</span>
            </div>
          ) : (
            <span className="text-gray-500 text-xs">{formatTime(event.startTime)}</span>
          )}
        </div>
        
        {/* Teams with Logos and Favorites */}
        <div className="flex-1 min-w-0">
          {/* Home Team */}
          <div className="flex items-center gap-2">
            <TeamLogo teamName={event.homeTeam} />
            <span className="text-white text-sm truncate flex-1">{event.homeTeam}</span>
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(event.homeTeam); }}
              className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ visibility: 'visible' }}
              data-testid={`btn-favorite-home-${event.id}`}
            >
              <Star 
                size={14} 
                className={isHomeFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} 
              />
            </button>
            {event.isLive && <span className="text-cyan-400 font-bold text-sm">{score.home}</span>}
          </div>
          {/* Away Team */}
          <div className="flex items-center gap-2 mt-1">
            <TeamLogo teamName={event.awayTeam} />
            <span className="text-gray-400 text-sm truncate flex-1">{event.awayTeam}</span>
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(event.awayTeam); }}
              className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ visibility: 'visible' }}
              data-testid={`btn-favorite-away-${event.id}`}
            >
              <Star 
                size={14} 
                className={isAwayFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'} 
              />
            </button>
            {event.isLive && <span className="text-cyan-400 font-bold text-sm">{score.away}</span>}
          </div>
        </div>
        
        {/* Odds Buttons with Movement Indicators */}
        {hasRealOdds ? (
          <div className="flex gap-1">
            {/* Home Odds */}
            <button
              onClick={() => handleOutcomeClick('home')}
              className={`px-2 md:px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                selectedOutcome === 'home' 
                  ? 'bg-cyan-500 text-black' 
                  : 'bg-[#1a1a1a] text-cyan-400 hover:bg-[#222]'
              }`}
              data-testid={`compact-odds-home-${event.id}`}
            >
              <OddsMovement direction={getOddsMovement(odds.home)} />
              {odds.home.toFixed(2)}
            </button>
            {/* Draw Odds */}
            <button
              onClick={() => handleOutcomeClick('draw')}
              className={`px-2 md:px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                selectedOutcome === 'draw' 
                  ? 'bg-yellow-500 text-black' 
                  : 'bg-[#1a1a1a] text-yellow-400 hover:bg-[#222]'
              }`}
              data-testid={`compact-odds-draw-${event.id}`}
            >
              <OddsMovement direction={getOddsMovement(odds.draw)} />
              {odds.draw.toFixed(2)}
            </button>
            {/* Away Odds */}
            <button
              onClick={() => handleOutcomeClick('away')}
              className={`px-2 md:px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                selectedOutcome === 'away' 
                  ? 'bg-cyan-500 text-black' 
                  : 'bg-[#1a1a1a] text-white hover:bg-[#222]'
              }`}
              data-testid={`compact-odds-away-${event.id}`}
            >
              <OddsMovement direction={getOddsMovement(odds.away)} />
              {odds.away.toFixed(2)}
            </button>
            {selectedOutcome && (
              <button
                onClick={handleQuickBet}
                className="px-2 py-1.5 bg-green-500 hover:bg-green-600 text-black rounded text-xs font-bold transition-all"
                data-testid={`compact-bet-${event.id}`}
              >
                +
              </button>
            )}
          </div>
        ) : (
          <span className="text-gray-600 text-xs">No odds</span>
        )}
        
        {/* Match Info Tooltip */}
        <button 
          className="p-1 text-gray-600 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"
          title={`${event.leagueName || ''} - Click for match details`}
          data-testid={`btn-info-${event.id}`}
        >
          <Info size={14} />
        </button>
      </div>
      
      {/* Match Stats Preview Tooltip */}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 bg-[#1a1a1a] border border-cyan-900/40 rounded-lg p-3 z-50 min-w-[200px] shadow-xl"
          >
            <div className="text-xs space-y-2">
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">League:</span>
                <span className="text-white">{event.leagueName || 'Unknown'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Start:</span>
                <span className="text-white">{formatTime(event.startTime)}</span>
              </div>
              {hasRealOdds && (
                <>
                  <div className="border-t border-cyan-900/30 pt-2 mt-2">
                    <span className="text-cyan-400 font-medium">Quick Stats</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-400">Home Win:</span>
                    <span className="text-green-400">{((1/odds.home)*100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-400">Draw:</span>
                    <span className="text-yellow-400">{((1/odds.draw)*100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-400">Away Win:</span>
                    <span className="text-cyan-400">{((1/odds.away)*100).toFixed(0)}%</span>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
  
  // Check if this event has real odds from API (betting enabled)
  const hasRealOdds = (event as any).oddsSource === 'api-sports';

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
            {hasRealOdds ? (
              <>
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
              </>
            ) : (
              <div className="bg-[#1a1a1a] rounded-lg p-3 text-center">
                <div className="text-gray-500 text-xs mb-1">Odds</div>
                <div className="text-gray-400 text-sm font-medium">Not Available</div>
              </div>
            )}
          </div>
        </div>

        {/* Bet Button */}
        <div className="flex justify-center mb-4">
          {hasRealOdds ? (
            <>
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
            </>
          ) : (
            <div className="text-gray-500 text-sm py-2">
              Betting unavailable - no bookmaker coverage
            </div>
          )}
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