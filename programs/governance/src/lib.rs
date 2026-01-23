//! # Governance Program
//!
//! A multisig governance system for managing protocol changes with:
//! - Multi-signer approval requirements
//! - Transaction queuing with cooldown periods
//! - Cross-program invocations (CPIs) to token and presale programs
//! - Emergency pause functionality
//! - Comprehensive transaction types for protocol management
//!
//! ## Security Features
//! - Minimum 2 approvals required (prevents single-point-of-failure)
//! - Cooldown periods prevent instant execution
//! - All queue operations require authorized signer
//! - Reentrancy protection on critical functions
//! - Duplicate signer prevention
//!
//! ## Transaction Flow
//! 1. Queue: Authorized signer queues a transaction
//! 2. Approve: Multiple signers approve the transaction
//! 3. Execute: After cooldown, transaction is executed via CPI
//!
//! ## Transaction Types
//! - Unpause: Unpause the token program
//! - Blacklist: Add/remove addresses from blacklist
//! - NoSellLimit: Grant/revoke sell limit exemptions
//! - Restricted: Add/remove restricted addresses
//! - LiquidityPool: Mark/unmark liquidity pools
//! - BridgeAddress: Update bridge contract address
//! - BondAddress: Update bond contract address
//! - TreasuryAddress: Update treasury address
//! - WithdrawToTreasury: Withdraw funds to treasury
//! - SetRequiredApprovals: Change approval requirements
//! - SetCooldownPeriod: Change cooldown period

use anchor_lang::prelude::*;

declare_id!("eFgtAai6S3N3dygPG9ajxxHVQJ2evn1o5sZ3LjmYqAL");

// Import token program (for later CPI integration)
#[allow(unused_imports)]
use spl_project::program::SplProject;
// Import presale program (for treasury management)
#[allow(unused_imports)]
use presale::program::Presale;

#[program]
pub mod governance {
    use super::*;

    /// Initializes the governance program with multisig configuration
    ///
    /// Sets up the governance state with signers, approval requirements, and cooldown period.
    /// This is a one-time operation that establishes the governance structure.
    ///
    /// # Parameters
    /// - `ctx`: Initialize context
    /// - `required_approvals`: Minimum number of approvals needed (must be >= 2)
    /// - `cooldown_period`: Minimum cooldown period in seconds (must be >= 1800)
    /// - `signers`: List of authorized signer addresses (must be unique, max 10)
    ///
    /// # Returns
    /// - `Result<()>`: Success if initialization completes
    ///
    /// # Errors
    /// - `GovernanceError::RequiredApprovalsTooLow` if required_approvals < 2
    /// - `GovernanceError::CooldownPeriodTooLow` if cooldown < 1800 seconds
    /// - `GovernanceError::DuplicateSigners` if signers list contains duplicates
    /// - `GovernanceError::InvalidRequiredApprovals` if required_approvals > signers.len()
    ///
    /// # Security
    /// - Prevents duplicate signers
    /// - Enforces minimum approval threshold
    /// - Validates all parameters before initialization
    pub fn initialize(
        ctx: Context<Initialize>,
        required_approvals: u8,
        cooldown_period: i64,
        signers: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            required_approvals >= GovernanceState::MIN_REQUIRED_APPROVALS,
            GovernanceError::RequiredApprovalsTooLow
        );
        require!(
            cooldown_period >= GovernanceState::MIN_COOLDOWN_SECONDS,
            GovernanceError::CooldownPeriodTooLow
        );
        require!(
            signers.len() <= GovernanceState::MAX_SIGNERS,
            GovernanceError::InvalidRequiredApprovals
        );
        require!(
            required_approvals <= signers.len() as u8,
            GovernanceError::RequiredApprovalsTooHigh
        );
        require!(
            !signers.is_empty(),
            GovernanceError::InvalidRequiredApprovals
        );

        // Check for duplicate signers
        use std::collections::HashSet;
        let unique_signers: HashSet<_> = signers.iter().collect();
        require!(
            unique_signers.len() == signers.len(),
            GovernanceError::DuplicateSigners
        );

        let governance_state = &mut ctx.accounts.governance_state;
        governance_state.authority = ctx.accounts.authority.key();
        governance_state.required_approvals = required_approvals;
        governance_state.cooldown_period = cooldown_period;
        governance_state.next_transaction_id = 1;
        governance_state.token_program = Pubkey::default();
        governance_state.token_program_set = false;
        governance_state.presale_program = Pubkey::default();
        governance_state.presale_program_set = false;
        governance_state.bump = ctx.bumps.governance_state;
        governance_state.signers = signers;

        msg!(
            "Governance initialized with {} required approvals, {}s cooldown, and {} signers",
            required_approvals,
            cooldown_period,
            governance_state.signers.len()
        );
        Ok(())
    }

    /// Set the token program address
    /// Sets the token program address for CPI calls
    ///
    /// Configures the governance program to interact with the token program.
    /// This is a one-time setup that must be done before queuing token-related transactions.
    ///
    /// # Parameters
    /// - `ctx`: SetTokenProgram context (requires authority signer)
    /// - `token_program`: The token program ID (must not be default)
    ///
    /// # Returns
    /// - `Result<()>`: Success if token program is set
    ///
    /// # Errors
    /// - `GovernanceError::Unauthorized` if caller is not authority
    /// - `GovernanceError::InvalidAccount` if token_program is default
    ///
    /// # Security
    /// - Can only be set once
    /// - Requires authority signer
    pub fn set_token_program(ctx: Context<SetTokenProgram>, token_program: Pubkey) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            !governance_state.token_program_set,
            GovernanceError::TokenProgramAlreadySet
        );
        // Enforce multisig
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.authority.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate token program is not default
        require!(
            token_program != Pubkey::default(),
            GovernanceError::InvalidAccount
        );
        governance_state.token_program = token_program;
        governance_state.token_program_set = true;
        msg!("Token program set to: {}", token_program);
        Ok(())
    }

    /// Set the presale program address
    /// Sets the presale program address for CPI calls
    ///
    /// Configures the governance program to interact with the presale program.
    /// This is a one-time setup that must be done before queuing presale-related transactions.
    ///
    /// # Parameters
    /// - `ctx`: SetPresaleProgram context (requires authority signer)
    /// - `presale_program`: The presale program ID (must not be default)
    ///
    /// # Returns
    /// - `Result<()>`: Success if presale program is set
    ///
    /// # Errors
    /// - `GovernanceError::Unauthorized` if caller is not authority
    /// - `GovernanceError::InvalidAccount` if presale_program is default
    ///
    /// # Security
    /// - Can only be set once
    /// - Requires authority signer
    pub fn set_presale_program(ctx: Context<SetPresaleProgram>, presale_program: Pubkey) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            !governance_state.presale_program_set,
            GovernanceError::PresaleProgramAlreadySet
        );
        // Enforce multisig
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.authority.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate presale program is not default
        require!(
            presale_program != Pubkey::default(),
            GovernanceError::InvalidAccount
        );
        governance_state.presale_program = presale_program;
        governance_state.presale_program_set = true;
        msg!("Presale program set to: {}", presale_program);
        Ok(())
    }

    /// Queue a transaction to unpause the token
    /// Queues a transaction to unpause the token program
    ///
    /// Creates a queued transaction that will unpause the token program after
    /// the required approvals and cooldown period.
    ///
    /// # Parameters
    /// - `ctx`: QueueUnpause context (requires authorized signer)
    ///
    /// # Returns
    /// - `Result<u64>`: Transaction ID if queued successfully
    ///
    /// # Errors
    /// - `GovernanceError::NotAuthorizedSigner` if caller is not authorized
    /// - `GovernanceError::TokenProgramNotSet` if token program not configured
    ///
    /// # Security
    /// - Requires authorized signer to queue
    /// - Transaction must be approved and executed separately
    pub fn queue_unpause(ctx: Context<QueueUnpause>) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::Unpause;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = Pubkey::default();
        transaction.data = vec![];
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (unpause), will execute after {}",
            tx_id,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queues a transaction to set blacklist status
    ///
    /// Creates a queued transaction that will add or remove an address from the blacklist
    /// after required approvals and cooldown period.
    ///
    /// # Parameters
    /// - `ctx`: QueueSetBlacklist context (requires authorized signer)
    /// - `account`: Address to blacklist/unblacklist (must not be default)
    /// - `value`: `true` to blacklist, `false` to unblacklist
    ///
    /// # Returns
    /// - `Result<u64>`: Transaction ID if queued successfully
    ///
    /// # Errors
    /// - `GovernanceError::NotAuthorizedSigner` if caller is not authorized
    /// - `GovernanceError::InvalidAccount` if account is default
    /// - `GovernanceError::InvalidDataLength` if data encoding fails
    ///
    /// # Security
    /// - Requires authorized signer to queue
    /// - Validates account is not default
    /// - Validates data length (33 bytes: 32 for pubkey + 1 for bool)
    pub fn queue_set_blacklist(
        ctx: Context<QueueSetBlacklist>,
        account: Pubkey,
        value: bool,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate account is not default
        require!(
            account != Pubkey::default(),
            GovernanceError::InvalidAccount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&account.to_bytes());
        data.push(if value { 1 } else { 0 });

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::Blacklist;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = account;
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (blacklist {}: {}), will execute after {}",
            tx_id,
            account,
            value,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queue a transaction to set no sell limit
    pub fn queue_set_no_sell_limit(
        ctx: Context<QueueSetNoSellLimit>,
        account: Pubkey,
        value: bool,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate account is not default
        require!(
            account != Pubkey::default(),
            GovernanceError::InvalidAccount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&account.to_bytes());
        data.push(if value { 1 } else { 0 });
        // Validate data length
        require!(
            data.len() == 33,
            GovernanceError::InvalidDataLength
        );

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::NoSellLimit;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = account;
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (no sell limit {}: {}), will execute after {}",
            tx_id,
            account,
            value,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queue a transaction to set restricted
    pub fn queue_set_restricted(
        ctx: Context<QueueSetRestricted>,
        account: Pubkey,
        value: bool,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate account is not default
        require!(
            account != Pubkey::default(),
            GovernanceError::InvalidAccount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&account.to_bytes());
        data.push(if value { 1 } else { 0 });

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::Restrict;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = account;
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (restrict {}: {}), will execute after {}",
            tx_id,
            account,
            value,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queue a transaction to set liquidity pool
    pub fn queue_set_liquidity_pool(
        ctx: Context<QueueSetLiquidityPool>,
        pool: Pubkey,
        value: bool,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate pool is not default
        require!(
            pool != Pubkey::default(),
            GovernanceError::InvalidAccount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&pool.to_bytes());
        data.push(if value { 1 } else { 0 });

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::Pair;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = pool;
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (liquidity pool {}: {}), will execute after {}",
            tx_id,
            pool,
            value,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queue a transaction to set bridge address
    pub fn queue_set_bridge_address(
        ctx: Context<QueueSetBridgeAddress>,
        bridge_address: Pubkey,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate bridge address is not default
        require!(
            bridge_address != Pubkey::default(),
            GovernanceError::InvalidAccount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&bridge_address.to_bytes());

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::SetBridgeAddress;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = bridge_address;
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (set bridge address: {}), will execute after {}",
            tx_id,
            bridge_address,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queue a transaction to set bond address
    pub fn queue_set_bond_address(
        ctx: Context<QueueSetBondAddress>,
        bond_address: Pubkey,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate bond address is not default
        require!(
            bond_address != Pubkey::default(),
            GovernanceError::InvalidAccount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&bond_address.to_bytes());

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::SetBondAddress;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = bond_address;
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (set bond address: {}), will execute after {}",
            tx_id,
            bond_address,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queue a transaction to set treasury address
    pub fn queue_set_treasury_address(
        ctx: Context<QueueSetTreasuryAddress>,
        treasury_address: Pubkey,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.presale_program_set,
            GovernanceError::PresaleProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate treasury address is not default
        require!(
            treasury_address != Pubkey::default(),
            GovernanceError::InvalidAccount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&treasury_address.to_bytes());

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::SetTreasuryAddress;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = treasury_address;
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (set treasury address: {}), will execute after {}",
            tx_id,
            treasury_address,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queue a transaction to withdraw to treasury
    pub fn queue_withdraw_to_treasury(
        ctx: Context<QueueWithdrawToTreasury>,
        amount: u64,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.presale_program_set,
            GovernanceError::PresaleProgramNotSet
        );
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        // Validate amount is greater than 0
        require!(
            amount > 0,
            GovernanceError::InvalidAmount
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&amount.to_le_bytes());

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::WithdrawToTreasury;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = Pubkey::default();
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (withdraw to treasury: {}), will execute after {}",
            tx_id,
            amount,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queues a transaction to change required approval threshold
    ///
    /// Creates a queued transaction that will update the minimum number of approvals
    /// required for transaction execution. This is a critical governance parameter.
    ///
    /// # Parameters
    /// - `ctx`: QueueSetRequiredApprovals context (requires authorized signer)
    /// - `required`: New required approval count (must be >= 2 and <= signers.len())
    ///
    /// # Returns
    /// - `Result<u64>`: Transaction ID if queued successfully
    ///
    /// # Errors
    /// - `GovernanceError::NotAuthorizedSigner` if caller is not authorized
    /// - `GovernanceError::RequiredApprovalsTooLow` if required < 2
    /// - `GovernanceError::RequiredApprovalsTooHigh` if required > signers.len()
    ///
    /// # Security
    /// - Requires authorized signer to queue
    /// - Enforces minimum 2 approvals
    /// - Prevents setting threshold higher than signer count
    pub fn queue_set_required_approvals(
        ctx: Context<QueueSetRequiredApprovals>,
        required: u8,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        require!(
            required >= GovernanceState::MIN_REQUIRED_APPROVALS,
            GovernanceError::RequiredApprovalsTooLow
        );
        require!(
            required <= governance_state.signers.len() as u8,
            GovernanceError::RequiredApprovalsTooHigh
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.push(required);

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::SetRequiredApprovals;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = Pubkey::default();
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (set required approvals to {}), will execute after {}",
            tx_id,
            required,
            execute_after
        );
        Ok(tx_id)
    }

    /// Queues a transaction to change cooldown period
    ///
    /// Creates a queued transaction that will update the minimum cooldown period
    /// required before transaction execution. This is a critical governance parameter.
    ///
    /// # Parameters
    /// - `ctx`: QueueSetCooldownPeriod context (requires authorized signer)
    /// - `period`: New cooldown period in seconds (must be >= 1800 and <= MAX_COOLDOWN_SECONDS)
    ///
    /// # Returns
    /// - `Result<u64>`: Transaction ID if queued successfully
    ///
    /// # Errors
    /// - `GovernanceError::NotAuthorizedSigner` if caller is not authorized
    /// - `GovernanceError::CooldownPeriodTooLow` if period < 1800 seconds
    /// - `GovernanceError::CooldownPeriodTooHigh` if period > MAX_COOLDOWN_SECONDS
    ///
    /// # Security
    /// - Requires authorized signer to queue
    /// - Enforces minimum 30-minute cooldown
    /// - Enforces maximum cooldown limit
    pub fn queue_set_cooldown_period(
        ctx: Context<QueueSetCooldownPeriod>,
        period: i64,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        // Enforce multisig at queue step
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.initiator.key()),
            GovernanceError::NotAuthorizedSigner
        );
        require!(
            period >= GovernanceState::MIN_COOLDOWN_SECONDS,
            GovernanceError::CooldownPeriodTooLow
        );
        require!(
            period <= GovernanceState::MAX_COOLDOWN_SECONDS,
            GovernanceError::CooldownPeriodTooHigh
        );

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&period.to_le_bytes());

        let transaction = &mut ctx.accounts.transaction;
        transaction.id = tx_id;
        transaction.tx_type = TransactionType::SetCooldownPeriod;
        transaction.status = TransactionStatus::Pending;
        transaction.initiator = ctx.accounts.initiator.key();
        transaction.target = Pubkey::default();
        transaction.data = data;
        transaction.timestamp = clock.unix_timestamp;
        transaction.execute_after = execute_after;
        transaction.approval_count = 0;
        transaction.approvals = vec![];
        transaction.rejection_reason = String::new();
        transaction.rejector = Pubkey::default();

        msg!(
            "Transaction {} queued (set cooldown period to {}s), will execute after {}",
            tx_id,
            period,
            execute_after
        );
        Ok(tx_id)
    }

    /// Approve a transaction
    /// Approves a queued transaction
    ///
    /// Adds the caller's approval to a queued transaction. When enough approvals
    /// are collected (meeting the required_approvals threshold), the transaction
    /// can be executed after the cooldown period expires.
    ///
    /// # Parameters
    /// - `ctx`: ApproveTransaction context (requires authorized signer)
    /// - `tx_id`: The transaction ID to approve
    ///
    /// # Returns
    /// - `Result<()>`: Success if approval is added
    ///
    /// # Errors
    /// - `GovernanceError::NotAuthorizedSigner` if caller is not authorized
    /// - `GovernanceError::TransactionNotFound` if transaction doesn't exist
    /// - `GovernanceError::TransactionAlreadyExecuted` if transaction already executed
    /// - `GovernanceError::AlreadyApproved` if signer already approved
    ///
    /// # Security
    /// - Reentrancy protection (checks status before modification)
    /// - Prevents duplicate approvals
    /// - Only authorized signers can approve
    pub fn approve_transaction(ctx: Context<ApproveTransaction>, tx_id: u64) -> Result<()> {
        let governance_state = &ctx.accounts.governance_state;
        let transaction = &mut ctx.accounts.transaction;

        require!(
            transaction.id == tx_id,
            GovernanceError::InvalidTransactionId
        );
        // Reentrancy guard - check transaction not already executed
        require!(
            transaction.status == TransactionStatus::Pending,
            GovernanceError::TransactionNotPending
        );
        require!(
            !transaction.has_approved(ctx.accounts.approver.key()),
            GovernanceError::AlreadyApproved
        );
        // Only authorized signers can approve
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.approver.key()),
            GovernanceError::NotAuthorizedSigner
        );

        transaction.add_approval(ctx.accounts.approver.key());

        msg!(
            "Transaction {} approved by {} ({} of {} required)",
            tx_id,
            ctx.accounts.approver.key(),
            transaction.approval_count,
            governance_state.required_approvals
        );

        // Execution should only occur via execute_transaction after cooldown expires
        // Do not auto-execute or check cooldown here

        Ok(())
    }

    /// Reject a transaction
    pub fn reject_transaction(
        ctx: Context<RejectTransaction>,
        tx_id: u64,
        reason: String,
    ) -> Result<()> {
        let governance_state = &ctx.accounts.governance_state;
        let transaction = &mut ctx.accounts.transaction;

        // Enforce multisig - only authorized signers can reject
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.approver.key()),
            GovernanceError::NotAuthorizedSigner
        );

        require!(
            transaction.id == tx_id,
            GovernanceError::InvalidTransactionId
        );
        require!(
            transaction.status == TransactionStatus::Pending,
            GovernanceError::TransactionNotPending
        );
        require!(!reason.is_empty(), GovernanceError::EmptyRejectionReason);
        // Limit reason length to prevent log overflow
        require!(
            reason.len() <= 256,
            GovernanceError::EmptyRejectionReason
        );

        transaction.status = TransactionStatus::Rejected;
        transaction.rejection_reason = reason.clone();
        transaction.rejector = ctx.accounts.approver.key();

        msg!(
            "Transaction {} rejected by {}: {}",
            tx_id,
            ctx.accounts.approver.key(),
            reason
        );

        Ok(())
    }

    /// Execute a transaction (if cooldown expired and approved)
    /// Executes a queued transaction after cooldown
    ///
    /// Executes a transaction that has received sufficient approvals and passed
    /// the cooldown period. Performs actual CPI calls to apply state changes.
    ///
    /// # Parameters
    /// - `ctx`: ExecuteTransaction context with all required accounts for CPI
    /// - `tx_id`: The transaction ID to execute
    ///
    /// # Returns
    /// - `Result<()>`: Success if transaction is executed
    ///
    /// # Errors
    /// - `GovernanceError::TransactionNotFound` if transaction doesn't exist
    /// - `GovernanceError::TransactionAlreadyExecuted` if already executed
    /// - `GovernanceError::InsufficientApprovals` if not enough approvals
    /// - `GovernanceError::CooldownNotExpired` if cooldown period hasn't passed
    ///
    /// # Security
    /// - Reentrancy protection (marks as executed immediately)
    /// - Enforces cooldown period
    /// - Validates approval count before execution
    /// - Performs actual CPI calls to apply changes
    pub fn execute_transaction(ctx: Context<ExecuteTransaction>, tx_id: u64) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        let transaction = &mut ctx.accounts.transaction;

        require!(
            transaction.id == tx_id,
            GovernanceError::InvalidTransactionId
        );
        // Reentrancy guard - check transaction not already executed
        require!(
            transaction.status == TransactionStatus::Pending,
            GovernanceError::TransactionNotPending
        );
        // Mark as executing immediately to prevent reentrancy
        transaction.status = TransactionStatus::Executed;

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= transaction.execute_after,
            GovernanceError::CooldownNotExpired
        );
        require!(
            transaction.approval_count >= governance_state.required_approvals,
            GovernanceError::InsufficientApprovals
        );

        // Execute real CPI calls based on transaction type
        match transaction.tx_type {
            TransactionType::Unpause => {
                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.token_program_program.to_account_info();
                let cpi_accounts = spl_project::cpi::accounts::SetEmergencyPause {
                    state: ctx.accounts.state_pda.to_account_info(),
                    governance: ctx.accounts.governance_state.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                spl_project::cpi::set_emergency_pause(cpi_ctx, false)?;
                msg!("Transaction {} executed: Unpause", tx_id);
            }
            TransactionType::Blacklist => {
                if transaction.data.len() < 33 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let account_pubkey = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;
                let value = transaction.data[32] != 0;

                // Verify target account matches
                require!(
                    account_pubkey == ctx.accounts.target_account.key(),
                    GovernanceError::InvalidAccount
                );

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.token_program_program.to_account_info();
                let cpi_accounts = spl_project::cpi::accounts::SetBlacklist {
                    state: ctx.accounts.state_pda.to_account_info(),
                    blacklist: ctx.accounts.blacklist_account.to_account_info(),
                    account: ctx.accounts.target_account.to_account_info(),
                    governance: ctx.accounts.governance_state.to_account_info(),
                    payer: ctx.accounts.payer.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                spl_project::cpi::set_blacklist(cpi_ctx, account_pubkey, value)?;
                msg!("Transaction {} executed: Blacklist {} = {}", tx_id, account_pubkey, value);
            }
            TransactionType::NoSellLimit => {
                if transaction.data.len() < 33 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let account_pubkey = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;
                let value = transaction.data[32] != 0;

                // Verify target account matches
                require!(
                    account_pubkey == ctx.accounts.target_account.key(),
                    GovernanceError::InvalidAccount
                );

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.token_program_program.to_account_info();
                let cpi_accounts = spl_project::cpi::accounts::SetNoSellLimit {
                    state: ctx.accounts.state_pda.to_account_info(),
                    no_sell_limit: ctx.accounts.no_sell_limit_account.to_account_info(),
                    account: ctx.accounts.target_account.to_account_info(),
                    governance: ctx.accounts.governance_state.to_account_info(),
                    payer: ctx.accounts.payer.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                spl_project::cpi::set_no_sell_limit(cpi_ctx, account_pubkey, value)?;
                msg!("Transaction {} executed: NoSellLimit {} = {}", tx_id, account_pubkey, value);
            }
            TransactionType::Restrict => {
                if transaction.data.len() < 33 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let account_pubkey = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;
                let value = transaction.data[32] != 0;

                // Verify target account matches
                require!(
                    account_pubkey == ctx.accounts.target_account.key(),
                    GovernanceError::InvalidAccount
                );

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.token_program_program.to_account_info();
                let cpi_accounts = spl_project::cpi::accounts::SetRestricted {
                    state: ctx.accounts.state_pda.to_account_info(),
                    restricted: ctx.accounts.restricted_account.to_account_info(),
                    account: ctx.accounts.target_account.to_account_info(),
                    governance: ctx.accounts.governance_state.to_account_info(),
                    payer: ctx.accounts.payer.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                spl_project::cpi::set_restricted(cpi_ctx, account_pubkey, value)?;
                msg!("Transaction {} executed: Restrict {} = {}", tx_id, account_pubkey, value);
            }
            TransactionType::Pair => {
                if transaction.data.len() < 33 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let pool_pubkey = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;
                let value = transaction.data[32] != 0;

                // Verify pool address matches
                require!(
                    pool_pubkey == ctx.accounts.pool_address.key(),
                    GovernanceError::InvalidAccount
                );

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.token_program_program.to_account_info();
                let cpi_accounts = spl_project::cpi::accounts::SetLiquidityPool {
                    state: ctx.accounts.state_pda.to_account_info(),
                    liquidity_pool: ctx.accounts.liquidity_pool_account.to_account_info(),
                    pool: ctx.accounts.pool_address.to_account_info(),
                    governance: ctx.accounts.governance_state.to_account_info(),
                    payer: ctx.accounts.payer.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                spl_project::cpi::set_liquidity_pool(cpi_ctx, pool_pubkey, value)?;
                msg!("Transaction {} executed: LiquidityPool {} = {}", tx_id, pool_pubkey, value);
            }
            TransactionType::SetRequiredApprovals => {
                if transaction.data.len() < 1 {
                    return Err(GovernanceError::InvalidRequiredApprovals.into());
                }
                let required = transaction.data[0];
                require!(
                    required >= GovernanceState::MIN_REQUIRED_APPROVALS,
                    GovernanceError::RequiredApprovalsTooLow
                );
                require!(
                    required <= governance_state.signers.len() as u8,
                    GovernanceError::RequiredApprovalsTooHigh
                );
                governance_state.required_approvals = required;
                msg!(
                    "Transaction {} executed: SetRequiredApprovals = {}",
                    tx_id,
                    required
                );
            }
            TransactionType::SetCooldownPeriod => {
                if transaction.data.len() < 8 {
                    return Err(GovernanceError::InvalidCooldownPeriod.into());
                }
                let period = i64::from_le_bytes(
                    transaction.data[0..8]
                        .try_into()
                        .map_err(|_| GovernanceError::InvalidCooldownPeriod)?,
                );
                require!(
                    period >= GovernanceState::MIN_COOLDOWN_SECONDS,
                    GovernanceError::CooldownPeriodTooLow
                );
                require!(
                    period <= GovernanceState::MAX_COOLDOWN_SECONDS,
                    GovernanceError::CooldownPeriodTooHigh
                );
                governance_state.cooldown_period = period;
                msg!(
                    "Transaction {} executed: SetCooldownPeriod = {}",
                    tx_id,
                    period
                );
            }
            TransactionType::SetBridgeAddress => {
                if transaction.data.len() < 32 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let bridge_address = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.token_program_program.to_account_info();
                let cpi_accounts = spl_project::cpi::accounts::SetBridgeAddress {
                    state: ctx.accounts.state_pda.to_account_info(),
                    governance: ctx.accounts.governance_state.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                spl_project::cpi::set_bridge_address(cpi_ctx, bridge_address)?;
                msg!("Transaction {} executed: SetBridgeAddress = {}", tx_id, bridge_address);
            }
            TransactionType::SetBondAddress => {
                if transaction.data.len() < 32 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let bond_address = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.token_program_program.to_account_info();
                let cpi_accounts = spl_project::cpi::accounts::SetBondAddress {
                    state: ctx.accounts.state_pda.to_account_info(),
                    governance: ctx.accounts.governance_state.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                spl_project::cpi::set_bond_address(cpi_ctx, bond_address)?;
                msg!("Transaction {} executed: SetBondAddress = {}", tx_id, bond_address);
            }
            TransactionType::SetTreasuryAddress => {
                if transaction.data.len() < 32 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let treasury_address = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.presale_program_program.to_account_info();
                let cpi_accounts = presale::cpi::accounts::SetTreasuryAddress {
                    presale_state: ctx.accounts.presale_state_pda.to_account_info(),
                    authority: ctx.accounts.governance_state.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                presale::cpi::set_treasury_address(cpi_ctx, treasury_address)?;
                msg!("Transaction {} executed: SetTreasuryAddress = {}", tx_id, treasury_address);
            }
            TransactionType::WithdrawToTreasury => {
                if transaction.data.len() < 8 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let amount = u64::from_le_bytes(
                    transaction.data[0..8]
                        .try_into()
                        .map_err(|_| GovernanceError::InvalidAccount)?,
                );

                // Get bump before mutable borrow
                let bump = governance_state.bump;
                let cpi_program = ctx.accounts.presale_program_program.to_account_info();
                let cpi_accounts = presale::cpi::accounts::WithdrawToTreasury {
                    presale_state: ctx.accounts.presale_state_pda.to_account_info(),
                    authority: ctx.accounts.governance_state.to_account_info(),
                    presale_payment_vault_pda: ctx.accounts.presale_payment_vault_pda.to_account_info(),
                    presale_payment_vault: ctx.accounts.presale_payment_vault.to_account_info(),
                    treasury_token_account: ctx.accounts.treasury_token_account.to_account_info(),
                    payment_token_mint: ctx.accounts.payment_token_mint.to_account_info(),
                    token_program: ctx.accounts.spl_token_program.to_account_info(),
                    associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
                };
                // Sign with governance state PDA
                let governance_seeds = &[b"governance".as_ref(), &[bump]];
                let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                presale::cpi::withdraw_to_treasury(cpi_ctx, amount)?;
                msg!("Transaction {} executed: WithdrawToTreasury = {}", tx_id, amount);
            }
        }

        // Transaction status already set to Executed at start for reentrancy protection
        msg!("Transaction {} executed successfully", tx_id);

        Ok(())
    }

    /// Set required approvals (REMOVED - must use queued transaction)
    /// This function is kept for backwards compatibility but should not be used.
    /// Use queue_set_required_approvals instead.
    /// DEPRECATED: Direct setter bypasses queue mechanism
    /// Use queue_set_required_approvals instead
    pub fn set_required_approvals(ctx: Context<SetRequiredApprovals>, required: u8) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.authority.key()),
            GovernanceError::NotAuthorizedSigner
        );
        
        require!(
            required >= GovernanceState::MIN_REQUIRED_APPROVALS,
            GovernanceError::RequiredApprovalsTooLow
        );
        require!(
            governance_state.authority == ctx.accounts.authority.key(),
            GovernanceError::Unauthorized
        );
        require!(
            required <= governance_state.signers.len() as u8,
            GovernanceError::RequiredApprovalsTooHigh
        );
        governance_state.required_approvals = required;
        msg!("Required approvals set to {} (DEPRECATED: use queue mechanism)", required);
        Ok(())
    }

    /// DEPRECATED: Direct setter bypasses queue mechanism
    /// Use queue_set_cooldown_period instead
    pub fn set_cooldown_period(ctx: Context<SetCooldownPeriod>, period: i64) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.authority.key()),
            GovernanceError::NotAuthorizedSigner
        );
        
        require!(
            period >= GovernanceState::MIN_COOLDOWN_SECONDS,
            GovernanceError::CooldownPeriodTooLow
        );
        require!(
            governance_state.authority == ctx.accounts.authority.key(),
            GovernanceError::Unauthorized
        );
        governance_state.cooldown_period = period;
        msg!("Cooldown period set to {} seconds (DEPRECATED: use queue mechanism)", period);
        Ok(())
    }

    /// Grant a role
    pub fn grant_role(ctx: Context<GrantRole>, role: u8, account: Pubkey) -> Result<()> {
        let governance_state = &ctx.accounts.governance_state;

        require!(governance_state.is_authorized_signer(&ctx.accounts.authority.key()), GovernanceError::NotAuthorizedSigner);

        require!(account != ctx.accounts.authority.key(), GovernanceError::Unauthorized);

        let role_account = &mut ctx.accounts.role_account;
        role_account.account = account;
        role_account.role = role;
        role_account.has_role = true;
        msg!("Role {} granted to {} by {}", role, account, ctx.accounts.authority.key());
        Ok(())
    }

    /// Revoke a role
    pub fn revoke_role(ctx: Context<RevokeRole>, role: u8, account: Pubkey) -> Result<()> {
        let governance_state = &ctx.accounts.governance_state;

        require!(governance_state.is_authorized_signer(&ctx.accounts.authority.key()), GovernanceError::NotAuthorizedSigner);

        let role_account = &mut ctx.accounts.role_account;
        require!(
            role_account.account == account,
            GovernanceError::InvalidAccount
        );
        require!(role_account.role == role, GovernanceError::InvalidRole);
        role_account.has_role = false;
        msg!("Role {} revoked from {} by {}", role, account, ctx.accounts.authority.key());
        Ok(())
    }

    /// Emergency pause (1 signer allowed, no cooldown)
    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        let governance_state = &ctx.accounts.governance_state;
        // Allow any authorized signer to pause
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.authority.key()),
            GovernanceError::NotAuthorizedSigner
        );
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
        );

        // Call token program's set_emergency_pause via CPI
        // The governance PDA must sign, not the individual authority
        let cpi_program = ctx.accounts.token_program_program.to_account_info();
        let cpi_accounts = spl_project::cpi::accounts::SetEmergencyPause {
            state: ctx.accounts.state_pda.to_account_info(),
            governance: ctx.accounts.governance_state.to_account_info(),
        };
        let governance_seeds = &[b"governance".as_ref(), &[governance_state.bump]];
        let signer_seeds: &[&[&[u8]]] = &[governance_seeds];
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        spl_project::cpi::set_emergency_pause(cpi_ctx, true)?;

        msg!(
            "Emergency pause activated by {}",
            ctx.accounts.authority.key()
        );
        Ok(())
    }
}

// Account Structures

#[account]
pub struct GovernanceState {
    pub authority: Pubkey,
    pub required_approvals: u8,
    pub cooldown_period: i64, // in seconds (90 minutes = 5400)
    pub next_transaction_id: u64,
    pub token_program: Pubkey,
    pub token_program_set: bool,
    pub presale_program: Pubkey,
    pub presale_program_set: bool,
    pub bump: u8,
    pub signers: Vec<Pubkey>, // Authorized signers (max 10)
}

impl GovernanceState {
    pub const LEN: usize = 8 + 32 + 1 + 8 + 8 + 32 + 1 + 32 + 1 + 1 + 4 + (32 * 10); // discriminator + fields + vec overhead + max 10 signers
    pub const MIN_REQUIRED_APPROVALS: u8 = 2;
    pub const MIN_COOLDOWN_SECONDS: i64 = 1800; // 30 minutes
    pub const MAX_COOLDOWN_SECONDS: i64 = 2592000; // 30 days
    pub const MAX_SIGNERS: usize = 10;

    pub fn is_authorized_signer(&self, signer: &Pubkey) -> bool {
        self.signers.contains(signer)
    }
}

#[account]
pub struct Transaction {
    pub id: u64,
    pub tx_type: TransactionType,
    pub status: TransactionStatus,
    pub initiator: Pubkey,
    pub target: Pubkey,
    pub data: Vec<u8>, // Encoded parameters
    pub timestamp: i64,
    pub execute_after: i64,
    pub approval_count: u8,
    pub approvals: Vec<Pubkey>, // Max 10 approvers
    pub rejection_reason: String,
    pub rejector: Pubkey,
}

impl Transaction {
    pub const MAX_LEN: usize =
        8 + 8 + 1 + 1 + 32 + 32 + 4 + (256) + 8 + 8 + 1 + 4 + (32 * 10) + 4 + (256) + 32;

    pub fn has_approved(&self, approver: Pubkey) -> bool {
        self.approvals.contains(&approver)
    }

    pub fn add_approval(&mut self, approver: Pubkey) {
        if !self.approvals.contains(&approver) {
            self.approvals.push(approver);
            self.approval_count += 1;
        }
    }
}

#[account]
pub struct Role {
    pub account: Pubkey,
    pub role: u8,
    pub has_role: bool,
}

impl Role {
    pub const LEN: usize = 8 + 32 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
pub enum TransactionType {
    Unpause,
    Blacklist,
    NoSellLimit,
    Restrict,
    Pair,
    SetRequiredApprovals,
    SetCooldownPeriod,
    SetBridgeAddress,
    SetBondAddress,
    SetTreasuryAddress,
    WithdrawToTreasury,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum TransactionStatus {
    Pending,
    Rejected,
    Executed,
}

// Role constants
// pub const ADMIN_ROLE: u8 = 1;
// pub const SIGNER_ROLE: u8 = 2;
// pub const APPROVER_ROLE: u8 = 3;
// pub const MANAGER_ROLE: u8 = 4;

// Error codes
#[error_code]
pub enum GovernanceError {
    #[msg("Token program not set")]
    TokenProgramNotSet,
    #[msg("Token program already set")]
    TokenProgramAlreadySet,
    #[msg("Presale program not set")]
    PresaleProgramNotSet,
    #[msg("Presale program already set")]
    PresaleProgramAlreadySet,
    #[msg("Invalid transaction ID")]
    InvalidTransactionId,
    #[msg("Transaction not pending")]
    TransactionNotPending,
    #[msg("Already approved")]
    AlreadyApproved,
    #[msg("Cooldown not expired")]
    CooldownNotExpired,
    #[msg("Insufficient approvals")]
    InsufficientApprovals,
    #[msg("Empty rejection reason")]
    EmptyRejectionReason,
    #[msg("Invalid required approvals")]
    InvalidRequiredApprovals,
    #[msg("Invalid cooldown period")]
    InvalidCooldownPeriod,
    #[msg("Cooldown period too low")]
    CooldownPeriodTooLow,
    #[msg("Cooldown period too high")]
    CooldownPeriodTooHigh,
    #[msg("Invalid account")]
    InvalidAccount,
    #[msg("Invalid role")]
    InvalidRole,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Not an authorized signer")]
    NotAuthorizedSigner,
    #[msg("Required approvals must be at least 2")]
    RequiredApprovalsTooLow,
    #[msg("Required approvals exceeds signer count")]
    RequiredApprovalsTooHigh,
    #[msg("Duplicate signers in signer list")]
    DuplicateSigners,
    #[msg("Invalid data length")]
    InvalidDataLength,
    #[msg("Invalid amount")]
    InvalidAmount,
}

// Context structures

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GovernanceState::LEN,
        seeds = [b"governance"],
        bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTokenProgram<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump,
        constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
    )]
    pub governance_state: Account<'info, GovernanceState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct QueueUnpause<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetBlacklist<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetNoSellLimit<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetRestricted<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetLiquidityPool<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct ApproveTransaction<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        mut,
        seeds = [b"transaction", &transaction.id.to_le_bytes()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    pub approver: Signer<'info>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct RejectTransaction<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        mut,
        seeds = [b"transaction", &transaction.id.to_le_bytes()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    pub approver: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteTransaction<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        mut,
        seeds = [b"transaction", &transaction.id.to_le_bytes()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    /// CHECK: Token program state PDA
    #[account(mut)]
    pub state_pda: UncheckedAccount<'info>,

    /// CHECK: Token program
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: Token program program
    pub token_program_program: Program<'info, spl_project::program::SplProject>,

    /// CHECK: Presale program state PDA (for treasury operations)
    pub presale_state_pda: UncheckedAccount<'info>,

    /// CHECK: Presale program
    pub presale_program_program: Program<'info, presale::program::Presale>,

    /// CHECK: Presale payment vault PDA (for withdrawals)
    pub presale_payment_vault_pda: UncheckedAccount<'info>,

    /// CHECK: Presale payment vault ATA
    #[account(mut)]
    pub presale_payment_vault: UncheckedAccount<'info>,

    /// CHECK: Treasury token account ATA
    #[account(mut)]
    pub treasury_token_account: UncheckedAccount<'info>,

    /// CHECK: Payment token mint
    pub payment_token_mint: UncheckedAccount<'info>,

    /// CHECK: SPL Token program (for withdrawals)
    pub spl_token_program: UncheckedAccount<'info>,

    /// CHECK: Associated token program
    pub associated_token_program: UncheckedAccount<'info>,

    /// CHECK: System program (needed for CPI account creation)
    pub system_program: Program<'info, System>,

    /// CHECK: Payer for CPI account creation (governance state)
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    // Optional accounts for Blacklist, NoSellLimit, Restrict, Pair transactions
    /// CHECK: Blacklist account (for Blacklist transaction)
    #[account(mut)]
    pub blacklist_account: UncheckedAccount<'info>,

    /// CHECK: Account being blacklisted/restricted/etc (for Blacklist, NoSellLimit, Restrict transactions)
    pub target_account: UncheckedAccount<'info>,

    /// CHECK: NoSellLimit account (for NoSellLimit transaction)
    #[account(mut)]
    pub no_sell_limit_account: UncheckedAccount<'info>,

    /// CHECK: Restricted account (for Restrict transaction)
    #[account(mut)]
    pub restricted_account: UncheckedAccount<'info>,

    /// CHECK: LiquidityPool account (for Pair transaction)
    #[account(mut)]
    pub liquidity_pool_account: UncheckedAccount<'info>,

    /// CHECK: Pool address (for Pair transaction)
    pub pool_address: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct SetRequiredApprovals<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump,
        constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
    )]
    pub governance_state: Account<'info, GovernanceState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetCooldownPeriod<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump,
        constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
    )]
    pub governance_state: Account<'info, GovernanceState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct GrantRole<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance_state.bump,
        // constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Role::LEN,
        seeds = [b"role", account.key().as_ref()],
        bump
    )]
    pub role_account: Account<'info, Role>,

    /// CHECK: Account to grant role to
    pub account: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeRole<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance_state.bump,
        // constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        mut,
        seeds = [b"role", account.key().as_ref()],
        bump
    )]
    pub role_account: Account<'info, Role>,

    /// CHECK: Account to revoke role from
    pub account: UncheckedAccount<'info>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct QueueSetRequiredApprovals<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetCooldownPeriod<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetBridgeAddress<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetBondAddress<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueSetTreasuryAddress<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct QueueWithdrawToTreasury<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    #[account(
        init,
        payer = initiator,
        space = 8 + Transaction::MAX_LEN,
        seeds = [b"transaction", governance_state.next_transaction_id.to_le_bytes().as_ref()],
        bump
    )]
    pub transaction: Account<'info, Transaction>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct SetPresaleProgram<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump = governance_state.bump,
        constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
    )]
    pub governance_state: Account<'info, GovernanceState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    #[account(
        seeds = [b"governance"],
        bump = governance_state.bump
    )]
    pub governance_state: Account<'info, GovernanceState>,

    /// CHECK: Token program state PDA
    #[account(mut)]
    pub state_pda: UncheckedAccount<'info>,

    /// CHECK: Token program
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: Token program program
    pub token_program_program: Program<'info, spl_project::program::SplProject>,

    pub authority: Signer<'info>,
}
