# Treasury Multisig Implementation - Complete Guide

## Overview

Treasury operations (setting treasury address and withdrawing funds) now require **multisig approval** through the governance contract. This ensures that critical treasury operations are controlled by multiple authorized signers.

## Implementation Summary

### What Was Added

1. **Presale Program Integration**
   - Added presale program import to governance contract
   - Added `presale_program` and `presale_program_set` fields to `GovernanceState`
   - Added `set_presale_program()` function to link governance to presale

2. **New Transaction Types**
   - `SetTreasuryAddress`: Queue setting/updating treasury address
   - `WithdrawToTreasury`: Queue withdrawal from PDA vault to treasury

3. **Queue Functions**
   - `queue_set_treasury_address(treasury_address)`: Queue treasury address change
   - `queue_withdraw_to_treasury(amount)`: Queue withdrawal operation

4. **Execution Logic**
   - Added CPI calls to presale program in `execute_transaction()`
   - Both operations require multisig approval + cooldown period

## How It Works

### Multisig Flow for Treasury Operations

```
Step 1: Queue Transaction
  Any authorized signer → queue_set_treasury_address() or queue_withdraw_to_treasury()
  ↓
Step 2: Approve Transaction
  Multiple signers → approve_transaction() (minimum 2-of-3 required)
  ↓
Step 3: Wait for Cooldown
  Minimum 30 minutes cooldown period
  ↓
Step 4: Execute Transaction
  Any signer → execute_transaction() (auto-executes if conditions met)
  ↓
Step 5: CPI to Presale
  Governance PDA → presale.set_treasury_address() or presale.withdraw_to_treasury()
```

## Setup Instructions

### 1. Initialize Governance (if not done)

```typescript
await governanceProgram.methods
  .initialize(
    2, // required_approvals (minimum 2)
    1800, // cooldown_period (30 minutes in seconds)
    [signer1.publicKey, signer2.publicKey, signer3.publicKey] // signers
  )
  .accounts({...})
  .rpc();
```

### 2. Set Presale Program

```typescript
await governanceProgram.methods
  .setPresaleProgram(presaleProgram.programId)
  .accounts({
    governanceState: governanceStatePda,
    authority: admin.publicKey,
  })
  .rpc();
```

### 3. Set Treasury Address (via Multisig)

#### Step 3a: Queue Transaction

```typescript
const treasuryWallet = new PublicKey("YourPhantomOrMultisigWallet...");

const txId = await governanceProgram.methods
  .queueSetTreasuryAddress(treasuryWallet)
  .accounts({
    governanceState: governanceStatePda,
    initiator: signer1.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log("Transaction queued with ID:", txId);
```

#### Step 3b: Approve Transaction

```typescript
// Signer 1 approves
await governanceProgram.methods
  .approveTransaction(new BN(txId))
  .accounts({
    governanceState: governanceStatePda,
    transaction: transactionPda,
    signer: signer1.publicKey,
  })
  .signers([signer1])
  .rpc();

// Signer 2 approves (minimum 2 required)
await governanceProgram.methods
  .approveTransaction(new BN(txId))
  .accounts({
    governanceState: governanceStatePda,
    transaction: transactionPda,
    signer: signer2.publicKey,
  })
  .signers([signer2])
  .rpc();
```

#### Step 3c: Wait for Cooldown

Wait for the cooldown period (minimum 30 minutes) to pass.

#### Step 3d: Execute Transaction

```typescript
await governanceProgram.methods
  .executeTransaction(new BN(txId))
  .accounts({
    governanceState: governanceStatePda,
    transaction: transactionPda,
    presaleStatePda: presaleStatePda,
    presaleProgramProgram: presaleProgram.programId,
    // ... other accounts
  })
  .rpc();
```

### 4. Withdraw to Treasury (via Multisig)

#### Step 4a: Queue Withdrawal

```typescript
const withdrawAmount = new BN(1000000); // 1 USDC (6 decimals)

const txId = await governanceProgram.methods
  .queueWithdrawToTreasury(withdrawAmount)
  .accounts({
    governanceState: governanceStatePda,
    initiator: signer1.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

#### Step 4b-4d: Approve, Wait, Execute

Same process as setting treasury address (approve → wait → execute).

For execution, you'll need additional accounts:

```typescript
// Get required accounts
const [presalePaymentVaultPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("presale_payment_vault_pda"),
    presaleStatePda.toBuffer(),
    usdcMint.toBuffer(),
  ],
  presaleProgram.programId
);

const presalePaymentVault = await getAssociatedTokenAddress(
  usdcMint,
  presalePaymentVaultPda,
  true
);

const treasuryUsdcAccount = await getAssociatedTokenAddress(
  usdcMint,
  treasuryWallet,
  true
);

await governanceProgram.methods
  .executeTransaction(new BN(txId))
  .accounts({
    governanceState: governanceStatePda,
    transaction: transactionPda,
    presaleStatePda: presaleStatePda,
    presaleProgramProgram: presaleProgram.programId,
    presalePaymentVaultPda: presalePaymentVaultPda,
    presalePaymentVault: presalePaymentVault,
    treasuryTokenAccount: treasuryUsdcAccount,
    paymentTokenMint: usdcMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    // ... other accounts
  })
  .rpc();
```

## Account Requirements

### For `queue_set_treasury_address()`

- `governance_state`: Governance state PDA
- `transaction`: Transaction PDA (auto-created)
- `initiator`: Authorized signer
- `system_program`: System program

### For `queue_withdraw_to_treasury()`

- Same as above

### For `execute_transaction()` (SetTreasuryAddress)

- `governance_state`: Governance state PDA
- `transaction`: Transaction PDA
- `presale_state_pda`: Presale state PDA
- `presale_program_program`: Presale program
- `system_program`: System program
- `payer`: Payer account

### For `execute_transaction()` (WithdrawToTreasury)

- All accounts from SetTreasuryAddress, plus:
- `presale_payment_vault_pda`: Payment vault PDA
- `presale_payment_vault`: Payment vault ATA
- `treasury_token_account`: Treasury token account ATA
- `payment_token_mint`: Payment token mint
- `token_program`: Token program
- `associated_token_program`: Associated token program

## Security Features

### ✅ Multisig Protection

- **Minimum 2-of-3** approvals required (configurable)
- **Cooldown period** (minimum 30 minutes) prevents rushed decisions
- **Transaction queuing** allows review before execution

### ✅ Access Control

- Only authorized signers can queue transactions
- Only authorized signers can approve transactions
- Execution requires sufficient approvals + cooldown

### ✅ On-Chain Transparency

- All transactions are recorded on-chain
- Transaction history is publicly verifiable
- Approval/rejection reasons are logged

## Error Handling

### Common Errors

- `PresaleProgramNotSet`: Presale program not linked to governance
- `PresaleProgramAlreadySet`: Attempting to set presale program twice
- `InsufficientApprovals`: Not enough signers have approved
- `CooldownNotExpired`: Cooldown period hasn't passed yet
- `TransactionNotPending`: Transaction already executed or rejected

## State Changes

### GovernanceState

```rust
pub struct GovernanceState {
    pub authority: Pubkey,
    pub required_approvals: u8,
    pub cooldown_period: i64,
    pub next_transaction_id: u64,
    pub token_program: Pubkey,
    pub token_program_set: bool,
    pub presale_program: Pubkey,        // NEW
    pub presale_program_set: bool,     // NEW
    pub bump: u8,
    pub signers: Vec<Pubkey>,
}
```

**Size:** Increased by 33 bytes (32 bytes for Pubkey + 1 byte for bool)

## Transaction Types

### SetTreasuryAddress

- **Data:** 32 bytes (treasury address Pubkey)
- **Target:** Treasury address
- **CPI Call:** `presale::set_treasury_address()`

### WithdrawToTreasury

- **Data:** 8 bytes (amount as u64)
- **Target:** Not used (Pubkey::default())
- **CPI Call:** `presale::withdraw_to_treasury()`

## Best Practices

### 1. Use Multisig Wallet for Treasury

Set treasury address to a multisig wallet (e.g., Squads Protocol) for additional security.

### 2. Set Appropriate Cooldown

Use a cooldown period that allows for review (recommended: 1-24 hours for large withdrawals).

### 3. Monitor Transactions

Regularly check queued transactions and approve/reject as needed.

### 4. Document Decisions

Use rejection reasons to document why transactions were rejected.

### 5. Test First

Test treasury operations on devnet before mainnet deployment.

## Comparison: Before vs After

### Before (Direct Call)

```
Admin → presale.set_treasury_address() ✅ (immediate, no approval)
Admin → presale.withdraw_to_treasury() ✅ (immediate, no approval)
```

### After (Multisig Required)

```
Signer 1 → queue_set_treasury_address()
Signer 1 → approve_transaction()
Signer 2 → approve_transaction()
[Wait 30+ minutes]
Any Signer → execute_transaction() → presale.set_treasury_address() ✅
```

## Summary

✅ **Treasury operations now require multisig approval**
✅ **Queue → Approve → Wait → Execute flow**
✅ **Minimum 2-of-3 signers required**
✅ **30+ minute cooldown period**
✅ **On-chain transparency and auditability**

All treasury operations are now fully controlled by the multisig governance system, providing maximum security and decentralization.

