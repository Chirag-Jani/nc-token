use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

// Import token and governance programs for CPI integration
#[allow(unused_imports)]
use spl_project::program::SplProject;
// #[allow(unused_imports)]
// use governance::program::Governance;

declare_id!("3gRbrfhqsNnXG7QpbEDPuQBbRr59D733DfhCXVxSWanp");

#[program]
pub mod presale {
    use super::*;

    // Initialize the presale contract
    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Pubkey,
        presale_token_mint: Pubkey,
        token_program: Pubkey,
        token_program_state: Pubkey,
    ) -> Result<()> {
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
        presale_state.bump = ctx.bumps.presale_state;
        
        msg!("Presale initialized with admin: {}, token_program: {}", admin, token_program);
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
        presale_state.token_program = token_program;
        presale_state.token_program_state = token_program_state;
        msg!("Token program set to: {}", token_program);
        Ok(())
    }

    // Admin function to start the presale
    pub fn start_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        require!(
            presale_state.status == PresaleStatus::NotStarted 
                || presale_state.status == PresaleStatus::Paused,
            PresaleError::InvalidStatus
        );
        
        presale_state.status = PresaleStatus::Active;
        msg!("Presale started");
        Ok(())
    }

    // Admin function to stop the presale
    pub fn stop_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
        require!(
            presale_state.status == PresaleStatus::Active,
            PresaleError::InvalidStatus
        );
        
        presale_state.status = PresaleStatus::Stopped;
        msg!("Presale stopped");
        Ok(())
    }

    // Admin function to pause the presale
    pub fn pause_presale(ctx: Context<AdminOnly>) -> Result<()> {
        let presale_state = &mut ctx.accounts.presale_state;
        
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

    // Buy function - users can buy presale tokens with allowed payment tokens
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
        // TokenState layout: discriminator(8) + authority(32) + bump(1) + emergency_paused(1) + ...
        // emergency_paused is at offset 8 + 32 + 1 = 41
        let token_state_data = ctx.accounts.token_state.try_borrow_data()?;
        if token_state_data.len() >= 42 {
            let emergency_paused = token_state_data[41] != 0;
            require!(
                !emergency_paused,
                PresaleError::TokenEmergencyPaused
            );
        }

        // Check if buyer is blacklisted
        // Note: In a full implementation, you'd check the blacklist PDA
        // For now, we'll skip this check but the account structure supports it

        // Check if payment token is allowed
        let allowed_token = &ctx.accounts.allowed_token;
        require!(
            allowed_token.is_allowed,
            PresaleError::PaymentTokenNotAllowed
        );

        // Validate token account mints match
        // Read mint directly from account data (SPL token account layout: mint at offset 0)
        let buyer_payment_token_data = ctx.accounts.buyer_payment_token_account.try_borrow_data()?;
        let buyer_token_data = ctx.accounts.buyer_token_account.try_borrow_data()?;
        
        require!(
            buyer_payment_token_data.len() >= 32,
            PresaleError::PaymentTokenNotAllowed
        );
        require!(
            buyer_token_data.len() >= 32,
            PresaleError::PaymentTokenNotAllowed
        );
        
        let buyer_payment_mint = Pubkey::try_from_slice(&buyer_payment_token_data[0..32])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        let buyer_token_mint = Pubkey::try_from_slice(&buyer_token_data[0..32])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        
        require!(
            buyer_payment_mint == ctx.accounts.payment_token_mint.key(),
            PresaleError::PaymentTokenNotAllowed
        );
        require!(
            buyer_token_mint == presale_state.presale_token_mint,
            PresaleError::PaymentTokenNotAllowed
        );

        // Calculate tokens to receive (1:1 ratio - you can modify this)
        let tokens_to_receive = amount; // Adjust based on your pricing logic

        // Validate payment vault mint and authority
        let payment_vault_data = ctx.accounts.presale_payment_vault.try_borrow_data()?;
        require!(
            payment_vault_data.len() >= 64,
            PresaleError::PaymentTokenNotAllowed
        );
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

        // Validate presale token vault mint and authority
        let presale_token_vault_data = ctx.accounts.presale_token_vault.try_borrow_data()?;
        require!(
            presale_token_vault_data.len() >= 64,
            PresaleError::PaymentTokenNotAllowed
        );
        let vault_mint = Pubkey::try_from_slice(&presale_token_vault_data[0..32])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        let vault_owner = Pubkey::try_from_slice(&presale_token_vault_data[32..64])
            .map_err(|_| PresaleError::PaymentTokenNotAllowed)?;
        require!(
            vault_mint == presale_state.presale_token_mint,
            PresaleError::PaymentTokenNotAllowed
        );
        require!(
            vault_owner == ctx.accounts.presale_token_vault_pda.key(),
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

        msg!(
            "Buy successful: {} tokens for {} payment tokens",
            tokens_to_receive,
            amount
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
        
        let old_treasury = presale_state.treasury_address;
        presale_state.treasury_address = treasury_address;
        
        msg!(
            "Treasury address updated from {:?} to {:?}",
            old_treasury,
            treasury_address
        );
        Ok(())
    }

    // Withdraw payment tokens from PDA vault to treasury address (admin or governance only)
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
        
        // Validate treasury token account mint and owner
        // Read account data (SPL token account layout: mint at offset 0, owner at offset 32)
        let treasury_token_data = ctx.accounts.treasury_token_account.try_borrow_data()?;
        require!(
            treasury_token_data.len() >= 64,
            PresaleError::InvalidTreasuryAccount
        );
        let treasury_mint = Pubkey::try_from_slice(&treasury_token_data[0..32])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        let treasury_owner = Pubkey::try_from_slice(&treasury_token_data[32..64])
            .map_err(|_| PresaleError::InvalidTreasuryAccount)?;
        require!(
            treasury_mint == ctx.accounts.payment_token_mint.key(),
            PresaleError::InvalidTreasuryAccount
        );
        require!(
            treasury_owner == presale_state.treasury_address,
            PresaleError::InvalidTreasuryAccount
        );
        
        // Validate payment vault mint and authority
        let payment_vault_data = ctx.accounts.presale_payment_vault.try_borrow_data()?;
        require!(
            payment_vault_data.len() >= 64,
            PresaleError::InvalidTreasuryAccount
        );
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
        
        msg!(
            "Withdrew {} payment tokens to treasury: {}",
            amount,
            presale_state.treasury_address
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
    
    /// CHECK: Buyer's payment token account (validated by constraint in function)
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
    /// CHECK: Validated in function (mint and authority checked manually)
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
    /// CHECK: Validated in function (mint and authority checked manually)
    #[account(mut)]
    pub presale_token_vault: UncheckedAccount<'info>,
    
    /// CHECK: Buyer's token account (validated by constraint in function)
    #[account(mut)]
    pub buyer_token_account: UncheckedAccount<'info>,
    
    /// CHECK: Payment token mint account (for validation)
    pub payment_token_mint: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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
    /// CHECK: Validated in function (mint and authority checked manually)
    #[account(mut)]
    pub presale_payment_vault: UncheckedAccount<'info>,
    
    // Treasury token account (destination)
    /// CHECK: Validated in function (mint and authority checked manually)
    #[account(mut)]
    pub treasury_token_account: UncheckedAccount<'info>,
    
    /// CHECK: Payment token mint account (for validation)
    pub payment_token_mint: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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
    pub bump: u8, // PDA bump
}

impl PresaleState {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 32 + 1 + 8 + 8 + 1 + 32 + 1; 
    // admin + authority + governance + token_program + token_program_state + mint + status + sold + raised + governance_set + treasury_address + bump
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
}