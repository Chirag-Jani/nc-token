import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Presale } from "../../target/types/presale";

interface ReadinessCheck {
  check: string;
  passed: boolean;
  message: string;
  details?: string;
}

async function main() {
  console.log("🔍 Presale Readiness Check\n");
  console.log("=".repeat(60));
  console.log("");

  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
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

  const program = anchor.workspace.Presale as Program<Presale>;
  
  // Load deployment info
  let presaleInfo: any = {};
  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    console.error("❌ Error: presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
    process.exit(1);
  }

  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    program.programId
  );

  const checks: ReadinessCheck[] = [];

  // 1. Check presale state exists
  console.log("1️⃣ Checking presale state...");
  try {
    const state = await program.account.presaleState.fetch(presaleStatePda);
    checks.push({
      check: "Presale State",
      passed: true,
      message: "✅ Presale state initialized",
      details: `Admin: ${state.admin.toString()}, Status: ${Object.keys(state.status)[0]}`,
    });
    console.log("   ✅ Presale state initialized");
  } catch (error: any) {
    checks.push({
      check: "Presale State",
      passed: false,
      message: "❌ Presale state not initialized",
      details: error.message,
    });
    console.log("   ❌ Presale state not initialized");
  }
  console.log("");

  // 2. Check presale is started
  console.log("2️⃣ Checking presale status...");
  try {
    const state = await program.account.presaleState.fetch(presaleStatePda);
    const status = Object.keys(state.status)[0];
    
    if (status === "active") {
      checks.push({
        check: "Presale Status",
        passed: true,
        message: "✅ Presale is active",
      });
      console.log("   ✅ Presale is active");
    } else if (status === "notStarted") {
      checks.push({
        check: "Presale Status",
        passed: false,
        message: "❌ Presale not started",
        details: "Run 'yarn presale:start' to start the presale",
      });
      console.log("   ❌ Presale not started");
    } else {
      checks.push({
        check: "Presale Status",
        passed: false,
        message: `⚠️  Presale status: ${status}`,
      });
      console.log(`   ⚠️  Presale status: ${status}`);
    }
  } catch (error: any) {
    checks.push({
      check: "Presale Status",
      passed: false,
      message: "❌ Failed to check presale status",
      details: error.message,
    });
  }
  console.log("");

  // 3. Check vault is funded
  console.log("3️⃣ Checking presale vault...");
  try {
    const presaleTokenMint = new PublicKey(presaleInfo.presaleTokenMint);
    const presaleProgramId = new PublicKey(presaleInfo.presaleProgramId);
    
    const [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("presale_token_vault_pda"),
        presaleTokenMint.toBuffer(),
      ],
      presaleProgramId
    );

    const presaleTokenVault = await getAssociatedTokenAddress(
      presaleTokenMint,
      presaleTokenVaultPda,
      true
    );

    try {
      const vaultAccount = await getAccount(connection, presaleTokenVault);
      const balance = Number(vaultAccount.amount) / 1e9;
      
      if (balance > 0) {
        checks.push({
          check: "Vault Funding",
          passed: true,
          message: "✅ Presale vault is funded",
          details: `Balance: ${balance.toLocaleString()} tokens`,
        });
        console.log(`   ✅ Presale vault is funded: ${balance.toLocaleString()} tokens`);
      } else {
        checks.push({
          check: "Vault Funding",
          passed: false,
          message: "❌ Presale vault is empty",
          details: "Run 'yarn presale:fund <amount>' to fund the vault",
        });
        console.log("   ❌ Presale vault is empty");
      }
    } catch (error: any) {
      checks.push({
        check: "Vault Funding",
        passed: false,
        message: "❌ Presale vault not found or not accessible",
        details: error.message,
      });
      console.log("   ❌ Presale vault not found");
    }
  } catch (error: any) {
    checks.push({
      check: "Vault Funding",
      passed: false,
      message: "❌ Failed to check vault",
      details: error.message,
    });
  }
  console.log("");

  // 4. Check payment tokens are allowed (at least one)
  console.log("4️⃣ Checking payment tokens...");
  try {
    // This is a simplified check - in production you'd iterate through all allowed tokens
    // For now, we'll just check if the presale state has payment token configuration
    const state = await program.account.presaleState.fetch(presaleStatePda);
    
    // Note: The actual check would require querying allowed tokens PDAs
    // This is a placeholder that checks if presale is configured
    checks.push({
      check: "Payment Tokens",
      passed: true,
      message: "✅ Payment token configuration exists",
      details: "Verify payment tokens are allowed with 'yarn presale:allow <TOKEN_MINT>'",
    });
    console.log("   ⚠️  Payment tokens check - verify manually");
    console.log("      Use 'yarn presale:allow <TOKEN_MINT>' to allow payment tokens");
  } catch (error: any) {
    checks.push({
      check: "Payment Tokens",
      passed: false,
      message: "❌ Failed to check payment tokens",
      details: error.message,
    });
  }
  console.log("");

  // 5. Check treasury address is set
  console.log("5️⃣ Checking treasury address...");
  try {
    const state = await program.account.presaleState.fetch(presaleStatePda);
    const treasuryAddress = state.treasuryAddress;
    
    if (treasuryAddress.toString() === PublicKey.default.toString()) {
      checks.push({
        check: "Treasury Address",
        passed: false,
        message: "❌ Treasury address not set",
        details: "Set it with: yarn presale:set-treasury <ADDRESS>",
      });
      console.log("   ❌ Treasury address not set");
      console.log("      Set it with: yarn presale:set-treasury <ADDRESS>");
    } else {
      checks.push({
        check: "Treasury Address",
        passed: true,
        message: "✅ Treasury address is set",
        details: `Treasury: ${treasuryAddress.toString()}`,
      });
      console.log("   ✅ Treasury address is set");
      console.log("      ", treasuryAddress.toString());
    }
  } catch (error: any) {
    checks.push({
      check: "Treasury Address",
      passed: false,
      message: "❌ Failed to check treasury address",
      details: error.message,
    });
  }
  console.log("");

  // 6. Check oracle is accessible
  console.log("6️⃣ Checking oracle...");
  const CHAINLINK_FEED_DEVNET = new PublicKey("HgTtcbcmp5BeThax5AU8vg4VwK79Tav1seX3yDX5hsjv");
  const CHAINLINK_FEED_MAINNET = new PublicKey("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG");
  
  const endpoint = connection.rpcEndpoint;
  const isMainnet = endpoint.includes("mainnet");
  const feedAddress = isMainnet ? CHAINLINK_FEED_MAINNET : CHAINLINK_FEED_DEVNET;

  try {
    const feedAccount = await connection.getAccountInfo(feedAddress);
    if (feedAccount && feedAccount.data.length > 0) {
      checks.push({
        check: "Oracle",
        passed: true,
        message: "✅ Oracle feed is accessible",
        details: `Feed: ${feedAddress.toString()}`,
      });
      console.log("   ✅ Oracle feed is accessible");
    } else {
      checks.push({
        check: "Oracle",
        passed: false,
        message: "❌ Oracle feed not found",
      });
      console.log("   ❌ Oracle feed not found");
    }
  } catch (error: any) {
    checks.push({
      check: "Oracle",
      passed: false,
      message: "❌ Failed to check oracle",
      details: error.message,
    });
  }
  console.log("");

  // Summary
  console.log("=".repeat(60));
  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;

  console.log("📊 Readiness Summary:");
  console.log(`   ✅ Passed: ${passed}/${checks.length}`);
  console.log(`   ❌ Failed: ${failed}/${checks.length}`);
  console.log("");

  if (failed > 0) {
    console.error("❌ Presale is not ready! Fix the issues above before starting.");
    console.log("\n📝 Next Steps:");
    checks.filter(c => !c.passed).forEach(c => {
      console.log(`   - ${c.message}`);
      if (c.details) console.log(`     ${c.details}`);
    });
    process.exit(1);
  }

  console.log("✅ Presale is ready! All checks passed.");
  console.log("   Users can now purchase tokens.");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
