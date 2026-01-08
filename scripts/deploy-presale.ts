import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
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
import { Presale } from "../target/types/presale";
import { SplProject } from "../target/types/spl_project";

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
const PRESALE_TOKEN_DECIMALS = parseInt(
  cliArgs.decimals || process.env.PRESALE_TOKEN_DECIMALS || "9"
);
const PRESALE_TOKEN_SUPPLY = BigInt(
  cliArgs.totalSupply || process.env.PRESALE_TOKEN_SUPPLY || "1000000000"
);

async function main() {
  console.log("🚀 Starting presale deployment...\n");

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
      "test-keypair.json"
    );
  const walletPath = defaultWallet.replace(
    "~",
    process.env.HOME || process.env.USERPROFILE || ""
  );

  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Wallet not found at ${walletPath}. Please set ANCHOR_WALLET environment variable or ensure test-keypair.json exists.`
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

  // Load programs
  const presaleProgram = anchor.workspace.Presale as Program<Presale>;
  const tokenProgram = anchor.workspace.SplProject as Program<SplProject>;

  console.log("📦 Presale Program ID:", presaleProgram.programId.toString());
  console.log("📦 Token Program ID:", tokenProgram.programId.toString());
  console.log("");

  // Derive PDAs
  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    presaleProgram.programId
  );

  const [tokenStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    tokenProgram.programId
  );

  console.log("📍 Presale State PDA:", presaleStatePda.toString());
  console.log("📍 Token State PDA:", tokenStatePda.toString());
  console.log("");

  // Step 1: Check if token program is initialized
  console.log("1️⃣ Checking token program state...");
  let tokenState;
  try {
    tokenState = await tokenProgram.account.tokenState.fetch(tokenStatePda);
    console.log("   ✅ Token program state found");
    console.log("   Authority:", tokenState.authority.toString());
    console.log("   Emergency Paused:", tokenState.emergencyPaused);
  } catch (err: any) {
    console.error("   ❌ Token program not initialized!");
    console.error("   Please deploy and initialize the token program first.");
    console.error("   Run: yarn deploy");
    process.exit(1);
  }
  console.log("");

  // Step 2: Create presale token mint
  console.log("2️⃣ Creating presale token mint...");
  const presaleTokenMint = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: walletKeypair.publicKey,
      newAccountPubkey: presaleTokenMint.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      presaleTokenMint.publicKey,
      PRESALE_TOKEN_DECIMALS,
      walletKeypair.publicKey, // Mint authority (can be transferred later)
      null // No freeze authority
    )
  );

  await sendAndConfirmTransaction(
    connection,
    createMintTx,
    [walletKeypair, presaleTokenMint],
    { commitment: "confirmed" }
  );
  console.log("   ✅ Presale token mint created:", presaleTokenMint.publicKey.toString());
  console.log("");

  // Step 3: Initialize presale program
  console.log("3️⃣ Initializing presale program...");
  try {
    const initTx = await presaleProgram.methods
      .initialize(
        walletKeypair.publicKey, // admin
        presaleTokenMint.publicKey, // presale_token_mint
        tokenProgram.programId, // token_program
        tokenStatePda // token_program_state
      )
      .accounts({
        presaleState: presaleStatePda,
        payer: walletKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   ✅ Presale initialized:", initTx);

    const presaleState = await presaleProgram.account.presaleState.fetch(
      presaleStatePda
    );
    console.log("   Admin:", presaleState.admin.toString());
    console.log("   Presale Token Mint:", presaleState.presaleTokenMint.toString());
    console.log("   Token Program:", presaleState.tokenProgram.toString());
    console.log("   Status:", Object.keys(presaleState.status)[0]);
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("   ℹ️  Presale already initialized, skipping...");
    } else {
      throw err;
    }
  }
  console.log("");

  // Step 4: Create presale token vault and fund it
  console.log("4️⃣ Creating presale token vault...");
  const [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      presaleTokenMint.publicKey.toBuffer(),
    ],
    presaleProgram.programId
  );

  const presaleTokenVault = await getAssociatedTokenAddress(
    presaleTokenMint.publicKey,
    presaleTokenVaultPda,
    true
  );

  // Create the ATA if it doesn't exist
  try {
    const createVaultTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey,
        presaleTokenVault,
        presaleTokenVaultPda,
        presaleTokenMint.publicKey
      )
    );

    await sendAndConfirmTransaction(
      connection,
      createVaultTx,
      [walletKeypair],
      { commitment: "confirmed" }
    );
    console.log("   ✅ Presale token vault created");
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      console.log("   ℹ️  Presale token vault already exists");
    } else {
      throw err;
    }
  }

  // Mint presale tokens to vault
  console.log("5️⃣ Funding presale token vault...");
  try {
    const mintTx = new Transaction().add(
      createMintToInstruction(
        presaleTokenMint.publicKey,
        presaleTokenVault,
        walletKeypair.publicKey,
        Number(PRESALE_TOKEN_SUPPLY)
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [walletKeypair], {
      commitment: "confirmed",
    });
    console.log(
      "   ✅ Funded vault with",
      PRESALE_TOKEN_SUPPLY.toString(),
      "tokens"
    );
  } catch (err: any) {
    console.log("   ⚠️  Could not fund vault (may need to mint manually):", err.message);
  }
  console.log("");

  // Step 6: Save deployment info
  console.log("6️⃣ Saving deployment info...");
  const deploymentInfo = {
    presaleProgramId: presaleProgram.programId.toString(),
    tokenProgramId: tokenProgram.programId.toString(),
    presaleStatePda: presaleStatePda.toString(),
    tokenStatePda: tokenStatePda.toString(),
    presaleTokenMint: presaleTokenMint.publicKey.toString(),
    presaleTokenVault: presaleTokenVault.toString(),
    presaleTokenVaultPda: presaleTokenVaultPda.toString(),
    admin: walletKeypair.publicKey.toString(),
    totalSupply: PRESALE_TOKEN_SUPPLY.toString(),
    decimals: PRESALE_TOKEN_DECIMALS,
    network: connection.rpcEndpoint,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "presale-deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("   ✅ Deployment info saved to presale-deployment-info.json");
  console.log("");

  // Summary
  console.log("✅ Presale deployment complete!\n");
  console.log("📋 Deployment Summary:");
  console.log("   Presale Program:", presaleProgram.programId.toString());
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("   Presale Token Mint:", presaleTokenMint.publicKey.toString());
  console.log("   Presale Token Vault:", presaleTokenVault.toString());
  console.log("   Admin:", walletKeypair.publicKey.toString());
  console.log("   Total Supply:", PRESALE_TOKEN_SUPPLY.toString());
  console.log("   Decimals:", PRESALE_TOKEN_DECIMALS);
  console.log("");
  console.log("📝 Next Steps:");
  console.log("   1. Allow payment tokens: call allow_payment_token()");
  console.log("   2. Start presale: call start_presale()");
  console.log("   3. Users can now buy tokens: call buy()");
  console.log("");
}

main()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

