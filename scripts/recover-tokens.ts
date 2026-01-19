import * as anchor from "@coral-xyz/anchor";
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getAccount
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

async function main() {
  console.log("🔄 Recovering 40M tokens from wrong vault...\n");

  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  // Load deployment info
  let deploymentInfo: any;
  let presaleInfo: any;
  
  try {
    deploymentInfo = JSON.parse(
      fs.readFileSync("deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ deployment-info.json not found.");
  }

  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ presale-deployment-info.json not found.");
  }

  // Main token mint (where tokens are)
  const mainMintStr = deploymentInfo.mint || deploymentInfo.mintAddress;
  if (!mainMintStr) {
    throw new Error("❌ mint not found in deployment-info.json");
  }
  const mainMint = new PublicKey(mainMintStr);

  const presaleProgramId = new PublicKey(presaleInfo.presaleProgramId);

  // Wrong vault (where 40M tokens are - derived from main mint)
  const [wrongVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      mainMint.toBuffer(),
    ],
    presaleProgramId
  );

  const wrongVault = await getAssociatedTokenAddress(
    mainMint,
    wrongVaultPda,
    true
  );

  // Wallet token account (destination)
  const walletTokenAccount = await getAssociatedTokenAddress(
    mainMint,
    walletKeypair.publicKey
  );

  console.log("📋 Recovery Details:");
  console.log("   Main Token Mint:", mainMint.toString());
  console.log("   Wrong Vault (source):", wrongVault.toString());
  console.log("   Wallet Token Account (destination):", walletTokenAccount.toString());
  console.log("");

  // Check balance
  console.log("🔍 Checking balances...");
  let wrongVaultBalance;
  try {
    const wrongVaultAccount = await getAccount(connection, wrongVault);
    wrongVaultBalance = BigInt(wrongVaultAccount.amount.toString());
    const tokens = wrongVaultBalance / BigInt(10 ** 9);
    console.log("   ✅ Wrong Vault Balance:", tokens.toString(), "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Wrong vault doesn't exist or has no tokens");
    wrongVaultBalance = BigInt(0);
  }

  if (wrongVaultBalance === BigInt(0)) {
    console.log("\n⚠️  No tokens to recover!");
    return;
  }

  // Check wallet balance
  let walletBalance;
  try {
    const walletAccount = await getAccount(connection, walletTokenAccount);
    walletBalance = BigInt(walletAccount.amount.toString());
    const tokens = walletBalance / BigInt(10 ** 9);
    console.log("   ✅ Wallet Balance:", tokens.toString(), "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Wallet token account doesn't exist yet");
    walletBalance = BigInt(0);
  }
  console.log("");

  // Transfer all tokens from wrong vault to wallet
  console.log("📝 Transferring tokens from wrong vault to wallet...");
  console.log("   Amount:", (wrongVaultBalance / BigInt(10 ** 9)).toString(), "tokens");
  console.log("");

  // Get the PDA bump for signing
  const [_, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      mainMint.toBuffer(),
    ],
    presaleProgramId
  );

  const seeds = [
    Buffer.from("presale_token_vault_pda"),
    mainMint.toBuffer(),
    Buffer.from([bump]),
  ];

  const transferTx = new Transaction().add(
    createTransferInstruction(
      wrongVault,
      walletTokenAccount,
      wrongVaultPda,
      wrongVaultBalance,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  // Note: We can't sign with the PDA from outside the program
  // The PDA can only sign from within the presale program
  // So we need to create a CPI instruction or use a different approach
  
  console.log("⚠️  WARNING: Cannot transfer directly - PDA can only sign from within program");
  console.log("   The tokens are locked in the vault until presale program transfers them");
  console.log("");
  console.log("💡 Solution: Since we're redeploying presale, we can:");
  console.log("   1. Redeploy presale with new program ID");
  console.log("   2. The old vault will be inaccessible (tokens remain but can't be used)");
  console.log("   3. Transfer 40M tokens from your wallet to the NEW correct vault");
  console.log("");
  console.log("📝 Your wallet should still have the 40M tokens");
  console.log("   Let's check your main wallet token account...");

  // Check main wallet token account (from deployment-info.json)
  const mainWalletTokenAccount = new PublicKey(deploymentInfo.tokenAccount);
  try {
    const mainAccount = await getAccount(connection, mainWalletTokenAccount);
    const balance = mainAccount.amount / BigInt(10 ** 9);
    console.log("   ✅ Main Wallet Token Account:", mainWalletTokenAccount.toString());
    console.log("   ✅ Balance:", balance.toString(), "tokens");
    
    if (balance >= BigInt(40000000)) {
      console.log("\n✅ You have enough tokens in your wallet!");
      console.log("   After redeploying presale, transfer 40M to the new vault.");
    } else {
      console.log("\n⚠️  You may need to recover tokens from the wrong vault");
      console.log("   But since PDA can't sign externally, tokens in wrong vault are locked");
    }
  } catch (error: any) {
    console.log("   ⚠️  Could not check main wallet account");
  }
}

main().catch(console.error);

