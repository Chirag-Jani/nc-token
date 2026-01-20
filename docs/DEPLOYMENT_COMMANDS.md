# Complete Deployment Commands Guide

This guide provides all commands needed to deploy and set up the NC Token project from start to finish.

---

## Prerequisites Installation

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor Framework
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Install Node.js and Yarn (if not installed)
npm install -g yarn

# Verify installations
solana --version
anchor --version
node --version
yarn --version
```

---

## Environment Setup

```bash
# 1. Set Solana to devnet (or mainnet-beta for production)
solana config set --url devnet

# 2. Generate wallet (if needed)
solana-keygen new --outfile ~/.config/solana/id.json
# ⚠️ SAVE THE SEED PHRASE SECURELY!

# 3. Check wallet address
solana address

# 4. Airdrop SOL (devnet only - repeat if needed)
solana airdrop 2 $(solana address)

# 5. Verify balance (need at least 5-10 SOL for deployment)
solana balance

# 6. Navigate to project directory
cd /path/to/nc-token

# 7. Install project dependencies
yarn install
```

---

## Build Programs

```bash
# 1. Build all programs
anchor build

# 2. Sync program IDs (CRITICAL - must run after build)
anchor keys sync

# 3. Verify program IDs
cat Anchor.toml
```

---

## Deploy Token Program (spl-project)

```bash
# 1. Deploy token program to devnet
anchor deploy --program-name spl-project --provider.cluster devnet

# 2. Initialize token program and mint tokens
yarn deploy

# Optional: Customize token parameters
yarn deploy --name "NC Token" --symbol "NC" --decimals 9 --totalSupply 100000000

# 3. Save deployment info
cat deployment-info.json
```

**Save these values:**
- `MINT_ADDRESS` - Token mint address
- `STATE_PDA` - Token state PDA  
- `PROGRAM_ID` - Token program ID

---

## Deploy Governance Program

```bash
# 1. Deploy governance program to devnet
anchor deploy --program-name governance --provider.cluster devnet

# 2. Initialize governance (create script first - see below)
ts-node scripts/init-governance.ts
```

**Create `scripts/init-governance.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Governance as Program<Governance>;
  
  const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    program.programId
  );

  // Configuration
  const REQUIRED_APPROVALS = 2; // Minimum 2-of-N
  const COOLDOWN_PERIOD = 1800; // 30 minutes in seconds
  const SIGNERS = [
    walletKeypair.publicKey, // Add more signer addresses here
    // new PublicKey("SIGNER_2_ADDRESS"),
    // new PublicKey("SIGNER_3_ADDRESS"),
  ];

  console.log("📍 Governance State PDA:", governanceStatePda.toString());
  console.log("🚀 Initializing governance...");
  console.log("   Required Approvals:", REQUIRED_APPROVALS);
  console.log("   Cooldown Period:", COOLDOWN_PERIOD, "seconds");
  console.log("   Signers:", SIGNERS.length);

  const tx = await program.methods
    .initialize(REQUIRED_APPROVALS, new anchor.BN(COOLDOWN_PERIOD), SIGNERS)
    .accounts({
      governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Governance initialized:", tx);
  console.log("📍 Governance State PDA:", governanceStatePda.toString());

  const state = await program.account.governanceState.fetch(governanceStatePda);
  console.log("\n📋 Governance State:");
  console.log("   Authority:", state.authority.toString());
  console.log("   Required Approvals:", state.requiredApprovals.toString());
  console.log("   Cooldown Period:", state.cooldownPeriod.toString());
  console.log("   Signers:", state.signers.length);
}

main().catch(console.error);
```

**Save this value:**
- `GOVERNANCE_STATE_PDA` - Governance state PDA

---

## Transfer Token Authority to Governance

```bash
# After governance is initialized, transfer token authority
ts-node scripts/transfer-authority.ts
```

**Create `scripts/transfer-authority.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplProject } from "../target/types/spl_project";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Load deployment info
  const deploymentInfo = JSON.parse(
    fs.readFileSync("deployment-info.json", "utf-8")
  );
  
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.SplProject as Program<SplProject>;
  
  // Replace with your actual governance state PDA
  const GOVERNANCE_STATE_PDA = new PublicKey("YOUR_GOVERNANCE_STATE_PDA");
  
  const [tokenStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );

  console.log("🚀 Proposing governance change...");
  console.log("   Current Authority:", walletKeypair.publicKey.toString());
  console.log("   New Authority (Governance):", GOVERNANCE_STATE_PDA.toString());

  // Propose governance change
  const proposeTx = await program.methods
    .proposeGovernanceChange(GOVERNANCE_STATE_PDA)
    .accountsPartial({
      state: tokenStatePda,
      authority: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Governance change proposed:", proposeTx);
  console.log("⏳ Wait 7 days cooldown period...");
  console.log("💡 After cooldown, call set_governance() to complete transfer");
}

main().catch(console.error);
```

**Note:** After 7 days, execute the governance change:
```typescript
// After cooldown period (7 days)
await program.methods
  .setGovernance(GOVERNANCE_STATE_PDA)
  .accountsPartial({
    state: tokenStatePda,
    authority: walletKeypair.publicKey,
  })
  .rpc();
```

---

## Deploy Presale Program (Chainlink Oracle Integration)

### Important: Chainlink Oracle Integration

The presale program now uses **Chainlink's on-chain SOL/USD price feed** for dynamic pricing:
- ✅ Real-time SOL/USD price from Chainlink oracle
- ✅ Automatic price updates (no manual price changes needed)
- ✅ Production-grade security (owner validation, staleness checks)

**Chainlink Feed Address:**
- **SOL/USD Feed:** `CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU`
- **Chainlink OCR2 Program:** `HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny`
- **Note:** No devnet feed available - use mainnet feed for both networks
- **Program validates:** Feed owner must be Chainlink OCR2 program (not specific address)

---

### Step 1: Build and Deploy Presale Program

```bash
# 1. Build the program
anchor build

# 2. Deploy to devnet
anchor deploy --program-name presale --provider.cluster devnet

# 3. Verify deployment
solana program show <YOUR_PRESALE_PROGRAM_ID> --url devnet
```

---

### Step 2: Initialize or Migrate Presale

#### Option A: Fresh Deployment (Presale doesn't exist)

```bash
# Set environment for devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json

# Initialize with token price in micro-USD
# Example: $0.001 per token = 1000 micro-USD
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale

# Or with custom price
TOKEN_PRICE_USD_MICRO=10000 anchor run deploy-presale  # $0.01 per token
```

**What this does:**
- ✅ Creates `PresaleState` account with `token_price_usd_micro` field
- ✅ Sets token price in micro-USD (1000 = $0.001 per token)
- ✅ Presale will use Chainlink SOL/USD oracle for dynamic pricing
- ✅ **NO migration needed** - fresh start with new structure

#### Option B: Existing Presale (Check if migration needed)

```bash
# Check current presale state
# If it shows token_price_usd_micro → Already migrated, skip migration
# If it shows tokens_per_sol → Need migration

# If migration is needed:
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing

# If already migrated:
# ✅ No action needed - just verify token_price_usd_micro is set correctly
```

**Migration will:**
1. Reallocate `PresaleState` account if needed
2. Replace `tokens_per_sol` with `token_price_usd_micro`
3. Set USD price per token
4. Verify migration succeeded

---

### Step 3: Start Presale

```bash
# Start the presale (allows purchases)
ts-node scripts/start-presale.ts
```

---

### Step 4: Test Buy with Chainlink Oracle

```bash
# Test buying with 0.1 SOL
# Script automatically uses Chainlink feed address
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ts-node scripts/buy-presale.ts 0.1
```

**Expected:**
- ✅ Transaction succeeds
- ✅ Tokens calculated using real-time Chainlink SOL/USD price
- ✅ Tokens minted to buyer
- ✅ SOL transferred to vault

---

### Step 5: Save Deployment Info

```bash
# View deployment info
cat presale-deployment-info.json
```

**Save these values:**
- `presaleProgramId` - Presale program ID
- `presaleStatePda` - Presale state PDA
- `presaleTokenMint` - Presale token mint address
- `admin` - Admin wallet address

---

## Configure Governance (Link Programs)

```bash
# Set token program in governance
ts-node scripts/set-token-program.ts

# Set presale program in governance
ts-node scripts/set-presale-program.ts
```

**Create `scripts/set-token-program.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const deploymentInfo = JSON.parse(
    fs.readFileSync("deployment-info.json", "utf-8")
  );

  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Governance as Program<Governance>;
  
  const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    program.programId
  );

  const tokenProgramId = new PublicKey(deploymentInfo.programId);

  console.log("🔗 Setting token program in governance...");
  console.log("   Token Program ID:", tokenProgramId.toString());

  const tx = await program.methods
    .setTokenProgram(tokenProgramId)
    .accountsPartial({
      governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Token program set in governance:", tx);
}

main().catch(console.error);
```

**Create `scripts/set-presale-program.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const presaleInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );

  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Governance as Program<Governance>;
  
  const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    program.programId
  );

  const presaleProgramId = new PublicKey(presaleInfo.presaleProgramId);

  console.log("🔗 Setting presale program in governance...");
  console.log("   Presale Program ID:", presaleProgramId.toString());

  const tx = await program.methods
    .setPresaleProgram(presaleProgramId)
    .accountsPartial({
      governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Presale program set in governance:", tx);
}

main().catch(console.error);
```

---

## Setup Presale

```bash
# Allow payment token (e.g., USDC)
ts-node scripts/allow-payment-token.ts

# Start presale
ts-node scripts/start-presale.ts
```

**Create `scripts/allow-payment-token.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const presaleInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );

  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Presale as Program<Presale>;
  
  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    program.programId
  );

  // Replace with actual payment token mint (e.g., USDC devnet mint)
  const PAYMENT_TOKEN_MINT = new PublicKey("YOUR_PAYMENT_TOKEN_MINT");

  const [allowedTokenPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_token"),
      presaleStatePda.toBuffer(),
      PAYMENT_TOKEN_MINT.toBuffer(),
    ],
    program.programId
  );

  console.log("✅ Allowing payment token...");
  console.log("   Payment Token Mint:", PAYMENT_TOKEN_MINT.toString());

  const tx = await program.methods
    .allowPaymentToken(PAYMENT_TOKEN_MINT)
    .accountsPartial({
      presaleState: presaleStatePda,
      allowedToken: allowedTokenPda,
      authority: walletKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Payment token allowed:", tx);
}

main().catch(console.error);
```

**Create `scripts/start-presale.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Presale as Program<Presale>;
  
  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    program.programId
  );

  console.log("🚀 Starting presale...");

  const tx = await program.methods
    .startPresale()
    .accountsPartial({
      presaleState: presaleStatePda,
      admin: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Presale started:", tx);
}

main().catch(console.error);
```

---

## Optional: Revoke Authorities (Production)

```bash
# Revoke mint authority and update authority (makes token immutable)
yarn revoke-authorities

# Or with custom paths:
MINT_ADDRESS=<mint> STATE_PDA=<state_pda> yarn revoke-authorities
```

---

## Quick Reference - All Commands in Order

```bash
# ============================================
# SETUP
# ============================================
solana config set --url devnet
solana airdrop 2 $(solana address)
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

# Transfer Authority (optional)
ts-node scripts/transfer-authority.ts
# Wait 7 days, then execute set_governance

# ============================================
# DEPLOY PRESALE (Chainlink Oracle)
# ============================================
# 1. Deploy program
anchor deploy --program-name presale --provider.cluster devnet

# 2. Initialize (fresh) OR Migrate (existing)
# For fresh deployment:
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
TOKEN_PRICE_USD_MICRO=1000 anchor run deploy-presale

# For existing presale (if needs migration):
TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing

# 3. Start presale
ts-node scripts/start-presale.ts

# 4. Test buy with Chainlink oracle
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ts-node scripts/buy-presale.ts 0.1

# ============================================
# CONFIGURE GOVERNANCE
# ============================================
ts-node scripts/set-token-program.ts
ts-node scripts/set-presale-program.ts

# ============================================
# OPTIONAL: REVOKE AUTHORITIES
# ============================================
yarn revoke-authorities
```

---

## Migration vs Fresh Deployment

### When to Migrate

**Migration is ONLY needed if:**
- ✅ Presale was initialized with old structure (`tokens_per_sol` field)
- ✅ You're upgrading from pre-Chainlink version to Chainlink version
- ✅ Account structure changed (old field → new field)

**Migration is NOT needed if:**
- ✅ Fresh deployment (presale doesn't exist yet)
- ✅ Already migrated (has `token_price_usd_micro` field)
- ✅ Only program logic changed (account structure unchanged)

### How to Check

```bash
# Check if presale state exists and what structure it has
# If account doesn't exist → Fresh deployment (no migration)
# If account has token_price_usd_micro → Already migrated (no migration)
# If account has tokens_per_sol → Needs migration
```

---

## Chainlink Integration Details

### Feed Address
- **SOL/USD Feed:** `CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU`
- **Use for:** Both devnet and mainnet (no devnet feed available)
- **Chainlink OCR2 Program:** `HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny`

### Program Validation
The program validates:
- ✅ Feed owner == Chainlink OCR2 program
- ✅ Feed decimals == 8
- ✅ Price > 0
- ✅ Price staleness < 1 hour

### Client Code
All `buyWithSol` calls must include the Chainlink feed account:

```typescript
const CHAINLINK_SOL_USD_FEED = new PublicKey(
  "CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU"
);

await presaleProgram.methods
  .buyWithSol(solAmount)
  .accounts({
    // ... other accounts ...
    chainlinkFeed: CHAINLINK_SOL_USD_FEED, // ⚠️ REQUIRED
    // ... other accounts ...
  })
  .rpc();
```

---

## Important Notes

1. **Save All PDAs**: Keep `deployment-info.json` and `presale-deployment-info.json` safe
2. **Governance Cooldown**: 7-day cooldown for authority transfer
3. **Replace Placeholders**: Update `YOUR_GOVERNANCE_STATE_PDA` and `YOUR_PAYMENT_TOKEN_MINT` in scripts
4. **Test First**: Always test on devnet before mainnet
5. **Secure Seed Phrases**: Never share or commit seed phrases
6. **Chainlink Feed**: Use mainnet feed address for both devnet and mainnet (no devnet feed available)
7. **Migration**: Only needed if upgrading from old structure (`tokens_per_sol`) to new (`token_price_usd_micro`)
8. **Token Price Format**: `token_price_usd_micro` is in micro-USD (1000 = $0.001 per token)

---

## Production Deployment Checklist

### Pre-Deployment
- [ ] All programs built and tested on devnet
- [ ] Chainlink integration tested and working
- [ ] Migration tested (if applicable)
- [ ] All scripts updated with correct feed addresses
- [ ] Token price (`token_price_usd_micro`) calculated and verified

### Deployment
- [ ] All programs deployed to mainnet
- [ ] Governance initialized with proper signers
- [ ] Token authority transferred to governance
- [ ] Presale initialized or migrated on mainnet
- [ ] Presale configured and started
- [ ] Chainlink feed address verified for mainnet

### Post-Deployment
- [ ] Test buy transaction on mainnet
- [ ] Verify Chainlink oracle pricing works correctly
- [ ] Authorities revoked (if desired)
- [ ] All addresses saved securely
- [ ] Frontend/client code updated with Chainlink feed
- [ ] Documentation updated with production addresses

### Chainlink-Specific
- [ ] Chainlink SOL/USD feed address verified: `CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU`
- [ ] All `buyWithSol` calls include `chainlinkFeed` account
- [ ] Price calculation tested with real Chainlink prices
- [ ] Staleness checks verified (1 hour threshold)

