import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

/**
 * Migration Script: Add Pricing to Presale Contract
 * 
 * This script migrates an existing presale contract to include the tokens_per_sol field.
 * It calls the migrate_presale_state function to:
 * 1. Reallocate the PresaleState account to include the new field
 * 2. Set the initial tokens_per_sol rate
 * 
 * Usage:
 *   anchor run migrate-presale-pricing
 * 
 * Or with custom values:
 *   TOKENS_PER_SOL=133000000000000 anchor run migrate-presale-pricing
 */

async function main() {
  console.log("🔄 Starting Presale Pricing Migration...\n");
  console.log("=".repeat(70));

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}`);
  }

  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  // Setup connection
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  console.log("📋 Configuration:");
  console.log("   Network:", connection.rpcEndpoint);
  console.log("   Wallet:", walletKeypair.publicKey.toString());
  console.log("");

  // Load presale program
  const presaleProgram = anchor.workspace.Presale as Program<Presale>;
  console.log("📦 Presale Program ID:", presaleProgram.programId.toString());
  console.log("");

  // Load deployment info
  let presaleStatePda: PublicKey;
  try {
    const presaleInfo = JSON.parse(
      fs.readFileSync("presale-deployment-info.json", "utf-8")
    );
    presaleStatePda = new PublicKey(presaleInfo.presaleStatePda);
    console.log("✅ Loaded presale state PDA from deployment info:", presaleStatePda.toString());
  } catch (err) {
    // Calculate PDA if deployment info doesn't exist
    [presaleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_state")],
      presaleProgram.programId
    );
    console.log("ℹ️  Calculated presale state PDA:", presaleStatePda.toString());
  }
  console.log("");

  // Fetch current state
  console.log("📊 Fetching current presale state...");
  let currentState: any = null;
  let isOldStructure = false;
  let authority: PublicKey;
  
  try {
    // Try to fetch with new structure
    currentState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
    console.log("   ✅ Presale state found (new structure)");
    console.log("   Admin:", currentState.admin.toString());
    console.log("   Authority:", currentState.authority.toString());
    console.log("   Status:", Object.keys(currentState.status)[0]);
    console.log("   Current tokens_per_sol:", currentState.tokensPerSol?.toString() || "0 (not set)");
    authority = currentState.authority;
  } catch (err: any) {
    // If deserialization fails, it's likely the old structure
    if (err.message?.includes("offset") || err.message?.includes("out of range")) {
      console.log("   ℹ️  Detected old account structure (needs migration)");
      isOldStructure = true;
      
      // Fetch raw account data to get authority
      const accountInfo = await connection.getAccountInfo(presaleStatePda);
      if (!accountInfo) {
        throw new Error("Presale state account not found");
      }
      
      // Parse authority from raw data (offset: 8 discriminator + 32 admin = 40, then 32 bytes for authority)
      // Old structure: admin(32) + authority(32) + ... 
      // Actually, let's check: discriminator(8) + admin(32) + authority(32) = offset 72
      const authorityBytes = accountInfo.data.slice(40, 72);
      authority = new PublicKey(authorityBytes);
      
      console.log("   Authority (from raw data):", authority.toString());
      console.log("   Account size:", accountInfo.data.length, "bytes (old structure)");
    } else {
      throw new Error(`Failed to fetch presale state: ${err.message}`);
    }
  }
  console.log("");

  // Check if already migrated
  if (currentState && currentState.tokensPerSol && currentState.tokensPerSol.gt(new anchor.BN(0))) {
    console.log("⚠️  WARNING: tokens_per_sol is already set!");
    console.log("   Current value:", currentState.tokensPerSol.toString());
    console.log("   This script will UPDATE the existing value.");
    console.log("   (Set SKIP_WARNING=true to skip this message)");
    console.log("");
    
    if (process.env.SKIP_WARNING !== 'true') {
      console.log("   Continuing with update in 3 seconds... (Ctrl+C to cancel)");
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log("");
    }
  } else if (isOldStructure) {
    console.log("ℹ️  Account needs migration to new structure");
    console.log("");
  }

  // Get tokens_per_sol from environment or calculate from example
  // Example: NC = $0.001, SOL = $133
  // tokens_per_sol = $133 / $0.001 = 133,000 NC tokens per SOL
  // Stored as: 133_000 * 10^9 = 133_000_000_000_000 (if NC has 9 decimals)
  const DEFAULT_TOKENS_PER_SOL = new anchor.BN(133_000_000_000_000); // 133,000 NC tokens per SOL (with 9 decimals)
  
  let tokensPerSol: anchor.BN;
  if (process.env.TOKENS_PER_SOL) {
    tokensPerSol = new anchor.BN(process.env.TOKENS_PER_SOL);
    console.log("📝 Using TOKENS_PER_SOL from environment:", tokensPerSol.toString());
  } else {
    tokensPerSol = DEFAULT_TOKENS_PER_SOL;
    console.log("📝 Using default TOKENS_PER_SOL:", tokensPerSol.toString());
    console.log("   (Set TOKENS_PER_SOL environment variable to override)");
  }
  console.log("");

  // Verify authority
  const walletAuthority = walletKeypair.publicKey;
  const isAdmin = authority.equals(walletAuthority);
  
  // For governance check, we need to fetch it from raw data if old structure
  let isGovernance = false;
  if (!isOldStructure && currentState) {
    isGovernance = currentState.governanceSet && currentState.governance.equals(walletAuthority);
  } else if (isOldStructure) {
    // Try to get governance from raw data (offset after authority + governance + token_program + token_program_state + mint + status)
    // This is complex, so we'll just check if authority matches
    // If governance is set, it would be at a specific offset, but for simplicity, we'll rely on authority check
    console.log("   ℹ️  Governance check skipped for old structure (will use authority check)");
  }
  
  if (!isAdmin && !isGovernance) {
    throw new Error(
      `Current wallet (${authority.toString()}) is not authorized.\n` +
      `Required: Admin (${currentState.authority.toString()}) or Governance (${currentState.governance.toString()})`
    );
  }

  console.log("🔐 Authorization:");
  console.log("   Wallet:", walletAuthority.toString());
  console.log("   Account Authority:", authority.toString());
  if (isAdmin) {
    console.log("   ✅ Authorized as Admin");
  } else if (isGovernance) {
    console.log("   ✅ Authorized as Governance");
  } else {
    throw new Error(
      `Current wallet (${walletAuthority.toString()}) is not authorized.\n` +
      `Required: Admin (${authority.toString()}) or Governance`
    );
  }
  console.log("");

  // Perform migration
  console.log("🚀 Executing migration...");
  console.log("   This will:");
  console.log("   1. Reallocate PresaleState account to include tokens_per_sol field");
  console.log("   2. Set tokens_per_sol to:", tokensPerSol.toString());
  console.log("");

  try {
    const migrateTx = await presaleProgram.methods
      .migratePresaleState(tokensPerSol)
      .accountsPartial({
        presaleState: presaleStatePda,
        authority: walletAuthority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   ✅ Migration transaction:", migrateTx);
    console.log("");

    // Verify migration
    console.log("🔍 Verifying migration...");
    const updatedState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
    console.log("   ✅ Migration successful!");
    console.log("   New tokens_per_sol:", updatedState.tokensPerSol.toString());
    console.log("");

    // Calculate example
    const LAMPORTS_PER_SOL = new anchor.BN(1_000_000_000);
    const exampleSolAmount = new anchor.BN(1_000_000_000); // 1 SOL
    const exampleTokens = exampleSolAmount
      .mul(updatedState.tokensPerSol)
      .div(LAMPORTS_PER_SOL);
    
    console.log("📊 Example Calculation:");
    console.log("   For 1 SOL (1,000,000,000 lamports):");
    console.log("   Tokens = (1,000,000,000 ×", updatedState.tokensPerSol.toString(), ") / 1,000,000,000");
    console.log("   Tokens =", exampleTokens.toString(), "base units");
    console.log("");

    console.log("=".repeat(70));
    console.log("✅ Migration completed successfully!");
    console.log("=".repeat(70));

  } catch (err: any) {
    console.error("❌ Migration failed:", err.message);
    if (err.logs) {
      console.error("   Program logs:");
      err.logs.forEach((log: string) => console.error("   ", log));
    }
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

