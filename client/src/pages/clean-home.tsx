import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Search, Clock, TrendingUp, TrendingDown, Wallet, LogOut, RefreshCw, Menu, X, Star, ChevronUp, ChevronDown, Trash2, Info, MoreHorizontal, FileText, Activity, ArrowUpDown, Target, Trophy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuiNSName from '@/components/SuiNSName';
import sportMarketsAdapter from "@/lib/sportMarketsAdapter";
import { useBetting } from "@/context/BettingContext";
import { useToast } from "@/hooks/use-toast";
import { useCurrentAccount, useDisconnectWallet, useSuiClientQuery } from "@mysten/dapp-kit";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import Footer from "@/components/layout/Footer";
import { useLiveEvents, useUpcomingEvents } from "@/hooks/useEvents";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import suibetsHeroImage from "../assets/images/hero-banner.png";

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

const suibetsLogo = "/images/suibets-logo.png";
const suibetsHeroBg = "/images/hero-bg.png";

// Sport IDs MUST match database: 1=Soccer, 2=Basketball, 3=Tennis, 4=American Football, 5=Baseball, 6=Ice Hockey, 7=MMA/Boxing, 9=Esports
// New sports: 10=AFL, 11=Formula 1, 12=Handball, 14=NFL, 15=Rugby, 16=Volleyball
// Note: NBA games are included in Basketball (sportId 2). Boxing merged into MMA (sportId 7).
const SPORTS_LIST = [
  { id: 1, name: "Football", icon: "⚽" },
  { id: 2, name: "Basketball", icon: "🏀" },
  { id: 6, name: "Hockey", icon: "🏒" },
  { id: 5, name: "Baseball", icon: "⚾" },
  { id: 16, name: "Volleyball", icon: "🏐" },
  { id: 12, name: "Handball", icon: "🤾" },
  { id: 15, name: "Rugby", icon: "🏉" },
  { id: 24, name: "Esports", icon: "🎮" },
  { id: 7, name: "MMA", icon: "🥊" },
  { id: 18, name: "Horse Racing", icon: "🏇" },
  { id: 17, name: "Boxing", icon: "🥊" },
  { id: 11, name: "Formula 1", icon: "🏎️" },
  { id: 19, name: "MotoGP", icon: "🏍️" },
  { id: 9, name: "Cricket", icon: "🏏" },
  { id: 3, name: "Tennis", icon: "🎾" },
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
  const [showOddsOnly, setShowOddsOnly] = useState(false); // Default to showing all matches, toggle ON to filter
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

  // Fetch promotion status
  const { data: promotionData } = useQuery<{
    success: boolean;
    promotion: {
      isActive: boolean;
      totalBetUsd: number;
      bonusBalance: number;
      nextBonusAt: number;
      progressPercent: number;
      thresholdUsd: number;
      bonusUsd: number;
      promotionEnd: string;
    };
  }>({
    queryKey: [`/api/promotion/status?wallet=${walletAddress}`],
    enabled: !!walletAddress,
    refetchInterval: 60000,
  });

  const promotion = promotionData?.promotion;
  const disconnect = () => disconnectWallet();

  const { data: liveEvents = [], isLoading: liveLoading, refetch: refetchLive } = useLiveEvents(selectedSport);
  const { data: upcomingEvents = [], isLoading: upcomingLoading, refetch: refetchUpcoming } = useUpcomingEvents(selectedSport);

  const { data: allUpcomingForCounts = [] } = useQuery<any[]>({
    queryKey: ['events', 'upcoming', 'counts'],
    queryFn: async () => {
      const response = await fetch('/api/events?isLive=false', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch events for counts');
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60000,
    gcTime: 120000,
    refetchOnWindowFocus: false,
  });
  const sportEventCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    allUpcomingForCounts.forEach((e: any) => {
      const sid = e.sportId;
      if (sid) counts[sid] = (counts[sid] || 0) + 1;
    });
    return counts;
  }, [allUpcomingForCounts]);

  const rawEvents = activeTab === "live" ? liveEvents : upcomingEvents;
  const isLoading = activeTab === "live" ? liveLoading : upcomingLoading;
  
  // Filter events based on search query, favorites, and odds availability
  const events = useMemo(() => {
    let filtered = rawEvents;
    
    // Odds filter - only show matches with real bookmaker odds
    if (showOddsOnly) {
      filtered = filtered.filter((e: Event) => 
        e.homeOdds && e.awayOdds && e.homeOdds > 0 && e.awayOdds > 0
      );
    }
    
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
  }, [rawEvents, searchQuery, showFavoritesOnly, showOddsOnly, favorites]);

  const handleSportClick = (sportId: number) => {
    setSelectedSport(sportId);
    // Non-football sports only have "Upcoming" (no live betting)
    // Football (sportId === 1) is the only sport with live betting
    if (sportId !== 1) {
      setActiveTab("upcoming");
    }
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
            <Link href="/network" className="text-yellow-400 hover:text-yellow-300 transition-colors text-sm font-bold flex items-center gap-1" data-testid="nav-predict">Predict<span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" /></Link>
            <Link href="/dashboard" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-dashboard">Dashboard</Link>
            <Link href="/bet-history" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-my-bets">My Bets</Link>
            <Link href="/promotions" className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium" data-testid="nav-promotions">Promotions</Link>
            <Link href="/revenue" className="text-yellow-400 hover:text-yellow-300 transition-colors text-sm font-bold" data-testid="nav-revenue">Revenue</Link>
            <Link href="/staking" className="text-cyan-400 hover:text-cyan-300 transition-colors text-sm font-medium" data-testid="nav-staking">Staking</Link>
            <DropdownMenu>
              <DropdownMenuTrigger className="text-gray-400 hover:text-cyan-400 transition-colors text-sm font-medium flex items-center gap-1 outline-none" data-testid="nav-more">
                More
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-[#0b1618] border border-cyan-900/30 min-w-[180px] z-[9999]">
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/streaming')} data-testid="nav-more-streaming">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Streaming
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/leaderboard')} data-testid="nav-more-leaderboard">
                  <Trophy className="h-4 w-4 mr-2" />
                  Leaderboard
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/results')} data-testid="nav-more-activity">
                  <Activity className="h-4 w-4 mr-2" />
                  Activity
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/parlay')} data-testid="nav-more-parlays">
                  <Target className="h-4 w-4 mr-2" />
                  Parlays
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/deposits-withdrawals')} data-testid="nav-more-withdraw">
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  Withdraw
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer text-gray-200 hover:text-white flex items-center px-4 py-3 text-sm" onClick={() => setLocation('/whitepaper')} data-testid="nav-more-whitepaper">
                  <FileText className="h-4 w-4 mr-2" />
                  Whitepaper
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                  <div className="text-gray-500 text-xs"><SuiNSName address={walletAddress} className="text-gray-500 text-xs" /></div>
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
              <Link href="/network" onClick={() => setIsMobileMenuOpen(false)} className="text-yellow-400 hover:text-yellow-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-predict">Predict</Link>
              <Link href="/dashboard" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-dashboard">Dashboard</Link>
              <Link href="/bet-history" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-my-bets">My Bets</Link>
              <Link href="/promotions" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-promotions">Promotions</Link>
              <Link href="/revenue" onClick={() => setIsMobileMenuOpen(false)} className="text-yellow-400 hover:text-yellow-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-revenue">Revenue</Link>
              <Link href="/staking" onClick={() => setIsMobileMenuOpen(false)} className="text-cyan-400 hover:text-cyan-300 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-staking">Staking</Link>
              <Link href="/streaming" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-streaming">Streaming</Link>
              <Link href="/leaderboard" onClick={() => setIsMobileMenuOpen(false)} className="text-yellow-400 hover:text-yellow-300 transition-colors text-base font-bold py-2 border-b border-cyan-900/20" data-testid="mobile-nav-leaderboard">Leaderboard</Link>
              <Link href="/results" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-activity">Activity</Link>
              <Link href="/parlay" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-parlays">Parlays</Link>
              <Link href="/deposits-withdrawals" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2 border-b border-cyan-900/20" data-testid="mobile-nav-withdraw">Withdraw</Link>
              <Link href="/whitepaper" onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400 hover:text-cyan-400 transition-colors text-base font-medium py-2" data-testid="mobile-nav-whitepaper">Whitepaper</Link>
            </div>
          </div>
        )}
      </nav>

      {/* Promotion Banner */}
      {promotion?.isActive && (
        <div className="bg-gradient-to-r from-yellow-600 via-orange-500 to-yellow-600 text-black py-2 px-4" data-testid="promo-banner">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-2 text-sm md:text-base font-bold">
            <span>🎁 LIMITED PROMO:</span>
            <span>Bet ${promotion.thresholdUsd} → Get ${promotion.bonusUsd} FREE!</span>
            <span className="text-xs md:text-sm opacity-80">
              Progress: ${(promotion.totalBetUsd % promotion.thresholdUsd).toFixed(2)}/${promotion.thresholdUsd}
            </span>
            <div className="w-20 h-2 bg-black/30 rounded-full overflow-hidden">
              <div 
                className="h-full bg-white transition-all" 
                style={{ width: `${promotion.progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Hero Banner */}
      <div className="relative w-full" data-testid="hero-banner">
        <img
          src={suibetsHeroImage}
          alt="SuiBets - Sports Betting on Sui Blockchain"
          draggable={false}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0a0e1a] to-transparent pointer-events-none"></div>
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
          <button
            onClick={() => setShowOddsOnly(!showOddsOnly)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all ${
              showOddsOnly 
                ? 'bg-green-500/20 text-green-400 border border-green-500' 
                : 'bg-[#111111] text-gray-400 border border-cyan-900/30 hover:text-green-400'
            }`}
            data-testid="btn-odds-filter"
          >
            <TrendingUp size={16} />
            <span className="hidden md:inline">With Odds</span>
          </button>
        </div>

        {/* Sports - Horizontal scroll on mobile, wrapping grid on desktop */}
        <div className="mb-4 overflow-x-auto md:overflow-visible pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
          <div className="flex gap-2 md:flex-wrap md:gap-3 w-max md:w-auto">
            {SPORTS_LIST.map((sport) => {
              const count = sportEventCounts[sport.id] || 0;
              return (
                <button
                  key={sport.id}
                  onClick={() => handleSportClick(sport.id)}
                  className={`py-2 px-3 md:py-3 md:px-4 rounded-lg whitespace-nowrap text-sm md:text-base transition-all flex-shrink-0 md:flex-shrink ${
                    selectedSport === sport.id
                      ? "bg-cyan-500 text-black font-bold"
                      : count > 0
                        ? "bg-[#111111] text-gray-300 hover:bg-[#1a1a1a] border border-cyan-900/30"
                        : "bg-[#0a0a0a] text-gray-500 hover:bg-[#111111] border border-gray-800/30"
                  }`}
                  data-testid={`sport-btn-${sport.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <span className="mr-1 md:mr-2">{sport.icon}</span>
                  {sport.name}
                  {count > 0 && (
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                      selectedSport === sport.id ? "bg-black/20 text-black" : "bg-cyan-900/40 text-cyan-400"
                    }`} data-testid={`sport-count-${sport.id}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live / Upcoming Tabs - Live only available for Football (sportId 1) */}
        <div ref={matchesSectionRef} className="flex gap-2 mb-4 scroll-mt-4">
          {/* Live tab - Only for Football (sportId === 1) */}
          {selectedSport === 1 && (
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
          )}
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

        {selectedSport === 18 && events.length > 0 && (
          <div className="bg-[#0d1117] rounded-xl border border-cyan-900/20 px-4 py-3 mb-4" data-testid="horse-racing-explainer">
            <div className="flex items-start gap-3">
              <span className="text-lg mt-0.5">🏇</span>
              <div className="text-xs text-gray-400 leading-relaxed">
                <span className="text-white font-semibold">How to bet: </span>
                <span className="text-cyan-400 font-semibold">Win</span> = horse finishes 1st
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-emerald-400 font-semibold">Place</span> = horse finishes top 2
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-amber-400 font-semibold">Show</span> = horse finishes top 3
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-gray-500">Easier bets pay less, riskier bets pay more.</span>
              </div>
            </div>
          </div>
        )}

        {(selectedSport === 11 || selectedSport === 19) && events.length > 0 && (
          <div className="bg-[#0d1117] rounded-xl border border-cyan-900/20 px-4 py-3 mb-4" data-testid="motorsport-explainer">
            <div className="flex items-start gap-3">
              <span className="text-lg mt-0.5">{selectedSport === 11 ? '🏎️' : '🏍️'}</span>
              <div className="text-xs text-gray-400 leading-relaxed">
                <span className="text-white font-semibold">How to bet: </span>
                <span className="text-cyan-400 font-semibold">Win</span> = finishes 1st
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-emerald-400 font-semibold">Top 2</span> = finishes 1st or 2nd
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-amber-400 font-semibold">Podium</span> = finishes top 3
                <span className="text-gray-600 mx-1.5">|</span>
                <span className="text-gray-500">Safer bets pay less, riskier bets pay more.</span>
              </div>
            </div>
          </div>
        )}

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
                {showFavoritesOnly ? "Star some teams to see them here!" : 
                  selectedSport === 11 ? "Formula 1 races update weekly. Check back closer to race weekend!" :
                  selectedSport === 17 ? "Boxing fights update weekly. Check back closer to fight night!" :
                  selectedSport === 24 ? "No esports matches scheduled right now. Check back soon!" :
                  selectedSport === 3 ? "Tennis events coming soon!" :
                  selectedSport === 7 ? "MMA / Boxing fights update weekly. Check back closer to fight night!" :
                  selectedSport === 18 ? "Horse Racing events appear closer to race times!" :
                  "Check back later for more events"}
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
  const [stake, setStake] = useState<string>('');
  const [, setLocation] = useLocation();
  
  // Calculate combined parlay odds (multiply all individual odds)
  const combinedOdds = useMemo(() => {
    if (bets.length === 0) return 0;
    if (bets.length === 1) return bets[0].odds || 1;
    return bets.reduce((acc, bet) => acc * (bet.odds || 1), 1);
  }, [bets]);
  
  // Calculate potential winnings based on stake
  const stakeNum = parseFloat(stake) || 0;
  const potentialWin = stakeNum * combinedOdds;
  
  // Handle place bet - navigates to parlay page with stake pre-filled
  const handlePlaceBet = () => {
    if (bets.length === 0) return;
    // Store stake in session storage for parlay page to pick up
    if (stake) {
      sessionStorage.setItem('parlayStake', stake);
    }
    setLocation('/parlay');
  };
  
  const isParlay = bets.length > 1;
  
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
          <span>{isParlay ? 'Parlay Slip' : 'Bet Slip'}</span>
        </div>
        <div className="flex items-center gap-4">
          {bets.length > 0 && (
            <span className="text-sm">
              {isParlay ? `Combined: ${combinedOdds.toFixed(2)}` : `Odds: ${combinedOdds.toFixed(2)}`}
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
            <div className="max-h-48 overflow-y-auto p-4">
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
              <div className="p-4 border-t border-cyan-900/30 space-y-3">
                {/* Stake Input */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-gray-400 text-xs mb-1 block">Stake (SUI)</label>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Enter stake..."
                      className="w-full bg-[#111111] border border-cyan-900/30 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      data-testid="input-stake"
                      min="0"
                      step="0.1"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-gray-400 text-xs mb-1 block">Potential Win</label>
                    <div className="bg-[#111111] border border-cyan-900/30 rounded-lg px-3 py-2 text-green-400 text-sm font-bold">
                      {potentialWin > 0 ? `${potentialWin.toFixed(2)} SUI` : '-'}
                    </div>
                  </div>
                </div>
                
                {/* Combined Odds Display for Parlay */}
                {isParlay && (
                  <div className="flex items-center justify-between text-sm bg-[#111111] rounded-lg p-2">
                    <span className="text-gray-400">Combined Odds ({bets.length} legs)</span>
                    <span className="text-cyan-400 font-bold">{combinedOdds.toFixed(2)}</span>
                  </div>
                )}
                
                {/* Actions */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={onClearAll}
                    className="text-red-400 hover:text-red-300 text-sm"
                    data-testid="btn-clear-bets"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={handlePlaceBet}
                    disabled={bets.length === 0}
                    className="bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-bold px-6 py-2 rounded-lg text-sm"
                    data-testid="btn-place-bet"
                  >
                    {isParlay ? `Place Parlay (${bets.length} legs)` : 'Place Bet'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RaceEventCard({ event }: { event: Event }) {
  const { addBet } = useBetting();
  const { toast } = useToast();
  const allMarkets = (event as any).markets || [];
  const winMarket = allMarkets.find((m: any) => m.id === 'race_winner') || allMarkets[0];
  const placeMarket = allMarkets.find((m: any) => m.id === 'race_place');
  const showMarket = allMarkets.find((m: any) => m.id === 'race_show');
  const runners = winMarket?.outcomes || [];
  const runnersInfo = (event as any).runnersInfo || [];
  const raceDetails = (event as any).raceDetails;
  const isHorseRacing = event.sportId === 18;
  const isMotorsport = event.sportId === 11 || event.sportId === 19;
  const hasWPS = (isHorseRacing || isMotorsport) && placeMarket && showMarket;

  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return timeStr;
      if (isTomorrow) return `Tomorrow\n${timeStr}`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + '\n' + timeStr;
    } catch { return ''; }
  };

  const handleRunnerBet = (runner: any, idx: number, marketType: string, marketId: string, odds: number) => {
    addBet({
      id: `${event.id}-${marketId}-${runner.id || idx}`,
      eventId: String(event.id),
      eventName: `${event.homeTeam}`,
      marketId,
      market: marketType,
      outcomeId: runner.id || `runner_${idx}`,
      selectionId: runner.id || `runner_${idx}`,
      selectionName: runner.name || `Runner ${idx + 1}`,
      odds,
      homeTeam: event.homeTeam,
      awayTeam: runner.name,
      isLive: false,
    });
    toast({ title: "Added to bet slip", description: `${runner.name} ${marketType} @ ${odds.toFixed(2)}` });
  };

  return (
    <div className="px-4 py-3" data-testid={`horse-race-${event.id}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-16 md:w-20 flex-shrink-0 text-gray-500 text-xs whitespace-pre-line">
          {formatTime(event.startTime)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-semibold truncate">{event.homeTeam}</div>
          <div className="text-gray-500 text-xs">{event.awayTeam}</div>
          {raceDetails && (
            <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-600 flex-wrap">
              {raceDetails.surface && <span>{raceDetails.surface}</span>}
              {raceDetails.distance && <><span>•</span><span>{raceDetails.distance}</span></>}
              {raceDetails.going && <><span>•</span><span>{raceDetails.going}</span></>}
              {raceDetails.prize && <><span>•</span><span>{raceDetails.prize}</span></>}
              <span>•</span>
              <span>{raceDetails.fieldSize || runners.length} {(event.sportId === 11 || event.sportId === 19) ? 'riders' : 'runners'}</span>
            </div>
          )}
        </div>
      </div>

      {hasWPS && (
        <div className="flex items-center justify-end gap-1 mb-1 ml-0 md:ml-[80px] pr-3">
          <div className="flex-1" />
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">Win</span>
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">{isMotorsport ? 'Top 2' : 'Place'}</span>
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider min-w-[48px] text-center">{isMotorsport ? 'Podium' : 'Show'}</span>
        </div>
      )}

      <div className="space-y-1 ml-0 md:ml-[80px]">
        {runners.map((runner: any, idx: number) => {
          const info = runnersInfo[idx];
          const placeOdds = placeMarket?.outcomes?.[idx]?.odds;
          const showOdds = showMarket?.outcomes?.[idx]?.odds;
          return (
            <div
              key={runner.id || idx}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#111111] border border-cyan-900/10 hover:border-cyan-500/30 hover:bg-[#151515] transition-all group/runner"
              data-testid={`runner-row-${event.id}-${idx}`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-cyan-400 font-bold text-xs w-5 text-center">{info?.number || idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-white text-sm font-medium">{runner.name}</span>
                  {info && (
                    <span className="text-gray-500 text-[10px] ml-2">
                      {(event.sportId === 11 || event.sportId === 19) ? (info.jockey || '') : `J: ${info.jockey || 'TBA'}${info.trainer ? ` / ${info.trainer}` : ''}`}
                    </span>
                  )}
                </div>
                {info?.form && event.sportId !== 11 && event.sportId !== 19 && (
                  <span className="text-yellow-400/60 text-[10px] font-mono bg-yellow-400/5 px-1.5 py-0.5 rounded hidden md:inline">
                    {info.form}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => handleRunnerBet(runner, idx, 'Win', 'race_winner', runner.odds)}
                  className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-cyan-400 hover:bg-cyan-500 hover:text-black transition-all min-w-[48px] text-center"
                  data-testid={`odds-win-${event.id}-${idx}`}
                >
                  {runner.odds?.toFixed(2) || 'N/A'}
                </button>
                {hasWPS && (
                  <>
                    <button
                      onClick={() => placeOdds && handleRunnerBet(runner, idx, isMotorsport ? 'Top 2' : 'Place', 'race_place', placeOdds)}
                      className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all min-w-[48px] text-center"
                      data-testid={`odds-place-${event.id}-${idx}`}
                      disabled={!placeOdds}
                    >
                      {placeOdds?.toFixed(2) || 'N/A'}
                    </button>
                    <button
                      onClick={() => showOdds && handleRunnerBet(runner, idx, isMotorsport ? 'Podium' : 'Show', 'race_show', showOdds)}
                      className="px-2 py-1.5 rounded text-xs font-bold bg-[#1a1a1a] text-amber-400 hover:bg-amber-500 hover:text-black transition-all min-w-[48px] text-center"
                      data-testid={`odds-show-${event.id}-${idx}`}
                      disabled={!showOdds}
                    >
                      {showOdds?.toFixed(2) || 'N/A'}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
            (event.sportId === 18 || event.sportId === 11 || event.sportId === 19) ? (
              <RaceEventCard
                key={`${event.sportId}-${event.id}-${index}`}
                event={event}
              />
            ) : (
              <CompactEventCard 
                key={`${event.sportId}-${event.id}-${index}`} 
                event={event}
                favorites={favorites}
                toggleFavorite={toggleFavorite}
              />
            )
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
  const [showMoreMarkets, setShowMoreMarkets] = useState(false);
  const { addBet } = useBetting();
  const { toast } = useToast();
  
  // Calculate these values FIRST so they are available for helpers and memo
  const minuteNum = useMemo(() => {
    if (!event || !event.minute) return 0;
    try {
      const minStr = String(event.minute).replace(/[^0-9]/g, '');
      return minStr ? parseInt(minStr, 10) : 0;
    } catch (e) {
      console.error("Error parsing minute:", e);
      return 0;
    }
  }, [event?.minute]);

  const isBettingClosed = useMemo(() => {
    return !!(event?.isLive && minuteNum >= 45);
  }, [event?.isLive, minuteNum]);

  // Helper to check if a market is closed based on match minute
  const isMarketClosed = useCallback((marketId: any) => {
    if (!event?.isLive || !marketId) return false;
    try {
      const marketStr = String(marketId).toLowerCase();
      const isFirstHalf = marketStr.includes('1st_half') || 
                         marketStr.includes('1st-half') ||
                         marketStr.includes('first_half') ||
                         marketStr.includes('first-half') ||
                         marketStr.includes('half_time_result') ||
                         marketStr.includes('half-time-result') ||
                         marketStr === '4';
      
      if (isFirstHalf && minuteNum >= 45) return true;
      
      // In live matches: only Match Winner (win/draw/lose) is allowed, block everything else
      const isMatchWinner = marketStr.includes('match_winner') || marketStr.includes('match-winner') ||
                            marketStr.includes('match_result') || marketStr.includes('match-result') ||
                            marketStr === 'match winner' || marketStr === 'match result';
      if (!isMatchWinner) return true;
      
      // Block all markets after minute 45 (live betting only in first half)
      if (minuteNum >= 45) return true;
    } catch (e) {
      console.error("Error in isMarketClosed:", e);
    }
    return false;
  }, [event?.isLive, minuteNum]);

  // Get secondary markets for this event (BTTS, Double Chance, etc.) - NOT available for live matches
  const secondaryMarkets = useMemo(() => {
    if (!event || event.sportId !== 1) return [];
    if (event.isLive) return [];
    try {
      // Get current total goals for filtering decided Over/Under markets
      const homeGoals = parseInt(String(event.homeScore ?? (event.score?.split('-')[0]?.trim() || '0'))) || 0;
      const awayGoals = parseInt(String(event.awayScore ?? (event.score?.split('-')[1]?.trim() || '0'))) || 0;
      const totalGoals = homeGoals + awayGoals;
      const isLive = event.isLive || false;
      
      return sportMarketsAdapter.getDefaultMarkets(1, event.homeTeam, event.awayTeam)
        .slice(1)
        .filter(m => !isMarketClosed(m.id))
        .map(market => {
          const marketName = market.name?.toLowerCase() || '';
          
          // Filter Over/Under markets for live events
          if (isLive && totalGoals > 0 && (marketName.includes('over') || marketName.includes('under') || marketName.includes('goals'))) {
            // Extract threshold from market name (e.g., "Over/Under 2.5 Goals" -> 2.5)
            const thresholdMatch = marketName.match(/(\d+\.?\d*)/);
            const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : null;
            
            // If threshold is exceeded, remove this market entirely
            if (threshold !== null && totalGoals > threshold) {
              return null; // Market is decided - remove it
            }
            
            // Also filter individual outcomes
            const filteredOutcomes = market.outcomes.filter(outcome => {
              const outcomeName = outcome.name?.toLowerCase() || '';
              const outcomeMatch = outcomeName.match(/(over|under)\s*(\d+\.?\d*)/i);
              if (!outcomeMatch) return true;
              
              const outcomeThreshold = parseFloat(outcomeMatch[2]);
              // If goals > threshold, both Over (won) and Under (lost) are decided
              return !(totalGoals > outcomeThreshold);
            });
            
            if (filteredOutcomes.length === 0) return null;
            return { ...market, outcomes: filteredOutcomes };
          }
          
          return market;
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
    } catch (e) {
      console.error("Error generating secondary markets:", e);
      return [];
    }
  }, [event?.id, event?.homeTeam, event?.awayTeam, event?.sportId, event?.homeScore, event?.awayScore, event?.score, event?.isLive, minuteNum, isMarketClosed]);
  
  const hasRealOdds = !!(event?.homeOdds !== null && event?.homeOdds !== undefined && event?.homeOdds > 0)
    || ((event as any).oddsSource === 'live-fallback');
  const odds = {
    home: event?.homeOdds || null,
    draw: event?.drawOdds || null,
    away: event?.awayOdds || null
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
      outcomeId: selectedOutcome,
      selectionId: selectedOutcome,
      selectionName: outcomeName,
      odds: selectedOdds,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      isLive: event.isLive || false,
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
        {isBettingClosed ? (
          <div className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 border border-red-800/50 rounded">
            <Clock size={12} className="text-red-400" />
            <span className="text-red-400 text-xs font-medium">Betting closed</span>
          </div>
        ) : hasRealOdds ? (
          <div className="flex gap-1">
            {/* Home Odds */}
            {odds.home && (
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
            )}
            {/* Draw Odds - only for sports with draws (e.g., football) */}
            {odds.draw && (
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
            )}
            {/* Away Odds */}
            {odds.away && (
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
            )}
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
                  {odds.home && (
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Home Win:</span>
                      <span className="text-green-400">{((1/odds.home)*100).toFixed(0)}%</span>
                    </div>
                  )}
                  {odds.draw && (
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Draw:</span>
                      <span className="text-yellow-400">{((1/odds.draw)*100).toFixed(0)}%</span>
                    </div>
                  )}
                  {odds.away && (
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">Away Win:</span>
                      <span className="text-cyan-400">{((1/odds.away)*100).toFixed(0)}%</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* More Markets Button and Expandable Section */}
      {secondaryMarkets.length > 0 && hasRealOdds && (
        <>
          <button
            onClick={() => setShowMoreMarkets(!showMoreMarkets)}
            className="w-full mt-2 py-1.5 flex items-center justify-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors border-t border-cyan-900/20"
            data-testid={`btn-more-markets-${event.id}`}
          >
            <MoreHorizontal size={14} />
            <span>{showMoreMarkets ? 'Hide Markets' : `+${secondaryMarkets.length} More Markets`}</span>
            {showMoreMarkets ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          
          <AnimatePresence>
            {showMoreMarkets && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 py-3 bg-[#0a0a0a] space-y-3">
                  {secondaryMarkets.map((market) => (
                    <div key={market.id} className="space-y-2">
                      <div className="text-xs text-gray-400 font-medium">{market.name}</div>
                      <div className="flex flex-wrap gap-1">
                        {market.outcomes.map((outcome) => (
                          <button
                            key={outcome.id}
                            onClick={() => {
                              addBet({
                                id: `${event.id}-${market.id}-${outcome.id}`,
                                eventId: String(event.id),
                                eventName: `${event.homeTeam} vs ${event.awayTeam}`,
                                marketId: String(market.id),
                                market: market.name,
                                outcomeId: String(outcome.id),
                                selectionId: String(outcome.id),
                                selectionName: outcome.name,
                                odds: outcome.odds,
                                homeTeam: event.homeTeam,
                                awayTeam: event.awayTeam,
                                isLive: event.isLive || false,
                              });
                              toast({ 
                                title: "Added to bet slip", 
                                description: `${market.name}: ${outcome.name} @ ${outcome.odds.toFixed(2)}` 
                              });
                            }}
                            className="px-2 py-1 bg-[#1a1a1a] hover:bg-[#222] text-xs rounded transition-colors"
                            data-testid={`btn-market-${market.id}-${outcome.id}-${event.id}`}
                          >
                            <span className="text-gray-400">{outcome.name}</span>
                            <span className="ml-1 text-cyan-400 font-medium">{outcome.odds.toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
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
  
  // Check if this event has real odds from API or live fallback odds (betting enabled)
  const hasRealOdds = (event as any).oddsSource === 'api-sports' || (event as any).oddsSource === 'live-fallback';
  
  // Check if live match is past 45 minutes (betting closed)
  const getMatchMinute = (): number | null => {
    const eventAny = event as any;
    if (eventAny.minute !== undefined && eventAny.minute !== null) {
      const min = parseInt(String(eventAny.minute));
      if (!isNaN(min)) return min;
    }
    if (eventAny.matchMinute !== undefined && eventAny.matchMinute !== null) {
      const min = parseInt(String(eventAny.matchMinute));
      if (!isNaN(min)) return min;
    }
    // Try to extract from status string like "75'" or "HT"
    if (typeof eventAny.status === 'string') {
      const match = eventAny.status.match(/(\d+)/);
      if (match) return parseInt(match[1]);
      if (eventAny.status === 'HT') return 45;
      if (eventAny.status.includes('2H')) return 46;
    }
    return null;
  };
  
  const matchMinute = getMatchMinute();
  const isLiveMatch = event.isLive || event.status?.toLowerCase().includes('live') || 
                      event.status?.includes('H') || event.status?.includes("'");
  const isBettingClosed = isLiveMatch && matchMinute !== null && matchMinute >= 45;

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
    // Block selections if betting is closed (past 45 minutes)
    if (isBettingClosed) {
      toast({
        title: "Betting Closed",
        description: "Live betting is only available during the first 45 minutes",
        variant: "destructive",
      });
      return;
    }
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
        marketId: "match-result",
        market: "Match Result",
        outcomeId: selectedOutcome,
        selectionName,
        odds: selectedOdds,
        stake: parseFloat(stake) || 10,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
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
                {odds.home && (
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
                )}
                {odds.draw && (
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
                )}
                {odds.away && (
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
                )}
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
          {isBettingClosed ? (
            <div className="bg-red-900/30 border border-red-500/40 rounded-lg px-4 py-2 text-center">
              <span className="text-red-400 font-bold text-sm">Betting Closed</span>
              <span className="text-red-400/70 text-xs block">Match past 45 minutes</span>
            </div>
          ) : hasRealOdds ? (
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
            {odds.home && odds.away && (
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
            )}

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