import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../../target/types/presale";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Load presale deployment info
  let presaleInfo: any;
  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
  }

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || presaleInfo.network || "https://api.mainnet-beta.solana.com",
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

  // Load program from workspace (same as check-presale-state.ts)
  const program = anchor.workspace.Presale as Program<Presale>;
  
  if (!program) {
    throw new Error("❌ Presale program not found in workspace. Run 'anchor build' first.");
  }
  
  // Verify program ID matches deployment
  const expectedProgramId = new PublicKey(String(presaleInfo.presaleProgramId).trim());
  if (program.programId.toString() !== expectedProgramId.toString()) {
    throw new Error(`❌ Program ID mismatch. Expected ${expectedProgramId.toString()}, got ${program.programId.toString()}`);
  }

  // Get presale state PDA
  let presaleStatePda: PublicKey;
  try {
    presaleStatePda = new PublicKey(String(presaleInfo.presaleStatePda).trim());
  } catch (error: any) {
    throw new Error(`❌ Invalid presaleStatePda: ${error.message}`);
  }

  console.log("🔍 Checking Presale Authority Status\n");
  console.log("=".repeat(70));
  console.log("");

  // Check current state
  let currentState;
  try {
    currentState = await program.account.presaleState.fetch(presaleStatePda);
    console.log("✅ Presale state found");
    console.log("");
  } catch (error: any) {
    throw new Error(`❌ Failed to fetch presale state: ${error.message}`);
  }

  console.log("📋 Current Authority Information:");
  console.log("   Admin (original):", currentState.admin.toString());
  console.log("   Current Authority:", currentState.authority.toString());
  console.log("   Governance Address:", currentState.governance.toString());
  console.log("   Governance Set:", currentState.governanceSet ? "✅ YES" : "❌ NO");
  console.log("");
  console.log("   Your Wallet:", walletKeypair.publicKey.toString());
  console.log("   Match with Authority:", 
    currentState.authority.toString() === walletKeypair.publicKey.toString() ? "✅ YES" : "❌ NO");
  console.log("");

  // Determine situation
  if (currentState.governanceSet) {
    console.log("⚠️  CRITICAL: Governance is already set!");
    console.log("");
    console.log("   The presale authority can only be transferred ONCE.");
    console.log("   Since governance_set = true, the authority CANNOT be changed again.");
    console.log("");
    console.log("   Current Authority:", currentState.authority.toString());
    console.log("");
    
    if (currentState.authority.toString() === walletKeypair.publicKey.toString()) {
      console.log("   ✅ You ARE the current authority.");
      console.log("   ⚠️  However, you cannot transfer it again (one-time only).");
    } else {
      console.log("   ❌ You are NOT the current authority.");
      console.log("");
      console.log("   💡 OPTIONS:");
      console.log("   1. If you have access to the wrong address:");
      console.log("      - Use that wallet to sign transactions");
      console.log("      - Or contact the owner of that address");
      console.log("");
      console.log("   2. If you don't have access:");
      console.log("      - The authority is permanently locked to:", currentState.authority.toString());
      console.log("      - You may need to redeploy the presale program");
      console.log("      - Or contact Solana support if this is a critical issue");
    }
  } else {
    console.log("✅ GOOD NEWS: Governance is NOT set yet!");
    console.log("");
    console.log("   You can still transfer the authority using set_governance.");
    console.log("");
    
    if (currentState.authority.toString() === walletKeypair.publicKey.toString()) {
      console.log("   ✅ You ARE the current authority.");
      console.log("   ✅ You can transfer authority to the correct address.");
      console.log("");
      console.log("   📝 To transfer, run:");
      console.log("      yarn presale:transfer-authority <CORRECT_AUTHORITY_ADDRESS>");
      console.log("");
      console.log("   ⚠️  WARNING: This is a ONE-TIME operation!");
      console.log("      After transfer, you cannot change it again.");
    } else {
      console.log("   ❌ You are NOT the current authority.");
      console.log("   ❌ You need the current authority wallet to transfer.");
      console.log("");
      console.log("   Current Authority:", currentState.authority.toString());
      console.log("   Your Wallet:", walletKeypair.publicKey.toString());
      console.log("");
      console.log("   💡 SOLUTION:");
      console.log("   1. Load the wallet that matches the current authority");
      console.log("   2. Then run: yarn presale:transfer-authority <CORRECT_AUTHORITY_ADDRESS>");
    }
  }
  
  console.log("");
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
