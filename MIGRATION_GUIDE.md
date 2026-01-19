# Presale Pricing Migration Guide

This guide explains how to migrate your existing deployed presale contract to include the new pricing functionality (`tokens_per_sol` field).

## Overview

The presale contract has been updated to support dynamic pricing:
- Added `tokens_per_sol` field to `PresaleState` (stores how many NC tokens per 1 SOL)
- Updated `buy_with_sol` to use the new pricing calculation
- Added `set_token_rate` function for admin to update pricing
- Added `migrate_presale_state` function to migrate existing contracts

## Migration Steps

### Step 1: Build and Deploy Updated Program

1. **Build the updated program:**
   ```bash
   anchor build
   ```

2. **Deploy the updated program:**
   ```bash
   anchor deploy --provider.cluster devnet  # or mainnet-beta
   ```

   Or if you have a custom deploy script:
   ```bash
   anchor deploy --program-name presale
   ```

3. **Verify deployment:**
   ```bash
   solana program show <PROGRAM_ID>
   ```

### Step 2: Run Migration Script

The migration script will:
- Reallocate the `PresaleState` account to include the new `tokens_per_sol` field
- Set the initial `tokens_per_sol` value

**Option A: Using Anchor Script (Recommended)**

```bash
# Using default rate (133,000 NC tokens per SOL)
anchor run migrate-presale-pricing

# Or with custom rate
TOKENS_PER_SOL=133000000000000 anchor run migrate-presale-pricing
```

**Option B: Using TypeScript directly**

```bash
# Using default rate
ts-node scripts/migrate-presale-pricing.ts

# Or with custom rate
TOKENS_PER_SOL=133000000000000 ts-node scripts/migrate-presale-pricing.ts
```

### Step 3: Verify Migration

After running the migration, verify it worked:

```bash
# Check the presale state
anchor run check-presale-state
```

Or manually check:
```typescript
const state = await presaleProgram.account.presaleState.fetch(presaleStatePda);
console.log("tokens_per_sol:", state.tokensPerSol.toString());
```

## Pricing Calculation

### Example Setup

If you want to set:
- **NC Token price:** $0.001
- **SOL price:** $133

Then:
```
tokens_per_sol = $133 / $0.001 = 133,000 NC tokens per SOL
```

If your NC token has 9 decimals:
```
tokens_per_sol = 133,000 × 10^9 = 133,000,000,000,000
```

### How It Works

When a user sends 1 SOL (1,000,000,000 lamports):
```
Tokens = (sol_amount × tokens_per_sol) / LAMPORTS_PER_SOL
Tokens = (1,000,000,000 × 133,000,000,000,000) / 1,000,000,000
Tokens = 133,000,000,000,000 base units
Tokens = 133,000 NC tokens
```

## Updating Pricing After Migration

After migration, you can update the pricing using the `set_token_rate` function:

```typescript
await presaleProgram.methods
  .setTokenRate(new anchor.BN(133000000000000))
  .accounts({
    presaleState: presaleStatePda,
    authority: admin.publicKey,
  })
  .rpc();
```

## Important Notes

### 1. Account Reallocation

The migration uses Solana's `realloc` feature to expand the `PresaleState` account. This:
- Requires the account owner (authority) to pay for additional rent
- Is a one-time operation per account
- Automatically handled by the migration script

### 2. Authority Requirements

The migration can only be performed by:
- The current `authority` (admin)
- Or the `governance` PDA (if governance has been set)

### 3. Backward Compatibility

- Existing `buy_with_sol` calls will fail until migration is complete (tokens_per_sol will be 0)
- The migration script checks if already migrated and allows updates
- New `initialize` calls require `initial_tokens_per_sol` parameter

### 4. Testing

Before migrating on mainnet:
1. Test on devnet first
2. Verify the migration script works
3. Test `buy_with_sol` after migration
4. Test `set_token_rate` to update pricing

## Troubleshooting

### Error: "Unauthorized"

**Solution:** Ensure your wallet is the current `authority` or `governance`:
```typescript
const state = await presaleProgram.account.presaleState.fetch(presaleStatePda);
console.log("Authority:", state.authority.toString());
console.log("Governance:", state.governance.toString());
```

### Error: "Account reallocation failed"

**Solution:** Ensure the authority wallet has enough SOL to pay for rent:
```bash
solana balance <AUTHORITY_WALLET>
```

### Error: "tokens_per_sol is 0"

**Solution:** This means migration hasn't been run. Run the migration script.

### Error: "InvalidAmount" in buy_with_sol

**Solution:** Ensure `tokens_per_sol` is set (migration completed) and greater than 0.

## Post-Migration Checklist

- [ ] Program deployed successfully
- [ ] Migration script executed successfully
- [ ] `tokens_per_sol` field is set (verify with `check-presale-state`)
- [ ] Test `buy_with_sol` with a small amount
- [ ] Verify token calculation is correct
- [ ] Test `set_token_rate` to update pricing
- [ ] Update any frontend/client code to use new pricing

## Example Migration Output

```
🔄 Starting Presale Pricing Migration...

======================================================================
📋 Configuration:
   Network: https://api.devnet.solana.com
   Wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

📦 Presale Program ID: 4wdP1DAqMq2F9TjGuodu3axSyJZcNcgTzT7eVp5JQKFN

✅ Loaded presale state PDA from deployment info: ...

📊 Fetching current presale state...
   ✅ Presale state found
   Admin: ...
   Authority: ...
   Status: NotStarted
   Current tokens_per_sol: 0 (not set)

🔐 Authorization:
   Wallet: ...
   ✅ Authorized as Admin

🚀 Executing migration...
   This will:
   1. Reallocate PresaleState account to include tokens_per_sol field
   2. Set tokens_per_sol to: 133000000000000

   ✅ Migration transaction: ...

🔍 Verifying migration...
   ✅ Migration successful!
   New tokens_per_sol: 133000000000000

📊 Example Calculation:
   For 1 SOL (1,000,000,000 lamports):
   Tokens = (1,000,000,000 × 133000000000000) / 1,000,000,000
   Tokens = 133000000000000 base units

======================================================================
✅ Migration completed successfully!
======================================================================
```

## Support

If you encounter issues:
1. Check the program logs in the migration output
2. Verify your wallet has sufficient SOL
3. Ensure you're using the correct authority wallet
4. Test on devnet before mainnet

