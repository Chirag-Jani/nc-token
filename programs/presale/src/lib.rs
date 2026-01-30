//! # Presale Program
//!
//! A secure presale contract for token distribution with:
//! - Multi-token payment support (USDC, USDT, etc.)
//! - Native SOL payment support
//! - Presale caps (total and per-user limits)
//! - Blacklist enforcement
//! - Emergency pause integration
//! - Treasury management
//! - Comprehensive access controls
//!
//! ## Security Features
//! - Admin and governance authority separation
//! - Blacklist checks before purchases
//! - Presale cap enforcement
//! - Per-user purchase limits
//! - Emergency pause from token program
//! - Treasury address validation
//!
//! ## Presale Flow
//! 1. Initialize: Set up presale with admin and token program
//! 2. Allow Payment Tokens: Whitelist payment tokens (USDC, USDT) - SOL is always available
//! 3. Start Presale: Activate presale for purchases
//! 4. Buy: Users purchase tokens with allowed payment tokens or native SOL
//! 5. Withdraw: Admin withdraws funds to treasury

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use chainlink_solana::v2::read_feed_v2;

// Import token and governance programs for CPI integration
#[allow(unused_imports)]
use spl_project::program::SplProject;
// #[allow(unused_imports)]
// use governance::program::Governance;

declare_id!("2mVRhN7rnpFbjZd4gbYJ2vcAzHxE8YFMho6LAk4Y1mQu");

// Constants for token account layout offsets
pub const TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;
pub const TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;
pub const TOKEN_STATE_EMERGENCY_PAUSED_OFFSET: usize = 41; // discriminator(8) + authority(32) + bump(1) = 41

// Chainlink SOL/USD Price Feed Addresses
// Mainnet: CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt
// Devnet: 99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR
// Chainlink OCR2 Program ID: HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny

// Production feed verification: we hardcode ONLY the Chainlink OCR2 program ID.
// Exact mainnet/devnet feed addresses are enforced off-chain in clients.
pub const CHAINLINK_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");

// Chainlink price feed has 8 decimals
pub const CHAINLINK_DECIMALS: u8 = 8;
// SOL has 9 decimals (lamports)
pub const SOL_DECIMALS: u8 = 9;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
// Token has 8 decimals (allows up to 184 billion supply with u64)
pub const TOKEN_DECIMALS: u8 = 8;
// Staleness threshold: 3600 seconds (1 hour) - price feed should be updated within this time
pub const PRICE_FEED_STALENESS_THRESHOLD_SECONDS: i64 = 3600;

#[event]
pub struct TreasuryWithdrawn {
    pub amount: u64,
    pub treasury: Pubkey,
}

#[event]
pub struct PresaleStarted {
    pub previous_status: u8,
}

#[event]
pub struct PresaleStopped {}

#[event]
pub struct PresalePaused {}

#[program]
pub mod presale {
    use super::*;

    /// Initializes the presale contract
    ///
    /// Sets up the presale state with admin, token program, and initial configuration.
    /// This is a one-time operation that establishes the presale structure.
    ///
    /// # Parameters
    /// - `ctx`: Initialize context
    /// - `admin`: Admin address (must not be default)
    /// - `presale_token_mint`: The token mint being sold
    /// - `token_program`: Token program ID (must not be default)
    /// - `token_program_state`: Token program state PDA (must not be default)
    ///
    /// # Returns
    /// - `Result<()>`: Success if initialization completes
    ///
    /// # Errors
    /// - `PresaleError::InvalidAccount` if any address is default
    ///
    /// # Security
    /// - Validates all addresses are not default
    /// - Sets initial state to NotStarted
    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Pubkey,
        presale_token_mint: Pubkey,
        token_program: Pubkey,
        token_program_state: Pubkey,
        token_price_usd_micro: u64,
    ) -> Result<()> {
        // Validate admin is not default
        require!(
            admin != Pubkey::default(),
            PresaleError::InvalidAccount
        );
        // Validate presale token mint is not default
        require!(
            presale_token_mint != Pubkey::default(),
            PresaleError::InvalidAccount
        );
        // Validate token program is not default
        require!(
            token_program != Pubkey::default(),
            PresaleError::InvalidAccount
        );
        // Validate token program state is not default
        require!(
            token_program_state != Pubkey::default(),
            PresaleError::InvalidAccount
        );
        // Validate token_price_usd_micro is greater than 0
        require!(
            token_price_usd_micro > 0,
            PresaleError::InvalidAmount
        );

        let presale_state = &mut ctx.accounts.presale_state;
        presale_state.admin = admin;
        presale_state.authority = admin; // Initially admin, can be transferred to governance
        presale_state.governance = Pubkey::default();
        presale_state.token_program = token_program;
        presale_state.token_program_state = token_program_state;
        presale_state.presale_token_mint = presale_token_mint;
        presale_state.status = PresaleStatus::NotStarted;
        presale_state.total_tokens_sold = 0;
        presale_state.total_raised = 0;
        presale_state.governance_set = false;
        presale_state.treasury_address = Pubkey::default(); // Can be set later via set_treasury_address
        presale_state.max_presale_cap = 0; // 0 = unlimited
        presale_state.max_per_user = 0; // 0 = unlimited
        presale_state.token_price_usd_micro = token_price_usd_micro;
        presale_state.bump = ctx.bumps.presale_state;
        
        msg!("Presale initialized with admin: {}, token_program: {}, token_price_usd_micro: {}", admin, token_program, token_price_usd_micro);
        Ok(())
    }

    /// Migrates existing presale state from tokens_per_sol to token_price_usd_micro
    ///
    /// This function migrates the PresaleState account to use Chainlink oracle pricing.
    /// It replaces the old tokens_per_sol field with token_price_usd_micro.
    /// This is a one-time migration for existing deployments.
    ///
    /// # Parameters
    /// - `ctx`: MigratePresaleState context (requires authority)
    /// - `token_price_usd_micro`: Token price in micro-USD (e.g., 1000 = $0.001 per token)
    ///
    /// # Returns
    /// - `Result<()>`: Success if migration completes
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not authority
    /// - `PresaleError::InvalidAmount` if token_price_usd_micro is 0
    ///
    /// # Security
    /// - Only authority (admin or governance) can migrate
    /// - Reallocates account if needed
    /// - Sets token_price_usd_micro field
    pub fn migrate_presale_state(
        ctx: Context<MigratePresaleState>,
        token_price_usd_micro: u64,
    ) -> Result<()> {
        // Validate token_price_usd_micro is greater than 0
        require!(
            token_price_usd_micro > 0,
            PresaleError::InvalidAmount
        );
        
        // Verify PDA manually (without deserialization)
        let (expected_pda, _expected_bump) = Pubkey::find_program_address(
            &[b"presale_state"],
            ctx.program_id,
        );
        require!(
            ctx.accounts.presale_state.key() == expected_pda,
            PresaleError::InvalidAccount
        );
        
        // Get account data to verify authority and check structure
        let account_data = ctx.accounts.presale_state.try_borrow_data()?;
        let account_len = account_data.len();
        
        // Verify authority from raw account data
        // Authority is at offset 40 (8 discriminator + 32 admin)
        require!(account_data.len() >= 72, PresaleError::InvalidAccount);
        let authority_bytes = &account_data[40..72];
        let account_authority = Pubkey::try_from_slice(authority_bytes)
            .map_err(|_| PresaleError::InvalidAccount)?;
        
        // Check if caller is authorized as admin
        let is_admin = account_authority == ctx.accounts.authority.key();
        
        // Check governance if account is large enough
        let is_governance = if account_len >= 105 {
            let governance_bytes = &account_data[72..104];
            let governance = Pubkey::try_from_slice(governance_bytes)
                .map_err(|_| PresaleError::InvalidAccount)?;
            let governance_set = account_data.len() > 104 && account_data[104] != 0;
            governance_set && governance == ctx.accounts.authority.key()
        } else {
            false
        };
        
        require!(
            is_admin || is_governance,
            PresaleError::Unauthorized
        );
        
        // Check if account needs reallocation (old structure)
        let new_size = 8 + PresaleState::LEN;
        let needs_realloc = account_len < new_size;
        
        // Drop borrow before realloc
        drop(account_data);
        
        // Reallocate if needed
        if needs_realloc {
            let rent = anchor_lang::solana_program::rent::Rent::get()?;
            let new_minimum_balance = rent.minimum_balance(new_size);
            let current_lamports = ctx.accounts.presale_state.lamports();
            
            if current_lamports < new_minimum_balance {
                let additional_lamports = new_minimum_balance
                    .checked_sub(current_lamports)
                    .ok_or(PresaleError::Overflow)?;
                
                anchor_lang::solana_program::program::invoke(
                    &anchor_lang::solana_program::system_instruction::transfer(
                        &ctx.accounts.authority.key(),
                        &ctx.accounts.presale_state.key(),
                        additional_lamports,
                    ),
                    &[
                        ctx.accounts.authority.to_account_info(),
                        ctx.accounts.presale_state.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                )?;
            }
            
            // Reallocate the account using Solana's realloc syscall
            // 
            // PRODUCTION-READY APPROACH:
            // The realloc syscall is the standard, production-safe Solana mechanism for account resizing.
            // AccountInfo::realloc() directly invokes the Solana realloc syscall, which is:
            // - The official Solana way to resize accounts
            // - Used by all production Solana programs
            // - Safe and battle-tested
            //
            // The deprecation warning is about Anchor's API wrapper evolution (realloc -> resize),
            // NOT about the underlying Solana syscall safety. The realloc syscall itself is:
            // - Not deprecated by Solana
            // - The standard way to resize accounts
            // - Production-safe and recommended
            //
            // We've already ensured sufficient lamports above, so realloc is safe to call.
            let account_info = ctx.accounts.presale_state.to_account_info();
            
            // Call Solana's realloc syscall: extends account to new_size, preserving existing data
            // Parameter `false` means: don't zero existing data (we want to preserve it)
            // New space will be uninitialized, which we'll set to the tokens_per_sol value below
            #[allow(deprecated)] // Safe: This is the standard Solana realloc syscall, production-ready
            account_info.realloc(new_size, false)?;
        }
        
        // Now update token_price_usd_micro field manually
        // token_price_usd_micro offset: 8 (discriminator) + 32 (admin) + 32 (authority) + 32 (governance) + 
        //                              32 (token_program) + 32 (token_program_state) + 32 (mint) + 
        //                              1 (status) + 8 (sold) + 8 (raised) + 1 (governance_set) + 
        //                              32 (treasury) + 8 (max_presale_cap) + 8 (max_per_user) = 265
        const TOKEN_PRICE_USD_MICRO_OFFSET: usize = 8 + 32 + 32 + 32 + 32 + 32 + 32 + 1 + 8 + 8 + 1 + 32 + 8 + 8;
        
        let mut account_data_mut = ctx.accounts.presale_state.try_borrow_mut_data()?;
        
        // Read current value (might be old tokens_per_sol or already token_price_usd_micro)
        let current_value = if account_data_mut.len() > TOKEN_PRICE_USD_MICRO_OFFSET + 8 {
            u64::from_le_bytes(
                account_data_mut[TOKEN_PRICE_USD_MICRO_OFFSET..TOKEN_PRICE_USD_MICRO_OFFSET + 8]
                    .try_into()
                    .map_err(|_| PresaleError::InvalidAmount)?
            )
        } else {
            0
        };
        
        // Update the field
        account_data_mut[TOKEN_PRICE_USD_MICRO_OFFSET..TOKEN_PRICE_USD_MICRO_OFFSET + 8]
            .copy_from_slice(&token_price_usd_micro.to_le_bytes());
        
        if current_value == 0 {
            msg!(
                "Presale state migrated: token_price_usd_micro set to {} by authority {}",
                token_price_usd_micro,
                ctx.accounts.authority.key()
            );
        } else {
            msg!(
                "Presale state migrated from old pricing (value: {}) to token_price_usd_micro: {} by authority {}",
                current_value,
                token_price_usd_micro,
                ctx.accounts.authority.key()
            );
        }
        
        Ok(())
    }

    // Transfer authority to governance PDA (one-time operation)
    pub fn set_governance(ctx: Context<SetGovernance>, new_authority: Pubkey) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        // Only current authority can transfer
        require!(
            presale_state.authority == ctx.accounts.authority.key(),
            PresaleError::Unauthorized
        );
        // Validate new_authority is not default
        require!(
            new_authority != Pubkey::default(),
            PresaleError::InvalidAccount
        );
        // Validate governance hasn't been set already (one-time operation)
        require!(
            !presale_state.governance_set,
            PresaleError::InvalidStatus
        );
        let old_authority = presale_state.authority;
        presale_state.authority = new_authority;
        presale_state.governance = new_authority;
        presale_state.governance_set = true;
        msg!(
            "Authority transferred from {:?} to {:?}",
            old_authority,
            new_authority
        );
        Ok(())
    }

    // Set the token program address (can be called by admin or governance)
    pub fn set_token_program(
        ctx: Context<SetTokenProgram>,
        token_program: Pubkey,
        token_program_state: Pubkey,
    ) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        // Validate token program is not default
        require!(
            token_program != Pubkey::default(),
            PresaleError::InvalidAccount
        );
        // Validate token program state is not default
        require!(
            token_program_state != Pubkey::default(),
            PresaleError::InvalidAccount
        );
        let old_token_program = presale_state.token_program;
        presale_state.token_program = token_program;
        presale_state.token_program_state = token_program_state;
        msg!("Token program updated from {:?} to {:?}", old_token_program, token_program);
        Ok(())
    }

    /// Starts the presale, allowing purchases
    ///
    /// Changes presale status from NotStarted or Paused to Active.
    /// Only admin can call this function.
    ///
    /// # Parameters
    /// - `ctx`: AdminOnly context (requires admin authority)
    ///
    /// # Returns
    /// - `Result<()>`: Success if presale is started
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not admin
    /// - `PresaleError::InvalidStatus` if presale is not in NotStarted or Paused state
    ///
    /// # Events
    /// - Emits `PresaleStarted` with previous status
    pub fn start_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        // Verify authority (AdminOnly has 'admin' field, not 'authority')
        require!(
            presale_state.authority == ctx.accounts.admin.key(),
            PresaleError::Unauthorized
        );
        
        require!(
            presale_state.status == PresaleStatus::NotStarted 
                || presale_state.status == PresaleStatus::Paused,
            PresaleError::InvalidStatus
        );
        
        let old_status = presale_state.status;
        presale_state.status = PresaleStatus::Active;
        
        // Emit event
        emit!(PresaleStarted {
            previous_status: old_status as u8,
        });
        
        msg!("Presale started");
        Ok(())
    }

    /// Stops the presale, preventing new purchases
    ///
    /// Changes presale status from Active to Stopped.
    /// Only admin can call this function.
    ///
    /// # Parameters
    /// - `ctx`: AdminOnly context (requires admin authority)
    ///
    /// # Returns
    /// - `Result<()>`: Success if presale is stopped
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not admin
    /// - `PresaleError::InvalidStatus` if presale is not Active
    ///
    /// # Events
    /// - Emits `PresaleStopped`
    pub fn stop_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        // Verify authority (AdminOnly has 'admin' field, not 'authority')
        require!(
            presale_state.authority == ctx.accounts.admin.key(),
            PresaleError::Unauthorized
        );
        
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::InvalidStatus
        );
        
        presale_state.status = PresaleStatus::Stopped;
        
        // Emit event
        emit!(PresaleStopped {});
        
        msg!("Presale stopped");
        Ok(())
    }

    /// Pauses the presale temporarily
    ///
    /// Changes presale status from Active to Paused, preventing new purchases
    /// but allowing resumption via start_presale.
    /// Only admin can call this function.
    ///
    /// # Parameters
    /// - `ctx`: AdminOnly context (requires admin authority)
    ///
    /// # Returns
    /// - `Result<()>`: Success if presale is paused
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not admin
    /// - `PresaleError::InvalidStatus` if presale is not Active
    ///
    /// # Events
    /// - Emits `PresalePaused`
    pub fn pause_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        // Verify authority (AdminOnly has 'admin' field, not 'authority')
        require!(
            presale_state.authority == ctx.accounts.admin.key(),
            PresaleError::Unauthorized
        );
        
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::InvalidStatus
        );
        
        presale_state.status = PresaleStatus::Paused;
        msg!("Presale paused");
        Ok(())
    }

    // Admin function to allow a payment token (USDC, USDT, etc.)
    pub fn allow_payment_token(
        ctx: Context<AllowPaymentToken>,
        payment_token_mint: Pubkey,
    ) -> Result<()> {
        let allowed_token = &mut ctx.accounts.allowed_token;
        allowed_token.payment_token_mint = payment_token_mint;
        allowed_token.is_allowed = true;
        allowed_token.presale_state = ctx.accounts.presale_state.key();
        
        msg!("Payment token allowed: {}", payment_token_mint);
        Ok(())
    }

    // Admin function to disallow a payment token
    pub fn disallow_payment_token(
        ctx: Context<DisallowPaymentToken>,
    ) -> Result<()> {
        let allowed_token = &mut ctx.accounts.allowed_token;
        allowed_token.is_allowed = false;
        
        msg!("Payment token disallowed");
        Ok(())
    }

    /// Allows users to buy presale tokens with allowed payment tokens
    ///
    /// Transfers payment tokens from buyer to presale vault and transfers presale
    /// tokens from presale vault to buyer. Enforces all security checks including
    /// blacklist, presale caps, and emergency pause.
    ///
    /// # Parameters
    /// - `ctx`: Buy context with all required accounts
    /// - `amount`: Amount of payment tokens to spend (in payment token's base units)
    ///
    /// # Returns
    /// - `Result<()>`: Success if purchase completes
    ///
    /// # Errors
    /// - `PresaleError::PresaleNotActive` if presale is not active
    /// - `PresaleError::TokenEmergencyPaused` if token program is paused
    /// - `PresaleError::BuyerBlacklisted` if buyer is blacklisted
    /// - `PresaleError::PaymentTokenNotAllowed` if payment token not whitelisted
    /// - `PresaleError::PresaleCapExceeded` if purchase exceeds total cap
    /// - `PresaleError::PerUserLimitExceeded` if purchase exceeds per-user limit
    ///
    /// # Security
    /// - Blacklist check before purchase
    /// - Emergency pause check
    /// - Presale cap enforcement
    /// - Per-user limit enforcement
    /// - Manual token account validation for safety
    pub fn buy(
        ctx: Context<Buy>,
        amount: u64, // Amount of payment tokens to spend
    ) -> Result<()> {
        let presale_state = &ctx.accounts.presale_state;
        
        // Check if presale is active
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::PresaleNotActive
        );

        // Check token program emergency pause
        // Deserialize token state manually to check emergency_paused
        let token_state_data = ctx.accounts.token_state.try_borrow_data()?;
        if token_state_data.len() > TOKEN_STATE_EMERGENCY_PAUSED_OFFSET {
            let emergency_paused = token_state_data[TOKEN_STATE_EMERGENCY_PAUSED_OFFSET] != 0;
            require!(
                !emergency_paused,
                PresaleError::TokenEmergencyPaused
            );
        }

        // Check if buyer is blacklisted
        if ctx.accounts.buyer_blacklist.key() != Pubkey::default() {
            let blacklist_data = ctx.accounts.buyer_blacklist.try_borrow_data()?;
            if blacklist_data.len() >= 41 {
                // Account discriminator (8) + account Pubkey (32) + is_blacklisted bool (1) = offset 40
                let is_blacklisted = blacklist_data[40] != 0;
                require!(!is_blacklisted, PresaleError::BuyerBlacklisted);
            }
        }
        
        // Check if payment token is allowed
        let allowed_token = &ctx.accounts.allowed_token;
        require!(
            allowed_token.is_allowed,
            PresaleError::PaymentTokenNotAllowed
        );

        // Validate token account mints match (manual validation)
        let buyer_payment_data = ctx.accounts.buyer_payment_token_account.try_borrow_data()?;
        require!(buyer_payment_data.len() >= 32, PresaleError::PaymentTokenNotAllowed);
        let buyer_payment_mint = Pubkey::try_from_slice(&buyer_payment_data[0..32])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        require!(
            buyer_payment_mint == ctx.accounts.payment_token_mint.key(),
            PresaleError::PaymentTokenNotAllowed
        );
        
        let buyer_token_data = ctx.accounts.buyer_token_account.try_borrow_data()?;
        require!(buyer_token_data.len() >= 32, PresaleError::PaymentTokenNotAllowed);
        let buyer_token_mint = Pubkey::try_from_slice(&buyer_token_data[0..32])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        require!(
            buyer_token_mint == presale_state.presale_token_mint,
            PresaleError::PaymentTokenNotAllowed
        );

        // Calculate tokens to receive (1:1 ratio - you can modify this)
        let tokens_to_receive = amount; // Adjust based on your pricing logic

        // Check presale cap
        if presale_state.max_presale_cap > 0 {
            let new_total = presale_state
                .total_tokens_sold
                .checked_add(tokens_to_receive)
                .ok_or(PresaleError::Overflow)?;
            require!(
                new_total <= presale_state.max_presale_cap,
                PresaleError::PresaleCapExceeded
            );
        }

        // Check per-user limit
        if presale_state.max_per_user > 0 {
            let user_purchase = &mut ctx.accounts.user_purchase;
            let new_user_total = user_purchase.total_purchased
                .checked_add(tokens_to_receive)
                .ok_or(PresaleError::Overflow)?;
            require!(
                new_user_total <= presale_state.max_per_user,
                PresaleError::PerUserLimitExceeded
            );
        }

        // Validate payment vault (manual validation)
        let payment_vault_data = ctx.accounts.presale_payment_vault.try_borrow_data()?;
        require!(payment_vault_data.len() >= 64, PresaleError::PaymentTokenNotAllowed);
        let payment_vault_mint = Pubkey::try_from_slice(&payment_vault_data[0..32])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        let payment_vault_owner = Pubkey::try_from_slice(&payment_vault_data[32..64])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        require!(
            payment_vault_mint == ctx.accounts.payment_token_mint.key(),
            PresaleError::PaymentTokenNotAllowed
        );
        require!(
            payment_vault_owner == ctx.accounts.presale_payment_vault_pda.key(),
            PresaleError::PaymentTokenNotAllowed
        );

        // Transfer payment tokens from buyer to presale vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer_payment_token_account.to_account_info(),
            to: ctx.accounts.presale_payment_vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Validate presale token vault (manual validation)
        let presale_token_vault_data = ctx.accounts.presale_token_vault.try_borrow_data()?;
        require!(presale_token_vault_data.len() >= 64, PresaleError::PaymentTokenNotAllowed);
        let presale_token_vault_mint = Pubkey::try_from_slice(&presale_token_vault_data[0..32])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        let presale_token_vault_owner = Pubkey::try_from_slice(&presale_token_vault_data[32..64])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        require!(
            presale_token_vault_mint == presale_state.presale_token_mint,
            PresaleError::PaymentTokenNotAllowed
        );
        require!(
            presale_token_vault_owner == ctx.accounts.presale_token_vault_pda.key(),
            PresaleError::PaymentTokenNotAllowed
        );

        // Transfer presale tokens from presale vault to buyer
        let seeds = &[
            b"presale_token_vault_pda",
            presale_state.presale_token_mint.as_ref(),
            &[ctx.bumps.presale_token_vault_pda],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.presale_token_vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.presale_token_vault_pda.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, tokens_to_receive)?;

        // Update state
        let presale_state = &mut ctx.accounts.presale_state;
        presale_state.total_tokens_sold = presale_state
            .total_tokens_sold
            .checked_add(tokens_to_receive)
            .ok_or(PresaleError::Overflow)?;
        presale_state.total_raised = presale_state
            .total_raised
            .checked_add(amount)
            .ok_or(PresaleError::Overflow)?;

        // Update user purchase tracker
        let user_purchase = &mut ctx.accounts.user_purchase;
        if user_purchase.buyer == Pubkey::default() {
            user_purchase.buyer = ctx.accounts.buyer.key();
            user_purchase.total_purchased = 0;
        }
        user_purchase.total_purchased = user_purchase
            .total_purchased
            .checked_add(tokens_to_receive)
            .ok_or(PresaleError::Overflow)?;

        msg!(
            "Buy successful: {} tokens for {} payment tokens",
            tokens_to_receive,
            amount
        );

        Ok(())
    }

    /// Allows users to buy presale tokens with native SOL
    ///
    /// Transfers SOL from buyer to presale SOL vault and transfers presale
    /// tokens from presale vault to buyer. Enforces all security checks including
    /// blacklist, presale caps, and emergency pause.
    ///
    /// # Parameters
    /// - `ctx`: BuyWithSol context with all required accounts
    /// - `sol_amount`: Amount of SOL to spend (in lamports)
    ///
    /// # Returns
    /// - `Result<()>`: Success if purchase completes
    ///
    /// # Errors
    /// - `PresaleError::PresaleNotActive` if presale is not active
    /// - `PresaleError::TokenEmergencyPaused` if token program is paused
    /// - `PresaleError::BuyerBlacklisted` if buyer is blacklisted
    /// - `PresaleError::PresaleCapExceeded` if purchase exceeds total cap
    /// - `PresaleError::PerUserLimitExceeded` if purchase exceeds per-user limit
    /// - `PresaleError::InvalidAmount` if amount is 0 or exceeds buyer balance
    pub fn buy_with_sol(
        ctx: Context<BuyWithSol>,
        sol_amount: u64, // Amount of SOL to spend (in lamports)
    ) -> Result<()> {
        let presale_state = &ctx.accounts.presale_state;
        
        // Check if presale is active
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::PresaleNotActive
        );

        // Validate amount
        require!(
            sol_amount > 0,
            PresaleError::InvalidAmount
        );

        // Check buyer has enough SOL
        require!(
            ctx.accounts.buyer.lamports() >= sol_amount,
            PresaleError::InvalidAmount
        );

        // Check token program emergency pause - scope the borrow
        let emergency_paused = {
            let token_state_data = ctx.accounts.token_state.try_borrow_data()?;
            if token_state_data.len() > TOKEN_STATE_EMERGENCY_PAUSED_OFFSET {
                token_state_data[TOKEN_STATE_EMERGENCY_PAUSED_OFFSET] != 0
            } else {
                false
            }
        }; // Borrow dropped here
        require!(
            !emergency_paused,
            PresaleError::TokenEmergencyPaused
        );

        // Check if buyer is blacklisted - scope the borrow
        if ctx.accounts.buyer_blacklist.key() != Pubkey::default() {
            let is_blacklisted = {
                let blacklist_data = ctx.accounts.buyer_blacklist.try_borrow_data()?;
                if blacklist_data.len() >= 41 {
                    blacklist_data[40] != 0
                } else {
                    false
                }
            }; // Borrow dropped here
            require!(!is_blacklisted, PresaleError::BuyerBlacklisted);
        }

        // Read SOL/USD price from Chainlink oracle using SDK v2
        let feed = &ctx.accounts.chainlink_feed;
        let feed_data = read_feed_v2(
            feed.try_borrow_data()?,
            feed.owner.to_bytes(),
        )
        .map_err(|_| PresaleError::InvalidPrice)?;
        
        // Get the latest round data (price + timestamp)
        let round = feed_data
            .latest_round_data()
            .ok_or(PresaleError::InvalidPrice)?;
        
        let sol_price_usd = round.answer; // Price with 8 decimals (e.g., 140_00000000 = $140)
        
        // Validate price is positive
        require!(
            sol_price_usd > 0,
            PresaleError::InvalidPrice
        );
        
        // Optional: Check that the feed uses the expected decimals (8)
        let decimals = feed_data.decimals();
        require!(
            decimals == CHAINLINK_DECIMALS,
            PresaleError::InvalidPrice
        );
        
        // Check for stale price using round timestamp
        let current_timestamp = Clock::get()?.unix_timestamp;
        // round.timestamp is u32, convert to i64 to match unix_timestamp type
        let price_age = current_timestamp
            .checked_sub(round.timestamp.into())
            .ok_or(PresaleError::InvalidPrice)?;
        
        require!(
            price_age <= PRICE_FEED_STALENESS_THRESHOLD_SECONDS,
            PresaleError::StalePrice
        );
        
        // Production security: Verify feed owner is Chainlink OCR2 program.
        // We do NOT hardcode specific feed addresses on-chain; instead, we rely on:
        // - Owner verification (must be Chainlink OCR2 program)
        // - Decimals check (must be 8)
        // - Positive price
        // - Staleness check
        require!(
            feed.owner == &CHAINLINK_PROGRAM_ID,
            PresaleError::InvalidPrice
        );
        
        // Calculate tokens to receive using Chainlink price
        // Formula: 
        // 1. Convert SOL amount to USD: sol_usd = (sol_amount * sol_price_usd) / (10^8 * 10^9)
        // 2. Calculate tokens: tokens = sol_usd / token_price_usd
        // Combined: tokens = (sol_amount * sol_price_usd) / (token_price_usd_micro * 10^8 * 10^9 / 10^6)
        // Simplified: tokens = (sol_amount * sol_price_usd * 10^6) / (token_price_usd_micro * 10^8 * 10^9)
        // Further simplified: tokens = (sol_amount * sol_price_usd) / (token_price_usd_micro * 10^11)
        
        // Validate token_price_usd_micro is set
        require!(
            presale_state.token_price_usd_micro > 0,
            PresaleError::InvalidAmount
        );

        // IMPORTANT: Use u128 intermediates to avoid u64 multiplication overflow
        // sol_price_usd is i128 from Chainlink, convert to u128 (we already checked it's > 0)
        let sol_price_usd_u128 = sol_price_usd as u128;
        
        // Calculate: tokens = (sol_amount * sol_price_usd * 1_000_000 * 10^8) / (token_price_usd_micro * 10^8)
        // Where:
        // - sol_amount is in lamports (9 decimals)
        // - sol_price_usd has 8 decimals from Chainlink
        // - token_price_usd_micro is in micro-USD (6 decimals, e.g., 1000 = $0.001)
        // - Result is in token base units (8 decimals)
        //
        // Formula breakdown:
        // 1. SOL to USD: (sol_amount * sol_price_usd) / (10^9 * 10^8) = USD value
        // 2. USD to tokens: USD_value / (token_price_usd_micro / 10^6) = token value (human-readable)
        // 3. Combined: (sol_amount * sol_price_usd * 10^6) / (token_price_usd_micro * 10^9 * 10^8)
        // 4. Convert to base units (8 decimals): multiply by 10^8
        //    tokens_base = (sol_amount * sol_price_usd * 10^6 * 10^8) / (token_price_usd_micro * 10^9 * 10^8)
        // 5. Simplified: tokens_base = (sol_amount * sol_price_usd * 10^6) / (token_price_usd_micro * 10^9)
        //    tokens_base = (sol_amount * sol_price_usd * 10^6) / (token_price_usd_micro * 10^9)
        
        let tokens_to_receive_u128 = (sol_amount as u128)
            .checked_mul(sol_price_usd_u128)
            .ok_or(PresaleError::Overflow)?
            .checked_mul(1_000_000u128) // Convert to micro-USD (10^6)
            .ok_or(PresaleError::Overflow)?
            .checked_mul(10u128.pow(TOKEN_DECIMALS as u32)) // 10^8 for token base units
            .ok_or(PresaleError::Overflow)?
            .checked_div(
                (presale_state.token_price_usd_micro as u128)
                    .checked_mul(10u128.pow(SOL_DECIMALS as u32)) // 10^9 for SOL decimals
                    .ok_or(PresaleError::Overflow)?
                    .checked_mul(10u128.pow(CHAINLINK_DECIMALS as u32)) // 10^8 for Chainlink decimals
                    .ok_or(PresaleError::Overflow)?
            )
            .ok_or(PresaleError::Overflow)?;

        require!(
            tokens_to_receive_u128 <= u64::MAX as u128,
            PresaleError::Overflow
        );

        let tokens_to_receive = tokens_to_receive_u128 as u64;
        
        // Validate tokens_to_receive is greater than 0
        require!(
            tokens_to_receive > 0,
            PresaleError::InvalidAmount
        );

        // Check presale cap
        if presale_state.max_presale_cap > 0 {
            let new_total = presale_state
                .total_tokens_sold
                .checked_add(tokens_to_receive)
                .ok_or(PresaleError::Overflow)?;
            require!(
                new_total <= presale_state.max_presale_cap,
                PresaleError::PresaleCapExceeded
            );
        }

        // Check per-user limit
        if presale_state.max_per_user > 0 {
            let user_purchase = &mut ctx.accounts.user_purchase;
            let new_user_total = user_purchase.total_purchased
                .checked_add(tokens_to_receive)
                .ok_or(PresaleError::Overflow)?;
            require!(
                new_user_total <= presale_state.max_per_user,
                PresaleError::PerUserLimitExceeded
            );
        }

        // Extract values we need before borrowing
        let presale_token_mint = presale_state.presale_token_mint;
        let presale_token_vault_pda_bump = ctx.bumps.presale_token_vault_pda;
        let presale_token_vault_pda_key = ctx.accounts.presale_token_vault_pda.key();

        // Transfer SOL from buyer to presale SOL vault using system program
        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.sol_vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        anchor_lang::system_program::transfer(cpi_ctx, sol_amount)?;

        // Validate presale token vault (manual validation) - scope the borrow
        let (presale_token_vault_mint, presale_token_vault_owner) = {
            let presale_token_vault_data = ctx.accounts.presale_token_vault.try_borrow_data()?;
            require!(presale_token_vault_data.len() >= 64, PresaleError::PaymentTokenNotAllowed);
            let mint = Pubkey::try_from_slice(&presale_token_vault_data[0..32])
                .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
            let owner = Pubkey::try_from_slice(&presale_token_vault_data[32..64])
                .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
            (mint, owner)
        }; // Borrow dropped here

        require!(
            presale_token_vault_mint == presale_token_mint,
            PresaleError::PaymentTokenNotAllowed
        );
        require!(
            presale_token_vault_owner == presale_token_vault_pda_key,
            PresaleError::PaymentTokenNotAllowed
        );

        // Transfer presale tokens from presale vault to buyer
        let seeds = &[
            b"presale_token_vault_pda",
            presale_token_mint.as_ref(),
            &[presale_token_vault_pda_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.presale_token_vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.presale_token_vault_pda.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, tokens_to_receive)?;

        // Update state (now we can mutably borrow)
        let presale_state = &mut ctx.accounts.presale_state;
        presale_state.total_tokens_sold = presale_state
            .total_tokens_sold
            .checked_add(tokens_to_receive)
            .ok_or(PresaleError::Overflow)?;
        presale_state.total_raised = presale_state
            .total_raised
            .checked_add(sol_amount)
            .ok_or(PresaleError::Overflow)?;

        // Update user purchase tracker
        let user_purchase = &mut ctx.accounts.user_purchase;
        if user_purchase.buyer == Pubkey::default() {
            user_purchase.buyer = ctx.accounts.buyer.key();
            user_purchase.total_purchased = 0;
        }
        user_purchase.total_purchased = user_purchase
            .total_purchased
            .checked_add(tokens_to_receive)
            .ok_or(PresaleError::Overflow)?;

        msg!(
            "Buy with SOL successful: {} tokens for {} lamports",
            tokens_to_receive,
            sol_amount
        );

        Ok(())
    }

    /// Sets the token rate (tokens per SOL)
    ///
    /// Updates the exchange rate for buying tokens with SOL.
    /// Only admin or governance can call this function.
    ///
    /// # Parameters
    /// - `ctx`: SetTokenPriceUsd context (requires authority)
    /// - `token_price_usd_micro`: New token price in micro-USD (e.g., 1000 = $0.001 per token)
    ///
    /// # Returns
    /// - `Result<()>`: Success if price is updated
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not authority
    /// - `PresaleError::InvalidAmount` if token_price_usd_micro is 0
    ///
    /// # Security
    /// - Only authority (admin or governance) can update price
    pub fn set_token_price_usd(
        ctx: Context<SetTokenPriceUsd>,
        token_price_usd_micro: u64,
    ) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        // Verify authority (admin or governance)
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        // Validate token_price_usd_micro is greater than 0
        require!(
            token_price_usd_micro > 0,
            PresaleError::InvalidAmount
        );
        
        let old_price = presale_state.token_price_usd_micro;
        presale_state.token_price_usd_micro = token_price_usd_micro;
        
        msg!(
            "Token price updated from {} to {} micro-USD per token by authority {}",
            old_price,
            token_price_usd_micro,
            ctx.accounts.authority.key()
        );
        
        Ok(())
    }

    // Set treasury address (admin or governance only)
    pub fn set_treasury_address(
        ctx: Context<SetTreasuryAddress>,
        treasury_address: Pubkey,
    ) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        // Validate treasury address is not default
        require!(
            treasury_address != Pubkey::default(),
            PresaleError::InvalidTreasuryAddress
        );
        
        let old_treasury = presale_state.treasury_address;
        presale_state.treasury_address = treasury_address;
        
        msg!(
            "Treasury address updated from {:?} to {:?}",
            old_treasury,
            treasury_address
        );
        Ok(())
    }

    /// Withdraws payment tokens from presale vault to treasury
    ///
    /// Transfers accumulated payment tokens from the presale vault to the configured
    /// treasury address. Can be called by admin or governance.
    ///
    /// # Parameters
    /// - `ctx`: WithdrawToTreasury context with all required accounts
    /// - `amount`: Amount of payment tokens to withdraw (must be > 0)
    ///
    /// # Returns
    /// - `Result<()>`: Success if withdrawal completes
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not admin or governance
    /// - `PresaleError::TreasuryNotSet` if treasury address not configured
    /// - `PresaleError::InvalidAmount` if amount is 0 or exceeds vault balance
    ///
    /// # Events
    /// - Emits `TreasuryWithdrawn` with amount and treasury address
    ///
    /// # Security
    /// - Requires admin or governance authority
    /// - Validates treasury address is set
    /// - Validates amount is positive
    /// - Checks vault has sufficient balance
    pub fn withdraw_to_treasury(
        ctx: Context<WithdrawToTreasury>,
        amount: u64,
    ) -> Result<()> {
        let presale_state = &ctx.accounts.presale_state;
        
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        require!(
            presale_state.treasury_address != Pubkey::default(),
            PresaleError::TreasuryNotSet
        );
        
        // Validate treasury token account (manual validation)
        let treasury_token_data = ctx.accounts.treasury_token_account.try_borrow_data()?;
        require!(treasury_token_data.len() >= 64, PresaleError::InvalidTreasuryAccount);
        let treasury_token_mint = Pubkey::try_from_slice(&treasury_token_data[0..32])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        let treasury_token_owner = Pubkey::try_from_slice(&treasury_token_data[32..64])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        require!(
            treasury_token_mint == ctx.accounts.payment_token_mint.key(),
            PresaleError::InvalidTreasuryAccount
        );
        require!(
            treasury_token_owner == presale_state.treasury_address,
            PresaleError::InvalidTreasuryAccount
        );

        // Validate payment vault (manual validation)
        let payment_vault_data = ctx.accounts.presale_payment_vault.try_borrow_data()?;
        require!(payment_vault_data.len() >= 64, PresaleError::InvalidTreasuryAccount);
        let payment_vault_mint = Pubkey::try_from_slice(&payment_vault_data[0..32])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        let payment_vault_owner = Pubkey::try_from_slice(&payment_vault_data[32..64])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        require!(
            payment_vault_mint == ctx.accounts.payment_token_mint.key(),
            PresaleError::InvalidTreasuryAccount
        );
        require!(
            payment_vault_owner == ctx.accounts.presale_payment_vault_pda.key(),
            PresaleError::InvalidTreasuryAccount
        );
        
        // Validate amount is greater than 0
        require!(
            amount > 0,
            PresaleError::InvalidAmount
        );
        
        // Check withdrawal balance (ensure vault has enough)
        // Token account layout: mint (0-32), owner (32-64), amount (64-72)
        require!(payment_vault_data.len() >= 72, PresaleError::InvalidAmount);
        let vault_balance = u64::from_le_bytes(
            payment_vault_data[64..72].try_into().map_err(|_| PresaleError::InvalidAmount)?
        );
        require!(
            vault_balance >= amount,
            PresaleError::InvalidAmount
        );
        
        
        // Transfer from PDA vault to treasury
        let presale_state_key = presale_state.key();
        let payment_token_mint_key = ctx.accounts.payment_token_mint.key();
        let seeds = &[
            b"presale_payment_vault_pda",
            presale_state_key.as_ref(),
            payment_token_mint_key.as_ref(),
            &[ctx.bumps.presale_payment_vault_pda],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.presale_payment_vault.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            authority: ctx.accounts.presale_payment_vault_pda.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        
        // Emit event
        emit!(TreasuryWithdrawn {
            amount,
            treasury: presale_state.treasury_address,
        });

        msg!(
            "Withdrew {} payment tokens to treasury: {}",
            amount,
            presale_state.treasury_address
        );
        
        Ok(())
    }

    /// Withdraws native SOL from presale SOL vault to treasury
    ///
    /// Transfers accumulated SOL from the presale SOL vault to the configured
    /// treasury address. Can be called by admin or governance.
    ///
    /// # Parameters
    /// - `ctx`: WithdrawSolToTreasury context with all required accounts
    /// - `amount`: Amount of SOL to withdraw in lamports (must be > 0)
    ///
    /// # Returns
    /// - `Result<()>`: Success if withdrawal completes
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not admin or governance
    /// - `PresaleError::TreasuryNotSet` if treasury address not configured
    /// - `PresaleError::InvalidAmount` if amount is 0 or exceeds vault balance
    ///
    /// # Events
    /// - Emits `TreasuryWithdrawn` with amount and treasury address
    ///
    /// # Security
    /// - Requires admin or governance authority
    /// - Validates treasury address is set
    /// - Validates amount is positive
    /// - Checks vault has sufficient balance
    pub fn withdraw_sol_to_treasury(
        ctx: Context<WithdrawSolToTreasury>,
        amount: u64,
    ) -> Result<()> {
        let presale_state = &ctx.accounts.presale_state;
        
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        require!(
            presale_state.treasury_address != Pubkey::default(),
            PresaleError::TreasuryNotSet
        );
        
        // Validate amount is greater than 0
        require!(
            amount > 0,
            PresaleError::InvalidAmount
        );
        
        // Check vault has enough SOL
        require!(
            ctx.accounts.sol_vault.lamports() >= amount,
            PresaleError::InvalidAmount
        );
        
        // Transfer SOL from vault to treasury using system program
        let presale_state_key = presale_state.key();
        let seeds = &[
            b"presale_sol_vault",
            presale_state_key.as_ref(),
            &[ctx.bumps.sol_vault],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.sol_vault.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        anchor_lang::system_program::transfer(cpi_ctx, amount)?;
        
        // Emit event
        emit!(TreasuryWithdrawn {
            amount,
            treasury: presale_state.treasury_address,
        });

        msg!(
            "Withdrew {} lamports to treasury: {}",
            amount,
            presale_state.treasury_address
        );
        
        Ok(())
    }

    /// Withdraws unsold presale tokens from presale vault to destination
    ///
    /// Transfers unsold presale tokens from the presale token vault to the configured
    /// treasury address or a specified destination. Can be called by admin or governance.
    /// Typically called after the presale has ended to recover unsold tokens.
    ///
    /// # Parameters
    /// - `ctx`: WithdrawUnsoldTokens context with all required accounts
    /// - `amount`: Amount of presale tokens to withdraw (must be > 0)
    ///
    /// # Returns
    /// - `Result<()>`: Success if withdrawal completes
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not admin or governance
    /// - `PresaleError::TreasuryNotSet` if treasury address not configured and destination is treasury
    /// - `PresaleError::InvalidAmount` if amount is 0 or exceeds vault balance
    ///
    /// # Events
    /// - Emits `TreasuryWithdrawn` with amount and destination address
    ///
    /// # Security
    /// - Requires admin or governance authority
    /// - Validates destination token account
    /// - Validates amount is positive
    /// - Checks vault has sufficient balance
    pub fn withdraw_unsold_tokens(
        ctx: Context<WithdrawUnsoldTokens>,
        amount: u64,
    ) -> Result<()> {
        let presale_state = &ctx.accounts.presale_state;
        
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        // Validate amount is greater than 0
        require!(
            amount > 0,
            PresaleError::InvalidAmount
        );
        
        // Validate destination token account (manual validation)
        let destination_token_data = ctx.accounts.destination_token_account.try_borrow_data()?;
        require!(destination_token_data.len() >= 64, PresaleError::InvalidTreasuryAccount);
        let destination_token_mint = Pubkey::try_from_slice(&destination_token_data[0..32])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        let destination_token_owner = Pubkey::try_from_slice(&destination_token_data[32..64])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        require!(
            destination_token_mint == presale_state.presale_token_mint,
            PresaleError::InvalidTreasuryAccount
        );
        require!(
            destination_token_owner == ctx.accounts.destination.key(),
            PresaleError::InvalidTreasuryAccount
        );

        // Validate presale token vault (manual validation)
        let presale_token_vault_data = ctx.accounts.presale_token_vault.try_borrow_data()?;
        require!(presale_token_vault_data.len() >= 64, PresaleError::InvalidTreasuryAccount);
        let presale_token_vault_mint = Pubkey::try_from_slice(&presale_token_vault_data[0..32])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        let presale_token_vault_owner = Pubkey::try_from_slice(&presale_token_vault_data[32..64])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        require!(
            presale_token_vault_mint == presale_state.presale_token_mint,
            PresaleError::InvalidTreasuryAccount
        );
        require!(
            presale_token_vault_owner == ctx.accounts.presale_token_vault_pda.key(),
            PresaleError::InvalidTreasuryAccount
        );
        
        // Check withdrawal balance (ensure vault has enough)
        // Token account layout: mint (0-32), owner (32-64), amount (64-72)
        require!(presale_token_vault_data.len() >= 72, PresaleError::InvalidAmount);
        let vault_balance = u64::from_le_bytes(
            presale_token_vault_data[64..72].try_into().map_err(|_| PresaleError::InvalidAmount)?
        );
        require!(
            vault_balance >= amount,
            PresaleError::InvalidAmount
        );
        
        // Transfer from PDA vault to destination
        let presale_token_mint = presale_state.presale_token_mint;
        let seeds = &[
            b"presale_token_vault_pda",
            presale_token_mint.as_ref(),
            &[ctx.bumps.presale_token_vault_pda],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.presale_token_vault.to_account_info(),
            to: ctx.accounts.destination_token_account.to_account_info(),
            authority: ctx.accounts.presale_token_vault_pda.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        
        // Emit event
        emit!(TreasuryWithdrawn {
            amount,
            treasury: ctx.accounts.destination.key(),
        });

        msg!(
            "Withdrew {} unsold presale tokens to destination: {}",
            amount,
            ctx.accounts.destination.key()
        );
        
        Ok(())
    }

    /// Update maximum presale cap
    /// Allows authority (admin or governance) to adjust the total presale cap after initialization
    ///
    /// # Parameters
    /// - `ctx`: UpdatePresaleCap context (requires authority)
    /// - `new_cap`: New maximum presale cap in payment token base units
    ///
    /// # Returns
    /// - `Result<()>`: Success if cap is updated
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not authority
    /// - `PresaleError::InvalidAmount` if new cap < current raised amount
    /// - `PresaleError::InvalidStatus` if presale has stopped
    ///
    /// # Security
    /// - Only authority (admin or governance) can update caps
    /// - Cannot set cap below already raised amount
    /// - Cannot update after presale is stopped (but can update when paused)
    pub fn update_presale_cap(ctx: Context<UpdatePresaleCap>, new_cap: u64) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        // Verify authority (admin or governance)
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        // Validate new cap is reasonable (0 = unlimited is allowed)
        // If setting a limit, it must be greater than already raised
        if new_cap > 0 {
            require!(
                new_cap >= presale_state.total_raised,
                PresaleError::InvalidAmount
            );
        }
        
        // Cannot update if presale is stopped (but paused is okay)
        require!(
            presale_state.status != PresaleStatus::Stopped,
            PresaleError::InvalidStatus
        );
        
        let old_cap = presale_state.max_presale_cap;
        presale_state.max_presale_cap = new_cap;
        
        msg!(
            "Presale cap updated from {} to {} by authority {}",
            old_cap,
            new_cap,
            ctx.accounts.authority.key()
        );
        
        Ok(())
    }

    /// Update maximum contribution per user
    /// Allows authority (admin or governance) to adjust the per-user contribution limit after initialization
    ///
    /// # Parameters
    /// - `ctx`: UpdateMaxPerUser context (requires authority)
    /// - `new_max`: New maximum contribution per user in payment token base units
    ///
    /// # Returns
    /// - `Result<()>`: Success if max is updated
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not authority
    /// - `PresaleError::InvalidAmount` if new max exceeds presale cap (when cap is set)
    /// - `PresaleError::InvalidStatus` if presale has stopped
    ///
    /// # Security
    /// - Only authority (admin or governance) can update limits
    /// - Must be less than or equal to total presale cap (if cap is set)
    /// - Cannot update after presale is stopped (but paused is okay)
    pub fn update_max_per_user(ctx: Context<UpdateMaxPerUser>, new_max: u64) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        // Verify authority (admin or governance)
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        // Validate new max is reasonable (0 = unlimited is allowed)
        // If both max_per_user and max_presale_cap are set, max_per_user must be <= max_presale_cap
        if new_max > 0 && presale_state.max_presale_cap > 0 {
            require!(
                new_max <= presale_state.max_presale_cap,
                PresaleError::InvalidAmount
            );
        }
        
        // Cannot update if presale is stopped (but paused is okay)
        require!(
            presale_state.status != PresaleStatus::Stopped,
            PresaleError::InvalidStatus
        );
        
        let old_max = presale_state.max_per_user;
        presale_state.max_per_user = new_max;
        
        msg!(
            "Max per user updated from {} to {} by authority {}",
            old_max,
            new_max,
            ctx.accounts.authority.key()
        );
        
        Ok(())
    }

    /// Update both presale cap and max per user atomically
    /// Allows authority (admin or governance) to adjust both limits in a single transaction
    ///
    /// # Parameters
    /// - `ctx`: UpdatePresaleLimits context (requires authority)
    /// - `new_presale_cap`: New maximum presale cap (optional, None = no change)
    /// - `new_max_per_user`: New maximum per user (optional, None = no change)
    ///
    /// # Returns
    /// - `Result<()>`: Success if limits are updated
    ///
    /// # Errors
    /// - `PresaleError::Unauthorized` if caller is not authority
    /// - `PresaleError::InvalidAmount` if validation fails
    /// - `PresaleError::InvalidStatus` if presale has stopped
    ///
    /// # Security
    /// - Atomic update ensures consistency
    /// - All validations applied
    /// - Cannot update after presale is stopped
    pub fn update_presale_limits(
        ctx: Context<UpdatePresaleLimits>,
        new_presale_cap: Option<u64>,
        new_max_per_user: Option<u64>,
    ) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        // Verify authority (admin or governance)
        require!(
            presale_state.authority == ctx.accounts.authority.key() 
                || (presale_state.governance_set && presale_state.governance == ctx.accounts.authority.key()),
            PresaleError::Unauthorized
        );
        
        // Cannot update if presale is stopped (but paused is okay)
        require!(
            presale_state.status != PresaleStatus::Stopped,
            PresaleError::InvalidStatus
        );
        
        // Track the effective cap for validation
        let mut effective_cap = presale_state.max_presale_cap;
        
        // Update presale cap if provided
        if let Some(new_cap) = new_presale_cap {
            // If setting a limit (not 0), it must be >= already raised
            if new_cap > 0 {
                require!(
                    new_cap >= presale_state.total_raised,
                    PresaleError::InvalidAmount
                );
            }
            
            let old_cap = presale_state.max_presale_cap;
            presale_state.max_presale_cap = new_cap;
            effective_cap = new_cap;
            
            msg!("Presale cap updated from {} to {}", old_cap, new_cap);
        }
        
        // Update max per user if provided
        if let Some(new_max) = new_max_per_user {
            // If both limits are set (not 0), max_per_user must be <= cap
            if new_max > 0 && effective_cap > 0 {
                require!(
                    new_max <= effective_cap,
                    PresaleError::InvalidAmount
                );
            }
            
            let old_max = presale_state.max_per_user;
            presale_state.max_per_user = new_max;
            
            msg!("Max per user updated from {} to {}", old_max, new_max);
        }
        
        msg!(
            "Presale limits updated by authority {}",
            ctx.accounts.authority.key()
        );
        
        Ok(())
    }
}

// Account Structures

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + PresaleState::LEN,
        seeds = [b"presale_state"],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigratePresaleState<'info> {
    #[account(mut)]
    /// CHECK: PDA and authority are verified manually in the function to handle old structure
    /// Reallocation is handled manually in the function
    pub presale_state: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

// SetGovernance - Transfer authority to governance PDA
#[derive(Accounts)]
pub struct SetGovernance<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump = presale_state.bump
    )]
    pub presale_state: Account<'info, PresaleState>,

    pub authority: Signer<'info>,
}

// SetTokenProgram - Set token program references
#[derive(Accounts)]
pub struct SetTokenProgram<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump,
        constraint = presale_state.authority == admin.key() 
            || (presale_state.governance_set && presale_state.governance == admin.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(payment_token_mint: Pubkey)]
pub struct AllowPaymentToken<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump,
        constraint = presale_state.authority == admin.key() 
            || (presale_state.governance_set && presale_state.governance == admin.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + AllowedToken::LEN,
        seeds = [
            b"allowed_token",
            presale_state.key().as_ref(),
            payment_token_mint.as_ref()
        ],
        bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    /// CHECK: Payment token mint account (for validation)
    pub payment_token_mint_account: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DisallowPaymentToken<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump,
        constraint = presale_state.authority == admin.key() 
            || (presale_state.governance_set && presale_state.governance == admin.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    #[account(
        mut,
        seeds = [
            b"allowed_token",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    
    pub admin: Signer<'info>,
    
    /// CHECK: Payment token mint account (for validation)
    pub payment_token_mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    // Token program state to check emergency pause
    /// CHECK: Token program state PDA (validated by constraint)
    #[account(
        constraint = token_state.key() == presale_state.token_program_state @ PresaleError::InvalidTokenProgramState
    )]
    pub token_state: UncheckedAccount<'info>,
    
    #[account(
        seeds = [
            b"allowed_token",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub allowed_token: Account<'info, AllowedToken>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    /// CHECK: Buyer's payment token account (validated manually)
    #[account(mut)]
    pub buyer_payment_token_account: UncheckedAccount<'info>,

    // PDA that will own the payment token vault ATA
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [
            b"presale_payment_vault_pda",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub presale_payment_vault_pda: UncheckedAccount<'info>,

    // ATA owned by the payment vault PDA
    /// CHECK: Validated manually
    #[account(mut)]
    pub presale_payment_vault: UncheckedAccount<'info>,

    // PDA that will own the presale token vault ATA
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [
            b"presale_token_vault_pda",
            presale_state.presale_token_mint.as_ref()
        ],
        bump
    )]
    pub presale_token_vault_pda: UncheckedAccount<'info>,

    // ATA owned by the presale token vault PDA
    /// CHECK: Validated manually
    #[account(mut)]
    pub presale_token_vault: UncheckedAccount<'info>,

    /// CHECK: Buyer's token account (validated manually)
    #[account(mut)]
    pub buyer_token_account: UncheckedAccount<'info>,
    
    /// CHECK: Payment token mint account (for validation)
    pub payment_token_mint: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + UserPurchase::LEN,
        seeds = [b"user_purchase", presale_state.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub user_purchase: Account<'info, UserPurchase>,

    /// CHECK: Optional blacklist account for buyer (validated in function)
    pub buyer_blacklist: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTreasuryAddress<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawToTreasury<'info> {
    #[account(
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
    
    // PDA that owns the payment token vault ATA
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [
            b"presale_payment_vault_pda",
            presale_state.key().as_ref(),
            payment_token_mint.key().as_ref()
        ],
        bump
    )]
    pub presale_payment_vault_pda: UncheckedAccount<'info>,
    
    // ATA owned by the payment vault PDA (source)
    /// CHECK: Validated manually
    #[account(mut)]
    pub presale_payment_vault: UncheckedAccount<'info>,

    // Treasury token account (destination)
    /// CHECK: Validated manually
    #[account(mut)]
    pub treasury_token_account: UncheckedAccount<'info>,
    
    /// CHECK: Payment token mint account (for validation)
    pub payment_token_mint: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct BuyWithSol<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    // Token program state to check emergency pause
    /// CHECK: Token program state PDA (validated by constraint)
    #[account(
        constraint = token_state.key() == presale_state.token_program_state @ PresaleError::InvalidTokenProgramState
    )]
    pub token_state: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    // PDA that owns the SOL vault
    /// CHECK: This is a PDA that will receive SOL (created automatically on first transfer)
    #[account(
        mut,
        seeds = [
            b"presale_sol_vault",
            presale_state.key().as_ref()
        ],
        bump
    )]
    pub sol_vault: UncheckedAccount<'info>,

    // PDA that will own the presale token vault ATA
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [
            b"presale_token_vault_pda",
            presale_state.presale_token_mint.as_ref()
        ],
        bump
    )]
    pub presale_token_vault_pda: UncheckedAccount<'info>,

    // ATA owned by the presale token vault PDA
    /// CHECK: Validated manually
    #[account(mut)]
    pub presale_token_vault: UncheckedAccount<'info>,

    /// CHECK: Buyer's token account (validated manually)
    #[account(mut)]
    pub buyer_token_account: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + UserPurchase::LEN,
        seeds = [b"user_purchase", presale_state.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub user_purchase: Account<'info, UserPurchase>,

    /// CHECK: Optional blacklist account for buyer (validated in function)
    pub buyer_blacklist: UncheckedAccount<'info>,
    
    /// CHECK: Chainlink SOL/USD price feed account
    /// Must be the official Chainlink feed (validated in buy_with_sol)
    pub chainlink_feed: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawSolToTreasury<'info> {
    #[account(
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
    
    // PDA that owns the SOL vault
    /// CHECK: This is a PDA used for signing
    #[account(
        mut,
        seeds = [
            b"presale_sol_vault",
            presale_state.key().as_ref()
        ],
        bump
    )]
    pub sol_vault: SystemAccount<'info>,
    
    /// CHECK: Treasury wallet (validated by constraint)
    #[account(
        mut,
        constraint = treasury.key() == presale_state.treasury_address @ PresaleError::InvalidTreasuryAddress
    )]
    pub treasury: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawUnsoldTokens<'info> {
    #[account(
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
    
    // PDA that owns the presale token vault ATA
    /// CHECK: This is a PDA used for signing
    #[account(
        seeds = [
            b"presale_token_vault_pda",
            presale_state.presale_token_mint.as_ref()
        ],
        bump
    )]
    pub presale_token_vault_pda: UncheckedAccount<'info>,
    
    // ATA owned by the presale token vault PDA (source)
    /// CHECK: Validated manually
    #[account(mut)]
    pub presale_token_vault: UncheckedAccount<'info>,

    // Destination token account (where unsold tokens will be sent)
    /// CHECK: Validated manually
    #[account(mut)]
    pub destination_token_account: UncheckedAccount<'info>,
    
    /// CHECK: Destination wallet (owner of destination_token_account, validated manually)
    pub destination: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}



#[derive(Accounts)]
pub struct UpdatePresaleCap<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateMaxPerUser<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePresaleLimits<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetTokenPriceUsd<'info> {
    #[account(
        mut,
        seeds = [b"presale_state"],
        bump = presale_state.bump,
        constraint = presale_state.authority == authority.key() 
            || (presale_state.governance_set && presale_state.governance == authority.key())
            @ PresaleError::Unauthorized
    )]
    pub presale_state: Account<'info, PresaleState>,
    
    pub authority: Signer<'info>,
}

// State Structures



#[account]
pub struct PresaleState {
    pub admin: Pubkey, // Original admin (kept for reference)
    pub authority: Pubkey, // Current authority (admin or governance PDA)
    pub governance: Pubkey, // Governance PDA (set after set_governance)
    pub token_program: Pubkey, // Token program address
    pub token_program_state: Pubkey, // Token program state PDA
    pub presale_token_mint: Pubkey,
    pub status: PresaleStatus,
    pub total_tokens_sold: u64,
    pub total_raised: u64,
    pub governance_set: bool, // Track if governance has been set
    pub treasury_address: Pubkey, // Treasury wallet address (settable via set_treasury_address)
    pub max_presale_cap: u64, // Maximum presale cap (0 = unlimited)
    pub max_per_user: u64, // Maximum per user purchase (0 = unlimited)
    pub token_price_usd_micro: u64, // Token price in micro-USD (e.g., 1000 = $0.001 per token)
    pub bump: u8, // PDA bump
}

impl PresaleState {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 32 + 1 + 8 + 8 + 1 + 32 + 8 + 8 + 8 + 1; 
    // admin + authority + governance + token_program + token_program_state + mint + status + sold + raised + governance_set + treasury_address + max_presale_cap + max_per_user + token_price_usd_micro + bump
}

#[account]
pub struct AllowedToken {
    pub presale_state: Pubkey,
    pub payment_token_mint: Pubkey,
    pub is_allowed: bool,
}

impl AllowedToken {
    pub const LEN: usize = 32 + 32 + 1; // presale_state + mint + is_allowed
}

#[account]
pub struct UserPurchase {
    pub buyer: Pubkey,
    pub total_purchased: u64,
}

impl UserPurchase {
    pub const LEN: usize = 32 + 8; // buyer + total_purchased
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PresaleStatus {
    NotStarted,
    Active,
    Paused,
    Stopped,
}

// Error Codes

#[error_code]
pub enum PresaleError {
    #[msg("Unauthorized: Only admin or governance can perform this action")]
    Unauthorized,
    #[msg("Presale is not active")]
    PresaleNotActive,
    #[msg("Payment token is not allowed")]
    PaymentTokenNotAllowed,
    #[msg("Invalid presale status for this operation")]
    InvalidStatus,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Token program emergency pause is active")]
    TokenEmergencyPaused,
    #[msg("Invalid token program state")]
    InvalidTokenProgramState,
    #[msg("Treasury address has not been set")]
    TreasuryNotSet,
    #[msg("Invalid treasury token account")]
    InvalidTreasuryAccount,
    #[msg("Invalid treasury address")]
    InvalidTreasuryAddress,
    #[msg("Presale cap exceeded")]
    PresaleCapExceeded,
    #[msg("Per user limit exceeded")]
    PerUserLimitExceeded,
    #[msg("Invalid account")]
    InvalidAccount,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Buyer is blacklisted")]
    BuyerBlacklisted,
    #[msg("Invalid price from Chainlink oracle")]
    InvalidPrice,
    #[msg("Chainlink price feed is stale (too old)")]
    StalePrice,
}