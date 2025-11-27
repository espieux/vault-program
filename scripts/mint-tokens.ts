import * as anchor from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";
import * as path from "path";
import * as os from "os";

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

// Get connection and wallet from provider
const connection = provider.connection;
const walletKeypair = (provider.wallet as any).payer as Keypair;

async function mintTokens() {
  console.log("=== Minting Tokens ===\n");

  // Get deposit mint address from command line argument
  const depositMintAddress = process.argv[2];

  if (!depositMintAddress) {
    console.error("Usage: ts-node scripts/mint-tokens.ts <DEPOSIT_MINT_ADDRESS> [AMOUNT] [RECIPIENT_ADDRESS]");
    console.error("\nExample:");
    console.error("  ts-node scripts/mint-tokens.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 100");
    console.error("  ts-node scripts/mint-tokens.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 100 48zhbhbmGxqC5MXAmMRV7DSQLzHRKsU3VwssgcbzLF1G");
    process.exit(1);
  }

  let depositMint: PublicKey;
  try {
    depositMint = new PublicKey(depositMintAddress);
  } catch (error) {
    console.error("✗ Invalid deposit mint address:", depositMintAddress);
    process.exit(1);
  }

  // Get amount from command line (default: 100 tokens)
  const amountInput = process.argv[3] || "100";
  const amount = parseFloat(amountInput);

  if (isNaN(amount) || amount <= 0) {
    console.error("✗ Invalid amount. Please provide a positive number.");
    process.exit(1);
  }

  // Get recipient address from command line (default: wallet address)
  const recipientAddressInput = process.argv[4];
  let recipientAddress: PublicKey;
  
  if (recipientAddressInput) {
    try {
      recipientAddress = new PublicKey(recipientAddressInput);
    } catch (error) {
      console.error("✗ Invalid recipient address:", recipientAddressInput);
      process.exit(1);
    }
  } else {
    // Default to wallet address
    const wallet = provider.wallet;
    if (!wallet || !wallet.publicKey) {
      throw new Error("No wallet found.");
    }
    recipientAddress = wallet.publicKey;
  }

  const wallet = provider.wallet;
  if (!wallet || !wallet.publicKey) {
    throw new Error("No wallet found.");
  }

  console.log("Mint Authority (wallet):", wallet.publicKey.toString());
  console.log("Recipient Address:", recipientAddress.toString());
  console.log("Deposit Mint:", depositMint.toString());
  console.log("Network:", connection.rpcEndpoint);
  console.log("");

  // Step 1: Get mint info to check decimals and authority
  console.log("Step 1: Fetching mint information...");
  let mintInfo;
  try {
    mintInfo = await getMint(connection, depositMint);
    console.log("✓ Mint decimals:", mintInfo.decimals);
    console.log("✓ Mint authority:", mintInfo.mintAuthority?.toString() || "None");
    console.log("");
  } catch (error) {
    console.error("✗ Error fetching mint info:", error);
    console.error("  Make sure the mint address is correct and exists on devnet.");
    process.exit(1);
  }

  // Check if wallet is the mint authority
  if (!mintInfo.mintAuthority) {
    console.error("✗ Error: This mint has no mint authority (minting is disabled).");
    process.exit(1);
  }

  if (!mintInfo.mintAuthority.equals(walletKeypair.publicKey)) {
    console.warn("⚠ Warning: Your wallet is not the mint authority.");
    console.warn("  Mint authority:", mintInfo.mintAuthority.toString());
    console.warn("  Your wallet:", walletKeypair.publicKey.toString());
    console.warn("  You may not be able to mint tokens.");
    console.log("");
  }

  // Step 2: Get or create associated token account for the recipient
  console.log("Step 2: Getting or creating token account for recipient...");
  let tokenAccount;
  try {
    tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      walletKeypair, // payer
      depositMint, // mint
      recipientAddress // owner (recipient)
    );
    console.log("✓ Token account:", tokenAccount.address.toString());
    console.log("");
  } catch (error) {
    console.error("✗ Error creating token account:", error);
    throw error;
  }

  // Step 3: Mint tokens
  console.log(`Step 3: Minting ${amount} tokens...`);
  try {
    // Convert amount to raw units (considering decimals)
    const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

    const signature = await mintTo(
      connection,
      walletKeypair, // payer
      depositMint, // mint
      tokenAccount.address, // destination token account
      walletKeypair, // mint authority (must sign)
      Number(rawAmount) // amount in raw units
    );

    console.log("✓ Tokens minted successfully!");
    console.log("✓ Transaction signature:", signature);
    console.log("");

    // Step 4: Check balance
    console.log("Step 4: Checking token balance...");
    const balance = await connection.getTokenAccountBalance(tokenAccount.address);
    console.log("✓ Current balance:", balance.value.uiAmount, "tokens");
    console.log("");

    console.log("=== Summary ===");
    console.log("✅ Successfully minted tokens!");
    console.log("");
    console.log("Recipient:", recipientAddress.toString());
    console.log("Amount:", amount, "tokens");
    console.log("");
    console.log("The recipient can now:");
    console.log("1. Open the frontend app");
    console.log("2. Connect their wallet");
    console.log("3. Enter the deposit mint address:", depositMint.toString());
    console.log("4. Deposit tokens into the vault!");
  } catch (error) {
    console.error("✗ Error minting tokens:", error);
    if (error instanceof Error) {
      console.error("  Message:", error.message);
    }
    throw error;
  }
}

// Run the minting
mintTokens()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Minting failed:", error);
    process.exit(1);
  });

