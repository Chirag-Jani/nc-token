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

## Deploy Presale Program

```bash
# 1. Deploy presale program to devnet
anchor deploy --program-name presale --provider.cluster devnet

# 2. Initialize presale program
yarn deploy:presale

# Optional: Customize presale parameters
yarn deploy:presale --decimals 9 --totalSupply 1000000000

# 3. Save presale deployment info
cat presale-deployment-info.json
```

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
# Setup
solana config set --url devnet
solana airdrop 2 $(solana address)
yarn install

# Build
anchor build
anchor keys sync

# Deploy Token
anchor deploy --program-name spl-project --provider.cluster devnet
yarn deploy

# Deploy Governance
anchor deploy --program-name governance --provider.cluster devnet
ts-node scripts/init-governance.ts

# Transfer Authority
ts-node scripts/transfer-authority.ts
# Wait 7 days, then execute set_governance

# Deploy Presale
anchor deploy --program-name presale --provider.cluster devnet
yarn deploy:presale

# Configure Governance
ts-node scripts/set-token-program.ts
ts-node scripts/set-presale-program.ts

# Setup Presale
ts-node scripts/allow-payment-token.ts
ts-node scripts/start-presale.ts

# Optional: Revoke Authorities
yarn revoke-authorities
```

---

## Important Notes

1. **Save All PDAs**: Keep `deployment-info.json` and `presale-deployment-info.json` safe
2. **Governance Cooldown**: 7-day cooldown for authority transfer
3. **Replace Placeholders**: Update `YOUR_GOVERNANCE_STATE_PDA` and `YOUR_PAYMENT_TOKEN_MINT` in scripts
4. **Test First**: Always test on devnet before mainnet
5. **Secure Seed Phrases**: Never share or commit seed phrases

---

## Production Deployment Checklist

- [ ] All programs built and tested
- [ ] All programs deployed to mainnet
- [ ] Governance initialized with proper signers
- [ ] Token authority transferred to governance
- [ ] Presale configured and started
- [ ] Authorities revoked (if desired)
- [ ] All addresses saved securely
- [ ] Documentation updated with production addresses

