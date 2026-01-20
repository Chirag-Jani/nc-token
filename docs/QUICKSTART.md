# 🚀 Quickstart Guide

## 1. Environment Setup
Install the necessary tools to build and interact with Solana programs.
```bash
# Install Solana CLI & Anchor (The core development framework)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest && avm use latest

# Project Setup (Install dependencies and configure network)
yarn install
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 2 $(solana address)
```

## 2. Build & Deploy
Compile the Rust programs and deploy them to the blockchain.
```bash
# Build & Sync IDs (Ensures program IDs match in code and config)
anchor build
anchor keys sync

# Deploy Token (Main SPL token program)
anchor deploy --program-name spl-project
yarn deploy  # Initializes state, creates mint, and mints initial supply

# Deploy Governance (Multisig control center)
anchor deploy --program-name governance
yarn governance:init

# Deploy Presale (Public sale with Oracle pricing)
anchor deploy --program-name presale
TOKEN_PRICE_USD_MICRO=1000 yarn deploy:presale
```

## 3. Post-Deployment Linking
Finalize the connection between programs so Governance can control them.
```bash
# Link Programs to Governance (Enables multisig execution)
yarn governance:link-token
yarn governance:link-presale

# Transfer Token Authority (Hands control from your wallet to the Multisig)
yarn governance:transfer
```

## 4. Operational Scripts
Quick commands for daily management and testing.
| Command | Purpose |
|---------|-------------|
| `yarn presale:start` | Unlocks purchase functionality |
| `yarn presale:check` | Verifies pool balance and price |
| `yarn presale:buy 0.1` | Simulates a user purchase with SOL |
| `yarn utils:sync-ids` | Re-syncs IDs if program keypairs change |

