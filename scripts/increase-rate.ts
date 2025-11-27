import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultProgram } from "../target/types/vault_program";
import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import * as path from "path";
import * as os from "os";

// Program ID
const PROGRAM_ID = new PublicKey(
  "D7KrGPhkyWsqMRS7kQjaGzyT48nTaw4AopWM6qXXmBtg"
);

// Exchange rate scale factor (matches on-chain constant)
const EXCHANGE_RATE_SCALE = 1_000_000;

// Set environment variables for Anchor to use
process.env.ANCHOR_PROVIDER_URL = clusterApiUrl("devnet");
process.env.ANCHOR_WALLET = path.join(
  os.homedir(),
  ".config",
  "solana",
  "id.json"
);

// Create provider - this will use the environment variables
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Use workspace approach - this reads from Anchor.toml and target/idl/
const program = anchor.workspace.vaultProgram as Program<VaultProgram>;

// Get connection and wallet from provider
const connection = provider.connection;
const walletKeypair = (provider.wallet as any).payer as Keypair;

async function increaseRate() {
  console.log("=== Increase Exchange Rate ===\n");

  // Get deposit mint address from command line argument
  const depositMintAddress = process.argv[2];

  if (!depositMintAddress) {
    console.error("Usage: npx ts-node scripts/increase-rate.ts <DEPOSIT_MINT_ADDRESS> <NEW_EXCHANGE_RATE>");
    console.error("\nExample:");
    console.error("  npx ts-node scripts/increase-rate.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 1.1");
    console.error("  (This sets the exchange rate to 1.1, representing a 10% increase)");
    console.error("\nNote: The exchange rate is scaled by 1,000,000 internally.");
    console.error("      Entering 1.1 means 1 IOU token = 1.1 deposit tokens.");
    process.exit(1);
  }

  let depositMint: PublicKey;
  try {
    depositMint = new PublicKey(depositMintAddress);
  } catch (error) {
    console.error("✗ Invalid deposit mint address:", depositMintAddress);
    process.exit(1);
  }

  // Get new exchange rate from command line
  const rateInput = process.argv[3];

  if (!rateInput) {
    console.error("✗ Error: Please provide a new exchange rate.");
    console.error("\nUsage: npx ts-node scripts/increase-rate.ts <DEPOSIT_MINT_ADDRESS> <NEW_EXCHANGE_RATE>");
    console.error("\nExample:");
    console.error("  npx ts-node scripts/increase-rate.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 1.1");
    process.exit(1);
  }

  const rate = parseFloat(rateInput);

  if (isNaN(rate) || rate <= 0) {
    console.error("✗ Invalid exchange rate. Please provide a positive number.");
    console.error("  Example: 1.1 for 10% increase, 1.05 for 5% increase");
    process.exit(1);
  }

  const wallet = provider.wallet;
  if (!wallet || !wallet.publicKey) {
    throw new Error("No wallet found.");
  }

  console.log("Admin (wallet):", wallet.publicKey.toString());
  console.log("Deposit Mint:", depositMint.toString());
  console.log("New Exchange Rate:", rate, "(1 IOU =", rate, "deposit tokens)");
  console.log("Network:", connection.rpcEndpoint);
  console.log("");

  // Step 1: Derive vault_state PDA
  console.log("Step 1: Deriving vault_state PDA...");
  const [vaultStatePda, vaultStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), depositMint.toBuffer()],
    PROGRAM_ID
  );
  console.log("✓ Vault State PDA:", vaultStatePda.toString());
  console.log("✓ Vault State Bump:", vaultStateBump);
  console.log("");

  // Step 2: Fetch current vault state
  console.log("Step 2: Fetching current vault state...");
  let vaultState;
  try {
    vaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("✓ Current Exchange Rate:", vaultState.exchangeRate.toString());
    console.log("  (Display: " + (vaultState.exchangeRate.toNumber() / EXCHANGE_RATE_SCALE).toFixed(6) + ")");
    console.log("✓ Current Epoch:", vaultState.currentEpoch.toString());
    console.log("✓ Admin:", vaultState.admin.toString());
    console.log("");

    // Verify admin
    if (!vaultState.admin.equals(wallet.publicKey)) {
      console.error("✗ Error: Your wallet is not the admin of this vault.");
      console.error("  Vault Admin:", vaultState.admin.toString());
      console.error("  Your Wallet:", wallet.publicKey.toString());
      process.exit(1);
    }
  } catch (error: any) {
    console.error("✗ Error fetching vault state:", error);
    const errorMessage = error?.message || String(error) || "";
    if (
      errorMessage.includes("does not exist") ||
      errorMessage.includes("Account does not exist")
    ) {
      console.error("  Make sure the vault has been initialized for this deposit mint.");
    }
    process.exit(1);
  }

  // Step 3: Calculate scaled exchange rate
  console.log("Step 3: Calculating scaled exchange rate...");
  const scaledRate = Math.floor(rate * EXCHANGE_RATE_SCALE);
  console.log("✓ Scaled Exchange Rate:", scaledRate.toString());
  console.log("  (Rate:", rate, "× Scale:", EXCHANGE_RATE_SCALE, "=", scaledRate, ")");
  console.log("");

  // Validate that new rate is greater than current rate (optional check)
  const currentRate = vaultState.exchangeRate.toNumber();
  if (scaledRate <= currentRate) {
    console.warn("⚠ Warning: New exchange rate is not greater than current rate.");
    console.warn("  Current:", currentRate, "(" + (currentRate / EXCHANGE_RATE_SCALE).toFixed(6) + ")");
    console.warn("  New:", scaledRate, "(" + rate.toFixed(6) + ")");
    console.warn("  The transaction will still proceed, but this may not be the intended behavior.");
    console.log("");
  }

  // Step 4: Increase the exchange rate
  console.log("Step 4: Increasing exchange rate...");
  try {
    const tx = await program.methods
      .increaseRate(new anchor.BN(scaledRate))
      .accounts({
        admin: walletKeypair.publicKey,
        vaultState: vaultStatePda,
      })
      .signers([walletKeypair])
      .rpc();

    console.log("✓ Exchange rate increased successfully!");
    console.log("✓ Transaction signature:", tx);
    console.log("");

    // Step 5: Verify the update
    console.log("Step 5: Verifying vault state update...");
    const updatedVaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("✓ New Exchange Rate:", updatedVaultState.exchangeRate.toString());
    console.log("  (Display: " + (updatedVaultState.exchangeRate.toNumber() / EXCHANGE_RATE_SCALE).toFixed(6) + ")");
    console.log("✓ New Epoch:", updatedVaultState.currentEpoch.toString());
    console.log("");

    console.log("=== Summary ===");
    console.log("✅ Exchange rate increased successfully!");
    console.log("");
    console.log("Previous Exchange Rate:", (currentRate / EXCHANGE_RATE_SCALE).toFixed(6));
    console.log("New Exchange Rate:", (updatedVaultState.exchangeRate.toNumber() / EXCHANGE_RATE_SCALE).toFixed(6));
    console.log("Previous Epoch:", vaultState.currentEpoch.toString());
    console.log("New Epoch:", updatedVaultState.currentEpoch.toString());
    console.log("");
    console.log("Transaction:", tx);
  } catch (error) {
    console.error("✗ Error increasing exchange rate:", error);
    if (error instanceof Error) {
      console.error("  Message:", error.message);
    }
    throw error;
  }
}

// Run the increase rate
increaseRate()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Increase rate failed:", error);
    process.exit(1);
  });

