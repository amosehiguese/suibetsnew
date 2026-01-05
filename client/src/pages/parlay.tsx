import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useBetting } from '@/context/BettingContext';
import { useCurrentAccount, useSuiClientQuery } from '@mysten/dapp-kit';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useOnChainBet } from '@/hooks/useOnChainBet';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
const suibetsLogo = "/images/suibets-logo.png";
import { 
  Layers, 
  Plus, 
  Trash2, 
  Calculator,
  CheckCircle,
  Wallet,
  RefreshCw,
  AlertCircle,
  ArrowLeft
} from 'lucide-react';

interface ParlayLeg {
  id: string;
  eventId: string;
  eventName: string;
  selection: string;
  odds: number;
}

export default function ParlayPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { selectedBets, removeBet, clearBets } = useBetting();
  const currentAccount = useCurrentAccount();
  const walletAddress = currentAccount?.address;
  const [stake, setStake] = useState('10');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPlacingBet, setIsPlacingBet] = useState(false);
  const [betCurrency, setBetCurrency] = useState<'SUI' | 'SBETS'>('SUI');
  const { placeBetOnChain, isLoading: isOnChainLoading } = useOnChainBet();

  // Fetch on-chain SUI wallet balance
  const { data: onChainBalance, refetch: refetchOnChain } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '' },
    { enabled: !!walletAddress }
  );
  
  // Convert from MIST to SUI (1 SUI = 1,000,000,000 MIST)
  const walletSuiBalance = onChainBalance?.totalBalance 
    ? Number(onChainBalance.totalBalance) / 1_000_000_000 
    : 0;

  // Fetch on-chain SBETS balance
  const SBETS_TOKEN_ADDRESS = import.meta.env.VITE_SBETS_TOKEN_ADDRESS || '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS';
  const { data: sbetsBalanceData, refetch: refetchSbets } = useSuiClientQuery(
    'getBalance',
    { owner: walletAddress || '', coinType: SBETS_TOKEN_ADDRESS },
    { enabled: !!walletAddress }
  );
  const walletSbetsBalance = sbetsBalanceData?.totalBalance 
    ? Number(sbetsBalanceData.totalBalance) / 1_000_000_000 
    : 0;

  const { data: balanceData } = useQuery<{ suiBalance: number; sbetsBalance: number }>({
    queryKey: [`/api/user/balance?userId=${walletAddress}`],
    enabled: !!walletAddress,
    refetchInterval: 15000,
  });

  const parlayLegs: ParlayLeg[] = selectedBets.map((bet: any) => ({
    id: bet.id,
    eventId: bet.eventId,
    eventName: bet.eventName || 'Unknown Event',
    selection: bet.selectionName || 'Unknown Selection',
    odds: bet.odds || 1.5
  }));

  const totalOdds = parlayLegs.reduce((acc, leg) => acc * leg.odds, 1);
  const potentialPayout = parseFloat(stake || '0') * totalOdds;


  const handleRemoveLeg = (id: string) => {
    removeBet(id);
    toast({ title: 'Removed', description: 'Selection removed from parlay' });
  };

  const handlePlaceParlay = async () => {
    if (parlayLegs.length < 2) {
      toast({ title: 'Not Enough Selections', description: 'A parlay requires at least 2 selections', variant: 'destructive' });
      return;
    }
    if (!walletAddress) {
      window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
      return;
    }
    const stakeAmount = parseFloat(stake);
    if (stakeAmount <= 0) {
      toast({ title: 'Invalid Stake', description: 'Please enter a valid stake amount', variant: 'destructive' });
      return;
    }
    // Use on-chain wallet balance for direct betting
    const currentBalance = betCurrency === 'SUI' ? walletSuiBalance : walletSbetsBalance;
    if (stakeAmount > currentBalance) {
      toast({ title: 'Insufficient Balance', description: `You only have ${currentBalance.toFixed(4)} ${betCurrency} in your wallet`, variant: 'destructive' });
      return;
    }

    setIsPlacingBet(true);

    try {
      // Create a combined parlay event ID from all legs
      const parlayEventId = `parlay_${Date.now()}_${parlayLegs.map(l => l.eventId).join('_')}`;
      const parlayMarketId = 'parlay_combined';
      const parlayPrediction = parlayLegs.map(l => `${l.eventName}: ${l.selection}`).join(' | ');

      // Place on-chain bet with combined odds
      const onChainResult = await placeBetOnChain({
        eventId: parlayEventId,
        marketId: parlayMarketId,
        prediction: parlayPrediction.slice(0, 500), // Limit prediction length
        betAmount: stakeAmount,
        odds: totalOdds,
        walrusBlobId: '',
        coinType: betCurrency,
        walletAddress: walletAddress,
      });

      if (!onChainResult.success) {
        toast({ title: 'On-Chain Bet Failed', description: onChainResult.error || 'Transaction rejected', variant: 'destructive' });
        setIsPlacingBet(false);
        return;
      }

      // Save parlay to database after successful on-chain transaction
      const response = await apiRequest('POST', '/api/parlays', {
        walletAddress: walletAddress,
        totalOdds,
        betAmount: stakeAmount,
        potentialPayout,
        txHash: onChainResult.txDigest,
        onChainBetId: onChainResult.betObjectId,
        status: 'confirmed',
        legs: parlayLegs.map(leg => ({
          eventId: leg.eventId,
          eventName: leg.eventName,
          selection: leg.selection,
          odds: leg.odds
        }))
      });

      if (response.ok) {
        toast({ 
          title: 'Parlay Placed On-Chain!', 
          description: `TX: ${onChainResult.txDigest?.slice(0, 12)}... - ${parlayLegs.length} legs @ ${totalOdds.toFixed(2)}x` 
        });
        clearBets();
        setStake('10');
        queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/bets') });
        queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/user/balance') });
        queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/activity') });
      } else {
        // On-chain succeeded but database failed - still show success since bet is on-chain
        toast({ 
          title: 'Parlay On-Chain!', 
          description: `TX: ${onChainResult.txDigest?.slice(0, 12)}... (DB save pending)` 
        });
        clearBets();
      }
    } catch (error: any) {
      toast({ title: 'Bet Failed', description: error.message || 'Please try again', variant: 'destructive' });
    } finally {
      setIsPlacingBet(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).includes('/api/user/balance') }),
      queryClient.invalidateQueries({ queryKey: ['/api/bets'] }),
      refetchOnChain(),
      refetchSbets(),
    ]);
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

  return (
    <div className="min-h-screen" data-testid="parlay-page">
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
            <Link href="/deposits-withdrawals" className="text-gray-400 hover:text-cyan-400 text-sm font-medium" data-testid="nav-withdraw">Withdraw</Link>
            <Link href="/parlay" className="text-cyan-400 text-sm font-medium" data-testid="nav-parlays">Parlays</Link>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleRefresh} className="text-gray-400 hover:text-white p-2" data-testid="btn-refresh">
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {walletAddress ? (
              <div className="text-right">
                <p className="text-green-400 text-xs" title="On-chain wallet balance">{walletSuiBalance.toFixed(4)} SUI | {walletSbetsBalance.toFixed(0)} SBETS</p>
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
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-purple-500/20 rounded-xl">
            <Layers className="h-8 w-8 text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Parlay Builder</h1>
            <p className="text-gray-400">Combine multiple selections for bigger payouts</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Selections */}
          <div className="lg:col-span-2">
            <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">Your Selections</h3>
                <span className="bg-purple-500/20 text-purple-400 px-3 py-1 rounded-full text-sm font-medium">
                  {parlayLegs.length} Legs
                </span>
              </div>

              {parlayLegs.length === 0 ? (
                <div className="text-center py-16">
                  <Layers className="h-16 w-16 text-gray-500 mx-auto mb-4" />
                  <p className="text-gray-400 text-lg mb-2">No selections yet</p>
                  <p className="text-gray-500 text-sm mb-6">Add bets from the sports pages to build your parlay</p>
                  <Link href="/">
                    <button className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-3 rounded-xl transition-colors" data-testid="btn-browse">
                      <Plus className="h-5 w-5 inline mr-2" />
                      Browse Sports
                    </button>
                  </Link>
                </div>
              ) : parlayLegs.length === 1 ? (
                <div className="text-center py-16">
                  <AlertCircle className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
                  <p className="text-yellow-400 text-lg mb-2">Need More Selections</p>
                  <p className="text-gray-500 text-sm mb-4">A parlay requires at least 2 selections. You have 1 single bet.</p>
                  <p className="text-gray-400 text-sm mb-6">Place it as a single bet from the main page, or add more selections.</p>
                  <Link href="/">
                    <button className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-6 py-3 rounded-xl transition-colors" data-testid="btn-add-more">
                      <Plus className="h-5 w-5 inline mr-2" />
                      Add More Selections
                    </button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {parlayLegs.map((leg, index) => (
                    <div 
                      key={leg.id}
                      className="flex items-center justify-between p-4 bg-black/50 rounded-xl border border-cyan-900/20"
                      data-testid={`leg-${index}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold">
                          {index + 1}
                        </div>
                        <div>
                          <p className="text-white font-medium">{leg.eventName}</p>
                          <p className="text-cyan-400 text-sm">{leg.selection}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-green-400 font-bold text-lg">{leg.odds.toFixed(2)}</span>
                        <button
                          onClick={() => handleRemoveLeg(leg.id)}
                          className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                          data-testid={`btn-remove-${index}`}
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Parlay Rules */}
            <div className="bg-[#111111] border border-cyan-900/30 rounded-2xl p-6 mt-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-400" />
                Parlay Rules
              </h3>
              <ul className="text-gray-400 text-sm space-y-2">
                <li>• Minimum 2 selections required for a parlay</li>
                <li>• Maximum 10 selections per parlay</li>
                <li>• All selections must win for the parlay to pay out</li>
                <li>• Odds are multiplied together for final payout</li>
                <li>• Live events can be included in parlays</li>
                <li>• All bets are settled on-chain for transparency</li>
              </ul>
            </div>
          </div>

          {/* Bet Slip */}
          <div>
            <div className="bg-[#111111] border border-cyan-500/30 rounded-2xl p-6 sticky top-6">
              <h3 className="text-lg font-bold text-cyan-400 mb-6 flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Bet Summary
              </h3>

              <div className="space-y-4 mb-6">
                <div className="flex justify-between">
                  <span className="text-gray-400">Selections:</span>
                  <span className="text-white font-medium">{parlayLegs.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Combined Odds:</span>
                  <span className="text-green-400 font-bold text-lg">{totalOdds.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Your Balance:</span>
                  <span className="text-cyan-400 font-medium">
                    {betCurrency === 'SUI' 
                      ? `${walletSuiBalance.toFixed(4)} SUI` 
                      : `${walletSbetsBalance.toFixed(0)} SBETS`}
                  </span>
                </div>
                {/* Currency Toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-cyan-900/30">
                  <Label htmlFor="currency-toggle" className="text-gray-400 text-sm">
                    Bet with SBETS
                  </Label>
                  <Switch
                    id="currency-toggle"
                    checked={betCurrency === 'SBETS'}
                    onCheckedChange={(checked) => setBetCurrency(checked ? 'SBETS' : 'SUI')}
                    data-testid="switch-currency"
                  />
                </div>
              </div>

              <div className="border-t border-cyan-900/30 pt-6 mb-6">
                <label className="text-gray-400 text-sm mb-2 block">Stake ({betCurrency})</label>
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  min="0"
                  step={betCurrency === 'SBETS' ? '100' : '0.1'}
                  className="w-full bg-black/50 border border-cyan-900/30 rounded-xl p-4 text-white text-xl font-bold focus:outline-none focus:border-cyan-500"
                  data-testid="input-stake"
                />
              </div>

              <div className="bg-black/50 border border-cyan-500/30 rounded-xl p-4 mb-6">
                <p className="text-gray-400 text-sm mb-1">Potential Payout</p>
                <p className="text-3xl font-bold text-cyan-400">{potentialPayout.toFixed(betCurrency === 'SBETS' ? 0 : 2)} {betCurrency}</p>
              </div>

              <button
                onClick={handlePlaceParlay}
                disabled={parlayLegs.length < 2 || isPlacingBet || isOnChainLoading}
                className={`w-full py-4 rounded-xl font-bold text-lg transition-colors ${
                  parlayLegs.length < 2 || isPlacingBet || isOnChainLoading
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-cyan-500 hover:bg-cyan-600 text-black'
                }`}
                data-testid="btn-place-parlay"
              >
                {isPlacingBet || isOnChainLoading ? (
                  <RefreshCw className="h-5 w-5 inline mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-5 w-5 inline mr-2" />
                )}
                {isPlacingBet || isOnChainLoading ? 'Signing Transaction...' : 'Place Parlay On-Chain'}
              </button>

              {parlayLegs.length > 0 && (
                <button
                  onClick={clearBets}
                  className="w-full mt-3 py-3 rounded-xl font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                  data-testid="btn-clear-all"
                >
                  <Trash2 className="h-4 w-4 inline mr-2" />
                  Clear All
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
