import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
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

  const program = anchor.workspace.Governance as Program<Governance>;
  
  const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    program.programId
  );

  const tokenProgramId = new PublicKey(deploymentInfo.programId);

  console.log("🔗 Setting token program in governance...");
  console.log("   Token Program ID:", tokenProgramId.toString());
  console.log("   Governance State PDA:", governanceStatePda.toString());

  const tx = await program.methods
    .setTokenProgram(tokenProgramId)
    .accountsPartial({
      governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Token program set in governance:", tx);

  // Verify
  const state = await program.account.governanceState.fetch(governanceStatePda);
  console.log("\n📋 Updated Governance State:");
  console.log("   Token Program:", state.tokenProgram.toString());
  console.log("   Token Program Set:", state.tokenProgramSet);
}

main().catch(console.error);

