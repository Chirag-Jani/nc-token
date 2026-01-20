# Chainlink Oracle Integration - Migration Summary

## Overview

The presale program has been updated to use Chainlink's on-chain SOL/USD price feed instead of manual price setup. This provides dynamic, real-time pricing that automatically adjusts with SOL market price.

## Key Changes

### 1. Program Structure Changes

#### PresaleState Account
- **Removed**: `tokens_per_sol: u64` (manual price field)
- **Added**: `token_price_usd_micro: u64` (fixed USD price per token in micro-USD)
  - Example: `1000` = $0.001 per token
  - 1 USD = 1,000,000 micro-USD

#### BuyWithSol Instruction
- **Added**: `chainlink_feed: AccountInfo` (Chainlink SOL/USD price feed account)

#### Functions Updated
- `initialize()`: Now accepts `token_price_usd_micro` instead of `initial_tokens_per_sol`
- `buy_with_sol()`: Now reads SOL/USD price from Chainlink oracle and calculates tokens dynamically
- `set_token_rate()`: Renamed to `set_token_price_usd()` and now sets USD price instead of tokens per SOL
- `migrate_presale_state()`: Updated to migrate from `tokens_per_sol` to `token_price_usd_micro`

### 2. Price Calculation

**Old Method (Manual):**
```
tokens = (sol_amount * tokens_per_sol) / LAMPORTS_PER_SOL
```

**New Method (Chainlink Oracle):**
```
1. Fetch SOL/USD price from Chainlink (with 8 decimals)
2. Calculate: tokens = (sol_amount * sol_price_usd * 1_000_000) / (token_price_usd_micro * 10^8 * 10^9)
```

### 3. Chainlink Feed Addresses

- **Mainnet**: `CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU`
- **Devnet**: `Cp877Z9nU3qcS6nov97M679pUP8D6xW9Tz6TfU39iF`
- **Chainlink OCR2 Program**: `HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny`

### 4. Safety Features

- **Staleness Check**: Price feed must be updated within 1 hour (3600 seconds)
- **Price Validation**: Ensures price is positive
- **Overflow Protection**: Uses u128 for intermediate calculations

## Migration Steps

### Step 1: Build and Deploy Updated Program

```bash
# Build the updated program
anchor build

# Deploy to the same program ID (upgrade)
anchor deploy --provider.cluster devnet --program-name presale
# or for mainnet:
anchor deploy --provider.cluster mainnet-beta --program-name presale
```

### Step 2: Run Migration Script

```bash
# Using default price ($0.001 per token = 1000 micro-USD)
anchor run migrate-presale-pricing

# Or with custom price
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
```

The migration script will:
1. Replace `tokens_per_sol` with `token_price_usd_micro`
2. Set the initial USD price per token
3. Verify the migration succeeded

### Step 3: Update Frontend/Client Code

All `buy_with_sol` calls must now include the Chainlink feed account:

```typescript
// Mainnet
const CHAINLINK_SOL_USD_FEED_MAINNET = new PublicKey("CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU");

// Devnet
const CHAINLINK_SOL_USD_FEED_DEVNET = new PublicKey("Cp877Z9nU3qcS6nov97M679pUP8D6xW9Tz6TfU39iF");

await presaleProgram.methods
  .buyWithSol(solAmount)
  .accounts({
    // ... other accounts ...
    chainlinkFeed: CHAINLINK_SOL_USD_FEED_MAINNET, // Add this
  })
  .rpc();
```

### Step 4: Update Tests

Tests need to be updated to:
1. Use `token_price_usd_micro` instead of `tokens_per_sol` in initialization
2. Pass Chainlink feed account in `buy_with_sol` calls
3. Mock or use real Chainlink feed for testing

## Updated Scripts

- ✅ `scripts/migrate-presale-pricing.ts` - Updated for oracle migration
- ✅ `scripts/deploy-presale.ts` - Updated to use `token_price_usd_micro`
- ✅ `scripts/deploy-all.ts` - Updated to use `token_price_usd_micro`
- ⚠️ `tests/03-complete-coverage.ts` - Partially updated (initialization only)

## Testing Checklist

Before deploying to mainnet:

- [ ] Test migration on devnet
- [ ] Verify `buy_with_sol` works with Chainlink feed
- [ ] Test price calculation with different SOL prices
- [ ] Verify staleness checks work correctly
- [ ] Test edge cases (zero price, stale feed, etc.)
- [ ] Update all test files to use Chainlink feed
- [ ] Update frontend/client code to pass Chainlink feed

## Breaking Changes

1. **Initialization**: `initialize()` now requires `token_price_usd_micro` instead of `initial_tokens_per_sol`
2. **Buy Function**: `buy_with_sol()` now requires `chainlink_feed` account
3. **Price Setting**: `set_token_rate()` renamed to `set_token_price_usd()` with different parameter
4. **Account Structure**: `PresaleState` field changed from `tokens_per_sol` to `token_price_usd_micro`

## Benefits

1. **Dynamic Pricing**: Price automatically adjusts with SOL market price
2. **No Manual Updates**: No need to manually update price when SOL price changes
3. **Transparent**: Uses industry-standard Chainlink oracle
4. **Real-time**: Always uses latest SOL/USD price

## Notes

- The account size remains the same (both fields are u64)
- Migration is one-time per account
- Old `tokens_per_sol` values are replaced, not converted (you must calculate the equivalent USD price)
- Chainlink feed must be passed in every `buy_with_sol` transaction

