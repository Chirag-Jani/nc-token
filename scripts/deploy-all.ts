import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { SplProject } from "../target/types/spl_project";
import { Governance } from "../target/types/governance";
import { Presale } from "../target/types/presale";

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

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
const TOKEN_NAME = cliArgs.name || process.env.TOKEN_NAME || "NC";
const TOKEN_SYMBOL = cliArgs.symbol || process.env.TOKEN_SYMBOL || "NC";
const TOKEN_DECIMALS = parseInt(
  cliArgs.decimals || process.env.TOKEN_DECIMALS || "9"
);
const TOTAL_SUPPLY = BigInt(
  cliArgs.totalSupply || process.env.TOTAL_SUPPLY || "100000000"
); // 100 million tokens

// Governance configuration
const REQUIRED_APPROVALS = parseInt(
  cliArgs.requiredApprovals || process.env.REQUIRED_APPROVALS || "2"
);
const COOLDOWN_PERIOD = parseInt(
  cliArgs.cooldownPeriod || process.env.COOLDOWN_PERIOD || "1800"
);

// Parse signers
let SIGNERS: PublicKey[] = [];
const signersInput = cliArgs.signers || process.env.SIGNERS;
if (signersInput) {
  SIGNERS = signersInput.split(",").map((addr: string) => new PublicKey(addr.trim()));
}

// Presale configuration
const PRESALE_TOKEN_DECIMALS = parseInt(
  cliArgs.presaleDecimals || process.env.PRESALE_TOKEN_DECIMALS || "9"
);
const PRESALE_TOKEN_SUPPLY = BigInt(
  cliArgs.presaleTotalSupply || process.env.PRESALE_TOKEN_SUPPLY || "1000000000"
);

async function main() {
  console.log("🚀 Starting complete deployment...\n");
  console.log("=".repeat(60));
  console.log("📋 Configuration:");
  console.log("   Token Name:", TOKEN_NAME);
  console.log("   Token Symbol:", TOKEN_SYMBOL);
  console.log("   Token Decimals:", TOKEN_DECIMALS);
  console.log("   Total Supply:", TOTAL_SUPPLY.toString());
  console.log("   Required Approvals:", REQUIRED_APPROVALS);
  console.log("   Cooldown Period:", COOLDOWN_PERIOD, "seconds");
  console.log("=".repeat(60));
  console.log("");

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
  console.log("");

  // Setup Anchor provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load all programs
  const tokenProgram = anchor.workspace.SplProject as Program<SplProject>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  const presaleProgram = anchor.workspace.Presale as Program<Presale>;

  console.log("📦 Program IDs:");
  console.log("   Token:", tokenProgram.programId.toString());
  console.log("   Governance:", governanceProgram.programId.toString());
  console.log("   Presale:", presaleProgram.programId.toString());
  console.log("");

  // Derive all PDAs
  const [tokenStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    tokenProgram.programId
  );
  const [governanceStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance")],
    governanceProgram.programId
  );
  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    presaleProgram.programId
  );

  const deploymentInfo: any = {
    network: connection.rpcEndpoint,
    wallet: walletKeypair.publicKey.toString(),
    deployedAt: new Date().toISOString(),
  };

  // ============================================================
  // PHASE 1: Deploy and Initialize Token Program
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 1: Token Program Deployment");
  console.log("=".repeat(60));

  // Initialize token state
  console.log("\n1️⃣ Initializing token program state...");
  try {
    const initTx = await tokenProgram.methods
      .initialize()
      .accountsPartial({
        authority: walletKeypair.publicKey,
      })
      .rpc();
    console.log("   ✅ State initialized:", initTx);
  } catch (err: any) {
    if (err.message?.includes("already in use") || err.message?.includes("already initialized")) {
      console.log("   ℹ️  State already initialized, skipping...");
    } else {
      throw err;
    }
  }

  // Create mint
  console.log("\n2️⃣ Creating token mint...");
  const mintKeypair = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: walletKeypair.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      TOKEN_DECIMALS,
      walletKeypair.publicKey,
      null
    )
  );

  const mintTxSig = await sendAndConfirmTransaction(
    connection,
    createMintTx,
    [walletKeypair, mintKeypair],
    { commitment: "confirmed" }
  );
  console.log("   ✅ Mint created:", mintKeypair.publicKey.toString());

  // Create metadata
  console.log("\n3️⃣ Creating token metadata...");
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintKeypair.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  // Transfer mint authority to state PDA
  console.log("\n4️⃣ Transferring mint authority to state PDA...");
  const transferAuthTx = new Transaction().add(
    createSetAuthorityInstruction(
      mintKeypair.publicKey,
      walletKeypair.publicKey,
      AuthorityType.MintTokens,
      tokenStatePda
    )
  );
  await sendAndConfirmTransaction(connection, transferAuthTx, [walletKeypair], {
    commitment: "confirmed",
  });
  console.log("   ✅ Mint authority transferred");

  // Create token account and mint tokens
  console.log("\n5️⃣ Creating token account and minting supply...");
  const tokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    walletKeypair.publicKey
  );

  const createATA = await connection.getAccountInfo(tokenAccount);
  if (!createATA) {
    const createATATx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey,
        tokenAccount,
        walletKeypair.publicKey,
        mintKeypair.publicKey
      )
    );
    await sendAndConfirmTransaction(connection, createATATx, [walletKeypair], {
      commitment: "confirmed",
    });
  }
  console.log("   ✅ Token account:", tokenAccount.toString());

  // Mint total supply
  const supplyAmount = TOTAL_SUPPLY * BigInt(10 ** TOKEN_DECIMALS);
  console.log(`   📦 Minting ${TOTAL_SUPPLY.toString()} tokens...`);

  const mintTx = await tokenProgram.methods
    .mintTokens(new anchor.BN(supplyAmount.toString()))
    .accountsPartial({
      mint: mintKeypair.publicKey,
      to: tokenAccount,
      state: tokenStatePda,
      governance: walletKeypair.publicKey,
      recipientBlacklist: SystemProgram.programId,
    })
    .rpc();

  console.log("   ✅ Tokens minted:", mintTx);

  deploymentInfo.programId = tokenProgram.programId.toString();
  deploymentInfo.mintAddress = mintKeypair.publicKey.toString();
  deploymentInfo.statePda = tokenStatePda.toString();
  deploymentInfo.tokenAccount = tokenAccount.toString();
  deploymentInfo.totalSupply = TOTAL_SUPPLY.toString();

  // ============================================================
  // PHASE 2: Deploy and Initialize Governance Program
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 2: Governance Program Deployment");
  console.log("=".repeat(60));

  // Setup signers (use wallet if none provided)
  if (SIGNERS.length === 0) {
    console.log("\n⚠️  No signers provided, using wallet as signer");
    SIGNERS = [walletKeypair.publicKey];
  }

  console.log("\n6️⃣ Initializing governance...");
  console.log("   Required Approvals:", REQUIRED_APPROVALS);
  console.log("   Cooldown Period:", COOLDOWN_PERIOD, "seconds");
  console.log("   Signers:", SIGNERS.length);

  try {
    const govTx = await governanceProgram.methods
      .initialize(REQUIRED_APPROVALS, new anchor.BN(COOLDOWN_PERIOD), SIGNERS)
      .accountsPartial({
        governanceState: governanceStatePda,
        authority: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   ✅ Governance initialized:", govTx);
  } catch (err: any) {
    if (err.message?.includes("already in use") || err.message?.includes("already initialized")) {
      console.log("   ℹ️  Governance already initialized, skipping...");
    } else {
      throw err;
    }
  }

  // Link token program to governance
  console.log("\n7️⃣ Linking token program to governance...");
  try {
    const linkTx = await governanceProgram.methods
      .setTokenProgram(tokenProgram.programId)
      .accountsPartial({
        governanceState: governanceStatePda,
        authority: walletKeypair.publicKey,
      })
      .rpc();
    console.log("   ✅ Token program linked:", linkTx);
  } catch (err: any) {
    if (err.message?.includes("already set")) {
      console.log("   ℹ️  Token program already linked, skipping...");
    } else {
      throw err;
    }
  }

  deploymentInfo.governanceProgramId = governanceProgram.programId.toString();
  deploymentInfo.governanceStatePda = governanceStatePda.toString();
  deploymentInfo.requiredApprovals = REQUIRED_APPROVALS;
  deploymentInfo.cooldownPeriod = COOLDOWN_PERIOD;
  deploymentInfo.signers = SIGNERS.map((s) => s.toString());

  // ============================================================
  // PHASE 3: Deploy and Initialize Presale Program
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 3: Presale Program Deployment");
  console.log("=".repeat(60));

  console.log("\n8️⃣ Initializing presale...");
  try {
    // Default: 133,000 NC tokens per SOL (if NC = $0.001 and SOL = $133)
    // Stored as: 133_000 * 10^9 = 133_000_000_000_000 (with 9 decimals)
    const DEFAULT_TOKENS_PER_SOL = new anchor.BN(133_000_000_000_000);
    const tokensPerSol = process.env.TOKENS_PER_SOL 
      ? new anchor.BN(process.env.TOKENS_PER_SOL) 
      : DEFAULT_TOKENS_PER_SOL;
    
    console.log("   Setting tokens_per_sol to:", tokensPerSol.toString());
    
    const presaleTx = await presaleProgram.methods
      .initialize(
        walletKeypair.publicKey, // admin
        mintKeypair.publicKey, // presale_token_mint
        tokenProgram.programId, // token_program
        tokenStatePda, // token_program_state
        tokensPerSol // initial_tokens_per_sol
      )
      .accountsPartial({
        presaleState: presaleStatePda,
        payer: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("   ✅ Presale initialized:", presaleTx);
  } catch (err: any) {
    if (err.message?.includes("already in use") || err.message?.includes("already initialized")) {
      console.log("   ℹ️  Presale already initialized, skipping...");
    } else {
      throw err;
    }
  }

  // Link presale program to governance
  console.log("\n9️⃣ Linking presale program to governance...");
  try {
    const linkPresaleTx = await governanceProgram.methods
      .setPresaleProgram(presaleProgram.programId)
      .accountsPartial({
        governanceState: governanceStatePda,
        authority: walletKeypair.publicKey,
      })
      .rpc();
    console.log("   ✅ Presale program linked:", linkPresaleTx);
  } catch (err: any) {
    if (err.message?.includes("already set")) {
      console.log("   ℹ️  Presale program already linked, skipping...");
    } else {
      throw err;
    }
  }

  deploymentInfo.presaleProgramId = presaleProgram.programId.toString();
  deploymentInfo.presaleStatePda = presaleStatePda.toString();

  // ============================================================
  // Save Deployment Info
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("💾 Saving deployment information...");
  console.log("=".repeat(60));

  fs.writeFileSync(
    "deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Also save separate files for backward compatibility
  fs.writeFileSync(
    "governance-deployment-info.json",
    JSON.stringify({
      programId: governanceProgram.programId.toString(),
      governanceStatePda: governanceStatePda.toString(),
      authority: walletKeypair.publicKey.toString(),
      requiredApprovals: REQUIRED_APPROVALS,
      cooldownPeriod: COOLDOWN_PERIOD,
      signers: SIGNERS.map((s) => s.toString()),
      network: connection.rpcEndpoint,
      deployedAt: new Date().toISOString(),
    }, null, 2)
  );

  fs.writeFileSync(
    "presale-deployment-info.json",
    JSON.stringify({
      presaleProgramId: presaleProgram.programId.toString(),
      presaleStatePda: presaleStatePda.toString(),
      tokenProgramId: tokenProgram.programId.toString(),
      mintAddress: mintKeypair.publicKey.toString(),
      network: connection.rpcEndpoint,
      deployedAt: new Date().toISOString(),
    }, null, 2)
  );

  console.log("\n✅ All deployment info saved!");
  console.log("   - deployment-info.json (complete info)");
  console.log("   - governance-deployment-info.json");
  console.log("   - presale-deployment-info.json");

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\n📋 Summary:");
  console.log("   ✅ Token Program:", tokenProgram.programId.toString());
  console.log("   ✅ Governance Program:", governanceProgram.programId.toString());
  console.log("   ✅ Presale Program:", presaleProgram.programId.toString());
  console.log("   ✅ Mint Address:", mintKeypair.publicKey.toString());
  console.log("   ✅ Total Supply:", TOTAL_SUPPLY.toString(), TOKEN_SYMBOL);
  console.log("\n📝 Next Steps:");
  console.log("   1. Review deployment-info.json");
  console.log("   2. Transfer token authority to governance (optional):");
  console.log("      ts-node scripts/transfer-authority.ts");
  console.log("   3. Allow payment tokens in presale:");
  console.log("      ts-node scripts/allow-payment-token.ts <PAYMENT_TOKEN_MINT>");
  console.log("   4. Start presale:");
  console.log("      ts-node scripts/start-presale.ts");
  console.log("\n" + "=".repeat(60));
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error);
  if (error.logs) {
    console.error("\nTransaction logs:");
    error.logs.forEach((log: string) => console.error("  ", log));
  }
  process.exit(1);
});

