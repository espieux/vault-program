import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultProgram } from "../target/types/vault_program";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  mintTo,
  transfer,
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  Connection,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
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
const program = anchor.workspace.vaultProgram as Program<VaultProgram>;

// Get connection and wallet from provider
const connection = provider.connection;
const walletKeypair = (provider.wallet as any).payer as Keypair;

async function mintToVault() {
  console.log("=== Mint and Transfer Tokens to Vault ===\n");

  // Get deposit mint address from command line argument
  const depositMintAddress = process.argv[2];

  if (!depositMintAddress) {
    console.error(
      "Usage: npx ts-node scripts/mint-to-vault.ts <DEPOSIT_MINT_ADDRESS> <AMOUNT>"
    );
    console.error("\nExample:");
    console.error(
      "  npx ts-node scripts/mint-to-vault.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 100"
    );
    console.error("\nThis script will:");
    console.error(
      "  1. Mint tokens to your wallet (if you have mint authority)"
    );
    console.error("  2. Transfer them to the vault's deposit token account");
    console.error("\nNote: You must have mint authority for the deposit mint.");
    process.exit(1);
  }

  let depositMint: PublicKey;
  try {
    depositMint = new PublicKey(depositMintAddress);
  } catch (error) {
    console.error("✗ Invalid deposit mint address:", depositMintAddress);
    process.exit(1);
  }

  // Get amount from command line
  const amountInput = process.argv[3];

  if (!amountInput) {
    console.error("✗ Error: Please provide an amount.");
    console.error(
      "\nUsage: npx ts-node scripts/mint-to-vault.ts <DEPOSIT_MINT_ADDRESS> <AMOUNT>"
    );
    console.error("\nExample:");
    console.error(
      "  npx ts-node scripts/mint-to-vault.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 100"
    );
    process.exit(1);
  }

  const amount = parseFloat(amountInput);

  if (isNaN(amount) || amount <= 0) {
    console.error("✗ Invalid amount. Please provide a positive number.");
    process.exit(1);
  }

  const wallet = provider.wallet;
  if (!wallet || !wallet.publicKey) {
    throw new Error("No wallet found.");
  }

  console.log("Wallet:", wallet.publicKey.toString());
  console.log("Deposit Mint:", depositMint.toString());
  console.log("Amount:", amount, "tokens");
  console.log("Network:", connection.rpcEndpoint);
  console.log("");

  // Step 1: Get mint info to check decimals and authority
  console.log("Step 1: Fetching mint information...");
  let mintInfo;
  try {
    mintInfo = await getMint(
      connection,
      depositMint,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    console.log("✓ Mint decimals:", mintInfo.decimals);
    console.log(
      "✓ Mint authority:",
      mintInfo.mintAuthority?.toString() || "None"
    );
    console.log("");
  } catch (error) {
    console.error("✗ Error fetching mint info:", error);
    console.error(
      "  Make sure the mint address is correct and exists on devnet."
    );
    process.exit(1);
  }

  // Check if wallet is the mint authority
  if (!mintInfo.mintAuthority) {
    console.error(
      "✗ Error: This mint has no mint authority (minting is disabled)."
    );
    process.exit(1);
  }

  if (!mintInfo.mintAuthority.equals(walletKeypair.publicKey)) {
    console.error("✗ Error: Your wallet is not the mint authority.");
    console.error("  Mint authority:", mintInfo.mintAuthority.toString());
    console.error("  Your wallet:", walletKeypair.publicKey.toString());
    console.error("\n  You cannot mint tokens for this mint.");
    process.exit(1);
  }

  // Step 2: Derive vault_state PDA
  console.log("Step 2: Deriving vault_state PDA...");
  const [vaultStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), depositMint.toBuffer()],
    PROGRAM_ID
  );
  console.log("✓ Vault State PDA:", vaultStatePda.toString());
  console.log("");

  // Step 3: Fetch vault state to verify it exists
  console.log("Step 3: Verifying vault exists...");
  try {
    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    console.log("✓ Vault found");
    console.log("  Admin:", vaultState.admin.toString());
    console.log("  Exchange Rate:", vaultState.exchangeRate.toString());
    console.log("  Current Epoch:", vaultState.currentEpoch.toString());
    console.log("");
  } catch (error: any) {
    console.error("✗ Error: Vault not found for this deposit mint.");
    const errorMessage = error?.message || String(error) || "";
    if (
      errorMessage.includes("does not exist") ||
      errorMessage.includes("Account does not exist")
    ) {
      console.error(
        "  Please initialize the vault first using: npm run initialize-vault"
      );
    }
    process.exit(1);
  }

  // Step 4: Get token account addresses
  console.log("Step 4: Getting token account addresses...");
  const adminTokenAccount = await getAssociatedTokenAddress(
    depositMint,
    walletKeypair.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const vaultTokenAccount = await getAssociatedTokenAddress(
    depositMint,
    vaultStatePda,
    true, // Vault PDA is off-curve
    TOKEN_PROGRAM_ID
  );
  console.log("✓ Admin Token Account:", adminTokenAccount.toString());
  console.log("✓ Vault Token Account:", vaultTokenAccount.toString());
  console.log("");

  // Step 5: Ensure token accounts exist
  console.log("Step 5: Ensuring token accounts exist...");

  // Check admin token account
  try {
    await getAccount(
      connection,
      adminTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    console.log("✓ Admin token account exists");
  } catch {
    console.log("  Creating admin token account...");
    const createIx = createAssociatedTokenAccountInstruction(
      walletKeypair.publicKey,
      adminTokenAccount,
      walletKeypair.publicKey,
      depositMint,
      TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createIx);
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [walletKeypair],
      { commitment: "confirmed" }
    );
    console.log("✓ Admin token account created");
    console.log("  Transaction:", sig);
  }

  // Check vault token account
  try {
    await getAccount(
      connection,
      vaultTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    console.log("✓ Vault token account exists");
  } catch {
    console.log("  Creating vault token account...");
    const createIx = createAssociatedTokenAccountInstruction(
      walletKeypair.publicKey,
      vaultTokenAccount,
      vaultStatePda,
      depositMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createIx);
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [walletKeypair],
      { commitment: "confirmed" }
    );
    console.log("✓ Vault token account created");
    console.log("  Transaction:", sig);
  }
  console.log("");

  // Step 6: Convert amount to token units
  console.log("Step 6: Converting amount to token units...");
  const amountInTokenUnits = Math.floor(
    amount * Math.pow(10, mintInfo.decimals)
  );
  console.log("✓ Amount in token units:", amountInTokenUnits.toString());
  console.log("");

  // Step 7: Mint tokens to admin account
  console.log("Step 7: Minting tokens to admin account...");
  try {
    const mintSig = await mintTo(
      connection,
      walletKeypair, // payer
      depositMint, // mint
      adminTokenAccount, // destination
      walletKeypair, // mint authority (must sign)
      amountInTokenUnits // amount
    );
    console.log("✓ Tokens minted successfully!");
    console.log("✓ Mint transaction:", mintSig);
    console.log("");
  } catch (error) {
    console.error("✗ Error minting tokens:", error);
    if (error instanceof Error) {
      console.error("  Message:", error.message);
    }
    throw error;
  }

  // Step 8: Transfer tokens to vault
  console.log("Step 8: Transferring tokens to vault...");
  try {
    const transferSig = await transfer(
      connection,
      walletKeypair, // payer
      adminTokenAccount, // source
      vaultTokenAccount, // destination
      walletKeypair.publicKey, // owner (must sign)
      amountInTokenUnits // amount
    );
    console.log("✓ Tokens transferred to vault successfully!");
    console.log("✓ Transfer transaction:", transferSig);
    console.log("");

    // Step 9: Verify vault balance
    console.log("Step 9: Verifying vault balance...");
    const vaultAccount = await getAccount(
      connection,
      vaultTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    const vaultBalance =
      Number(vaultAccount.amount) / Math.pow(10, mintInfo.decimals);
    console.log("✓ Vault balance:", vaultBalance.toFixed(6), "tokens");
    console.log("");

    console.log("=== Summary ===");
    console.log("✅ Successfully minted and transferred tokens to vault!");
    console.log("");
    console.log("Amount:", amount, "tokens");
    console.log("Vault Token Account:", vaultTokenAccount.toString());
    console.log("Vault Balance:", vaultBalance.toFixed(6), "tokens");
    console.log("");
    console.log(
      "These tokens are now in the vault and can be used to fulfill withdrawals."
    );
  } catch (error) {
    console.error("✗ Error transferring tokens:", error);
    if (error instanceof Error) {
      console.error("  Message:", error.message);
    }
    throw error;
  }
}

// Run the mint to vault
mintToVault()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Mint to vault failed:", error);
    process.exit(1);
  });
