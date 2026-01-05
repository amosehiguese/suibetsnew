import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  Activity as ActivityIcon, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  CheckCircle, 
  XCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  RefreshCw,
  Filter,
  ArrowLeft
} from 'lucide-react';

interface ActivityItem {
  id: string;
  type: 'bet_placed' | 'bet_won' | 'bet_lost' | 'deposit' | 'withdrawal' | 'stake' | 'unstake';
  title: string;
  description: string;
  amount: number;
  currency: string;
  timestamp: string;
  status: 'completed' | 'pending' | 'failed';
}

export default function ActivityPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currentAccount = useCurrentAccount();
  const [filter, setFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Only fetch data when wallet is connected - prevents mock data
  const walletAddress = currentAccount?.address;
  
  const { data: rawActivities, refetch } = useQuery({
    queryKey: [`/api/activity?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 10000,
  });

  const { data: rawBets } = useQuery({
    queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 10000,
  });
  
  const activities: ActivityItem[] = Array.isArray(rawActivities) ? rawActivities : [];
  const bets = Array.isArray(rawBets) ? rawBets : [];

  // Only include bets that have valid timestamps - no fabricated data
  const betActivities: ActivityItem[] = bets
    .filter((bet: any) => bet.placedAt || bet.createdAt)
    .map((bet: any) => ({
      id: `bet-${bet.id}`,
      type: bet.status === 'won' ? 'bet_won' : bet.status === 'lost' ? 'bet_lost' : 'bet_placed',
      title: bet.status === 'won' ? 'Bet Won!' : bet.status === 'lost' ? 'Bet Lost' : 'Bet Placed',
      description: `${bet.eventName || 'Unknown Event'} - ${bet.selection || 'Unknown Selection'}`,
      amount: bet.status === 'won' ? bet.potentialWin : bet.stake,
      currency: bet.currency || 'SUI',
      timestamp: bet.placedAt || bet.createdAt,
      status: 'completed'
    }));

  const allActivities = [...activities, ...betActivities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  
  const filteredActivities = filter === 'all' 
    ? allActivities 
    : allActivities.filter(a => a.type.includes(filter));

  const getIcon = (type: string) => {
    switch (type) {
      case 'bet_placed': return <TrendingUp className="h-5 w-5 text-cyan-400" />;
      case 'bet_won': return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'bet_lost': return <XCircle className="h-5 w-5 text-red-400" />;
      case 'deposit': return <ArrowDownLeft className="h-5 w-5 text-green-400" />;
      case 'withdrawal': return <ArrowUpRight className="h-5 w-5 text-orange-400" />;
      case 'stake': return <TrendingUp className="h-5 w-5 text-purple-400" />;
      case 'unstake': return <TrendingDown className="h-5 w-5 text-yellow-400" />;
      default: return <Clock className="h-5 w-5 text-gray-400" />;
    }
  };

  const getIconBg = (type: string) => {
    switch (type) {
      case 'bet_placed': return 'bg-cyan-500/20';
      case 'bet_won': return 'bg-green-500/20';
      case 'bet_lost': return 'bg-red-500/20';
      case 'deposit': return 'bg-green-500/20';
      case 'withdrawal': return 'bg-orange-500/20';
      case 'stake': return 'bg-purple-500/20';
      case 'unstake': return 'bg-yellow-500/20';
      default: return 'bg-gray-500/20';
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/activity') }),
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/bets') }),
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/transactions') }),
      refetch()
    ]);
    toast({ title: 'Refreshed', description: 'Activity updated' });
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
  
  return (
    <div className="min-h-screen" data-testid="activity-page">
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
            <Link href="/bet-history" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-my-bets">My Bets</Link>
            <Link href="/activity" className="text-cyan-400 text-sm font-medium" data-testid="nav-activity">Activity</Link>
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
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Activity</h1>
            <p className="text-gray-400">Track all your betting and transaction activity in real-time</p>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-400" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-[#111111] border border-cyan-900/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
              data-testid="select-filter"
            >
              <option value="all">All Activity</option>
              <option value="bet">Bets Only</option>
              <option value="deposit">Deposits</option>
              <option value="withdrawal">Withdrawals</option>
            </select>
          </div>
        </div>

        {/* Activity Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <TrendingUp className="h-6 w-6 text-cyan-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{allActivities.filter(a => a.type === 'bet_placed').length}</p>
            <p className="text-gray-400 text-xs">Bets Placed</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <CheckCircle className="h-6 w-6 text-green-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-green-400">{allActivities.filter(a => a.type === 'bet_won').length}</p>
            <p className="text-gray-400 text-xs">Bets Won</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <ArrowDownLeft className="h-6 w-6 text-green-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{allActivities.filter(a => a.type === 'deposit').length}</p>
            <p className="text-gray-400 text-xs">Deposits</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <ArrowUpRight className="h-6 w-6 text-orange-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{allActivities.filter(a => a.type === 'withdrawal').length}</p>
            <p className="text-gray-400 text-xs">Withdrawals</p>
          </div>
        </div>

        {/* Activity List */}
        <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-6">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            Recent Activity
            <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded-full">Live</span>
          </h3>
          
          {filteredActivities.length === 0 ? (
            <div className="text-center py-12">
              <ActivityIcon className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">No activity yet</p>
              <p className="text-gray-500 text-sm">Your betting and transaction activity will appear here</p>
              <Link href="/">
                <button className="mt-4 bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-2 rounded-lg" data-testid="btn-place-bet">
                  Place Your First Bet
                </button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredActivities.map((activity) => (
                <div 
                  key={activity.id}
                  className="flex items-center justify-between p-4 bg-black/50 rounded-xl border border-cyan-900/20 hover:border-cyan-500/30 transition-colors"
                  data-testid={`activity-${activity.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${getIconBg(activity.type)}`}>
                      {getIcon(activity.type)}
                    </div>
                    <div>
                      <p className="text-white font-medium">{activity.title}</p>
                      <p className="text-gray-400 text-sm">{activity.description}</p>
                      <p className="text-gray-500 text-xs mt-1">{new Date(activity.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold text-lg ${
                      activity.type.includes('won') || activity.type === 'deposit' 
                        ? 'text-green-400' 
                        : activity.type.includes('lost') || activity.type === 'withdrawal' 
                          ? 'text-red-400' 
                          : 'text-cyan-400'
                    }`}>
                      {activity.type === 'deposit' || activity.type.includes('won') ? '+' : '-'}{activity.amount} {activity.currency}
                    </p>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      activity.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      activity.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {activity.status}
                    </span>
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
