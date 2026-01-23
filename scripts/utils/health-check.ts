import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Governance } from "../../target/types/governance";
import { Presale } from "../../target/types/presale";
import { SplProject } from "../../target/types/spl_project";

interface HealthCheckResult {
  component: string;
  status: "healthy" | "degraded" | "unhealthy";
  message: string;
  details?: string;
}

async function checkTokenProgram(
  connection: Connection,
  program: Program<SplProject>
): Promise<HealthCheckResult> {
  try {
    const [tokenStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );

    const state = await program.account.tokenState.fetch(tokenStatePda);
    
    if (state.emergencyPaused) {
      return {
        component: "Token Program",
        status: "degraded",
        message: "⚠️  Token program is paused",
        details: "All token operations are blocked",
      };
    }

    return {
      component: "Token Program",
      status: "healthy",
      message: "✅ Token program is operational",
      details: `Authority: ${state.authority.toString()}`,
    };
  } catch (error: any) {
    return {
      component: "Token Program",
      status: "unhealthy",
      message: "❌ Token program state not accessible",
      details: error.message,
    };
  }
}

async function checkGovernanceProgram(
  connection: Connection,
  program: Program<Governance>
): Promise<HealthCheckResult> {
  try {
    const [governanceStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("governance")],
      program.programId
    );

    const state = await program.account.governanceState.fetch(governanceStatePda);
    
    const signerCount = state.signers.length;
    const requiredApprovals = state.requiredApprovals;
    
    if (signerCount < requiredApprovals) {
      return {
        component: "Governance Program",
        status: "unhealthy",
        message: "❌ Insufficient signers for required approvals",
        details: `Have ${signerCount} signers but need ${requiredApprovals} approvals`,
      };
    }

    if (!state.tokenProgramSet || !state.presaleProgramSet) {
      return {
        component: "Governance Program",
        status: "degraded",
        message: "⚠️  Governance not fully linked",
        details: `Token: ${state.tokenProgramSet}, Presale: ${state.presaleProgramSet}`,
      };
    }

    return {
      component: "Governance Program",
      status: "healthy",
      message: "✅ Governance program is operational",
      details: `${signerCount} signers, ${requiredApprovals} required approvals`,
    };
  } catch (error: any) {
    return {
      component: "Governance Program",
      status: "unhealthy",
      message: "❌ Governance program state not accessible",
      details: error.message,
    };
  }
}

async function checkPresaleProgram(
  connection: Connection,
  program: Program<Presale>
): Promise<HealthCheckResult> {
  try {
    const [presaleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_state")],
      program.programId
    );

    const state = await program.account.presaleState.fetch(presaleStatePda);
    const status = Object.keys(state.status)[0];
    
    if (status === "notStarted") {
      return {
        component: "Presale Program",
        status: "degraded",
        message: "⚠️  Presale not started",
        details: "Presale is initialized but not active",
      };
    }

    if (status === "ended") {
      return {
        component: "Presale Program",
        status: "degraded",
        message: "⚠️  Presale has ended",
        details: "Presale is no longer accepting purchases",
      };
    }

    return {
      component: "Presale Program",
      status: "healthy",
      message: "✅ Presale program is operational",
      details: `Status: ${status}, Total Sold: ${state.totalTokensSold.toString()}`,
    };
  } catch (error: any) {
    return {
      component: "Presale Program",
      status: "unhealthy",
      message: "❌ Presale program state not accessible",
      details: error.message,
    };
  }
}

async function checkOracle(connection: Connection): Promise<HealthCheckResult> {
  // Chainlink SOL/USD feed on devnet
  const CHAINLINK_FEED_DEVNET = new PublicKey("99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR");
  // Chainlink SOL/USD feed on mainnet
  const CHAINLINK_FEED_MAINNET = new PublicKey("CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt");
  
  const endpoint = connection.rpcEndpoint;
  const isMainnet = endpoint.includes("mainnet");
  const feedAddress = isMainnet ? CHAINLINK_FEED_MAINNET : CHAINLINK_FEED_DEVNET;

  try {
    const feedAccount = await connection.getAccountInfo(feedAddress);
    
    if (!feedAccount) {
      return {
        component: "Chainlink Oracle",
        status: "unhealthy",
        message: "❌ Oracle feed account not found",
        details: `Feed: ${feedAddress.toString()}`,
      };
    }

    // Basic check - in production, you'd parse the feed data
    // For now, just check if account exists and has data
    if (feedAccount.data.length < 100) {
      return {
        component: "Chainlink Oracle",
        status: "degraded",
        message: "⚠️  Oracle feed data may be incomplete",
        details: `Feed: ${feedAddress.toString()}`,
      };
    }

    return {
      component: "Chainlink Oracle",
      status: "healthy",
      message: "✅ Oracle feed is accessible",
      details: `Feed: ${feedAddress.toString()}`,
    };
  } catch (error: any) {
    return {
      component: "Chainlink Oracle",
      status: "unhealthy",
      message: "❌ Failed to check oracle feed",
      details: error.message,
    };
  }
}

async function checkNetwork(connection: Connection): Promise<HealthCheckResult> {
  try {
    const slot = await connection.getSlot();
    const blockHeight = await connection.getBlockHeight();
    const version = await connection.getVersion();
    
    return {
      component: "Network",
      status: "healthy",
      message: "✅ Network is responsive",
      details: `Slot: ${slot}, Block Height: ${blockHeight}, Version: ${version["solana-core"]}`,
    };
  } catch (error: any) {
    return {
      component: "Network",
      status: "unhealthy",
      message: "❌ Network is not responsive",
      details: error.message,
    };
  }
}

async function main() {
  console.log("🏥 System Health Check\n");
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

  // Load programs
  const tokenProgram = anchor.workspace.SplProject as Program<SplProject>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  const presaleProgram = anchor.workspace.Presale as Program<Presale>;

  const results: HealthCheckResult[] = [];

  // Check network
  console.log("🌐 Checking network...");
  const networkResult = await checkNetwork(connection);
  results.push(networkResult);
  console.log(`   ${networkResult.message}`);
  if (networkResult.details) console.log(`      ${networkResult.details}`);
  console.log("");

  // Check token program
  console.log("🪙 Checking token program...");
  const tokenResult = await checkTokenProgram(connection, tokenProgram);
  results.push(tokenResult);
  console.log(`   ${tokenResult.message}`);
  if (tokenResult.details) console.log(`      ${tokenResult.details}`);
  console.log("");

  // Check governance program
  console.log("🏛️  Checking governance program...");
  const governanceResult = await checkGovernanceProgram(connection, governanceProgram);
  results.push(governanceResult);
  console.log(`   ${governanceResult.message}`);
  if (governanceResult.details) console.log(`      ${governanceResult.details}`);
  console.log("");

  // Check presale program
  console.log("💰 Checking presale program...");
  const presaleResult = await checkPresaleProgram(connection, presaleProgram);
  results.push(presaleResult);
  console.log(`   ${presaleResult.message}`);
  if (presaleResult.details) console.log(`      ${presaleResult.details}`);
  console.log("");

  // Check oracle
  console.log("🔮 Checking oracle...");
  const oracleResult = await checkOracle(connection);
  results.push(oracleResult);
  console.log(`   ${oracleResult.message}`);
  if (oracleResult.details) console.log(`      ${oracleResult.details}`);
  console.log("");

  // Summary
  console.log("=".repeat(60));
  const healthy = results.filter(r => r.status === "healthy").length;
  const degraded = results.filter(r => r.status === "degraded").length;
  const unhealthy = results.filter(r => r.status === "unhealthy").length;

  console.log("📊 Health Summary:");
  console.log(`   ✅ Healthy: ${healthy}`);
  console.log(`   ⚠️  Degraded: ${degraded}`);
  console.log(`   ❌ Unhealthy: ${unhealthy}`);
  console.log("");

  if (unhealthy > 0) {
    console.error("❌ System health check failed! Some components are unhealthy.");
    process.exit(1);
  }

  if (degraded > 0) {
    console.log("⚠️  Some components are degraded. Review the details above.");
  } else {
    console.log("✅ All systems operational!");
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
