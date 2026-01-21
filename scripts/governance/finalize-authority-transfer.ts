import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplProject } from "../../target/types/spl_project";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  console.log("🔐 Finalizing Authority Transfer to Governance\n");
  console.log("=".repeat(60));

  // Load deployment info
  let deploymentInfo: any = {};
  let governanceInfo: any = {};
  
  try {
    deploymentInfo = JSON.parse(
      fs.readFileSync("deployments/deployment-info.json", "utf-8")
    );
  } catch (error) {
    console.error("❌ Error: deployment-info.json not found. Run 'yarn deploy' first.");
    process.exit(1);
  }

  try {
    governanceInfo = JSON.parse(
      fs.readFileSync("deployments/governance-deployment-info.json", "utf-8")
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
  
  const GOVERNANCE_STATE_PDA = new PublicKey(governanceInfo.governanceStatePda);
  const [tokenStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );

  console.log("📋 Configuration:");
  console.log("   Token Program:", program.programId.toString());
  console.log("   Token State PDA:", tokenStatePda.toString());
  console.log("   Governance State PDA:", GOVERNANCE_STATE_PDA.toString());
  console.log("   Current Authority:", walletKeypair.publicKey.toString());
  console.log("");

  // Check current state
  console.log("🔍 Checking current state...");
  let tokenState;
  try {
    tokenState = await program.account.tokenState.fetch(tokenStatePda);
    console.log("   ✅ Token state fetched");
    console.log("   Current Authority:", tokenState.authority.toString());
    console.log("   Pending Governance:", tokenState.pendingGovernance?.toString() || "None");
    console.log("   Governance Change Time:", tokenState.governanceChangeTime?.toString() || "None");
  } catch (error: any) {
    console.error("   ❌ Failed to fetch token state:", error.message);
    process.exit(1);
  }

  // Verify pending governance matches
  if (!tokenState.pendingGovernance) {
    console.error("   ❌ No pending governance change found!");
    console.error("   💡 Run 'yarn governance:transfer' first to propose the change.");
    process.exit(1);
  }

  if (tokenState.pendingGovernance.toString() !== GOVERNANCE_STATE_PDA.toString()) {
    console.error("   ❌ Pending governance doesn't match!");
    console.error("   Expected:", GOVERNANCE_STATE_PDA.toString());
    console.error("   Found:", tokenState.pendingGovernance.toString());
    process.exit(1);
  }

  // Check cooldown period
  if (!tokenState.governanceChangeTime) {
    console.error("   ❌ No governance change time found!");
    process.exit(1);
  }

  const changeTime = tokenState.governanceChangeTime.toNumber();
  const clock = await connection.getSlot("finalized").then(async (slot) => {
    const blockTime = await connection.getBlockTime(slot);
    return blockTime;
  });

  if (!clock) {
    console.error("   ❌ Failed to get current time");
    process.exit(1);
  }

  // GOVERNANCE_COOLDOWN_SECONDS is 7 days = 604800 seconds
  const COOLDOWN_SECONDS = 604800;
  const cooldownEnd = changeTime + COOLDOWN_SECONDS;
  const timeRemaining = cooldownEnd - clock;

  console.log("   Change Time:", new Date(changeTime * 1000).toISOString());
  console.log("   Current Time:", new Date(clock * 1000).toISOString());
  console.log("   Cooldown End:", new Date(cooldownEnd * 1000).toISOString());
  console.log("");

  if (timeRemaining > 0) {
    const days = Math.floor(timeRemaining / 86400);
    const hours = Math.floor((timeRemaining % 86400) / 3600);
    const minutes = Math.floor((timeRemaining % 3600) / 60);
    console.error("   ⏳ Cooldown period not yet elapsed!");
    console.error(`   ⏰ Time remaining: ${days}d ${hours}h ${minutes}m`);
    console.error("   💡 Wait for the cooldown period to complete before finalizing.");
    process.exit(1);
  }

  console.log("   ✅ Cooldown period has elapsed!");
  console.log("");

  // Verify current authority matches wallet
  if (tokenState.authority.toString() !== walletKeypair.publicKey.toString()) {
    console.error("   ❌ Current authority doesn't match wallet!");
    console.error("   Expected:", walletKeypair.publicKey.toString());
    console.error("   Found:", tokenState.authority.toString());
    console.error("   💡 You must be the current authority to finalize the transfer.");
    process.exit(1);
  }

  // Finalize the transfer
  console.log("🚀 Finalizing authority transfer...");
  try {
    const tx = await program.methods
      .setGovernance(GOVERNANCE_STATE_PDA)
      .accountsPartial({
        state: tokenStatePda,
        authority: walletKeypair.publicKey,
      })
      .rpc();

    console.log("   ✅ Authority transfer finalized!");
    console.log("   Transaction:", tx);
    console.log("");

    // Verify the transfer
    const newState = await program.account.tokenState.fetch(tokenStatePda);
    console.log("📋 Updated Token State:");
    console.log("   Authority:", newState.authority.toString());
    console.log("   Pending Governance:", newState.pendingGovernance?.toString() || "None");
    console.log("   Governance Change Time:", newState.governanceChangeTime?.toString() || "None");
    console.log("");

    if (newState.authority.toString() === GOVERNANCE_STATE_PDA.toString()) {
      console.log("✅ SUCCESS! Authority has been transferred to governance.");
      console.log("   The token program is now controlled by the multisig.");
    } else {
      console.error("   ⚠️  WARNING: Authority transfer may not have completed correctly.");
    }
  } catch (error: any) {
    console.error("   ❌ Failed to finalize transfer:", error.message);
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
