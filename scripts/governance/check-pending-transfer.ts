import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SplProject } from "../../target/types/spl_project";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  console.log("🔍 Checking Pending Authority Transfer Status\n");
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

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(anchor.web3.Keypair.generate()), // Dummy wallet for read-only
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
  console.log("   Token State PDA:", tokenStatePda.toString());
  console.log("   Governance State PDA:", GOVERNANCE_STATE_PDA.toString());
  console.log("");

  // Check current state
  let tokenState;
  try {
    tokenState = await program.account.tokenState.fetch(tokenStatePda);
  } catch (error: any) {
    console.error("❌ Failed to fetch token state:", error.message);
    process.exit(1);
  }

  console.log("📊 Current State:");
  console.log("   Authority:", tokenState.authority.toString());
  console.log("   Pending Governance:", tokenState.pendingGovernance?.toString() || "None");
  console.log("");

  if (!tokenState.pendingGovernance) {
    console.log("ℹ️  No pending governance change found.");
    console.log("   💡 Run 'yarn governance:transfer' to propose a change.");
    return;
  }

  if (tokenState.pendingGovernance.toString() !== GOVERNANCE_STATE_PDA.toString()) {
    console.log("⚠️  Pending governance doesn't match expected governance PDA!");
    console.log("   Expected:", GOVERNANCE_STATE_PDA.toString());
    console.log("   Found:", tokenState.pendingGovernance.toString());
    return;
  }

  // Check cooldown
  if (!tokenState.governanceChangeTime) {
    console.log("⚠️  Pending change found but no change time recorded.");
    return;
  }

  const changeTime = tokenState.governanceChangeTime.toNumber();
  const clock = await connection.getSlot("finalized").then(async (slot) => {
    const blockTime = await connection.getBlockTime(slot);
    return blockTime;
  });

  if (!clock) {
    console.error("❌ Failed to get current time");
    return;
  }

  const COOLDOWN_SECONDS = 604800; // 7 days
  const cooldownEnd = changeTime + COOLDOWN_SECONDS;
  const timeRemaining = cooldownEnd - clock;

  console.log("⏰ Cooldown Status:");
  console.log("   Change Proposed:", new Date(changeTime * 1000).toISOString());
  console.log("   Current Time:", new Date(clock * 1000).toISOString());
  console.log("   Cooldown Ends:", new Date(cooldownEnd * 1000).toISOString());
  console.log("");

  if (timeRemaining > 0) {
    const days = Math.floor(timeRemaining / 86400);
    const hours = Math.floor((timeRemaining % 86400) / 3600);
    const minutes = Math.floor((timeRemaining % 3600) / 60);
    const seconds = timeRemaining % 60;
    
    console.log("⏳ Cooldown period not yet elapsed:");
    console.log(`   Time remaining: ${days}d ${hours}h ${minutes}m ${Math.floor(seconds)}s`);
    console.log("");
    console.log("💡 After cooldown, run 'yarn governance:finalize' to complete the transfer.");
  } else {
    console.log("✅ Cooldown period has elapsed!");
    console.log("");
    console.log("🚀 Ready to finalize! Run 'yarn governance:finalize' to complete the transfer.");
  }
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exit(1);
});
