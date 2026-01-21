# 🚀 Deployment Scripts Reference

This document describes all available deployment and operational scripts for the NC-Token project.

## 📦 Program Deployment

### `yarn deploy:programs`
Orchestrates the deployment of all three programs using `anchor deploy`.
- Deploys programs in order: spl-project → governance → presale
- Automatically builds if keypairs are missing
- Verifies deployment after each program

**Usage:**
```bash
yarn deploy:programs
yarn deploy:programs --skip-build  # Skip build if already built
yarn deploy:programs --programs spl_project,governance  # Deploy specific programs
```

### `yarn deploy:all`
Complete end-to-end deployment: initializes all programs, creates mint, links programs, and saves deployment info.
- ✅ Pre-deployment validation
- ✅ Wallet balance check
- ✅ Configuration validation
- ✅ Enhanced error handling

**Usage:**
```bash
yarn deploy:all
# With custom config:
TOKEN_NAME="MyToken" TOKEN_SYMBOL="MTK" yarn deploy:all
```

## 🔍 Validation & Verification

### `yarn utils:validate`
Pre-deployment validation script. Checks:
- ✅ Wallet exists and is accessible
- ✅ Network configuration (devnet/mainnet)
- ✅ Wallet balance (≥5 SOL recommended)
- ✅ Program IDs exist (build completed)
- ✅ Signers configuration
- ✅ Required approvals settings
- ✅ Cooldown period settings

**Usage:**
```bash
yarn utils:validate
yarn utils:validate --network mainnet
```

### `yarn utils:verify`
Post-deployment verification. Verifies:
- ✅ All program states initialized
- ✅ Programs linked correctly
- ✅ Mint authority set properly
- ✅ Deployment files saved

**Usage:**
```bash
yarn utils:verify
```

### `yarn utils:health`
System health check. Monitors:
- ✅ Network connectivity
- ✅ Token program status (paused/unpaused)
- ✅ Governance program status
- ✅ Presale program status
- ✅ Oracle feed accessibility

**Usage:**
```bash
yarn utils:health
```

## 🏛️ Governance Scripts

### `yarn governance:transfer`
Proposes authority transfer to governance (7-day cooldown).

**Usage:**
```bash
yarn governance:transfer
```

### `yarn governance:check-transfer`
Checks the status of a pending authority transfer.

**Usage:**
```bash
yarn governance:check-transfer
```

### `yarn governance:finalize`
Finalizes authority transfer after cooldown period.

**Usage:**
```bash
yarn governance:finalize
```

### `yarn governance:link-token`
Links token program to governance.

**Usage:**
```bash
yarn governance:link-token
```

### `yarn governance:link-presale`
Links presale program to governance.

**Usage:**
```bash
yarn governance:link-presale
```

## 💰 Presale Scripts

### `yarn presale:readiness`
Verifies presale is ready for users:
- ✅ Presale state initialized
- ✅ Presale is active
- ✅ Vault is funded
- ✅ Payment tokens allowed
- ✅ Oracle accessible

**Usage:**
```bash
yarn presale:readiness
```

## 🚨 Pre-Mainnet Checklist

### `yarn utils:pre-mainnet`
Interactive checklist before mainnet deployment:
- 🔴 Network is mainnet-beta
- 🔴 Anchor.toml configured correctly
- 🔴 Wallet has sufficient balance (≥10 SOL)
- 🔴 Multiple signers configured
- 🔴 Required approvals ≥ 2
- 🔴 Programs built and ready

**Usage:**
```bash
yarn utils:pre-mainnet
```

## 📋 Complete Deployment Workflow

### For Devnet Testing:

```bash
# 1. Build programs
anchor build
anchor keys sync

# 2. Validate configuration
yarn utils:validate

# 3. Deploy programs (if not already deployed)
yarn deploy:programs

# 4. Initialize all programs
yarn deploy:all

# 5. Verify deployment
yarn utils:verify

# 6. Check system health
yarn utils:health

# 7. (Optional) Transfer authority to governance
yarn governance:transfer
# Wait 7 days, then:
yarn governance:finalize

# 8. Prepare presale
yarn presale:readiness
# If not ready, follow the instructions
```

### For Mainnet Deployment:

```bash
# 1. Run pre-mainnet checklist
yarn utils:pre-mainnet

# 2. Build programs
anchor build
anchor keys sync

# 3. Validate configuration
yarn utils:validate --network mainnet

# 4. Deploy programs
yarn deploy:programs

# 5. Initialize all programs
yarn deploy:all

# 6. Verify deployment
yarn utils:verify

# 7. Transfer authority to governance
yarn governance:transfer
# Wait 7 days, then:
yarn governance:finalize

# 8. Prepare presale
yarn presale:readiness
```

## 🔧 Utility Scripts

### `yarn utils:revoke-authorities`
Revokes mint and metadata update authorities (makes token immutable).

### `yarn utils:recover-tokens`
Recovers tokens from incorrect addresses.

### `yarn utils:sync-ids`
Syncs program IDs between Anchor.toml and keypairs.

## 📝 Environment Variables

Common environment variables used across scripts:

```bash
# Network
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com  # or devnet

# Wallet
ANCHOR_WALLET=~/.config/solana/id.json

# Token Configuration
TOKEN_NAME="NC"
TOKEN_SYMBOL="NC"
TOKEN_DECIMALS=9
TOTAL_SUPPLY=100000000

# Governance Configuration
REQUIRED_APPROVALS=2
COOLDOWN_PERIOD=1800
SIGNERS="pubkey1,pubkey2,pubkey3"

# Presale Configuration
TOKEN_PRICE_USD_MICRO=1000  # $0.001 per token
```

## 🐛 Troubleshooting

### Deployment Fails
1. Run `yarn utils:validate` to check configuration
2. Verify wallet balance: `solana balance`
3. Check network: `solana config get`
4. Ensure programs are built: `anchor build`

### Authority Transfer Issues
1. Check pending transfer: `yarn governance:check-transfer`
2. Verify cooldown has elapsed
3. Ensure you're the current authority

### Presale Not Ready
1. Run `yarn presale:readiness` for detailed diagnostics
2. Check vault funding: `yarn presale:check`
3. Verify payment tokens are allowed
4. Ensure oracle is accessible

## 📚 Additional Resources

- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [OPERATIONS.md](./OPERATIONS.md) - Operational procedures
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
