import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/hooks/use-toast';
import {
  TrendingUp, Users, Zap, Trophy, Copy, UserPlus,
  ArrowLeft, Clock, Target, ThumbsUp, ThumbsDown,
  Plus, Search, Filter, Flame, Crown, Award,
  BarChart3, Wallet, ExternalLink, RefreshCw, ChevronRight,
  Share2, CheckCircle, XCircle, DollarSign, Star, X,
  MessageCircle, Info, Send, ChevronDown, ChevronUp,
  BookOpen, Globe, Bookmark
} from 'lucide-react';
import { SiX } from 'react-icons/si';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import SuiNSName from '@/components/SuiNSName';
import { formatAddress } from '@/hooks/useSuiNSName';

const suibetsLogo = "/images/suibets-logo.png";

type SubTab = 'home' | 'predict' | 'challenge' | 'social';

type ChatMessage = {
  id: number;
  wallet: string;
  message: string;
  createdAt: string;
};

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'politics', label: 'Politics' },
  { value: 'tech', label: 'Tech' },
  { value: 'sports', label: 'Sports' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'other', label: 'Other' },
];

const BET_AMOUNTS = [100, 500, 1000, 5000, 10000];
const SBETS_TOKEN_TYPE = '0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS';

function formatWallet(wallet: string) {
  if (!wallet) return 'Anonymous';
  return formatAddress(wallet);
}

function timeAgo(date: string | Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function timeLeft(date: string | Date) {
  const diff = new Date(date).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m left`;
}

function formatPool(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toFixed(0);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function getXHandle(wallet: string): string {
  if (!wallet) return '';
  try {
    return localStorage.getItem(`x_handle_${wallet}`) || '';
  } catch { return ''; }
}

function setXHandle(wallet: string, handle: string) {
  if (!wallet) return;
  try {
    localStorage.setItem(`x_handle_${wallet}`, handle);
  } catch {}
}

function CreatePredictionModal({ onClose, wallet }: { onClose: () => void; wallet: string }) {
  const { toast } = useToast();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [endDate, setEndDate] = useState('');
  const [initialAmount, setInitialAmount] = useState('');
  const [initialSide, setInitialSide] = useState<'yes' | 'no'>('yes');

  const { data: treasuryWallet } = useQuery<string>({
    queryKey: ['/api/social/treasury-wallet'],
    queryFn: async () => {
      const res = await fetch('/api/social/treasury-wallet');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      return data.wallet;
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(initialAmount) || 0;
      let txHash: string | undefined;

      if (amount > 0) {
        if (amount < 100) throw new Error('Minimum initial bet is 100 SBETS');
        if (amount > 1000000) throw new Error('Maximum initial bet is 1,000,000 SBETS');
        if (!treasuryWallet) throw new Error('Treasury wallet not available');

        toast({ title: 'Sending SBETS on-chain', description: `Sign the transaction to send ${amount.toLocaleString()} SBETS` });
        const tx = await buildSbetsTransferTx(suiClient, wallet, treasuryWallet, amount);
        const result = await signAndExecute({ transaction: tx } as any);
        if (!result.digest) throw new Error('Transaction failed - no digest returned');
        txHash = result.digest;
        toast({ title: 'SBETS sent on-chain', description: `Verifying... TX: ${txHash.slice(0, 12)}...` });
      }

      const res = await fetch('/api/social/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description, category,
          endDate: new Date(endDate).toISOString(),
          wallet,
          initialAmount: amount > 0 ? amount : undefined,
          initialSide: amount > 0 ? initialSide : undefined,
          txHash: txHash || undefined
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create prediction');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/predictions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/social/predictions/bets'] });
      const amount = parseFloat(initialAmount) || 0;
      const desc = amount > 0
        ? `Your market is live with ${amount.toLocaleString()} SBETS on ${initialSide.toUpperCase()}!`
        : 'Your prediction market is now live!';
      toast({ title: 'Prediction Created', description: desc });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const parsedAmount = parseFloat(initialAmount) || 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose} data-testid="modal-create-prediction">
      <div className="bg-[#0d1117] border border-[#1e3a5f]/50 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl shadow-blue-900/20" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-bold text-white">Create Market</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/5"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-gray-400 text-sm mb-1.5 block font-medium">Question</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Will BTC hit $150k by end of 2026?"
              className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:border-[#4da2ff]/60 focus:outline-none focus:ring-1 focus:ring-[#4da2ff]/20 transition-all"
              data-testid="input-prediction-title"
            />
          </div>
          <div>
            <label className="text-gray-400 text-sm mb-1.5 block font-medium">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add context or rules..."
              className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:border-[#4da2ff]/60 focus:outline-none focus:ring-1 focus:ring-[#4da2ff]/20 transition-all resize-none"
              rows={2}
              data-testid="input-prediction-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-400 text-sm mb-1.5 block font-medium">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white focus:border-[#4da2ff]/60 focus:outline-none"
                data-testid="select-prediction-category"
              >
                {CATEGORIES.filter(c => c.value !== 'all').map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-sm mb-1.5 block font-medium">End Date</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white focus:border-[#4da2ff]/60 focus:outline-none"
                data-testid="input-prediction-enddate"
              />
            </div>
          </div>

          <div className="border border-[#1e3a5f]/30 rounded-xl p-4 space-y-3 bg-[#4da2ff]/5">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <label className="text-gray-300 text-sm font-medium">Initial Bet (optional)</label>
              <span className="text-gray-500 text-xs">Max: 1,000,000 SBETS</span>
            </div>
            <p className="text-gray-500 text-xs">Put SBETS on your prediction to seed the pool</p>
            <input
              type="number"
              value={initialAmount}
              onChange={e => setInitialAmount(e.target.value)}
              placeholder="0"
              min="0"
              max="1000000"
              className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:border-[#4da2ff]/60 focus:outline-none"
              data-testid="input-prediction-initial-amount"
            />
            {parsedAmount > 0 && (
              <div className="flex gap-2">
                <button
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    initialSide === 'yes'
                      ? 'bg-[#22c55e] text-white shadow-lg shadow-green-500/20'
                      : 'bg-[#161b22] text-gray-400 border border-gray-700 hover:border-green-500/40'
                  }`}
                  onClick={() => setInitialSide('yes')}
                  data-testid="button-initial-side-yes"
                >
                  Yes
                </button>
                <button
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    initialSide === 'no'
                      ? 'bg-[#ef4444] text-white shadow-lg shadow-red-500/20'
                      : 'bg-[#161b22] text-gray-400 border border-gray-700 hover:border-red-500/40'
                  }`}
                  onClick={() => setInitialSide('no')}
                  data-testid="button-initial-side-no"
                >
                  No
                </button>
              </div>
            )}
            {parsedAmount > 0 && parsedAmount < 100 && (
              <p className="text-red-400 text-xs">Minimum: 100 SBETS</p>
            )}
            {parsedAmount > 1000000 && (
              <p className="text-red-400 text-xs">Maximum: 1,000,000 SBETS</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button className="flex-1 py-3 rounded-xl border border-[#1e3a5f]/40 text-gray-400 font-medium hover:bg-white/5 transition-colors" onClick={onClose} data-testid="button-cancel-prediction">Cancel</button>
            <button
              className="flex-1 py-3 rounded-xl bg-[#4da2ff] hover:bg-[#3d8ae5] text-white font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => createMutation.mutate()}
              disabled={!title || !endDate || createMutation.isPending || (parsedAmount > 0 && (parsedAmount < 100 || parsedAmount > 1000000))}
              data-testid="button-submit-prediction"
            >
              {createMutation.isPending ? 'Creating...' : parsedAmount > 0 ? `Create + Bet ${parsedAmount.toLocaleString()} SBETS` : 'Create Market'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateChallengeModal({ onClose, wallet }: { onClose: () => void; wallet: string }) {
  const { toast } = useToast();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stakeAmount, setStakeAmount] = useState('100');
  const [currency, setCurrency] = useState('SBETS');
  const [maxParticipants, setMaxParticipants] = useState('10');
  const [expiresAt, setExpiresAt] = useState('');

  const { data: treasuryWallet } = useQuery<string>({
    queryKey: ['/api/social/treasury-wallet'],
    queryFn: async () => {
      const res = await fetch('/api/social/treasury-wallet');
      if (!res.ok) throw new Error('Failed to get treasury wallet');
      const data = await res.json();
      return data.wallet;
    }
  });

  const createChallengeMutation = useMutation({
    mutationFn: async () => {
      const stake = parseFloat(stakeAmount) || 0;
      if (stake < 100) throw new Error('Minimum stake is 100 SBETS');
      if (!expiresAt) throw new Error('Expiry date required');
      if (!treasuryWallet) throw new Error('Treasury wallet not available');

      toast({ title: 'Sending SBETS stake', description: `Sign the transaction to send ${stake} SBETS` });
      const tx = await buildSbetsTransferTx(suiClient, wallet, treasuryWallet, stake);
      const result = await signAndExecute({ transaction: tx } as any);
      if (!result.digest) throw new Error('Transaction failed');
      const txHash = result.digest;

      const res = await fetch('/api/social/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description, stakeAmount: stake, currency,
          maxParticipants: parseInt(maxParticipants) || 10,
          expiresAt: new Date(expiresAt).toISOString(),
          wallet, txHash
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create challenge');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/challenges'] });
      toast({ title: 'Challenge Created', description: 'Your challenge is live!' });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose} data-testid="modal-create-challenge">
      <div className="bg-[#0d1117] border border-[#1e3a5f]/50 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl shadow-blue-900/20" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-bold text-white">Create Challenge</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-gray-400 text-sm mb-1.5 block font-medium">Challenge Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Lakers win tonight" className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:border-[#4da2ff]/60 focus:outline-none" data-testid="input-challenge-title" />
          </div>
          <div>
            <label className="text-gray-400 text-sm mb-1.5 block font-medium">Description (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Add details..." className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:border-[#4da2ff]/60 focus:outline-none resize-none" rows={2} data-testid="input-challenge-description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-400 text-sm mb-1.5 block font-medium">Stake (SBETS)</label>
              <input type="number" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)} className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white focus:border-[#4da2ff]/60 focus:outline-none" data-testid="input-challenge-stake" />
            </div>
            <div>
              <label className="text-gray-400 text-sm mb-1.5 block font-medium">Max Players</label>
              <input type="number" value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white focus:border-[#4da2ff]/60 focus:outline-none" data-testid="input-challenge-max" />
            </div>
          </div>
          <div>
            <label className="text-gray-400 text-sm mb-1.5 block font-medium">Expires At</label>
            <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="w-full bg-[#161b22] border border-[#1e3a5f]/40 rounded-xl px-4 py-3 text-white focus:border-[#4da2ff]/60 focus:outline-none" data-testid="input-challenge-expiry" />
          </div>
          <div className="flex gap-3 pt-2">
            <button className="flex-1 py-3 rounded-xl border border-[#1e3a5f]/40 text-gray-400 font-medium hover:bg-white/5 transition-colors" onClick={onClose} data-testid="button-cancel-challenge">Cancel</button>
            <button
              className="flex-1 py-3 rounded-xl bg-[#f97316] hover:bg-[#ea580c] text-white font-bold transition-colors disabled:opacity-50"
              onClick={() => createChallengeMutation.mutate()}
              disabled={!title || !expiresAt || createChallengeMutation.isPending}
              data-testid="button-submit-challenge"
            >
              {createChallengeMutation.isPending ? 'Creating...' : `Create (${stakeAmount} SBETS)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileModal({ wallet, onClose, myWallet }: { wallet: string; onClose: () => void; myWallet?: string }) {
  const { toast } = useToast();

  const { data: profile, isLoading } = useQuery<any>({
    queryKey: ['/api/social/profile', wallet],
    queryFn: async () => {
      const res = await fetch(`/api/social/profile/${wallet}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!wallet
  });

  const { data: followingList = [] } = useQuery<string[]>({
    queryKey: ['/api/social/following', myWallet],
    queryFn: async () => {
      if (!myWallet) return [];
      const res = await fetch(`/api/social/following?wallet=${myWallet}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!myWallet
  });

  const isFollowing = followingList.includes(wallet?.toLowerCase());

  const followMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/social/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followerWallet: myWallet, followingWallet: wallet })
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/following'] });
      toast({ title: data.action === 'followed' ? 'Following' : 'Unfollowed' });
    }
  });

  const handleCopyWallet = () => {
    copyToClipboard(wallet);
    toast({ title: 'Copied', description: 'Wallet address copied' });
  };

  const handleShareProfileOnX = () => {
    const statsLine = profile ? `Win Rate: ${profile.winRate}% | ${profile.totalBets} bets | ROI: ${profile.roi}%` : '';
    const text = encodeURIComponent(`Check out this bettor on SuiBets!\n${statsLine}\n${window.location.origin}/network`);
    const url = `https://x.com/intent/tweet?text=${text}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose} data-testid="modal-profile">
      <div className="bg-[#0d1117] border border-[#1e3a5f]/50 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {isLoading ? (
          <div className="space-y-3 py-8">
            <Skeleton className="h-10 w-40 bg-gray-800 mx-auto rounded-xl" />
            <Skeleton className="h-20 bg-gray-800 rounded-xl" />
          </div>
        ) : profile ? (
          <>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-[#4da2ff] to-[#7c3aed] rounded-full flex items-center justify-center">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg"><SuiNSName address={wallet} className="text-white font-bold text-lg" /></h3>
                  {profile.loyaltyTier && <Badge className="bg-[#4da2ff]/20 text-[#4da2ff] border-[#4da2ff]/30 text-xs">{profile.loyaltyTier}</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyWallet} className="p-2 rounded-lg bg-[#161b22] text-gray-400 hover:text-white hover:bg-[#1e3a5f]/30 transition-colors" data-testid="button-copy-wallet">
                  <Copy className="h-4 w-4" />
                </button>
                <button onClick={handleShareProfileOnX} className="p-2 rounded-lg bg-[#161b22] text-gray-400 hover:text-white hover:bg-[#1e3a5f]/30 transition-colors" data-testid="button-share-x-profile">
                  <SiX className="h-4 w-4" />
                </button>
                {myWallet && myWallet.toLowerCase() !== wallet.toLowerCase() && (
                  <button
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isFollowing ? 'bg-[#161b22] text-[#4da2ff] border border-[#4da2ff]/30' : 'bg-[#4da2ff] text-white'}`}
                    onClick={() => followMutation.mutate()}
                    disabled={followMutation.isPending}
                    data-testid="button-follow-profile"
                  >
                    {isFollowing ? 'Unfollow' : 'Follow'}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { val: `${profile.roi > 0 ? '+' : ''}${profile.roi}%`, label: 'ROI', color: profile.roi >= 0 ? 'text-green-400' : 'text-red-400' },
                { val: `${profile.winRate}%`, label: 'Win Rate', color: 'text-[#4da2ff]' },
                { val: `${profile.biggestWin} SUI`, label: 'Biggest Win', color: 'text-yellow-400' },
                { val: profile.totalBets, label: 'Total Bets', color: 'text-white' },
              ].map((s, i) => (
                <div key={i} className="bg-[#161b22] border border-[#1e3a5f]/20 rounded-xl p-3 text-center">
                  <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
                  <p className="text-gray-500 text-xs">{s.label}</p>
                </div>
              ))}
            </div>
            {profile.recentBets && profile.recentBets.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-400 mb-3">Recent Bets</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {profile.recentBets.map((bet: any) => (
                    <div key={bet.id} className="flex items-center justify-between p-3 bg-[#161b22] border border-[#1e3a5f]/10 rounded-xl gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{bet.event}</p>
                        <p className="text-gray-500 text-xs">{bet.prediction} @ {bet.odds?.toFixed(2)}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                        bet.status === 'won' || bet.status === 'paid_out' ? 'bg-green-500/10 text-green-400' :
                        bet.status === 'lost' ? 'bg-red-500/10 text-red-400' :
                        'bg-yellow-500/10 text-yellow-400'
                      }`}>{bet.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <Users className="h-12 w-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">Profile not found</p>
          </div>
        )}
        <button className="w-full mt-4 py-3 rounded-xl border border-[#1e3a5f]/40 text-gray-400 font-medium hover:bg-white/5 transition-colors" onClick={onClose} data-testid="button-close-profile">Close</button>
      </div>
    </div>
  );
}

function HomeTab({ onViewProfile }: { onViewProfile: (w: string) => void }) {
  const { toast } = useToast();
  const { data: predictions = [], isLoading: loadingPredictions } = useQuery<any[]>({
    queryKey: ['/api/social/predictions'],
  });

  const { data: challenges = [], isLoading: loadingChallenges } = useQuery<any[]>({
    queryKey: ['/api/social/challenges'],
  });

  const { data: leaderboard } = useQuery<{ leaderboard: any[] }>({
    queryKey: ['/api/leaderboard', 'weekly'],
  });

  const activePredictions = (predictions || []).filter((p: any) => p.status === 'active');
  const trending = [...activePredictions].sort((a, b) => (b.totalParticipants || 0) - (a.totalParticipants || 0)).slice(0, 8);
  const hotChallenges = [...(challenges || [])].filter(c => c.status === 'open').slice(0, 4);
  const topBettors = leaderboard?.leaderboard?.slice(0, 6) || [];

  return (
    <div className="space-y-8" data-testid="tab-home">
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: <Target className="h-6 w-6" />, value: activePredictions.length, label: 'Active Markets', gradient: 'from-[#4da2ff]/20 to-[#4da2ff]/5', iconColor: 'text-[#4da2ff]', border: 'border-[#4da2ff]/20' },
          { icon: <Zap className="h-6 w-6" />, value: challenges?.filter(c => c.status === 'open').length || 0, label: 'Open Challenges', gradient: 'from-[#f97316]/20 to-[#f97316]/5', iconColor: 'text-[#f97316]', border: 'border-[#f97316]/20' },
          { icon: <Users className="h-6 w-6" />, value: topBettors.length, label: 'Top Bettors', gradient: 'from-[#7c3aed]/20 to-[#7c3aed]/5', iconColor: 'text-[#7c3aed]', border: 'border-[#7c3aed]/20' },
        ].map((stat, i) => (
          <div key={i} className={`bg-gradient-to-br ${stat.gradient} ${stat.border} border rounded-2xl p-5 text-center`}>
            <div className={`${stat.iconColor} mx-auto mb-2`}>{stat.icon}</div>
            <p className="text-3xl font-bold text-white">{stat.value}</p>
            <p className="text-gray-400 text-xs mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#4da2ff]" />
            Trending Markets
          </h3>
        </div>
        {loadingPredictions ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-44 bg-[#161b22] rounded-2xl" />)}
          </div>
        ) : trending.length === 0 ? (
          <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-10 text-center">
            <Target className="h-12 w-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No active markets yet. Create one in the Predict tab!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {trending.map((p: any) => {
              const total = (p.totalYesAmount || 0) + (p.totalNoAmount || 0);
              const yesPct = total > 0 ? ((p.totalYesAmount || 0) / total) * 100 : 50;
              return (
                <div
                  key={p.id}
                  className="bg-[#0d1117] border border-[#1e3a5f]/20 hover:border-[#4da2ff]/40 rounded-2xl p-4 transition-all group cursor-pointer"
                  data-testid={`prediction-card-${p.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <p className="text-white font-medium text-sm leading-snug line-clamp-2 flex-1">{p.title}</p>
                    <span className="text-2xl font-bold text-[#4da2ff] shrink-0">{yesPct.toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-[10px] font-semibold text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">Yes</span>
                    <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">No</span>
                  </div>
                  <div className="h-1.5 bg-[#161b22] rounded-full overflow-hidden flex mb-3">
                    <div className="h-full bg-green-500 rounded-l-full transition-all" style={{ width: `${yesPct}%` }} />
                    <div className="h-full bg-red-500/60 rounded-r-full transition-all" style={{ width: `${100 - yesPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{formatPool(total)} SBETS Vol.</span>
                    <span>{timeLeft(p.endDate)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hotChallenges.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-[#f97316]" />
            Hot Challenges
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {hotChallenges.map((c: any) => {
              const fillPct = ((c.currentParticipants || 1) / (c.maxParticipants || 10)) * 100;
              return (
                <div key={c.id} className="bg-[#0d1117] border border-[#f97316]/15 hover:border-[#f97316]/40 rounded-2xl p-4 transition-all" data-testid={`challenge-card-${c.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-white font-medium text-sm flex-1">{c.title}</p>
                    <span className="text-[#f97316] font-bold text-sm">{c.stakeAmount} SBETS</span>
                  </div>
                  <div className="mb-2">
                    <div className="h-1.5 bg-[#161b22] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#f97316] to-[#ef4444] rounded-full" style={{ width: `${fillPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-gray-500 text-xs">{c.currentParticipants || 1}/{c.maxParticipants || 10} players</span>
                      <span className="text-gray-500 text-xs">{timeLeft(c.expiresAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
          <Crown className="h-5 w-5 text-yellow-400" />
          Top Bettors
        </h3>
        {topBettors.length === 0 ? (
          <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-8 text-center">
            <Trophy className="h-10 w-10 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-400">Leaderboard loading...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topBettors.map((user: any, idx: number) => {
              const rankColors = idx === 0 ? 'from-yellow-500 to-amber-500' : idx === 1 ? 'from-gray-300 to-gray-400' : idx === 2 ? 'from-amber-600 to-amber-700' : 'from-[#4da2ff] to-[#7c3aed]';
              return (
                <div
                  key={user.wallet || idx}
                  className="bg-[#0d1117] border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30 rounded-2xl p-4 transition-all cursor-pointer"
                  onClick={() => user.wallet && onViewProfile(user.wallet)}
                  data-testid={`bettor-card-${idx}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 bg-gradient-to-br ${rankColors} rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0`}>
                      #{idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm"><SuiNSName address={user.wallet} className="text-white font-medium text-sm" /></p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold ${(user.totalProfitUsd || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(user.totalProfitUsd || 0) >= 0 ? '+' : ''}${(user.totalProfitUsd || 0).toFixed(2)}
                        </span>
                        <span className="text-gray-500 text-xs">{user.winRate?.toFixed(0)}% WR</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-600 shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

async function buildSbetsTransferTx(
  suiClient: any,
  senderAddress: string,
  recipientAddress: string,
  amount: number
): Promise<Transaction> {
  const tx = new Transaction();
  const amountInSmallest = BigInt(Math.floor(amount * 1_000_000_000));

  let allCoins: any[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const sbetsCoins: any = await suiClient.getCoins({
      owner: senderAddress,
      coinType: SBETS_TOKEN_TYPE,
      ...(cursor ? { cursor } : {}),
    });
    if (sbetsCoins.data && sbetsCoins.data.length > 0) {
      allCoins = allCoins.concat(sbetsCoins.data);
    }
    cursor = sbetsCoins.nextCursor || null;
    hasMore = sbetsCoins.hasNextPage === true && cursor !== null;
  }

  if (allCoins.length === 0) {
    throw new Error('No SBETS tokens found in your wallet. You need SBETS to place prediction bets.');
  }

  const nonZeroCoins = allCoins.filter((c: any) => BigInt(c.balance) > 0);
  const totalBalance = nonZeroCoins.reduce((sum: bigint, c: any) => sum + BigInt(c.balance), BigInt(0));

  if (totalBalance < amountInSmallest) {
    const have = Number(totalBalance) / 1_000_000_000;
    throw new Error(`Insufficient SBETS balance. Need ${amount.toLocaleString()} SBETS but you have ${have.toLocaleString()} SBETS.`);
  }

  const suitableCoin = nonZeroCoins.find((c: any) => BigInt(c.balance) >= amountInSmallest);
  if (suitableCoin) {
    const [splitCoin] = tx.splitCoins(tx.object(suitableCoin.coinObjectId), [amountInSmallest]);
    tx.transferObjects([splitCoin], tx.pure.address(recipientAddress));
  } else {
    const coinIds = nonZeroCoins.map((c: any) => c.coinObjectId);
    const primaryCoin = tx.object(coinIds[0]);
    if (coinIds.length > 1) {
      const otherCoins = coinIds.slice(1).map((id: string) => tx.object(id));
      tx.mergeCoins(primaryCoin, otherCoins);
    }
    const [splitCoin] = tx.splitCoins(primaryCoin, [amountInSmallest]);
    tx.transferObjects([splitCoin], tx.pure.address(recipientAddress));
  }

  return tx;
}

function PredictTab({ wallet }: { wallet?: string }) {
  const { toast } = useToast();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [betAmounts, setBetAmounts] = useState<Record<number, number>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: predictions = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/social/predictions', selectedCategory],
    queryFn: async () => {
      const res = await fetch(`/api/social/predictions?category=${selectedCategory}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    }
  });

  const { data: myBets = [] } = useQuery<any[]>({
    queryKey: ['/api/social/predictions/bets', wallet],
    queryFn: async () => {
      if (!wallet) return [];
      const res = await fetch(`/api/social/predictions/bets?wallet=${wallet}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!wallet
  });

  const { data: treasuryWallet } = useQuery<string>({
    queryKey: ['/api/social/treasury-wallet'],
    queryFn: async () => {
      const res = await fetch('/api/social/treasury-wallet');
      if (!res.ok) throw new Error('Failed to get treasury wallet');
      const data = await res.json();
      return data.wallet;
    }
  });

  const betMutation = useMutation({
    mutationFn: async ({ predictionId, side, amount }: { predictionId: number; side: string; amount: number }) => {
      if (!wallet || !treasuryWallet) {
        throw new Error('Wallet not connected or treasury unavailable');
      }
      toast({ title: 'Sending SBETS on-chain', description: `Sign the transaction to send ${amount} SBETS` });
      const tx = await buildSbetsTransferTx(suiClient, wallet, treasuryWallet, amount);
      const result = await signAndExecute({ transaction: tx } as any);
      if (!result.digest) {
        throw new Error('Transaction failed - no digest returned from wallet');
      }
      const txHash = result.digest;
      toast({ title: 'SBETS sent on-chain', description: `Verifying transaction... TX: ${txHash.slice(0, 12)}...` });
      const res = await fetch(`/api/social/predictions/${predictionId}/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, side, amount, currency: 'SBETS', txHash })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record bet after on-chain transfer');
      }
      return res.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/predictions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/social/predictions/bets'] });
      toast({ title: 'Bet Placed On-Chain', description: `${vars.amount} SBETS on ${vars.side.toUpperCase()} | Verified TX: ${data?.txId?.slice(0, 16)}...` });
    },
    onError: (err: Error) => {
      toast({ title: 'Bet Failed', description: err.message, variant: 'destructive' });
    }
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ predictionId }: { predictionId: number }) => {
      const res = await fetch(`/api/social/predictions/${predictionId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolverWallet: wallet })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to resolve');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/predictions'] });
      const winningSide = data?.winningSide?.toUpperCase() || '?';
      const payoutInfo = data?.payoutResults;
      if (payoutInfo && payoutInfo.successful > 0) {
        toast({ title: `${winningSide} Wins!`, description: `${payoutInfo.successful} winner(s) split ${data.totalPool} SBETS` });
      } else {
        toast({ title: `${winningSide} Wins!`, description: `Pool: ${data?.totalPool || 0} SBETS` });
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const handleBet = (predictionId: number, side: string) => {
    if (!wallet) {
      window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
      return;
    }
    const amount = betAmounts[predictionId] || 100;
    betMutation.mutate({ predictionId, side, amount });
  };

  const getBetAmount = (id: number) => betAmounts[id] || 100;
  const getBetsForPrediction = (predictionId: number) => myBets.filter((b: any) => b.predictionId === predictionId);

  return (
    <div className="space-y-5" data-testid="tab-predict">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                selectedCategory === c.value
                  ? 'bg-[#4da2ff] text-white shadow-lg shadow-[#4da2ff]/20'
                  : 'bg-[#161b22] text-gray-400 hover:text-white hover:bg-[#1e3a5f]/30 border border-[#1e3a5f]/20'
              }`}
              onClick={() => setSelectedCategory(c.value)}
              data-testid={`filter-category-${c.value}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          className="px-5 py-2.5 rounded-xl bg-[#4da2ff] hover:bg-[#3d8ae5] text-white font-bold text-sm transition-colors flex items-center gap-1.5 shadow-lg shadow-[#4da2ff]/20"
          onClick={() => {
            if (!wallet) { window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required')); return; }
            setShowCreate(true);
          }}
          data-testid="button-create-prediction"
        >
          <Plus className="h-4 w-4" />
          Create Market
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-48 bg-[#161b22] rounded-2xl" />)}
        </div>
      ) : predictions.length === 0 ? (
        <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-12 text-center">
          <Target className="h-14 w-14 text-gray-600 mx-auto mb-4" />
          <h3 className="text-white font-bold text-lg mb-2">No markets yet</h3>
          <p className="text-gray-400 text-sm mb-5">Create the first prediction market!</p>
          <button
            className="px-6 py-3 rounded-xl bg-[#4da2ff] hover:bg-[#3d8ae5] text-white font-bold transition-colors"
            onClick={() => {
              if (!wallet) { window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required')); return; }
              setShowCreate(true);
            }}
            data-testid="button-create-first-prediction"
          >
            <Plus className="h-4 w-4 mr-1 inline" />
            Create First Market
          </button>
        </div>
      ) : (() => {
        const activeMarkets = predictions.filter((p: any) => p.status === 'active');
        const finishedMarkets = predictions.filter((p: any) => p.status !== 'active');
        return (
          <div className="space-y-6">
            {activeMarkets.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeMarkets.map((p: any) => {
                  const total = (p.totalYesAmount || 0) + (p.totalNoAmount || 0);
                  const yesPct = total > 0 ? ((p.totalYesAmount || 0) / total) * 100 : 50;
                  const noPct = 100 - yesPct;
                  const isEnded = new Date(p.endDate) <= new Date();
                  const isActive = !isEnded;
                  const canResolve = wallet && isEnded;
                  const currentBetAmount = getBetAmount(p.id);
                  const userBets = getBetsForPrediction(p.id);
                  const isExpanded = expandedId === p.id;

                  return (
                    <div
                      key={p.id}
                      className="bg-[#0d1117] border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30 rounded-2xl overflow-hidden transition-all"
                      data-testid={`prediction-${p.id}`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-white font-medium text-sm leading-snug flex-1 line-clamp-2">{p.title}</p>
                          <button
                            onClick={() => { copyToClipboard(`${window.location.origin}/network?p=${p.id}`); toast({ title: 'Link Copied' }); }}
                            className="text-gray-600 hover:text-[#4da2ff] shrink-0 p-1"
                            data-testid={`share-prediction-${p.id}`}
                          >
                            <Share2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {p.description && <p className="text-gray-500 text-xs mb-2 line-clamp-1">{p.description}</p>}

                        <div className="flex items-center gap-2 mb-3 mt-2">
                          <span className="text-xs px-2 py-0.5 rounded-md bg-[#4da2ff]/10 text-[#4da2ff] font-medium">{p.category}</span>
                          <span className="text-gray-600 text-xs">{p.totalParticipants || 0} bets</span>
                        </div>

                        <div className="h-1.5 bg-[#161b22] rounded-full overflow-hidden flex mb-2">
                          <div className="h-full bg-green-500 rounded-l-full transition-all" style={{ width: `${yesPct}%` }} />
                          <div className="h-full bg-red-500/60 rounded-r-full transition-all" style={{ width: `${noPct}%` }} />
                        </div>

                        {isActive && (
                          <div className="flex gap-2 mb-2">
                            <button
                              className="flex-1 py-2 rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-400 font-bold text-sm border border-green-500/20 hover:border-green-500/40 transition-all"
                              onClick={(e) => { e.stopPropagation(); handleBet(p.id, 'yes'); }}
                              disabled={betMutation.isPending}
                              data-testid={`button-yes-${p.id}`}
                            >
                              Yes {yesPct.toFixed(0)}%
                            </button>
                            <button
                              className="flex-1 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-sm border border-red-500/20 hover:border-red-500/40 transition-all"
                              onClick={(e) => { e.stopPropagation(); handleBet(p.id, 'no'); }}
                              disabled={betMutation.isPending}
                              data-testid={`button-no-${p.id}`}
                            >
                              No {noPct.toFixed(0)}%
                            </button>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>{formatPool(total)} SBETS Vol.</span>
                          <span>{timeLeft(p.endDate)}</span>
                        </div>
                      </div>

                      <div
                        className="border-t border-[#1e3a5f]/10 px-4 py-2 cursor-pointer hover:bg-[#161b22]/50 transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 text-xs">
                            {isActive ? `Bet ${currentBetAmount.toLocaleString()} SBETS` : 'Details'}
                          </span>
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-500" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-500" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-[#1e3a5f]/10 p-4 bg-[#161b22]/30 space-y-3">
                          {isActive && (
                            <div>
                              <span className="text-gray-500 text-xs block mb-2">Bet amount:</span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {BET_AMOUNTS.map(amt => (
                                  <button
                                    key={amt}
                                    onClick={() => setBetAmounts(prev => ({ ...prev, [p.id]: amt }))}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                      currentBetAmount === amt
                                        ? 'bg-[#4da2ff]/20 text-[#4da2ff] border border-[#4da2ff]/40'
                                        : 'bg-[#161b22] text-gray-500 border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30'
                                    }`}
                                    data-testid={`bet-amount-${amt}-${p.id}`}
                                  >
                                    {amt.toLocaleString()}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {canResolve && (
                            <div className="space-y-2">
                              <p className="text-yellow-400 text-xs font-semibold">
                                Expired - {yesPct > 50 ? 'YES' : yesPct < 50 ? 'NO' : 'TIE (YES)'} majority ({total > 0 ? `${Math.max(yesPct, noPct).toFixed(0)}%` : 'none'})
                              </p>
                              <button
                                className="w-full py-2.5 rounded-xl bg-[#4da2ff]/10 text-[#4da2ff] border border-[#4da2ff]/30 font-bold text-sm hover:bg-[#4da2ff]/20 transition-all"
                                onClick={() => resolveMutation.mutate({ predictionId: p.id })}
                                disabled={resolveMutation.isPending}
                                data-testid={`button-resolve-${p.id}`}
                              >
                                {resolveMutation.isPending ? 'Resolving...' : 'Resolve & Pay Winners'}
                              </button>
                            </div>
                          )}

                          {userBets.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-400 mb-2">Your Bets</p>
                              <div className="space-y-1.5">
                                {userBets.map((b: any) => (
                                  <div key={b.id} className="flex items-center justify-between text-xs p-2.5 bg-[#0d1117] rounded-xl border border-[#1e3a5f]/10">
                                    <div className="flex items-center gap-2">
                                      <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${b.side === 'yes' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        {b.side?.toUpperCase()}
                                      </span>
                                      <span className="text-white">{b.amount?.toLocaleString()} SBETS</span>
                                    </div>
                                    <span className="text-gray-500">{timeAgo(b.createdAt)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
                            <span>by <SuiNSName address={p.creatorWallet} /></span>
                            <span>{timeAgo(p.createdAt)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {finishedMarkets.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  <h3 className="text-white font-bold text-lg">Resolved Markets</h3>
                  <span className="text-gray-500 text-sm">({finishedMarkets.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {finishedMarkets.map((p: any) => {
                    const total = (p.totalYesAmount || 0) + (p.totalNoAmount || 0);
                    const yesPct = total > 0 ? ((p.totalYesAmount || 0) / total) * 100 : 50;
                    const noPct = 100 - yesPct;
                    const isResolvedYes = p.status?.includes('resolved_yes');
                    const isResolvedNo = p.status?.includes('resolved_no');
                    const winningSide = isResolvedYes ? 'YES' : isResolvedNo ? 'NO' : null;
                    const winningAmount = isResolvedYes ? (p.totalYesAmount || 0) : isResolvedNo ? (p.totalNoAmount || 0) : 0;
                    const losingAmount = isResolvedYes ? (p.totalNoAmount || 0) : isResolvedNo ? (p.totalYesAmount || 0) : 0;
                    const userBets = getBetsForPrediction(p.id);
                    const userWon = userBets.some((b: any) => winningSide && b.side === winningSide.toLowerCase());
                    const userLost = userBets.some((b: any) => winningSide && b.side !== winningSide.toLowerCase());
                    const userWinningBets = userBets.filter((b: any) => winningSide && b.side === winningSide.toLowerCase());
                    const userPayout = userWinningBets.reduce((sum: number, b: any) => {
                      if (winningAmount <= 0) return sum;
                      return sum + ((b.amount || 0) / winningAmount) * total;
                    }, 0);

                    return (
                      <div key={p.id} className="bg-[#0d1117]/80 border border-gray-800/40 rounded-2xl p-4 opacity-85" data-testid={`finished-prediction-${p.id}`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-gray-300 font-medium text-sm leading-snug flex-1 line-clamp-2">{p.title}</p>
                          {winningSide ? (
                            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${winningSide === 'YES' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {winningSide} Won
                            </span>
                          ) : (
                            <span className="text-xs font-bold px-2 py-1 rounded-lg bg-gray-500/10 text-gray-400">
                              {p.status === 'expired' ? 'Expired' : 'Ended'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mb-2 text-xs">
                          <span className={`font-bold ${isResolvedYes ? 'text-green-400' : 'text-green-400/40'}`}>Yes {yesPct.toFixed(0)}%</span>
                          <span className={`font-bold ${isResolvedNo ? 'text-red-400' : 'text-red-400/40'}`}>No {noPct.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 bg-[#161b22] rounded-full overflow-hidden flex mb-2">
                          <div className={`h-full rounded-l-full ${isResolvedYes ? 'bg-green-500' : 'bg-green-500/20'}`} style={{ width: `${yesPct}%` }} />
                          <div className={`h-full rounded-r-full ${isResolvedNo ? 'bg-red-500' : 'bg-red-500/20'}`} style={{ width: `${noPct}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                          <span>{formatPool(total)} SBETS pool</span>
                          <span>{p.totalParticipants || 0} bets</span>
                        </div>
                        {userBets.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-800/30">
                            {userWon && (
                              <div className="flex items-center gap-1.5 text-xs">
                                <Trophy className="h-3 w-3 text-green-400" />
                                <span className="text-green-400 font-bold">You Won {userPayout > 0 ? `${userPayout.toFixed(0)} SBETS` : ''}</span>
                              </div>
                            )}
                            {userLost && !userWon && (
                              <div className="flex items-center gap-1.5 text-xs">
                                <XCircle className="h-3 w-3 text-red-400" />
                                <span className="text-red-400 font-bold">You Lost</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {showCreate && wallet && <CreatePredictionModal onClose={() => setShowCreate(false)} wallet={wallet} />}
    </div>
  );
}

function ChallengeTab({ wallet }: { wallet?: string }) {
  const { toast } = useToast();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [showCreate, setShowCreate] = useState(false);

  const { data: challenges = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/social/challenges'],
  });

  const { data: treasuryWallet } = useQuery<string>({
    queryKey: ['/api/social/treasury-wallet'],
    queryFn: async () => {
      const res = await fetch('/api/social/treasury-wallet');
      if (!res.ok) throw new Error('Failed to get treasury wallet');
      const data = await res.json();
      return data.wallet;
    }
  });

  const joinMutation = useMutation({
    mutationFn: async ({ challengeId, side, stakeAmount }: { challengeId: number; side: string; stakeAmount: number }) => {
      if (!wallet || !treasuryWallet) {
        throw new Error('Wallet not connected or treasury unavailable');
      }
      toast({ title: 'Sending SBETS stake on-chain', description: `Sign the transaction to send ${stakeAmount} SBETS` });
      const tx = await buildSbetsTransferTx(suiClient, wallet, treasuryWallet, stakeAmount);
      const result = await signAndExecute({ transaction: tx } as any);
      if (!result.digest) {
        throw new Error('Transaction failed - no digest returned from wallet');
      }
      const txHash = result.digest;
      toast({ title: 'SBETS stake sent', description: `Verifying transaction...` });
      const res = await fetch(`/api/social/challenges/${challengeId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, side, txHash })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to join challenge');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/challenges'] });
      toast({ title: 'Challenge Joined', description: 'Your stake has been verified on-chain!' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const handleJoin = (challengeId: number, side: string) => {
    if (!wallet) {
      window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
      return;
    }
    const challenge = challenges.find((c: any) => c.id === challengeId);
    const stakeAmount = challenge?.stakeAmount || 100;
    joinMutation.mutate({ challengeId, side, stakeAmount });
  };

  const openChallenges = challenges.filter(c => c.status === 'open');
  const closedChallenges = challenges.filter(c => c.status !== 'open');

  return (
    <div className="space-y-5" data-testid="tab-challenge">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-[#f97316]" />
            Challenges
          </h3>
          <p className="text-gray-500 text-xs mt-0.5">Create a bet, set your stake, others back or fade you</p>
        </div>
        <button
          className="px-5 py-2.5 rounded-xl bg-[#f97316] hover:bg-[#ea580c] text-white font-bold text-sm transition-colors flex items-center gap-1.5 shadow-lg shadow-[#f97316]/20"
          onClick={() => {
            if (!wallet) { window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required')); return; }
            setShowCreate(true);
          }}
          data-testid="button-create-challenge"
        >
          <Plus className="h-4 w-4" />
          Create Challenge
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-36 bg-[#161b22] rounded-2xl" />)}
        </div>
      ) : openChallenges.length === 0 ? (
        <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-12 text-center">
          <Zap className="h-14 w-14 text-gray-600 mx-auto mb-4" />
          <h3 className="text-white font-bold text-lg mb-2">No open challenges</h3>
          <p className="text-gray-400 text-sm mb-5">Be the first to throw down!</p>
          <button
            className="px-6 py-3 rounded-xl bg-[#f97316] hover:bg-[#ea580c] text-white font-bold transition-colors"
            onClick={() => {
              if (!wallet) { window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required')); return; }
              setShowCreate(true);
            }}
            data-testid="button-create-first-challenge"
          >
            Create First Challenge
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {openChallenges.map((c: any) => {
            const isFull = (c.currentParticipants || 1) >= (c.maxParticipants || 10);
            const isExpired = new Date(c.expiresAt) <= new Date();
            const isCreator = wallet && wallet.toLowerCase() === c.creatorWallet?.toLowerCase();
            const fillPct = ((c.currentParticipants || 1) / (c.maxParticipants || 10)) * 100;
            const totalPool = (c.stakeAmount || 0) * (c.currentParticipants || 1);
            return (
              <div key={c.id} className="bg-[#0d1117] border border-[#f97316]/15 hover:border-[#f97316]/40 rounded-2xl p-4 transition-all" data-testid={`challenge-${c.id}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">{c.title}</p>
                    {c.description && <p className="text-gray-500 text-xs mt-1 line-clamp-1">{c.description}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[#f97316] font-bold text-lg">{c.stakeAmount}</p>
                    <p className="text-gray-600 text-[10px]">SBETS/player</p>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="h-1.5 bg-[#161b22] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#f97316] to-[#ef4444] rounded-full transition-all" style={{ width: `${fillPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-gray-500">{c.currentParticipants || 1}/{c.maxParticipants || 10} players</span>
                    <span className="text-[#f97316] font-bold">{totalPool} SBETS pool</span>
                  </div>
                </div>

                {!isCreator && !isFull && !isExpired && (
                  <div className="flex gap-2 mb-3">
                    <button
                      className="flex-1 py-2 rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-400 font-bold text-sm border border-green-500/20 transition-all"
                      onClick={() => handleJoin(c.id, 'for')}
                      disabled={joinMutation.isPending}
                      data-testid={`button-back-${c.id}`}
                    >
                      Back
                    </button>
                    <button
                      className="flex-1 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-sm border border-red-500/20 transition-all"
                      onClick={() => handleJoin(c.id, 'against')}
                      disabled={joinMutation.isPending}
                      data-testid={`button-fade-${c.id}`}
                    >
                      Fade
                    </button>
                  </div>
                )}

                {(isFull || isExpired) && !isCreator && (
                  <span className="text-gray-500 text-xs font-medium bg-gray-500/10 px-2 py-1 rounded-lg inline-block mb-3">
                    {isFull ? 'Full' : 'Expired'}
                  </span>
                )}
                {isCreator && (
                  <span className="text-[#4da2ff] text-xs font-medium bg-[#4da2ff]/10 px-2 py-1 rounded-lg inline-block mb-3">Your Challenge</span>
                )}

                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>by <SuiNSName address={c.creatorWallet} /></span>
                  <span>{timeLeft(c.expiresAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {closedChallenges.length > 0 && (
        <div>
          <h4 className="text-gray-400 font-semibold mb-3 text-sm">Past Challenges</h4>
          <div className="space-y-2">
            {closedChallenges.slice(0, 5).map((c: any) => (
              <div key={c.id} className="bg-[#0d1117]/60 border border-gray-800/30 rounded-xl p-3 flex items-center justify-between gap-2 opacity-60">
                <p className="text-gray-400 text-sm flex-1 truncate">{c.title}</p>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 text-xs">{c.stakeAmount} SBETS</span>
                  <span className="text-gray-500 text-xs bg-gray-500/10 px-2 py-0.5 rounded">{c.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && wallet && <CreateChallengeModal onClose={() => setShowCreate(false)} wallet={wallet} />}
    </div>
  );
}

function LiveChat({ myWallet }: { myWallet?: string }) {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['/api/social/chat'],
    queryFn: async () => {
      const res = await fetch('/api/social/chat');
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const res = await fetch('/api/social/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: myWallet, message: msg })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to send');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/chat'] });
      setMessage('');
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  const handleSend = () => {
    if (!myWallet) {
      window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
      return;
    }
    if (!message.trim()) return;
    sendMutation.mutate(message.trim());
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e3a5f]/10 flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-[#4da2ff]" />
        <h3 className="text-white font-semibold text-sm">Live Chat</h3>
        <span className="text-gray-600 text-xs">({messages.length})</span>
      </div>
      <div className="h-64 overflow-y-auto p-4 space-y-3" data-testid="chat-messages">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm">No messages yet</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-2.5" data-testid={`chat-message-${msg.id}`}>
              <div className="w-7 h-7 bg-gradient-to-br from-[#4da2ff] to-[#7c3aed] rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <Users className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[#4da2ff] text-xs font-medium"><SuiNSName address={msg.wallet} className="text-[#4da2ff] text-xs font-medium" /></span>
                  <span className="text-gray-600 text-xs">{timeAgo(msg.createdAt)}</span>
                </div>
                <p className="text-gray-300 text-sm break-words">{msg.message}</p>
              </div>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="p-3 border-t border-[#1e3a5f]/10 flex items-center gap-2">
        <input
          type="text"
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={myWallet ? "Type a message..." : "Connect wallet to chat"}
          className="flex-1 bg-[#161b22] border border-[#1e3a5f]/30 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:border-[#4da2ff]/50 focus:outline-none text-sm"
          disabled={!myWallet}
          data-testid="input-chat-message"
        />
        <button
          className="p-2.5 rounded-xl bg-[#4da2ff] hover:bg-[#3d8ae5] text-white transition-colors disabled:opacity-40"
          onClick={handleSend}
          disabled={!myWallet || !message.trim() || sendMutation.isPending}
          data-testid="button-send-chat"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SocialTab({ onViewProfile, myWallet }: { onViewProfile: (w: string) => void; myWallet?: string }) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'all-time'>('weekly');
  const [xInput, setXInput] = useState(() => myWallet ? getXHandle(myWallet) : '');

  const { data: leaderboard, isLoading } = useQuery<{ leaderboard: any[] }>({
    queryKey: ['/api/leaderboard', period],
  });

  const { data: followingList = [] } = useQuery<string[]>({
    queryKey: ['/api/social/following', myWallet],
    queryFn: async () => {
      if (!myWallet) return [];
      const res = await fetch(`/api/social/following?wallet=${myWallet}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!myWallet
  });

  const followMutation = useMutation({
    mutationFn: async (targetWallet: string) => {
      const res = await fetch('/api/social/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followerWallet: myWallet, followingWallet: targetWallet })
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/following'] });
      toast({ title: data.action === 'followed' ? 'Following' : 'Unfollowed' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update follow status', variant: 'destructive' });
    }
  });

  const handleFollow = (targetWallet: string) => {
    if (!myWallet) {
      window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
      return;
    }
    followMutation.mutate(targetWallet);
  };

  const handleSaveXHandle = () => {
    if (!myWallet) return;
    setXHandle(myWallet, xInput);
    toast({ title: 'Saved', description: 'Your X handle has been saved.' });
  };

  const handleShareOnX = () => {
    const xTag = xInput ? ` | ${xInput}` : '';
    const myStats = leaderboard?.leaderboard?.find((u: any) => u.wallet?.toLowerCase() === myWallet?.toLowerCase());
    const statsLine = myStats ? `Win Rate: ${myStats.winRate?.toFixed(0)}% | ${myStats.totalBets} bets` : 'Join me on SuiBets';
    const text = encodeURIComponent(`${statsLine}${xTag}\n\nPredict anything, challenge friends & win SBETS on @SuiBets\n${window.location.origin}/network`);
    const url = `https://x.com/intent/tweet?text=${text}`;
    const win = window.open(url, '_blank');
    if (!win) window.location.href = url;
  };

  const allUsers = leaderboard?.leaderboard || [];
  const filtered = searchQuery
    ? allUsers.filter(u => u.wallet?.toLowerCase().includes(searchQuery.toLowerCase()))
    : allUsers;

  return (
    <div className="space-y-5" data-testid="tab-social">
      {myWallet && (
        <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <SiX className="h-4 w-4 text-white" />
            <h3 className="text-white font-semibold text-sm">X / Twitter</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={xInput}
              onChange={e => setXInput(e.target.value)}
              placeholder="@yourusername"
              className="flex-1 bg-[#161b22] border border-[#1e3a5f]/30 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:border-[#4da2ff]/50 focus:outline-none text-sm"
              data-testid="input-x-handle"
            />
            <button className="px-3 py-2.5 rounded-xl border border-[#1e3a5f]/30 text-gray-400 hover:text-white text-sm hover:bg-white/5 transition-colors" onClick={handleSaveXHandle} data-testid="button-save-x-handle">Save</button>
            <button className="px-3 py-2.5 rounded-xl bg-[#161b22] text-white border border-gray-700 text-sm hover:bg-white/5 transition-colors flex items-center gap-1" onClick={handleShareOnX} data-testid="button-share-on-x">
              <SiX className="h-3.5 w-3.5" />
              Share
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by wallet..."
            className="w-full bg-[#0d1117] border border-[#1e3a5f]/20 rounded-xl pl-10 pr-4 py-3 text-white placeholder-gray-600 focus:border-[#4da2ff]/50 focus:outline-none"
            data-testid="input-search-social"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['weekly', 'monthly', 'all-time'] as const).map(p => (
            <button
              key={p}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                period === p
                  ? 'bg-[#4da2ff] text-white'
                  : 'bg-[#161b22] text-gray-400 hover:text-white border border-[#1e3a5f]/20'
              }`}
              onClick={() => setPeriod(p)}
              data-testid={`period-${p}`}
            >
              {p === 'weekly' ? 'Week' : p === 'monthly' ? 'Month' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {myWallet && followingList.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Following ({followingList.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {followingList.map(w => {
              const wXHandle = getXHandle(w);
              return (
                <div key={w} className="bg-[#0d1117] border border-[#1e3a5f]/20 hover:border-[#4da2ff]/30 rounded-xl p-3 flex items-center justify-between gap-2 cursor-pointer transition-all" onClick={() => onViewProfile(w)}>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-[#4da2ff] to-[#7c3aed] rounded-full flex items-center justify-center">
                      <Users className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <span className="text-white text-sm"><SuiNSName address={w} className="text-white text-sm" /></span>
                      {wXHandle && <p className="text-[#4da2ff] text-xs">@{wXHandle.replace('@', '')}</p>}
                    </div>
                  </div>
                  <button
                    className="px-2.5 py-1.5 rounded-lg border border-[#4da2ff]/30 text-[#4da2ff] text-xs hover:bg-[#4da2ff]/10 transition-colors"
                    onClick={(e) => { e.stopPropagation(); handleFollow(w); }}
                    data-testid={`button-unfollow-${w.slice(0,8)}`}
                  >
                    Unfollow
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          Leaderboard ({period === 'weekly' ? 'This Week' : period === 'monthly' ? 'This Month' : 'All Time'})
        </h3>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 bg-[#161b22] rounded-xl" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-8 text-center">
            <Users className="h-10 w-10 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-400">{searchQuery ? 'No wallets found' : 'No bettors yet'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((user: any, idx: number) => {
              const isFollowing = followingList.includes(user.wallet?.toLowerCase());
              const rankColors = idx === 0 ? 'from-yellow-500 to-amber-500' : idx === 1 ? 'from-gray-300 to-gray-400' : idx === 2 ? 'from-amber-600 to-amber-700' : 'from-[#4da2ff] to-[#7c3aed]';
              const userXHandle = getXHandle(user.wallet || '');
              return (
                <div
                  key={user.wallet || idx}
                  className="bg-[#0d1117] border border-[#1e3a5f]/15 hover:border-[#4da2ff]/30 rounded-xl p-3 flex items-center justify-between gap-3 cursor-pointer transition-all"
                  onClick={() => user.wallet && onViewProfile(user.wallet)}
                  data-testid={`leaderboard-user-${idx}`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-9 h-9 bg-gradient-to-br ${rankColors} rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                      #{idx + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white text-sm font-medium"><SuiNSName address={user.wallet} className="text-white text-sm font-medium" /></p>
                        {userXHandle && <span className="text-[#4da2ff] text-xs">@{userXHandle.replace('@', '')}</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold ${(user.totalProfitUsd || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(user.totalProfitUsd || 0) >= 0 ? '+' : ''}${(user.totalProfitUsd || 0).toFixed(2)}
                        </span>
                        <span className="text-gray-500 text-xs">{user.winRate?.toFixed(0)}% WR</span>
                        <span className="text-gray-600 text-xs">{user.totalBets} bets</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {myWallet && user.wallet && myWallet.toLowerCase() !== user.wallet.toLowerCase() && (
                      <button
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isFollowing ? 'border border-[#4da2ff]/30 text-[#4da2ff] hover:bg-[#4da2ff]/10' : 'bg-[#4da2ff] text-white'
                        }`}
                        onClick={(e) => { e.stopPropagation(); handleFollow(user.wallet); }}
                        data-testid={`button-follow-${idx}`}
                      >
                        {isFollowing ? 'Following' : 'Follow'}
                      </button>
                    )}
                    <ChevronRight className="h-4 w-4 text-gray-600" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <LiveChat myWallet={myWallet} />
    </div>
  );
}

export default function NetworkPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<SubTab>('home');
  const [viewingProfile, setViewingProfile] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const currentAccount = useCurrentAccount();
  const myWallet = currentAccount?.address;

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation('/');
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['/api/social'] });
    queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleConnectWallet = () => {
    window.dispatchEvent(new CustomEvent('suibets:connect-wallet-required'));
  };

  const tabs: { key: SubTab; label: string; icon: JSX.Element }[] = [
    { key: 'home', label: 'Trending', icon: <Flame className="h-4 w-4" /> },
    { key: 'predict', label: 'Markets', icon: <BarChart3 className="h-4 w-4" /> },
    { key: 'challenge', label: 'Challenges', icon: <Zap className="h-4 w-4" /> },
    { key: 'social', label: 'Social', icon: <Users className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#080c14]" data-testid="network-page">
      <nav className="bg-[#0d1117] border-b border-[#1e3a5f]/20 px-4 py-3 sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="p-2 text-gray-400 hover:text-[#4da2ff] hover:bg-[#4da2ff]/10 rounded-xl transition-colors"
              data-testid="btn-back"
            >
              <ArrowLeft size={20} />
            </button>
            <Link href="/" data-testid="link-logo">
              <img src={suibetsLogo} alt="SuiBets" className="h-10 w-auto cursor-pointer" />
            </Link>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-bets">Bets</Link>
            <Link href="/dashboard" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-dashboard">Dashboard</Link>
            <Link href="/bet-history" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-my-bets">My Bets</Link>
            <Link href="/whitepaper" className="text-gray-400 hover:text-[#4da2ff] text-sm font-medium transition-colors" data-testid="nav-whitepaper">Whitepaper</Link>
            <Link href="/network" className="text-[#4da2ff] text-sm font-medium" data-testid="nav-network">Predict</Link>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleRefresh} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors" data-testid="btn-refresh">
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {myWallet ? (
              <SuiNSName address={myWallet} className="text-[#4da2ff] text-sm font-medium" />
            ) : (
              <button onClick={handleConnectWallet} className="bg-[#4da2ff] hover:bg-[#3d8ae5] text-white font-bold px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 shadow-lg shadow-[#4da2ff]/20 transition-colors" data-testid="btn-connect">
                <Wallet size={16} />
                Connect
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">Predict Anything</h1>
            <span className="text-xs font-medium text-[#4da2ff] bg-[#4da2ff]/10 px-2 py-1 rounded-lg">On-Chain</span>
          </div>
          <p className="text-gray-500 text-sm">Create markets, challenge friends, win SBETS - all verified on Sui blockchain</p>
        </div>

        <div className="flex items-center gap-1 bg-[#0d1117] border border-[#1e3a5f]/20 rounded-2xl p-1.5 mb-6">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-[#4da2ff]/15 text-[#4da2ff] border border-[#4da2ff]/30'
                  : 'text-gray-500 hover:text-white hover:bg-white/3'
              }`}
              data-testid={`tab-button-${tab.key}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {!myWallet && (
          <div className="bg-gradient-to-r from-[#4da2ff]/10 to-[#7c3aed]/5 border border-[#4da2ff]/20 rounded-2xl p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-white font-medium">Connect your wallet to participate</p>
              <p className="text-gray-500 text-sm">Create predictions, join challenges, and follow top bettors</p>
            </div>
            <button className="bg-[#4da2ff] hover:bg-[#3d8ae5] text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-[#4da2ff]/20 transition-colors" onClick={handleConnectWallet} data-testid="button-connect-cta">
              <Wallet className="h-4 w-4" />
              Connect Wallet
            </button>
          </div>
        )}

        {activeTab === 'home' && <HomeTab onViewProfile={setViewingProfile} />}
        {activeTab === 'predict' && <PredictTab wallet={myWallet} />}
        {activeTab === 'challenge' && <ChallengeTab wallet={myWallet} />}
        {activeTab === 'social' && <SocialTab onViewProfile={setViewingProfile} myWallet={myWallet} />}
      </div>

      {viewingProfile && (
        <ProfileModal
          wallet={viewingProfile}
          onClose={() => setViewingProfile(null)}
          myWallet={myWallet}
        />
      )}
    </div>
  );
}
