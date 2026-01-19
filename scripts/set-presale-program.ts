import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Load presale deployment info
  let presaleInfo: any = {};
  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    console.error("❌ Error: presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
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

  const presaleProgramId = new PublicKey(presaleInfo.presaleProgramId);

  console.log("🔗 Setting presale program in governance...");
  console.log("   Presale Program ID:", presaleProgramId.toString());
  console.log("   Governance State PDA:", governanceStatePda.toString());

  const tx = await program.methods
    .setPresaleProgram(presaleProgramId)
    .accountsPartial({
      governanceState: governanceStatePda,
      authority: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Presale program set in governance:", tx);

  // Verify
  const state = await program.account.governanceState.fetch(governanceStatePda);
  console.log("\n📋 Updated Governance State:");
  console.log("   Presale Program:", state.presaleProgram.toString());
  console.log("   Presale Program Set:", state.presaleProgramSet);
}

main().catch(console.error);

