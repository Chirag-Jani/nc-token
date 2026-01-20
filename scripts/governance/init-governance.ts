import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../../target/types/governance";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
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
    .accountsPartial({
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

