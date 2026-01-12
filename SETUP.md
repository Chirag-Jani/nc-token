# Complete Setup Guide - Deploying All Programs to Devnet

This guide walks you through deploying and setting up all three programs (Token, Governance, Presale) on Solana devnet from start to finish.

---

## 📋 Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Setup](#2-environment-setup)
3. [Build Programs](#3-build-programs)
4. [Deploy Token Program](#4-deploy-token-program)
5. [Deploy Governance Program](#5-deploy-governance-program)
6. [Deploy Presale Program](#6-deploy-presale-program)
7. [Setup Governance](#7-setup-governance)
8. [Transfer Token Authority to Governance](#8-transfer-token-authority-to-governance)
9. [Setup Presale](#9-setup-presale)
10. [Optional: Revoke Authorities](#10-optional-revoke-authorities)

---

## 1. Prerequisites

### Required Software

**Install Solana CLI:**
```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

**What this does:** Installs the Solana command-line tools needed to interact with Solana networks.

**Install Anchor Framework:**
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

**What this does:** Installs Anchor, the framework used to build Solana programs. `avm` is the Anchor Version Manager.

**Install Node.js and Yarn:**
```bash
# Install Node.js (v18 or later)
# Then install Yarn
npm install -g yarn
```

**What this does:** Node.js is required for running TypeScript deployment scripts. Yarn is the package manager used in this project.

### Verify Installations

```bash
solana --version
anchor --version
node --version
yarn --version
```

**What this does:** Verifies all required tools are installed and accessible.

---

## 2. Environment Setup

### 2.1 Configure Solana CLI for Devnet

```bash
solana config set --url devnet
```

**What this does:** Sets Solana CLI to use devnet instead of mainnet. This is safer for testing.

### 2.2 Generate or Use Existing Wallet

**Option A: Use existing wallet (if you have one):**
```bash
# Your wallet should be at: ~/.config/solana/id.json
solana address
```

**Option B: Generate new wallet:**
```bash
solana-keygen new --outfile ~/.config/solana/id.json
```

**What this does:** Creates a new keypair file that will be used to sign transactions. Save the seed phrase securely!

### 2.3 Airdrop SOL to Wallet (Devnet Only)

```bash
solana airdrop 2 $(solana address)
```

**What this does:** Requests 2 SOL from the devnet faucet. You need SOL to pay for transaction fees. Repeat if needed.

**Verify balance:**
```bash
solana balance
```

**What this does:** Shows your current SOL balance. You should have at least 1-2 SOL for deployment.

### 2.4 Set Environment Variables (Optional)

```bash
# Set wallet path (if different from default)
export ANCHOR_WALLET=~/.config/solana/id.json

# Set network (if different from Anchor.toml)
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
```

**What this does:** Sets environment variables that deployment scripts will use. This is optional if using default paths.

### 2.5 Install Project Dependencies

```bash
yarn install
```

**What this does:** Installs all Node.js dependencies defined in `package.json`, including Anchor, Solana web3.js, and SPL token libraries.

---

## 3. Build Programs

### 3.1 Build All Programs

```bash
anchor build
```

**What this does:** 
- Compiles all three Rust programs (spl-project, governance, presale)
- Generates TypeScript types and IDL files
- Creates program keypairs in `target/deploy/`
- Takes 2-5 minutes on first build

**Expected output:**
```
✅ Compiled program successfully
```

### 3.2 Sync Program IDs (Important!)

```bash
anchor keys sync
```

**What this does:** 
- Reads program IDs from `target/deploy/*-keypair.json` files
- Updates `declare_id!()` macros in each program's `lib.rs`
- Updates `Anchor.toml` with correct program IDs
- **CRITICAL:** Must run this after building to ensure IDs match

**Verify sync:**
```bash
# Check that Anchor.toml has the correct program IDs
cat Anchor.toml
```

---

## 4. Deploy Token Program

### 4.1 Deploy to Devnet

```bash
anchor deploy --provider.cluster devnet
```

**What this does:** 
- Deploys the token program (spl-project) to devnet
- Uploads the compiled program binary
- Creates the program account on-chain
- Costs ~2-3 SOL in rent (devnet SOL is free)

**Alternative: Deploy only token program:**
```bash
anchor deploy --program-name spl-project --provider.cluster devnet
```

**Expected output:**
```
Deploying cluster: https://api.devnet.solana.com
Upgrade authority: <your-wallet-address>
Deploying program "spl-project"...
Program Id: <program-id>
Deploy success
```

### 4.2 Initialize Token Program

```bash
yarn deploy
```

**What this does:**
- Runs `scripts/deploy.ts`
- Initializes the token program state with max supply cap (100 million tokens)
- Creates token mint account
- Creates token metadata
- Transfers mint authority to state PDA
- Mints initial token supply to your wallet (up to 100 million)
- Saves deployment info to `deployment-info.json`

**Customize token parameters (optional):**
```bash
yarn deploy --name "MyToken" --symbol "MTK" --decimals 9 --totalSupply 100000000
```

**What each parameter does:**
- `--name`: Token name (e.g., "MyToken")
- `--symbol`: Token symbol (e.g., "MTK")
- `--decimals`: Number of decimal places (0-9, typically 9)
- `--totalSupply`: Total supply in base units (before decimals). Default is 100 million (100,000,000)
- **Note**: The max supply cap is automatically set to 100 million tokens during initialization

**Expected output:**
```
🚀 Starting deployment...
📝 Wallet: <your-wallet>
🌐 Network: https://api.devnet.solana.com
📦 Program ID: <program-id>
📍 State PDA: <state-pda>
1️⃣ Initializing program state with max supply cap (100 million)...
   ✅ State initialized with max supply cap: <tx-signature>
2️⃣ Creating token mint...
   ✅ Mint created: <mint-address>
3️⃣ Creating token metadata...
   ✅ Metadata created: <metadata-address>
4️⃣ Transferring mint authority to state PDA...
   ✅ Mint authority transferred
5️⃣ Creating token account...
   ✅ Token account created: <token-account>
6️⃣ Minting total supply...
   ✅ Minting completed!
   💰 Final balance: <amount> tokens
✅ Deployment complete!
```

**Save these values for later:**
- `MINT_ADDRESS`: The token mint address
- `STATE_PDA`: The token program state PDA
- `PROGRAM_ID`: The token program ID

---

## 5. Deploy Governance Program

### 5.1 Deploy to Devnet

```bash
anchor deploy --program-name governance --provider.cluster devnet
```

**What this does:**
- Deploys the governance program to devnet
- Uploads the compiled program binary
- Creates the program account on-chain

**Expected output:**
```
Deploying program "governance"...
Program Id: <governance-program-id>
Deploy success
```

### 5.2 Initialize Governance Program

**Create a TypeScript script or use Anchor CLI:**

**Option A: Using Anchor test framework (recommended for first time):**

Create `scripts/init-governance.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Setup
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
anchor.setProvider(provider);

  const governanceProgram = anchor.workspace.Governance as Program<Governance>;

// Derive governance state PDA
const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_state")],
  governanceProgram.programId
);

  console.log("📍 Governance State PDA:", governanceStatePda.toString());

  // Configuration
  const requiredApprovals = 2; // Minimum 2 approvals required
  const cooldownPeriod = 1800; // 30 minutes in seconds
  const signers = [
    walletKeypair.publicKey, // Add your signer addresses here
    // Add more signers: new PublicKey("..."),
  ];

  console.log("🚀 Initializing governance...");
  console.log("   Required Approvals:", requiredApprovals);
  console.log("   Cooldown Period:", cooldownPeriod, "seconds");
  console.log("   Signers:", signers.length);

  // Initialize
const tx = await governanceProgram.methods
    .initialize(requiredApprovals, new anchor.BN(cooldownPeriod), signers)
  .accounts({
    governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

  console.log("✅ Governance initialized:", tx);

  // Fetch and display state
const state = await governanceProgram.account.governanceState.fetch(
  governanceStatePda
);
  console.log("\n📋 Governance State:");
  console.log("   Authority:", state.authority.toString());
  console.log("   Required Approvals:", state.requiredApprovals.toString());
  console.log("   Cooldown Period:", state.cooldownPeriod.toString());
  console.log("   Signers:", state.signers.length);
}

main().catch(console.error);
```

**Run the script:**
```bash
ts-node scripts/init-governance.ts
```

**What this does:**
- Initializes the governance program with multisig configuration
- Sets minimum required approvals (2)
- Sets cooldown period (30 minutes)
- Registers authorized signers
- Creates the governance state PDA

**Expected output:**
```
📍 Governance State PDA: <governance-state-pda>
🚀 Initializing governance...
   Required Approvals: 2
   Cooldown Period: 1800 seconds
   Signers: 1
✅ Governance initialized: <tx-signature>
```

**Save the Governance State PDA for later steps.**

---

## 6. Deploy Presale Program

### 6.1 Deploy to Devnet

```bash
anchor deploy --program-name presale --provider.cluster devnet
```

**What this does:**
- Deploys the presale program to devnet
- Uploads the compiled program binary
- Creates the program account on-chain

**Expected output:**
```
Deploying program "presale"...
Program Id: <presale-program-id>
Deploy success
```

### 6.2 Initialize Presale Program

```bash
yarn deploy:presale
```

**What this does:**
- Runs `scripts/deploy-presale.ts`
- Checks that token program is initialized
- Creates presale token mint
- Initializes presale program state
- Creates presale token vault
- Funds vault with presale tokens
- Saves deployment info to `presale-deployment-info.json`

**Customize presale parameters (optional):**
```bash
yarn deploy:presale --decimals 9 --totalSupply 1000000000
```

**What each parameter does:**
- `--decimals`: Presale token decimals (typically 9)
- `--totalSupply`: Presale token supply to mint to vault

**Expected output:**
```
🚀 Starting presale deployment...
📝 Wallet: <your-wallet>
🌐 Network: https://api.devnet.solana.com
📦 Presale Program ID: <presale-program-id>
📦 Token Program ID: <token-program-id>
📍 Presale State PDA: <presale-state-pda>
📍 Token State PDA: <token-state-pda>
1️⃣ Checking token program state...
   ✅ Token program state found
2️⃣ Creating presale token mint...
   ✅ Presale token mint created: <presale-mint>
3️⃣ Initializing presale program...
   ✅ Presale initialized: <tx-signature>
4️⃣ Creating presale token vault...
   ✅ Presale token vault created
5️⃣ Funding presale token vault...
   ✅ Funded vault with <amount> tokens
✅ Presale deployment complete!
```

**Save these values for later:**
- `PRESALE_PROGRAM_ID`: The presale program ID
- `PRESALE_STATE_PDA`: The presale state PDA
- `PRESALE_TOKEN_MINT`: The presale token mint address

---

## 7. Setup Governance

### 7.1 Set Token Program in Governance

**Create `scripts/setup-governance.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Setup (same as init-governance.ts)
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  const tokenProgram = anchor.workspace.SplProject;

  // Load deployment info
  const deploymentInfo = JSON.parse(
    fs.readFileSync("deployment-info.json", "utf-8")
  );
  const tokenProgramId = new PublicKey(deploymentInfo.programId);

  // Derive PDAs
const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_state")],
  governanceProgram.programId
);

  console.log("🔗 Setting token program in governance...");
  console.log("   Token Program ID:", tokenProgramId.toString());

  // Set token program
  const tx1 = await governanceProgram.methods
    .setTokenProgram(tokenProgramId)
  .accounts({
    governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
  })
  .rpc();

  console.log("✅ Token program set:", tx1);

  // Set presale program (if presale is deployed)
  const presaleDeploymentInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );
  const presaleProgramId = new PublicKey(presaleDeploymentInfo.presaleProgramId);

  console.log("\n🔗 Setting presale program in governance...");
  console.log("   Presale Program ID:", presaleProgramId.toString());

  const tx2 = await governanceProgram.methods
    .setPresaleProgram(presaleProgramId)
  .accounts({
    governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
  })
  .rpc();

  console.log("✅ Presale program set:", tx2);
}

main().catch(console.error);
```

**Run the script:**
```bash
ts-node scripts/setup-governance.ts
```

**What this does:**
- Links governance to the token program
- Links governance to the presale program
- Enables governance to execute transactions on both programs

**Expected output:**
```
🔗 Setting token program in governance...
   Token Program ID: <token-program-id>
✅ Token program set: <tx-signature>

🔗 Setting presale program in governance...
   Presale Program ID: <presale-program-id>
✅ Presale program set: <tx-signature>
```

---

## 8. Transfer Token Authority to Governance

### 8.1 Transfer Authority

**Create `scripts/transfer-authority.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplProject } from "../target/types/spl_project";
import { Governance } from "../target/types/governance";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Setup
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const tokenProgram = anchor.workspace.SplProject as Program<SplProject>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;

  // Load deployment info
  const deploymentInfo = JSON.parse(
    fs.readFileSync("deployment-info.json", "utf-8")
  );
  const statePda = new PublicKey(deploymentInfo.statePda);

  // Derive governance state PDA
const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_state")],
  governanceProgram.programId
);

  console.log("🔄 Transferring token authority to governance...");
  console.log("   Current Authority:", walletKeypair.publicKey.toString());
  console.log("   New Authority (Governance PDA):", governanceStatePda.toString());

  // Transfer authority
const tx = await tokenProgram.methods
    .setGovernance(governanceStatePda)
  .accounts({
      state: statePda,
      authority: walletKeypair.publicKey,
  })
  .rpc();

  console.log("✅ Authority transferred:", tx);

  // Verify
  const state = await tokenProgram.account.tokenState.fetch(statePda);
  console.log("\n📋 New Token State Authority:", state.authority.toString());
  console.log("   ✅ Authority transfer confirmed!");
}

main().catch(console.error);
```

**Run the script:**
```bash
ts-node scripts/transfer-authority.ts
```

**What this does:**
- Transfers token program authority from your wallet to the governance PDA
- This is a one-time operation
- After this, only governance can control token functions

**Expected output:**
```
🔄 Transferring token authority to governance...
   Current Authority: <your-wallet>
   New Authority (Governance PDA): <governance-state-pda>
✅ Authority transferred: <tx-signature>

📋 New Token State Authority: <governance-state-pda>
   ✅ Authority transfer confirmed!
```

---

## 9. Setup Presale

### 9.1 Set Governance in Presale

**Create `scripts/setup-presale.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { Governance } from "../target/types/governance";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Setup
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const presaleProgram = anchor.workspace.Presale as Program<Presale>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;

  // Load deployment info
  const presaleDeploymentInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );
  const presaleStatePda = new PublicKey(presaleDeploymentInfo.presaleStatePda);

  // Derive governance state PDA
  const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_state")],
    governanceProgram.programId
  );

  console.log("🔗 Setting governance in presale...");
  console.log("   Governance PDA:", governanceStatePda.toString());

  // Set governance
  const tx = await presaleProgram.methods
    .setGovernance(governanceStatePda)
  .accounts({
      presaleState: presaleStatePda,
      authority: walletKeypair.publicKey,
    })
  .rpc();

  console.log("✅ Governance set in presale:", tx);
}

main().catch(console.error);
```

**Run the script:**
```bash
ts-node scripts/setup-presale.ts
```

**What this does:**
- Links presale to governance PDA
- Enables governance to control presale functions (treasury, withdrawals)

### 9.2 Allow Payment Token (USDC/USDT)

**Create `scripts/allow-payment-token.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Setup (same as above)
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const presaleProgram = anchor.workspace.Presale as Program<Presale>;

  // Load deployment info
  const presaleDeploymentInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );
  const presaleStatePda = new PublicKey(presaleDeploymentInfo.presaleStatePda);

  // USDC Devnet Mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  // USDT Devnet Mint: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
  // Or create your own test token mint
  const paymentTokenMint = new PublicKey(
    process.env.PAYMENT_TOKEN_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  );

// Derive allowed token PDA
const [allowedTokenPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("allowed_token"),
    presaleStatePda.toBuffer(),
      paymentTokenMint.toBuffer(),
  ],
  presaleProgram.programId
);

  console.log("✅ Allowing payment token...");
  console.log("   Payment Token Mint:", paymentTokenMint.toString());

// Allow payment token
const tx = await presaleProgram.methods
    .allowPaymentToken(paymentTokenMint)
  .accounts({
    presaleState: presaleStatePda,
    allowedToken: allowedTokenPda,
      admin: walletKeypair.publicKey,
      paymentTokenMintAccount: paymentTokenMint,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

  console.log("✅ Payment token allowed:", tx);
}

main().catch(console.error);
```

**Run the script:**
```bash
# For USDC devnet
PAYMENT_TOKEN_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v ts-node scripts/allow-payment-token.ts

# For USDT devnet
PAYMENT_TOKEN_MINT=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB ts-node scripts/allow-payment-token.ts
```

**What this does:**
- Registers a payment token (USDC/USDT) as allowed for presale purchases
- Users can only buy presale tokens with allowed payment tokens

### 9.3 Set Treasury Address (via Multisig)

**Treasury address must be set via governance multisig. See section 9.4 for multisig flow.**

**Or set directly (if admin still has authority):**

```typescript
// In setup-presale.ts, add:
const treasuryAddress = new PublicKey("YOUR_PHANTOM_WALLET_ADDRESS");

const tx = await presaleProgram.methods
  .setTreasuryAddress(treasuryAddress)
  .accounts({
    presaleState: presaleStatePda,
    authority: walletKeypair.publicKey,
  })
  .rpc();

console.log("✅ Treasury address set:", tx);
```

**What this does:**
- Sets the treasury wallet address where withdrawn funds will be sent
- Can be a Phantom wallet, multisig, or any Solana address

### 9.4 Set Treasury Address via Multisig (Recommended)

**Step 1: Queue Transaction**

```typescript
// Create scripts/queue-set-treasury.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Setup (same as above)
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const governanceProgram = anchor.workspace.Governance as Program<Governance>;

  // Load deployment info
  const presaleDeploymentInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );
  const presaleStatePda = new PublicKey(presaleDeploymentInfo.presaleStatePda);

  // Derive PDAs
const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_state")],
  governanceProgram.programId
);

  const treasuryAddress = new PublicKey(
    process.env.TREASURY_ADDRESS || "YOUR_PHANTOM_WALLET_ADDRESS"
  );

  // Derive transaction PDA
  const governanceState = await governanceProgram.account.governanceState.fetch(
    governanceStatePda
  );
  const nextTxId = governanceState.nextTransactionId;
  const [transactionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("transaction"), Buffer.from(nextTxId.toString())],
    governanceProgram.programId
  );

  console.log("📝 Queuing set treasury address transaction...");
  console.log("   Treasury Address:", treasuryAddress.toString());
  console.log("   Transaction ID:", nextTxId.toString());

  // Queue transaction
  const txId = await governanceProgram.methods
    .queueSetTreasuryAddress(treasuryAddress)
    .accounts({
      governanceState: governanceStatePda,
      transaction: transactionPda,
      initiator: walletKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

console.log("✅ Transaction queued:", txId);
  console.log("   Transaction ID:", nextTxId.toString());
  console.log("\n📋 Next Steps:");
  console.log("   1. Get approvals from other signers");
  console.log("   2. Wait for cooldown period (30 minutes)");
  console.log("   3. Execute transaction");
}

main().catch(console.error);
```

**Run:**
```bash
TREASURY_ADDRESS=YOUR_PHANTOM_WALLET_ADDRESS ts-node scripts/queue-set-treasury.ts
```

**Step 2: Approve Transaction**

```typescript
// Each signer runs this (scripts/approve-transaction.ts)
const txId = new anchor.BN(1); // Use the transaction ID from step 1

const [transactionPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("transaction"), Buffer.from(txId.toString())],
  governanceProgram.programId
);

await governanceProgram.methods
  .approveTransaction(txId)
  .accounts({
    governanceState: governanceStatePda,
    transaction: transactionPda,
    signer: walletKeypair.publicKey,
  })
  .rpc();
```

**Step 3: Wait for Cooldown (30 minutes minimum)**

**Step 4: Execute Transaction**

```typescript
// scripts/execute-transaction.ts
await governanceProgram.methods
  .executeTransaction(txId)
  .accounts({
    // ... all required accounts (see governance program)
  })
  .rpc();
```

### 9.5 Start Presale

**Create `scripts/start-presale.ts`:**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Setup (same as above)
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const presaleProgram = anchor.workspace.Presale as Program<Presale>;

  // Load deployment info
  const presaleDeploymentInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );
  const presaleStatePda = new PublicKey(presaleDeploymentInfo.presaleStatePda);

  console.log("🚀 Starting presale...");

  // Start presale
  const tx = await presaleProgram.methods
    .startPresale()
    .accounts({
      presaleState: presaleStatePda,
      admin: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Presale started:", tx);

  // Verify
  const state = await presaleProgram.account.presaleState.fetch(
    presaleStatePda
  );
  console.log("   Status:", Object.keys(state.status)[0]);
}

main().catch(console.error);
```

**Run:**
```bash
ts-node scripts/start-presale.ts
```

**What this does:**
- Changes presale status from `NotStarted` to `Active`
- Users can now buy presale tokens

---

## 10. Optional: Revoke Authorities

### 10.1 Revoke Mint and Update Authorities

**After everything is set up and tested, revoke authorities to lock the token:**

```bash
yarn revoke-authorities
```

**Or manually:**
```bash
ts-node scripts/revoke-authorities.ts
```

**What this does:**
- Revokes mint authority (no more tokens can be minted)
- Revokes metadata update authority (metadata is immutable)
- **WARNING:** This is irreversible! Only do this after thorough testing.

**Expected output:**
```
🔐 Revoking Mint and Update Authorities
1️⃣ Revoking Mint Authority...
   ✅ Mint authority revoked!
2️⃣ Revoking Update Authority (Metadata)...
   ✅ Update authority revoked!
✅ Done! Both authorities have been revoked.
```

---


***COMMANDS LIST****
```
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


# Deploy Governance Program
anchor deploy --program-name governance --provider.cluster devnet
yarn deploy:governance

# Link Token Program to Governance
ts-node scripts/set-token-program.ts

# Deploy Presale Program
anchor deploy --program-name presale --provider.cluster devnet
yarn deploy:presale

# Link Presale Program to Governance
ts-node scripts/set-presale-program.ts

# Optional: Transfer Token Authority to Governance (7-day cooldown)
ts-node scripts/transfer-authority.ts
# Note: After 7 days, execute the governance change

# Setup Presale (when ready)
ts-node scripts/allow-payment-token.ts <PAYMENT_TOKEN_MINT>
ts-node scripts/start-presale.ts

# Optional: Revoke Authorities (production hardening)
yarn revoke-authorities
```

```
yarn deploy:governance --requiredApprovals 1

# Option 1: Use same wallet twice (for testing only)
yarn deploy:governance --signers "4rRhV7DQJMdNAJVh59qggwhEgnmKsTrggPXQeT2oekzu,4rRhV7DQJMdNAJVh59qggwhEgnmKsTrggPXQeT2oekzu" --requiredApprovals 2

# Option 2: Add actual different signer addresses
yarn deploy:governance --signers "4rRhV7DQJMdNAJVh59qggwhEgnmKsTrggPXQeT2oekzu,DimxbGaHQmydurzk3z7X3HV5LmhBKPrkNTxGnyyUDMW6" --requiredApprovals 2

# Option 3: Using environment variable
SIGNERS="4rRhV7DQJMdNAJVh59qggwhEgnmKsTrggPXQeT2oekzu,DimxbGaHQmydurzk3z7X3HV5LmhBKPrkNTxGnyyUDMW6" REQUIRED_APPROVALS=2 yarn deploy:governance

```

```
# Step 1: Generate new program ID
cd /mnt/c/Dev/Jani/nc-token
rm -f target/deploy/presale-keypair.json
solana-keygen new --outfile target/deploy/presale-keypair.json --force --no-bip39-passphrase
NEW_PROGRAM_ID=$(solana-keygen pubkey target/deploy/presale-keypair.json)
echo "New Program ID: $NEW_PROGRAM_ID"
# Copy this ID - you'll need it!

# Step 2: Update programs/presale/src/lib.rs (line 37)
# Replace the old declare_id! with: declare_id!("$NEW_PROGRAM_ID");

# Step 3: Update Anchor.toml (line 10)  
# Replace the old presale ID with: presale = "$NEW_PROGRAM_ID"

# Step 4: Build
anchor build
anchor keys sync

# Step 5: Deploy
anchor deploy --program-name presale --provider.cluster devnet

# Step 6: Reinitialize (uses main mint now)
yarn deploy:presale

# Step 7: Verify
ts-node scripts/check-presale-state.ts

# Step 8: Transfer 40M tokens
ts-node scripts/fund-presale-vault.ts 40000000

# Step 9: Link to governance
ts-node scripts/set-presale-program.ts

# Step 10: Start presale
ts-node scripts/start-presale.ts

# Step 11: Test purchase
ts-node scripts/buy-presale.ts 0.1
```

## 📝 Summary Checklist

- [ ] Prerequisites installed (Solana CLI, Anchor, Node.js, Yarn)
- [ ] Wallet configured and funded with SOL
- [ ] All programs built (`anchor build`)
- [ ] Program IDs synced (`anchor keys sync`)
- [ ] Token program deployed and initialized
- [ ] Governance program deployed and initialized
- [ ] Presale program deployed and initialized
- [ ] Governance linked to token and presale programs
- [ ] Token authority transferred to governance
- [ ] Presale governance set
- [ ] Payment tokens allowed
- [ ] Treasury address set (via multisig or admin)
- [ ] Presale started
- [ ] (Optional) Authorities revoked

---

## 🔍 Verification Commands

**Check program deployments:**
```bash
solana program show <PROGRAM_ID> --url devnet
```

**Check token state:**
```bash
# View token info
spl-token display <MINT_ADDRESS> --url devnet

# Check your token balance
spl-token balance <MINT_ADDRESS> --url devnet
```

**Check governance state:**
```typescript
// In a script
const state = await governanceProgram.account.governanceState.fetch(governanceStatePda);
console.log(state);
```

**Check presale state:**
```typescript
// In a script
const state = await presaleProgram.account.presaleState.fetch(presaleStatePda);
console.log(state);
```

---

## 🐛 Troubleshooting

### Error: "Program ID mismatch"
**Solution:** Run `anchor keys sync` and rebuild

### Error: "Insufficient funds"
**Solution:** Airdrop more SOL: `solana airdrop 2 $(solana address)`

### Error: "Account not found"
**Solution:** Ensure you've initialized the program state before calling functions

### Error: "Unauthorized"
**Solution:** Check that you're using the correct authority (admin or governance PDA)

### Error: "Transaction simulation failed"
**Solution:** Check account requirements and ensure all PDAs are derived correctly

---

## 📚 Additional Resources

- [Solana Documentation](https://docs.solana.com/)
- [Anchor Documentation](https://www.anchor-lang.com/)
- [SPL Token Documentation](https://spl.solana.com/token)
- [Solana Cookbook](https://solanacookbook.com/)

---

## 🎉 You're Done!

Your complete token ecosystem is now deployed on devnet:
- ✅ Token program with governance control
- ✅ Multisig governance system
- ✅ Presale contract with treasury management

Users can now:
- Buy presale tokens with allowed payment tokens
- Funds accumulate in PDA vaults
- Treasury withdrawals require multisig approval

**Next Steps:**
1. Test all functions thoroughly
2. Set up frontend integration
3. Deploy to mainnet (when ready)

---

**Need Help?** Check the project documentation or open an issue.

