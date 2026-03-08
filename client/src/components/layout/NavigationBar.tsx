import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { ConnectWalletModal } from "@/components/modals/ConnectWalletModal";
import { NotificationsModal } from "@/components/modals/NotificationsModal";
import { SettingsModal } from "@/components/modals/SettingsModal";
import { shortenAddress } from "@/lib/utils";
import { Bell, Settings, LogOut } from "lucide-react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useZkLogin } from "@/context/ZkLoginContext";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NavigationBar = () => {
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated, disconnectWallet } = useAuth();
  const currentAccount = useCurrentAccount();
  const { isZkLoginActive, zkLoginAddress } = useZkLogin();
  const address = currentAccount?.address || (isZkLoginActive ? zkLoginAddress : null);
  const isConnected = !!address;
  const { toast } = useToast();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAttemptingConnection, setIsAttemptingConnection] = useState(false);
  
  // Listen for wallet connection requests from other components
  useEffect(() => {
    const handleWalletConnectionRequired = () => {
      console.log('Wallet connection requested from another component');
      if (!user?.walletAddress) {
        // Open the wallet modal directly
        setIsWalletModalOpen(true);
      }
    };
    
    window.addEventListener('suibets:connect-wallet-required', handleWalletConnectionRequired);
    return () => {
      window.removeEventListener('suibets:connect-wallet-required', handleWalletConnectionRequired);
    };
  }, [user?.walletAddress]);
  
  // Open connect wallet modal directly (no connection attempt first)
  const attemptQuickWalletConnection = (e?: React.MouseEvent) => {
    // Prevent default behavior to avoid page navigation
    if (e) e.preventDefault();
    
    if (isAttemptingConnection) return; // Prevent multiple attempts
    
    try {
      console.log('Connect wallet button clicked, opening modal directly');
      
      // Set the wallet modal to open
      setIsWalletModalOpen(true);
    } catch (error) {
      console.error('Error opening wallet modal:', error);
      // Still try to open the modal even if there was an error
      setIsWalletModalOpen(true);
    }
  };

  return (
    <nav className="bg-[#09181B] border-b border-[#112225] py-3 px-4 flex items-center">
      <div className="flex-1 flex items-center">
        <Link href="/">
          <img src="/logo/suibets-logo.svg" alt="SuiBets Logo" className="h-8 mr-10 cursor-pointer" />
        </Link>
        
        <div className="flex items-center space-x-10 mx-auto">
          {/* Sports link - simple text link */}
          <a 
            href="/" 
            className={`${location === "/" ? "text-[#00FFFF]" : "text-white hover:text-[#00FFFF]"} cursor-pointer`}
          >
            Sports
            {location === "/" && (
              <div className="absolute -bottom-3 left-0 w-full h-1 bg-[#00FFFF]"></div>
            )}
          </a>
          
          {/* Live link - direct text */}
          <a 
            href="/live" 
            className="text-black bg-[#00FFFF] px-3 py-1 rounded cursor-pointer"
          >
            Live<span className="ml-1 inline-block w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse"></span>
          </a>
          
          {/* Results link - direct text */}
          <a 
            href="/results" 
            className="text-black bg-[#00FFFF] px-3 py-1 rounded cursor-pointer"
          >
            Results
          </a>
        </div>
      </div>
      
      <div className="flex items-center justify-end flex-1 pr-4">
        {/* Place wallet connection button before bell/settings icons */}
        {user?.walletAddress ? (
          <div className="flex items-center">
            {/* Wallet dropdown with address */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="border-[#00FFFF] bg-[#112225] text-[#00FFFF] hover:bg-[#00FFFF]/20 font-medium">
                  <span className="hidden sm:inline">{shortenAddress(user.walletAddress)}</span>
                  <span className="sm:hidden">Wallet</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Your Wallet</DropdownMenuLabel>
                <div className="px-2 py-2 text-sm text-cyan-300">
                  {shortenAddress(user.walletAddress)}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="cursor-pointer"
                  onClick={() => setLocation('/wallet-dashboard')}
                >
                  Wallet Dashboard
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="cursor-pointer"
                  onClick={() => setLocation('/bet-history')}
                >
                  My Bets
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="cursor-pointer"
                  onClick={() => setLocation('/dividends')}
                >
                  Dividends
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={disconnectWallet}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Disconnect</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            {/* Notification Button */}
            <Button 
              variant="ghost" 
              size="icon"
              className="text-white hover:text-[#00FFFF] hover:bg-[#112225] mx-1"
              onClick={() => setIsNotificationsModalOpen(true)}
            >
              <Bell className="h-5 w-5" />
            </Button>
            
            {/* Settings Button */}
            <Button 
              variant="ghost" 
              size="icon"
              className="text-white hover:text-[#00FFFF] hover:bg-[#112225] mx-1"
              onClick={() => setIsSettingsModalOpen(true)}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center">
            {/* Connect Wallet Button */}
            <Button 
              className="bg-[#00FFFF] hover:bg-[#00FFFF]/90 text-black font-medium" 
              onClick={attemptQuickWalletConnection}
              disabled={isAttemptingConnection}
            >
              {isAttemptingConnection ? 'Connecting...' : 'Connect Wallet'}
            </Button>
            
            {/* Telegram Join Now Button */}
            <a href="https://t.me/Sui_Bets" target="_blank" rel="noopener noreferrer" className="ml-3">
              <Button variant="outline" className="border-[#00FFFF] text-[#00FFFF] hover:bg-[#00FFFF]/20 font-medium">
                Join Telegram
              </Button>
            </a>
          </div>
        )}
      </div>

      <ConnectWalletModal 
        isOpen={isWalletModalOpen} 
        onClose={() => setIsWalletModalOpen(false)} 
      />
      
      <NotificationsModal 
        isOpen={isNotificationsModalOpen} 
        onClose={() => setIsNotificationsModalOpen(false)} 
      />
      
      <SettingsModal 
        isOpen={isSettingsModalOpen} 
        onClose={() => setIsSettingsModalOpen(false)} 
      />
    </nav>
  );
};

export default NavigationBar;