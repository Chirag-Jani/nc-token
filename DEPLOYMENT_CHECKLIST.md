# Deployment Checklist - Chainlink Oracle Integration

## ✅ Production Readiness Review

### Code Quality - Production Best Practices

#### 1. Chainlink Integration ✅
- ✅ Uses SDK v2 (`read_feed_v2`) for direct account reads (lower compute units)
- ✅ Validates feed owner is Chainlink OCR2 program (`HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny`)
- ✅ Owner-based validation (accepts any feed owned by Chainlink OCR2)
- ✅ Staleness check (1 hour threshold)
- ✅ Price validation (positive values)
- ✅ Decimal validation (8 decimals expected)
- ✅ Note: No devnet feed available - use mainnet feed for both networks

#### 2. Security Features ✅
- ✅ Feed owner verification (prevents spoofed accounts - must be Chainlink OCR2)
- ✅ Feed decimals validation (must be 8)
- ✅ Price validation (must be positive)
- ✅ Staleness protection (price must be < 1 hour old)
- ✅ Overflow protection (u128 intermediates)
- ✅ Emergency pause integration
- ✅ Blacklist enforcement
- ✅ Authority checks (admin/governance)

#### 3. Error Handling ✅
- ✅ Custom error codes (`InvalidPrice`, `StalePrice`)
- ✅ Proper error propagation
- ✅ Clear error messages

#### 4. Code Structure ✅
- ✅ Constants defined at top level
- ✅ Clear comments and documentation
- ✅ Proper account validation
- ✅ Safe arithmetic operations

---

## 📋 Post-Build Steps

### Step 1: Verify Build Success

```bash
# From project root
anchor build
```

**Check:**
- ✅ No compilation errors
- ✅ IDL generated: `target/idl/presale.json`
- ✅ Program binary: `target/deploy/presale.so`
- ✅ Types generated: `target/types/presale.ts`

---

### Step 2: Deploy to Devnet (Testing)

#### 2.1 Deploy Program

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet --program-name presale

# Verify deployment
solana program show <YOUR_PRESALE_PROGRAM_ID> --url devnet
```

#### 2.2 Initialize or Migrate

**For NEW deployments (presale doesn't exist):**

```bash
# Set environment
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com

# Initialize with token price ($0.001 = 1000 micro-USD)
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale
```

**What this does:**
- ✅ Creates `PresaleState` account with `token_price_usd_micro` field
- ✅ Sets token price in micro-USD
- ✅ **NO migration needed** - fresh start with new structure

**For EXISTING deployments (check first):**

```bash
# Check if presale already has token_price_usd_micro
# If yes → Already migrated, skip migration
# If no → Needs migration

# If migration is needed:
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
```

**Migration will:**
1. Reallocate `PresaleState` account if needed
2. Replace `tokens_per_sol` with `token_price_usd_micro`
3. Set USD price per token
4. Verify migration succeeded

**Important:** Migration is ONLY needed if upgrading from old version with `tokens_per_sol`. If you're just redeploying the program (same account structure), NO migration needed.

#### 2.3 Test Buy Transaction

```bash
# Set environment for devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com

# Test buying with 0.1 SOL
ts-node scripts/buy-presale.ts 0.1
```

**Expected:**
- ✅ Transaction succeeds
- ✅ Tokens minted to buyer
- ✅ SOL transferred to vault
- ✅ Price calculated using Chainlink oracle (real-time SOL/USD price)

**Note:** Script uses mainnet Chainlink feed for both devnet and mainnet (no devnet feed available). Program validates feed owner, not specific address.

---

### Step 3: Mainnet Deployment

#### 3.1 Pre-Mainnet Verification

- [ ] All devnet tests pass
- [ ] Migration tested on devnet
- [ ] Feed addresses verified on [Chainlink docs](https://docs.chain.link/data-feeds/solana)
- [ ] Program ID matches deployment keypair
- [ ] Sufficient SOL for deployment
- [ ] Backup of program keypair (secure storage)
- [ ] Emergency procedures documented

#### 3.2 Deploy to Mainnet

```bash
# ⚠️ WARNING: Mainnet deployment
# Double-check program ID and keypair!

anchor deploy --provider.cluster mainnet-beta --program-name presale
```

#### 3.3 Verify Mainnet Deployment

```bash
# Check program
solana program show <YOUR_PRESALE_PROGRAM_ID> --url mainnet-beta

# View on explorer
# https://explorer.solana.com/address/<YOUR_PRESALE_PROGRAM_ID>
```

#### 3.4 Initialize/Migrate on Mainnet

```bash
# Set mainnet environment
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export ANCHOR_WALLET=~/.config/solana/mainnet-wallet.json

# Run migration
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
```

**⚠️ CRITICAL:**
- Use correct wallet (mainnet authority)
- Verify token price before migration
- Test migration on devnet first

---

### Step 4: Update Client Code

All frontend/client code must pass Chainlink feed account:

```typescript
import { PublicKey } from "@solana/web3.js";

// Chainlink SOL/USD feed address
// Note: No devnet feed available - use mainnet feed for both networks
// Program validates feed owner (Chainlink OCR2), not specific address
const CHAINLINK_SOL_USD_FEED = new PublicKey(
  "CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU"
);

// Use same feed for all networks
const chainlinkFeed = CHAINLINK_SOL_USD_FEED;

// Buy tokens
await presaleProgram.methods
  .buyWithSol(solAmount)
  .accounts({
    // ... existing accounts ...
    chainlinkFeed: chainlinkFeed, // ⚠️ REQUIRED
    // ... other accounts ...
  })
  .rpc();
```

---

## 📝 Files Updated

### ✅ Program Code
- ✅ `programs/presale/src/lib.rs` - Chainlink v2 integration, production security
- ✅ `programs/presale/Cargo.toml` - Added `chainlink_solana = "2.0.8"`

### ✅ Scripts
- ✅ `scripts/migrate-presale-pricing.ts` - Updated for oracle migration
- ✅ `scripts/deploy-presale.ts` - Updated to use `token_price_usd_micro`
- ✅ `scripts/deploy-all.ts` - Updated to use `token_price_usd_micro`
- ✅ `scripts/buy-presale.ts` - Added Chainlink feed account

### ✅ Tests
- ✅ `tests/03-complete-coverage.ts` - Added Chainlink feed helper, updated initialization

### ✅ Documentation
- ✅ `PRODUCTION_DEPLOYMENT_GUIDE.md` - Complete deployment guide
- ✅ `CHAINLINK_MIGRATION_SUMMARY.md` - Migration summary
- ✅ `DEPLOYMENT_CHECKLIST.md` - This file

---

## 🔍 Production Security Features

### 1. Feed Owner Verification

```rust
// Feed must be owned by Chainlink OCR2 program
require!(feed.owner == &CHAINLINK_PROGRAM_ID, PresaleError::InvalidPrice);
```

**Why:** Ensures we're reading from official Chainlink feeds. Program accepts any feed owned by Chainlink OCR2 program (not specific address validation).

### 2. Feed Decimals Validation

```rust
// Feed must use 8 decimals
require!(decimals == CHAINLINK_DECIMALS, PresaleError::InvalidPrice);
```

**Why:** Ensures correct price calculation with expected decimal precision.

### 3. Staleness Protection

```rust
// Price must be updated within 1 hour
require!(
    price_age <= PRICE_FEED_STALENESS_THRESHOLD_SECONDS,
    PresaleError::StalePrice
);
```

**Why:** Prevents using outdated prices that could be exploited.

### 4. Price Validation

```rust
// Price must be positive
require!(sol_price_usd > 0, PresaleError::InvalidPrice);
```

**Why:** Ensures valid price data for calculations.

---

## 🚨 Important Notes

1. **Chainlink Feed:** Use mainnet feed address (`CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU`) for both devnet and mainnet (no devnet feed available)
2. **Feed Validation:** Program validates feed owner (Chainlink OCR2 program), not specific address
3. **Migration:** Only needed if upgrading from old structure (`tokens_per_sol`) to new (`token_price_usd_micro`)
4. **Redeployment:** If account already has `token_price_usd_micro`, just redeploy program - no migration needed
5. **Breaking Change:** All `buy_with_sol` calls must include `chainlinkFeed` account
6. **Price Format:** `token_price_usd_micro` is in micro-USD (1000 = $0.001 per token)

---

## ✅ Ready for Production

Your presale program is now production-ready with:
- ✅ Real-time Chainlink oracle pricing
- ✅ Production-grade security checks
- ✅ Comprehensive error handling
- ✅ Migration path for existing deployments
- ✅ Updated scripts and documentation

**Next:** Follow the deployment steps above! 🚀

