import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Governance } from "../../target/types/governance";

async function main() {
  // Get treasury address from CLI args or environment
  const treasuryAddressArg = process.argv[2] || process.env.TREASURY_ADDRESS;
  
  if (!treasuryAddressArg) {
    console.error("❌ Error: Treasury address required");
    console.error("Usage: ts-node scripts/governance/queue-set-treasury.ts <TREASURY_ADDRESS>");
    console.error("   Or set TREASURY_ADDRESS environment variable");
    console.error("");
    console.error("💡 This queues a governance transaction to set the treasury address.");
    console.error("   After cooldown and approvals, it will be executed automatically.");
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
  
  // Load deployment info
  let governanceInfo: any = {};
  try {
    governanceInfo = JSON.parse(
      fs.readFileSync("deployments/governance-deployment-info.json", "utf-8")
    );
  } catch (error) {
    console.error("❌ Error: governance-deployment-info.json not found. Run 'yarn deploy:governance' first.");
    process.exit(1);
  }

  const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    program.programId
  );

  // Derive transaction PDA (we need to find the next transaction ID)
  // For simplicity, we'll let the program assign the ID
  // In production, you'd want to derive this properly
  const [transactionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("transaction"),
      governanceStatePda.toBuffer(),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), // Placeholder - actual ID will be assigned
    ],
    program.programId
  );

  const TREASURY_ADDRESS = new PublicKey(treasuryAddressArg);

  console.log("💰 Queueing Treasury Address Update\n");
  console.log("=".repeat(60));
  console.log("📋 Configuration:");
  console.log("   Governance State PDA:", governanceStatePda.toString());
  console.log("   Treasury Address:", TREASURY_ADDRESS.toString());
  console.log("   Initiator:", walletKeypair.publicKey.toString());
  console.log("");

  // Check if presale program is set (required for treasury operations)
  try {
    const state = await program.account.governanceState.fetch(governanceStatePda);
    if (!state.presaleProgramSet) {
      console.error("❌ Presale program not linked to governance!");
      console.error("   Run 'yarn governance:link-presale' first.");
      process.exit(1);
    }
  } catch (error: any) {
    console.error("❌ Failed to fetch governance state:", error.message);
    process.exit(1);
  }

  // Queue the transaction
  console.log("🚀 Queueing transaction...");
  try {
    // Note: This requires the transaction PDA to be derived properly
    // The actual implementation would need to handle the transaction PDA derivation
    // For now, we'll use a simplified approach
    const tx = await program.methods
      .queueSetTreasuryAddress(TREASURY_ADDRESS)
      .accountsPartial({
        governanceState: governanceStatePda,
        transaction: transactionPda,
        initiator: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   ✅ Transaction queued:", tx);
    console.log("");

    console.log("📝 Next Steps:");
    console.log("   1. Other signers need to approve this transaction");
    console.log("   2. After cooldown period, the transaction will execute automatically");
    console.log("   3. Check status with governance transaction queries");
  } catch (error: any) {
    console.error("   ❌ Failed to queue transaction:", error.message);
    if (error.logs) {
      console.error("\nTransaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    console.error("");
    console.error("💡 Note: This requires proper transaction PDA derivation.");
    console.error("   For direct admin setup, use: yarn presale:set-treasury <ADDRESS>");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
