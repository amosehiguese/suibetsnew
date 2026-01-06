import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertCircle, 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  CheckCircle, 
  XCircle,
  Wallet,
  Search,
  ExternalLink,
  Filter,
  Calendar,
  RefreshCw,
  Coins,
  Loader2,
  Trophy,
  Shuffle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWalrusProtocolContext } from '@/context/WalrusProtocolContext';
import { format } from 'date-fns';

interface Transaction {
  id: string;
  type: 'bet' | 'win' | 'stake' | 'unstake' | 'claim' | 'deposit' | 'withdraw' | 'dividend';
  amount: number;
  tokenType: 'SUI' | 'SBETS';
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  hash: string;
  description?: string;
}

interface TransactionHistoryProps {
  className?: string;
}

export function TransactionHistory({ className }: TransactionHistoryProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { currentWallet } = useWalrusProtocolContext();
  
  // Fetch real transactions from API
  const { data: apiTransactions = [], refetch } = useQuery<any[]>({
    queryKey: ['/api/user/transactions', { userId: 'user1' }],
    enabled: !!currentWallet?.address
  });
  
  // Transform API transactions to component format
  const transactions: Transaction[] = apiTransactions.map((tx: any, index: number) => ({
    id: tx.id || `tx_${index}`,
    type: tx.type === 'bet_placed' ? 'bet' : tx.type === 'bet_won' ? 'win' : tx.type === 'withdrawal' ? 'withdraw' : tx.type === 'deposit' ? 'deposit' : 'bet',
    amount: tx.amount || 0,
    tokenType: tx.currency || 'SUI',
    timestamp: tx.timestamp || Date.now(),
    status: 'confirmed',
    hash: tx.txHash || `0x${Math.random().toString(16).slice(2, 18)}`,
    description: tx.reason || `${tx.type} transaction`
  }));
  
  // Filter transactions based on active tab and search query
  const filteredTransactions = transactions.filter(tx => {
    const matchesTab = activeTab === 'all' || tx.type === activeTab;
    const matchesSearch = 
      tx.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.hash.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesTab && matchesSearch;
  });
  
  // Handle refresh button click
  const handleRefresh = async () => {
    setIsRefreshing(true);
    
    try {
      await refetch();
      toast({
        title: 'Transactions Refreshed',
        description: 'Your transaction history has been updated.',
        variant: 'default',
      });
    } catch (error) {
      toast({
        title: 'Refresh Failed',
        description: 'Could not refresh transactions.',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  };
  
  // Get icon for transaction type
  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'bet':
        return <ArrowUpRight className="h-5 w-5 text-orange-400" />;
      case 'win':
        return <Trophy className="h-5 w-5 text-green-400" />;
      case 'stake':
        return <Wallet className="h-5 w-5 text-blue-400" />;
      case 'unstake':
        return <ArrowDownRight className="h-5 w-5 text-blue-400" />;
      case 'claim':
        return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'dividend':
        return <Coins className="h-5 w-5 text-yellow-400" />;
      case 'deposit':
        return <ArrowDownRight className="h-5 w-5 text-green-400" />;
      case 'withdraw':
        return <ArrowUpRight className="h-5 w-5 text-red-400" />;
      default:
        return <Shuffle className="h-5 w-5 text-gray-400" />;
    }
  };
  
  // Format transaction type for display
  const formatTransactionType = (type: string) => {
    switch (type) {
      case 'bet':
        return 'Placed Bet';
      case 'win':
        return 'Betting Win';
      case 'stake':
        return 'Staked Tokens';
      case 'unstake':
        return 'Unstaked Tokens';
      case 'claim':
        return 'Claimed Winnings';
      case 'dividend':
        return 'Dividend Payment';
      case 'deposit':
        return 'Deposit';
      case 'withdraw':
        return 'Withdrawal';
      default:
        return 'Transaction';
    }
  };
  
  // Format transaction status for display with appropriate styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return (
          <Badge 
            variant="outline" 
            className="bg-green-900/20 text-green-400 border-none"
          >
            Confirmed
          </Badge>
        );
      case 'pending':
        return (
          <Badge 
            variant="outline" 
            className="bg-yellow-900/20 text-yellow-400 border-none"
          >
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'failed':
        return (
          <Badge 
            variant="outline" 
            className="bg-red-900/20 text-red-400 border-none"
          >
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge 
            variant="outline" 
            className="bg-gray-900/20 text-gray-400 border-none"
          >
            Unknown
          </Badge>
        );
    }
  };
  
  // Format relative time
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) { // Less than 1 minute
      return 'Just now';
    } else if (diff < 3600000) { // Less than 1 hour
      const minutes = Math.floor(diff / 60000);
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diff < 86400000) { // Less than 1 day
      const hours = Math.floor(diff / 3600000);
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else {
      return format(new Date(timestamp), 'MMM d, yyyy');
    }
  };
  
  // Open transaction hash in Sui Explorer
  const openInExplorer = (hash: string) => {
    window.open(`https://suiscan.xyz/mainnet/tx/${hash}`, '_blank');
  };
  
  if (!currentWallet?.address) {
    return (
      <Card className={`w-full bg-[#112225] border-[#1e3a3f] text-white ${className}`}>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Wallet className="mr-2 h-5 w-5 text-[#00ffff]" />
            Transaction History
          </CardTitle>
          <CardDescription className="text-gray-400">
            Connect your wallet to view your transaction history
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <AlertCircle className="h-12 w-12 text-gray-500 mb-4" />
          <p className="text-gray-400 text-center mb-4">
            You need to connect your wallet to view your transaction history.
          </p>
          <Button 
            className="bg-[#00ffff] text-[#112225] hover:bg-cyan-300"
            onClick={() => navigate('/connect-wallet')}
          >
            Connect Wallet
          </Button>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className={`w-full bg-[#112225] border-[#1e3a3f] text-white ${className}`}>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center">
            <Wallet className="mr-2 h-5 w-5 text-[#00ffff]" />
            Transaction History
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-[#1e3a3f] text-gray-300 hover:bg-[#1e3a3f] hover:text-[#00ffff]"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        <CardDescription className="text-gray-400">
          View and track all your on-chain transactions
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search transactions..."
                className="pl-8 bg-[#0b1618] border-[#1e3a3f] text-white"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Tabs 
              value={activeTab} 
              onValueChange={setActiveTab}
              className="sm:w-auto"
            >
              <TabsList className="h-10 bg-[#0b1618] grid grid-cols-4 w-full sm:w-[340px]">
                <TabsTrigger 
                  value="all" 
                  className="text-xs data-[state=active]:bg-[#1e3a3f] data-[state=active]:text-[#00ffff]"
                >
                  All
                </TabsTrigger>
                <TabsTrigger 
                  value="bet" 
                  className="text-xs data-[state=active]:bg-[#1e3a3f] data-[state=active]:text-[#00ffff]"
                >
                  Bets
                </TabsTrigger>
                <TabsTrigger 
                  value="stake" 
                  className="text-xs data-[state=active]:bg-[#1e3a3f] data-[state=active]:text-[#00ffff]"
                >
                  Staking
                </TabsTrigger>
                <TabsTrigger 
                  value="dividend" 
                  className="text-xs data-[state=active]:bg-[#1e3a3f] data-[state=active]:text-[#00ffff]"
                >
                  Dividends
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          {filteredTransactions.length === 0 ? (
            <div className="text-center py-12">
              <Filter className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">
                {searchQuery
                  ? "No transactions found matching your search."
                  : "No transactions found for this filter."}
              </p>
              {searchQuery && (
                <Button
                  variant="link"
                  className="text-[#00ffff] mt-2"
                  onClick={() => setSearchQuery('')}
                >
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 bg-[#0b1618] rounded-lg hover:bg-[#122325] cursor-pointer border border-transparent hover:border-[#1e3a3f] transition-colors"
                  onClick={() => openInExplorer(tx.hash)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-start">
                      <div className="h-9 w-9 rounded-full flex items-center justify-center bg-[#1e3a3f] mr-3">
                        {getTransactionIcon(tx.type)}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-white">{formatTransactionType(tx.type)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{tx.description}</p>
                        <div className="flex items-center mt-1.5">
                          <div className="flex items-center mr-3">
                            <Calendar className="h-3 w-3 text-gray-400 mr-1" />
                            <span className="text-xs text-gray-400">{formatRelativeTime(tx.timestamp)}</span>
                          </div>
                          {getStatusBadge(tx.status)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${
                        tx.type === 'bet' || tx.type === 'stake' || tx.type === 'withdraw' 
                          ? 'text-red-400' 
                          : 'text-green-400'
                      }`}>
                        {tx.type === 'bet' || tx.type === 'stake' || tx.type === 'withdraw' ? '-' : '+'}
                        {tx.amount} {tx.tokenType}
                      </p>
                      <div className="flex items-center justify-end mt-1 text-xs text-gray-400">
                        <span className="truncate max-w-[100px]">{tx.hash.substring(0, 10)}...</span>
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      
      <CardFooter className="flex justify-center">
        {filteredTransactions.length > 0 && (
          <Button
            variant="outline"
            className="border-[#1e3a3f] text-[#00ffff] hover:bg-[#1e3a3f]"
            onClick={() => window.open(`https://suiscan.xyz/mainnet/account/${currentWallet.address}`, '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            View All Transactions on Explorer
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}