import { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  useProgram,
  deposit,
  requestWithdraw,
  claimWithdraw,
  increaseRate,
  depositYield,
  fetchVaultState,
  fetchWithdrawalTicket,
  getTokenBalanceWithDecimals,
  formatExchangeRate,
  calculateIouAmount,
  calculateDepositAmount,
} from "../lib/solana";

interface VaultInterfaceProps {
  depositMintAddress: string;
}

export function VaultInterface({ depositMintAddress }: VaultInterfaceProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const program = useProgram();
  const [depositMint, setDepositMint] = useState<PublicKey | null>(null);
  const [vaultState, setVaultState] = useState<any>(null);
  const [withdrawalTicket, setWithdrawalTicket] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // User balances
  const [depositBalance, setDepositBalance] = useState<number>(0);
  const [depositDecimals, setDepositDecimals] = useState<number>(9);
  const [iouBalance, setIouBalance] = useState<number>(0);
  const [iouDecimals, setIouDecimals] = useState<number>(9);

  // Form inputs
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [newExchangeRate, setNewExchangeRate] = useState("");
  const [yieldAmount, setYieldAmount] = useState("");

  useEffect(() => {
    if (depositMintAddress) {
      try {
        const mint = new PublicKey(depositMintAddress);
        setDepositMint(mint);
        loadVaultData(mint);
      } catch (err) {
        setError("Invalid deposit mint address");
      }
    }
  }, [depositMintAddress, connection]);

  useEffect(() => {
    if (wallet.publicKey && depositMint) {
      loadUserBalances();
      const interval = setInterval(() => {
        loadUserBalances();
        loadVaultData(depositMint);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [wallet.publicKey, depositMint, program]);

  const loadVaultData = async (mint: PublicKey) => {
    try {
      const state = await fetchVaultState(program, mint);
      setVaultState(state);
      setError(null); // Clear any previous errors

      if (wallet.publicKey) {
        try {
          const ticket = await fetchWithdrawalTicket(
            program,
            mint,
            wallet.publicKey
          );
          setWithdrawalTicket(ticket);
        } catch (ticketError: any) {
          // Withdrawal ticket errors are non-fatal - user might not have one yet
          // Only log if it's not an "account not found" error (which is expected)
          const errorMsg = ticketError?.message || String(ticketError) || "";
          if (
            !errorMsg.includes("does not exist") &&
            !errorMsg.includes("has no data")
          ) {
            console.warn(
              "Unexpected error fetching withdrawal ticket:",
              ticketError
            );
          }
          setWithdrawalTicket(null);
        }
      }
    } catch (err: any) {
      console.error("Error loading vault data:", err);
      setError(err.message || "Failed to load vault data");
      setVaultState(null);
      setWithdrawalTicket(null);
    }
  };

  const loadUserBalances = async () => {
    if (!wallet.publicKey || !depositMint || !vaultState) return;

    try {
      const depositBalInfo = await getTokenBalanceWithDecimals(
        connection,
        depositMint,
        wallet.publicKey
      );
      setDepositBalance(depositBalInfo.amount);
      setDepositDecimals(depositBalInfo.decimals);

      if (vaultState.iouMint) {
        const iouBalInfo = await getTokenBalanceWithDecimals(
          connection,
          vaultState.iouMint as PublicKey,
          wallet.publicKey
        );
        setIouBalance(iouBalInfo.amount);
        setIouDecimals(iouBalInfo.decimals);
      }
    } catch (err) {
      console.error("Error loading balances:", err);
    }
  };

  const handleDeposit = async () => {
    if (!wallet.publicKey || !depositMint) {
      setError("Please connect your wallet");
      return;
    }

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid deposit amount");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert to token units using actual mint decimals
      const amountInTokenUnits = Math.floor(
        amount * Math.pow(10, depositDecimals)
      );
      const signature = await deposit(program, depositMint, amountInTokenUnits);
      setSuccess(`Deposit successful! Signature: ${signature}`);
      setDepositAmount("");
      setError(null); // Clear any previous errors

      // Reload data after successful deposit
      try {
        await loadUserBalances();
        await loadVaultData(depositMint);
      } catch (reloadError: any) {
        // Non-fatal - data will refresh on next interval
        console.warn("Error reloading data after deposit:", reloadError);
      }
    } catch (err: any) {
      console.error("Deposit error:", err);
      setError(err.message || "Deposit failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestWithdraw = async () => {
    if (!wallet.publicKey || !depositMint) {
      setError("Please connect your wallet");
      return;
    }

    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid withdrawal amount");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert to token units using actual IOU mint decimals
      const amountInTokenUnits = Math.floor(amount * Math.pow(10, iouDecimals));
      const signature = await requestWithdraw(
        program,
        depositMint,
        amountInTokenUnits
      );
      setSuccess(`Withdrawal requested! Signature: ${signature}`);
      setWithdrawAmount("");
      await loadUserBalances();
      await loadVaultData(depositMint);
    } catch (err: any) {
      setError(err.message || "Withdrawal request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClaimWithdraw = async () => {
    if (!wallet.publicKey || !depositMint) {
      setError("Please connect your wallet");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const signature = await claimWithdraw(program, depositMint);
      setSuccess(`Withdrawal claimed! Signature: ${signature}`);
      await loadUserBalances();
      await loadVaultData(depositMint);
    } catch (err: any) {
      setError(err.message || "Claim withdrawal failed");
    } finally {
      setLoading(false);
    }
  };

  const handleIncreaseRate = async () => {
    if (!wallet.publicKey || !depositMint) {
      setError("Please connect your wallet");
      return;
    }

    const rate = parseFloat(newExchangeRate);
    if (isNaN(rate) || rate <= 0) {
      setError("Please enter a valid exchange rate");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert to scaled rate (multiply by 1,000,000)
      const scaledRate = Math.floor(rate * 1_000_000);
      const signature = await increaseRate(program, depositMint, scaledRate);
      setSuccess(`Exchange rate increased! Signature: ${signature}`);
      setNewExchangeRate("");
      await loadVaultData(depositMint);
    } catch (err: any) {
      setError(err.message || "Increase rate failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDepositYield = async () => {
    if (!wallet.publicKey || !depositMint) {
      setError("Please connect your wallet");
      return;
    }

    const amount = parseFloat(yieldAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid yield amount");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert to token units using actual mint decimals
      const amountInTokenUnits = Math.floor(
        amount * Math.pow(10, depositDecimals)
      );
      const signature = await depositYield(program, depositMint, amountInTokenUnits);
      setSuccess(`Yield deposited! Signature: ${signature}`);
      setYieldAmount("");
      await loadVaultData(depositMint);
    } catch (err: any) {
      setError(err.message || "Deposit yield failed");
    } finally {
      setLoading(false);
    }
  };

  const isAdmin =
    wallet.publicKey &&
    vaultState &&
    wallet.publicKey.toString() === vaultState.admin.toString();

  const canClaim =
    withdrawalTicket &&
    !withdrawalTicket.claimed &&
    vaultState &&
    vaultState.currentEpoch >= withdrawalTicket.unlockEpoch;

  return (
    <div className="vault-interface">
      <h2>Vault Interface</h2>

      {error && (
        <div className="error" style={{ color: "red", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {success && (
        <div
          className="success"
          style={{ color: "green", marginBottom: "1rem" }}
        >
          {success}
        </div>
      )}

      {vaultState && (
        <div className="vault-info" style={{ marginBottom: "2rem" }}>
          <h3>Vault Information</h3>
          <p>
            <strong>Exchange Rate:</strong>{" "}
            {formatExchangeRate(vaultState.exchangeRate.toNumber())}
          </p>
          <p>
            <strong>Current Epoch:</strong> {vaultState.currentEpoch.toString()}
          </p>
          <p>
            <strong>Deposit Mint:</strong> {vaultState.depositMint.toString()}
          </p>
          <p>
            <strong>IOU Mint:</strong> {vaultState.iouMint.toString()}
          </p>
          <p>
            <strong>Admin:</strong> {vaultState.admin.toString()}
          </p>
        </div>
      )}

      {wallet.publicKey && (
        <div className="user-info" style={{ marginBottom: "2rem" }}>
          <h3>Your Balances</h3>
          <p>
            <strong>Deposit Tokens:</strong> {depositBalance.toFixed(6)}
          </p>
          <p>
            <strong>IOU Tokens:</strong> {iouBalance.toFixed(6)}
          </p>
        </div>
      )}

      {withdrawalTicket && !withdrawalTicket.claimed && (
        <div className="withdrawal-ticket" style={{ marginBottom: "2rem" }}>
          <h3>Pending Withdrawal</h3>
          <p>
            <strong>IOU Amount:</strong>{" "}
            {(
              withdrawalTicket.iouAmount.toNumber() / Math.pow(10, iouDecimals)
            ).toFixed(6)}
          </p>
          <p>
            <strong>Unlock Epoch:</strong>{" "}
            {withdrawalTicket.unlockEpoch.toString()}
          </p>
          <p>
            <strong>Current Epoch:</strong>{" "}
            {vaultState?.currentEpoch.toString() || "Loading..."}
          </p>
          {canClaim ? (
            <button
              onClick={handleClaimWithdraw}
              disabled={loading}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Claiming..." : "Claim Withdrawal"}
            </button>
          ) : (
            <p style={{ color: "orange" }}>
              Waiting for unlock epoch to be reached...
            </p>
          )}
        </div>
      )}

      {wallet.publicKey && (
        <div className="actions" style={{ marginBottom: "2rem" }}>
          <h3>Actions</h3>

          <div style={{ marginBottom: "1rem" }}>
            <h4>Deposit</h4>
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Amount to deposit"
              style={{ marginRight: "0.5rem", padding: "0.5rem" }}
            />
            <button
              onClick={handleDeposit}
              disabled={loading}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#2196F3",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Processing..." : "Deposit"}
            </button>
            {vaultState && depositAmount && (
              <p
                style={{
                  fontSize: "0.9rem",
                  color: "gray",
                  marginTop: "0.5rem",
                }}
              >
                You will receive approximately:{" "}
                {(
                  calculateIouAmount(
                    parseFloat(depositAmount) * Math.pow(10, depositDecimals),
                    vaultState.exchangeRate.toNumber()
                  ) / Math.pow(10, iouDecimals)
                ).toFixed(6)}{" "}
                IOU tokens
              </p>
            )}
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <h4>Request Withdrawal</h4>
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="IOU amount to withdraw"
              style={{ marginRight: "0.5rem", padding: "0.5rem" }}
            />
            <button
              onClick={handleRequestWithdraw}
              disabled={loading}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#FF9800",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Processing..." : "Request Withdrawal"}
            </button>
            {vaultState && withdrawAmount && (
              <p
                style={{
                  fontSize: "0.9rem",
                  color: "gray",
                  marginTop: "0.5rem",
                }}
              >
                You will receive approximately:{" "}
                {(
                  calculateDepositAmount(
                    parseFloat(withdrawAmount) * Math.pow(10, iouDecimals),
                    vaultState.exchangeRate.toNumber()
                  ) / Math.pow(10, depositDecimals)
                ).toFixed(6)}{" "}
                deposit tokens (at current rate)
              </p>
            )}
          </div>

          {isAdmin && (
            <>
              <div style={{ marginBottom: "1rem" }}>
                <h4>Increase Exchange Rate (Admin Only)</h4>
                <input
                  type="number"
                  value={newExchangeRate}
                  onChange={(e) => setNewExchangeRate(e.target.value)}
                  placeholder="New exchange rate (e.g., 1.1 for 10% increase)"
                  step="0.01"
                  style={{ marginRight: "0.5rem", padding: "0.5rem" }}
                />
                <button
                  onClick={handleIncreaseRate}
                  disabled={loading}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "#9C27B0",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Processing..." : "Increase Rate"}
                </button>
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <h4>Deposit Yield (Admin Only)</h4>
                <p style={{ fontSize: "0.9rem", color: "gray", marginBottom: "0.5rem" }}>
                  Deposit tokens into the vault without minting IOU tokens.
                  This represents yield/staking rewards that benefit existing holders.
                </p>
                <input
                  type="number"
                  value={yieldAmount}
                  onChange={(e) => setYieldAmount(e.target.value)}
                  placeholder="Yield amount to deposit"
                  step="0.01"
                  style={{ marginRight: "0.5rem", padding: "0.5rem" }}
                />
                <button
                  onClick={handleDepositYield}
                  disabled={loading}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "#4CAF50",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Processing..." : "Deposit Yield"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!wallet.publicKey && (
        <p style={{ color: "gray" }}>
          Please connect your wallet to interact with the vault
        </p>
      )}
    </div>
  );
}
