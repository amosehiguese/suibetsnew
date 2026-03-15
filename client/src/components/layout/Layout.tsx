import React, { ReactNode, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { 
  Home, TrendingUp, Megaphone, Bell, Settings, 
  Clock, Wallet, ChevronLeft, Landmark, 
  TrendingDown, Trophy, MenuIcon, MessageCircle, Gift, Star, Target,
  MoreHorizontal, FileText, Activity, ArrowUpDown
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConnectWalletModal } from '@/components/modals/ConnectWalletModal';
const suibetsBackground = `${import.meta.env.VITE_API_BASE_URL || ''}/images/suibets-background.png`;
const suibetsLogo = "/images/suibets-logo.jpg";

export interface LayoutProps {
  children: ReactNode;
  title?: string;
  showBackButton?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  title, 
  showBackButton = false
}) => {
  const [location, setLocation] = useLocation();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const currentAccount = useCurrentAccount();
  
  // Fetch promotion status
  const { data: promotionData } = useQuery<{
    isActive: boolean;
    bonusBalance: number;
    totalBetUsd: number;
    thresholdUsd: number;
  }>({
    queryKey: ['/api/promotion/status', currentAccount?.address],
    queryFn: async () => {
      const res = await fetch(`/api/promotion/status?wallet=${currentAccount?.address}`);
      if (!res.ok) throw new Error('Failed to fetch promotion status');
      return res.json();
    },
    enabled: !!currentAccount?.address,
    refetchInterval: 60000, // Reduced from 15s to conserve API
  });
  
  // Fetch upcoming events for the ticker
  const { data: upcomingEvents = [] } = useQuery<any[]>({
    queryKey: ['/api/events', 'upcoming'],
    refetchInterval: 120000 // Refresh every 2 minutes (reduced from 30s to conserve API)
  });
  
  // Format upcoming events for ticker display
  const getTickerText = () => {
    if (!upcomingEvents || upcomingEvents.length === 0) {
      return '🏆 Loading latest matches... | ⚽ Check back soon for upcoming games! | 🎾 Live betting on all major sports | 🏀 Real-time odds updates | 🏒 Join SuiBets for 0% fees!';
    }
    
    const events = (upcomingEvents as any[]).slice(0, 5).map((event: any) => {
      const time = new Date(event.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const sportEmoji = getSportEmoji(event.sport);
      return `${sportEmoji} ${event.homeTeam} vs ${event.awayTeam} - ${time}`;
    }).join(' | ');
    
    return events + ' | 🔥 Join SuiBets for 0% fees!';
  };
  
  const getSportEmoji = (sport: string): string => {
    const emojiMap: Record<string, string> = {
      'football': '⚽',
      'basketball': '🏀',
      'tennis': '🎾',
      'baseball': '⚾',
      'hockey': '🏒',
      'boxing': '🥊',
      'rugby': '🏉',
      'golf': '⛳'
    };
    return emojiMap[sport?.toLowerCase()] || '🏆';
  };
  
  const topNavItems = [
    { label: 'Bets', href: '/' },
    { label: 'Predict', href: '/network', highlight: true },
    { label: 'My Bets', href: '/bet-history' },
    { label: 'Revenue', href: '/revenue' },
    { label: 'Staking', href: '/staking' },
    { label: 'Trade', href: '/trading', badge: 'DEX' },
    { label: 'Dashboard', href: '/wallet-dashboard', icon: <Wallet className="h-4 w-4 mr-2" /> },
    { label: 'Promotions', href: '/promotions', icon: <Target className="h-4 w-4 mr-2" /> },
  ];

  const moreMenuItems = [
    { label: 'AI Betting', href: '/ai-betting', icon: <TrendingDown className="h-4 w-4 mr-2" /> },
    { label: 'Streaming', href: '/streaming', icon: <TrendingUp className="h-4 w-4 mr-2" /> },
    { label: 'Leaderboard', href: '/leaderboard', icon: <Target className="h-4 w-4 mr-2" /> },
    { label: 'Activity', href: '/results', icon: <Activity className="h-4 w-4 mr-2" /> },
    { label: 'Parlays', href: '/parlay', icon: <Target className="h-4 w-4 mr-2" /> },
    { label: 'Withdraw', href: '/deposits-withdrawals', icon: <ArrowUpDown className="h-4 w-4 mr-2" /> },
    { label: 'Whitepaper', href: '/whitepaper', icon: <FileText className="h-4 w-4 mr-2" /> },
  ];

  const bottomNavItems = [
    { label: 'Home', i18nKey: 'home', icon: <Home />, href: '/' },
    { label: 'Live', i18nKey: 'live', icon: <TrendingUp />, href: '/live-events' },
    { label: 'Predict', i18nKey: 'predict', icon: <Target />, href: '/network' },
    { label: 'History', i18nKey: 'bet_history', icon: <Clock />, href: '/bet-history' },
    { label: 'Wallet', i18nKey: 'wallet', icon: <Wallet />, href: '/wallet-dashboard' },
  ];

  const handleBack = () => {
    window.history.back();
  };
  
  return (
    <div 
      className="min-h-screen text-white pb-16 lg:pb-0"
      style={{
        backgroundImage: `url(${suibetsBackground})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="min-h-screen bg-[#112225]/85 backdrop-blur-sm">
      {/* Top Header - like bet365 */}
      <header className="bg-[#0b1618] border-b border-[#1e3a3f]">
        {/* Upper section with logo and login */}
        <div className="px-4 py-3 flex items-center justify-between bg-gradient-to-r from-[#0b1618] to-[#112225]">
          <div className="flex items-center space-x-2">
            {showBackButton ? (
              <Button
                variant="ghost"
                size="sm"
                className="mr-2 text-cyan-400 hover:text-cyan-300 hover:bg-[#1e3a3f]"
                onClick={handleBack}
              >
                <ChevronLeft className="h-5 w-5" />
                Back
              </Button>
            ) : (
              <div className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLocation('/')}>
                <img 
                  src={suibetsLogo} 
                  alt="SuiBets Logo" 
                  className="h-10 w-auto object-contain drop-shadow-[0_0_10px_rgba(0,255,255,0.4)]"
                  data-testid="logo-image"
                />
              </div>
            )}
            {showBackButton && title && (
              <h1 className="text-xl font-semibold text-cyan-200">{title}</h1>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            <Button 
              variant="default" 
              size="sm"
              className="bg-[#0088cc] hover:bg-[#0077bb] text-white text-xs shadow-[0_0_10px_rgba(0,136,204,0.3)] transition-all hover:shadow-[0_0_15px_rgba(0,136,204,0.5)] flex items-center gap-1"
              onClick={() => window.open('https://t.me/Sui_Bets', '_blank')}
              data-testid="button-join-now"
            >
              <MessageCircle className="h-4 w-4" />
              JOIN NOW
            </Button>
            <Button 
              variant="default" 
              size="sm"
              className="bg-[#00ffff] hover:bg-[#00d8d8] text-black text-xs shadow-[0_0_10px_rgba(0,255,255,0.3)] transition-all hover:shadow-[0_0_15px_rgba(0,255,255,0.5)]"
              onClick={() => setIsWalletModalOpen(true)}
              data-testid="button-connect-wallet"
            >
              Connect Wallet
            </Button>
          </div>
        </div>

        {/* Navigation items - dapp style */}
        <div className="hidden md:flex items-center overflow-x-auto custom-scrollbar bg-[#0b1618]">
          {topNavItems.map((item, index) => (
            <button
              key={index}
              className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                location === item.href 
                  ? 'text-cyan-400' 
                  : (item as any).highlight
                    ? 'text-yellow-400 hover:text-yellow-300'
                    : (item as any).badge
                      ? 'text-[#00d0ff] hover:text-[#00eeff]'
                      : 'text-gray-300 hover:text-white'
              }`}
              onClick={() => setLocation(item.href)}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <span className="flex items-center gap-1.5">
                {item.label}
                {(item as any).highlight && location !== item.href && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                )}
                {(item as any).badge && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#00d0ff]/20 text-[#00d0ff] border border-[#00d0ff]/30 leading-none">
                    {(item as any).badge}
                  </span>
                )}
              </span>
            </button>
          ))}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1 ${
                  moreMenuItems.some(item => location === item.href)
                    ? 'text-cyan-400'
                    : 'text-gray-300 hover:text-white'
                }`}
                data-testid="nav-more"
              >
                More
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="end" 
              className="bg-[#0b1618] border border-[#1e3a3f] min-w-[180px] z-[9999]"
            >
              {moreMenuItems.map((item, index) => (
                <DropdownMenuItem
                  key={index}
                  className={`cursor-pointer flex items-center px-4 py-3 text-sm font-medium ${
                    location === item.href
                      ? 'text-cyan-400'
                      : 'text-gray-200 hover:text-white'
                  }`}
                  onClick={() => setLocation(item.href)}
                  data-testid={`nav-more-${item.label.toLowerCase()}`}
                >
                  {item.icon}
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      
      {/* Promotion Banner - Bet $15 Get $5 Free */}
      <div 
        className="bg-gradient-to-r from-yellow-600 via-orange-500 to-yellow-600 border-b border-yellow-400/50 cursor-pointer hover:brightness-110 transition-all"
        onClick={() => setLocation('/promotions')}
        data-testid="promo-top-banner"
      >
        <div className="container mx-auto px-4 py-2 flex items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-white animate-bounce" />
            <span className="text-white font-bold text-sm md:text-base">
              BET $15 → GET $5 FREE!
            </span>
            <Star className="w-4 h-4 text-yellow-200 fill-yellow-200" />
          </div>
          {currentAccount?.address && promotionData && (
            <div className="hidden md:flex items-center gap-2 text-white/90 text-sm">
              <span className="bg-black/30 px-2 py-0.5 rounded-full">
                Progress: ${promotionData.totalBetUsd?.toFixed(2) || "0.00"}/$15
              </span>
              {promotionData.bonusBalance > 0 && (
                <span className="bg-green-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
                  ${promotionData.bonusBalance.toFixed(2)} FREE!
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Display title if provided and not showing back button */}
      {title && !showBackButton && (
        <div className="container mx-auto px-4 pt-4">
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
      )}
      
      {/* Main content */}
      <div className="container mx-auto p-4">
        {children}
      </div>
      
      {/* Mobile bottom navigation (visible on small screens) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-gradient-to-t from-[#0b1618] to-[#112225] border-t border-[#1e3a3f] z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.3)]">
        <div className="flex justify-around p-1">
          {bottomNavItems.map((item, index) => (
            <Button
              key={index}
              variant="ghost"
              className={`flex flex-col items-center justify-center py-1 h-14 w-full transition-all ${
                location === item.href 
                  ? 'text-cyan-400 border-t-2 border-cyan-400 bg-[#1e3a3f]/30' 
                  : 'text-cyan-200 hover:text-cyan-400'
              }`}
              onClick={() => setLocation(item.href)}
            >
              {item.icon}
              <span className="text-xs mt-1">{item.label}</span>
            </Button>
          ))}
        </div>
      </div>
      
      {/* Wallet Connection Modal */}
      <ConnectWalletModal 
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />
    </div></div>
  );
};

export default Layout;