# Treasury Hybrid Setup - Implementation Guide

## Overview

The presale contract now implements a **hybrid treasury system** that combines the security of PDA-controlled vaults with the flexibility of settable treasury addresses.

## How It Works

### User Purchase Flow (Unchanged)

```
User → calls buy(amount) → Program → Transfers USDC to PDA Vault ATA
                                    → Transfers presale tokens to User
```

**Users still call the `buy()` function** - no changes to user experience.

### Fund Collection

- **Payment tokens (USDC/USDT/etc.)** accumulate in **PDA-controlled vault**
- Vault address is deterministic: `["presale_payment_vault_pda", presale_state, payment_mint]`
- Funds are program-controlled and secure

### Treasury Withdrawal

- **Admin/Governance** can withdraw funds from PDA vault to treasury address
- Treasury address is settable via `set_treasury_address()`
- Withdrawal requires proper authorization (admin or governance PDA)

## New Functions

### 1. `set_treasury_address(treasury_address: Pubkey)`

**Purpose:** Set or update the treasury wallet address

**Access Control:**
- Admin (if still authority)
- Governance PDA (after `set_governance()`)

**Usage:**
```rust
presale.set_treasury_address(phantom_wallet_address)
```

**Example:**
```typescript
await presaleProgram.methods
  .setTreasuryAddress(treasuryWallet)
  .accounts({
    presaleState: presaleStatePda,
    authority: admin.publicKey,
  })
  .rpc();
```

### 2. `withdraw_to_treasury(amount: u64)`

**Purpose:** Transfer payment tokens from PDA vault to treasury address

**Access Control:**
- Admin (if still authority)
- Governance PDA (after `set_governance()`)

**Requirements:**
- Treasury address must be set (not `Pubkey::default()`)
- Treasury token account (ATA) must exist for the payment token
- Sufficient balance in PDA vault

**Usage:**
```rust
presale.withdraw_to_treasury(amount)
```

**Example:**
```typescript
// Get treasury ATA for USDC
const treasuryUsdcAccount = await getAssociatedTokenAddress(
  usdcMint,
  treasuryWallet,
  true
);

await presaleProgram.methods
  .withdrawToTreasury(new BN(1000000)) // 1 USDC (6 decimals)
  .accounts({
    presaleState: presaleStatePda,
    authority: admin.publicKey,
    presalePaymentVaultPda: paymentVaultPda,
    presalePaymentVault: paymentVaultAta,
    treasuryTokenAccount: treasuryUsdcAccount,
    paymentTokenMint: usdcMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc();
```

## State Changes

### PresaleState Structure

```rust
pub struct PresaleState {
    pub admin: Pubkey,
    pub authority: Pubkey,
    pub governance: Pubkey,
    pub token_program: Pubkey,
    pub token_program_state: Pubkey,
    pub presale_token_mint: Pubkey,
    pub status: PresaleStatus,
    pub total_tokens_sold: u64,
    pub total_raised: u64,
    pub governance_set: bool,
    pub treasury_address: Pubkey, // NEW FIELD
    pub bump: u8,
}
```

**Size:** Increased by 32 bytes (one Pubkey)

## Security Model

### Current Implementation

1. **Funds Collection:** PDA-controlled (secure, program-enforced)
2. **Treasury Setting:** Admin or Governance (flexible)
3. **Withdrawals:** Admin or Governance (controlled)

### With Governance Integration

After calling `set_governance()`:
- Treasury operations require governance PDA signature
- Governance PDA is controlled by multisig (via governance contract)
- All treasury changes go through multisig approval

### Recommended Setup

1. **Initialize presale** with admin
2. **Set treasury address** to multisig wallet (e.g., Squads Protocol)
3. **Transfer authority** to governance PDA via `set_governance()`
4. **All future operations** require multisig approval through governance contract

## Error Codes

### New Errors

- `TreasuryNotSet`: Treasury address has not been set (default Pubkey)
- `InvalidTreasuryAccount`: Treasury token account doesn't match payment token mint

## Workflow Example

### Step 1: Initialize Presale
```typescript
await presaleProgram.methods
  .initialize(admin.publicKey, presaleTokenMint, tokenProgram, tokenState)
  .accounts({...})
  .rpc();
```

### Step 2: Set Treasury Address
```typescript
const treasuryWallet = new PublicKey("YourPhantomOrMultisigWallet...");

await presaleProgram.methods
  .setTreasuryAddress(treasuryWallet)
  .accounts({
    presaleState: presaleStatePda,
    authority: admin.publicKey,
  })
  .rpc();
```

### Step 3: Transfer to Governance (Optional)
```typescript
await presaleProgram.methods
  .setGovernance(governancePda)
  .accounts({
    presaleState: presaleStatePda,
    authority: admin.publicKey,
  })
  .rpc();
```

### Step 4: Users Buy Tokens
```typescript
// Users call buy() - funds go to PDA vault
await presaleProgram.methods
  .buy(new BN(1000000))
  .accounts({...})
  .rpc();
```

### Step 5: Withdraw to Treasury
```typescript
// Admin/Governance withdraws from PDA vault to treasury
await presaleProgram.methods
  .withdrawToTreasury(new BN(5000000))
  .accounts({
    presaleState: presaleStatePda,
    authority: adminOrGovernance.publicKey,
    presalePaymentVaultPda: paymentVaultPda,
    presalePaymentVault: paymentVaultAta,
    treasuryTokenAccount: treasuryAta,
    paymentTokenMint: usdcMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc();
```

## Benefits

### ✅ Security
- Funds collect in secure PDA vault
- Withdrawals require authorization
- Can use multisig for treasury operations

### ✅ Flexibility
- Treasury address can be changed
- Can use any wallet (Phantom, multisig, hardware wallet)
- Easy to view balances in standard wallets

### ✅ Transparency
- All operations on-chain
- Treasury address is public
- Easy to verify fund movements

### ✅ Control
- Admin can set initial treasury
- Governance can update treasury
- Withdrawals require proper authorization

## Future Enhancements

### Optional: Governance Queue Functions

For full multisig control, we can add to governance contract:
- `queue_set_treasury_address(treasury_address)`
- `queue_withdraw_to_treasury(amount)`

This would require:
1. Adding presale program to governance contract
2. Adding new `TransactionType` variants
3. Adding CPI calls to presale program

**Current implementation is sufficient** - governance PDA can call presale functions directly after multisig approval through governance contract.

## Testing

### Test Cases Needed

1. ✅ Set treasury address (admin)
2. ✅ Set treasury address (governance)
3. ✅ Withdraw to treasury (admin)
4. ✅ Withdraw to treasury (governance)
5. ✅ Reject withdrawal if treasury not set
6. ✅ Reject withdrawal if unauthorized
7. ✅ Reject withdrawal if insufficient balance
8. ✅ Verify funds in treasury after withdrawal

## Summary

The hybrid setup provides:
- **Secure collection** via PDA vaults
- **Flexible withdrawals** to settable treasury
- **Governance control** via multisig
- **Easy management** with standard wallets

Users experience no changes - they still call `buy()`. The treasury system is purely for fund management by admins/governance.

