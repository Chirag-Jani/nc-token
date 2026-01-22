import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createSetAuthorityInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Governance } from "../../target/types/governance";
import { Presale } from "../../target/types/presale";
import { SplProject } from "../../target/types/spl_project";

// Load .env file if it exists
try {
  const envPath = path.join(__dirname, "../../.env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [key, ...valueParts] = trimmed.split("=");
        const rawValue = valueParts.join("=").trim();

        // If value is quoted, keep everything inside quotes (including #)
        // Otherwise, strip inline comments like: FOO=bar  # comment
        let value = rawValue;
        const isQuoted =
          (value.startsWith("\"") && value.endsWith("\"")) ||
          (value.startsWith("'") && value.endsWith("'"));
        if (isQuoted) {
          value = value.slice(1, -1);
        } else {
          value = value.replace(/\s+#.*$/, "").trim();
        }

        const cleanValue = value.replace(/\r$/, "");
        if (key && cleanValue && !process.env[key]) {
          process.env[key] = cleanValue;
        }
      }
    });
  }
} catch (error) {
  // Silently fail if .env can't be loaded
}

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
  cliArgs.decimals || process.env.TOKEN_DECIMALS || "8"
);
const TOTAL_SUPPLY = BigInt(
  cliArgs.totalSupply || process.env.TOTAL_SUPPLY || "30000000000"
); // 30 billion tokens

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
  try {
    SIGNERS = signersInput.split(",").map((addr: string) => new PublicKey(addr.trim()));
  } catch (error: any) {
    console.error("❌ Error parsing SIGNERS from environment:", error.message);
    console.error("   SIGNERS value:", signersInput);
    console.error("   Ensure SIGNERS is comma-separated list of valid Solana addresses");
    process.exit(1);
  }
}

// Presale configuration
const PRESALE_TOKEN_DECIMALS = parseInt(
  cliArgs.presaleDecimals || process.env.PRESALE_TOKEN_DECIMALS || "8"
);
const PRESALE_TOKEN_SUPPLY = BigInt(
  cliArgs.presaleTotalSupply || process.env.PRESALE_TOKEN_SUPPLY || "1000000000"
);

async function validateConfiguration() {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate required approvals
  if (REQUIRED_APPROVALS < 2) {
    errors.push("Required approvals must be at least 2");
  }

  // Validate cooldown period
  if (COOLDOWN_PERIOD < 1800) {
    errors.push("Cooldown period must be at least 1800 seconds (30 minutes)");
  }

  // Validate signers
  if (SIGNERS.length > 0) {
    if (REQUIRED_APPROVALS > SIGNERS.length) {
      errors.push(`Required approvals (${REQUIRED_APPROVALS}) cannot exceed signer count (${SIGNERS.length})`);
    }
    
    // Check for duplicates
    const unique = new Set(SIGNERS.map(s => s.toString()));
    if (unique.size !== SIGNERS.length) {
      errors.push("Duplicate signers detected");
    }

    if (SIGNERS.length > 10) {
      errors.push("Maximum 10 signers allowed");
    }
  } else {
    warnings.push("No signers provided - will use wallet as single signer (not recommended for production)");
  }

  // Validate token decimals
  if (TOKEN_DECIMALS < 0 || TOKEN_DECIMALS > 18) {
    errors.push("Token decimals must be between 0 and 18");
  }

  // Validate total supply
  if (TOTAL_SUPPLY <= BigInt(0)) {
    errors.push("Total supply must be greater than 0");
  }

  if (errors.length > 0) {
    console.error("\n❌ Configuration Errors:");
    errors.forEach(err => console.error(`   - ${err}`));
    throw new Error("Configuration validation failed");
  }

  if (warnings.length > 0) {
    console.log("\n⚠️  Configuration Warnings:");
    warnings.forEach(warn => console.log(`   - ${warn}`));
    console.log("");
  }
}

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
  if (SIGNERS.length > 0) {
    console.log("   Signers:", SIGNERS.length);
    SIGNERS.forEach((signer, idx) => {
      console.log(`      ${idx + 1}. ${signer.toString()}`);
    });
  } else {
    console.log("   Signers: Not provided (will use wallet)");
  }
  console.log("=".repeat(60));
  console.log("");

  // Validate configuration
  await validateConfiguration();

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

  // Check wallet balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  const minBalance = 5 * 1e9; // 5 SOL minimum
  if (balance < minBalance) {
    console.warn(`\n⚠️  Warning: Low wallet balance: ${(balance / 1e9).toFixed(4)} SOL`);
    console.warn(`   Recommended: At least ${(minBalance / 1e9).toFixed(2)} SOL for deployment`);
    console.warn("   Continuing anyway...\n");
  }

  console.log("📝 Wallet:", walletKeypair.publicKey.toString());
  console.log("🌐 Network:", connection.rpcEndpoint);
  console.log("💰 Balance:", (balance / 1e9).toFixed(4), "SOL");
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

  // Helper to serialize string with u32 length prefix (Borsh format)
  const serializeString = (str: string): Buffer => {
    const strBytes = Buffer.from(str, "utf8");
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(strBytes.length, 0);
    return Buffer.concat([len, strBytes]);
  };

  // CreateMetadataAccountV3 instruction discriminator = 33
  const discriminator = Buffer.from([33]);

  // Serialize DataV2 struct (Borsh format for V3)
  const nameBytes = serializeString(TOKEN_NAME);
  const symbolBytes = serializeString(TOKEN_SYMBOL);
  const uriBytes = serializeString(""); // Empty URI - can be updated later

  // DataV2 struct: name, symbol, uri, seller_fee_basis_points, creators, collection, uses
  const dataV2Parts: Buffer[] = [
    nameBytes, // name: String
    symbolBytes, // symbol: String
    uriBytes, // uri: String
    Buffer.from([0, 0]), // seller_fee_basis_points: u16 (little-endian)
    Buffer.from([0]), // creators: Option<Vec<Creator>> - None
    Buffer.from([0]), // collection: Option<Collection> - None
    Buffer.from([0]), // uses: Option<Uses> - None
  ];
  const dataV2 = Buffer.concat(dataV2Parts);

  // CreateMetadataAccountArgsV3: data (DataV2), is_mutable (bool), collection_details (Option)
  const argsV3 = Buffer.concat([
    dataV2, // data: DataV2
    Buffer.from([1]), // is_mutable: bool (true)
    Buffer.from([0]), // collection_details: Option<CollectionDetails> - None
  ]);

  // Full instruction: discriminator + args
  const instructionData = Buffer.concat([discriminator, argsV3]);

  // Rent sysvar
  const rentSysvar = new PublicKey(
    "SysvarRent111111111111111111111111111111111"
  );

  // CreateMetadataAccountV3 account order:
  // 0. metadata (writable)
  // 1. mint (readonly)
  // 2. mint_authority (signer)
  // 3. payer (writable, signer)
  // 4. update_authority (readonly)
  // 5. system_program (readonly)
  // 6. rent (readonly)
  const metadataInstruction = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: rentSysvar, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  try {
    const metadataTx = new Transaction().add(metadataInstruction);
    await sendAndConfirmTransaction(connection, metadataTx, [walletKeypair], {
      commitment: "confirmed",
    });
    console.log("   ✅ Metadata created:", metadataPda.toString());
    console.log("   📝 Name:", TOKEN_NAME);
    console.log("   🏷️  Symbol:", TOKEN_SYMBOL);
    deploymentInfo.metadata = metadataPda.toString();
  } catch (error: any) {
    console.error("   ❌ Metadata creation failed:", error.message);
    if (error.logs) {
      console.error("   Logs:", error.logs.join("\n"));
    }
    console.log(
      "   ⚠️  Continuing without metadata - token will work but won't show name/symbol in wallets"
    );
    console.log("   💡 You can add metadata later using Metaplex tools");
  }

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
  // Calculate 10^decimals as BigInt to avoid precision loss
  // Use a loop since BigInt exponentiation requires ES2016+
  let decimalsMultiplier = BigInt(1);
  for (let i = 0; i < TOKEN_DECIMALS; i++) {
    decimalsMultiplier = decimalsMultiplier * BigInt(10);
  }
  const totalSupplyAmount = TOTAL_SUPPLY * decimalsMultiplier;
  
  // u64 max value: 18,446,744,073,709,551,615
  const U64_MAX = BigInt("18446744073709551615");
  
  console.log(`   📦 Minting ${TOTAL_SUPPLY.toString()} tokens...`);
  console.log(`   📊 Total amount: ${totalSupplyAmount.toString()} base units`);
  
  // Check if total supply exceeds u64 max (mint supply limit)
  if (totalSupplyAmount > U64_MAX) {
    const maxTokensWithDecimals = U64_MAX / decimalsMultiplier;
    
    // Calculate what decimals would work for the requested supply
    let suggestedDecimals = TOKEN_DECIMALS;
    let suggestedMultiplier = decimalsMultiplier;
    let suggestedAmount = totalSupplyAmount;
    
    // Try reducing decimals until it fits
    while (suggestedAmount > U64_MAX && suggestedDecimals > 0) {
      suggestedDecimals--;
      suggestedMultiplier = BigInt(1);
      for (let i = 0; i < suggestedDecimals; i++) {
        suggestedMultiplier = suggestedMultiplier * BigInt(10);
      }
      suggestedAmount = TOTAL_SUPPLY * suggestedMultiplier;
    }
    
    if (suggestedAmount <= U64_MAX && suggestedDecimals < TOKEN_DECIMALS) {
      throw new Error(
        `❌ Total supply exceeds u64 maximum with ${TOKEN_DECIMALS} decimals!\n` +
        `   Requested: ${TOTAL_SUPPLY.toString()} tokens with ${TOKEN_DECIMALS} decimals (${totalSupplyAmount.toString()} base units)\n` +
        `   Maximum with ${TOKEN_DECIMALS} decimals: ${maxTokensWithDecimals.toString()} tokens\n` +
        `   \n` +
        `   💡 Solution: Use ${suggestedDecimals} decimals instead (allows ${TOTAL_SUPPLY.toString()} tokens)\n` +
        `   Set TOKEN_DECIMALS=${suggestedDecimals} and redeploy\n` +
        `   \n` +
        `   Note: 9 decimals is standard for Solana tokens and allows up to ~18.4 billion tokens`
      );
    } else {
      throw new Error(
        `❌ Total supply exceeds u64 maximum!\n` +
        `   Requested: ${TOTAL_SUPPLY.toString()} tokens (${totalSupplyAmount.toString()} base units)\n` +
        `   Maximum with ${TOKEN_DECIMALS} decimals: ${maxTokensWithDecimals.toString()} tokens (${U64_MAX.toString()} base units)\n` +
        `   \n` +
        `   Solutions:\n` +
        `   1. Reduce total supply to ${maxTokensWithDecimals.toString()} tokens or less\n` +
        `   2. Reduce decimals (e.g., 9 decimals allows up to 18,446,744,073 tokens)\n` +
        `   3. Mint only what you need initially (e.g., 1 billion for presale)`
      );
    }
  }
  
  // Batch minting configuration - mint in smaller, manageable batches
  // Default: 1 billion tokens per batch (can be overridden via env var)
  const BATCH_SIZE_TOKENS = BigInt(
    process.env.MINT_BATCH_SIZE_TOKENS || "1000000000" // 1 billion tokens per batch
  );
  const batchSizeBaseUnits = BATCH_SIZE_TOKENS * decimalsMultiplier;
  
  // Check if we need to batch mint
  if (totalSupplyAmount > batchSizeBaseUnits) {
    console.log(`   ⚠️  Minting in batches of ${BATCH_SIZE_TOKENS.toString()} tokens per batch...`);
    console.log(`   📊 Batch size: ${batchSizeBaseUnits.toString()} base units`);
    
    let remaining = totalSupplyAmount;
    let batchNumber = 1;
    const totalBatches = Number((totalSupplyAmount + batchSizeBaseUnits - BigInt(1)) / batchSizeBaseUnits); // Ceiling division
    console.log(`   📦 Total batches needed: ${totalBatches}`);
    
    while (remaining > BigInt(0)) {
      // Get current balance before each batch to track progress
      let currentBalance = BigInt(0);
      try {
        const accountInfo = await getAccount(connection, tokenAccount);
        currentBalance = BigInt(accountInfo.amount.toString());
      } catch (error) {
        currentBalance = BigInt(0);
      }
      
      // Calculate batch amount: smaller of remaining or batch size
      let batchAmount = remaining > batchSizeBaseUnits ? batchSizeBaseUnits : remaining;
      
      // Also check token account capacity (shouldn't be an issue with reasonable batch sizes)
      const availableAccountSpace = U64_MAX - currentBalance;
      if (batchAmount > availableAccountSpace) {
        console.log(`   ⚠️  Batch would exceed account capacity, reducing batch size...`);
        batchAmount = availableAccountSpace;
        
        if (batchAmount <= BigInt(0)) {
          throw new Error(
            `Token account has reached maximum capacity (${U64_MAX.toString()} base units). ` +
            `Cannot mint remaining ${remaining.toString()} base units. ` +
            `Consider using multiple token accounts or reducing total supply.`
          );
        }
      }
      
      const batchTokens = batchAmount / decimalsMultiplier;
      
      // Ensure batchAmount fits in u64
      if (batchAmount > U64_MAX) {
        throw new Error(`Batch amount ${batchAmount.toString()} exceeds u64 max`);
      }
      
      // Convert to string and validate it's a valid number
      const batchAmountStr = batchAmount.toString();
      const batchAmountBN = new anchor.BN(batchAmountStr);
      
      // Verify BN is within u64 range
      const u64MaxBN = new anchor.BN("18446744073709551615");
      if (batchAmountBN.gt(u64MaxBN)) {
        throw new Error(`BN value ${batchAmountStr} exceeds u64 max`);
      }
      
      const remainingTokens = remaining / decimalsMultiplier;
      console.log(`   📦 Batch ${batchNumber}/${totalBatches}: Minting ${batchTokens.toString()} tokens (${batchAmountStr} base units)...`);
      console.log(`   📊 Progress: ${(batchNumber - 1) * Number(BATCH_SIZE_TOKENS)} / ${TOTAL_SUPPLY.toString()} tokens`);
      console.log(`   💰 Remaining: ${remainingTokens.toString()} tokens`);
      
      const mintTx = await tokenProgram.methods
        .mintTokens(batchAmountBN)
        .accountsPartial({
          mint: mintKeypair.publicKey,
          to: tokenAccount,
          state: tokenStatePda,
          governance: walletKeypair.publicKey,
          recipientBlacklist: SystemProgram.programId,
        })
        .rpc();
      
      console.log(`   ✅ Batch ${batchNumber} minted: ${mintTx}`);
      
      remaining -= batchAmount;
      batchNumber++;
      
      // Small delay between batches to avoid rate limiting
      if (remaining > BigInt(0)) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
      }
    }
    
    console.log("   ✅ All tokens minted successfully!");
  } else {
    // Verify amount fits in u64
    if (totalSupplyAmount > U64_MAX) {
      throw new Error(`Total supply amount ${totalSupplyAmount.toString()} exceeds u64 max. Use batch minting.`);
    }
    
    const totalSupplyBN = new anchor.BN(totalSupplyAmount.toString());
    const mintTx = await tokenProgram.methods
      .mintTokens(totalSupplyBN)
      .accountsPartial({
        mint: mintKeypair.publicKey,
        to: tokenAccount,
        state: tokenStatePda,
        governance: walletKeypair.publicKey,
        recipientBlacklist: SystemProgram.programId,
      })
      .rpc();

    console.log("   ✅ Tokens minted:", mintTx);
  }

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
  } else {
    // Ensure wallet is in signers list (required for set_token_program and set_presale_program)
    const walletInSigners = SIGNERS.some(s => s.toString() === walletKeypair.publicKey.toString());
    if (!walletInSigners) {
      console.log("\n⚠️  Wallet not in signers list, adding it...");
      SIGNERS.push(walletKeypair.publicKey);
    }
  }

  console.log("\n6️⃣ Initializing governance...");
  console.log("   Required Approvals:", REQUIRED_APPROVALS);
  console.log("   Cooldown Period:", COOLDOWN_PERIOD, "seconds");
  console.log("   Signers:", SIGNERS.length);
  SIGNERS.forEach((signer, idx) => {
    console.log(`      ${idx + 1}. ${signer.toString()}`);
  });
  
  // Validate before attempting initialization
  if (REQUIRED_APPROVALS > SIGNERS.length) {
    console.error(`\n❌ Error: Required approvals (${REQUIRED_APPROVALS}) cannot exceed signer count (${SIGNERS.length})`);
    console.error("   Fix: Either reduce REQUIRED_APPROVALS or add more signers to SIGNERS env variable");
    process.exit(1);
  }

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
    // Default: $0.001 per token (1000 micro-USD)
    // 1 USD = 1,000,000 micro-USD
    // $0.001 = 1,000 micro-USD
    const DEFAULT_TOKEN_PRICE_USD_MICRO = new anchor.BN(1000);
    const tokenPriceUsdMicro = process.env.TOKEN_PRICE_USD_MICRO 
      ? new anchor.BN(process.env.TOKEN_PRICE_USD_MICRO) 
      : DEFAULT_TOKEN_PRICE_USD_MICRO;
    
    console.log("   Setting token_price_usd_micro to:", tokenPriceUsdMicro.toString(), "micro-USD");
    console.log("   Token price:", (tokenPriceUsdMicro.toNumber() / 1_000_000).toFixed(6), "USD per token");
    console.log("   💡 Presale will use Chainlink SOL/USD oracle for dynamic pricing");
    
    const presaleTx = await presaleProgram.methods
      .initialize(
        walletKeypair.publicKey, // admin
        mintKeypair.publicKey, // presale_token_mint
        TOKEN_PROGRAM_ID, // token_program (SPL Token v1)
        tokenStatePda, // token_program_state
        tokenPriceUsdMicro // token_price_usd_micro
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
  // PHASE 4: Set Treasury Address (Optional)
  // ============================================================
  const treasuryAddress = cliArgs.treasuryAddress || process.env.TREASURY_ADDRESS;
  if (treasuryAddress) {
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 4: Setting Treasury Address");
    console.log("=".repeat(60));
    
    console.log("\n🔟 Setting treasury address...");
    try {
      const treasuryPubkey = new PublicKey(treasuryAddress);
      const treasuryTx = await presaleProgram.methods
        .setTreasuryAddress(treasuryPubkey)
        .accountsPartial({
          presaleState: presaleStatePda,
          authority: walletKeypair.publicKey,
        })
        .rpc();
      
      console.log("   ✅ Treasury address set:", treasuryTx);
      console.log("   Treasury:", treasuryPubkey.toString());
      deploymentInfo.treasuryAddress = treasuryPubkey.toString();
    } catch (err: any) {
      console.error("   ⚠️  Failed to set treasury address:", err.message);
      console.error("   💡 You can set it later with: yarn presale:set-treasury <ADDRESS>");
    }
  } else {
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 4: Treasury Address (Skipped)");
    console.log("=".repeat(60));
    console.log("\nℹ️  No treasury address provided.");
    console.log("   💡 Set TREASURY_ADDRESS in .env or run:");
    console.log("      yarn presale:set-treasury <TREASURY_ADDRESS>");
    console.log("   💡 Treasury address is required before withdrawals can be made.");
  }

  // ============================================================
  // Save Deployment Info
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("💾 Saving deployment information...");
  console.log("=".repeat(60));

  fs.writeFileSync(
    "deployments/deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Also save separate files for backward compatibility
  fs.writeFileSync(
    "deployments/governance-deployment-info.json",
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
    "deployments/presale-deployment-info.json",
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
  if (!treasuryAddress) {
    console.log("   2. Set treasury address (required for withdrawals):");
    console.log("      yarn presale:set-treasury <TREASURY_ADDRESS>");
    console.log("      Or set TREASURY_ADDRESS in .env and redeploy");
  }
  console.log("   3. Transfer token authority to governance (optional):");
  console.log("      yarn governance:transfer");
  console.log("   4. Allow payment tokens in presale:");
  console.log("      yarn presale:allow <PAYMENT_TOKEN_MINT>");
  console.log("   5. Start presale:");
  console.log("      yarn presale:start");
  console.log("\n" + "=".repeat(60));
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error.message || error);
  if (error.logs) {
    console.error("\nTransaction logs:");
    error.logs.forEach((log: string) => console.error("  ", log));
  }
  if (error.stack && process.env.DEBUG) {
    console.error("\nStack trace:", error.stack);
  }
  console.error("\n💡 Tips:");
  console.error("   - Check your wallet balance");
  console.error("   - Verify network connection");
  console.error("   - Ensure programs are deployed (run 'anchor deploy' if needed)");
  console.error("   - Check transaction logs above for specific errors");
  process.exit(1);
});

