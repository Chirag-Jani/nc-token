import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
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
import { Presale } from "../../target/types/presale";
import { SplProject } from "../../target/types/spl_project";

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

  // Step 2: Use existing token mint (from main token deployment)
  console.log("2️⃣ Using existing token mint from main deployment...");
  
  // Load main token deployment info to get the mint
  let mainDeploymentInfo: any;
  try {
    mainDeploymentInfo = JSON.parse(
      fs.readFileSync("deployments/deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ deployment-info.json not found. Deploy token program first with 'yarn deploy'");
  }

  const mainMintStr = mainDeploymentInfo.mint || mainDeploymentInfo.mintAddress;
  if (!mainMintStr) {
    throw new Error("❌ mint or mintAddress not found in deployment-info.json");
  }
  const presaleTokenMint = new PublicKey(mainMintStr);
  
  console.log("   ✅ Using main token mint:", presaleTokenMint.toString());
  console.log("   💡 This ensures presale uses the same mint as your 100M token supply");
  console.log("");

  // Step 3: Initialize presale program
  console.log("3️⃣ Initializing presale program...");
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
    
    const initTx = await presaleProgram.methods
      .initialize(
        walletKeypair.publicKey, // admin
        presaleTokenMint, // presale_token_mint (using main token mint)
        tokenProgram.programId, // token_program
        tokenStatePda, // token_program_state
        tokenPriceUsdMicro // token_price_usd_micro
      )
      .accountsPartial({
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
    console.log("   Token Price (USD micro):", presaleState.tokenPriceUsdMicro.toString());
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
      presaleTokenMint.toBuffer(),
    ],
    presaleProgram.programId
  );

  const presaleTokenVault = await getAssociatedTokenAddress(
    presaleTokenMint,
    presaleTokenVaultPda,
    true
  );

  // Create the ATA if it doesn't exist
  // For PDAs, we need to use createIdempotent or create it manually
  // The vault will be created automatically when tokens are transferred to it
  // But we can check if it exists first
  try {
    const vaultInfo = await connection.getAccountInfo(presaleTokenVault);
    if (vaultInfo) {
      console.log("   ℹ️  Presale token vault already exists");
    } else {
      console.log("   ℹ️  Presale token vault will be created automatically when funded");
      console.log("   💡 Use 'ts-node scripts/fund-presale-vault.ts' to transfer tokens");
    }
  } catch (err: any) {
    console.log("   ℹ️  Presale token vault will be created automatically when funded");
    console.log("   💡 Use 'ts-node scripts/fund-presale-vault.ts' to transfer tokens");
  }

  // Note: Tokens should be transferred to vault using fund-presale-vault.ts
  // We don't mint here because we're using the existing main token mint
  console.log("5️⃣ Presale vault ready for funding...");
  console.log("   💡 Use 'ts-node scripts/fund-presale-vault.ts <amount>' to transfer tokens");
  console.log("   💡 Example: ts-node scripts/fund-presale-vault.ts 40000000");
  console.log("");

  // Step 6: Save deployment info
  console.log("6️⃣ Saving deployment info...");
  const deploymentInfo = {
    presaleProgramId: presaleProgram.programId.toString(),
    tokenProgramId: tokenProgram.programId.toString(),
    presaleStatePda: presaleStatePda.toString(),
    tokenStatePda: tokenStatePda.toString(),
    presaleTokenMint: presaleTokenMint.toString(),
    presaleTokenVault: presaleTokenVault.toString(),
    presaleTokenVaultPda: presaleTokenVaultPda.toString(),
    admin: walletKeypair.publicKey.toString(),
    totalSupply: PRESALE_TOKEN_SUPPLY.toString(),
    decimals: PRESALE_TOKEN_DECIMALS,
    network: connection.rpcEndpoint,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployments/presale-deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("   ✅ Deployment info saved to presale-deployment-info.json");
  console.log("");

  // Summary
  console.log("✅ Presale deployment complete!\n");
  console.log("📋 Deployment Summary:");
  console.log("   Presale Program:", presaleProgram.programId.toString());
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("   Presale Token Mint:", presaleTokenMint.toString());
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

