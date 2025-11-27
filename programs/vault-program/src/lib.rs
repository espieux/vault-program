use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, BurnChecked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("D7KrGPhkyWsqMRS7kQjaGzyT48nTaw4AopWM6qXXmBtg");

// Exchange rate scale factor: 1_000_000 means 1:1 ratio (with 6 decimals precision)
const EXCHANGE_RATE_SCALE: u64 = 1_000_000;

#[program]
pub mod vault_program {
    use super::*;

    /// Initialize the vault with admin, deposit mint, and IOU mint.
    ///
    /// Parameters:
    /// - None (all data comes from accounts)
    ///
    /// Security assumptions:
    /// - Admin must sign the transaction
    /// - VaultState must not already exist (enforced by init constraint)
    /// - Deposit mint and IOU mint must be valid token mints
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;

        // Set vault configuration
        vault_state.admin = ctx.accounts.admin.key();
        vault_state.deposit_mint = ctx.accounts.deposit_mint.key();
        vault_state.iou_mint = ctx.accounts.iou_mint.key();

        // Initialize exchange rate to 1:1 (EXCHANGE_RATE_SCALE)
        vault_state.exchange_rate = EXCHANGE_RATE_SCALE;

        // Initialize epoch to 0
        vault_state.current_epoch = 0;

        msg!(
            "Vault initialized: admin={}, deposit_mint={}, iou_mint={}, exchange_rate={}, epoch={}",
            vault_state.admin,
            vault_state.deposit_mint,
            vault_state.iou_mint,
            vault_state.exchange_rate,
            vault_state.current_epoch
        );

        Ok(())
    }

    /// Deposit tokens into the vault and receive IOU tokens based on the current exchange rate.
    ///
    /// Parameters:
    /// - deposit_amount: Amount of deposit tokens to transfer to the vault
    ///
    /// Security assumptions:
    /// - VaultState must be initialized
    /// - User must have sufficient deposit tokens
    /// - Exchange rate must be set (non-zero)
    pub fn deposit(ctx: Context<Deposit>, deposit_amount: u64) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;

        // Ensure exchange rate is set
        require!(
            vault_state.exchange_rate > 0,
            VaultError::InvalidExchangeRate
        );

        // Calculate IOU amount based on exchange rate
        // Formula: iou_amount = (deposit_amount * EXCHANGE_RATE_SCALE) / exchange_rate
        // When exchange_rate increases, users get fewer IOUs (IOU becomes more valuable)
        // This ensures we maintain precision while avoiding overflow
        let iou_amount = deposit_amount
            .checked_mul(EXCHANGE_RATE_SCALE)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(vault_state.exchange_rate)
            .ok_or(VaultError::MathOverflow)?;

        require!(iou_amount > 0, VaultError::InvalidAmount);

        // Transfer deposit tokens from user to vault
        let deposit_mint_decimals = ctx.accounts.deposit_mint.decimals;
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                mint: ctx.accounts.deposit_mint.to_account_info(),
                from: ctx.accounts.user_deposit_token_account.to_account_info(),
                to: ctx.accounts.vault_deposit_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token_interface::transfer_checked(transfer_ctx, deposit_amount, deposit_mint_decimals)?;

        // Mint IOU tokens to user
        // The vault_state PDA must be the mint authority for the IOU mint
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_state",
            vault_state.deposit_mint.as_ref(),
            &[ctx.bumps.vault_state],
        ]];
        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.iou_mint.to_account_info(),
                to: ctx.accounts.user_iou_token_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        );
        token_interface::mint_to(mint_ctx, iou_amount)?;

        msg!(
            "Deposited {} deposit tokens, received {} IOU tokens (exchange_rate: {})",
            deposit_amount,
            iou_amount,
            vault_state.exchange_rate
        );

        Ok(())
    }

    /// Request withdrawal by burning IOU tokens and creating a withdrawal ticket.
    ///
    /// Parameters:
    /// - iou_amount: Amount of IOU tokens to burn for withdrawal
    ///
    /// Security assumptions:
    /// - User must have sufficient IOU tokens
    /// - User must not have an existing unclaimed withdrawal ticket
    /// - VaultState must be initialized
    pub fn request_withdraw(ctx: Context<RequestWithdraw>, iou_amount: u64) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;

        // Validate amount
        require!(iou_amount > 0, VaultError::InvalidAmount);

        // Check if withdrawal ticket already exists and is not claimed
        // If account was just created (init_if_needed), user will be Pubkey::default()
        // If account exists, check if it's already claimed or belongs to different user
        let withdrawal_ticket = &mut ctx.accounts.withdrawal_ticket;
        let is_new_account = withdrawal_ticket.user == Pubkey::default();

        if !is_new_account {
            // Account already exists - ensure it belongs to this user
            require!(
                withdrawal_ticket.user == ctx.accounts.user.key(),
                VaultError::InvalidTicketOwner
            );
            // Ensure previous ticket was claimed before creating a new one
            require!(withdrawal_ticket.claimed, VaultError::TicketAlreadyClaimed);
        }

        // Burn IOU tokens from user's account
        let iou_mint_decimals = ctx.accounts.iou_mint.decimals;
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.iou_mint.to_account_info(),
                from: ctx.accounts.user_iou_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token_interface::burn_checked(burn_ctx, iou_amount, iou_mint_decimals)?;

        // Create withdrawal ticket with unlock_epoch = current_epoch + 1
        let unlock_epoch = vault_state
            .current_epoch
            .checked_add(1)
            .ok_or(VaultError::MathOverflow)?;

        withdrawal_ticket.user = ctx.accounts.user.key();
        withdrawal_ticket.iou_amount = iou_amount;
        withdrawal_ticket.unlock_epoch = unlock_epoch;
        withdrawal_ticket.claimed = false;

        msg!(
            "Requested withdrawal: {} IOU tokens burned, unlock_epoch: {}",
            iou_amount,
            unlock_epoch
        );

        Ok(())
    }

    /// Claim withdrawal by transferring deposit tokens from vault to user.
    ///
    /// Parameters:
    /// - None (uses withdrawal ticket data)
    ///
    /// Security assumptions:
    /// - Withdrawal ticket must exist and belong to the user
    /// - Ticket must not be already claimed
    /// - Current epoch must be >= unlock_epoch
    /// - Vault must have sufficient deposit tokens
    pub fn claim_withdraw(ctx: Context<ClaimWithdraw>) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let withdrawal_ticket = &mut ctx.accounts.withdrawal_ticket;

        // Validate ticket ownership
        require!(
            withdrawal_ticket.user == ctx.accounts.user.key(),
            VaultError::InvalidTicketOwner
        );

        // Ensure ticket is not already claimed
        require!(!withdrawal_ticket.claimed, VaultError::TicketAlreadyClaimed);

        // Ensure unlock epoch has been reached
        require!(
            vault_state.current_epoch >= withdrawal_ticket.unlock_epoch,
            VaultError::WithdrawalNotReady
        );

        // Calculate deposit token amount based on current exchange rate
        // Formula: deposit_amount = (iou_amount * exchange_rate) / EXCHANGE_RATE_SCALE
        // When exchange_rate increases, users get more tokens back (IOU becomes more valuable)
        // This ensures users benefit from yield when the exchange rate increases
        let deposit_amount = withdrawal_ticket
            .iou_amount
            .checked_mul(vault_state.exchange_rate)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(EXCHANGE_RATE_SCALE)
            .ok_or(VaultError::MathOverflow)?;

        require!(deposit_amount > 0, VaultError::InvalidAmount);

        // Ensure vault has sufficient tokens to fulfill the withdrawal
        // This prevents undercollateralization issues when exchange rate increases
        // without corresponding token deposits
        require!(
            ctx.accounts.vault_deposit_token_account.amount >= deposit_amount,
            VaultError::InsufficientVaultBalance
        );

        // Transfer deposit tokens from vault to user
        // The vault_state PDA is the authority for the vault's deposit token account
        let deposit_mint_decimals = ctx.accounts.deposit_mint.decimals;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_state",
            vault_state.deposit_mint.as_ref(),
            &[ctx.bumps.vault_state],
        ]];
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                mint: ctx.accounts.deposit_mint.to_account_info(),
                from: ctx.accounts.vault_deposit_token_account.to_account_info(),
                to: ctx.accounts.user_deposit_token_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        );
        token_interface::transfer_checked(transfer_ctx, deposit_amount, deposit_mint_decimals)?;

        // Mark ticket as claimed
        withdrawal_ticket.claimed = true;

        msg!(
            "Claimed withdrawal: {} deposit tokens transferred (iou_amount: {}, exchange_rate: {})",
            deposit_amount,
            withdrawal_ticket.iou_amount,
            vault_state.exchange_rate
        );

        Ok(())
    }

    /// Increase the exchange rate to simulate yield growth (admin-only).
    ///
    /// Parameters:
    /// - new_exchange_rate: New exchange rate value (scaled by EXCHANGE_RATE_SCALE)
    ///
    /// Security assumptions:
    /// - Only the admin can call this instruction
    /// - New exchange rate must be greater than zero
    /// - Exchange rate should typically increase to simulate yield
    pub fn increase_rate(ctx: Context<IncreaseRate>, new_exchange_rate: u64) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;

        // Validate admin authority
        require!(
            ctx.accounts.admin.key() == vault_state.admin,
            VaultError::UnauthorizedAdmin
        );

        // Validate new exchange rate
        require!(new_exchange_rate > 0, VaultError::InvalidExchangeRate);

        // Update exchange rate
        let old_exchange_rate = vault_state.exchange_rate;
        vault_state.exchange_rate = new_exchange_rate;

        // Increment current epoch
        vault_state.current_epoch = vault_state
            .current_epoch
            .checked_add(1)
            .ok_or(VaultError::MathOverflow)?;

        msg!(
            "Exchange rate increased from {} to {}, epoch incremented to {}",
            old_exchange_rate,
            new_exchange_rate,
            vault_state.current_epoch
        );

        Ok(())
    }

    /// Deposit yield tokens into the vault (admin-only).
    /// This represents staking rewards, yield, or other income that benefits existing holders.
    /// No IOU tokens are minted - the yield increases the value of existing IOUs.
    ///
    /// Parameters:
    /// - yield_amount: Amount of deposit tokens to transfer to the vault
    ///
    /// Security assumptions:
    /// - Only the admin can call this instruction
    /// - Admin must have sufficient deposit tokens
    /// - VaultState must be initialized
    pub fn deposit_yield(ctx: Context<DepositYield>, yield_amount: u64) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;

        // Validate admin authority
        require!(
            ctx.accounts.admin.key() == vault_state.admin,
            VaultError::UnauthorizedAdmin
        );

        // Validate amount
        require!(yield_amount > 0, VaultError::InvalidAmount);

        // Transfer deposit tokens from admin to vault
        // This represents yield/staking rewards that benefit existing IOU holders
        let deposit_mint_decimals = ctx.accounts.deposit_mint.decimals;
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                mint: ctx.accounts.deposit_mint.to_account_info(),
                from: ctx.accounts.admin_deposit_token_account.to_account_info(),
                to: ctx.accounts.vault_deposit_token_account.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        );
        token_interface::transfer_checked(transfer_ctx, yield_amount, deposit_mint_decimals)?;

        msg!(
            "Deposited {} yield tokens into vault (no IOU tokens minted - yield benefits existing holders)",
            yield_amount
        );

        Ok(())
    }
}

/// VaultState stores the global vault configuration and state.
/// This is a PDA derived from the deposit_mint to ensure one vault per deposit token type.
#[account]
pub struct VaultState {
    /// Admin authority that can update exchange rate
    pub admin: Pubkey,
    /// The mint of tokens that can be deposited into the vault
    pub deposit_mint: Pubkey,
    /// The mint of IOU tokens representing shares in the vault
    pub iou_mint: Pubkey,
    /// Exchange rate: iou_amount = deposit_amount * EXCHANGE_RATE_SCALE / exchange_rate
    /// When exchange_rate increases, IOU becomes more valuable (yield-bearing behavior)
    /// Scaled by EXCHANGE_RATE_SCALE (1_000_000) for precision
    /// Example: exchange_rate = 1_100_000 means 1 IOU = 1.1 tokens
    pub exchange_rate: u64,
    /// Current epoch number (incremented by admin via increase_rate)
    pub current_epoch: u64,
}

/// WithdrawalTicket represents a pending withdrawal request.
/// Users must wait until unlock_epoch before claiming their withdrawal.
#[account]
pub struct WithdrawalTicket {
    /// The user who requested the withdrawal
    pub user: Pubkey,
    /// Amount of IOU tokens that were burned for this withdrawal
    pub iou_amount: u64,
    /// Epoch when the withdrawal can be claimed (current_epoch + 1 when created)
    pub unlock_epoch: u64,
    /// Whether this withdrawal has been claimed
    pub claimed: bool,
}

/// Context for the initialize instruction.
/// Creates the VaultState PDA account and sets initial configuration.
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The admin authority that will control the vault (must sign and pay for account creation)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The vault state PDA
    /// Seeds: ["vault_state", deposit_mint]
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 32 + 32 + 8 + 8, // discriminator + admin + deposit_mint + iou_mint + exchange_rate + current_epoch
        seeds = [b"vault_state", deposit_mint.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The deposit token mint (used in PDA seeds)
    pub deposit_mint: InterfaceAccount<'info, Mint>,

    /// The IOU token mint (stored in VaultState)
    pub iou_mint: InterfaceAccount<'info, Mint>,

    /// System program for account creation
    pub system_program: Program<'info, System>,
}

/// Context for the deposit instruction.
/// Transfers deposit tokens from user to vault and mints IOU tokens to user.
#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The user making the deposit (must sign)
    #[account(mut)]
    pub user: Signer<'info>,

    /// The vault state PDA
    #[account(
        mut,
        seeds = [b"vault_state", vault_state.deposit_mint.as_ref()],
        bump,
        has_one = deposit_mint @ VaultError::InvalidAmount,
        has_one = iou_mint @ VaultError::InvalidAmount
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The deposit token mint
    pub deposit_mint: InterfaceAccount<'info, Mint>,

    /// The IOU token mint
    #[account(mut)]
    pub iou_mint: InterfaceAccount<'info, Mint>,

    /// User's deposit token account (source of transfer)
    #[account(
        mut,
        constraint = user_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
        constraint = user_deposit_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
    )]
    pub user_deposit_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Vault's deposit token account (destination of transfer)
    #[account(
        mut,
        constraint = vault_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
        constraint = vault_deposit_token_account.owner == vault_state.key() @ VaultError::InvalidTicketOwner
    )]
    pub vault_deposit_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's IOU token account (destination of mint)
    #[account(
        mut,
        constraint = user_iou_token_account.mint == iou_mint.key() @ VaultError::InvalidAmount,
        constraint = user_iou_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
    )]
    pub user_iou_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Token program for transfers and mints
    pub token_program: Interface<'info, TokenInterface>,
}

/// Context for the request_withdraw instruction.
/// Burns IOU tokens and creates a withdrawal ticket.
#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    /// The user requesting withdrawal (must sign)
    #[account(mut)]
    pub user: Signer<'info>,

    /// The vault state PDA
    #[account(
        mut,
        seeds = [b"vault_state", vault_state.deposit_mint.as_ref()],
        bump,
        has_one = iou_mint @ VaultError::InvalidAmount
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The IOU token mint
    #[account(mut)]
    pub iou_mint: InterfaceAccount<'info, Mint>,

    /// User's IOU token account (source of burn)
    #[account(
        mut,
        constraint = user_iou_token_account.mint == iou_mint.key() @ VaultError::InvalidAmount,
        constraint = user_iou_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
    )]
    pub user_iou_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Withdrawal ticket PDA (one per user per vault)
    /// Space: 8 (discriminator) + 32 (user) + 8 (iou_amount) + 8 (unlock_epoch) + 1 (claimed) = 57
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 8 + 8 + 1,
        seeds = [b"withdrawal_ticket", user.key().as_ref(), vault_state.key().as_ref()],
        bump
    )]
    pub withdrawal_ticket: Account<'info, WithdrawalTicket>,

    /// Token program for burns
    pub token_program: Interface<'info, TokenInterface>,

    /// System program for account creation
    pub system_program: Program<'info, System>,
}

/// Context for the claim_withdraw instruction.
/// Transfers deposit tokens from vault to user and marks withdrawal ticket as claimed.
#[derive(Accounts)]
pub struct ClaimWithdraw<'info> {
    /// The user claiming the withdrawal (must sign)
    #[account(mut)]
    pub user: Signer<'info>,

    /// The vault state PDA
    #[account(
        seeds = [b"vault_state", vault_state.deposit_mint.as_ref()],
        bump,
        has_one = deposit_mint @ VaultError::InvalidAmount
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The deposit token mint
    pub deposit_mint: InterfaceAccount<'info, Mint>,

    /// Vault's deposit token account (source of transfer, owned by vault_state PDA)
    #[account(
        mut,
        constraint = vault_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
        constraint = vault_deposit_token_account.owner == vault_state.key() @ VaultError::InvalidTicketOwner
    )]
    pub vault_deposit_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's deposit token account (destination of transfer)
    #[account(
        mut,
        constraint = user_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
        constraint = user_deposit_token_account.owner == user.key() @ VaultError::InvalidTicketOwner
    )]
    pub user_deposit_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Withdrawal ticket PDA
    #[account(
        mut,
        seeds = [b"withdrawal_ticket", user.key().as_ref(), vault_state.key().as_ref()],
        bump
    )]
    pub withdrawal_ticket: Account<'info, WithdrawalTicket>,

    /// Token program for transfers
    pub token_program: Interface<'info, TokenInterface>,
}

/// Context for the increase_rate instruction.
/// Updates exchange rate and increments epoch (admin-only).
#[derive(Accounts)]
pub struct IncreaseRate<'info> {
    /// The admin authority (must sign and match vault_state.admin)
    pub admin: Signer<'info>,

    /// The vault state PDA (mutable to update exchange_rate and current_epoch)
    #[account(
        mut,
        seeds = [b"vault_state", vault_state.deposit_mint.as_ref()],
        bump,
        has_one = admin @ VaultError::UnauthorizedAdmin
    )]
    pub vault_state: Account<'info, VaultState>,
}

/// Context for the deposit_yield instruction.
/// Transfers deposit tokens from admin to vault without minting IOU tokens (admin-only).
#[derive(Accounts)]
pub struct DepositYield<'info> {
    /// The admin authority (must sign and match vault_state.admin)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The vault state PDA
    #[account(
        seeds = [b"vault_state", vault_state.deposit_mint.as_ref()],
        bump,
        has_one = admin @ VaultError::UnauthorizedAdmin
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The deposit token mint
    pub deposit_mint: InterfaceAccount<'info, Mint>,

    /// Admin's deposit token account (source of transfer)
    #[account(
        mut,
        constraint = admin_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
        constraint = admin_deposit_token_account.owner == admin.key() @ VaultError::InvalidTicketOwner
    )]
    pub admin_deposit_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Vault's deposit token account (destination of transfer, owned by vault_state PDA)
    #[account(
        mut,
        constraint = vault_deposit_token_account.mint == deposit_mint.key() @ VaultError::InvalidAmount,
        constraint = vault_deposit_token_account.owner == vault_state.key() @ VaultError::InvalidTicketOwner
    )]
    pub vault_deposit_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Token program for transfers
    pub token_program: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum VaultError {
    #[msg("Invalid exchange rate")]
    InvalidExchangeRate,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Withdrawal ticket already claimed")]
    TicketAlreadyClaimed,
    #[msg("Invalid ticket owner")]
    InvalidTicketOwner,
    #[msg("Withdrawal not ready - unlock epoch not reached")]
    WithdrawalNotReady,
    #[msg("Unauthorized - only admin can perform this action")]
    UnauthorizedAdmin,
    #[msg("Insufficient vault balance - vault does not have enough tokens to fulfill withdrawal")]
    InsufficientVaultBalance,
}
