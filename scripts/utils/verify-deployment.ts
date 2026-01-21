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

interface VerificationResult {
  passed: boolean;
  message: string;
  details?: string;
}

async function verifyTokenProgram(
  connection: Connection,
  program: Program<SplProject>
): Promise<VerificationResult> {
  try {
    const [tokenStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );

    const state = await program.account.tokenState.fetch(tokenStatePda);
    
    return {
      passed: true,
      message: "✅ Token program state initialized",
      details: `Authority: ${state.authority.toString()}, Paused: ${state.emergencyPaused}`,
    };
  } catch (error: any) {
    return {
      passed: false,
      message: "❌ Token program state not initialized",
      details: error.message,
    };
  }
}

async function verifyGovernanceProgram(
  connection: Connection,
  program: Program<Governance>
): Promise<VerificationResult> {
  try {
    const [governanceStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("governance")],
      program.programId
    );

    const state = await program.account.governanceState.fetch(governanceStatePda);
    
    return {
      passed: true,
      message: "✅ Governance program state initialized",
      details: `Authority: ${state.authority.toString()}, Signers: ${state.signers.length}, Required Approvals: ${state.requiredApprovals.toString()}`,
    };
  } catch (error: any) {
    return {
      passed: false,
      message: "❌ Governance program state not initialized",
      details: error.message,
    };
  }
}

async function verifyPresaleProgram(
  connection: Connection,
  program: Program<Presale>
): Promise<VerificationResult> {
  try {
    const [presaleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_state")],
      program.programId
    );

    const state = await program.account.presaleState.fetch(presaleStatePda);
    
    return {
      passed: true,
      message: "✅ Presale program state initialized",
      details: `Admin: ${state.admin.toString()}, Status: ${Object.keys(state.status)[0]}`,
    };
  } catch (error: any) {
    return {
      passed: false,
      message: "❌ Presale program state not initialized",
      details: error.message,
    };
  }
}

async function verifyProgramLinking(
  connection: Connection,
  governanceProgram: Program<Governance>,
  tokenProgram: Program<SplProject>,
  presaleProgram: Program<Presale>
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  
  try {
    const [governanceStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("governance")],
      governanceProgram.programId
    );

    const state = await governanceProgram.account.governanceState.fetch(governanceStatePda);
    
    // Check token program link
    if (state.tokenProgramSet) {
      if (state.tokenProgram.toString() === tokenProgram.programId.toString()) {
        results.push({
          passed: true,
          message: "✅ Token program linked to governance",
          details: `Token Program: ${state.tokenProgram.toString()}`,
        });
      } else {
        results.push({
          passed: false,
          message: "❌ Token program link mismatch",
          details: `Expected: ${tokenProgram.programId.toString()}, Found: ${state.tokenProgram.toString()}`,
        });
      }
    } else {
      results.push({
        passed: false,
        message: "❌ Token program not linked to governance",
      });
    }

    // Check presale program link
    if (state.presaleProgramSet) {
      if (state.presaleProgram.toString() === presaleProgram.programId.toString()) {
        results.push({
          passed: true,
          message: "✅ Presale program linked to governance",
          details: `Presale Program: ${state.presaleProgram.toString()}`,
        });
      } else {
        results.push({
          passed: false,
          message: "❌ Presale program link mismatch",
          details: `Expected: ${presaleProgram.programId.toString()}, Found: ${state.presaleProgram.toString()}`,
        });
      }
    } else {
      results.push({
        passed: false,
        message: "❌ Presale program not linked to governance",
      });
    }
  } catch (error: any) {
    results.push({
      passed: false,
      message: "❌ Failed to verify program linking",
      details: error.message,
    });
  }

  return results;
}

async function verifyMintAuthority(
  connection: Connection,
  tokenProgram: Program<SplProject>,
  mintAddress: PublicKey
): Promise<VerificationResult> {
  try {
    const [tokenStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      tokenProgram.programId
    );

    // Get mint account info
    const mintInfo = await connection.getAccountInfo(mintAddress);
    if (!mintInfo) {
      return {
        passed: false,
        message: "❌ Mint account not found",
      };
    }

    // Mint authority is at offset 0 (first 32 bytes)
    const mintAuthorityBytes = mintInfo.data.slice(0, 32);
    const isNull = mintAuthorityBytes.every(byte => byte === 0);
    
    if (isNull) {
      return {
        passed: true,
        message: "✅ Mint authority revoked (immutable)",
      };
    }

    const mintAuthority = new PublicKey(mintAuthorityBytes);
    
    if (mintAuthority.toString() === tokenStatePda.toString()) {
      return {
        passed: true,
        message: "✅ Mint authority set to token state PDA",
        details: `Authority: ${mintAuthority.toString()}`,
      };
    }

    return {
      passed: true,
      message: "⚠️  Mint authority set (not revoked)",
      details: `Authority: ${mintAuthority.toString()}`,
    };
  } catch (error: any) {
    return {
      passed: false,
      message: "❌ Failed to verify mint authority",
      details: error.message,
    };
  }
}

async function verifyDeploymentFiles(): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const requiredFiles = [
    "deployments/deployment-info.json",
    "deployments/governance-deployment-info.json",
    "deployments/presale-deployment-info.json",
  ];

  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        results.push({
          passed: true,
          message: `✅ ${file} exists and is valid`,
        });
      } catch (error: any) {
        results.push({
          passed: false,
          message: `❌ ${file} exists but is invalid JSON`,
          details: error.message,
        });
      }
    } else {
      results.push({
        passed: false,
        message: `❌ ${file} not found`,
      });
    }
  }

  return results;
}

async function main() {
  console.log("🔍 Post-Deployment Verification\n");
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

  const allResults: VerificationResult[] = [];

  // 1. Verify deployment files
  console.log("1️⃣ Verifying deployment files...");
  const fileResults = await verifyDeploymentFiles();
  allResults.push(...fileResults);
  fileResults.forEach(r => {
    console.log("   ", r.message);
    if (r.details) console.log("      ", r.details);
  });
  console.log("");

  // Load deployment info
  let deploymentInfo: any = {};
  try {
    deploymentInfo = JSON.parse(
      fs.readFileSync("deployments/deployment-info.json", "utf-8")
    );
  } catch (error) {
    console.error("❌ Cannot load deployment-info.json. Run deployment first.");
    process.exit(1);
  }

  // 2. Verify token program
  console.log("2️⃣ Verifying token program...");
  const tokenResult = await verifyTokenProgram(connection, tokenProgram);
  allResults.push(tokenResult);
  console.log("   ", tokenResult.message);
  if (tokenResult.details) console.log("      ", tokenResult.details);
  console.log("");

  // 3. Verify governance program
  console.log("3️⃣ Verifying governance program...");
  const governanceResult = await verifyGovernanceProgram(connection, governanceProgram);
  allResults.push(governanceResult);
  console.log("   ", governanceResult.message);
  if (governanceResult.details) console.log("      ", governanceResult.details);
  console.log("");

  // 4. Verify presale program
  console.log("4️⃣ Verifying presale program...");
  const presaleResult = await verifyPresaleProgram(connection, presaleProgram);
  allResults.push(presaleResult);
  console.log("   ", presaleResult.message);
  if (presaleResult.details) console.log("      ", presaleResult.details);
  console.log("");

  // 5. Verify program linking
  console.log("5️⃣ Verifying program linking...");
  const linkingResults = await verifyProgramLinking(
    connection,
    governanceProgram,
    tokenProgram,
    presaleProgram
  );
  allResults.push(...linkingResults);
  linkingResults.forEach(r => {
    console.log("   ", r.message);
    if (r.details) console.log("      ", r.details);
  });
  console.log("");

  // 6. Verify mint authority (if mint address available)
  if (deploymentInfo.mint || deploymentInfo.mintAddress) {
    console.log("6️⃣ Verifying mint authority...");
    const mintAddress = new PublicKey(deploymentInfo.mint || deploymentInfo.mintAddress);
    const mintResult = await verifyMintAuthority(connection, tokenProgram, mintAddress);
    allResults.push(mintResult);
    console.log("   ", mintResult.message);
    if (mintResult.details) console.log("      ", mintResult.details);
    console.log("");
  }

  // 7. Verify treasury address (if presale is deployed)
  console.log("7️⃣ Verifying treasury address...");
  try {
    const [presaleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_state")],
      presaleProgram.programId
    );
    const presaleState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
    const treasuryAddress = presaleState.treasuryAddress;
    
    if (treasuryAddress.toString() === PublicKey.default.toString()) {
      allResults.push({
        passed: false,
        message: "⚠️  Treasury address not set",
        details: "Set it with: yarn presale:set-treasury <ADDRESS>",
      });
      console.log("   ⚠️  Treasury address not set");
      console.log("      Set it with: yarn presale:set-treasury <ADDRESS>");
    } else {
      allResults.push({
        passed: true,
        message: "✅ Treasury address is set",
        details: `Treasury: ${treasuryAddress.toString()}`,
      });
      console.log("   ✅ Treasury address is set");
      console.log("      ", treasuryAddress.toString());
    }
  } catch (error: any) {
    allResults.push({
      passed: false,
      message: "❌ Failed to verify treasury address",
      details: error.message,
    });
    console.log("   ❌ Failed to verify treasury address");
  }
  console.log("");

  // Summary
  console.log("=".repeat(60));
  const passed = allResults.filter(r => r.passed && !r.message.includes("⚠️")).length;
  const failed = allResults.filter(r => !r.passed).length;
  const warnings = allResults.filter(r => r.passed && r.message.includes("⚠️")).length;

  console.log("📊 Verification Summary:");
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  if (warnings > 0) {
    console.log(`   ⚠️  Warnings: ${warnings}`);
  }
  console.log("");

  if (failed > 0) {
    console.error("❌ Verification failed! Some components are not properly deployed.");
    process.exit(1);
  }

  if (warnings > 0) {
    console.log("⚠️  Some warnings found. Review before proceeding.");
  } else {
    console.log("✅ All verifications passed! Deployment is complete.");
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
