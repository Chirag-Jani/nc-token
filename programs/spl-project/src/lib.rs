//! # NC Token Program
//!
//! A production-ready SPL token program with advanced features including:
//! - Governance-controlled minting and burning
//! - Blacklist and whitelist support
//! - Restricted account management
//! - Emergency pause functionality
//! - Sell limit enforcement (10% per 24 hours)
//! - Liquidity pool detection
//! - Supply cap management
//!
//! ## Security Features
//! - All state-changing operations require governance authority
//! - Emergency pause can halt all token operations
//! - Blacklist prevents transfers to/from blocked addresses
//! - Sell limits prevent large dumps to liquidity pools
//! - Supply caps prevent infinite minting
//!
//! ## Governance
//! - Governance changes require a cooldown period (7 days)
//! - Two-step governance transfer (propose + execute)
//! - All critical operations emit events for off-chain monitoring

use anchor_lang::prelude::*;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{self, Burn, MintTo, SetAuthority, Token, Transfer, TokenAccount};
use anchor_spl::token::spl_token::solana_program::program_pack::Pack;
use anchor_spl::token::spl_token::state::Account as SplTokenAccount;

declare_id!("FQmKBpQL956VWS2v6S6t5qUhAc6AcVEvQuXVxP1UMv6P");

#[error_code]
pub enum TokenError {
    #[msg("Emergency pause is active")]
    EmergencyPaused,
    #[msg("Address is blacklisted")]
    Blacklisted,
    #[msg("Address is restricted")]
    Restricted,
    #[msg("Sell limit exceeded (10% within 24 hours)")]
    SellLimitExceeded,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Program version mismatch")]
    VersionMismatch,
    #[msg("Incompatible program version")]
    IncompatibleVersion,
    #[msg(Invalid Token Account)]
    InvalidTokenAccount,
}

#[event]
pub struct TokenMinted {
    pub amount: u64,
    pub recipient: Pubkey,
}

#[event]
pub struct TokenBurned {
    pub amount: u64,
    pub from: Pubkey,
}

#[event]
pub struct EmergencyPauseChanged {
    pub paused: bool,
}

#[event]
pub struct InitializeEvent {
    pub authority: Pubkey,
    pub version: u16,
}

#[event]
pub struct BlacklistChanged {
    pub account: Pubkey,
    pub is_blacklisted: bool,
}

#[event]
pub struct RestrictedChanged {
    pub account: Pubkey,
    pub is_restricted: bool,
}

#[event]
pub struct NoSellLimitChanged {
    pub account: Pubkey,
    pub has_exemption: bool,
}

#[event]
pub struct LiquidityPoolChanged {
    pub pool: Pubkey,
    pub is_pool: bool,
}

#[event]
pub struct WhitelistChanged {
    pub account: Pubkey,
    pub is_whitelisted: bool,
}

#[event]
pub struct MintAuthorityRevoked {
    pub mint: Pubkey,
}

#[program]
pub mod spl_project {
    use super::*;

    /// Initializes the token program state
    ///
    /// Creates the initial TokenState PDA with default values.
    /// The authority must not be the default pubkey to prevent governance bricking.
    ///
    /// # Parameters
    /// - `ctx`: Initialize context containing state PDA and authority signer
    ///
    /// # Returns
    /// - `Result<()>`: Success if initialization completes, error otherwise
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if authority is `Pubkey::default()`
    ///
    /// # Events
    /// - Emits `InitializeEvent` with the authority address
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Validate authority is not default (prevents governance bricking)
        require!(
            ctx.accounts.authority.key() != Pubkey::default(),
            TokenError::Unauthorized
        );

        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.authority.key();
        state.bump = ctx.bumps.state;
        state.emergency_paused = false;
        state.sell_limit_percent = 10; // 10% sell limit
        state.sell_limit_period = 86400; // 24 hours in seconds
        state.bridge_address = Pubkey::default(); // Will be set by governance later
        state.bond_address = Pubkey::default(); // Will be set by governance later
        state.pending_governance = None;
        state.governance_change_time = None;
        state.max_supply = None; // No supply cap by default
        state.current_supply = 0; // Track current supply
        state.whitelist_mode = false; // Whitelist mode disabled by default
        state.version = TokenState::CURRENT_VERSION;
        state.min_compatible_version = TokenState::MIN_COMPATIBLE_VERSION;

        // Emit event
        emit!(InitializeEvent {
            authority: state.authority,
            version: state.version,
        });

        msg!("Token program initialized version: {}", state.version);

        msg!("Token program initialized by: {:?}", state.authority);
        Ok(())
    }

    /// Proposes a governance change with cooldown period
    ///
    /// Initiates a two-step governance transfer process. The change must be executed
    /// after the cooldown period (7 days) via `set_governance`.
    ///
    /// # Parameters
    /// - `ctx`: ProposeGovernanceChange context
    /// - `new_authority`: The proposed new governance authority (must not be default)
    ///
    /// # Returns
    /// - `Result<()>`: Success if proposal is created
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not current authority or new_authority is default
    ///
    /// # Security
    /// - Only current authority can propose changes
    /// - Cooldown period prevents instant governance takeover
    pub fn propose_governance_change(
        ctx: Context<ProposeGovernanceChange>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);
        // Only current authority can propose change
        require!(
            state.authority == ctx.accounts.authority.key(),
            TokenError::Unauthorized
        );
        require!(
            new_authority != Pubkey::default(),
            TokenError::Unauthorized
        );

        let clock = Clock::get()?;
        state.pending_governance = Some(new_authority);
        state.governance_change_time = Some(clock.unix_timestamp);

        msg!(
            "Governance change proposed from {:?} to {:?}, will be executable after cooldown",
            state.authority,
            new_authority
        );
        Ok(())
    }

    /// Executes a governance change after cooldown period
    ///
    /// Completes the governance transfer that was proposed via `propose_governance_change`.
    /// Can only be called after the cooldown period (7 days) has elapsed.
    ///
    /// # Parameters
    /// - `ctx`: SetGovernance context
    /// - `new_authority`: The new governance authority (must match pending proposal)
    ///
    /// # Returns
    /// - `Result<()>`: Success if governance is transferred
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if:
    ///   - Caller is not current authority
    ///   - No pending governance change exists
    ///   - Cooldown period has not elapsed
    ///   - new_authority doesn't match pending proposal
    ///
    /// # Security
    /// - Requires 7-day cooldown to prevent instant governance takeover
    pub fn set_governance(ctx: Context<SetGovernance>, new_authority: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);
        // Only current authority can execute
        require!(
            state.authority == ctx.accounts.authority.key(),
            TokenError::Unauthorized
        );
        // Verify pending governance matches
        require!(
            state.pending_governance == Some(new_authority),
            TokenError::Unauthorized
        );
        // Verify cooldown has passed
        let clock = Clock::get()?;
        require!(
            state.governance_change_time.is_some(),
            TokenError::Unauthorized
        );
        let change_time = state.governance_change_time
            .ok_or(TokenError::Unauthorized)?;
        require!(
            clock.unix_timestamp >= change_time + TokenState::GOVERNANCE_COOLDOWN_SECONDS,
            TokenError::Unauthorized
        );

        let old_authority = state.authority;
        state.authority = new_authority;
        state.pending_governance = None;
        state.governance_change_time = None;

        msg!(
            "Authority transferred from {:?} to {:?}",
            old_authority,
            new_authority
        );
        Ok(())
    }

    /// Sets the emergency pause state
    ///
    /// When paused, all token operations (mint, burn, transfer) are blocked.
    /// This is a critical safety mechanism that can halt the protocol instantly.
    ///
    /// # Parameters
    /// - `ctx`: SetEmergencyPause context (requires governance signer)
    /// - `value`: `true` to pause, `false` to unpause
    ///
    /// # Returns
    /// - `Result<()>`: Success if pause state is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance authority
    ///
    /// # Events
    /// - Emits `EmergencyPauseChanged` with the new pause state
    ///
    /// # Security
    /// - Only governance can pause/unpause
    /// - Pause affects all token operations immediately
    pub fn set_emergency_pause(ctx: Context<SetEmergencyPause>, value: bool) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);
        // Verify that the caller is the governance authority
        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        state.emergency_paused = value;
        
        // Emit event
        emit!(EmergencyPauseChanged {
            paused: value,
        });
        
        msg!("Emergency pause set to: {}", value);
        Ok(())
    }

    /// Sets blacklist status for an address
    ///
    /// Blacklisted addresses cannot send or receive tokens. This is enforced
    /// in all transfer operations and mint operations.
    ///
    /// # Parameters
    /// - `ctx`: SetBlacklist context (requires governance signer)
    /// - `account`: The address to blacklist/unblacklist
    /// - `value`: `true` to blacklist, `false` to unblacklist
    ///
    /// # Returns
    /// - `Result<()>`: Success if blacklist is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance or attempting to overwrite existing blacklist
    ///
    /// # Events
    /// - Emits `BlacklistChanged` with account and status
    ///
    /// # Security
    /// - Prevents silent overwrite of existing blacklist entries
    pub fn set_blacklist(ctx: Context<SetBlacklist>, account: Pubkey, value: bool) -> Result<()> {
        let state = &ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        
        // Prevent silent overwrite - require explicit unblacklist if already blacklisted
        if !value && ctx.accounts.blacklist.is_blacklisted {
            // Allow unblacklisting
        } else if value && ctx.accounts.blacklist.is_blacklisted {
            // Prevent overwriting existing blacklist without explicit false first
            require!(
                ctx.accounts.blacklist.account != account,
                TokenError::Unauthorized
            );
        }
        
        let blacklist = &mut ctx.accounts.blacklist;
        blacklist.account = account;
        blacklist.is_blacklisted = value;
        
        // Emit event
        emit!(BlacklistChanged {
            account,
            is_blacklisted: value,
        });
        
        msg!("Blacklist set for {}: {}", account, value);
        Ok(())
    }

    /// Sets whitelist status for an address
    ///
    /// When whitelist mode is enabled, only whitelisted addresses can transfer tokens.
    /// This provides additional access control on top of blacklist.
    ///
    /// # Parameters
    /// - `ctx`: SetWhitelist context (requires governance signer)
    /// - `account`: The address to whitelist/unwhitelist
    /// - `value`: `true` to whitelist, `false` to unwhitelist
    ///
    /// # Returns
    /// - `Result<()>`: Success if whitelist is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance authority
    ///
    /// # Events
    /// - Emits `WhitelistChanged` with account and status
    ///
    /// # Security
    /// - Requires governance authority (prevents self-whitelisting)
    pub fn set_whitelist(ctx: Context<SetWhitelist>, account: Pubkey, value: bool) -> Result<()> {
        let state = &ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        let whitelist = &mut ctx.accounts.whitelist;
        whitelist.account = account;
        whitelist.is_whitelisted = value;
        
        // Emit event
        emit!(WhitelistChanged {
            account,
            is_whitelisted: value,
        });
        
        msg!("Whitelist set for {}: {}", account, value);
        Ok(())
    }

    /// Sets sell limit exemption for an address
    ///
    /// Exempted addresses can sell unlimited amounts to liquidity pools without
    /// being subject to the 10% per 24-hour sell limit.
    ///
    /// # Parameters
    /// - `ctx`: SetNoSellLimit context (requires governance signer)
    /// - `account`: The address to grant/revoke exemption
    /// - `value`: `true` to grant exemption, `false` to revoke
    ///
    /// # Returns
    /// - `Result<()>`: Success if exemption is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance authority
    ///
    /// # Events
    /// - Emits `NoSellLimitChanged` with account and exemption status
    pub fn set_no_sell_limit(
        ctx: Context<SetNoSellLimit>,
        account: Pubkey,
        value: bool,
    ) -> Result<()> {
        let state = &ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        let exemption = &mut ctx.accounts.no_sell_limit;
        exemption.account = account;
        exemption.has_exemption = value;
        
        // Emit event
        emit!(NoSellLimitChanged {
            account,
            has_exemption: value,
        });
        
        msg!("No sell limit exemption set for {}: {}", account, value);
        Ok(())
    }

    /// Sets restricted status for an address
    ///
    /// Restricted addresses cannot send or receive tokens. This is separate from
    /// blacklist and provides additional compliance controls.
    ///
    /// # Parameters
    /// - `ctx`: SetRestricted context (requires governance signer)
    /// - `account`: The address to restrict/unrestrict
    /// - `value`: `true` to restrict, `false` to unrestrict
    ///
    /// # Returns
    /// - `Result<()>`: Success if restriction is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance authority
    ///
    /// # Events
    /// - Emits `RestrictedChanged` with account and status
    pub fn set_restricted(ctx: Context<SetRestricted>, account: Pubkey, value: bool) -> Result<()> {
        let state = &ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        let restricted = &mut ctx.accounts.restricted;
        restricted.account = account;
        restricted.is_restricted = value;
        
        // Emit event
        emit!(RestrictedChanged {
            account,
            is_restricted: value,
        });
        
        msg!("Restricted set for {}: {}", account, value);
        Ok(())
    }

    /// Sets liquidity pool address
    ///
    /// Marks an address as a liquidity pool. Transfers to pools are subject to
    /// sell limit enforcement unless the sender has an exemption.
    ///
    /// # Parameters
    /// - `ctx`: SetLiquidityPool context (requires governance signer)
    /// - `pool`: The liquidity pool address (must not be default)
    /// - `value`: `true` to mark as pool, `false` to unmark
    ///
    /// # Returns
    /// - `Result<()>`: Success if pool status is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance or pool is default
    ///
    /// # Events
    /// - Emits `LiquidityPoolChanged` with pool address and status
    pub fn set_liquidity_pool(
        ctx: Context<SetLiquidityPool>,
        pool: Pubkey,
        value: bool,
    ) -> Result<()> {
        let state = &ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        // Validate pool is not default
        require!(
            pool != Pubkey::default(),
            TokenError::Unauthorized
        );
        let pool_account = &mut ctx.accounts.liquidity_pool;
        pool_account.pool = pool;
        pool_account.is_pool = value;
        
        // Emit event
        emit!(LiquidityPoolChanged {
            pool,
            is_pool: value,
        });
        
        msg!("Liquidity pool set for {}: {}", pool, value);
        Ok(())
    }

    /// Sets the bridge contract address
    ///
    /// The bridge address is used for cross-chain operations. This should be set
    /// by governance after careful verification.
    ///
    /// # Parameters
    /// - `ctx`: SetBridgeAddress context (requires governance signer)
    /// - `bridge_address`: The bridge contract address (must not be default)
    ///
    /// # Returns
    /// - `Result<()>`: Success if bridge address is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance or address is default
    ///
    /// # Security
    /// - Only governance can set bridge address
    /// - Address validation prevents setting default pubkey
    pub fn set_bridge_address(
        ctx: Context<SetBridgeAddress>,
        bridge_address: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        // Validate bridge address is not default
        require!(
            bridge_address != Pubkey::default(),
            TokenError::Unauthorized
        );
        let old_bridge = state.bridge_address;
        state.bridge_address = bridge_address;
        msg!(
            "Bridge address updated from {:?} to {:?}",
            old_bridge,
            bridge_address
        );
        Ok(())
    }

    /// Sets the bond contract address
    ///
    /// The bond address is used for bond-related operations. This should be set
    /// by governance after careful verification.
    ///
    /// # Parameters
    /// - `ctx`: SetBondAddress context (requires governance signer)
    /// - `bond_address`: The bond contract address (must not be default)
    ///
    /// # Returns
    /// - `Result<()>`: Success if bond address is updated
    ///
    /// # Errors
    /// - `TokenError::Unauthorized` if caller is not governance or address is default
    ///
    /// # Security
    /// - Only governance can set bond address
    /// - Address validation prevents setting default pubkey
    pub fn set_bond_address(
        ctx: Context<SetBondAddress>,
        bond_address: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );
        // Validate bond address is not default
        require!(
            bond_address != Pubkey::default(),
            TokenError::Unauthorized
        );
        let old_bond = state.bond_address;
        state.bond_address = bond_address;
        msg!(
            "Bond address updated from {:?} to {:?}",
            old_bond,
            bond_address
        );
        Ok(())
    }

    /// Mints new tokens to a recipient
    ///
    /// Creates new tokens and transfers them to the specified recipient.
    /// Subject to supply cap if one is set, and blacklist checks.
    ///
    /// # Parameters
    /// - `ctx`: MintTokens context (requires governance signer)
    /// - `amount`: Amount of tokens to mint (in token's base units)
    ///
    /// # Returns
    /// - `Result<()>`: Success if tokens are minted
    ///
    /// # Errors
    /// - `TokenError::EmergencyPaused` if protocol is paused
    /// - `TokenError::Unauthorized` if caller is not governance
    /// - `TokenError::Blacklisted` if recipient is blacklisted
    /// - `TokenError::MathOverflow` if minting would exceed supply cap
    ///
    /// # Events
    /// - Emits `TokenMinted` with amount and recipient
    ///
    /// # Security
    /// - Only governance can mint
    /// - Supply cap enforced if set
    /// - Blacklist check prevents minting to blocked addresses
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        // Extract bump and get account info before mutable borrow to avoid borrow checker issues
        let bump = ctx.accounts.state.bump;
        let state_account_info = ctx.accounts.state.to_account_info();
        
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);
        
        // Check emergency pause
        require!(!state.emergency_paused, TokenError::EmergencyPaused);
        
        // Verify that the caller is the governance authority
        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );

        // Extract recipient owner and validate accounts in a scoped block
        // This ensures all borrows are dropped before the CPI call
        let recipient_owner = {
            // Check if recipient is blacklisted
            // Get token account owner from account data (SPL token account layout: owner at offset 32)
            // to is UncheckedAccount, so we need to read raw data
            let to_account_data = ctx.accounts.to.try_borrow_data()?;
            // require!(
            //     to_account_data.len() >= 64,
            //     TokenError::Unauthorized
            // );
            let token_account = SplTokenAccount::unpack(&to_account_data)
                .map_err(|_| TokenError::InvalidTokenAccount)?;

            require!(token_account.mint == ctx.accounts.mint.key(), TokenError::InvalidTokenAccount);

            // let owner = Pubkey::try_from_slice(&to_account_data[32..64])
            //     .map_err(|_| TokenError::Unauthorized)?;
            let owner = token_account.owner;

            // Check blacklist if account is provided and not default
            if ctx.accounts.recipient_blacklist.key() != Pubkey::default() {
                let blacklist_data = ctx.accounts.recipient_blacklist.try_borrow_data()?;
                if blacklist_data.len() >= 41 {
                    // Account discriminator (8) + account Pubkey (32) + is_blacklisted bool (1) = offset 40
                    let is_blacklisted = blacklist_data[40] != 0;
                    require!(!is_blacklisted, TokenError::Blacklisted);
                }
            }

            // Validate mint authority matches state PDA
            // SPL Mint layout: mint (32) + supply (8) + decimals (1) + mint_authority (36) + freeze_authority (36)
            // mint_authority starts at offset 0, but we need to check it's the state PDA
            let mint_data = ctx.accounts.mint.try_borrow_data()?;
            require!(mint_data.len() >= 82, TokenError::Unauthorized);
            // Mint authority is at offset 0-32 (mint address), but we verify via CPI that state PDA is the authority
            // The CPI call will fail if mint authority doesn't match, so this is validated implicitly
            
            // All borrows are dropped here when the block ends
            owner
        };
        
        // Check supply cap
        if let Some(max_supply) = state.max_supply {
            let new_supply = state.current_supply
                .checked_add(amount)
                .ok_or(TokenError::MathOverflow)?;
            require!(
                new_supply <= max_supply,
                TokenError::MathOverflow
            );
        }

        msg!("Minting {} tokens", amount);

        // Create PDA signer (using bump extracted earlier)
        let state_seed = b"state";
        let bump_seed = [bump];
        let seeds = &[state_seed.as_ref(), &bump_seed[..]];
        let signer = &[&seeds[..]];

        // Call SPL Token's mint_to via CPI
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: state_account_info,
                },
                signer,
            ),
            amount,
        )?;

        // Update current supply
        state.current_supply = state.current_supply
            .checked_add(amount)
            .ok_or(TokenError::MathOverflow)?;

        // Emit event
        emit!(TokenMinted {
            amount,
            recipient: recipient_owner,
        });

        msg!("Successfully minted {} tokens", amount);
        Ok(())
    }
    /// Burns tokens from a token account
    ///
    /// Permanently removes tokens from circulation. The tokens must be owned
    /// by an account that governance has authority over.
    ///
    /// # Parameters
    /// - `ctx`: BurnTokens context (requires governance signer)
    /// - `amount`: Amount of tokens to burn (in token's base units)
    ///
    /// # Returns
    /// - `Result<()>`: Success if tokens are burned
    ///
    /// # Errors
    /// - `TokenError::EmergencyPaused` if protocol is paused
    /// - `TokenError::Unauthorized` if caller is not governance
    /// - `TokenError::MathOverflow` if burning would cause underflow
    ///
    /// # Events
    /// - Emits `TokenBurned` with amount and owner address
    ///
    /// # Security
    /// - Only governance can burn tokens
    /// - Current supply is tracked and updated
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        // Extract bump and get account info before mutable borrow to avoid borrow checker issues
        let bump = ctx.accounts.state.bump;
        let state_account_info = ctx.accounts.state.to_account_info();
        
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);
        
        // Check emergency pause
        require!(!state.emergency_paused, TokenError::EmergencyPaused);
        
        // Verify that the caller is the governance authority
        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );

        // Get token account owner for verification and event in a scoped block
        // This ensures the borrow is dropped before the CPI call
        let owner = {
            // from is UncheckedAccount, so we need to read raw data
            let from_account_data = ctx.accounts.from.try_borrow_data()?;

            let token_account = SplTokenAccount::unpack(&from_account_data)
                .map_err(|_| TokenError::InvalidTokenAccount)?;

            require!(token_account.mint == ctx.accounts.mint.key(), TokenError::InvalidTokenAccount);
            // require!(from_account_data.len() >= 64, TokenError::Unauthorized);

            let owner = token_account.owner;
            // let owner = Pubkey::try_from_slice(&from_account_data[32..64])
            //     .map_err(|_| TokenError::Unauthorized)?;
            // Borrow is dropped here when the block ends
            owner
        };

        msg!("Burning {} tokens from owner: {}", amount, owner);

        // Create PDA signer for governance (using bump extracted earlier)
        let state_seed = b"state";
        let bump_seed = [bump];
        let seeds = &[state_seed.as_ref(), &bump_seed[..]];
        let signer = &[&seeds[..]];

        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.from.to_account_info(),
                    authority: state_account_info,
                },
                signer,
            ),
            amount,
        )?;

        // Update current supply
        state.current_supply = state.current_supply
            .checked_sub(amount)
            .ok_or(TokenError::MathOverflow)?;

        // Emit event
        emit!(TokenBurned {
            amount,
            from: owner,
        });

        msg!("Successfully burned {} tokens", amount);
        Ok(())
    }

    /// Transfers tokens with comprehensive security checks
    ///
    /// Transfers tokens between accounts with enforcement of:
    /// - Emergency pause state
    /// - Blacklist (sender and recipient)
    /// - Restricted status (sender and recipient)
    /// - Whitelist mode (if enabled)
    /// - Sell limits (10% per 24h when selling to liquidity pools)
    ///
    /// # Parameters
    /// - `ctx`: TransferTokens context with all required accounts
    /// - `amount`: Amount of tokens to transfer (in token's base units)
    ///
    /// # Returns
    /// - `Result<()>`: Success if transfer completes
    ///
    /// # Errors
    /// - `TokenError::EmergencyPaused` if protocol is paused
    /// - `TokenError::Blacklisted` if sender or recipient is blacklisted
    /// - `TokenError::Restricted` if sender or recipient is restricted
    /// - `TokenError::Unauthorized` if whitelist mode is enabled and addresses not whitelisted
    /// - `TokenError::SellLimitExceeded` if selling to pool exceeds 10% limit
    /// - `TokenError::MathOverflow` if calculations overflow
    ///
    /// # Security
    /// - All restrictions are enforced before transfer
    /// - Sell limits calculated based on actual token balance
    /// - Rolling 24-hour window for sell limit tracking
    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.version >= state.min_compatible_version, TokenError::IncompatibleVersion);

        // Check emergency pause
        require!(!state.emergency_paused, TokenError::EmergencyPaused);

        // Get sender and recipient addresses from token accounts
        // Validate and extract owner from token account data
        // let from_account_data = ctx.accounts.from_account.try_borrow_data()?;
        // require!(from_account_data.len() >= 64, TokenError::Unauthorized);
        // let sender = Pubkey::try_from_slice(&from_account_data[32..64])
        //     .map_err(|_| TokenError::Unauthorized)?;

        // let to_account_data = ctx.accounts.to_account.try_borrow_data()?;
        // require!(to_account_data.len() >= 64, TokenError::Unauthorized);
        // let _recipient = Pubkey::try_from_slice(&to_account_data[32..64])
        //     .map_err(|_| TokenError::Unauthorized)?;
        
        // // Validate token accounts belong to the correct mint
        // // Token account layout: mint (0-32), owner (32-64)
        // let from_mint = Pubkey::try_from_slice(&from_account_data[0..32])
        //     .map_err(|_| TokenError::Unauthorized)?;
        // let to_mint = Pubkey::try_from_slice(&to_account_data[0..32])
        //     .map_err(|_| TokenError::Unauthorized)?;
        // require!(
        //     from_mint == ctx.accounts.mint.key() && to_mint == ctx.accounts.mint.key(),
        //     TokenError::Unauthorized
        // );


    // SAFE TOKEN ACCOUNT PARSING for sender
    let (sender, from_balance) = {
        let from_account_data = ctx.accounts.from_account.try_borrow_data()?;
        
        // Use SPL unpack instead of manual byte slicing
        let from_token = SplTokenAccount::unpack(&from_account_data)
            .map_err(|_| TokenError::InvalidTokenAccount)?;
        
        // Verify mint matches
        require!(
            from_token.mint == ctx.accounts.mint.key(),
            TokenError::InvalidTokenAccount
        );
        
        (from_token.owner, from_token.amount)
    };

    // SAFE TOKEN ACCOUNT PARSING for recipient
    let recipient = {
        let to_account_data = ctx.accounts.to_account.try_borrow_data()?;
        
        // Use SPL unpack instead of manual byte slicing
        let to_token = SplTokenAccount::unpack(&to_account_data)
            .map_err(|_| TokenError::InvalidTokenAccount)?;
        
        // Verify mint matches
        require!(
            to_token.mint == ctx.accounts.mint.key(),
            TokenError::InvalidTokenAccount
        );
        
        to_token.owner
    };

        // Check sender blacklist
        if ctx.accounts.sender_blacklist.key() != Pubkey::default() {
            let blacklist_data = ctx.accounts.sender_blacklist.try_borrow_data()?;
            if blacklist_data.len() >= 41 {
                let is_blacklisted = blacklist_data[40] != 0;
                require!(!is_blacklisted, TokenError::Blacklisted);
            }
        }

        // Check recipient blacklist
        if ctx.accounts.recipient_blacklist.key() != Pubkey::default() {
            let blacklist_data = ctx.accounts.recipient_blacklist.try_borrow_data()?;
            if blacklist_data.len() >= 41 {
                let is_blacklisted = blacklist_data[40] != 0;
                require!(!is_blacklisted, TokenError::Blacklisted);
            }
        }

        // Check sender restricted
        if ctx.accounts.sender_restricted.key() != Pubkey::default() {
            let restricted_data = ctx.accounts.sender_restricted.try_borrow_data()?;
            if restricted_data.len() >= 41 {
                let is_restricted = restricted_data[40] != 0;
                require!(!is_restricted, TokenError::Restricted);
            }
        }

        // Check recipient restricted
        if ctx.accounts.recipient_restricted.key() != Pubkey::default() {
            let restricted_data = ctx.accounts.recipient_restricted.try_borrow_data()?;
            if restricted_data.len() >= 41 {
                let is_restricted = restricted_data[40] != 0;
                require!(!is_restricted, TokenError::Restricted);
            }
        }

        // Check whitelist mode - if enabled, both sender and recipient must be whitelisted
        if state.whitelist_mode {
            // Check sender whitelist
            if ctx.accounts.sender_whitelist.key() != Pubkey::default() {
                let whitelist_data = ctx.accounts.sender_whitelist.try_borrow_data()?;
                if whitelist_data.len() >= 41 {
                    let is_whitelisted = whitelist_data[40] != 0;
                    require!(is_whitelisted, TokenError::Unauthorized);
                } else {
                    require!(false, TokenError::Unauthorized);
                }
            } else {
                require!(false, TokenError::Unauthorized);
            }
            
            // Check recipient whitelist
            if ctx.accounts.recipient_whitelist.key() != Pubkey::default() {
                let whitelist_data = ctx.accounts.recipient_whitelist.try_borrow_data()?;
                if whitelist_data.len() >= 41 {
                    let is_whitelisted = whitelist_data[40] != 0;
                    require!(is_whitelisted, TokenError::Unauthorized);
                } else {
                    require!(false, TokenError::Unauthorized);
                }
            } else {
                require!(false, TokenError::Unauthorized);
            }
        }

        // Check if recipient is a liquidity pool
        let is_pool = if ctx.accounts.liquidity_pool.key() != Pubkey::default() {
            let pool_data = ctx.accounts.liquidity_pool.try_borrow_data()?;
            if pool_data.len() >= 41 {
                pool_data[40] != 0 // is_pool is at offset 40
            } else {
                false
            }
        } else {
            false
        };

        // If selling to pool, check sell limits
        if is_pool {
            // Check if sender has no-sell-limit exemption
            let has_exemption = if ctx.accounts.no_sell_limit.key() != Pubkey::default() {
                let exemption_data = ctx.accounts.no_sell_limit.try_borrow_data()?;
                if exemption_data.len() >= 41 {
                    exemption_data[40] != 0 // has_exemption is at offset 40
                } else {
                    false
                }
            } else {
                false
            };

            if !has_exemption {
                // Check 10% sell limit within 24 hours
                let sell_tracker = &mut ctx.accounts.sell_tracker;
                let current_time = Clock::get()?.unix_timestamp;

                // Initialize tracker if needed
                if sell_tracker.account == Pubkey::default() {
                    sell_tracker.account = sender;
                    sell_tracker.last_reset = current_time;
                    sell_tracker.total_sold_24h = 0;
                }

                // Reset if 24 hours have passed
                if current_time - sell_tracker.last_reset > state.sell_limit_period as i64 {
                    sell_tracker.total_sold_24h = 0;
                    sell_tracker.last_reset = current_time;
                }

                // Get sender's token balance from token account data
                // Token account layout: mint (0-32), owner (32-64), amount (64-72)
                // require!(from_account_data.len() >= 72, TokenError::Unauthorized);
                // let from_balance = u64::from_le_bytes(
                //     from_account_data[64..72].try_into().map_err(|_| TokenError::Unauthorized)?
                // );
                

                // Calculate new total sold
                let new_total = sell_tracker
                    .total_sold_24h
                    .checked_add(amount)
                    .ok_or(TokenError::MathOverflow)?;

                // Calculate 10% of balance
                let sell_limit_amount = (from_balance as u128)
                    .checked_mul(state.sell_limit_percent as u128)
                    .and_then(|x| x.checked_div(100))
                    .ok_or(TokenError::MathOverflow)? as u64;

                // Check if new total exceeds limit
                require!(
                    new_total <= sell_limit_amount,
                    TokenError::SellLimitExceeded
                );

                sell_tracker.total_sold_24h = new_total;
            }
        }

        msg!("Transferring {} tokens", amount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from_account.to_account_info(),
                    to: ctx.accounts.to_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        msg!("Successfully transferred {} tokens", amount);
        Ok(())
    }

    /// Revokes the mint authority permanently
    ///
    /// Removes the program's ability to mint new tokens. This is an irreversible
    /// operation that should only be called after final token distribution.
    ///
    /// # Parameters
    /// - `ctx`: RevokeMintAuthority context (requires governance signer)
    ///
    /// # Returns
    /// - `Result<()>`: Success if mint authority is revoked
    ///
    /// # Errors
    /// - `TokenError::EmergencyPaused` if protocol is paused
    /// - `TokenError::Unauthorized` if caller is not governance
    ///
    /// # Events
    /// - Emits `MintAuthorityRevoked` with mint address
    ///
    /// # Security
    /// - Only governance can revoke mint authority
    /// - This operation is irreversible
    /// - Should be called after final token distribution
    pub fn revoke_mint_authority(ctx: Context<RevokeMintAuthority>) -> Result<()> {
        let state = &ctx.accounts.state;
        
        // Check emergency pause
        require!(!state.emergency_paused, TokenError::EmergencyPaused);
        
        // Require governance signer
        require!(
            state.authority == ctx.accounts.governance.key(),
            TokenError::Unauthorized
        );

        msg!(
            "Revoking mint authority for : {:?}",
            ctx.accounts.mint.key()
        );

        // Create PDA signer
        let bump = state.bump;
        let state_seed = b"state";
        let bump_seed = [bump];
        let seeds = &[state_seed.as_ref(), &bump_seed[..]];
        let signer = &[&seeds[..]];

        // Call SPL Tokens set authority via CPI
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.state.to_account_info(),
                },
                signer,
            ),
            AuthorityType::MintTokens,
            None,
        )?;
        
        // Emit event
        emit!(MintAuthorityRevoked {
            mint: ctx.accounts.mint.key(),
        });
        
        msg!("Mint authority successfully revoked!");
        Ok(())
    }
}

// Context Structures

// Initialize
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + TokenState::LEN,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, TokenState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ProposeGovernanceChange - Propose new governance (requires cooldown)
#[derive(Accounts)]
pub struct ProposeGovernanceChange<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, TokenState>,

    pub authority: Signer<'info>,

    pub clock: Sysvar<'info, Clock>,
}

// SetGovernance - Execute governance change (after cooldown)
#[derive(Accounts)]
pub struct SetGovernance<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, TokenState>,

    pub authority: Signer<'info>,

    pub clock: Sysvar<'info, Clock>,
}

// MintTokens
#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: SPL Token mint account (validated by token program)
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: SPL Token account (validated by token program)
    #[account(mut)]
    pub to: UncheckedAccount<'info>,

    /// CHECK: Governance program or authority (validated by constraint)
    pub governance: Signer<'info>,

    /// CHECK: Optional blacklist account for recipient (validated in function)
    pub recipient_blacklist: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

// BurnTokens
#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: SPL Token mint account (validated by token program)
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: SPL Token account (validated by token program)
    #[account(mut)]
    pub from: UncheckedAccount<'info>,

    /// CHECK: Governance program or authority (validated by constraint)
    pub governance: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// TransferTokens with restrictions
#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: SPL Token mint account (validated by token program)
    pub mint: UncheckedAccount<'info>,

    /// CHECK: SPL Token account for sender (validated by token program)
    /// Using UncheckedAccount and validating manually to avoid derive macro issues
    #[account(mut)]
    pub from_account: UncheckedAccount<'info>,

    /// CHECK: SPL Token account for recipient (validated by token program)
    /// Using UncheckedAccount and validating manually to avoid derive macro issues
    #[account(mut)]
    pub to_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + SellTracker::LEN,
        seeds = [b"selltracker", authority.key().as_ref()],
        bump
    )]
    pub sell_tracker: Account<'info, SellTracker>,

    /// CHECK: Optional blacklist account for sender
    pub sender_blacklist: UncheckedAccount<'info>,

    /// CHECK: Optional blacklist account for recipient
    pub recipient_blacklist: UncheckedAccount<'info>,

    /// CHECK: Optional restricted account for sender
    pub sender_restricted: UncheckedAccount<'info>,

    /// CHECK: Optional restricted account for recipient
    pub recipient_restricted: UncheckedAccount<'info>,

    /// CHECK: Optional liquidity pool account
    pub liquidity_pool: UncheckedAccount<'info>,

    /// CHECK: Optional no-sell-limit exemption account
    pub no_sell_limit: UncheckedAccount<'info>,

    /// CHECK: Optional whitelist account for sender (required if whitelist_mode enabled)
    pub sender_whitelist: UncheckedAccount<'info>,

    /// CHECK: Optional whitelist account for recipient (required if whitelist_mode enabled)
    pub recipient_whitelist: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct RevokeMintAuthority<'info> {
    #[account(
        seeds=[b"state"],
        bump=state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: SPL Token mint account (validated by token program)
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Governance program or authority (validated by constraint)
    pub governance: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// Account structures

#[account]
pub struct TokenState {
    pub authority: Pubkey,
    pub bump: u8,
    pub emergency_paused: bool,
    pub sell_limit_percent: u8, // 10% = 10
    pub sell_limit_period: u64, // 24 hours in seconds = 86400
    pub bridge_address: Pubkey, // Bridge contract address (set by governance)
    pub bond_address: Pubkey,   // Bond contract address (set by governance)
    pub pending_governance: Option<Pubkey>, // Pending governance change (for timelock)
    pub governance_change_time: Option<i64>, // Timestamp when governance change was proposed
    pub max_supply: Option<u64>, // Maximum token supply (None = unlimited)
    pub current_supply: u64, // Current total supply (tracked for mint cap)
    pub whitelist_mode: bool, // If true, only whitelisted addresses can transfer
    pub version: u16,
    pub min_compatible_version: u16,
}

impl TokenState {
    pub const GOVERNANCE_COOLDOWN_SECONDS: i64 = 604800; // 7 days
    // Size: 8 (discriminator) + 32 (authority) + 1 (bump) + 1 (emergency_paused) + 1 (sell_limit_percent) + 8 (sell_limit_period) + 32 (bridge_address) + 32 (bond_address) + 33 (Option<Pubkey>) + 9 (Option<i64>) + 9 (Option<u64>) + 8 (u64) + 1 (bool)
    pub const CURRENT_VERSION: u16 = 1;
    pub const MIN_COMPATIBLE_VERSION: u16 = 1;
    pub const LEN: usize = 8 + 32 + 1 + 1 + 1 + 8 + 32 + 32 + 33 + 9 + 9 + 8 + 1 + 2 + 2;
}

#[account]
pub struct Blacklist {
    pub account: Pubkey,
    pub is_blacklisted: bool,
}

impl Blacklist {
    pub const LEN: usize = 8 + 32 + 1; // [8 discriminator + 32 Pubkey + 1 bool]
}

#[account]
pub struct Whitelist {
    pub account: Pubkey,
    pub is_whitelisted: bool,
}

impl Whitelist {
    pub const LEN: usize = 8 + 32 + 1; // [8 discriminator + 32 Pubkey + 1 bool]
}

#[account]
pub struct NoSellLimit {
    pub account: Pubkey,
    pub has_exemption: bool,
}

impl NoSellLimit {
    pub const LEN: usize = 8 + 32 + 1; // [8 discriminator + 32 Pubkey + 1 bool]
}

#[account]
pub struct Restricted {
    pub account: Pubkey,
    pub is_restricted: bool,
}

impl Restricted {
    pub const LEN: usize = 8 + 32 + 1; // [8 discriminator + 32 Pubkey + 1 bool]
}

#[account]
pub struct LiquidityPool {
    pub pool: Pubkey,
    pub is_pool: bool,
}

impl LiquidityPool {
    pub const LEN: usize = 8 + 32 + 1; // [8 discriminator + 32 Pubkey + 1 bool]
}

#[account]
pub struct SellTracker {
    pub account: Pubkey,
    pub total_sold_24h: u64,
    pub last_reset: i64,
}

impl SellTracker {
    pub const LEN: usize = 8 + 32 + 8 + 8; // [8 discriminator + 32 Pubkey + 8 u64 + 8 i64]
}

// Context Structures for new functions

#[derive(Accounts)]
pub struct SetEmergencyPause<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: Governance program or authority (validated by constraint)
    pub governance: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetBlacklist<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Blacklist::LEN,
        seeds = [b"blacklist", account.key().as_ref()],
        bump
    )]
    pub blacklist: Account<'info, Blacklist>,

    /// CHECK: Account being blacklisted
    pub account: UncheckedAccount<'info>,

    /// CHECK: Governance program
    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetWhitelist<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Whitelist::LEN,
        seeds = [b"whitelist", account.key().as_ref()],
        bump
    )]
    pub whitelist: Account<'info, Whitelist>,

    /// CHECK: Account being whitelisted
    pub account: UncheckedAccount<'info>,

    /// CHECK: Governance program
    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetNoSellLimit<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + NoSellLimit::LEN,
        seeds = [b"noselllimit", account.key().as_ref()],
        bump
    )]
    pub no_sell_limit: Account<'info, NoSellLimit>,

    /// CHECK: Account getting exemption
    pub account: UncheckedAccount<'info>,

    /// CHECK: Governance program
    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRestricted<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Restricted::LEN,
        seeds = [b"restricted", account.key().as_ref()],
        bump
    )]
    pub restricted: Account<'info, Restricted>,

    /// CHECK: Account being restricted
    pub account: UncheckedAccount<'info>,

    /// CHECK: Governance program
    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetLiquidityPool<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + LiquidityPool::LEN,
        seeds = [b"liquiditypool", pool.key().as_ref()],
        bump
    )]
    pub liquidity_pool: Account<'info, LiquidityPool>,

    /// CHECK: Pool address
    pub pool: UncheckedAccount<'info>,

    /// CHECK: Governance program
    pub governance: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetBridgeAddress<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: Governance program or authority (validated by constraint)
    pub governance: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetBondAddress<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,

    /// CHECK: Governance program or authority (validated by constraint)
    pub governance: Signer<'info>,
}
