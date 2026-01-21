import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

interface ChecklistItem {
  id: string;
  description: string;
  check: () => Promise<boolean>;
  critical: boolean;
  fix?: string;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function checkNetwork(connection: Connection): Promise<boolean> {
  const endpoint = connection.rpcEndpoint;
  const isMainnet = endpoint.includes("mainnet");
  return isMainnet;
}

async function checkAnchorToml(): Promise<boolean> {
  try {
    const anchorToml = fs.readFileSync("Anchor.toml", "utf-8");
    return anchorToml.includes('cluster = "mainnet-beta"');
  } catch {
    return false;
  }
}

async function checkWalletBalance(connection: Connection, wallet: Keypair): Promise<boolean> {
  const balance = await connection.getBalance(wallet.publicKey);
  const minBalance = 10 * 1e9; // 10 SOL minimum for mainnet
  return balance >= minBalance;
}

async function checkSigners(): Promise<boolean> {
  const signersInput = process.env.SIGNERS;
  if (!signersInput) return false;
  
  const signers = signersInput.split(",").map(addr => addr.trim());
  return signers.length >= 2; // At least 2 signers for production
}

async function checkRequiredApprovals(): Promise<boolean> {
  const requiredApprovals = parseInt(process.env.REQUIRED_APPROVALS || "2");
  return requiredApprovals >= 2;
}

async function checkProgramIds(): Promise<boolean> {
  try {
    const tokenDeploy = fs.existsSync("target/deploy/spl_project-keypair.json");
    const governanceDeploy = fs.existsSync("target/deploy/governance-keypair.json");
    const presaleDeploy = fs.existsSync("target/deploy/presale-keypair.json");
    return tokenDeploy && governanceDeploy && presaleDeploy;
  } catch {
    return false;
  }
}

async function checkDeploymentFiles(): Promise<boolean> {
  const files = [
    "deployments/deployment-info.json",
    "deployments/governance-deployment-info.json",
    "deployments/presale-deployment-info.json",
  ];
  return files.every(file => fs.existsSync(file));
}

async function main() {
  console.log("🚨 PRE-MAINNET DEPLOYMENT CHECKLIST\n");
  console.log("=".repeat(60));
  console.log("⚠️  WARNING: You are about to deploy to MAINNET");
  console.log("⚠️  This is IRREVERSIBLE. Review all items carefully!\n");
  console.log("=".repeat(60));
  console.log("");

  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("mainnet-beta"),
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const checklist: ChecklistItem[] = [
    {
      id: "network",
      description: "Network is set to mainnet-beta",
      check: () => checkNetwork(connection),
      critical: true,
      fix: "Set ANCHOR_PROVIDER_URL to mainnet RPC or update Anchor.toml",
    },
    {
      id: "anchor_toml",
      description: "Anchor.toml cluster is set to mainnet-beta",
      check: () => checkAnchorToml(),
      critical: true,
      fix: "Update Anchor.toml: cluster = \"mainnet-beta\"",
    },
    {
      id: "wallet_balance",
      description: "Wallet has sufficient balance (≥10 SOL)",
      check: () => checkWalletBalance(connection, walletKeypair),
      critical: true,
      fix: "Fund your wallet with at least 10 SOL",
    },
    {
      id: "signers",
      description: "Multiple signers configured (≥2)",
      check: () => checkSigners(),
      critical: true,
      fix: "Set SIGNERS environment variable with at least 2 signer addresses",
    },
    {
      id: "required_approvals",
      description: "Required approvals is at least 2",
      check: () => checkRequiredApprovals(),
      critical: true,
      fix: "Set REQUIRED_APPROVALS to at least 2",
    },
    {
      id: "program_ids",
      description: "Program keypairs exist (build completed)",
      check: () => checkProgramIds(),
      critical: true,
      fix: "Run 'anchor build' to generate program keypairs",
    },
    {
      id: "deployment_files",
      description: "Previous deployment files exist (if redeploying)",
      check: () => checkDeploymentFiles(),
      critical: false,
      fix: "Not required for first deployment",
    },
  ];

  const results: { item: ChecklistItem; passed: boolean }[] = [];

  for (const item of checklist) {
    console.log(`\n${item.critical ? "🔴" : "🟡"} ${item.description}`);
    const passed = await item.check();
    results.push({ item, passed });
    
    if (passed) {
      console.log("   ✅ PASS");
    } else {
      console.log("   ❌ FAIL");
      if (item.fix) {
        console.log(`   💡 Fix: ${item.fix}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  const allPassed = results.every(r => r.passed);
  const criticalFailed = results.filter(r => !r.passed && r.item.critical).length;

  console.log("\n📊 Checklist Summary:");
  console.log(`   ✅ Passed: ${results.filter(r => r.passed).length}/${results.length}`);
  console.log(`   ❌ Failed: ${results.filter(r => !r.passed).length}/${results.length}`);
  console.log(`   🔴 Critical Failed: ${criticalFailed}`);
  console.log("");

  if (criticalFailed > 0) {
    console.error("❌ CRITICAL CHECKS FAILED!");
    console.error("   Do not proceed to mainnet deployment until all critical checks pass.");
    process.exit(1);
  }

  if (!allPassed) {
    console.log("⚠️  Some non-critical checks failed. Review before proceeding.");
  }

  // Final confirmation
  console.log("=".repeat(60));
  console.log("⚠️  FINAL CONFIRMATION REQUIRED");
  console.log("=".repeat(60));
  console.log("\nYou are about to deploy to MAINNET.");
  console.log("This action is IRREVERSIBLE.");
  console.log("\nHave you:");
  console.log("  ✓ Tested everything on devnet?");
  console.log("  ✓ Reviewed all program code?");
  console.log("  ✓ Verified all signers are correct?");
  console.log("  ✓ Confirmed wallet has sufficient balance?");
  console.log("  ✓ Backed up all keypairs?");
  console.log("  ✓ Read and understood all risks?");
  console.log("");

  const answer = await question("Type 'DEPLOY TO MAINNET' to confirm: ");
  
  if (answer !== "DEPLOY TO MAINNET") {
    console.log("\n❌ Deployment cancelled. Safety first!");
    rl.close();
    process.exit(0);
  }

  console.log("\n✅ Confirmed. Proceeding with mainnet deployment...");
  console.log("   Good luck! 🚀");
  
  rl.close();
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  rl.close();
  process.exit(1);
});
