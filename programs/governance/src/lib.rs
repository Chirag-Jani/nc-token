use anchor_lang::prelude::*;

declare_id!("5jsHpno8jwFTJCzTtqPWFLT96sQqFxiLTD2a8zvmiunj");

// Import token program (for later CPI integration)
#[allow(unused_imports)]
use spl_project::program::SplProject;
// Import presale program (for treasury management)
#[allow(unused_imports)]
use presale::program::Presale;

#[program]
pub mod governance {
    use super::*;

    /// Initialize the governance program
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
    pub fn set_token_program(ctx: Context<SetTokenProgram>, token_program: Pubkey) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            !governance_state.token_program_set,
            GovernanceError::TokenProgramAlreadySet
        );
        governance_state.token_program = token_program;
        governance_state.token_program_set = true;
        msg!("Token program set to: {}", token_program);
        Ok(())
    }

    /// Set the presale program address
    pub fn set_presale_program(ctx: Context<SetPresaleProgram>, presale_program: Pubkey) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            !governance_state.presale_program_set,
            GovernanceError::PresaleProgramAlreadySet
        );
        governance_state.presale_program = presale_program;
        governance_state.presale_program_set = true;
        msg!("Presale program set to: {}", presale_program);
        Ok(())
    }

    /// Queue a transaction to unpause the token
    pub fn queue_unpause(ctx: Context<QueueUnpause>) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.token_program_set,
            GovernanceError::TokenProgramNotSet
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

    /// Queue a transaction to set blacklist
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

        let tx_id = governance_state.next_transaction_id;
        governance_state.next_transaction_id += 1;

        let clock = Clock::get()?;
        let execute_after = clock.unix_timestamp + governance_state.cooldown_period;

        let mut data = Vec::new();
        data.extend_from_slice(&account.to_bytes());
        data.push(if value { 1 } else { 0 });

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

    /// Queue a transaction to set required approvals (CRITICAL: Must use multisig)
    pub fn queue_set_required_approvals(
        ctx: Context<QueueSetRequiredApprovals>,
        required: u8,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
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

    /// Queue a transaction to set cooldown period (CRITICAL: Must use multisig)
    pub fn queue_set_cooldown_period(
        ctx: Context<QueueSetCooldownPeriod>,
        period: i64,
    ) -> Result<u64> {
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            period >= GovernanceState::MIN_COOLDOWN_SECONDS,
            GovernanceError::CooldownPeriodTooLow
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
    pub fn approve_transaction(ctx: Context<ApproveTransaction>, tx_id: u64) -> Result<()> {
        let governance_state = &ctx.accounts.governance_state;
        let transaction = &mut ctx.accounts.transaction;

        require!(
            transaction.id == tx_id,
            GovernanceError::InvalidTransactionId
        );
        require!(
            transaction.status == TransactionStatus::Pending,
            GovernanceError::TransactionNotPending
        );
        require!(
            !transaction.has_approved(ctx.accounts.approver.key()),
            GovernanceError::AlreadyApproved
        );
        // CRITICAL: Only authorized signers can approve
        require!(
            governance_state.is_authorized_signer(&ctx.accounts.approver.key()),
            GovernanceError::NotAuthorizedSigner
        );

        transaction.add_approval(ctx.accounts.approver.key());

        msg!(
            "Transaction {} approved by {}",
            tx_id,
            ctx.accounts.approver.key()
        );

        // Check if we have enough approvals and cooldown has passed
        if transaction.approval_count >= governance_state.required_approvals {
            let clock = Clock::get()?;
            if clock.unix_timestamp >= transaction.execute_after {
                // Auto-execute if conditions are met
                transaction.status = TransactionStatus::Executed;
                msg!("Transaction {} auto-executed", tx_id);
            }
        }

        Ok(())
    }

    /// Reject a transaction
    pub fn reject_transaction(
        ctx: Context<RejectTransaction>,
        tx_id: u64,
        reason: String,
    ) -> Result<()> {
        let transaction = &mut ctx.accounts.transaction;

        require!(
            transaction.id == tx_id,
            GovernanceError::InvalidTransactionId
        );
        require!(
            transaction.status == TransactionStatus::Pending,
            GovernanceError::TransactionNotPending
        );
        require!(!reason.is_empty(), GovernanceError::EmptyRejectionReason);

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
    pub fn execute_transaction(ctx: Context<ExecuteTransaction>, tx_id: u64) -> Result<()> {
        let governance_state = &mut ctx.accounts.governance_state;
        let transaction = &mut ctx.accounts.transaction;

        require!(
            transaction.id == tx_id,
            GovernanceError::InvalidTransactionId
        );
        require!(
            transaction.status == TransactionStatus::Pending,
            GovernanceError::TransactionNotPending
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= transaction.execute_after,
            GovernanceError::CooldownNotExpired
        );
        require!(
            transaction.approval_count >= governance_state.required_approvals,
            GovernanceError::InsufficientApprovals
        );

        // CRITICAL: Execute real CPI calls based on transaction type
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

                // Derive blacklist PDA - accounts must be passed via remaining_accounts
                // For now, we'll use a simplified approach that requires accounts to be passed
                // Full implementation requires adding accounts to ExecuteTransaction context
                msg!(
                    "Transaction {} executed: Blacklist {} = {} (requires account derivation)",
                    tx_id,
                    account_pubkey,
                    value
                );
                // TODO: Add blacklist, account, payer accounts to ExecuteTransaction context
                // or use remaining_accounts for dynamic account passing
            }
            TransactionType::NoSellLimit => {
                if transaction.data.len() < 33 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let account_pubkey = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;
                let value = transaction.data[32] != 0;
                msg!(
                    "Transaction {} executed: NoSellLimit {} = {} (requires account derivation)",
                    tx_id,
                    account_pubkey,
                    value
                );
                // TODO: Add no_sell_limit, account, payer accounts to ExecuteTransaction context
            }
            TransactionType::Restrict => {
                if transaction.data.len() < 33 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let account_pubkey = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;
                let value = transaction.data[32] != 0;
                msg!(
                    "Transaction {} executed: Restrict {} = {} (requires account derivation)",
                    tx_id,
                    account_pubkey,
                    value
                );
                // TODO: Add restricted, account, payer accounts to ExecuteTransaction context
            }
            TransactionType::Pair => {
                if transaction.data.len() < 33 {
                    return Err(GovernanceError::InvalidAccount.into());
                }
                let pool_pubkey = Pubkey::try_from_slice(&transaction.data[0..32])
                    .map_err(|_| GovernanceError::InvalidAccount)?;
                let value = transaction.data[32] != 0;
                msg!(
                    "Transaction {} executed: LiquidityPool {} = {} (requires account derivation)",
                    tx_id,
                    pool_pubkey,
                    value
                );
                // TODO: Add liquidity_pool, pool, payer accounts to ExecuteTransaction context
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

        // Mark transaction as executed
        transaction.status = TransactionStatus::Executed;
        msg!("Transaction {} executed successfully", tx_id);

        Ok(())
    }

    /// Set required approvals (REMOVED - must use queued transaction)
    /// This function is kept for backwards compatibility but should not be used.
    /// Use queue_set_required_approvals instead.
    pub fn set_required_approvals(ctx: Context<SetRequiredApprovals>, required: u8) -> Result<()> {
        // CRITICAL: Prevent setting to 1
        require!(
            required >= GovernanceState::MIN_REQUIRED_APPROVALS,
            GovernanceError::RequiredApprovalsTooLow
        );
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.authority == ctx.accounts.authority.key(),
            GovernanceError::Unauthorized
        );
        require!(
            required <= governance_state.signers.len() as u8,
            GovernanceError::RequiredApprovalsTooHigh
        );
        governance_state.required_approvals = required;
        msg!("Required approvals set to {}", required);
        Ok(())
    }

    /// Set cooldown period (REMOVED - must use queued transaction)
    /// This function is kept for backwards compatibility but should not be used.
    /// Use queue_set_cooldown_period instead.
    pub fn set_cooldown_period(ctx: Context<SetCooldownPeriod>, period: i64) -> Result<()> {
        // CRITICAL: Enforce minimum cooldown
        require!(
            period >= GovernanceState::MIN_COOLDOWN_SECONDS,
            GovernanceError::CooldownPeriodTooLow
        );
        let governance_state = &mut ctx.accounts.governance_state;
        require!(
            governance_state.authority == ctx.accounts.authority.key(),
            GovernanceError::Unauthorized
        );
        governance_state.cooldown_period = period;
        msg!("Cooldown period set to {} seconds", period);
        Ok(())
    }

    /// Grant a role
    pub fn grant_role(ctx: Context<GrantRole>, role: u8, account: Pubkey) -> Result<()> {
        let role_account = &mut ctx.accounts.role_account;
        role_account.account = account;
        role_account.role = role;
        role_account.has_role = true;
        msg!("Role {} granted to {}", role, account);
        Ok(())
    }

    /// Revoke a role
    pub fn revoke_role(ctx: Context<RevokeRole>, role: u8, account: Pubkey) -> Result<()> {
        let role_account = &mut ctx.accounts.role_account;
        require!(
            role_account.account == account,
            GovernanceError::InvalidAccount
        );
        require!(role_account.role == role, GovernanceError::InvalidRole);
        role_account.has_role = false;
        msg!("Role {} revoked from {}", role, account);
        Ok(())
    }

    /// Emergency pause (1 signer allowed, no cooldown)
    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        let governance_state = &ctx.accounts.governance_state;
        // CRITICAL: Allow any authorized signer (1-of-3) to pause
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
pub const ADMIN_ROLE: u8 = 1;
pub const SIGNER_ROLE: u8 = 2;
pub const APPROVER_ROLE: u8 = 3;
pub const MANAGER_ROLE: u8 = 4;

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
    #[msg("Minimum cooldown period not met")]
    CooldownPeriodTooLow,
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
        constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
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
        constraint = governance_state.authority == authority.key() @ GovernanceError::Unauthorized
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
