import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useToast } from '@/hooks/use-toast';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  FileText, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Wallet,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Filter,
  ArrowLeft
} from 'lucide-react';

interface Bet {
  id: string;
  eventName: string;
  selection: string;
  odds: number;
  stake: number;
  potentialWin: number;
  status: 'pending' | 'won' | 'lost';
  placedAt: string;
  settledAt?: string;
  txHash?: string;
  currency?: 'SUI' | 'SBETS';
}

export default function BetHistoryPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currentAccount = useCurrentAccount();
  const [filter, setFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Only fetch data when wallet is connected - prevents mock data
  const walletAddress = currentAccount?.address;
  
  const { data: rawBets, refetch } = useQuery({
    queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 10000,
  });
  
  const bets: Bet[] = Array.isArray(rawBets) ? rawBets : [];
  
  const filteredBets = filter === 'all' ? bets : bets.filter(b => b.status === filter);

  const stats = {
    total: bets.length,
    won: bets.filter(b => b.status === 'won').length,
    lost: bets.filter(b => b.status === 'lost').length,
    pending: bets.filter(b => b.status === 'pending').length,
    totalStaked: bets.reduce((acc, b) => acc + (b.stake || 0), 0),
    totalWon: bets.filter(b => b.status === 'won').reduce((acc, b) => acc + (b.potentialWin || 0), 0),
  };

  const winRate = stats.won + stats.lost > 0 ? ((stats.won / (stats.won + stats.lost)) * 100).toFixed(0) : 0;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    toast({ title: 'Refreshed', description: 'Bet history updated' });
    setIsRefreshing(false);
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'won': return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'lost': return <XCircle className="h-5 w-5 text-red-400" />;
      case 'pending': return <Clock className="h-5 w-5 text-yellow-400 animate-pulse" />;
      default: return null;
    }
  };

  // Helper to detect if a bet is a parlay (JSON array in eventName or selection)
  const isParlay = (bet: Bet): boolean => {
    try {
      if (typeof bet.eventName === 'string' && bet.eventName.startsWith('[')) {
        const parsed = JSON.parse(bet.eventName);
        return Array.isArray(parsed) && parsed.length > 1;
      }
      if (typeof bet.selection === 'string' && bet.selection.startsWith('[')) {
        const parsed = JSON.parse(bet.selection);
        return Array.isArray(parsed) && parsed.length > 1;
      }
    } catch {
      return false;
    }
    return false;
  };

  // Parse parlay selections from JSON
  const getParlaySelections = (bet: Bet): { eventName: string; selection: string; odds: number }[] => {
    try {
      const jsonStr = bet.eventName?.startsWith('[') ? bet.eventName : bet.selection;
      if (jsonStr && jsonStr.startsWith('[')) {
        return JSON.parse(jsonStr);
      }
    } catch {
      return [];
    }
    return [];
  };

  // Get display name for bet
  const getBetDisplayName = (bet: Bet): string => {
    if (isParlay(bet)) {
      const selections = getParlaySelections(bet);
      return `Parlay (${selections.length} Legs)`;
    }
    return bet.eventName || 'Unknown Event';
  };

  // Get selection display
  const getSelectionDisplay = (bet: Bet): string => {
    if (isParlay(bet)) {
      const selections = getParlaySelections(bet);
      return selections.map(s => s.selection).join(' + ');
    }
    return bet.selection || 'Unknown';
  };

  return (
    <div className="min-h-screen" data-testid="bet-history-page">
      {/* Navigation */}
      <nav className="bg-black/40 backdrop-blur-md border-b border-cyan-900/30 px-4 py-3">
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
            <Link href="/bet-history" className="text-cyan-400 text-sm font-medium" data-testid="nav-my-bets">My Bets</Link>
            <Link href="/activity" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-activity">Activity</Link>
            <Link href="/deposits-withdrawals" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-withdraw">Withdraw</Link>
            <Link href="/parlay" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-parlays">Parlays</Link>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleRefresh} className="text-gray-400 hover:text-white p-2" data-testid="btn-refresh">
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {walletAddress ? (
              <span className="text-cyan-400 text-sm">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
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
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-500/20 rounded-xl">
              <FileText className="h-8 w-8 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Bet History</h1>
              <p className="text-gray-400">Track your betting performance in real-time</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-400" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-[#111111] border border-cyan-900/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
              data-testid="select-filter"
            >
              <option value="all">All Bets</option>
              <option value="pending">Pending</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-cyan-400" />
              <span className="text-gray-400 text-sm">Win Rate</span>
            </div>
            <p className="text-3xl font-bold text-cyan-400">{winRate}%</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span className="text-gray-400 text-sm">Won</span>
            </div>
            <p className="text-3xl font-bold text-green-400">{stats.won}</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="h-5 w-5 text-green-400" />
              <span className="text-gray-400 text-sm">Total Won</span>
            </div>
            <p className="text-3xl font-bold text-green-400">+{stats.totalWon.toFixed(2)}</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-5 w-5 text-yellow-400" />
              <span className="text-gray-400 text-sm">Pending</span>
            </div>
            <p className="text-3xl font-bold text-yellow-400">{stats.pending}</p>
          </div>
        </div>

        {/* Bet List */}
        <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-6">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            Your Bets
            <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded-full">Live Updates</span>
          </h3>
          
          {filteredBets.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="h-16 w-16 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400 text-lg mb-2">No bets yet</p>
              <p className="text-gray-500 text-sm mb-6">Place your first bet to see it here</p>
              <Link href="/">
                <button className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-3 rounded-xl transition-colors" data-testid="btn-place-bet">
                  Place a Bet
                </button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredBets.map((bet) => (
                <div 
                  key={bet.id}
                  className="flex items-center justify-between p-4 bg-black/50 rounded-xl border border-cyan-900/20 hover:border-cyan-500/30 transition-colors"
                  data-testid={`bet-${bet.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${
                      bet.status === 'won' ? 'bg-green-500/20' :
                      bet.status === 'lost' ? 'bg-red-500/20' :
                      'bg-yellow-500/20'
                    }`}>
                      {getStatusIcon(bet.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium">{getBetDisplayName(bet)}</p>
                      <p className="text-cyan-400 text-sm">{getSelectionDisplay(bet)}</p>
                      {isParlay(bet) && (
                        <div className="mt-1 space-y-0.5">
                          {getParlaySelections(bet).slice(0, 3).map((leg, idx) => (
                            <p key={idx} className="text-gray-400 text-xs truncate">
                              {leg.eventName}: {leg.selection} @ {leg.odds?.toFixed(2)}
                            </p>
                          ))}
                          {getParlaySelections(bet).length > 3 && (
                            <p className="text-gray-500 text-xs">+{getParlaySelections(bet).length - 3} more...</p>
                          )}
                        </div>
                      )}
                      <p className="text-gray-500 text-xs mt-1">{new Date(bet.placedAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2 justify-end mb-1">
                      <span className="text-gray-400 text-sm">Stake:</span>
                      <span className="text-white font-medium">{bet.stake} {bet.currency || 'SUI'}</span>
                    </div>
                    <div className="flex items-center gap-2 justify-end mb-1">
                      <span className="text-gray-400 text-sm">Odds:</span>
                      <span className="text-green-400 font-bold">{bet.odds.toFixed(2)}</span>
                    </div>
                    <p className={`font-bold text-lg ${
                      bet.status === 'won' ? 'text-green-400' :
                      bet.status === 'lost' ? 'text-red-400' :
                      'text-yellow-400'
                    }`}>
                      {bet.status === 'won' ? '+' : bet.status === 'pending' ? '' : '-'}{bet.potentialWin.toFixed(2)} {bet.currency || 'SUI'}
                    </p>
                    {bet.txHash && (
                      <a 
                        href={`https://suiscan.xyz/mainnet/tx/${bet.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1 justify-end mt-1"
                        data-testid={`tx-link-${bet.id}`}
                      >
                        View on Explorer
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
