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

async function increaseEpoch() {
  console.log("=== Increase Epoch ===\n");

  // Get deposit mint address from command line argument
  const depositMintAddress = process.argv[2];

  if (!depositMintAddress) {
    console.error("Usage: npx ts-node scripts/increase-epoch.ts <DEPOSIT_MINT_ADDRESS>");
    console.error("\nExample:");
    console.error("  npx ts-node scripts/increase-epoch.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN");
    console.error("\nNote: This will increment the epoch by 1 without changing the exchange rate.");
    console.error("      It does this by calling increase_rate with the current exchange rate.");
    process.exit(1);
  }

  let depositMint: PublicKey;
  try {
    depositMint = new PublicKey(depositMintAddress);
  } catch (error) {
    console.error("✗ Invalid deposit mint address:", depositMintAddress);
    process.exit(1);
  }

  const wallet = provider.wallet;
  if (!wallet || !wallet.publicKey) {
    throw new Error("No wallet found.");
  }

  console.log("Admin (wallet):", wallet.publicKey.toString());
  console.log("Deposit Mint:", depositMint.toString());
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

  // Step 3: Use current exchange rate to increment epoch
  console.log("Step 3: Preparing to increment epoch...");
  const currentExchangeRate = vaultState.exchangeRate.toNumber();
  const currentEpoch = vaultState.currentEpoch.toNumber();
  const newEpoch = currentEpoch + 1;
  
  console.log("✓ Current Exchange Rate:", currentExchangeRate.toString());
  console.log("  (Will remain unchanged)");
  console.log("✓ Current Epoch:", currentEpoch.toString());
  console.log("✓ New Epoch:", newEpoch.toString());
  console.log("");

  // Step 4: Increase the epoch by calling increase_rate with the same exchange rate
  console.log("Step 4: Incrementing epoch (calling increase_rate with current rate)...");
  try {
    const tx = await program.methods
      .increaseRate(new anchor.BN(currentExchangeRate))
      .accounts({
        admin: walletKeypair.publicKey,
        vaultState: vaultStatePda,
      })
      .signers([walletKeypair])
      .rpc();

    console.log("✓ Epoch incremented successfully!");
    console.log("✓ Transaction signature:", tx);
    console.log("");

    // Step 5: Verify the update
    console.log("Step 5: Verifying vault state update...");
    const updatedVaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("✓ Exchange Rate:", updatedVaultState.exchangeRate.toString());
    console.log("  (Display: " + (updatedVaultState.exchangeRate.toNumber() / EXCHANGE_RATE_SCALE).toFixed(6) + ")");
    console.log("  (Unchanged as expected)");
    console.log("✓ New Epoch:", updatedVaultState.currentEpoch.toString());
    console.log("");

    console.log("=== Summary ===");
    console.log("✅ Epoch incremented successfully!");
    console.log("");
    console.log("Exchange Rate:", (currentExchangeRate / EXCHANGE_RATE_SCALE).toFixed(6), "(unchanged)");
    console.log("Previous Epoch:", currentEpoch.toString());
    console.log("New Epoch:", updatedVaultState.currentEpoch.toString());
    console.log("");
    console.log("Transaction:", tx);
  } catch (error) {
    console.error("✗ Error incrementing epoch:", error);
    if (error instanceof Error) {
      console.error("  Message:", error.message);
    }
    throw error;
  }
}

// Run the increase epoch
increaseEpoch()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Increase epoch failed:", error);
    process.exit(1);
  });

