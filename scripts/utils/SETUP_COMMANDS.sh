#!/bin/bash
# =============================================================================
# Complete Setup Commands - NC Token Project
# =============================================================================
# This file contains all commands needed to set up the entire project from
# scratch: deploying programs, initializing everything, setting up presale,
# and changing authorities.
#
# Usage:
#   chmod +x SETUP_COMMANDS.sh
#   ./SETUP_COMMANDS.sh
#
# Or copy and paste commands one by one into your terminal.
# =============================================================================

# =============================================================================
# SECTION 1: ENVIRONMENT SETUP
# =============================================================================

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

# Install dependencies
yarn install

# =============================================================================
# SECTION 2: BUILD PROGRAMS
# =============================================================================

# Build all programs
anchor build

# Sync program IDs (CRITICAL - must run after build)
anchor keys sync

# Verify program IDs
cat Anchor.toml

# =============================================================================
# SECTION 3: DEPLOY TOKEN PROGRAM (spl-project)
# =============================================================================

# Deploy token program to devnet
anchor deploy --program-name spl-project --provider.cluster devnet

# Initialize token program and mint tokens
yarn deploy

# Optional: Customize token parameters
# yarn deploy --name "NC Token" --symbol "NC" --decimals 9 --totalSupply 100000000

# Verify deployment info
cat deployments/deployment-info.json

# =============================================================================
# SECTION 4: DEPLOY GOVERNANCE PROGRAM
# =============================================================================

# Deploy governance program to devnet
anchor deploy --program-name governance --provider.cluster devnet

# Initialize governance
# Note: Create scripts/init-governance.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/init-governance.ts

# =============================================================================
# SECTION 5: TRANSFER TOKEN AUTHORITY TO GOVERNANCE
# =============================================================================

# Propose governance change (7-day cooldown)
# Note: Create scripts/transfer-authority.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/transfer-authority.ts

# After 7 days, execute the governance change:
# (Uncomment when ready)
# ts-node scripts/execute-governance-change.ts

# =============================================================================
# SECTION 6: DEPLOY PRESALE PROGRAM (Chainlink Oracle)
# =============================================================================

# Deploy presale program to devnet
anchor deploy --program-name presale --provider.cluster devnet

# Initialize presale with token price
# token_price_usd_micro: 1000 = $0.001 per token
# token_price_usd_micro: 10000 = $0.01 per token
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale

# Verify presale deployment info
cat presale-deployments/deployment-info.json

# =============================================================================
# SECTION 7: CONFIGURE GOVERNANCE (Link Programs)
# =============================================================================

# Set token program in governance
# Note: Create scripts/set-token-program.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/set-token-program.ts

# Set presale program in governance
# Note: Create scripts/set-presale-program.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/set-presale-program.ts

# =============================================================================
# SECTION 8: SETUP PRESALE
# =============================================================================

# Allow payment token (e.g., USDC)
# Note: Create scripts/allow-payment-token.ts first (see DEPLOYMENT_COMMANDS.md)
# Update PAYMENT_TOKEN_MINT in the script before running
ts-node scripts/allow-payment-token.ts

# Start presale (allows purchases)
# Note: Create scripts/start-presale.ts first (see DEPLOYMENT_COMMANDS.md)
ts-node scripts/start-presale.ts

# =============================================================================
# SECTION 9: TEST PRESALE
# =============================================================================

# Test buying presale tokens with 0.1 SOL
# Uses Chainlink SOL/USD oracle for pricing
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ts-node scripts/buy-presale.ts 0.1

# =============================================================================
# SECTION 10: OPTIONAL - REVOKE AUTHORITIES (Production)
# =============================================================================

# Revoke mint authority and update authority (makes token immutable)
# Uncomment when ready for production
# yarn revoke-authorities

# Or with custom paths:
# MINT_ADDRESS=<mint> STATE_PDA=<state_pda> yarn revoke-authorities

# =============================================================================
# SECTION 11: MAINNET DEPLOYMENT (Production)
# =============================================================================

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

# =============================================================================
# NOTES
# =============================================================================
#
# 1. Save all PDAs: Keep deployments/deployment-info.json and presale-deployments/deployment-info.json safe
# 2. Governance Cooldown: 7-day cooldown for authority transfer
# 3. Chainlink Feed: CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU (use for both devnet/mainnet)
# 4. Token Price Format: token_price_usd_micro is in micro-USD (1000 = $0.001 per token)
# 5. Migration: Only needed if upgrading from old structure (tokens_per_sol)
#    Run: TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
#
# =============================================================================

