import { Program, AnchorProvider, setProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import BN from "bn.js";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import type { VaultProgram } from "../../idl/vault_program";
import idl from "../../idl/vault_program.json";

// Program ID from Anchor.toml
const PROGRAM_ID = new PublicKey(
  "D7KrGPhkyWsqMRS7kQjaGzyT48nTaw4AopWM6qXXmBtg"
);

// Exchange rate scale factor (matches on-chain constant)
const EXCHANGE_RATE_SCALE = 1_000_000;

/**
 * Hook to get the Anchor program instance.
 * Follows the official Anchor pattern using useConnection() and useAnchorWallet().
 *
 * @returns Program instance ready to use for RPC calls
 */
export function useProgram(): Program<VaultProgram> {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (wallet) {
      const provider = new AnchorProvider(connection, wallet, {});
      setProvider(provider);
      // Create program with provider so it has access to wallet for signing
      return new Program(idl as VaultProgram, provider);
    }

    // Read-only program when no wallet is connected
    return new Program(idl as VaultProgram, {
      connection,
    });
  }, [connection, wallet]);
}

/**
 * Get a read-only program instance (for use outside React components).
 * Use useProgram() hook inside React components instead.
 */
export function getReadOnlyProgram(
  connection: Connection
): Program<VaultProgram> {
  return new Program(idl as VaultProgram, {
    connection,
  });
}

/**
 * Derive the vault_state PDA from deposit_mint
 */
export function getVaultStatePda(depositMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), depositMint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derive the withdrawal_ticket PDA from user and vault_state
 */
export function getWithdrawalTicketPda(
  user: PublicKey,
  vaultState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("withdrawal_ticket"), user.toBuffer(), vaultState.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Get the associated token account address for a mint and owner
 * @param allowOwnerOffCurve - Set to true if owner is a PDA (off-curve address)
 */
export async function getTokenAccountAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve: boolean = false
): Promise<PublicKey> {
  return getAssociatedTokenAddress(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID
  );
}

/**
 * Ensure a token account exists, creating it if necessary
 */
export async function ensureTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const tokenAccount = await getTokenAccountAddress(mint, owner);

  try {
    await getAccount(connection, tokenAccount, "confirmed", TOKEN_PROGRAM_ID);
    return tokenAccount;
  } catch (error: any) {
    if (error.name === "TokenAccountNotFoundError") {
      // Account doesn't exist, will need to create it
      // Return the address - the caller should add the creation instruction
      return tokenAccount;
    }
    throw error;
  }
}

/**
 * Deposit tokens into the vault and receive IOU tokens
 * Uses the program instance from useProgram() hook (following official Anchor pattern)
 */
export async function deposit(
  program: Program<VaultProgram>,
  depositMint: PublicKey,
  depositAmount: number
): Promise<string> {
  const connection = program.provider.connection;
  const wallet = program.provider.wallet;

  if (!wallet || !wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  // Derive vault_state PDA
  const [vaultStatePda] = getVaultStatePda(depositMint);

  // Fetch vault state to get IOU mint
  const vaultState = await program.account.vaultState.fetch(vaultStatePda);
  const iouMint = vaultState.iouMint as PublicKey;

  // Get token accounts
  const userDepositTokenAccount = await getTokenAccountAddress(
    depositMint,
    wallet.publicKey,
    false // User wallet is on-curve
  );
  const vaultDepositTokenAccount = await getTokenAccountAddress(
    depositMint,
    vaultStatePda,
    true // Vault PDA is off-curve
  );
  const userIouTokenAccount = await getTokenAccountAddress(
    iouMint,
    wallet.publicKey,
    false // User wallet is on-curve
  );

  // Ensure vault deposit token account exists
  // This account is owned by the vault PDA (off-curve), so we need to create it
  // if it doesn't exist. The user will pay for the account creation.
  try {
    await getAccount(
      connection,
      vaultDepositTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
  } catch {
    // Account doesn't exist, create it
    // For off-curve owners (PDA), we need to create the associated token account
    // The createAssociatedTokenAccountInstruction supports off-curve owners
    // when using the associated token program
    const createIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey, // payer
      vaultDepositTokenAccount, // associated token account address
      vaultStatePda, // owner (PDA, off-curve) - this is allowed
      depositMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Build and send transaction
    const tx = new Transaction().add(createIx);
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    // Sign and send
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
    });

    // Wait for confirmation
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed"
    );
  }

  // Ensure user token accounts exist
  try {
    await getAccount(
      connection,
      userDepositTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
  } catch {
    // Account doesn't exist, create it
    const createIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      userDepositTokenAccount,
      wallet.publicKey,
      depositMint,
      TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createIx);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");
  }

  try {
    await getAccount(
      connection,
      userIouTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
  } catch {
    // Account doesn't exist, create it
    const createIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      userIouTokenAccount,
      wallet.publicKey,
      iouMint,
      TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createIx);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");
  }

  // Send deposit transaction
  // Anchor will auto-resolve vaultState PDA from depositMint, but we pass it explicitly for clarity
  const signature = await program.methods
    .deposit(new BN(depositAmount))
    .accounts({
      user: wallet.publicKey,
      vaultState: vaultStatePda,
      depositMint: depositMint,
      iouMint: iouMint,
      userDepositTokenAccount: userDepositTokenAccount,
      vaultDepositTokenAccount: vaultDepositTokenAccount,
      userIouTokenAccount: userIouTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();

  return signature;
}

/**
 * Request withdrawal by burning IOU tokens
 * Uses the program instance from useProgram() hook (following official Anchor pattern)
 */
export async function requestWithdraw(
  program: Program<VaultProgram>,
  depositMint: PublicKey,
  iouAmount: number
): Promise<string> {
  const wallet = program.provider.wallet;

  if (!wallet || !wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  // Derive vault_state PDA
  const [vaultStatePda] = getVaultStatePda(depositMint);

  // Fetch vault state to get IOU mint
  const vaultState = await program.account.vaultState.fetch(vaultStatePda);
  const iouMint = vaultState.iouMint as PublicKey;

  // Get token accounts and withdrawal ticket
  const userIouTokenAccount = await getTokenAccountAddress(
    iouMint,
    wallet.publicKey,
    false // User wallet is on-curve
  );
  const [withdrawalTicketPda] = getWithdrawalTicketPda(
    wallet.publicKey,
    vaultStatePda
  );

  // Send transaction
  const signature = await program.methods
    .requestWithdraw(new BN(iouAmount))
    .accounts({
      user: wallet.publicKey,
      vaultState: vaultStatePda,
      iouMint: iouMint,
      userIouTokenAccount: userIouTokenAccount,
      withdrawalTicket: withdrawalTicketPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();

  return signature;
}

/**
 * Claim withdrawal after unlock epoch
 * Uses the program instance from useProgram() hook (following official Anchor pattern)
 */
export async function claimWithdraw(
  program: Program<VaultProgram>,
  depositMint: PublicKey
): Promise<string> {
  const connection = program.provider.connection;
  const wallet = program.provider.wallet;

  if (!wallet || !wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  // Derive vault_state PDA
  const [vaultStatePda] = getVaultStatePda(depositMint);

  // Get token accounts and withdrawal ticket
  const userDepositTokenAccount = await getTokenAccountAddress(
    depositMint,
    wallet.publicKey,
    false // User wallet is on-curve
  );
  const vaultDepositTokenAccount = await getTokenAccountAddress(
    depositMint,
    vaultStatePda,
    true // Vault PDA is off-curve
  );
  const [withdrawalTicketPda] = getWithdrawalTicketPda(
    wallet.publicKey,
    vaultStatePda
  );

  // Ensure user deposit token account exists
  try {
    await getAccount(
      connection,
      userDepositTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
  } catch {
    // Account doesn't exist, create it
    const createIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      userDepositTokenAccount,
      wallet.publicKey,
      depositMint,
      TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createIx);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");
  }

  // Send claim transaction
  const signature = await program.methods
    .claimWithdraw()
    .accounts({
      user: wallet.publicKey,
      vaultState: vaultStatePda,
      depositMint: depositMint,
      vaultDepositTokenAccount: vaultDepositTokenAccount,
      userDepositTokenAccount: userDepositTokenAccount,
      withdrawalTicket: withdrawalTicketPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();

  return signature;
}

/**
 * Increase exchange rate (admin-only)
 * Uses the program instance from useProgram() hook (following official Anchor pattern)
 */
export async function increaseRate(
  program: Program<VaultProgram>,
  depositMint: PublicKey,
  newExchangeRate: number
): Promise<string> {
  const wallet = program.provider.wallet;

  if (!wallet || !wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  // Derive vault_state PDA
  const [vaultStatePda] = getVaultStatePda(depositMint);

  // Send transaction
  const signature = await program.methods
    .increaseRate(new BN(newExchangeRate))
    .accounts({
      admin: wallet.publicKey,
      vaultState: vaultStatePda,
    })
    .rpc();

  return signature;
}

/**
 * Deposit yield tokens into the vault (admin-only)
 * Transfers tokens from admin to vault without minting IOU tokens
 * This represents yield/staking rewards that benefit existing holders
 */
export async function depositYield(
  program: Program<VaultProgram>,
  depositMint: PublicKey,
  yieldAmount: number
): Promise<string> {
  const connection = program.provider.connection;
  const wallet = program.provider.wallet;

  if (!wallet || !wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  // Derive vault_state PDA
  const [vaultStatePda] = getVaultStatePda(depositMint);

  // Get token accounts
  const adminDepositTokenAccount = await getTokenAccountAddress(
    depositMint,
    wallet.publicKey,
    false // Admin wallet is on-curve
  );
  const vaultDepositTokenAccount = await getTokenAccountAddress(
    depositMint,
    vaultStatePda,
    true // Vault PDA is off-curve
  );

  // Ensure admin token account exists
  try {
    await getAccount(
      connection,
      adminDepositTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
  } catch {
    // Account doesn't exist, create it
    const createIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      adminDepositTokenAccount,
      wallet.publicKey,
      depositMint,
      TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createIx);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");
  }

  // Ensure vault deposit token account exists
  try {
    await getAccount(
      connection,
      vaultDepositTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
  } catch {
    // Account doesn't exist, create it
    const createIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      vaultDepositTokenAccount,
      vaultStatePda,
      depositMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createIx);
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
    });
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed"
    );
  }

  // Send deposit yield transaction
  const signature = await program.methods
    .depositYield(new BN(yieldAmount))
    .accounts({
      admin: wallet.publicKey,
      vaultState: vaultStatePda,
      depositMint: depositMint,
      adminDepositTokenAccount: adminDepositTokenAccount,
      vaultDepositTokenAccount: vaultDepositTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();

  return signature;
}

/**
 * Fetch vault state
 * Can use either a program instance or connection (for read-only access)
 */
export async function fetchVaultState(
  programOrConnection: Program<VaultProgram> | Connection,
  depositMint: PublicKey
) {
  const program =
    programOrConnection instanceof Connection
      ? getReadOnlyProgram(programOrConnection)
      : programOrConnection;
  const [vaultStatePda] = getVaultStatePda(depositMint);
  try {
    return await program.account.vaultState.fetch(vaultStatePda);
  } catch (error: any) {
    // Check for various error codes/messages that indicate account doesn't exist
    const errorMessage =
      error?.message || error?.toString() || String(error) || "";

    const errorCode = error?.code || error?.errorCode || error?.error?.code;

    if (
      errorCode === "AccountDoesNotExist" ||
      errorCode === 301 ||
      errorCode === "AccountNotFound" ||
      errorMessage.includes("does not exist") ||
      errorMessage.includes("Account does not exist") ||
      errorMessage.includes("has no data") ||
      errorMessage.includes("Account does not exist or has no data")
    ) {
      throw new Error(
        `Vault not initialized for deposit mint ${depositMint.toString()}. Please initialize the vault first.`
      );
    }
    throw error;
  }
}

/**
 * Fetch withdrawal ticket for a user
 * Can use either a program instance or connection (for read-only access)
 */
export async function fetchWithdrawalTicket(
  programOrConnection: Program<VaultProgram> | Connection,
  depositMint: PublicKey,
  user: PublicKey
) {
  const program =
    programOrConnection instanceof Connection
      ? getReadOnlyProgram(programOrConnection)
      : programOrConnection;
  const [vaultStatePda] = getVaultStatePda(depositMint);
  const [withdrawalTicketPda] = getWithdrawalTicketPda(user, vaultStatePda);

  try {
    return await program.account.withdrawalTicket.fetch(withdrawalTicketPda);
  } catch (error: any) {
    // Check for various error codes/messages that indicate account doesn't exist
    // This is normal - users won't have a withdrawal ticket until they request one

    // Get error message from various possible locations
    const errorMessage =
      error?.message || error?.toString() || String(error) || "";

    // Get error code from various possible locations
    const errorCode =
      error?.code ||
      error?.errorCode ||
      error?.error?.code ||
      error?.errorCodeNumber;

    // Check if this is an "account doesn't exist" error
    // Anchor throws errors with message "Account does not exist or has no data"
    const isAccountNotFoundError =
      errorCode === "AccountDoesNotExist" ||
      errorCode === 301 ||
      errorCode === "AccountNotFound" ||
      errorMessage.toLowerCase().includes("does not exist") ||
      errorMessage.toLowerCase().includes("account does not exist") ||
      errorMessage.toLowerCase().includes("has no data") ||
      errorMessage
        .toLowerCase()
        .includes("account does not exist or has no data") ||
      errorMessage.toLowerCase().includes("invalid account data");

    if (isAccountNotFoundError) {
      // This is expected - user hasn't created a withdrawal ticket yet
      return null;
    }

    // If it's not an account not found error, re-throw it
    console.error("Unexpected error fetching withdrawal ticket:", error);
    throw error;
  }
}

/**
 * Get token balance for a mint and owner
 * Returns the raw amount (not adjusted for decimals)
 */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<number> {
  try {
    const tokenAccount = await getTokenAccountAddress(mint, owner, false);
    const accountInfo = await getAccount(
      connection,
      tokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    return Number(accountInfo.amount);
  } catch (error: any) {
    if (error.name === "TokenAccountNotFoundError") {
      return 0;
    }
    throw error;
  }
}

/**
 * Get token balance with decimals (human-readable format)
 */
export async function getTokenBalanceWithDecimals(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<{ amount: number; decimals: number }> {
  try {
    const mintInfo = await getMint(
      connection,
      mint,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    const rawAmount = await getTokenBalance(connection, mint, owner);
    return {
      amount: rawAmount / Math.pow(10, mintInfo.decimals),
      decimals: mintInfo.decimals,
    };
  } catch (error: any) {
    if (
      error.name === "TokenAccountNotFoundError" ||
      error.name === "MintNotFoundError"
    ) {
      return { amount: 0, decimals: 9 }; // Default to 9 decimals
    }
    throw error;
  }
}

/**
 * Format exchange rate for display
 */
export function formatExchangeRate(exchangeRate: number): string {
  return (exchangeRate / EXCHANGE_RATE_SCALE).toFixed(6);
}

/**
 * Calculate IOU amount from deposit amount
 */
export function calculateIouAmount(
  depositAmount: number,
  exchangeRate: number
): number {
  return Math.floor((depositAmount * EXCHANGE_RATE_SCALE) / exchangeRate);
}

/**
 * Calculate deposit amount from IOU amount
 */
export function calculateDepositAmount(
  iouAmount: number,
  exchangeRate: number
): number {
  return Math.floor((iouAmount * exchangeRate) / EXCHANGE_RATE_SCALE);
}
