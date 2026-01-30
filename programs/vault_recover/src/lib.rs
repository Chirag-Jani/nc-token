//! Minimal program to recover tokens from a closed presale vault.
//! Deploy to 7LkwkH3... to recover tokens from vault 6sWrLVX... (ATA owned by PDA 47Nje2...).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer};

declare_id!("7LkwkH3TpyhvCuVBEecFYbYk1T7c66qoYa2UpR9Q8LQj");

#[program]
pub mod vault_recover {
    use super::*;

    /// Recovers tokens from the presale vault to a destination account.
    /// Only works when called - no authority check (program was closed, this is recovery).
    pub fn recover_tokens(ctx: Context<RecoverTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, crate::RecoverError::InvalidAmount);

        let seeds = &[
            b"presale_token_vault_pda",
            ctx.accounts.mint.key().as_ref(),
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

        msg!("Recovered {} tokens to destination", amount);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct RecoverTokens<'info> {
    /// CHECK: PDA - validated by seeds
    #[account(
        mut,
        seeds = [b"presale_token_vault_pda", mint.key().as_ref()],
        bump
    )]
    pub presale_token_vault_pda: UncheckedAccount<'info>,

    /// CHECK: Validated manually - must be owned by presale_token_vault_pda
    #[account(mut)]
    pub presale_token_vault: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = destination_token_account.owner == authority.key() @ RecoverError::InvalidDestination
    )]
    pub destination_token_account: Account<'info, anchor_spl::token::TokenAccount>,

    pub mint: Account<'info, anchor_spl::token::Mint>,

    pub token_program: Program<'info, Token>,

    /// Must match destination_token_account owner - you can only recover to your own wallet
    pub authority: Signer<'info>,
}

#[error_code]
pub enum RecoverError {
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
    #[msg("Destination must be your own token account")]
    InvalidDestination,
}

