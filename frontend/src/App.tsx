import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VaultInterface } from "./components/VaultInterface";
import "@solana/wallet-adapter-react-ui/styles.css";

function App() {
  const [depositMintAddress, setDepositMintAddress] = useState("");

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
          paddingBottom: "1rem",
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        <h1>Solana Vault</h1>
        <WalletMultiButton />
      </header>

      <div style={{ marginBottom: "2rem" }}>
        <label
          htmlFor="deposit-mint"
          style={{
            display: "block",
            marginBottom: "0.5rem",
            fontWeight: "bold",
          }}
        >
          Deposit Mint Address:
        </label>
        <input
          id="deposit-mint"
          type="text"
          value={depositMintAddress}
          onChange={(e) => setDepositMintAddress(e.target.value)}
          placeholder="Enter deposit mint public key"
          style={{
            width: "100%",
            padding: "0.75rem",
            fontSize: "1rem",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        />
        <p style={{ fontSize: "0.9rem", color: "gray", marginTop: "0.5rem" }}>
          Enter the deposit mint address for the vault you want to interact
          with.
        </p>
      </div>

      {depositMintAddress && (
        <VaultInterface depositMintAddress={depositMintAddress} />
      )}

      {!depositMintAddress && (
        <div style={{ textAlign: "center", color: "gray", padding: "2rem" }}>
          Enter a deposit mint address above to get started
        </div>
      )}
    </div>
  );
}

export default App;
