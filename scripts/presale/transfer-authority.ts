import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../../target/types/presale";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Get new authority from command line or environment
  const newAuthorityAddress = process.argv[2] || process.env.NEW_AUTHORITY;
  
  if (!newAuthorityAddress) {
    console.error("❌ Error: New authority address required");
    console.error("   Usage: yarn presale:transfer-authority <NEW_AUTHORITY_ADDRESS>");
    console.error("   Or set: NEW_AUTHORITY=<address> yarn presale:transfer-authority");
    process.exit(1);
  }

  // Load presale deployment info
  let presaleInfo: any;
  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
  }

  // Validate required fields
  if (!presaleInfo.presaleProgramId) {
    throw new Error("❌ presaleProgramId not found in deployment info.");
  }
  if (!presaleInfo.presaleStatePda) {
    throw new Error("❌ presaleStatePda not found in deployment info.");
  }

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || presaleInfo.network || "https://api.devnet.solana.com",
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

  // Load program
  let program: Program<Presale>;
  let expectedProgramId: PublicKey;
  try {
    expectedProgramId = new PublicKey(String(presaleInfo.presaleProgramId).trim());
  } catch (error: any) {
    throw new Error(`❌ Invalid presaleProgramId: ${error.message}`);
  }
  
  try {
    if (!anchor.workspace || !anchor.workspace.Presale) {
      throw new Error("Workspace not available");
    }
    const workspaceProgram = anchor.workspace.Presale as Program<Presale>;
    if (workspaceProgram && workspaceProgram.programId.toString() === expectedProgramId.toString()) {
      program = workspaceProgram;
    } else {
      throw new Error("Program ID mismatch");
    }
  } catch (error) {
    // Fallback: load from IDL
    const possiblePaths = [
      path.join(__dirname, "..", "..", "target", "idl", "presale.json"),
      path.join(process.cwd(), "target", "idl", "presale.json"),
      "target/idl/presale.json"
    ];
    
    let idlPath: string | null = null;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        idlPath = possiblePath;
        break;
      }
    }
    
    if (!idlPath) {
      throw new Error(`❌ IDL not found. Run 'anchor build' first.`);
    }
    
    const idlJson = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    program = new (anchor.Program as any)(idlJson, expectedProgramId, provider) as Program<Presale>;
  }

  // Get presale state PDA
  let presaleStatePda: PublicKey;
  try {
    presaleStatePda = new PublicKey(String(presaleInfo.presaleStatePda).trim());
  } catch (error: any) {
    throw new Error(`❌ Invalid presaleStatePda: ${error.message}`);
  }

  // Validate new authority address
  let newAuthority: PublicKey;
  try {
    newAuthority = new PublicKey(newAuthorityAddress.trim());
  } catch (error: any) {
    throw new Error(`❌ Invalid new authority address: ${error.message}`);
  }

  // Check if new authority is default
  if (newAuthority.equals(PublicKey.default)) {
    throw new Error("❌ New authority cannot be the default pubkey");
  }

  console.log("🔐 Transferring Presale Authority\n");
  console.log("=".repeat(60));
  console.log("");

  // Check current state
  console.log("🔍 Checking current presale state...");
  let currentState;
  try {
    currentState = await program.account.presaleState.fetch(presaleStatePda);
    console.log("   ✅ Presale state found");
    console.log("   Current Authority:", currentState.authority.toString());
    console.log("   Admin (reference):", currentState.admin.toString());
    console.log("   Governance Set:", currentState.governanceSet);
  } catch (error: any) {
    throw new Error(`❌ Failed to fetch presale state: ${error.message}`);
  }

  // Verify current authority matches wallet
  if (currentState.authority.toString() !== walletKeypair.publicKey.toString()) {
    throw new Error(
      `❌ Current authority (${currentState.authority.toString()}) doesn't match your wallet (${walletKeypair.publicKey.toString()}). You must be the current authority to transfer.`
    );
  }

  // Check if governance already set
  if (currentState.governanceSet) {
    throw new Error(
      "❌ Governance already set. Presale authority can only be transferred once and cannot be changed again."
    );
  }

  // Warn if transferring to same address
  if (currentState.authority.toString() === newAuthority.toString()) {
    throw new Error("❌ New authority is the same as current authority. No transfer needed.");
  }

  console.log("");
  console.log("📋 Transfer Details:");
  console.log("   Current Authority:", currentState.authority.toString());
  console.log("   New Authority:", newAuthority.toString());
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("");

  // Confirm transfer
  console.log("⚠️  WARNING: This transfer is IRREVERSIBLE!");
  console.log("   After transfer, the new authority will have full control:");
  console.log("   - Start/pause/stop presale");
  console.log("   - Allow/disallow payment tokens");
  console.log("   - Withdraw funds");
  console.log("   - Update price and caps");
  console.log("");
  console.log("   You will lose all presale control.");
  console.log("");

  // Transfer authority
  console.log("🚀 Transferring authority...");
  try {
    const tx = await program.methods
      .setGovernance(newAuthority)
      .accountsPartial({
        presaleState: presaleStatePda,
        authority: walletKeypair.publicKey,
      })
      .rpc();

    console.log("   ✅ Authority transferred successfully!");
    console.log("   Transaction:", tx);
    console.log("");

    // Verify transfer
    const updatedState = await program.account.presaleState.fetch(presaleStatePda);
    console.log("📋 Updated Presale State:");
    console.log("   Authority:", updatedState.authority.toString());
    console.log("   Governance:", updatedState.governance.toString());
    console.log("   Governance Set:", updatedState.governanceSet);
    console.log("   Admin (reference):", updatedState.admin.toString());
    console.log("");

    if (updatedState.authority.toString() === newAuthority.toString()) {
      console.log("✅ SUCCESS! Presale authority has been transferred.");
      console.log(`   The wallet ${newAuthority.toString()} now has full control.`);
    } else {
      console.error("   ⚠️  WARNING: Authority transfer may not have completed correctly.");
    }
  } catch (error: any) {
    console.error("   ❌ Failed to transfer authority:", error.message);
    if (error.logs) {
      console.error("\nTransaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
