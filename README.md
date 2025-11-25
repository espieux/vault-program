# Solana Vault Program

A Solana vault program built with Anchor that allows users to deposit tokens, receive IOU (I Owe You) tokens representing their share, and withdraw with a two-step process that includes an epoch-based delay.

## Overview

The Solana Vault is a DeFi protocol that implements a tokenized vault system where:

- Users deposit tokens and receive IOU tokens based on the current exchange rate
- IOU tokens represent a share of the vault's underlying assets
- Withdrawals require a two-step process: request (burn IOUs) → wait (epoch delay) → claim (receive tokens)
- The exchange rate can be increased by the admin to simulate yield growth
- Users benefit from exchange rate increases that occur between withdrawal request and claim

## Features

### Core Functionality

1. **Deposit** - Deposit tokens into the vault and receive IOU tokens
2. **Request Withdraw** - Burn IOU tokens and create a withdrawal ticket (unlocks next epoch)
3. **Claim Withdraw** - Claim withdrawal after unlock epoch using the current exchange rate
4. **Increase Rate** - Admin-only function to update exchange rate and increment epoch

### Account Structure

#### VaultState (PDA)

- `admin`: Admin authority that can update exchange rate
- `deposit_mint`: The mint of tokens that can be deposited
- `iou_mint`: The mint of IOU tokens representing shares
- `exchange_rate`: Exchange rate scaled by `EXCHANGE_RATE_SCALE` (1,000,000)
- `current_epoch`: Current epoch number (incremented by admin)

**PDA Seeds:** `[b"vault_state", deposit_mint]`

#### WithdrawalTicket (PDA)

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

### Quick Start

**You don't need to manually start a validator!** `anchor test` automatically starts one for you.

Simply run:

```bash
anchor test
```

Or use the npm script:

```bash
yarn test
```

### Manual Validator (Optional)

If you prefer to run the validator manually (useful for debugging or keeping state between test runs):

1. **Start a local Solana validator in a separate terminal:**

   ```bash
   solana-test-validator
   ```

2. **Deploy the program:**

   ```bash
   anchor deploy
   ```

3. **Run tests:**
   ```bash
   anchor test --skip-local-validator
   ```

**Note:** If you see an error like "port 8899 is already in use", it means a validator is already running. You can either:

- Use the existing validator: `anchor test --skip-local-validator`
- Or stop it first: `pkill solana-test-validator` (then `anchor test` will start a fresh one)

### Test Coverage

The test file `tests/vault-program.ts` includes tests for:

1. **Initialize** - Sets up the vault state with admin, mints, and initial exchange rate
2. **Deposit** - Deposits tokens and receives IOU tokens
3. **Increase Rate** - Admin-only function to increase exchange rate
4. **Request Withdraw** - Burns IOU tokens and creates a withdrawal ticket
5. **Claim Withdraw** - Claims withdrawal after the unlock epoch

### Test Output

The tests log important information including:

- Transaction signatures (for job submission)
- Public keys (vault state PDA, mints, user accounts)
- Token balances and account states

Copy these values when submitting your work!

## Program Instructions

### Initialize

Creates the `VaultState` PDA and sets up the vault with:

- Admin authority
- Deposit mint
- IOU mint
- Initial exchange rate (1:1)
- Initial epoch (0)

### Deposit

Allows users to deposit tokens into the vault:

- Transfers deposit tokens from user to vault
- Calculates IOU amount based on current exchange rate
- Mints IOU tokens to user
- Includes overflow checks and validation

### Request Withdraw

Allows users to request withdrawal:

- Burns IOU tokens from user's token account
- Creates a `WithdrawalTicket` PDA with `unlock_epoch = current_epoch + 1`
- Enforces one active withdrawal ticket per user per vault
- Validates that existing tickets are claimed before allowing new requests

### Claim Withdraw

Allows users to claim their withdrawal:

- Validates withdrawal ticket ownership and ensures it hasn't been claimed
- Checks that `current_epoch >= unlock_epoch`
- Calculates deposit token amount using current exchange rate
- Transfers deposit tokens from vault to user
- Marks withdrawal ticket as claimed

**Note:** Users benefit from exchange rate increases that occur between request and claim.

### Increase Rate

Admin-only function to:

- Update the exchange rate (simulating yield growth)
- Increment the current epoch
- Must be signed by the vault admin

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

- A validator is already running. Either:
  - Use it: `anchor test --skip-local-validator`
  - Or stop it: `pkill solana-test-validator` (then run `anchor test` normally)

**Error: "Account not found"**

- Make sure the program is deployed (Anchor will do this automatically with `anchor test`)

**Error: "Insufficient funds"**

- The test automatically airdrops SOL, but if it fails, manually airdrop:
  ```bash
  solana airdrop 2 <your-wallet-address>
  ```

**Tests fail with transaction errors**

- Make sure you've run `anchor build` to compile the program
- Check that all dependencies are installed: `yarn install`
- Verify the program ID matches in `Anchor.toml` and `declare_id!` in `lib.rs`

## Account Constraints & Security

The program uses Anchor's constraint system to enforce account relationships at the framework level, providing defense-in-depth security. All constraints are validated before program logic executes.

### Constraint Types

#### 1. `has_one` Constraints

These ensure that account fields match expected values from other accounts:

**Deposit Instruction:**

```rust
#[account(
    has_one = deposit_mint @ VaultError::InvalidAmount,
    has_one = iou_mint @ VaultError::InvalidAmount
)]
pub vault_state: Account<'info, VaultState>,
```

- Ensures `vault_state.deposit_mint` matches the provided `deposit_mint`
- Ensures `vault_state.iou_mint` matches the provided `iou_mint`

**RequestWithdraw Instruction:**

```rust
#[account(has_one = iou_mint @ VaultError::InvalidAmount)]
pub vault_state: Account<'info, VaultState>,
```

- Ensures `vault_state.iou_mint` matches the provided `iou_mint`

**ClaimWithdraw Instruction:**

```rust
#[account(has_one = deposit_mint @ VaultError::InvalidAmount)]
pub vault_state: Account<'info, VaultState>,
```

- Ensures `vault_state.deposit_mint` matches the provided `deposit_mint`

#### 2. `constraint` Checks

These validate token account properties (mint and owner):

**Deposit Instruction:**

```rust
// User's deposit token account
#[account(
    constraint = user_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
    constraint = user_deposit_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
)]

// Vault's deposit token account
#[account(
    constraint = vault_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
    constraint = vault_deposit_token_account.owner == vault_state.key() @ VaultError::InvalidTicketOwner
)]

// User's IOU token account
#[account(
    constraint = user_iou_token_account.mint == iou_mint.key() @ VaultError::InvalidAmount,
    constraint = user_iou_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
)]
```

**RequestWithdraw Instruction:**

```rust
#[account(
    constraint = user_iou_token_account.mint == iou_mint.key() @ VaultError::InvalidAmount,
    constraint = user_iou_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
)]
pub user_iou_token_account: InterfaceAccount<'info, TokenAccount>,
```

**ClaimWithdraw Instruction:**

```rust
// Vault's deposit token account
#[account(
    constraint = vault_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
    constraint = vault_deposit_token_account.owner == vault_state.key() @ VaultError::InvalidTicketOwner
)]

// User's deposit token account
#[account(
    constraint = user_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
    constraint = user_deposit_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
)]
```

### Security Benefits

1. **Early Validation:** Constraints are checked before program logic runs, preventing invalid operations
2. **Type Safety:** Ensures token accounts match expected mints and owners
3. **Prevents Attacks:** Stops malicious users from passing wrong accounts or mints
4. **Clear Error Messages:** Custom error codes (`InvalidAmount`, `InvalidTicketOwner`) provide clear feedback

### Error Codes for Constraints

- `InvalidAmount` - Used when mint mismatches are detected (token account mint doesn't match expected mint)
- `InvalidTicketOwner` - Used when owner mismatches are detected (token account owner doesn't match expected owner)

### Testing Constraints

The test suite includes comprehensive tests for constraint violations:

- Wrong mint in token accounts
- Wrong owner in token accounts
- Mismatched mints in vault_state relationships

All constraint tests verify that the program correctly rejects invalid account configurations.

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
├── migrations/
│   └── deploy.ts               # Deployment script
├── Anchor.toml                 # Anchor configuration
├── Cargo.toml                  # Rust dependencies
└── package.json                # Node dependencies
```

## License

MIT
