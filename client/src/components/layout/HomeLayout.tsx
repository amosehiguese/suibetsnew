import { ReactNode } from "react";
import Footer from "./Footer";
import { useMobile } from "@/hooks/use-mobile";
import { Grid2X2, Home, User } from "lucide-react";
import { BiFootball } from "react-icons/bi";
import { useLocation } from "wouter";
const suibetsBackground = `${import.meta.env.VITE_API_BASE_URL || ''}/images/suibets-background.png`;

interface HomeLayoutProps {
  children: ReactNode;
}

export default function HomeLayout({ children }: HomeLayoutProps) {
  const isMobile = useMobile();
  const [, setLocation] = useLocation();

  return (
    <div 
      className="flex min-h-screen"
      style={{
        backgroundImage: `url(${suibetsBackground})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        backgroundRepeat: 'no-repeat',
      }}
    >
    <div className="flex min-h-screen w-full bg-[#09181B]/85 backdrop-blur-sm">
      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#09181B] text-white z-30 flex justify-around p-2 border-t border-[#112225]">
          <button 
            className="p-2 flex flex-col items-center justify-center"
            onClick={() => setLocation("/")}
          >
            <Home className="h-6 w-6 text-[#00FFFF]" />
            <span className="text-xs mt-1">Home</span>
          </button>
          <button 
            className="p-2 flex flex-col items-center justify-center"
            onClick={() => setLocation("/sports")}
          >
            <BiFootball className="h-6 w-6" />
            <span className="text-xs mt-1">Sports</span>
          </button>
          <button 
            className="p-2 flex flex-col items-center justify-center"
            onClick={() => setLocation("/live")}
          >
            <Grid2X2 className="h-6 w-6" />
            <span className="text-xs mt-1">Live</span>
          </button>
          <button 
            className="p-2 flex flex-col items-center justify-center"
            onClick={() => setLocation("/wallet-dashboard")}
          >
            <User className="h-6 w-6" />
            <span className="text-xs mt-1">Wallet</span>
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col">
        <main className="flex-1 overflow-y-auto pb-20 md:pb-4 text-white">
          {children}
        </main>
        <Footer />
      </div>
    </div></div>
  );
}