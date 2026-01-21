import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

interface ValidationResult {
  passed: boolean;
  message: string;
}

async function validateWalletBalance(connection: Connection, wallet: Keypair): Promise<ValidationResult> {
  const balance = await connection.getBalance(wallet.publicKey);
  const minBalance = 5 * 1e9; // 5 SOL minimum
  
  if (balance < minBalance) {
    return {
      passed: false,
      message: `❌ Insufficient wallet balance. Need at least 5 SOL, have ${(balance / 1e9).toFixed(4)} SOL`,
    };
  }
  
  return {
    passed: true,
    message: `✅ Wallet balance: ${(balance / 1e9).toFixed(4)} SOL`,
  };
}

async function validateNetwork(connection: Connection, expectedNetwork?: string): Promise<ValidationResult> {
  const endpoint = connection.rpcEndpoint;
  const isMainnet = endpoint.includes("mainnet");
  const isDevnet = endpoint.includes("devnet");
  const isLocalnet = endpoint.includes("localhost") || endpoint.includes("127.0.0.1");
  
  if (expectedNetwork === "mainnet" && !isMainnet) {
    return {
      passed: false,
      message: `❌ Network mismatch! Expected mainnet but connected to ${endpoint}`,
    };
  }
  
  if (expectedNetwork === "devnet" && !isDevnet) {
    return {
      passed: false,
      message: `❌ Network mismatch! Expected devnet but connected to ${endpoint}`,
    };
  }
  
  const networkName = isMainnet ? "mainnet-beta" : isDevnet ? "devnet" : isLocalnet ? "localnet" : "unknown";
  return {
    passed: true,
    message: `✅ Network: ${networkName} (${endpoint})`,
  };
}

function validateProgramIds(): ValidationResult {
  try {
    // Check if target/deploy directories exist
    const tokenDeployPath = "target/deploy/spl_project-keypair.json";
    const governanceDeployPath = "target/deploy/governance-keypair.json";
    const presaleDeployPath = "target/deploy/presale-keypair.json";
    
    const missing: string[] = [];
    if (!fs.existsSync(tokenDeployPath)) missing.push("spl_project");
    if (!fs.existsSync(governanceDeployPath)) missing.push("governance");
    if (!fs.existsSync(presaleDeployPath)) missing.push("presale");
    
    if (missing.length > 0) {
      return {
        passed: false,
        message: `❌ Missing deploy keypairs: ${missing.join(", ")}. Run 'anchor build' first.`,
      };
    }
    
    // Try to read and validate program IDs match Anchor.toml
    const anchorToml = fs.readFileSync("Anchor.toml", "utf-8");
    const tokenMatch = anchorToml.match(/spl_project\s*=\s*"([^"]+)"/);
    const governanceMatch = anchorToml.match(/governance\s*=\s*"([^"]+)"/);
    const presaleMatch = anchorToml.match(/presale\s*=\s*"([^"]+)"/);
    
    if (!tokenMatch || !governanceMatch || !presaleMatch) {
      return {
        passed: false,
        message: `❌ Could not parse program IDs from Anchor.toml`,
      };
    }
    
    return {
      passed: true,
      message: `✅ Program IDs found in Anchor.toml`,
    };
  } catch (error: any) {
    return {
      passed: false,
      message: `❌ Error validating program IDs: ${error.message}`,
    };
  }
}

function validateSigners(signers: PublicKey[]): ValidationResult {
  if (signers.length === 0) {
    return {
      passed: false,
      message: `❌ No signers provided. Governance requires at least 1 signer.`,
    };
  }
  
  if (signers.length === 1) {
    return {
      passed: true,
      message: `⚠️  Only 1 signer provided. For production, use multiple signers (2-of-N recommended).`,
    };
  }
  
  // Check for duplicates
  const unique = new Set(signers.map(s => s.toString()));
  if (unique.size !== signers.length) {
    return {
      passed: false,
      message: `❌ Duplicate signers detected!`,
    };
  }
  
  if (signers.length > 10) {
    return {
      passed: false,
      message: `❌ Too many signers (${signers.length}). Maximum is 10.`,
    };
  }
  
  return {
    passed: true,
    message: `✅ Signers validated: ${signers.length} unique signers`,
  };
}

function validateRequiredApprovals(requiredApprovals: number, signerCount: number): ValidationResult {
  if (requiredApprovals < 2) {
    return {
      passed: false,
      message: `❌ Required approvals (${requiredApprovals}) must be at least 2`,
    };
  }
  
  if (requiredApprovals > signerCount) {
    return {
      passed: false,
      message: `❌ Required approvals (${requiredApprovals}) cannot exceed signer count (${signerCount})`,
    };
  }
  
  return {
    passed: true,
    message: `✅ Required approvals: ${requiredApprovals} of ${signerCount}`,
  };
}

function validateCooldownPeriod(cooldownPeriod: number): ValidationResult {
  const MIN_COOLDOWN = 1800; // 30 minutes
  
  if (cooldownPeriod < MIN_COOLDOWN) {
    return {
      passed: false,
      message: `❌ Cooldown period (${cooldownPeriod}s) must be at least ${MIN_COOLDOWN}s (30 minutes)`,
    };
  }
  
  return {
    passed: true,
    message: `✅ Cooldown period: ${cooldownPeriod}s (${Math.floor(cooldownPeriod / 60)} minutes)`,
  };
}

function validateWalletExists(): ValidationResult {
  const defaultWallet =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );
  const walletPath = defaultWallet.replace(
    "~",
    process.env.HOME || process.env.USERPROFILE || ""
  );

  if (!fs.existsSync(walletPath)) {
    return {
      passed: false,
      message: `❌ Wallet not found at ${walletPath}. Set ANCHOR_WALLET or ensure id.json exists.`,
    };
  }
  
  return {
    passed: true,
    message: `✅ Wallet found: ${walletPath}`,
  };
}

async function main() {
  console.log("🔍 Pre-Deployment Validation\n");
  console.log("=".repeat(60));
  console.log("");

  const results: ValidationResult[] = [];
  
  // Parse command-line arguments
  const args: { [key: string]: string } = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--?/, "");
    const value = process.argv[i + 1];
    if (key && value) {
      args[key] = value;
    }
  }

  const expectedNetwork = args.network || process.env.NETWORK || undefined;
  const signersInput = args.signers || process.env.SIGNERS;
  const requiredApprovals = parseInt(
    args.requiredApprovals || process.env.REQUIRED_APPROVALS || "2"
  );
  const cooldownPeriod = parseInt(
    args.cooldownPeriod || process.env.COOLDOWN_PERIOD || "1800"
  );

  // Setup connection
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  // 1. Validate wallet exists
  console.log("1️⃣ Validating wallet...");
  const walletResult = validateWalletExists();
  results.push(walletResult);
  console.log("   ", walletResult.message);
  console.log("");

  if (!walletResult.passed) {
    console.error("❌ Validation failed. Fix errors and try again.");
    process.exit(1);
  }

  // Load wallet
  const defaultWallet =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );
  const walletPath = defaultWallet.replace(
    "~",
    process.env.HOME || process.env.USERPROFILE || ""
  );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  // 2. Validate network
  console.log("2️⃣ Validating network...");
  const networkResult = await validateNetwork(connection, expectedNetwork);
  results.push(networkResult);
  console.log("   ", networkResult.message);
  console.log("");

  // 3. Validate wallet balance
  console.log("3️⃣ Validating wallet balance...");
  const balanceResult = await validateWalletBalance(connection, walletKeypair);
  results.push(balanceResult);
  console.log("   ", balanceResult.message);
  console.log("");

  // 4. Validate program IDs
  console.log("4️⃣ Validating program IDs...");
  const programIdResult = validateProgramIds();
  results.push(programIdResult);
  console.log("   ", programIdResult.message);
  console.log("");

  // 5. Validate signers (if provided)
  if (signersInput) {
    console.log("5️⃣ Validating signers...");
    const signers = signersInput.split(",").map((addr: string) => new PublicKey(addr.trim()));
    const signerResult = validateSigners(signers);
    results.push(signerResult);
    console.log("   ", signerResult.message);
    console.log("");

    // 6. Validate required approvals
    console.log("6️⃣ Validating required approvals...");
    const approvalsResult = validateRequiredApprovals(requiredApprovals, signers.length);
    results.push(approvalsResult);
    console.log("   ", approvalsResult.message);
    console.log("");
  }

  // 7. Validate cooldown period
  console.log("7️⃣ Validating cooldown period...");
  const cooldownResult = validateCooldownPeriod(cooldownPeriod);
  results.push(cooldownResult);
  console.log("   ", cooldownResult.message);
  console.log("");

  // Summary
  console.log("=".repeat(60));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const warnings = results.filter(r => r.passed && r.message.includes("⚠️")).length;

  console.log("📊 Validation Summary:");
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  if (warnings > 0) {
    console.log(`   ⚠️  Warnings: ${warnings}`);
  }
  console.log("");

  if (failed > 0) {
    console.error("❌ Validation failed! Fix the errors above before deploying.");
    process.exit(1);
  }

  if (warnings > 0) {
    console.log("⚠️  Warnings found. Review before proceeding to production.");
  } else {
    console.log("✅ All validations passed! Ready to deploy.");
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
