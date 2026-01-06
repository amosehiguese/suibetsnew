import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Lock, RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2, Shield, Wallet, Coins, TrendingUp, DollarSign } from 'lucide-react';
import Layout from '@/components/layout/Layout';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { ConnectButton } from '@mysten/dapp-kit';

// Contract addresses - redeployed January 5, 2026
const BETTING_PACKAGE_ID = import.meta.env.VITE_BETTING_PACKAGE_ID || '0xfaf371c3c9fe2544cc1ce9a40b07621503b300bf3a65b8fab0dba134636e8b32';
const BETTING_PLATFORM_ID = import.meta.env.VITE_BETTING_PLATFORM_ID || '0xae1b0dfed589c6ce5b7dafdb7477954670f0f73530668b5476e3a429b64099b3';
const ADMIN_CAP_ID = '0xaec276da96bc9fb7781213f3aedb18eacf30af1932dc577abbe5529583251827';
const CLOCK_OBJECT_ID = '0x6';
const SBETS_TOKEN_TYPE = '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS';

// Admin wallet address
const ADMIN_WALLET = '0x20850db591c4d575b5238baf975e54580d800e69b8b5b421de796a311d3bea50';

interface Bet {
  id: string;
  dbId: number;
  userId: number;
  walletAddress: string;
  eventId: string;
  eventName: string;
  selection: string;
  odds: number;
  stake: number;
  potentialWin: number;
  status: string;
  placedAt: string;
  settledAt?: string;
  txHash?: string;
  currency: string;
  betType: string;
  platformFee?: number;
  networkFee?: number;
}

interface Stats {
  total: number;
  pending: number;
  won: number;
  lost: number;
  void: number;
  totalStake: number;
  totalPotentialWin: number;
}

interface PlatformInfo {
  treasurySui: number;
  treasurySbets: number;
  totalVolumeSui: number;
  totalVolumeSbets: number;
  totalPotentialLiabilitySui: number;
  totalPotentialLiabilitySbets: number;
  accruedFeesSui: number;
  accruedFeesSbets: number;
  platformFeeBps: number;
  totalBets: number;
  paused: boolean;
  minBetSui: number;
  maxBetSui: number;
  minBetSbets: number;
  maxBetSbets: number;
}

export default function AdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [bets, setBets] = useState<Bet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const { toast } = useToast();
  
  // Wallet and blockchain state
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [depositAmount, setDepositAmount] = useState('1');
  const [depositingSui, setDepositingSui] = useState(false);
  const [depositingSbets, setDepositingSbets] = useState(false);
  const [loadingPlatform, setLoadingPlatform] = useState(false);
  const [userSuiBalance, setUserSuiBalance] = useState(0);
  const [userSbetsBalance, setUserSbetsBalance] = useState(0);
  const [newMinBetSui, setNewMinBetSui] = useState('0.02');
  const [newMaxBetSui, setNewMaxBetSui] = useState('15');
  const [newMinBetSbets, setNewMinBetSbets] = useState('100');
  const [newMaxBetSbets, setNewMaxBetSbets] = useState('50000');
  const [updatingLimitsSui, setUpdatingLimitsSui] = useState(false);
  const [updatingLimitsSbets, setUpdatingLimitsSbets] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [triggeringSettlement, setTriggeringSettlement] = useState(false);
  const [withdrawingSuiFees, setWithdrawingSuiFees] = useState(false);
  const [withdrawingSbetsFees, setWithdrawingSbetsFees] = useState(false);
  const [legacyBets, setLegacyBets] = useState<any[]>([]);
  const [loadingLegacy, setLoadingLegacy] = useState(false);

  const isAdminWallet = currentAccount?.address?.toLowerCase() === ADMIN_WALLET.toLowerCase();

  // Debug logging
  console.log('[AdminPanel] Render state:', {
    walletConnected: !!currentAccount?.address,
    walletAddress: currentAccount?.address?.slice(0, 10),
    isAdminWallet,
    platformInfoLoaded: !!platformInfo,
    loadingPlatform
  });

  // Fetch platform info from blockchain
  const fetchPlatformInfo = useCallback(async () => {
    setLoadingPlatform(true);
    try {
      const platformObject = await suiClient.getObject({
        id: BETTING_PLATFORM_ID,
        options: { showContent: true }
      });

      if (platformObject.data?.content && 'fields' in platformObject.data.content) {
        const fields = platformObject.data.content.fields as Record<string, unknown>;
        setPlatformInfo({
          treasurySui: Number(fields.treasury_sui || 0) / 1_000_000_000,
          treasurySbets: Number(fields.treasury_sbets || 0) / 1_000_000_000,
          totalVolumeSui: Number(fields.total_volume_sui || 0) / 1_000_000_000,
          totalVolumeSbets: Number(fields.total_volume_sbets || 0) / 1_000_000_000,
          totalPotentialLiabilitySui: Number(fields.total_potential_liability_sui || 0) / 1_000_000_000,
          totalPotentialLiabilitySbets: Number(fields.total_potential_liability_sbets || 0) / 1_000_000_000,
          accruedFeesSui: Number(fields.accrued_fees_sui || 0) / 1_000_000_000,
          accruedFeesSbets: Number(fields.accrued_fees_sbets || 0) / 1_000_000_000,
          platformFeeBps: Number(fields.platform_fee_bps || 0),
          totalBets: Number(fields.total_bets || 0),
          paused: Boolean(fields.paused),
          minBetSui: Number(fields.min_bet_sui || fields.min_bet || 0) / 1_000_000_000,
          maxBetSui: Number(fields.max_bet_sui || fields.max_bet || 0) / 1_000_000_000,
          minBetSbets: Number(fields.min_bet_sbets || fields.min_bet || 0) / 1_000_000_000,
          maxBetSbets: Number(fields.max_bet_sbets || fields.max_bet || 0) / 1_000_000_000,
        });
      }
    } catch (error) {
      console.error('Failed to fetch platform info:', error);
      toast({ title: 'Error', description: 'Failed to fetch platform info', variant: 'destructive' });
    }
    setLoadingPlatform(false);
  }, [suiClient, toast]);

  // Fetch user balances
  const fetchUserBalances = useCallback(async () => {
    if (!currentAccount?.address) return;
    
    try {
      // Get SUI balance
      const suiBalance = await suiClient.getBalance({
        owner: currentAccount.address,
        coinType: '0x2::sui::SUI'
      });
      setUserSuiBalance(Number(suiBalance.totalBalance) / 1_000_000_000);

      // Get SBETS balance
      const sbetsBalance = await suiClient.getBalance({
        owner: currentAccount.address,
        coinType: SBETS_TOKEN_TYPE
      });
      setUserSbetsBalance(Number(sbetsBalance.totalBalance) / 1_000_000_000);
    } catch (error) {
      console.error('Failed to fetch user balances:', error);
    }
  }, [currentAccount?.address, suiClient]);

  // Deposit SUI liquidity
  const depositSuiLiquidity = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Error', description: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (amount > userSuiBalance - 0.01) {
      toast({ title: 'Error', description: 'Insufficient SUI balance (need gas)', variant: 'destructive' });
      return;
    }

    setDepositingSui(true);
    try {
      const amountMist = Math.floor(amount * 1_000_000_000);
      
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [amountMist]);
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          coin,
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: 'Deposit Successful', 
          description: `Deposited ${amount} SUI to treasury. TX: ${result.digest.slice(0, 10)}...` 
        });
        // Refresh data
        await fetchPlatformInfo();
        await fetchUserBalances();
      }
    } catch (error: unknown) {
      console.error('Deposit failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Deposit Failed', description: errorMessage, variant: 'destructive' });
    }
    setDepositingSui(false);
  };

  // Deposit SBETS liquidity
  const depositSbetsLiquidity = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Error', description: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    if (amount > userSbetsBalance) {
      toast({ title: 'Error', description: 'Insufficient SBETS balance', variant: 'destructive' });
      return;
    }

    setDepositingSbets(true);
    try {
      const amountMist = Math.floor(amount * 1_000_000_000);
      
      // Get SBETS coins
      const coins = await suiClient.getCoins({
        owner: currentAccount.address,
        coinType: SBETS_TOKEN_TYPE,
      });

      if (coins.data.length === 0) {
        throw new Error('No SBETS coins found');
      }

      const tx = new Transaction();
      
      // If we need to merge coins
      if (coins.data.length > 1) {
        const primaryCoin = coins.data[0];
        const otherCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
        tx.mergeCoins(tx.object(primaryCoin.coinObjectId), otherCoins);
        const [sbetsCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [amountMist]);
        
        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity_sbets`,
          arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(BETTING_PLATFORM_ID),
            sbetsCoin,
            tx.object(CLOCK_OBJECT_ID),
          ],
        });
      } else {
        const [sbetsCoin] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [amountMist]);
        
        tx.moveCall({
          target: `${BETTING_PACKAGE_ID}::betting::deposit_liquidity_sbets`,
          arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(BETTING_PLATFORM_ID),
            sbetsCoin,
            tx.object(CLOCK_OBJECT_ID),
          ],
        });
      }

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: 'Deposit Successful', 
          description: `Deposited ${amount} SBETS to treasury. TX: ${result.digest.slice(0, 10)}...` 
        });
        await fetchPlatformInfo();
        await fetchUserBalances();
      }
    } catch (error: unknown) {
      console.error('SBETS deposit failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Deposit Failed', description: errorMessage, variant: 'destructive' });
    }
    setDepositingSbets(false);
  };

  // Update SUI bet limits
  const updateBetLimitsSui = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const minBet = parseFloat(newMinBetSui);
    const maxBet = parseFloat(newMaxBetSui);
    
    if (isNaN(minBet) || minBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid minimum bet', variant: 'destructive' });
      return;
    }
    
    if (isNaN(maxBet) || maxBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid maximum bet', variant: 'destructive' });
      return;
    }
    
    if (minBet >= maxBet) {
      toast({ title: 'Error', description: 'Minimum bet must be less than maximum', variant: 'destructive' });
      return;
    }

    setUpdatingLimitsSui(true);
    try {
      const minBetMist = Math.floor(minBet * 1_000_000_000);
      const maxBetMist = Math.floor(maxBet * 1_000_000_000);
      
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::update_limits_sui`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.u64(minBetMist),
          tx.pure.u64(maxBetMist),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: 'SUI Limits Updated', 
          description: `Min: ${minBet} SUI, Max: ${maxBet} SUI. TX: ${result.digest.slice(0, 10)}...` 
        });
        await fetchPlatformInfo();
      }
    } catch (error: unknown) {
      console.error('Update SUI limits failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Update Failed', description: errorMessage, variant: 'destructive' });
    }
    setUpdatingLimitsSui(false);
  };

  // Update SBETS bet limits
  const updateBetLimitsSbets = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const minBet = parseFloat(newMinBetSbets);
    const maxBet = parseFloat(newMaxBetSbets);
    
    if (isNaN(minBet) || minBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid minimum bet', variant: 'destructive' });
      return;
    }
    
    if (isNaN(maxBet) || maxBet <= 0) {
      toast({ title: 'Error', description: 'Enter a valid maximum bet', variant: 'destructive' });
      return;
    }
    
    if (minBet >= maxBet) {
      toast({ title: 'Error', description: 'Minimum bet must be less than maximum', variant: 'destructive' });
      return;
    }

    setUpdatingLimitsSbets(true);
    try {
      const minBetMist = Math.floor(minBet * 1_000_000_000);
      const maxBetMist = Math.floor(maxBet * 1_000_000_000);
      
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::update_limits_sbets`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.u64(minBetMist),
          tx.pure.u64(maxBetMist),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: 'SBETS Limits Updated', 
          description: `Min: ${minBet} SBETS, Max: ${maxBet} SBETS. TX: ${result.digest.slice(0, 10)}...` 
        });
        await fetchPlatformInfo();
      }
    } catch (error: unknown) {
      console.error('Update SBETS limits failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Update Failed', description: errorMessage, variant: 'destructive' });
    }
    setUpdatingLimitsSbets(false);
  };

  // Toggle platform pause
  const togglePlatformPause = async () => {
    if (!currentAccount?.address || !isAdminWallet) {
      toast({ title: 'Error', description: 'Connect admin wallet first', variant: 'destructive' });
      return;
    }

    const newPausedState = !platformInfo?.paused;
    
    if (!confirm(`Are you sure you want to ${newPausedState ? 'PAUSE' : 'UNPAUSE'} the platform?`)) {
      return;
    }

    setTogglingPause(true);
    try {
      const tx = new Transaction();
      
      tx.moveCall({
        target: `${BETTING_PACKAGE_ID}::betting::set_pause`,
        arguments: [
          tx.object(ADMIN_CAP_ID),
          tx.object(BETTING_PLATFORM_ID),
          tx.pure.bool(newPausedState),
        ],
      });

      toast({ title: 'Signing Transaction', description: 'Please approve in your wallet...' });

      const result = await signAndExecute({ transaction: tx });

      if (result.digest) {
        await suiClient.waitForTransaction({ digest: result.digest });
        toast({ 
          title: newPausedState ? 'Platform Paused' : 'Platform Unpaused', 
          description: `TX: ${result.digest.slice(0, 10)}...` 
        });
        await fetchPlatformInfo();
      }
    } catch (error: unknown) {
      console.error('Toggle pause failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transaction failed';
      toast({ title: 'Toggle Failed', description: errorMessage, variant: 'destructive' });
    }
    setTogglingPause(false);
  };

  // Trigger auto-settlement manually
  const triggerAutoSettlement = async () => {
    const adminPassword = prompt('Enter admin password to trigger auto-settlement:');
    if (!adminPassword) {
      return;
    }

    setTriggeringSettlement(true);
    try {
      const token = getToken();
      const response = await fetch('/api/admin/trigger-settlement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ adminPassword })
      });

      if (response.ok) {
        const result = await response.json();
        toast({ 
          title: 'Settlement Triggered', 
          description: result.message || 'Check server logs for results'
        });
        // Refresh bets after a delay to show updates
        setTimeout(() => fetchBets(), 3000);
      } else {
        const error = await response.json();
        toast({ title: 'Settlement Failed', description: error.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to trigger settlement', variant: 'destructive' });
    }
    setTriggeringSettlement(false);
  };

  // Withdraw SUI fees from contract
  const withdrawSuiFees = async () => {
    if (!platformInfo || platformInfo.accruedFeesSui <= 0) {
      toast({ title: 'No Fees', description: 'No SUI fees available to withdraw', variant: 'destructive' });
      return;
    }

    const amount = platformInfo.accruedFeesSui;
    
    // Prompt for admin password for secure withdrawal
    const adminPassword = prompt(`Enter admin password to withdraw ${amount.toFixed(4)} SUI fees:`);
    if (!adminPassword) {
      return;
    }

    setWithdrawingSuiFees(true);
    try {
      // Send both token and password for dual auth
      const token = getToken();
      const response = await fetch('/api/admin/withdraw-fees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount, adminPassword })
      });

      if (response.ok) {
        const result = await response.json();
        toast({ 
          title: 'SUI Fees Withdrawn', 
          description: `${amount.toFixed(4)} SUI sent. TX: ${result.txHash?.slice(0, 10)}...`
        });
        await fetchPlatformInfo();
      } else {
        const error = await response.json();
        toast({ title: 'Withdrawal Failed', description: error.message || error.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to withdraw SUI fees', variant: 'destructive' });
    }
    setWithdrawingSuiFees(false);
  };

  // Withdraw SBETS fees from contract
  const withdrawSbetsFees = async () => {
    if (!platformInfo || platformInfo.accruedFeesSbets <= 0) {
      toast({ title: 'No Fees', description: 'No SBETS fees available to withdraw', variant: 'destructive' });
      return;
    }

    const amount = platformInfo.accruedFeesSbets;
    
    // Prompt for admin password for secure withdrawal
    const adminPassword = prompt(`Enter admin password to withdraw ${amount.toFixed(4)} SBETS fees:`);
    if (!adminPassword) {
      return;
    }

    setWithdrawingSbetsFees(true);
    try {
      // Send both token and password for dual auth
      const token = getToken();
      const response = await fetch('/api/admin/withdraw-fees-sbets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount, adminPassword })
      });

      if (response.ok) {
        const result = await response.json();
        toast({ 
          title: 'SBETS Fees Withdrawn', 
          description: `${amount.toFixed(4)} SBETS sent. TX: ${result.txHash?.slice(0, 10)}...`
        });
        await fetchPlatformInfo();
      } else {
        const error = await response.json();
        toast({ title: 'Withdrawal Failed', description: error.message || error.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to withdraw SBETS fees', variant: 'destructive' });
    }
    setWithdrawingSbetsFees(false);
  };

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      if (response.ok) {
        const data = await response.json();
        setAuthToken(data.token);
        setIsAuthenticated(true);
        sessionStorage.setItem('adminToken', data.token);
        setPassword('');
        toast({ title: 'Login successful', description: 'Welcome to the admin panel' });
      } else {
        toast({ title: 'Login failed', description: 'Invalid password', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Login failed', variant: 'destructive' });
    }
  };

  const getToken = () => authToken || sessionStorage.getItem('adminToken') || '';

  const fetchBets = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/all-bets?status=${filter}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setBets(data.bets || []);
        setStats(data.stats || null);
      } else if (response.status === 401) {
        setIsAuthenticated(false);
        sessionStorage.removeItem('adminToken');
        setAuthToken('');
      }
    } catch (error) {
      console.error('Failed to fetch bets:', error);
    }
    setLoading(false);
  };

  // Fetch legacy bets without betObjectId (stuck liability)
  const fetchLegacyBets = async () => {
    setLoadingLegacy(true);
    try {
      const response = await fetch('/api/admin/legacy-bets', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setLegacyBets(data.legacyBets || []);
      }
    } catch (error) {
      console.error('Failed to fetch legacy bets:', error);
    }
    setLoadingLegacy(false);
  };

  const settleBet = async (betId: string, outcome: 'won' | 'lost' | 'void') => {
    setSettling(betId);
    try {
      const response = await fetch('/api/admin/settle-bet', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ betId, outcome, adminPassword: getToken(), reason: 'Manual admin settlement' })
      });
      
      if (response.ok) {
        toast({ title: 'Bet settled', description: `Bet ${betId} marked as ${outcome}` });
        fetchBets();
      } else {
        const error = await response.json();
        toast({ title: 'Settlement failed', description: error.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Settlement failed', variant: 'destructive' });
    }
    setSettling(null);
  };

  const settleAllPending = async (outcome: 'won' | 'lost' | 'void') => {
    if (!confirm(`Are you sure you want to settle ALL pending bets as ${outcome.toUpperCase()}?`)) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settle-all', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ outcome })
      });
      
      if (response.ok) {
        const result = await response.json();
        toast({ title: 'All bets settled', description: `${result.settled} bets marked as ${outcome}` });
        fetchBets();
      } else {
        const error = await response.json();
        toast({ title: 'Bulk settlement failed', description: error.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Bulk settlement failed', variant: 'destructive' });
    }
    setLoading(false);
  };

  useEffect(() => {
    const savedToken = sessionStorage.getItem('adminToken');
    if (savedToken) {
      setAuthToken(savedToken);
      setIsAuthenticated(true);
    }
    // Always fetch platform info
    fetchPlatformInfo();
  }, [fetchPlatformInfo]);

  // Sync input values when platform info loads
  useEffect(() => {
    if (platformInfo) {
      setNewMinBetSui(platformInfo.minBetSui.toString());
      setNewMaxBetSui(platformInfo.maxBetSui.toString());
      setNewMinBetSbets(platformInfo.minBetSbets.toString());
      setNewMaxBetSbets(platformInfo.maxBetSbets.toString());
    }
  }, [platformInfo]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchBets();
      fetchLegacyBets();
    }
  }, [isAuthenticated, filter]);

  useEffect(() => {
    if (currentAccount?.address) {
      fetchUserBalances();
    }
  }, [currentAccount?.address, fetchUserBalances]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30" data-testid={`badge-status-${status}`}><AlertCircle className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'won':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30" data-testid={`badge-status-${status}`}><CheckCircle className="w-3 h-3 mr-1" /> Won</Badge>;
      case 'lost':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30" data-testid={`badge-status-${status}`}><XCircle className="w-3 h-3 mr-1" /> Lost</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30" data-testid={`badge-status-${status}`}>{status}</Badge>;
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Shield className="w-8 h-8 text-cyan-400" />
              Admin Panel
            </h1>
            <p className="text-gray-400 mt-1">Manage treasury and bets</p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <ConnectButton />
            {isAuthenticated && (
              <>
                <Button 
                  onClick={() => { fetchBets(); fetchPlatformInfo(); }} 
                  variant="outline" 
                  className="border-cyan-500/30 text-cyan-400"
                  disabled={loading}
                  data-testid="button-refresh"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button 
                  onClick={() => { setIsAuthenticated(false); sessionStorage.removeItem('adminToken'); setAuthToken(''); }} 
                  variant="outline"
                  className="border-red-500/30 text-red-400"
                  data-testid="button-admin-logout"
                >
                  Logout
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Treasury Management Section - Always visible */}
        <Card className="bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border-cyan-500/30 mb-8">
          <CardHeader>
            <CardTitle className="text-xl text-white flex items-center gap-2">
              <Wallet className="w-6 h-6 text-cyan-400" />
              Treasury Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPlatform ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              </div>
            ) : platformInfo ? (
              <div className="space-y-6">
                {/* Platform Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-black/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <Coins className="w-4 h-4" /> SUI Treasury
                    </div>
                    <p className="text-2xl font-bold text-cyan-400" data-testid="treasury-sui">
                      {platformInfo.treasurySui.toFixed(4)} SUI
                    </p>
                    <p className="text-xs text-orange-400 mt-1">
                      Liability: {platformInfo.totalPotentialLiabilitySui.toFixed(4)} SUI
                    </p>
                    <p className="text-xs text-gray-500">
                      Available: {(platformInfo.treasurySui - platformInfo.totalPotentialLiabilitySui).toFixed(4)} SUI
                    </p>
                  </div>
                  <div className="bg-black/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <Coins className="w-4 h-4" /> SBETS Treasury
                    </div>
                    <p className="text-2xl font-bold text-purple-400" data-testid="treasury-sbets">
                      {platformInfo.treasurySbets.toFixed(4)} SBETS
                    </p>
                    <p className="text-xs text-orange-400 mt-1">
                      Liability: {platformInfo.totalPotentialLiabilitySbets.toFixed(4)} SBETS
                    </p>
                    <p className="text-xs text-gray-500">
                      Available: {(platformInfo.treasurySbets - platformInfo.totalPotentialLiabilitySbets).toFixed(4)} SBETS
                    </p>
                  </div>
                  <div className="bg-black/40 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                      <TrendingUp className="w-4 h-4" /> Total Volume
                    </div>
                    <p className="text-lg font-bold text-green-400">
                      {platformInfo.totalVolumeSui.toFixed(2)} SUI
                    </p>
                    <p className="text-sm text-purple-300">
                      {platformInfo.totalVolumeSbets.toFixed(2)} SBETS
                    </p>
                  </div>
                  <div className="bg-black/40 rounded-lg p-4 border border-yellow-500/30">
                    <div className="flex items-center gap-2 text-yellow-400 text-sm mb-1">
                      <DollarSign className="w-4 h-4" /> Withdrawable Revenue
                    </div>
                    <p className="text-lg font-bold text-yellow-400">
                      {platformInfo.accruedFeesSui.toFixed(4)} SUI
                    </p>
                    <p className="text-sm text-purple-300">
                      {platformInfo.accruedFeesSbets.toFixed(4)} SBETS
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Lost bets + 1% win fees
                    </p>
                  </div>
                </div>

                {/* Platform Status */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <Badge className={platformInfo.paused ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}>
                    {platformInfo.paused ? 'Platform Paused' : 'Platform Active'}
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    SUI: {platformInfo.minBetSui}-{platformInfo.maxBetSui}
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    SBETS: {platformInfo.minBetSbets}-{platformInfo.maxBetSbets}
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    Fee: {platformInfo.platformFeeBps / 100}%
                  </Badge>
                  <Badge variant="outline" className="border-gray-600 text-gray-300">
                    Total Bets: {platformInfo.totalBets}
                  </Badge>
                </div>

                {/* Legacy Bets Section - Stuck Liability */}
                {legacyBets.length > 0 && (
                  <div className="mt-6 p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                    <h4 className="text-md font-semibold text-orange-400 mb-3 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Legacy Bets - Stuck On-Chain Liability
                    </h4>
                    <p className="text-gray-400 text-sm mb-3">
                      These bets were placed on-chain but settled via database credits (before betObjectId tracking). 
                      Their liability remains on-chain because the smart contract was never called to settle them.
                      This is phantom liability - it doesn't affect real operations since these bets are already settled.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Legacy Bets</p>
                        <p className="text-lg font-bold text-orange-400">{legacyBets.length}</p>
                      </div>
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Stuck SUI Liability</p>
                        <p className="text-lg font-bold text-cyan-400">
                          {legacyBets.filter(b => b.currency === 'SUI').reduce((sum, b) => sum + (b.potentialWin || 0), 0).toFixed(4)}
                        </p>
                      </div>
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Stuck SBETS Liability</p>
                        <p className="text-lg font-bold text-purple-400">
                          {legacyBets.filter(b => b.currency === 'SBETS').reduce((sum, b) => sum + (b.potentialWin || 0), 0).toFixed(0)}
                        </p>
                      </div>
                      <div className="bg-black/40 rounded p-3">
                        <p className="text-xs text-gray-500">Settlement Status</p>
                        <p className="text-lg font-bold text-gray-400">Off-chain</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700">
                            <th className="text-left py-2 px-2">ID</th>
                            <th className="text-left py-2 px-2">Event</th>
                            <th className="text-left py-2 px-2">Status</th>
                            <th className="text-right py-2 px-2">Stake</th>
                            <th className="text-right py-2 px-2">Potential Payout</th>
                            <th className="text-left py-2 px-2">Currency</th>
                          </tr>
                        </thead>
                        <tbody>
                          {legacyBets.map((bet: any) => (
                            <tr key={bet.id} className="border-b border-gray-800 text-gray-300">
                              <td className="py-2 px-2">{bet.dbId || bet.id}</td>
                              <td className="py-2 px-2 max-w-[150px] truncate">{bet.eventName}</td>
                              <td className="py-2 px-2">
                                <Badge variant="outline" className={
                                  bet.status === 'won' ? 'border-green-500 text-green-400' :
                                  bet.status === 'lost' ? 'border-red-500 text-red-400' :
                                  'border-gray-500 text-gray-400'
                                }>
                                  {bet.status}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-right">{bet.stake?.toFixed(2)}</td>
                              <td className="py-2 px-2 text-right text-orange-400">{bet.potentialWin?.toFixed(2)}</td>
                              <td className="py-2 px-2">{bet.currency}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">
                      Note: The smart contract does not have a direct "adjust liability" function. 
                      To reduce this phantom liability, a contract upgrade would be required to add an admin function for liability adjustment.
                      All new bets (with betObjectId) settle correctly on-chain with proper liability tracking.
                    </p>
                  </div>
                )}

                {/* Deposit Section - Only for Admin Wallet */}
                {currentAccount?.address ? (
                  isAdminWallet ? (
                    <div className="border-t border-cyan-500/20 pt-6 mt-6">
                      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-400" />
                        Admin Wallet Connected
                      </h3>
                      <div className="flex flex-wrap gap-2 text-sm text-gray-400 mb-4">
                        <span>Your SUI Balance: <span className="text-cyan-400 font-medium">{userSuiBalance.toFixed(4)} SUI</span></span>
                        <span>|</span>
                        <span>Your SBETS Balance: <span className="text-purple-400 font-medium">{userSbetsBalance.toFixed(4)} SBETS</span></span>
                      </div>
                      
                      <div className="flex flex-wrap gap-4 items-end">
                        <div className="flex-1 min-w-[200px]">
                          <label className="text-sm text-gray-400 mb-2 block">Amount to Deposit</label>
                          <Input
                            type="number"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            placeholder="Enter amount"
                            className="bg-black/40 border-gray-700 text-white"
                            min="0.1"
                            step="0.1"
                            data-testid="input-deposit-amount"
                          />
                        </div>
                        <Button
                          onClick={depositSuiLiquidity}
                          disabled={depositingSui || depositingSbets}
                          className="bg-cyan-600 hover:bg-cyan-700 text-white min-w-[150px]"
                          data-testid="button-deposit-sui"
                        >
                          {depositingSui ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <Coins className="w-4 h-4 mr-2" />
                          )}
                          Deposit SUI
                        </Button>
                        <Button
                          onClick={depositSbetsLiquidity}
                          disabled={depositingSui || depositingSbets || userSbetsBalance === 0}
                          className="bg-purple-600 hover:bg-purple-700 text-white min-w-[150px]"
                          data-testid="button-deposit-sbets"
                        >
                          {depositingSbets ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <Coins className="w-4 h-4 mr-2" />
                          )}
                          Deposit SBETS
                        </Button>
                      </div>
                      
                      {platformInfo.treasurySui === 0 && (
                        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                          <p className="text-yellow-400 text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Treasury is empty! Deposit SUI to enable betting. Recommended: at least 10 SUI to start.
                          </p>
                        </div>
                      )}

                      {/* Bet Limits Controls */}
                      <div className="border-t border-cyan-500/20 pt-6 mt-6">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-cyan-400" />
                          Bet Limits & Platform Controls
                        </h3>
                        
                        {/* SUI Bet Limits */}
                        <div className="mb-6 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
                          <h4 className="text-md font-medium text-cyan-400 mb-3 flex items-center gap-2">
                            <Wallet className="w-4 h-4" />
                            SUI Bet Limits
                          </h4>
                          <div className="flex flex-wrap gap-4 items-end">
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Min Bet (SUI)</label>
                              <Input
                                type="number"
                                value={newMinBetSui}
                                onChange={(e) => setNewMinBetSui(e.target.value)}
                                placeholder="0.02"
                                className="bg-black/40 border-gray-700 text-white"
                                min="0.01"
                                step="0.01"
                                data-testid="input-min-bet-sui"
                              />
                            </div>
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Max Bet (SUI)</label>
                              <Input
                                type="number"
                                value={newMaxBetSui}
                                onChange={(e) => setNewMaxBetSui(e.target.value)}
                                placeholder="15"
                                className="bg-black/40 border-gray-700 text-white"
                                min="1"
                                step="0.1"
                                data-testid="input-max-bet-sui"
                              />
                            </div>
                            <Button
                              onClick={updateBetLimitsSui}
                              disabled={updatingLimitsSui}
                              className="bg-cyan-600 hover:bg-cyan-700 text-white min-w-[140px]"
                              data-testid="button-update-limits-sui"
                            >
                              {updatingLimitsSui ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : (
                                <TrendingUp className="w-4 h-4 mr-2" />
                              )}
                              Update SUI
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Current: Min {platformInfo.minBetSui} SUI | Max {platformInfo.maxBetSui} SUI
                          </p>
                        </div>
                        
                        {/* SBETS Bet Limits */}
                        <div className="mb-6 p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                          <h4 className="text-md font-medium text-purple-400 mb-3 flex items-center gap-2">
                            <Coins className="w-4 h-4" />
                            SBETS Bet Limits
                          </h4>
                          <div className="flex flex-wrap gap-4 items-end">
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Min Bet (SBETS)</label>
                              <Input
                                type="number"
                                value={newMinBetSbets}
                                onChange={(e) => setNewMinBetSbets(e.target.value)}
                                placeholder="100"
                                className="bg-black/40 border-gray-700 text-white"
                                min="1"
                                step="1"
                                data-testid="input-min-bet-sbets"
                              />
                            </div>
                            <div className="flex-1 min-w-[100px]">
                              <label className="text-sm text-gray-400 mb-2 block">Max Bet (SBETS)</label>
                              <Input
                                type="number"
                                value={newMaxBetSbets}
                                onChange={(e) => setNewMaxBetSbets(e.target.value)}
                                placeholder="50000"
                                className="bg-black/40 border-gray-700 text-white"
                                min="100"
                                step="100"
                                data-testid="input-max-bet-sbets"
                              />
                            </div>
                            <Button
                              onClick={updateBetLimitsSbets}
                              disabled={updatingLimitsSbets}
                              className="bg-purple-600 hover:bg-purple-700 text-white min-w-[140px]"
                              data-testid="button-update-limits-sbets"
                            >
                              {updatingLimitsSbets ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : (
                                <TrendingUp className="w-4 h-4 mr-2" />
                              )}
                              Update SBETS
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Current: Min {platformInfo.minBetSbets} SBETS | Max {platformInfo.maxBetSbets} SBETS
                          </p>
                        </div>
                        
                        {/* Platform Pause Control */}
                        <div className="flex flex-wrap gap-4 items-center">
                          <Button
                            onClick={togglePlatformPause}
                            disabled={togglingPause}
                            className={platformInfo.paused 
                              ? "bg-green-600 hover:bg-green-700 text-white" 
                              : "bg-red-600 hover:bg-red-700 text-white"}
                            data-testid="button-toggle-pause"
                          >
                            {togglingPause ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : platformInfo.paused ? (
                              <CheckCircle className="w-4 h-4 mr-2" />
                            ) : (
                              <XCircle className="w-4 h-4 mr-2" />
                            )}
                            {platformInfo.paused ? 'Unpause Platform' : 'Pause Platform'}
                          </Button>
                          <span className="text-sm text-gray-400">
                            Platform Status: {platformInfo.paused ? 'PAUSED' : 'ACTIVE'}
                          </span>
                        </div>
                      </div>

                      {/* Settlement & Revenue Controls */}
                      <div className="border-t border-cyan-500/20 pt-6 mt-6">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                          <DollarSign className="w-5 h-5 text-yellow-400" />
                          Settlement & Revenue
                        </h3>
                        
                        <div className="flex flex-wrap gap-4 items-center mb-4">
                          <Button
                            onClick={triggerAutoSettlement}
                            disabled={triggeringSettlement}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            data-testid="button-trigger-settlement"
                          >
                            {triggeringSettlement ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <RefreshCw className="w-4 h-4 mr-2" />
                            )}
                            Trigger Auto-Settlement
                          </Button>
                          <span className="text-sm text-gray-400">
                            Checks finished matches and settles pending bets
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-4 items-end">
                          <Button
                            onClick={withdrawSuiFees}
                            disabled={withdrawingSuiFees || platformInfo.accruedFeesSui <= 0}
                            className="bg-cyan-600 hover:bg-cyan-700 text-white"
                            data-testid="button-withdraw-sui-fees"
                          >
                            {withdrawingSuiFees ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <Coins className="w-4 h-4 mr-2" />
                            )}
                            Withdraw SUI Fees ({platformInfo.accruedFeesSui.toFixed(4)})
                          </Button>
                          <Button
                            onClick={withdrawSbetsFees}
                            disabled={withdrawingSbetsFees || platformInfo.accruedFeesSbets <= 0}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            data-testid="button-withdraw-sbets-fees"
                          >
                            {withdrawingSbetsFees ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <Coins className="w-4 h-4 mr-2" />
                            )}
                            Withdraw SBETS Fees ({platformInfo.accruedFeesSbets.toFixed(4)})
                          </Button>
                        </div>
                        
                        <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                          <h4 className="text-sm font-medium text-white mb-2">How Revenue Works:</h4>
                          <ul className="text-xs text-gray-400 space-y-1">
                            <li>Lost bets: Full stake becomes withdrawable revenue</li>
                            <li>Won bets: 1% fee on profit becomes withdrawable revenue</li>
                            <li>Winners are paid automatically from treasury when bets settle</li>
                            <li>Revenue is sent to the admin wallet that owns AdminCap</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t border-red-500/20 pt-6 mt-6">
                      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-red-400 flex items-center gap-2">
                          <XCircle className="w-5 h-5" />
                          Wrong wallet connected. Connect the admin wallet to deposit liquidity.
                        </p>
                        <p className="text-gray-500 text-sm mt-2">
                          Admin wallet: {ADMIN_WALLET.slice(0, 10)}...{ADMIN_WALLET.slice(-8)}
                        </p>
                        <p className="text-gray-500 text-sm">
                          Connected: {currentAccount.address.slice(0, 10)}...{currentAccount.address.slice(-8)}
                        </p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="border-t border-gray-700 pt-6 mt-6">
                    <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg text-center">
                      <p className="text-gray-400 mb-3">Connect your admin wallet to deposit liquidity</p>
                      <ConnectButton />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400">Failed to load platform info</p>
            )}
          </CardContent>
        </Card>

        {/* Admin Login Section */}
        {!isAuthenticated ? (
          <Card className="w-full max-w-md mx-auto bg-black/60 border-cyan-500/30">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-cyan-400" />
              </div>
              <CardTitle className="text-2xl text-white">Bet Management</CardTitle>
              <p className="text-gray-400 mt-2">Enter password to manage bets</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type="password"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="pl-10 bg-black/40 border-gray-700 text-white"
                  data-testid="input-admin-password"
                />
              </div>
              <Button 
                onClick={handleLogin} 
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
                data-testid="button-admin-login"
              >
                Login
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
                <Card className="bg-black/40 border-gray-700">
                  <CardContent className="p-4 text-center">
                    <p className="text-gray-400 text-sm">Total Bets</p>
                    <p className="text-2xl font-bold text-white" data-testid="stat-total">{stats.total}</p>
                  </CardContent>
                </Card>
                <Card className="bg-yellow-500/10 border-yellow-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-yellow-400 text-sm">Pending</p>
                    <p className="text-2xl font-bold text-yellow-300" data-testid="stat-pending">{stats.pending}</p>
                  </CardContent>
                </Card>
                <Card className="bg-green-500/10 border-green-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-green-400 text-sm">Won</p>
                    <p className="text-2xl font-bold text-green-300" data-testid="stat-won">{stats.won}</p>
                  </CardContent>
                </Card>
                <Card className="bg-red-500/10 border-red-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-red-400 text-sm">Lost</p>
                    <p className="text-2xl font-bold text-red-300" data-testid="stat-lost">{stats.lost}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gray-500/10 border-gray-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-gray-400 text-sm">Void</p>
                    <p className="text-2xl font-bold text-gray-300" data-testid="stat-void">{stats.void}</p>
                  </CardContent>
                </Card>
                <Card className="bg-purple-500/10 border-purple-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-purple-400 text-sm">Total Stake</p>
                    <p className="text-xl font-bold text-purple-300" data-testid="stat-total-stake">{stats.totalStake.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card className="bg-cyan-500/10 border-cyan-500/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-cyan-400 text-sm">Potential Win</p>
                    <p className="text-xl font-bold text-cyan-300" data-testid="stat-potential-win">{stats.totalPotentialWin.toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {stats && stats.pending > 0 && (
              <Card className="bg-yellow-500/10 border-yellow-500/30 mb-6">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-yellow-400">Bulk Settlement</h3>
                      <p className="text-yellow-300/70 text-sm">{stats.pending} pending bets can be settled</p>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => settleAllPending('won')} 
                        className="bg-green-600 hover:bg-green-700"
                        disabled={loading}
                        data-testid="button-settle-all-won"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" /> Settle All Won
                      </Button>
                      <Button 
                        onClick={() => settleAllPending('lost')} 
                        className="bg-red-600 hover:bg-red-700"
                        disabled={loading}
                        data-testid="button-settle-all-lost"
                      >
                        <XCircle className="w-4 h-4 mr-2" /> Settle All Lost
                      </Button>
                      <Button 
                        onClick={() => settleAllPending('void')} 
                        variant="outline"
                        className="border-gray-500 text-gray-300"
                        disabled={loading}
                        data-testid="button-settle-all-void"
                      >
                        Void All
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2 mb-6 flex-wrap">
              {['all', 'pending', 'won', 'lost', 'void'].map((status) => (
                <Button
                  key={status}
                  onClick={() => setFilter(status)}
                  variant={filter === status ? 'default' : 'outline'}
                  className={filter === status ? 'bg-cyan-600' : 'border-gray-600 text-gray-300'}
                  data-testid={`filter-${status}`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              </div>
            ) : bets.length === 0 ? (
              <Card className="bg-black/40 border-gray-700">
                <CardContent className="p-12 text-center">
                  <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                  <p className="text-gray-400">No bets found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {bets.map((bet) => (
                  <Card key={bet.id} className="bg-black/40 border-gray-700 hover:border-cyan-500/30 transition-colors" data-testid={`bet-card-${bet.id}`}>
                    <CardContent className="p-4">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            {getStatusBadge(bet.status)}
                            <Badge variant="outline" className="border-gray-600 text-gray-400">
                              {bet.betType}
                            </Badge>
                            <span className="text-gray-500 text-sm">ID: {bet.id}</span>
                          </div>
                          <h3 className="text-white font-medium">{bet.eventName}</h3>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <span className="text-gray-400">Selection: <span className="text-cyan-400">{bet.selection}</span></span>
                            <span className="text-gray-400">Odds: <span className="text-white">{bet.odds?.toFixed(2)}</span></span>
                            <span className="text-gray-400">Stake: <span className="text-green-400">{bet.stake?.toFixed(2)} {bet.currency}</span></span>
                            <span className="text-gray-400">Potential: <span className="text-yellow-400">{bet.potentialWin?.toFixed(2)} {bet.currency}</span></span>
                          </div>
                          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                            <span>Wallet: {bet.walletAddress?.slice(0, 10)}...</span>
                            <span>Placed: {new Date(bet.placedAt).toLocaleString()}</span>
                            {bet.settledAt && <span>Settled: {new Date(bet.settledAt).toLocaleString()}</span>}
                          </div>
                        </div>
                        
                        {bet.status === 'pending' && (
                          <div className="flex gap-2 flex-shrink-0">
                            <Button
                              onClick={() => settleBet(bet.id, 'won')}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              disabled={settling === bet.id}
                              data-testid={`settle-won-${bet.id}`}
                            >
                              {settling === bet.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            </Button>
                            <Button
                              onClick={() => settleBet(bet.id, 'lost')}
                              size="sm"
                              className="bg-red-600 hover:bg-red-700"
                              disabled={settling === bet.id}
                              data-testid={`settle-lost-${bet.id}`}
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                            <Button
                              onClick={() => settleBet(bet.id, 'void')}
                              size="sm"
                              variant="outline"
                              className="border-gray-500"
                              disabled={settling === bet.id}
                              data-testid={`settle-void-${bet.id}`}
                            >
                              Void
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
