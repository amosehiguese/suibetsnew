import "./polyfills";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Clear any stale wallet data on app load - user must explicitly connect
localStorage.removeItem('wallet_address');
localStorage.removeItem('wallet_type');

// This is a SUI blockchain dApp - we don't use MetaMask/Ethereum
// Suppress all Ethereum-related errors from browser extensions
const suppressedPatterns = [
  'metamask', 'ethereum', 'inpage.js', 'contentscript', 
  'eth_', 'web3', 'chrome-extension', 'moz-extension',
  'eip-1193', 'injected provider', 'ethprovider', 'wallet_requestpermissions'
];

const shouldSuppress = (str: string | undefined): boolean => {
  if (!str) return false;
  const lower = str.toLowerCase();
  return suppressedPatterns.some(p => lower.includes(p));
};

// Suppress console errors from extensions
const origError = console.error;
console.error = (...args) => {
  if (args.some(a => shouldSuppress(String(a)))) return;
  origError.apply(console, args);
};

// Suppress unhandled errors from extensions
window.addEventListener('error', (e) => {
  if (shouldSuppress(e.message) || shouldSuppress(e.filename) || shouldSuppress(e.error?.stack)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }
}, true);

window.addEventListener('unhandledrejection', (e) => {
  if (shouldSuppress(e.reason?.message) || shouldSuppress(e.reason?.stack) || shouldSuppress(String(e.reason))) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

// Add a debug script to the document body
const debugScript = document.createElement('script');
debugScript.textContent = `
// Real-time debugging helpers
console.debug = function() {
  window._debug_logs = window._debug_logs || [];
  window._debug_logs.push(["debug", Date.now(), arguments]);
  // eslint-disable-next-line no-console
  return console.log.apply(console, arguments);
};
console.log("Debug script loaded");
`;
document.body.appendChild(debugScript);

// Clean up any wallet settings - we now use only real wallets
if (localStorage.getItem('use_demo_wallet') !== null) {
  localStorage.removeItem('use_demo_wallet');
  console.log('Removed demo wallet setting - only real wallets are now supported');
}

// Clean up any old wallet settings
if (localStorage.getItem('use_real_wallets') !== null) {
  localStorage.removeItem('use_real_wallets');
  console.log('Removed deprecated wallet setting');
}

// Add console logs for debugging
console.log("Starting React application");
try {
  const rootElement = document.getElementById("root");
  console.log("Root element found:", rootElement);
  if (rootElement) {
    createRoot(rootElement).render(<App />);
    console.log("React app rendered successfully");
  } else {
    console.error("Root element not found in the DOM");
  }
} catch (error) {
  console.error("Error rendering React app:", error);
}
