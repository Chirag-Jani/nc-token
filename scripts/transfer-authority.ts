import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplProject } from "../target/types/spl_project";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Load deployment info
  let deploymentInfo: any = {};
  try {
    deploymentInfo = JSON.parse(
      fs.readFileSync("deployment-info.json", "utf-8")
    );
  } catch (error) {
    console.error("❌ Error: deployment-info.json not found. Run 'yarn deploy' first.");
    process.exit(1);
  }

  // Load governance deployment info
  let governanceInfo: any = {};
  try {
    governanceInfo = JSON.parse(
      fs.readFileSync("governance-deployment-info.json", "utf-8")
    );
  } catch (error) {
    console.error("❌ Error: governance-deployment-info.json not found. Run 'yarn deploy:governance' first.");
    process.exit(1);
  }
  
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
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
  
  // Get governance state PDA
  const GOVERNANCE_STATE_PDA = new PublicKey(governanceInfo.governanceStatePda);
  
  const [tokenStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );

  console.log("🚀 Proposing governance change...");
  console.log("   Current Authority:", walletKeypair.publicKey.toString());
  console.log("   New Authority (Governance):", GOVERNANCE_STATE_PDA.toString());
  console.log("   Token State PDA:", tokenStatePda.toString());

  // Propose governance change
  const proposeTx = await program.methods
    .proposeGovernanceChange(GOVERNANCE_STATE_PDA)
    .accountsPartial({
      state: tokenStatePda,
      authority: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Governance change proposed:", proposeTx);
  console.log("\n⏳ Wait 7 days cooldown period...");
  console.log("💡 After cooldown, call set_governance() to complete transfer");
  console.log("\n   You can check the pending governance with:");
  console.log(`   anchor run get-state`);
}

main().catch(console.error);

