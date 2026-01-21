import { execSync } from "child_process";
import * as fs from "fs";

interface DeployResult {
  program: string;
  success: boolean;
  message: string;
}

function deployProgram(programName: string): DeployResult {
  console.log(`\n📦 Deploying ${programName}...`);
  console.log("=".repeat(60));
  
  try {
    // Run anchor deploy for the specific program
    execSync(`anchor deploy --program-name ${programName}`, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    
    return {
      program: programName,
      success: true,
      message: `✅ ${programName} deployed successfully`,
    };
  } catch (error: any) {
    return {
      program: programName,
      success: false,
      message: `❌ ${programName} deployment failed: ${error.message}`,
    };
  }
}

function verifyDeployment(programName: string): boolean {
  const keypairPath = `target/deploy/${programName}-keypair.json`;
  return fs.existsSync(keypairPath);
}

async function main() {
  console.log("🚀 Program Deployment Orchestrator\n");
  console.log("=".repeat(60));
  console.log("This script will deploy all programs in the correct order:");
  console.log("  1. spl-project (Token Program)");
  console.log("  2. governance (Governance Program)");
  console.log("  3. presale (Presale Program)");
  console.log("");

  // Check if anchor is available
  try {
    execSync("anchor --version", { stdio: "pipe" });
  } catch (error) {
    console.error("❌ Anchor CLI not found. Please install Anchor first.");
    console.error("   Run: cargo install --git https://github.com/coral-xyz/anchor avm --locked --force");
    process.exit(1);
  }

  // Check if programs are built
  console.log("🔍 Checking if programs are built...");
  const programs = ["spl_project", "governance", "presale"];
  const missing: string[] = [];
  
  for (const program of programs) {
    const keypairPath = `target/deploy/${program}-keypair.json`;
    if (!fs.existsSync(keypairPath)) {
      missing.push(program);
    }
  }

  if (missing.length > 0) {
    console.log(`\n⚠️  Missing keypairs for: ${missing.join(", ")}`);
    console.log("   Building programs first...\n");
    
    try {
      execSync("anchor build", { stdio: "inherit" });
      console.log("\n✅ Build completed\n");
    } catch (error: any) {
      console.error("\n❌ Build failed. Please fix build errors and try again.");
      process.exit(1);
    }
  } else {
    console.log("✅ All program keypairs found\n");
  }

  // Parse command-line arguments
  const args: { [key: string]: string | boolean } = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--")) {
      const key = arg.replace(/^--/, "").replace(/-/g, "");
      const nextArg = process.argv[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        args[key] = nextArg;
        i++;
      } else {
        args[key] = true;
      }
    }
  }

  const skipBuild = args.skipbuild || args.skipBuild || false;
  const programsToDeploy = args.programs 
    ? (args.programs as string).split(",").map(p => p.trim())
    : programs;

  if (!skipBuild && missing.length > 0) {
    console.log("💡 Tip: Use --skip-build to skip build if already built");
  }

  const results: DeployResult[] = [];

  // Deploy programs in order
  for (const program of programsToDeploy) {
    if (!programs.includes(program)) {
      console.log(`⚠️  Unknown program: ${program}. Skipping...`);
      continue;
    }

    const result = deployProgram(program);
    results.push(result);

    if (!result.success) {
      console.error(`\n❌ Deployment failed for ${program}`);
      console.error("   Fix the error and retry, or deploy manually with:");
      console.error(`   anchor deploy --program-name ${program}`);
      
      // Ask if we should continue
      if (programsToDeploy.length > 1) {
        console.log("\n⚠️  Continuing with remaining programs...");
      } else {
        process.exit(1);
      }
    } else {
      // Verify deployment
      if (verifyDeployment(program)) {
        console.log(`   ✅ Verified: ${program} keypair exists`);
      } else {
        console.log(`   ⚠️  Warning: ${program} keypair not found after deployment`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Deployment Summary");
  console.log("=".repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(result => {
    console.log(`   ${result.success ? "✅" : "❌"} ${result.program}: ${result.success ? "Success" : "Failed"}`);
  });

  console.log(`\n   Total: ${successful} successful, ${failed} failed`);

  if (failed > 0) {
    console.log("\n⚠️  Some deployments failed. Review errors above.");
    process.exit(1);
  }

  console.log("\n✅ All programs deployed successfully!");
  console.log("\n📝 Next Steps:");
  console.log("   1. Run 'yarn deploy:all' to initialize all programs");
  console.log("   2. Or run individual initialization scripts:");
  console.log("      - yarn deploy (token program)");
  console.log("      - yarn deploy:governance");
  console.log("      - yarn deploy:presale");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
