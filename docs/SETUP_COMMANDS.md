# Complete Setup Commands - NC Token Project

This file contains all commands needed to set up the entire project from scratch: deploying programs, initializing everything, setting up presale, and changing authorities.

---

## Prerequisites

```bash
# Install dependencies (if not already installed)
yarn install

# Verify Solana CLI is installed
solana --version

# Verify Anchor is installed
anchor --version
```

---

## Section 1: Environment Setup

```bash
# Set Solana to devnet (or mainnet-beta for production)
solana config set --url devnet

# Check wallet address
solana address

# Airdrop SOL (devnet only - repeat if needed)
solana airdrop 2 $(solana address)

# Verify balance (need at least 5-10 SOL for deployment)
solana balance

# Set environment variables
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json
```

---

## Section 2: Build Programs

```bash
# Build all programs
anchor build

# Sync program IDs (CRITICAL - must run after build)
anchor keys sync

# Verify program IDs
cat Anchor.toml
```

---

## Section 3: Deploy Token Program (spl-project)

```bash
# Deploy token program to devnet
anchor deploy --program-name spl-project --provider.cluster devnet

# Initialize token program and mint tokens
yarn deploy

# Optional: Customize token parameters
# yarn deploy --name "NC Token" --symbol "NC" --decimals 9 --totalSupply 100000000

# Verify deployment info
cat deployment-info.json
```

**Save these values:**
- `MINT_ADDRESS` - Token mint address
- `STATE_PDA` - Token state PDA  
- `PROGRAM_ID` - Token program ID

---

## Section 4: Deploy Governance Program

```bash
# Deploy governance program to devnet
anchor deploy --program-name governance --provider.cluster devnet

# Initialize governance
# Note: Create scripts/init-governance.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/init-governance.ts
```

**Save this value:**
- `GOVERNANCE_STATE_PDA` - Governance state PDA

---

## Section 5: Transfer Token Authority to Governance

```bash
# Propose governance change (7-day cooldown)
# Note: Create scripts/transfer-authority.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/transfer-authority.ts

# After 7 days, execute the governance change:
# (Run when cooldown period is over)
# ts-node scripts/execute-governance-change.ts
```

---

## Section 6: Deploy Presale Program (Chainlink Oracle)

```bash
# Deploy presale program to devnet
anchor deploy --program-name presale --provider.cluster devnet

# Initialize presale with token price
# token_price_usd_micro: 1000 = $0.001 per token
# token_price_usd_micro: 10000 = $0.01 per token
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale

# Verify presale deployment info
cat presale-deployment-info.json
```

**What this does:**
- Creates `PresaleState` account with `token_price_usd_micro` field
- Sets token price in micro-USD (1000 = $0.001 per token)
- Presale will use Chainlink SOL/USD oracle for dynamic pricing
- Chainlink Feed: `CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU` (use for both devnet/mainnet)

---

## Section 7: Configure Governance (Link Programs)

```bash
# Set token program in governance
# Note: Create scripts/set-token-program.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/set-token-program.ts

# Set presale program in governance
# Note: Create scripts/set-presale-program.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/set-presale-program.ts
```

---

## Section 8: Setup Presale

```bash
# Allow payment token (e.g., USDC)
# Note: Create scripts/allow-payment-token.ts first (see DEPLOYMENT_COMMANDS.md)
# Update PAYMENT_TOKEN_MINT in the script before running
ts-node scripts/allow-payment-token.ts

# Start presale (allows purchases)
# Note: Create scripts/start-presale.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/start-presale.ts
```

---

## Section 9: Test Presale

```bash
# Test buying presale tokens with 0.1 SOL
# Uses Chainlink SOL/USD oracle for pricing
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ts-node scripts/buy-presale.ts 0.1
```

**Expected:**
- ✅ Transaction succeeds
- ✅ Tokens calculated using real-time Chainlink SOL/USD price
- ✅ Tokens minted to buyer
- ✅ SOL transferred to vault

---

## Section 10: Optional - Revoke Authorities (Production)

```bash
# Revoke mint authority and update authority (makes token immutable)
# Uncomment when ready for production
yarn revoke-authorities

# Or with custom paths:
# MINT_ADDRESS=<mint> STATE_PDA=<state_pda> yarn revoke-authorities
```

---

## Section 11: Mainnet Deployment (Production)

```bash
# ⚠️ WARNING: Mainnet deployment
# Double-check program ID and keypair before proceeding!

# Set to mainnet
solana config set --url mainnet-beta

# Update environment
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export ANCHOR_WALLET=~/.config/solana/mainnet-wallet.json

# Deploy all programs to mainnet
anchor deploy --program-name spl-project --provider.cluster mainnet-beta
anchor deploy --program-name governance --provider.cluster mainnet-beta
anchor deploy --program-name presale --provider.cluster mainnet-beta

# Initialize on mainnet (same commands as devnet, but on mainnet)
yarn deploy
ts-node scripts/init-governance.ts
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale
ts-node scripts/start-presale.ts
```

---

## Quick Reference - All Commands in Order

```bash
# ============================================
# SETUP
# ============================================
solana config set --url devnet
solana airdrop 2 $(solana address)
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
yarn install

# ============================================
# BUILD
# ============================================
anchor build
anchor keys sync

# ============================================
# DEPLOY TOKEN PROGRAM
# ============================================
anchor deploy --program-name spl-project --provider.cluster devnet
yarn deploy

# ============================================
# DEPLOY GOVERNANCE
# ============================================
anchor deploy --program-name governance --provider.cluster devnet
ts-node scripts/init-governance.ts

# ============================================
# TRANSFER AUTHORITY (Optional)
# ============================================
ts-node scripts/transfer-authority.ts
# Wait 7 days, then execute set_governance

# ============================================
# DEPLOY PRESALE (Chainlink Oracle)
# ============================================
anchor deploy --program-name presale --provider.cluster devnet
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale

# ============================================
# CONFIGURE GOVERNANCE
# ============================================
ts-node scripts/set-token-program.ts
ts-node scripts/set-presale-program.ts

# ============================================
# SETUP PRESALE
# ============================================
ts-node scripts/allow-payment-token.ts
ts-node scripts/start-presale.ts

# ============================================
# TEST
# ============================================
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ts-node scripts/buy-presale.ts 0.1

# ============================================
# OPTIONAL: REVOKE AUTHORITIES
# ============================================
# yarn revoke-authorities
```

---

## Important Notes

1. **Save All PDAs**: Keep `deployment-info.json` and `presale-deployment-info.json` safe
2. **Governance Cooldown**: 7-day cooldown for authority transfer
3. **Chainlink Feed**: `CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU` (use for both devnet/mainnet)
4. **Token Price Format**: `token_price_usd_micro` is in micro-USD (1000 = $0.001 per token)
5. **Migration**: Only needed if upgrading from old structure (`tokens_per_sol`)
   - Run: `TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing`
6. **Scripts Required**: Some scripts need to be created first (see `DEPLOYMENT_COMMANDS.md` for examples):
   - `scripts/init-governance.ts`
   - `scripts/transfer-authority.ts`
   - `scripts/set-token-program.ts`
   - `scripts/set-presale-program.ts`
   - `scripts/allow-payment-token.ts`
   - `scripts/start-presale.ts`

---

## Troubleshooting

### If presale already exists and needs migration:
```bash
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
```

### If you need to check presale state:
```bash
# Check if presale is initialized
solana account <PRESALE_STATE_PDA> --url devnet
```

### If deployment fails:
```bash
# Check balance
solana balance

# Get more SOL (devnet)
solana airdrop 2 $(solana address)
```

---

## Production Checklist

- [ ] All programs built and tested on devnet
- [ ] All programs deployed to mainnet
- [ ] Governance initialized with proper signers
- [ ] Token authority transferred to governance
- [ ] Presale initialized and started
- [ ] Chainlink integration tested
- [ ] Test buy transaction successful
- [ ] All addresses saved securely
- [ ] Authorities revoked (if desired)

