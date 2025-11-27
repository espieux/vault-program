import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultProgram } from "../target/types/vault_program";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  setAuthority,
  AuthorityType,
  getMint,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Program ID
const PROGRAM_ID = new PublicKey(
  "D7KrGPhkyWsqMRS7kQjaGzyT48nTaw4AopWM6qXXmBtg"
);

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
// This matches how tests load the program
const program = anchor.workspace.vaultProgram as Program<VaultProgram>;

// Get connection and wallet from provider
const connection = provider.connection;
const walletKeypair = (provider.wallet as any).payer as Keypair;

async function initializeVault() {
  console.log("=== Initializing Vault on Devnet ===\n");

  // Get admin from wallet
  const admin = provider.wallet;
  if (!admin || !admin.publicKey) {
    throw new Error("No wallet found.");
  }

  console.log("Admin (wallet):", admin.publicKey.toString());
  console.log("Network:", connection.rpcEndpoint);
  console.log("");

  // Step 1: Create deposit mint
  console.log("Step 1: Creating deposit mint...");
  const depositMint = await createMint(
    connection,
    walletKeypair, // payer
    walletKeypair.publicKey, // mint authority (you can change this later)
    null, // freeze authority (null = no freeze)
    9 // decimals (9 is standard for most tokens, adjust as needed)
  );
  console.log("✓ Deposit Mint:", depositMint.toString());
  console.log("");

  // Step 2: Create IOU mint
  console.log("Step 2: Creating IOU mint...");
  const iouMint = await createMint(
    connection,
    walletKeypair, // payer
    walletKeypair.publicKey, // mint authority (will be transferred to vault_state PDA)
    null, // freeze authority
    9 // decimals (should match deposit mint)
  );
  console.log("✓ IOU Mint:", iouMint.toString());
  console.log("");

  // Step 3: Derive vault_state PDA
  console.log("Step 3: Deriving vault_state PDA...");
  const [vaultStatePda, vaultStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), depositMint.toBuffer()],
    PROGRAM_ID
  );
  console.log("✓ Vault State PDA:", vaultStatePda.toString());
  console.log("✓ Vault State Bump:", vaultStateBump);
  console.log("");

  // Step 4: Transfer IOU mint authority to vault_state PDA
  // THIS MUST BE DONE BEFORE INITIALIZING THE VAULT
  console.log("Step 4: Transferring IOU mint authority to vault_state PDA...");
  try {
    await setAuthority(
      connection,
      walletKeypair, // payer
      iouMint,
      walletKeypair.publicKey, // current authority
      AuthorityType.MintTokens,
      vaultStatePda // new authority
    );
    console.log("✓ IOU mint authority transferred to vault_state PDA");
  } catch (err) {
    console.error("✗ Error setting IOU mint authority:", err);
    throw err;
  }
  console.log("");

  // Step 5: Initialize the vault
  console.log("Step 5: Initializing vault...");
  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        admin: walletKeypair.publicKey,
        vaultState: vaultStatePda,
        depositMint: depositMint,
        iouMint: iouMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([walletKeypair])
      .rpc();

    console.log("✓ Vault initialized successfully!");
    console.log("✓ Transaction signature:", tx);
    console.log("");

    // Verify vault state
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("=== Vault State ===");
    console.log("Admin:", vaultState.admin.toString());
    console.log("Deposit Mint:", vaultState.depositMint.toString());
    console.log("IOU Mint:", vaultState.iouMint.toString());
    console.log("Exchange Rate:", vaultState.exchangeRate.toString());
    console.log("Current Epoch:", vaultState.currentEpoch.toString());
    console.log("");

    console.log("=== Summary ===");
    console.log("✅ Vault initialized successfully!");
    console.log("");
    console.log("Use this deposit mint address in the frontend:");
    console.log(depositMint.toString());
    console.log("");
    console.log("You can now:");
    console.log("1. Open the frontend app");
    console.log("2. Connect your wallet");
    console.log("3. Enter the deposit mint address:", depositMint.toString());
    console.log("4. Start depositing tokens!");
  } catch (err) {
    console.error("✗ Error initializing vault:", err);
    throw err;
  }
}

// Run the initialization
initializeVault()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Initialization failed:", error);
    process.exit(1);
  });
