import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState, lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";

// Main pages - unified SuiBets design
import CleanHome from "@/pages/clean-home";
import Match from "@/pages/match";
import MatchDetail from "@/pages/match-detail";
import Promotions from "@/pages/promotions";
import ReferralPage from "@/pages/promotions/referral";
import Notifications from "@/pages/notifications";
import Settings from "@/pages/settings";
import WalletDashboard from "@/pages/wallet-dashboard";
import NotFound from "@/pages/not-found";
import Info from "@/pages/info";
import Community from "@/pages/community";
import Contact from "@/pages/contact";
import LiveEventPage from "@/pages/live/[id]";

// Context providers and shared components
import { AuthProvider } from "@/context/AuthContext";
import { BlockchainAuthProvider } from "@/hooks/useBlockchainAuth";
import { ZkLoginProvider } from "@/context/ZkLoginContext";
import { BettingProvider } from "@/context/BettingContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { WalProvider } from "@/components/ui/wal-components";
import { WalrusProtocolProvider } from "@/context/WalrusProtocolContext";
import { SpecialLinks } from "@/components/ui/SpecialLinks";
import { UniversalClickHandler } from "@/components/betting/UniversalClickHandler";
import { SportBettingWrapper } from "@/components/betting/SportBettingWrapper";
import { SuiDappKitProvider } from "@/components/wallet/SuiDappKitProvider";
import { BetSlip } from "@/components/betting/BetSlip";

// Core functionality pages
import SportsLive from "@/pages/sports-live";
import BetHistoryPage from "@/pages/bet-history";
import DividendsReal from "@/pages/dividends-real";
import RevenuePage from "@/pages/revenue";
import SportPage from "@/pages/sports-live/[sport]";
import StoragePage from "@/pages/storage";
import LiveScoresPage from "@/pages/live-scores";
import ParlayPageNew from "@/pages/parlay";
import Layout from "@/components/layout/Layout";
import JoinPage from "@/pages/join";
import LiveEventsPage from "@/pages/live-events";
import UpcomingEventsPage from "@/pages/upcoming-events";
import ResultsPage from "@/pages/results";
import ActivityPage from "@/pages/activity";
import DepositsWithdrawalsPage from "@/pages/deposits-withdrawals";
import WhitepaperPage from "@/pages/whitepaper";
import StakingPage from "@/pages/staking";
import NetworkPage from "@/pages/network";
import AdminPanel from "@/pages/admin-panel";
import SharedBetPage from "@/pages/shared-bet";
import WalrusReceiptPage from "@/pages/walrus-receipt";
import StreamingPage from "@/pages/streaming";
import AuthCallback from "@/pages/auth-callback";
const TradingPage = lazy(() => import("@/pages/trading"));

// Informational Pages
import PrivacyPolicy from "@/pages/privacy";
import FAQPage from "@/pages/faq";
import LeaderboardPage from "@/pages/leaderboard";
import ResponsibleGambling from "@/pages/responsible";
import RulesPage from "@/pages/rules";
import IntegrityPage from "@/pages/integrity";
import AffiliatePage from "@/pages/affiliate";
import BlogPage from "@/pages/blog";
import { SessionTimer } from "@/components/ResponsibleGaming";

function GlobalWalletModal() {
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
    };
    window.addEventListener('suibets:connect-wallet-required', handler);
    return () => window.removeEventListener('suibets:connect-wallet-required', handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = () => setIsOpen(false);
    window.addEventListener('suibets:wallet-connected', handler);
    return () => window.removeEventListener('suibets:wallet-connected', handler);
  }, [isOpen]);
  
  return <ConnectWalletModal isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}

function App() {
  console.log("Starting React application");
  
  // Capture referral code from URL on app load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    
    if (refCode) {
      // Store referral code in localStorage for later use when user connects wallet
      localStorage.setItem('suibets_referral_code', refCode.toUpperCase());
      console.log(`[REFERRAL] Captured referral code from URL: ${refCode.toUpperCase()}`);
    }
  }, []);
  
  // Log wallet detection on app start (with delay for extension injection)
  useEffect(() => {
    const checkWallets = () => {
      console.log("Checking for installed wallets...");
      const win = window as any;
      
      const hasSlush = typeof win.slush !== 'undefined' || typeof win.suiWallet !== 'undefined';
      // Comprehensive Nightly detection - check multiple injection points
      const hasNightly = typeof win.nightly !== 'undefined' || 
                         typeof win.nightly?.sui !== 'undefined' ||
                         typeof win.nightly?.wallets !== 'undefined' ||
                         (win.navigator?.wallets && Array.from(win.navigator.wallets || []).some((w: any) => 
                           w?.name?.toLowerCase().includes('nightly')));
      const hasSuietWallet = typeof win.suiet !== 'undefined';
      const hasEthosWallet = typeof win.ethos !== 'undefined';
      const hasMartianWallet = typeof win.martian !== 'undefined';
      const hasWalletStandard = typeof win.walletStandard !== 'undefined';
      
      // Also check Wallet Standard registry for all Sui wallets
      const walletStandardWallets: string[] = [];
      if (win.navigator?.wallets) {
        try {
          for (const wallet of win.navigator.wallets) {
            if (wallet?.name) walletStandardWallets.push(wallet.name);
          }
        } catch (e) { /* ignore */ }
      }
      
      console.log("Wallet detection:", {
        slush: hasSlush,
        nightly: hasNightly,
        suiet: hasSuietWallet,
        ethos: hasEthosWallet,
        martian: hasMartianWallet,
        walletStandard: hasWalletStandard,
        walletStandardWallets
      });
      
      // Log raw window.nightly object for debugging
      if (win.nightly) {
        console.log("Nightly wallet object found:", Object.keys(win.nightly));
      }
    };
    
    // Delay to allow extensions time to inject their APIs
    setTimeout(checkWallets, 1500);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        {/* SuiDappKitProvider - single source of truth for Sui wallet connection */}
        <SuiDappKitProvider>
          <WalProvider>
              <WalrusProtocolProvider>
                <BlockchainAuthProvider>
                  <ZkLoginProvider>
                  <AuthProvider>
                    <SettingsProvider>
                      <BettingProvider>
                        <div className="root-container">
                          <UniversalClickHandler />
                          <Switch>
                          {/* Main Routes - Unified SuiBets design */}
                          <Route path="/" component={CleanHome} />
                          <Route path="/sports" component={CleanHome} />
                          <Route path="/sport/:slug*" component={SportsLive} />
                          <Route path="/match/:id" component={Match} />
                          <Route path="/match-detail/:id" component={MatchDetail} />
                          <Route path="/live" component={LiveEventsPage} />
                          <Route path="/live/:id" component={LiveEventPage} />
                          <Route path="/live-events" component={LiveEventsPage} />
                          <Route path="/upcoming-events" component={UpcomingEventsPage} />
                          
                          {/* Core Pages */}
                          <Route path="/promotions" component={Promotions} />
                          <Route path="/results" component={ResultsPage} />
                          <Route path="/promotions/referral" component={ReferralPage} />
                          <Route path="/notifications" component={Notifications} />
                          <Route path="/bet-history" component={BetHistoryPage} />
                          <Route path="/dividends" component={DividendsReal} />
                          <Route path="/revenue" component={RevenuePage} />
                          <Route path="/leaderboard" component={LeaderboardPage} />
                          <Route path="/storage" component={StoragePage} />
                          <Route path="/live-scores" component={LiveScoresPage} />
                          
                          {/* Wallet & User Pages */}
                          <Route path="/wallet-dashboard" component={WalletDashboard} />
                          <Route path="/dashboard" component={WalletDashboard} />
                          <Route path="/activity" component={ActivityPage} />
                          <Route path="/deposits-withdrawals" component={DepositsWithdrawalsPage} />
                          <Route path="/staking" component={StakingPage} />
                          <Route path="/whitepaper" component={WhitepaperPage} />
                          <Route path="/network" component={NetworkPage} />
                          <Route path="/join" component={JoinPage} />
                          
                          {/* Info Pages */}
                          <Route path="/info" component={Info} />
                          <Route path="/community" component={Community} />
                          <Route path="/contact" component={Contact} />
                          <Route path="/privacy" component={PrivacyPolicy} />
                          <Route path="/faq" component={FAQPage} />
                          <Route path="/responsible" component={ResponsibleGambling} />
                          <Route path="/rules" component={RulesPage} />
                          <Route path="/integrity" component={IntegrityPage} />
                          <Route path="/affiliate" component={AffiliatePage} />
                          <Route path="/blog" component={BlogPage} />
                          
                          {/* Sports Pages */}
                          <Route path="/sports-live" component={SportsLive} />
                          <Route path="/sports-live/:sport" component={SportPage} />
                          <Route path="/parlay" component={ParlayPageNew} />
                          
                          {/* Legacy redirects to main pages */}
                          <Route path="/goto-sports" component={CleanHome} />
                          <Route path="/goto-live" component={LiveEventsPage} />
                          <Route path="/home-real" component={CleanHome} />
                          <Route path="/live-real" component={LiveEventsPage} />
                          
                          {/* Shared Bet Page */}
                          <Route path="/bet/:id" component={SharedBetPage} />
                          
                          {/* Walrus Receipt Page */}
                          <Route path="/walrus-receipt/:blobId" component={WalrusReceiptPage} />
                          
                          {/* Streaming */}
                          <Route path="/streaming" component={StreamingPage} />
                          
                          {/* Bluefin Trade Integration */}
                          <Route path="/trading">
                            <ErrorBoundary>
                              <Suspense fallback={<div style={{color:"#fff",textAlign:"center",paddingTop:"4rem"}}>Loading...</div>}>
                                <TradingPage />
                              </Suspense>
                            </ErrorBoundary>
                          </Route>
                          
                          {/* zkLogin OAuth Callback */}
                          <Route path="/auth/callback" component={AuthCallback} />
                          
                          {/* Admin Panel - Password Protected */}
                          <Route path="/admin" component={AdminPanel} />
                          
                          <Route component={NotFound} />
                        </Switch>
                        
                        {/* Universal betting handlers to enable betting across all pages */}
                        <SportBettingWrapper />
                        
                        {/* Floating BetSlip - always visible when bets are selected */}
                        <div className="fixed bottom-4 right-4 w-80 z-50 max-h-[70vh] overflow-auto" data-testid="floating-betslip">
                          <BetSlip />
                        </div>
                      </div>
                      <GlobalWalletModal />
                      <SpecialLinks />
                      <SessionTimer />
                      <Toaster />
                    </BettingProvider>
                    </SettingsProvider>
                  </AuthProvider>
                </ZkLoginProvider>
                </BlockchainAuthProvider>
              </WalrusProtocolProvider>
          </WalProvider>
        </SuiDappKitProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;