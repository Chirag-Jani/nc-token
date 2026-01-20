# Changelog - Bridge & Bond Address Configuration

## Overview

This update adds the ability to configure Bridge and Bond contract addresses after token deployment. These addresses are set through the governance multisig system, ensuring secure and controlled updates.

## Date: Latest Update

---

## Changes Summary

### 🎯 Problem Solved

- **Issue**: Bridge and Bond contracts are deployed **after** the token contract
- **Solution**: Added setter functions that can be called by governance to configure these addresses post-deployment
- **Security**: All changes require multisig approval and cooldown period

---

## 📝 Detailed Changes

### 1. Token Contract (`programs/spl-project/src/lib.rs`)

#### 1.1 Added Storage Fields

**Location**: ```492:500:programs/spl-project/src/lib.rs```

```rust
pub struct TokenState {
    pub authority: Pubkey,
    pub bump: u8,
    pub emergency_paused: bool,
    pub sell_limit_percent: u8,
    pub sell_limit_period: u64,
    pub bridge_address: Pubkey, // NEW: Bridge contract address
    pub bond_address: Pubkey,   // NEW: Bond contract address
}
```

**What Changed**:
- Added `bridge_address: Pubkey` field to store bridge contract address
- Added `bond_address: Pubkey` field to store bond contract address
- Updated `TokenState::LEN` from `8 + 32 + 1 + 1 + 1 + 8` to `8 + 32 + 1 + 1 + 1 + 8 + 32 + 32` (added 64 bytes)

**Why**: These addresses need to be stored in the token state for reference by other contracts and operations.

---

#### 1.2 Updated Initialization

**Location**: ```28:40:programs/spl-project/src/lib.rs```

```rust
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let state = &mut ctx.accounts.state;
    state.authority = ctx.accounts.authority.key();
    state.bump = ctx.bumps.state;
    state.emergency_paused = false;
    state.sell_limit_percent = 10;
    state.sell_limit_period = 86400;
    state.bridge_address = Pubkey::default(); // NEW: Initialize to default
    state.bond_address = Pubkey::default();  // NEW: Initialize to default
    Ok(())
}
```

**What Changed**:
- Initialize `bridge_address` and `bond_address` to `Pubkey::default()` since they're not known at deployment time

**Why**: These contracts deploy after the token, so we initialize with default values that will be set later by governance.

---

#### 1.3 Added Setter Functions

**Location**: ```146:184:programs/spl-project/src/lib.rs```

**New Function 1: `set_bridge_address`**
```rust
pub fn set_bridge_address(
    ctx: Context<SetBridgeAddress>,
    bridge_address: Pubkey,
) -> Result<()> {
    let state = &mut ctx.accounts.state;
    require!(
        state.authority == ctx.accounts.governance.key(),
        TokenError::Unauthorized
    );
    let old_bridge = state.bridge_address;
    state.bridge_address = bridge_address;
    msg!("Bridge address updated from {:?} to {:?}", old_bridge, bridge_address);
    Ok(())
}
```

**New Function 2: `set_bond_address`**
```rust
pub fn set_bond_address(
    ctx: Context<SetBondAddress>,
    bond_address: Pubkey,
) -> Result<()> {
    let state = &mut ctx.accounts.state;
    require!(
        state.authority == ctx.accounts.governance.key(),
        TokenError::Unauthorized
    );
    let old_bond = state.bond_address;
    state.bond_address = bond_address;
    msg!("Bond address updated from {:?} to {:?}", old_bond, bond_address);
    Ok(())
}
```

**What Changed**:
- Added two new functions that allow governance to update bridge and bond addresses
- Both functions verify that the caller is the governance authority
- Both log the old and new addresses for transparency

**Why**: These functions provide the mechanism for governance to configure addresses after deployment.

**Security**: Only governance (the authority set in `TokenState`) can call these functions.

---

#### 1.4 Secured Mint/Burn Functions

**Location**: ```186:220:programs/spl-project/src/lib.rs```

**Before**: No authorization check
```rust
pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    // No authorization check - anyone could call this!
    msg!("Minting {} tokens", amount);
    // ... mint logic
}
```

**After**: Governance authorization required
```rust
pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    let state = &ctx.accounts.state;
    
    // NEW: Verify governance authorization
    require!(
        state.authority == ctx.accounts.governance.key(),
        TokenError::Unauthorized
    );
    
    msg!("Minting {} tokens", amount);
    // ... mint logic
}
```

**Location**: ```222:240:programs/spl-project/src/lib.rs```

Similar changes applied to `burn_tokens` function.

**What Changed**:
- Added governance authorization check to `mint_tokens()`
- Added governance authorization check to `burn_tokens()`
- Updated `MintTokens` and `BurnTokens` context structures to include governance signer

**Why**: Mint and burn operations should only be performed by governance to prevent unauthorized token creation or destruction.

---

#### 1.5 Added Context Structures

**Location**: ```738:762:programs/spl-project/src/lib.rs```

```rust
#[derive(Accounts)]
pub struct SetBridgeAddress<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.authority == governance.key() @ TokenError::Unauthorized
    )]
    pub state: Account<'info, TokenState>,
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
    pub governance: Signer<'info>,
}
```

**What Changed**:
- Added two new context structures for the setter functions
- Both validate that the governance signer matches the state authority

**Why**: These structures define the accounts required for the setter functions and enforce security constraints.

---

### 2. Governance Contract (`programs/governance/src/lib.rs`)

#### 2.1 Added Transaction Types

**Location**: ```779:791:programs/governance/src/lib.rs```

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
pub enum TransactionType {
    Unpause,
    Blacklist,
    NoSellLimit,
    Restrict,
    Pair,
    SetRequiredApprovals,
    SetCooldownPeriod,
    SetBridgeAddress,  // NEW
    SetBondAddress,    // NEW
}
```

**What Changed**:
- Added `SetBridgeAddress` to transaction type enum
- Added `SetBondAddress` to transaction type enum

**Why**: These types are used to identify and route transactions in the governance queue system.

---

#### 2.2 Added Queue Functions

**Location**: ```291:331:programs/governance/src/lib.rs```

**New Function 1: `queue_set_bridge_address`**
```rust
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

    msg!("Transaction {} queued (set bridge address: {}), will execute after {}", 
         tx_id, bridge_address, execute_after);
    Ok(tx_id)
}
```

**New Function 2: `queue_set_bond_address`**
```rust
pub fn queue_set_bond_address(
    ctx: Context<QueueSetBondAddress>,
    bond_address: Pubkey,
) -> Result<u64> {
    // Similar implementation to queue_set_bridge_address
}
```

**What Changed**:
- Added function to queue bridge address updates
- Added function to queue bond address updates
- Both functions create a transaction with cooldown period
- Both encode the address in transaction data

**Why**: These functions allow super admin to propose address changes, which then require multisig approval and cooldown before execution.

**Security Features**:
- Requires token program to be set
- Creates transaction with cooldown period
- Requires multisig approval before execution

---

#### 2.3 Added Execution Logic

**Location**: ```689:730:programs/governance/src/lib.rs```

```rust
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
    // Similar implementation for bond address
}
```

**What Changed**:
- Added execution case for `SetBridgeAddress` transaction type
- Added execution case for `SetBondAddress` transaction type
- Both decode the address from transaction data
- Both make CPI calls to token contract's setter functions
- Both use governance PDA for signing

**Why**: After cooldown and approvals, these cases execute the actual address updates via Cross-Program Invocation (CPI).

**Security**: Uses governance PDA to sign CPI calls, ensuring only approved transactions execute.

---

#### 2.4 Added Context Structures

**Location**: ```1329:1350:programs/governance/src/lib.rs```

```rust
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
    // Similar structure
}
```

**What Changed**:
- Added context structure for queueing bridge address updates
- Added context structure for queueing bond address updates

**Why**: These structures define the accounts required for queue operations and ensure proper account initialization.

---

## 🔄 Complete Flow

### Step-by-Step Process

1. **Token Contract Deployment**
   - Token contract is deployed
   - `bridge_address` and `bond_address` initialized to `Pubkey::default()`

2. **Bridge & Bond Contracts Deployment** (Later)
   - Bridge contract deployed → get its address
   - Bond contract deployed → get its address

3. **Super Admin Queues Transaction**
   ```rust
   // Queue bridge address update
   governance.queue_set_bridge_address(bridge_address);
   
   // Queue bond address update
   governance.queue_set_bond_address(bond_address);
   ```

4. **Multisig Approval Process**
   - Multiple signers approve the transactions
   - Requires minimum approvals (default: 2-of-3)

5. **Cooldown Period**
   - Wait for cooldown to expire (default: 30 minutes minimum)

6. **Auto-Execution**
   - After cooldown and approvals, transaction executes automatically
   - Governance makes CPI call to token contract
   - Bridge/Bond addresses updated in token state

---

## 🔒 Security Features

### Authorization
- ✅ Only governance can set bridge/bond addresses
- ✅ Only governance can mint/burn tokens
- ✅ All changes require multisig approval

### Multisig Protection
- ✅ Minimum 2 approvals required (configurable)
- ✅ Cooldown period prevents immediate execution
- ✅ Transaction can be rejected by any signer

### Audit Trail
- ✅ All address changes logged with old and new values
- ✅ Transaction history maintained in governance state
- ✅ Initiator and approvers tracked

---

## 📊 Code References

### Token Contract Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `set_bridge_address` | ```146:164:programs/spl-project/src/lib.rs``` | Set bridge contract address |
| `set_bond_address` | ```166:184:programs/spl-project/src/lib.rs``` | Set bond contract address |
| `mint_tokens` | ```186:220:programs/spl-project/src/lib.rs``` | Mint tokens (governance only) |
| `burn_tokens` | ```222:240:programs/spl-project/src/lib.rs``` | Burn tokens (governance only) |

### Token Contract Structures

| Structure | Location | Purpose |
|-----------|----------|---------|
| `TokenState` | ```492:500:programs/spl-project/src/lib.rs``` | State storage with bridge/bond fields |
| `SetBridgeAddress` | ```738:748:programs/spl-project/src/lib.rs``` | Context for bridge address setter |
| `SetBondAddress` | ```752:762:programs/spl-project/src/lib.rs``` | Context for bond address setter |

### Governance Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `queue_set_bridge_address` | ```291:331:programs/governance/src/lib.rs``` | Queue bridge address update |
| `queue_set_bond_address` | ```334:374:programs/governance/src/lib.rs``` | Queue bond address update |
| `execute_transaction` (SetBridgeAddress) | ```689:710:programs/governance/src/lib.rs``` | Execute bridge address update |
| `execute_transaction` (SetBondAddress) | ```711:732:programs/governance/src/lib.rs``` | Execute bond address update |

### Governance Structures

| Structure | Location | Purpose |
|-----------|----------|---------|
| `TransactionType` | ```779:791:programs/governance/src/lib.rs``` | Enum with new transaction types |
| `QueueSetBridgeAddress` | ```1329:1350:programs/governance/src/lib.rs``` | Context for queueing bridge update |
| `QueueSetBondAddress` | ```1352:1373:programs/governance/src/lib.rs``` | Context for queueing bond update |

---

## 🚀 Usage Examples

### Setting Bridge Address via Governance

```typescript
// 1. Queue the transaction
const txId = await governance.methods
  .queueSetBridgeAddress(bridgeAddress)
  .accounts({
    governanceState: governanceStatePDA,
    transaction: transactionPDA,
    initiator: admin.publicKey,
    systemProgram: SystemProgram.programId,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();

// 2. Get signers to approve
await governance.methods
  .approveTransaction(txId)
  .accounts({
    governanceState: governanceStatePDA,
    transaction: transactionPDA,
    approver: signer1.publicKey,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .signers([signer1])
  .rpc();

// 3. After cooldown and approvals, transaction auto-executes
// Or manually execute:
await governance.methods
  .executeTransaction(txId)
  .accounts({
    governanceState: governanceStatePDA,
    transaction: transactionPDA,
    statePda: tokenStatePDA,
    tokenProgram: tokenProgramId,
    tokenProgramProgram: tokenProgramId,
    payer: governanceStatePDA,
    systemProgram: SystemProgram.programId,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
```

### Direct Call (Governance Only)

```typescript
// Only works if governance is the direct signer
await tokenProgram.methods
  .setBridgeAddress(bridgeAddress)
  .accounts({
    state: tokenStatePDA,
    governance: governancePDA,
  })
  .rpc();
```

---

## ⚠️ Important Notes

### Upgradability

Solana programs are **upgradable by default**. The upgrade authority should be set to:
- Governance PDA (multisig), or
- A multisig wallet

This is configured at **deployment time**, not in the contract code.

### Migration Considerations

If upgrading an existing deployment:
1. The `TokenState` account size has increased by 64 bytes
2. Existing accounts will need to be migrated or reinitialized
3. Bridge and bond addresses will be `Pubkey::default()` until set by governance

### Default Values

- `bridge_address` and `bond_address` are initialized to `Pubkey::default()`
- These should be set by governance after bridge/bond contracts are deployed
- Contracts should check for `Pubkey::default()` to determine if addresses are set

---

## 📋 Testing Checklist

- [ ] Token contract initializes with default bridge/bond addresses
- [ ] Governance can queue bridge address update
- [ ] Governance can queue bond address update
- [ ] Multisig approval required for execution
- [ ] Cooldown period enforced
- [ ] CPI calls execute correctly
- [ ] Addresses update in token state
- [ ] Mint/burn functions require governance authorization
- [ ] Unauthorized calls are rejected

---

## 🔗 Related Files

- `programs/spl-project/src/lib.rs` - Token contract implementation
- `programs/governance/src/lib.rs` - Governance contract implementation
- `README.md` - Main project documentation

---

## 📝 Summary

This update adds the ability to configure Bridge and Bond contract addresses after token deployment through a secure governance process. All changes require multisig approval and cooldown periods, ensuring controlled and secure updates to critical contract addresses.

**Key Benefits**:
- ✅ Flexible deployment order (token can deploy before bridge/bond)
- ✅ Secure updates via multisig governance
- ✅ Audit trail for all changes
- ✅ Enhanced security for mint/burn operations

