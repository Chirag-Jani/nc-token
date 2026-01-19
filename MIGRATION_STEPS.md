# Quick Migration Steps for Presale Pricing Update

## Overview

This document provides step-by-step instructions to migrate your **already deployed** presale contract to include the new pricing functionality.

## Prerequisites

- ✅ Updated presale program code (already done)
- ✅ Access to the authority wallet (admin or governance)
- ✅ Sufficient SOL in authority wallet for account reallocation rent

## Step-by-Step Migration

### Step 1: Build the Updated Program

```bash
# Build the updated presale program
anchor build
```

This compiles the updated program with the new `tokens_per_sol` field and pricing logic.

### Step 2: Deploy the Updated Program

**⚠️ IMPORTANT:** You're updating an existing program, so you need to deploy to the same program ID.

```bash
# For devnet
anchor deploy --provider.cluster devnet --program-name presale

# For mainnet (be very careful!)
anchor deploy --provider.cluster mainnet-beta --program-name presale
```

**Alternative:** If you have a custom deploy script:
```bash
# Make sure your deploy script uses the same program keypair
anchor deploy --program-name presale
```

**Verify deployment:**
```bash
solana program show <YOUR_PRESALE_PROGRAM_ID>
```

You should see the updated program data and bytecode.

### Step 3: Run the Migration Script

The migration script will:
1. Reallocate the `PresaleState` account to include the new field
2. Set the initial `tokens_per_sol` value

**Using Anchor script (recommended):**
```bash
# Using default rate (133,000 NC tokens per SOL)
anchor run migrate-presale-pricing

# Or with custom rate
TOKENS_PER_SOL=133000000000000 anchor run migrate-presale-pricing
```

**Using TypeScript directly:**
```bash
# Using default rate
ts-node scripts/migrate-presale-pricing.ts

# Or with custom rate
TOKENS_PER_SOL=133000000000000 ts-node scripts/migrate-presale-pricing.ts
```

**For mainnet, specify the cluster:**
```bash
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com anchor run migrate-presale-pricing
```

### Step 4: Verify Migration

After migration, verify it worked:

```bash
# Check presale state
anchor run check-presale-state
```

Or manually verify:
```typescript
const state = await presaleProgram.account.presaleState.fetch(presaleStatePda);
console.log("tokens_per_sol:", state.tokensPerSol.toString());
```

The `tokens_per_sol` should be set to your specified value (default: 133000000000000).

### Step 5: Test the Updated Functionality

Test that `buy_with_sol` now works with the new pricing:

```typescript
// Test buying with SOL
await presaleProgram.methods
  .buyWithSol(new anchor.BN(1_000_000_000)) // 1 SOL
  .accounts({
    presaleState: presaleStatePda,
    // ... other accounts
  })
  .rpc();

// Verify tokens received match expected calculation
// Expected: (1 SOL × tokens_per_sol) / LAMPORTS_PER_SOL
```

## Pricing Configuration

### Default Configuration

The default rate is set to **133,000 NC tokens per SOL**, which assumes:
- NC Token price: $0.001
- SOL price: $133
- Calculation: $133 / $0.001 = 133,000 tokens per SOL

### Custom Configuration

To set a custom rate, calculate:

```
tokens_per_sol = (SOL_price / NC_token_price) × 10^decimals
```

**Example:**
- NC Token: $0.0005
- SOL: $150
- Decimals: 9
- Rate: ($150 / $0.0005) × 10^9 = 300,000 × 10^9 = 300_000_000_000_000

Then use:
```bash
TOKENS_PER_SOL=300000000000000 anchor run migrate-presale-pricing
```

### Updating Pricing After Migration

After migration, you can update the rate anytime:

```typescript
await presaleProgram.methods
  .setTokenRate(new anchor.BN(300000000000000))
  .accounts({
    presaleState: presaleStatePda,
    authority: admin.publicKey,
  })
  .rpc();
```

## Troubleshooting

### Error: "Unauthorized"

**Problem:** Your wallet is not the authority.

**Solution:**
1. Check current authority:
   ```typescript
   const state = await presaleProgram.account.presaleState.fetch(presaleStatePda);
   console.log("Authority:", state.authority.toString());
   ```
2. Use the correct wallet:
   ```bash
   # Set wallet path
   export ANCHOR_WALLET=/path/to/authority/wallet.json
   anchor run migrate-presale-pricing
   ```

### Error: "Insufficient funds for account reallocation"

**Problem:** Authority wallet doesn't have enough SOL for rent.

**Solution:**
1. Check balance:
   ```bash
   solana balance <AUTHORITY_WALLET>
   ```
2. Airdrop (devnet only):
   ```bash
   solana airdrop 2 <AUTHORITY_WALLET> --url devnet
   ```
3. Transfer SOL to authority wallet if needed.

### Error: "Account already in use" during deploy

**Problem:** Program is already deployed.

**Solution:** This is normal if updating. The migration script will handle the account update.

### Error: "tokens_per_sol is 0" in buy_with_sol

**Problem:** Migration hasn't been completed.

**Solution:** Run the migration script (Step 3).

## Post-Migration Checklist

- [ ] Program built successfully
- [ ] Program deployed to correct program ID
- [ ] Migration script executed successfully
- [ ] `tokens_per_sol` field is set (verify with check-presale-state)
- [ ] Tested `buy_with_sol` with small amount
- [ ] Verified token calculation is correct
- [ ] Tested `set_token_rate` to update pricing
- [ ] Updated frontend/client code if needed

## Rollback Plan

If something goes wrong:

1. **Before migration:** You can keep using the old program (but `buy_with_sol` won't work with new pricing)
2. **After migration:** The account is updated, but you can:
   - Set `tokens_per_sol` to a different value using `set_token_rate`
   - The old program won't work with the updated account structure

**Important:** Once the account is reallocated, you cannot revert the account structure change. However, you can adjust the `tokens_per_sol` value as needed.

## Support

If you encounter issues:
1. Check program logs in migration output
2. Verify wallet has sufficient SOL
3. Ensure correct authority wallet is used
4. Test on devnet before mainnet
5. Review `MIGRATION_GUIDE.md` for detailed information

## Example Complete Migration

```bash
# 1. Build
anchor build

# 2. Deploy (devnet example)
anchor deploy --provider.cluster devnet --program-name presale

# 3. Migrate
anchor run migrate-presale-pricing

# 4. Verify
anchor run check-presale-state

# 5. Test (in your test script)
# Test buy_with_sol with 0.1 SOL
```

## Next Steps

After successful migration:
1. Update any frontend code to use new pricing
2. Monitor presale purchases to ensure correct token amounts
3. Adjust `tokens_per_sol` as needed using `set_token_rate`
4. Document the new pricing for your users

