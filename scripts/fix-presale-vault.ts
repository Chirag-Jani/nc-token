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
  console.log("🔧 Fixing Presale Vault - Transferring tokens to correct vault...\n");

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
    throw new Error("❌ deployment-info.json not found. Run 'yarn deploy' first.");
  }

  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
  }

  // Main token mint (where 100M tokens are)
  const mainMintStr = deploymentInfo.mint || deploymentInfo.mintAddress;
  if (!mainMintStr) {
    throw new Error("❌ mint or mintAddress not found in deployment-info.json");
  }
  const mainMint = new PublicKey(mainMintStr);

  // Presale token mint (what presale was initialized with)
  if (!presaleInfo.presaleTokenMint) {
    throw new Error("❌ presaleTokenMint not found in presale-deployment-info.json");
  }
  const presaleMint = new PublicKey(presaleInfo.presaleTokenMint);

  const presaleProgramId = new PublicKey(presaleInfo.presaleProgramId);

  console.log("📋 Configuration:");
  console.log("   Main Token Mint:", mainMint.toString());
  console.log("   Presale Token Mint:", presaleMint.toString());
  console.log("   Presale Program ID:", presaleProgramId.toString());
  console.log("");

  // WRONG vault (where tokens currently are - derived from main mint)
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

  // CORRECT vault (where tokens should be - derived from presale mint)
  const [correctVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      presaleMint.toBuffer(),
    ],
    presaleProgramId
  );
  const correctVault = await getAssociatedTokenAddress(
    presaleMint,
    correctVaultPda,
    true
  );

  console.log("🔍 Checking vaults...");
  console.log("   Wrong Vault (current):", wrongVault.toString());
  console.log("   Correct Vault (target):", correctVault.toString());
  console.log("");

  // Check wrong vault balance
  let wrongVaultBalance;
  try {
    const wrongVaultAccount = await getAccount(connection, wrongVault);
    wrongVaultBalance = BigInt(wrongVaultAccount.amount.toString());
    console.log("   ✅ Wrong Vault Balance:", (wrongVaultBalance / BigInt(10 ** 9)).toString(), "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Wrong vault doesn't exist or has no tokens");
    wrongVaultBalance = BigInt(0);
  }

  // Check correct vault balance
  let correctVaultBalance;
  try {
    const correctVaultAccount = await getAccount(connection, correctVault);
    correctVaultBalance = BigInt(correctVaultAccount.amount.toString());
    console.log("   ✅ Correct Vault Balance:", (correctVaultBalance / BigInt(10 ** 9)).toString(), "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Correct vault doesn't exist yet");
    correctVaultBalance = BigInt(0);
  }
  console.log("");

  if (wrongVaultBalance === BigInt(0)) {
    console.log("⚠️  No tokens found in wrong vault. Nothing to transfer.");
    return;
  }

  // Check if mints are the same
  if (mainMint.toString() === presaleMint.toString()) {
    console.log("✅ Mints are the same - no transfer needed!");
    return;
  }

  console.log("⚠️  WARNING: Presale was initialized with a different mint!");
  console.log("   The presale program expects tokens in the vault derived from presale mint.");
  console.log("   But tokens are in the vault derived from main mint.");
  console.log("");
  console.log("❌ This is a problem - the presale can't access these tokens!");
  console.log("");
  console.log("💡 Solution Options:");
  console.log("   1. Transfer tokens from wrong vault to correct vault (if presale mint has tokens)");
  console.log("   2. Redeploy presale with main mint (recommended)");
  console.log("");
  console.log("⚠️  Since presale mint is different, you need to:");
  console.log("   - Either mint tokens to presale mint and transfer to correct vault");
  console.log("   - OR redeploy presale with main mint (this is the correct approach)");
  console.log("");
  console.log("🔧 To fix properly, you should:");
  console.log("   1. Update deploy-presale.ts to use main mint instead of creating new mint");
  console.log("   2. Redeploy presale program");
  console.log("   3. Reinitialize presale with main mint");
  console.log("   4. Transfer 40M tokens to the correct vault");
}

main().catch(console.error);

