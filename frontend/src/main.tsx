// Import polyfills FIRST - must be before any other imports
import "./polyfills";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

// Import wallet adapter CSS
import "@solana/wallet-adapter-react-ui/styles.css";

// Default to devnet, but allow override via environment variable
const network =
  (import.meta.env.VITE_SOLANA_NETWORK as WalletAdapterNetwork) ||
  WalletAdapterNetwork.Devnet;

// You can also provide a custom RPC endpoint
const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl(network);

// Create wallet adapters
// Note: MetaMask duplicate key warning may appear if MetaMask is detected by multiple adapters
// This is a known issue with wallet adapters and is harmless
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
