import * as anchor from "@coral-xyz/anchor";
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID 
} from "@solana/spl-token";
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  clusterApiUrl,
  sendAndConfirmTransaction,
  Transaction 
} from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Get amount from CLI or use default 40M
  const amountArg = process.argv[2] || "40000000";
  const amount = BigInt(amountArg);
  const decimals = parseInt(process.env.TOKEN_DECIMALS || "8");
  const transferAmount = amount * BigInt(10 ** decimals);

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet");
  console.log("🌐 Connecting to:", rpcUrl.includes("mainnet") ? "mainnet" : rpcUrl.includes("devnet") ? "devnet" : rpcUrl);
  
  const connection = new Connection(rpcUrl, "confirmed");

  let walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  // Expand ~ to home directory
  if (walletPath.startsWith("~")) {
    walletPath = walletPath.replace("~", process.env.HOME || process.env.USERPROFILE || "");
  }
  
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  // Load deployment info
  let deploymentInfo: any;
  let presaleInfo: any;
  
  try {
    deploymentInfo = JSON.parse(
      fs.readFileSync("deployments/deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ deployment-info.json not found. Run 'yarn deploy' first.");
  }

  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
  }

  // IMPORTANT: Use the same mint the presale was initialized with.
  // Different deploy scripts store this under different keys.
  const presaleMintStr =
    presaleInfo.presaleTokenMint ||
    presaleInfo.mintAddress ||
    presaleInfo.mint ||
    presaleInfo.presale_token_mint;

  if (!presaleMintStr) {
    throw new Error(
      "❌ Could not determine presale mint from presale-deployment-info.json (expected one of: presaleTokenMint, mintAddress, mint)"
    );
  }

  const mintAddress = new PublicKey(presaleMintStr);
  
  // Also get main mint for reference
  const mainMintStr = deploymentInfo.mint || deploymentInfo.mintAddress;
  const mainMint = mainMintStr ? new PublicKey(mainMintStr) : null;
  
  if (mainMint && mainMint.toString() !== mintAddress.toString()) {
    console.log("⚠️  WARNING: Presale mint differs from main token mint!");
    console.log("   Main Token Mint:", mainMint.toString());
    console.log("   Presale Token Mint:", mintAddress.toString());
    console.log("   💡 If you want to use main mint, redeploy presale with updated script");
    console.log("");
  }
  
  // Get wallet's token account (where tokens are)
  // First try to use the token account from deployment-info.json
  // If not available, fall back to computing the ATA
  let walletTokenAccount: PublicKey;
  if (deploymentInfo.tokenAccount) {
    walletTokenAccount = new PublicKey(deploymentInfo.tokenAccount);
    console.log("   Using token account from deployment-info.json");
  } else {
    walletTokenAccount = await getAssociatedTokenAddress(
      mintAddress,
      walletKeypair.publicKey
    );
    console.log("   Using computed ATA as wallet token account");
  }

  // Derive presale vault address (same mint, but owned by presale vault PDA)
  // The presale vault PDA is derived from presale program and mint
  const presaleProgramId = new PublicKey(presaleInfo.presaleProgramId);
  const [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      mintAddress.toBuffer(),
    ],
    presaleProgramId
  );

  // Get the associated token account for the presale vault PDA
  const presaleTokenVault = await getAssociatedTokenAddress(
    mintAddress,
    presaleTokenVaultPda,
    true // allowOwnerOffCurve = true for PDA
  );

  console.log("💰 Funding Presale Vault...\n");
  console.log("📋 Configuration:");
  console.log("   Mint Address:", mintAddress.toString());
  console.log("   From Wallet:", walletKeypair.publicKey.toString());
  console.log("   Wallet Token Account:", walletTokenAccount.toString());
  console.log("   Presale Vault PDA:", presaleTokenVaultPda.toString());
  console.log("   Presale Vault (ATA):", presaleTokenVault.toString());
  console.log("   Amount to Transfer:", amount.toString(), "tokens");
  console.log("   Amount (with decimals):", transferAmount.toString(), "\n");

  // Check wallet balance
  console.log("🔍 Checking balances...");
  let walletBalance;
  try {
    walletBalance = await connection.getTokenAccountBalance(walletTokenAccount);
    console.log("   ✅ Wallet Balance:", walletBalance.value.uiAmount?.toString() || "0", "tokens");
  } catch (error: any) {
    throw new Error(`❌ Could not fetch wallet balance. Token account may not exist. Error: ${error.message}`);
  }

  if (BigInt(walletBalance.value.amount) < transferAmount) {
    throw new Error(
      `❌ Insufficient balance. Need ${amount.toString()} tokens (${transferAmount.toString()} with decimals), ` +
      `have ${walletBalance.value.uiAmount?.toString() || "0"} tokens`
    );
  }

  // Check if presale vault exists
  let vaultExists = false;
  try {
    const vaultInfo = await connection.getTokenAccountBalance(presaleTokenVault);
    vaultExists = true;
    console.log("   ✅ Presale Vault Balance:", vaultInfo.value.uiAmount?.toString() || "0", "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Presale vault does not exist. Creating it...");
    vaultExists = false;
  }
  console.log("");

  // Create transaction
  const transaction = new Transaction();

  // Create vault ATA if it doesn't exist
  if (!vaultExists) {
    console.log("📝 Creating presale vault token account...");
    transaction.add(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey, // payer
        presaleTokenVault, // token account to create
        presaleTokenVaultPda, // owner (the PDA)
        mintAddress // mint
      )
    );
  }

  // Transfer tokens
  console.log("📝 Adding transfer instruction...");
  transaction.add(
    createTransferInstruction(
      walletTokenAccount,
      presaleTokenVault,
      walletKeypair.publicKey,
      transferAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  console.log("🚀 Sending transaction...\n");
  const tx = await sendAndConfirmTransaction(
    connection,
    transaction,
    [walletKeypair],
    { commitment: "confirmed" }
  );

  console.log("✅ Transfer successful!");
  console.log("   Transaction:", tx);

  // Verify vault balance
  const vaultBalance = await connection.getTokenAccountBalance(presaleTokenVault);
  console.log("   Presale Vault Balance:", vaultBalance.value.uiAmount?.toString() || "0");
}

main().catch(console.error);