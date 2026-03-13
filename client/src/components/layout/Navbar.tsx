import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { NotificationsModal } from "@/components/modals/NotificationsModal";
import { Bell } from "lucide-react";
import { FreshConnectButton } from "@/components/wallet/FreshConnectButton";

export default function Navbar() {
  const [location] = useLocation();
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState(false);

  return (
    <nav className="bg-gradient-to-r from-[#09181B] via-[#0f1f25] to-[#09181B] border-b border-cyan-900/30 py-3 px-3 md:py-4 md:px-6 flex items-center shadow-lg shadow-cyan-900/20">
      <div className="flex-1 flex items-center">
        {/* Logo - visible on mobile */}
        <Link href="/" className="md:hidden">
          <img 
            src="/logo/suibets-logo.png?v=999" 
            alt="SuiBets Logo" 
            className="h-8"
          />
        </Link>
        
        {/* Desktop navigation */}
        <div className="hidden lg:flex items-center space-x-4 xl:space-x-8 mx-auto">
          <a 
            href="/" 
            className={`${location === "/" ? "text-[#00FFFF]" : "text-white hover:text-[#00FFFF]"} cursor-pointer text-sm font-semibold whitespace-nowrap`}
          >
            Sports
          </a>
          
          <a 
            href="/live-events" 
            className="text-black bg-gradient-to-r from-[#00FFFF] to-[#00d9ff] px-3 py-1.5 rounded-lg cursor-pointer font-bold text-sm hover:shadow-lg hover:shadow-cyan-400/50 transition-all duration-300 whitespace-nowrap"
          >
            Live<span className="ml-1 inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
          </a>
          
          <a 
            href="/promotions" 
            className="text-white bg-gradient-to-r from-blue-600 to-blue-500 px-3 py-1.5 rounded-lg cursor-pointer font-bold text-sm hover:shadow-lg hover:shadow-blue-500/50 transition-all duration-300 whitespace-nowrap"
          >
            Promo
          </a>
          
          <a 
            href="https://app.turbos.finance/#/trade?input=0x2::sui::SUI&output=0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS" 
            target="_blank"
            rel="noopener noreferrer"
            className="text-black bg-gradient-to-r from-green-400 to-emerald-500 px-3 py-1.5 rounded-lg cursor-pointer font-bold text-sm hover:shadow-lg hover:shadow-green-500/50 transition-all duration-300 whitespace-nowrap"
            data-testid="link-buy-sbets"
          >
            Buy SBETS
          </a>
          
          <a 
            href="/revenue" 
            className={`${location === "/revenue" ? "text-[#FFD700]" : "text-white hover:text-[#FFD700]"} cursor-pointer text-sm font-bold whitespace-nowrap`}
            data-testid="link-revenue"
          >
            Revenue
          </a>
          
          <a 
            href="/leaderboard" 
            className={`${location === "/leaderboard" ? "text-[#FFD700]" : "text-white hover:text-[#FFD700]"} cursor-pointer text-sm font-bold whitespace-nowrap`}
            data-testid="link-leaderboard"
          >
            Leaderboard
          </a>
        </div>
      </div>
      
      <div className="flex items-center justify-end flex-1 pr-2 gap-1 sm:gap-2">
        {/* FreshConnectButton handles both connected and disconnected states */}
        <FreshConnectButton />
        
        {/* Notification Button */}
        <Button 
          variant="ghost" 
          size="icon"
          className="text-white hover:text-[#00FFFF] hover:bg-[#112225] h-8 w-8 sm:h-10 sm:w-10"
          onClick={() => setIsNotificationsModalOpen(true)}
          data-testid="button-notifications"
        >
          <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
        
        {/* Telegram Join Now Button */}
        <a href="https://t.me/Sui_Bets" target="_blank" rel="noopener noreferrer" className="hidden xl:block">
          <Button variant="outline" size="sm" className="border-[#00FFFF] text-[#00FFFF] hover:bg-[#00FFFF]/20 font-medium">
            Join Telegram
          </Button>
        </a>
      </div>
      
      <NotificationsModal 
        isOpen={isNotificationsModalOpen} 
        onClose={() => setIsNotificationsModalOpen(false)} 
      />
    </nav>
  );
}
