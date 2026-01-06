import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useCurrentAccount, useSuiClientQuery } from '@mysten/dapp-kit';
import { queryClient, apiRequest } from '@/lib/queryClient';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  ArrowDownLeft, 
  ArrowUpRight, 
  Wallet, 
  ExternalLink,
  Clock,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  Coins
} from 'lucide-react';

const SBETS_COIN_TYPE = '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS';

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'failed';
  timestamp: string;
  txHash?: string;
}

export default function DepositsWithdrawalsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [sbetsWithdrawAmount, setSbetsWithdrawAmount] = useState('');
  const [sbetsWithdrawAddress, setSbetsWithdrawAddress] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch on-chain SUI wallet balance
  const { data: onChainBalance, refetch: refetchOnChain } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '' },
    { enabled: !!walletAddress }
  );
  
  // Fetch on-chain SBETS wallet balance
  const { data: sbetsOnChainBalance, refetch: refetchSbetsOnChain } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '', coinType: SBETS_COIN_TYPE },
    { enabled: !!walletAddress }
  );
  
  // Convert from MIST to SUI/SBETS (1 token = 1,000,000,000 MIST)
  const walletSuiBalance = onChainBalance?.totalBalance 
    ? Number(onChainBalance.totalBalance) / 1_000_000_000 
    : 0;
    
  const walletSbetsBalance = sbetsOnChainBalance?.totalBalance
    ? Number(sbetsOnChainBalance.totalBalance) / 1_000_000_000
    : 0;

  const { data: rawTransactions, refetch: refetchTransactions } = useQuery({
    queryKey: ['/api/transactions'],
    refetchInterval: 15000,
  });

  // Platform balance (for withdrawal of deposited funds)
  const { data: balanceData, refetch: refetchBalance } = useQuery<{ 
    suiBalance: number; 
    sbetsBalance: number; 
    platformSuiBalance?: number; 
    platformSbetsBalance?: number; 
  }>({
    queryKey: [`/api/user/balance?userId=${walletAddress}`],
    enabled: !!walletAddress,
    refetchInterval: 15000,
  });
  
  // Use platform balances for withdrawals (database balance), fall back to 0
  const withdrawableSuiBalance = balanceData?.platformSuiBalance ?? 0;
  const withdrawableSbetsBalance = balanceData?.platformSbetsBalance ?? 0;
  
  const transactions: Transaction[] = Array.isArray(rawTransactions) ? rawTransactions : [];

  // SUI Withdrawal Mutation
  const withdrawMutation = useMutation({
    mutationFn: async (data: { amount: number; address: string }) => {
      return apiRequest('POST', '/api/user/withdraw', { 
        userId: walletAddress, 
        amount: data.amount,
        currency: 'SUI',
        executeOnChain: true,
        destinationAddress: data.address
      });
    },
    onSuccess: (response: any) => {
      const status = response?.withdrawal?.status || 'pending';
      if (status === 'completed') {
        toast({ title: 'SUI Withdrawal Complete', description: `${withdrawAmount} SUI has been sent to your wallet` });
      } else {
        toast({ title: 'SUI Withdrawal Submitted', description: `${withdrawAmount} SUI withdrawal is being processed` });
      }
      setWithdrawAmount('');
      setWithdrawAddress('');
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/user/balance') });
      refetchOnChain();
    },
    onError: (error: any) => {
      const message = error?.message || 'Please check your balance and try again';
      toast({ title: 'SUI Withdrawal Failed', description: message, variant: 'destructive' });
    }
  });

  // SBETS Withdrawal Mutation
  const sbetsWithdrawMutation = useMutation({
    mutationFn: async (data: { amount: number; address: string }) => {
      return apiRequest('POST', '/api/user/withdraw', { 
        userId: walletAddress, 
        amount: data.amount,
        currency: 'SBETS',
        executeOnChain: true,
        destinationAddress: data.address
      });
    },
    onSuccess: (response: any) => {
      const status = response?.withdrawal?.status || 'pending';
      if (status === 'completed') {
        toast({ title: 'SBETS Withdrawal Complete', description: `${sbetsWithdrawAmount} SBETS has been sent to your wallet` });
      } else {
        toast({ title: 'SBETS Withdrawal Submitted', description: `${sbetsWithdrawAmount} SBETS withdrawal is being processed` });
      }
      setSbetsWithdrawAmount('');
      setSbetsWithdrawAddress('');
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/user/balance') });
      refetchSbetsOnChain();
    },
    onError: (error: any) => {
      const message = error?.message || 'Please check your SBETS balance and try again';
      toast({ title: 'SBETS Withdrawal Failed', description: message, variant: 'destructive' });
    }
  });

  const handleWithdraw = () => {
    if (!withdrawAddress) {
      toast({ title: 'Enter Address', description: 'Please enter a withdrawal address', variant: 'destructive' });
      return;
    }
    if (!withdrawAddress.startsWith('0x') || withdrawAddress.length < 42) {
      toast({ title: 'Invalid Address', description: 'Please enter a valid SUI address (0x...)', variant: 'destructive' });
      return;
    }
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      toast({ title: 'Enter Amount', description: 'Please enter a valid withdrawal amount', variant: 'destructive' });
      return;
    }
    if (parseFloat(withdrawAmount) > withdrawableSuiBalance) {
      toast({ title: 'Insufficient Balance', description: `You only have ${withdrawableSuiBalance.toFixed(4)} SUI available to withdraw`, variant: 'destructive' });
      return;
    }
    withdrawMutation.mutate({ amount: parseFloat(withdrawAmount), address: withdrawAddress });
  };

  const handleSbetsWithdraw = () => {
    if (!sbetsWithdrawAddress) {
      toast({ title: 'Enter Address', description: 'Please enter a withdrawal address', variant: 'destructive' });
      return;
    }
    if (!sbetsWithdrawAddress.startsWith('0x') || sbetsWithdrawAddress.length < 42) {
      toast({ title: 'Invalid Address', description: 'Please enter a valid SUI address (0x...)', variant: 'destructive' });
      return;
    }
    if (!sbetsWithdrawAmount || parseFloat(sbetsWithdrawAmount) <= 0) {
      toast({ title: 'Enter Amount', description: 'Please enter a valid SBETS withdrawal amount', variant: 'destructive' });
      return;
    }
    if (parseFloat(sbetsWithdrawAmount) > withdrawableSbetsBalance) {
      toast({ title: 'Insufficient Balance', description: `You only have ${withdrawableSbetsBalance.toFixed(4)} SBETS available to withdraw`, variant: 'destructive' });
      return;
    }
    sbetsWithdrawMutation.mutate({ amount: parseFloat(sbetsWithdrawAmount), address: sbetsWithdrawAddress });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchTransactions(), refetchBalance(), refetchOnChain(), refetchSbetsOnChain()]);
    toast({ title: 'Refreshed', description: 'Balances updated from blockchain' });
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
      case 'completed': return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'pending': return <Clock className="h-5 w-5 text-yellow-400 animate-pulse" />;
      case 'failed': return <AlertCircle className="h-5 w-5 text-red-400" />;
      default: return null;
    }
  };
  
  return (
    <div className="min-h-screen" data-testid="deposits-page">
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
            <Link href="/activity" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-activity">Activity</Link>
            <Link href="/deposits-withdrawals" className="text-cyan-400 text-sm font-medium" data-testid="nav-withdraw">Withdraw</Link>
            <Link href="/parlay" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-parlays">Parlays</Link>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleRefresh} className="text-gray-400 hover:text-white p-2" data-testid="btn-refresh">
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {walletAddress ? (
              <div className="text-right">
                <p className="text-green-400 text-xs" title="On-chain wallet balance">Wallet: {walletSuiBalance.toFixed(4)} SUI</p>
                <p className="text-purple-400 text-xs" title="On-chain SBETS balance">Wallet: {walletSbetsBalance.toFixed(2)} SBETS</p>
                <p className="text-gray-500 text-xs">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</p>
              </div>
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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Withdraw Funds</h1>
          <p className="text-gray-400">Withdraw your platform balance to your wallet</p>
          
          {/* Direct Wallet Mode Notice */}
          <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
            <p className="text-green-400 font-medium flex items-center gap-2">
              Direct Wallet Betting Mode Active
            </p>
            <p className="text-gray-400 text-sm mt-1">
              Bets are now placed directly from your connected wallet. No deposits needed!
              Use this page to withdraw any existing platform balance or winnings.
            </p>
          </div>
          
          {/* Balance Grid - 4 sections */}
          {walletAddress && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 bg-[#111111] border border-green-900/30 rounded-xl">
                <p className="text-gray-400 text-xs">Wallet SUI</p>
                <p className="text-2xl font-bold text-green-400">{walletSuiBalance.toFixed(4)}</p>
                <p className="text-gray-500 text-xs mt-1">On-Chain</p>
              </div>
              <div className="p-4 bg-[#111111] border border-cyan-900/30 rounded-xl">
                <p className="text-gray-400 text-xs">Platform SUI</p>
                <p className="text-2xl font-bold text-cyan-400">{withdrawableSuiBalance.toFixed(4)}</p>
                <p className="text-gray-500 text-xs mt-1">Withdrawable</p>
              </div>
              <div className="p-4 bg-[#111111] border border-purple-900/30 rounded-xl">
                <p className="text-gray-400 text-xs">Wallet SBETS</p>
                <p className="text-2xl font-bold text-purple-400">{walletSbetsBalance.toFixed(2)}</p>
                <p className="text-gray-500 text-xs mt-1">On-Chain</p>
              </div>
              <div className="p-4 bg-[#111111] border border-pink-900/30 rounded-xl">
                <p className="text-gray-400 text-xs">Platform SBETS</p>
                <p className="text-2xl font-bold text-pink-400">{withdrawableSbetsBalance.toFixed(2)}</p>
                <p className="text-gray-500 text-xs mt-1">Withdrawable</p>
              </div>
            </div>
          )}
        </div>

        {/* Withdraw Header */}
        <div className="flex flex-wrap gap-2 mb-8">
          <div className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-orange-500 text-black">
            <ArrowUpRight size={18} />
            Withdraw Platform Balance
          </div>
        </div>

        {/* SUI Withdraw Section */}
        <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-cyan-500/20 rounded-xl">
              <Wallet className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Withdraw SUI</h2>
              <p className="text-gray-400 text-sm">Send SUI to an external wallet on Sui blockchain</p>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-gray-400 text-sm mb-2 block">Withdrawal Address (Sui Network)</label>
              <input
                type="text"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                placeholder="Enter SUI address (0x...)"
                className="w-full bg-black/50 border border-cyan-900/30 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono"
                data-testid="input-withdraw-address"
              />
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-gray-400 text-sm">Amount (SUI)</label>
                <button 
                  onClick={() => setWithdrawAmount(withdrawableSuiBalance.toString())}
                  className="text-cyan-400 text-sm hover:text-cyan-300"
                  data-testid="btn-max-sui"
                >
                  MAX: {withdrawableSuiBalance.toFixed(4)} SUI
                </button>
              </div>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Enter amount"
                min="0"
                step="0.01"
                className="w-full bg-black/50 border border-cyan-900/30 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                data-testid="input-withdraw-amount"
              />
            </div>

            <div className="bg-black/50 border border-cyan-900/30 rounded-xl p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">Network Fee (Gas)</span>
                <span className="text-white">~0.001 SUI</span>
              </div>
              <div className="flex justify-between text-sm border-t border-cyan-900/30 pt-2 mt-2">
                <span className="text-gray-400">You'll Receive</span>
                <span className="text-cyan-400 font-bold">
                  {withdrawAmount ? Math.max(0, parseFloat(withdrawAmount) - 0.001).toFixed(4) : '0.0000'} SUI
                </span>
              </div>
            </div>

            <button
              onClick={handleWithdraw}
              disabled={withdrawMutation.isPending || !walletAddress || withdrawableSuiBalance <= 0}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 rounded-xl transition-colors text-lg"
              data-testid="btn-withdraw-sui"
            >
              {withdrawMutation.isPending ? (
                <RefreshCw className="h-5 w-5 inline mr-2 animate-spin" />
              ) : (
                <ArrowUpRight className="h-5 w-5 inline mr-2" />
              )}
              {withdrawMutation.isPending ? 'Processing...' : 'Withdraw SUI'}
            </button>
          </div>
        </div>

        {/* SBETS Withdraw Section */}
        <div className="bg-[#111111] border border-purple-900/30 rounded-2xl p-8 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-purple-500/20 rounded-xl">
              <Coins className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Withdraw SBETS</h2>
              <p className="text-gray-400 text-sm">Send SBETS tokens to an external wallet on Sui blockchain</p>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-gray-400 text-sm mb-2 block">Withdrawal Address (Sui Network)</label>
              <input
                type="text"
                value={sbetsWithdrawAddress}
                onChange={(e) => setSbetsWithdrawAddress(e.target.value)}
                placeholder="Enter SUI address (0x...)"
                className="w-full bg-black/50 border border-purple-900/30 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono"
                data-testid="input-sbets-withdraw-address"
              />
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-gray-400 text-sm">Amount (SBETS)</label>
                <button 
                  onClick={() => setSbetsWithdrawAmount(withdrawableSbetsBalance.toString())}
                  className="text-purple-400 text-sm hover:text-purple-300"
                  data-testid="btn-max-sbets"
                >
                  MAX: {withdrawableSbetsBalance.toFixed(2)} SBETS
                </button>
              </div>
              <input
                type="number"
                value={sbetsWithdrawAmount}
                onChange={(e) => setSbetsWithdrawAmount(e.target.value)}
                placeholder="Enter amount"
                min="0"
                step="0.01"
                className="w-full bg-black/50 border border-purple-900/30 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                data-testid="input-sbets-withdraw-amount"
              />
            </div>

            <div className="bg-black/50 border border-purple-900/30 rounded-xl p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">Network Fee (Gas)</span>
                <span className="text-white">~0.001 SUI (paid in SUI)</span>
              </div>
              <div className="flex justify-between text-sm border-t border-purple-900/30 pt-2 mt-2">
                <span className="text-gray-400">You'll Receive</span>
                <span className="text-purple-400 font-bold">
                  {sbetsWithdrawAmount ? parseFloat(sbetsWithdrawAmount).toFixed(2) : '0.00'} SBETS
                </span>
              </div>
            </div>

            <button
              onClick={handleSbetsWithdraw}
              disabled={sbetsWithdrawMutation.isPending || !walletAddress || withdrawableSbetsBalance <= 0}
              className="w-full bg-purple-500 hover:bg-purple-600 disabled:bg-gray-600 text-white font-bold py-4 rounded-xl transition-colors text-lg"
              data-testid="btn-withdraw-sbets"
            >
              {sbetsWithdrawMutation.isPending ? (
                <RefreshCw className="h-5 w-5 inline mr-2 animate-spin" />
              ) : (
                <ArrowUpRight className="h-5 w-5 inline mr-2" />
              )}
              {sbetsWithdrawMutation.isPending ? 'Processing...' : 'Withdraw SBETS'}
            </button>
          </div>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-3 p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl mb-8">
          <AlertCircle className="h-5 w-5 text-orange-400 mt-0.5" />
          <div>
            <p className="text-orange-400 font-medium text-sm">On-Chain Withdrawals</p>
            <p className="text-gray-400 text-xs">Transactions are executed on the Sui blockchain. Double-check the address - transactions cannot be reversed.</p>
          </div>
        </div>

        {/* Transaction History */}
        <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-6">
          <h3 className="text-xl font-bold text-white mb-6">Transaction History</h3>
          
          {transactions.length === 0 ? (
            <div className="text-center py-12">
              <Wallet className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">No transactions yet</p>
              <p className="text-gray-500 text-sm">Your deposit and withdrawal history will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div 
                  key={tx.id}
                  className="flex items-center justify-between p-4 bg-black/50 rounded-xl border border-cyan-900/20"
                  data-testid={`tx-${tx.id}`}
                >
                  <div className="flex items-center gap-4">
                    {tx.type === 'deposit' ? (
                      <div className="p-2 bg-green-500/20 rounded-lg">
                        <ArrowDownLeft className="h-5 w-5 text-green-400" />
                      </div>
                    ) : (
                      <div className="p-2 bg-orange-500/20 rounded-lg">
                        <ArrowUpRight className="h-5 w-5 text-orange-400" />
                      </div>
                    )}
                    <div>
                      <p className="text-white font-medium capitalize">{tx.type}</p>
                      <p className="text-gray-500 text-xs">{new Date(tx.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className={`font-bold ${tx.type === 'deposit' ? 'text-green-400' : 'text-orange-400'}`}>
                      {tx.type === 'deposit' ? '+' : '-'}{tx.amount} {tx.currency}
                    </p>
                    {getStatusIcon(tx.status)}
                    {tx.txHash && (
                      <a 
                        href={`https://suiscan.xyz/mainnet/tx/${tx.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300"
                        data-testid={`tx-link-${tx.id}`}
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
