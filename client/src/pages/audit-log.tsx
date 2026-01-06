import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWalrusProtocolContext } from '@/context/WalrusProtocolContext';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  Shield, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  Clock,
  ExternalLink,
  Lock,
  Wallet,
  RefreshCw,
  Eye,
  ArrowLeft
} from 'lucide-react';

interface AuditEntry {
  id: string;
  action: string;
  category: 'security' | 'transaction' | 'account' | 'bet';
  description: string;
  timestamp: string;
  ipAddress?: string;
  txHash?: string;
  status: 'success' | 'warning' | 'info';
}

export default function AuditLogPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { currentWallet } = useWalrusProtocolContext();
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const walletAddress = currentWallet?.address;
  
  const { data: rawAuditLogs, refetch } = useQuery({
    queryKey: [`/api/audit-log?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: rawBets } = useQuery({
    queryKey: [`/api/bets?wallet=${walletAddress}`, walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });
  
  const auditLogs: AuditEntry[] = Array.isArray(rawAuditLogs) ? rawAuditLogs : [];
  const bets = Array.isArray(rawBets) ? rawBets : [];

  const betLogs: AuditEntry[] = bets.map((bet: any) => ({
    id: `bet-${bet.id}`,
    action: 'Bet Placed',
    category: 'bet' as const,
    description: `${bet.stake || 0} SUI on ${bet.eventName || 'Unknown Event'}`,
    timestamp: bet.placedAt || bet.createdAt || new Date().toISOString(),
    txHash: bet.txHash,
    status: 'success' as const
  }));

  const displayLogs = [...auditLogs, ...betLogs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const getIcon = (category: string) => {
    switch (category) {
      case 'security': return <Shield className="h-5 w-5 text-red-400" />;
      case 'transaction': return <FileText className="h-5 w-5 text-green-400" />;
      case 'account': return <Lock className="h-5 w-5 text-purple-400" />;
      case 'bet': return <CheckCircle className="h-5 w-5 text-cyan-400" />;
      default: return <FileText className="h-5 w-5 text-gray-400" />;
    }
  };

  const getIconBg = (category: string) => {
    switch (category) {
      case 'security': return 'bg-red-500/20';
      case 'transaction': return 'bg-green-500/20';
      case 'account': return 'bg-purple-500/20';
      case 'bet': return 'bg-cyan-500/20';
      default: return 'bg-gray-500/20';
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/audit-log') }),
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/bets') }),
      refetch()
    ]);
    toast({ title: 'Refreshed', description: 'Audit log updated' });
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
    <div className="min-h-screen bg-black" data-testid="audit-log-page">
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
            <Shield className="h-8 w-8 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Audit Log</h1>
            <p className="text-gray-400">Track all account activity and security events on-chain</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <Shield className="h-6 w-6 text-red-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{displayLogs.filter(l => l.category === 'security').length}</p>
            <p className="text-gray-400 text-xs">Security Events</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <FileText className="h-6 w-6 text-green-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{displayLogs.filter(l => l.category === 'transaction').length}</p>
            <p className="text-gray-400 text-xs">Transactions</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <CheckCircle className="h-6 w-6 text-cyan-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{displayLogs.filter(l => l.category === 'bet').length}</p>
            <p className="text-gray-400 text-xs">Bets</p>
          </div>
          <div className="bg-[#111111] border border-cyan-900/30 rounded-xl p-4 text-center">
            <Lock className="h-6 w-6 text-purple-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{displayLogs.filter(l => l.category === 'account').length}</p>
            <p className="text-gray-400 text-xs">Account</p>
          </div>
        </div>

        {/* Security Notice */}
        <div className="flex items-start gap-3 p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl mb-8">
          <Eye className="h-5 w-5 text-cyan-400 mt-0.5" />
          <div>
            <p className="text-cyan-400 font-medium text-sm">Full Blockchain Transparency</p>
            <p className="text-gray-400 text-xs">All actions are recorded on the Sui blockchain for complete auditability and immutability</p>
          </div>
        </div>

        {/* Audit Log List */}
        <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-6">
          <h3 className="text-xl font-bold text-white mb-6">Recent Activity</h3>
          
          {displayLogs.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">No audit entries yet</p>
              <p className="text-gray-500 text-sm">Your account activity will be logged here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayLogs.map((log) => (
                <div 
                  key={log.id}
                  className="flex items-start justify-between p-4 bg-black/50 rounded-xl border border-cyan-900/20 hover:border-cyan-500/30 transition-colors"
                  data-testid={`audit-${log.id}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-xl ${getIconBg(log.category)}`}>
                      {getIcon(log.category)}
                    </div>
                    <div>
                      <p className="text-white font-medium">{log.action}</p>
                      <p className="text-gray-400 text-sm">{log.description}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <p className="text-gray-500 text-xs flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                        {log.ipAddress && (
                          <p className="text-gray-500 text-xs">IP: {log.ipAddress}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      log.status === 'success' ? 'bg-green-500/20 text-green-400' :
                      log.status === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {log.status}
                    </span>
                    {log.txHash && (
                      <a 
                        href={`https://suiscan.xyz/mainnet/tx/${log.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300"
                        data-testid={`tx-link-${log.id}`}
                      >
                        <ExternalLink className="h-4 w-4" />
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
