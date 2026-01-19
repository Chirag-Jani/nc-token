import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Governance } from "../target/types/governance";
import { PublicKey, SystemProgram, Keypair, clusterApiUrl, Connection } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

// Parse command-line arguments
function parseArgs() {
  const args: { [key: string]: string } = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--?/, "");
    const value = process.argv[i + 1];
    if (key && value) {
      args[key] = value;
    }
  }
  return args;
}

const cliArgs = parseArgs();

// Configuration - can be overridden by environment variables or command-line arguments
// Priority: CLI args > Environment variables > Default values
const REQUIRED_APPROVALS = parseInt(
  cliArgs.requiredApprovals || process.env.REQUIRED_APPROVALS || "2"
);
const COOLDOWN_PERIOD = parseInt(
  cliArgs.cooldownPeriod || process.env.COOLDOWN_PERIOD || "1800"
); // 30 minutes in seconds

// Parse signers from CLI args or environment
// Format: --signers "pubkey1,pubkey2,pubkey3" or SIGNERS="pubkey1,pubkey2,pubkey3"
let SIGNERS: PublicKey[] = [];
const signersInput = cliArgs.signers || process.env.SIGNERS;
if (signersInput) {
  SIGNERS = signersInput.split(",").map((addr: string) => new PublicKey(addr.trim()));
}

async function main() {
  console.log("🚀 Starting governance deployment...\n");

  // Setup connection
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

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

  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Wallet not found at ${walletPath}. Please set ANCHOR_WALLET environment variable or ensure id.json exists.`
    );
  }

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  console.log("📝 Wallet:", walletKeypair.publicKey.toString());
  console.log("🌐 Network:", connection.rpcEndpoint);

  // Setup Anchor provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load program
  const program = anchor.workspace.Governance as Program<Governance>;
  const programId = program.programId;

  console.log("\n📦 Program ID:", programId.toString());

  // Derive governance state PDA
  const [governanceStatePda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    programId
  );

  console.log("📍 Governance State PDA:", governanceStatePda.toString());
  console.log("   Bump:", bump);

  // Check if already initialized
  try {
    const existingState = await program.account.governanceState.fetch(governanceStatePda);
    console.log("\n⚠️  Governance already initialized!");
    console.log("   Authority:", existingState.authority.toString());
    console.log("   Required Approvals:", existingState.requiredApprovals.toString());
    console.log("   Cooldown Period:", existingState.cooldownPeriod.toString());
    console.log("   Signers:", existingState.signers.length);
    console.log("\n💡 To reinitialize, close the account first or use a different program ID.");
    return;
  } catch (err) {
    // Account doesn't exist, proceed with initialization
    console.log("\n1️⃣ Initializing governance state...");
  }

  // Validate configuration
  if (REQUIRED_APPROVALS < 2) {
    throw new Error("Required approvals must be at least 2");
  }

  if (COOLDOWN_PERIOD < 1800) {
    throw new Error("Cooldown period must be at least 1800 seconds (30 minutes)");
  }

  // If no signers provided, use wallet as the only signer
  // In production, you should provide multiple signers
  if (SIGNERS.length === 0) {
    console.log("⚠️  No signers provided, using wallet as signer");
    console.log("   ⚠️  WARNING: For production, provide multiple signers!");
    SIGNERS = [walletKeypair.publicKey];
  }

  // Validate signers
  if (SIGNERS.length > 10) {
    throw new Error("Maximum 10 signers allowed");
  }

  if (REQUIRED_APPROVALS > SIGNERS.length) {
    throw new Error(
      `Required approvals (${REQUIRED_APPROVALS}) cannot exceed number of signers (${SIGNERS.length})`
    );
  }

  // Check for duplicate signers
  const uniqueSigners = new Set(SIGNERS.map((s) => s.toString()));
  if (uniqueSigners.size !== SIGNERS.length) {
    throw new Error("Duplicate signers detected");
  }

  console.log("\n📋 Configuration:");
  console.log("   Required Approvals:", REQUIRED_APPROVALS);
  console.log("   Cooldown Period:", COOLDOWN_PERIOD, "seconds");
  console.log("   Signers:", SIGNERS.length);
  SIGNERS.forEach((signer, idx) => {
    console.log(`      ${idx + 1}. ${signer.toString()}`);
  });

  // Initialize governance
  try {
    const tx = await program.methods
      .initialize(REQUIRED_APPROVALS, new anchor.BN(COOLDOWN_PERIOD), SIGNERS)
      .accountsPartial({
        governanceState: governanceStatePda,
        authority: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("\n✅ Governance initialized!");
    console.log("   Transaction:", tx);

    // Fetch and display state
    const state = await program.account.governanceState.fetch(governanceStatePda);
    console.log("\n📋 Governance State:");
    console.log("   Authority:", state.authority.toString());
    console.log("   Required Approvals:", state.requiredApprovals.toString());
    console.log("   Cooldown Period:", state.cooldownPeriod.toString());
    console.log("   Next Transaction ID:", state.nextTransactionId.toString());
    console.log("   Token Program Set:", state.tokenProgramSet);
    console.log("   Presale Program Set:", state.presaleProgramSet);
    console.log("   Signers:", state.signers.length);

    // Save deployment info
    const deploymentInfo = {
      programId: programId.toString(),
      governanceStatePda: governanceStatePda.toString(),
      authority: walletKeypair.publicKey.toString(),
      requiredApprovals: REQUIRED_APPROVALS,
      cooldownPeriod: COOLDOWN_PERIOD,
      signers: SIGNERS.map((s) => s.toString()),
      network: connection.rpcEndpoint,
      deployedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      "governance-deployment-info.json",
      JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("\n💾 Deployment info saved to: governance-deployment-info.json");
    console.log("\n✅ Governance deployment complete!");
    console.log("\n📝 Next steps:");
    console.log("   1. Set token program: ts-node scripts/set-token-program.ts");
    console.log("   2. Set presale program: ts-node scripts/set-presale-program.ts");
    console.log("   3. Transfer token authority to governance (if needed)");
  } catch (error: any) {
    console.error("\n❌ Error initializing governance:", error.message);
    if (error.logs) {
      console.error("\nTransaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

