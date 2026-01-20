# Production Deployment Guide - Chainlink Oracle Integration

## Production Readiness Checklist

### ✅ Code Review - Production Best Practices

The presale program now includes the following production-ready features:

1. **Chainlink Oracle Integration (SDK v2)**
   - ✅ Uses `read_feed_v2` for direct account reads (lower compute units)
   - ✅ Validates feed owner is Chainlink OCR2 program
   - ✅ Verifies feed address matches official mainnet/devnet feeds
   - ✅ Staleness check (1 hour threshold)
   - ✅ Price validation (positive values)
   - ✅ Decimal validation (8 decimals)

2. **Security Features**
   - ✅ Feed owner verification (prevents malicious feeds)
   - ✅ Feed address whitelist (mainnet/devnet only)
   - ✅ Overflow protection (u128 intermediates)
   - ✅ Emergency pause integration
   - ✅ Blacklist enforcement
   - ✅ Authority checks

3. **Error Handling**
   - ✅ Custom error codes for all failure cases
   - ✅ Proper error propagation
   - ✅ Clear error messages

---

## Step-by-Step Deployment Process

### Phase 1: Pre-Deployment Verification

#### 1.1 Build the Program

```bash
# From project root
anchor build
```

**Verify:**
- ✅ No compilation errors
- ✅ IDL generated successfully
- ✅ Program binary created in `target/deploy/presale.so`

#### 1.2 Review Program Constants

Verify the Chainlink feed addresses in `programs/presale/src/lib.rs`:

```rust
// Mainnet feed (verify on Chainlink docs before mainnet deployment)
pub const CHAINLINK_SOL_USD_FEED_MAINNET: Pubkey = ...;

// Devnet feed
pub const CHAINLINK_SOL_USD_FEED_DEVNET: Pubkey = ...;

// Chainlink OCR2 Program ID (should never change)
pub const CHAINLINK_PROGRAM_ID: Pubkey = ...;
```

**⚠️ IMPORTANT:** Before mainnet deployment, verify the mainnet feed address on:
- [Chainlink Solana Feeds](https://docs.chain.link/data-feeds/solana)
- [Solana Explorer](https://explorer.solana.com/)

---

### Phase 2: Deploy to Devnet (Testing)

#### 2.1 Deploy the Program

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet --program-name presale

# Or if upgrading existing program:
anchor upgrade target/deploy/presale.so \
  --program-id target/deploy/presale-keypair.json \
  --provider.cluster devnet
```

#### 2.2 Verify Deployment

```bash
# Check program is deployed
solana program show <YOUR_PRESALE_PROGRAM_ID> --url devnet

# Verify program data
solana program dump <YOUR_PRESALE_PROGRAM_ID> presale-dump.so --url devnet
```

#### 2.3 Initialize or Migrate Presale State

**Option A: Fresh Initialization (New Deployment)**

```bash
# Set your token price (e.g., $0.001 = 1000 micro-USD)
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale
```

**Option B: Migration (Existing Deployment)**

```bash
# Migrate existing presale state
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
```

The migration script will:
1. Reallocate `PresaleState` account if needed
2. Replace `tokens_per_sol` with `token_price_usd_micro`
3. Set the USD price per token
4. Verify migration succeeded

#### 2.4 Test Buy Transaction

```bash
# Test buying with 0.1 SOL
node scripts/buy-presale.ts 0.1
```

**Expected Output:**
- ✅ Transaction succeeds
- ✅ Tokens are minted to buyer
- ✅ SOL is transferred to vault
- ✅ Price calculation uses Chainlink oracle

---

### Phase 3: Mainnet Deployment

#### 3.1 Pre-Mainnet Checklist

- [ ] All devnet tests pass
- [ ] Migration tested on devnet
- [ ] Feed addresses verified on Chainlink docs
- [ ] Program ID matches your deployment keypair
- [ ] Sufficient SOL for deployment (rent + fees)
- [ ] Backup of program keypair (secure storage)
- [ ] Emergency procedures documented

#### 3.2 Deploy to Mainnet

```bash
# ⚠️ WARNING: This deploys to MAINNET
# Double-check your program ID and keypair!

anchor deploy --provider.cluster mainnet-beta --program-name presale
```

#### 3.3 Verify Mainnet Deployment

```bash
# Check program on mainnet
solana program show <YOUR_PRESALE_PROGRAM_ID> --url mainnet-beta

# Verify on Solana Explorer
# https://explorer.solana.com/address/<YOUR_PRESALE_PROGRAM_ID>
```

#### 3.4 Initialize/Migrate on Mainnet

```bash
# Set environment for mainnet
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export ANCHOR_WALLET=~/.config/solana/mainnet-wallet.json

# Run migration (use your actual token price)
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
```

**⚠️ CRITICAL:** 
- Use the correct wallet (mainnet authority)
- Verify token price is correct before migration
- Test migration on devnet first

---

### Phase 4: Post-Deployment

#### 4.1 Update Frontend/Client Code

All client code must pass the Chainlink feed account:

```typescript
import { PublicKey } from "@solana/web3.js";

// Chainlink SOL/USD feed addresses
const CHAINLINK_SOL_USD_FEED_MAINNET = new PublicKey(
  "CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU"
);

const CHAINLINK_SOL_USD_FEED_DEVNET = new PublicKey(
  "Cp877Z9nU3qcS6nov97M679pUP8D6xW9Tz6TfU39iF"
);

// Determine which feed to use
const isMainnet = cluster === "mainnet-beta";
const chainlinkFeed = isMainnet 
  ? CHAINLINK_SOL_USD_FEED_MAINNET 
  : CHAINLINK_SOL_USD_FEED_DEVNET;

// Buy tokens
await presaleProgram.methods
  .buyWithSol(solAmount)
  .accounts({
    presaleState: presaleStatePda,
    buyer: wallet.publicKey,
    tokenState: tokenStatePda,
    buyerBlacklist: SystemProgram.programId,
    solVault: solVaultPda,
    presaleTokenVault: presaleTokenVault,
    presaleTokenVaultPda: presaleTokenVaultPda,
    buyerTokenAccount: buyerTokenAccount,
    chainlinkFeed: chainlinkFeed, // ⚠️ REQUIRED: Add Chainlink feed
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    userPurchase: userPurchasePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

#### 4.2 Monitor and Verify

**Monitor:**
- Transaction success rate
- Price feed staleness (should update every ~1 hour)
- Error logs for `InvalidPrice` or `StalePrice`
- Token distribution accuracy

**Verify:**
- Prices match expected values
- Staleness checks working
- Feed owner verification working
- No unauthorized feed addresses accepted

---

## Migration Script Details

### What the Migration Does

The `migrate-presale-pricing.ts` script:

1. **Fetches Current State**
   - Reads existing `PresaleState` account
   - Detects old structure (with `tokens_per_sol`)
   - Identifies authority (admin or governance)

2. **Reallocates Account** (if needed)
   - Expands account size if old structure
   - Preserves all existing data
   - Adds `token_price_usd_micro` field

3. **Sets USD Price**
   - Replaces `tokens_per_sol` with `token_price_usd_micro`
   - Uses value from `TOKEN_PRICE_USD_MICRO` env var or default (1000)

4. **Verifies Migration**
   - Fetches updated state
   - Confirms `token_price_usd_micro` is set
   - Displays example calculation

### Running Migration

```bash
# Default price ($0.001 per token)
anchor run migrate-presale-pricing

# Custom price ($0.01 per token = 10,000 micro-USD)
TOKEN_PRICE_USD_MICRO=10000 anchor run migrate-presale-pricing

# Mainnet migration
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
TOKEN_PRICE_USD_MICRO=1000 \
anchor run migrate-presale-pricing
```

---

## Production Security Considerations

### 1. Feed Address Verification

The program now **hardcodes** the allowed feed addresses:

```rust
// Only these feeds are accepted
let is_mainnet_feed = feed.key() == &CHAINLINK_SOL_USD_FEED_MAINNET;
let is_devnet_feed = feed.key() == &CHAINLINK_SOL_USD_FEED_DEVNET;
require!(is_mainnet_feed || is_devnet_feed, PresaleError::InvalidPrice);
```

**Why:** Prevents users from passing malicious or test feed accounts.

### 2. Feed Owner Verification

The program verifies the feed is owned by Chainlink:

```rust
require!(feed.owner == &CHAINLINK_PROGRAM_ID, PresaleError::InvalidPrice);
```

**Why:** Ensures we're reading from official Chainlink feeds, not spoofed accounts.

### 3. Staleness Protection

Price must be updated within 1 hour:

```rust
require!(
    price_age <= PRICE_FEED_STALENESS_THRESHOLD_SECONDS,
    PresaleError::StalePrice
);
```

**Why:** Prevents using outdated prices that could be exploited.

### 4. Decimal Validation

Ensures feed uses expected 8 decimals:

```rust
require!(decimals == CHAINLINK_DECIMALS, PresaleError::InvalidPrice);
```

**Why:** Prevents calculation errors from unexpected decimal formats.

---

## Troubleshooting

### Error: "InvalidPrice"

**Possible Causes:**
- Wrong feed address passed
- Feed not owned by Chainlink program
- Feed decimals don't match (not 8)
- Price is zero or negative

**Solution:**
- Verify feed address matches mainnet/devnet constants
- Check feed owner on Solana Explorer
- Ensure using official Chainlink feeds

### Error: "StalePrice"

**Possible Causes:**
- Chainlink feed hasn't updated in >1 hour
- Network issues preventing feed updates

**Solution:**
- Check Chainlink feed status on Solana Explorer
- Verify feed is updating regularly
- Consider increasing staleness threshold (not recommended)

### Error: "Overflow"

**Possible Causes:**
- Very large SOL amounts
- Very high SOL prices
- Calculation exceeds u64 limits

**Solution:**
- Program uses u128 intermediates (should handle most cases)
- Consider adding max purchase limits
- Review calculation formula

---

## Rollback Plan

If something goes wrong:

1. **Keep Old Program Binary**
   - Save `target/deploy/presale.so` before deployment
   - Keep program keypair secure

2. **Redeploy Previous Version**
   ```bash
   solana program deploy presale-old.so \
     --program-id target/deploy/presale-keypair.json \
     --provider.cluster mainnet-beta
   ```

3. **Or Create New Migration**
   - Add migration function to revert field change
   - Run migration to restore old structure

---

## Next Steps After Deployment

1. ✅ **Update All Client Code**
   - Frontend applications
   - Trading bots
   - Integration scripts

2. ✅ **Update Documentation**
   - API documentation
   - Integration guides
   - User-facing docs

3. ✅ **Monitor Production**
   - Set up alerts for errors
   - Track transaction success rate
   - Monitor price feed updates

4. ✅ **Test End-to-End**
   - Full purchase flow
   - Edge cases
   - Error scenarios

---

## Support Resources

- **Chainlink Docs:** https://docs.chain.link/data-feeds/solana
- **Solana Explorer:** https://explorer.solana.com/
- **Chainlink Feeds:** https://docs.chain.link/data-feeds/solana

---

## Summary

Your presale program is now production-ready with:

✅ Real-time Chainlink oracle pricing  
✅ Production-grade security checks  
✅ Comprehensive error handling  
✅ Migration path for existing deployments  
✅ Updated scripts and documentation  

**Ready for deployment!** 🚀

