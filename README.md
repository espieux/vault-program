# Solana Vault Program

A Solana vault program built with Anchor that allows users to deposit tokens, receive IOU tokens representing their share, and withdraw with a two-step process that includes an epoch-based delay.

## Overview

The Solana Vault is a DeFi protocol that implements a tokenized vault system where:

- Users deposit tokens and receive IOU tokens based on the current exchange rate
- IOU tokens represent a share of the vault's underlying assets
- Withdrawals require a two-step process: request (burn IOUs) → wait (epoch delay) → claim (receive tokens)
- The exchange rate can be increased by the admin to simulate yield growth
- Users benefit from exchange rate increases that occur between withdrawal request and claim

## Features

1. **Deposit** - Deposit tokens into the vault and receive IOU tokens
2. **Request Withdraw** - Burn IOU tokens and create a withdrawal ticket (unlocks next epoch)
3. **Claim Withdraw** - Claim withdrawal after unlock epoch using the current exchange rate
4. **Increase Rate** - Admin-only function to update exchange rate and increment epoch

## Account Structure

### VaultState (PDA)

- `admin`: Admin authority that can update exchange rate
- `deposit_mint`: The mint of tokens that can be deposited
- `iou_mint`: The mint of IOU tokens representing shares
- `exchange_rate`: Exchange rate scaled by `EXCHANGE_RATE_SCALE` (1,000,000)
- `current_epoch`: Current epoch number (incremented by admin)

**PDA Seeds:** `[b"vault_state", deposit_mint]`

### WithdrawalTicket (PDA)

- `user`: The user who requested the withdrawal
- `iou_amount`: Amount of IOU tokens burned for this withdrawal
- `unlock_epoch`: Epoch when withdrawal can be claimed (current_epoch + 1 when created)
- `claimed`: Boolean flag indicating if withdrawal has been claimed

**PDA Seeds:** `[b"withdrawal_ticket", user.key(), vault_state.key()]`

### Exchange Rate Formula

- **Deposit:** `iou_amount = (deposit_amount * exchange_rate) / EXCHANGE_RATE_SCALE`
- **Withdraw:** `deposit_amount = (iou_amount * EXCHANGE_RATE_SCALE) / exchange_rate`

The exchange rate is scaled by `1_000_000` for precision (6 decimal places).

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (v0.31+)
- [Yarn](https://yarnpkg.com/getting-started/install) or npm

## Installation

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd vault-program
   ```

2. **Install dependencies:**

   ```bash
   yarn install
   ```

3. **Build the program:**
   ```bash
   anchor build
   ```
   This generates TypeScript types in `target/types/vault_program.ts` used by tests.

## Testing

Run the test suite:

```bash
anchor test
```

Or use the npm script:

```bash
yarn test
```

**Note:** `anchor test` automatically starts a local validator. If you see "port 8899 is already in use", either use the existing validator with `anchor test --skip-local-validator` or stop it first with `pkill solana-test-validator`.

## Frontend

The frontend is a React + Vite application that provides a web interface for interacting with the vault.

### Development

1. **Navigate to the frontend directory:**

   ```bash
   cd frontend
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

### Deployment

1. **Build for production:**

   ```bash
   npm run build
   ```

2. **Preview the production build:**

   ```bash
   npm run preview
   ```

3. **Deploy the `dist/` folder** to any static hosting service (Vercel, Netlify, GitHub Pages, etc.).

**Note:** Make sure the program IDL is copied to `frontend/idl/` before building. The IDL is generated in `target/idl/vault_program.json` after running `anchor build`.

## Scripts

The `scripts/` directory contains utility scripts for managing the vault on devnet:

### `initialize-vault.ts`

Creates deposit and IOU mints, transfers IOU mint authority to the vault PDA, and initializes the vault state.

**Usage:**

```bash
npx ts-node scripts/initialize-vault.ts
```

### `mint-tokens.ts`

Mints tokens to a recipient's token account. Useful for testing and providing tokens to users.

**Usage:**

```bash
npx ts-node scripts/mint-tokens.ts <DEPOSIT_MINT_ADDRESS> [AMOUNT] [RECIPIENT_ADDRESS]
```

**Example:**

```bash
npx ts-node scripts/mint-tokens.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 100
```

### `mint-to-vault.ts`

Mints tokens to the admin wallet and transfers them directly to the vault's token account. Requires mint authority.

**Usage:**

```bash
npx ts-node scripts/mint-to-vault.ts <DEPOSIT_MINT_ADDRESS> <AMOUNT>
```

**Example:**

```bash
npx ts-node scripts/mint-to-vault.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 100
```

### `increase-rate.ts`

Admin-only script to increase the exchange rate. Simulates yield growth.

**Usage:**

```bash
npx ts-node scripts/increase-rate.ts <DEPOSIT_MINT_ADDRESS> <NEW_EXCHANGE_RATE>
```

**Example:**

```bash
npx ts-node scripts/increase-rate.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN 1.1
```

### `increase-epoch.ts`

Admin-only script to increment the epoch without changing the exchange rate. Useful for testing withdrawal delays.

**Usage:**

```bash
npx ts-node scripts/increase-epoch.ts <DEPOSIT_MINT_ADDRESS>
```

**Example:**

```bash
npx ts-node scripts/increase-epoch.ts 3mJFZXLudQF1YgyoWJ5gB6Q97kRoVyE1C6UCihNc9xVN
```

## Program Instructions

### Initialize

Creates the `VaultState` PDA and sets up the vault with admin authority, deposit mint, IOU mint, initial exchange rate (1:1), and initial epoch (0).

### Deposit

Transfers deposit tokens from user to vault, calculates IOU amount based on current exchange rate, and mints IOU tokens to user.

### Request Withdraw

Burns IOU tokens from user's token account and creates a `WithdrawalTicket` PDA with `unlock_epoch = current_epoch + 1`. Enforces one active withdrawal ticket per user per vault.

### Claim Withdraw

Validates withdrawal ticket ownership, checks that `current_epoch >= unlock_epoch`, calculates deposit token amount using current exchange rate, transfers deposit tokens from vault to user, and marks withdrawal ticket as claimed.

**Note:** Users benefit from exchange rate increases that occur between request and claim.

### Increase Rate

Admin-only function to update the exchange rate (simulating yield growth) and increment the current epoch.

## Error Codes

- `InvalidExchangeRate` - Exchange rate must be greater than zero
- `InvalidAmount` - Calculated IOU amount must be greater than zero
- `MathOverflow` - Arithmetic operation resulted in overflow
- `TicketAlreadyClaimed` - Unclaimed ticket exists or ticket already claimed
- `InvalidTicketOwner` - Withdrawal ticket belongs to different user
- `WithdrawalNotReady` - Attempted to claim before unlock epoch

## Troubleshooting

**Error: "Cannot find module '../target/types/vault_program'"**

- Run `anchor build` first to generate types

**Error: "Your configured rpc port: 8899 is already in use"**

- A validator is already running. Either use it: `anchor test --skip-local-validator` or stop it: `pkill solana-test-validator`

**Error: "Account not found"**

- Make sure the program is deployed (Anchor will do this automatically with `anchor test`)

**Error: "Insufficient funds"**

- The test automatically airdrops SOL, but if it fails, manually airdrop:
  ```bash
  solana airdrop 2 <your-wallet-address>
  ```

## Technical Details

- **Anchor Version:** 0.31+
- **Token Compatibility:** Supports both Token Program and Token Extension Program via `InterfaceAccount`
- **Patterns:** Modern Anchor style with `#[account]` structs and `#[derive(Accounts)]` for instruction contexts
- **Security:** Proper PDA derivation and signing for secure token minting, burning, and transfers
- **Error Handling:** Comprehensive validation and error handling throughout

## Project Structure

```
vault-program/
├── programs/
│   └── vault-program/
│       └── src/
│           └── lib.rs          # Main program logic
├── tests/
│   └── vault-program.ts        # Integration tests
├── scripts/                    # Utility scripts for devnet
│   ├── initialize-vault.ts
│   ├── mint-tokens.ts
│   ├── mint-to-vault.ts
│   ├── increase-rate.ts
│   └── increase-epoch.ts
├── frontend/                   # React + Vite frontend
│   ├── src/
│   ├── idl/                    # Program IDL
│   └── package.json
├── Anchor.toml                 # Anchor configuration
├── Cargo.toml                  # Rust dependencies
└── package.json                # Node dependencies
```

## License

MIT
