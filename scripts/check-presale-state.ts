import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import * as path from "path";
import * as fs from "fs";

async function main() {
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Presale as Program<Presale>;
  
  // Load deployment info
  const presaleInfo = JSON.parse(
    fs.readFileSync("presale-deployment-info.json", "utf-8")
  );
  const deploymentInfo = JSON.parse(
    fs.readFileSync("deployment-info.json", "utf-8")
  );

  const presaleStatePda = new PublicKey(presaleInfo.presaleStatePda);
  const presaleProgramId = program.programId;
  const mainMint = new PublicKey(deploymentInfo.mint || deploymentInfo.mintAddress);
  const presaleMint = new PublicKey(presaleInfo.presaleTokenMint);

  console.log("🔍 Checking Presale State and Vaults...\n");
  console.log("=".repeat(70));

  // Fetch presale state
  const state = await program.account.presaleState.fetch(presaleStatePda);
  
  console.log("\n📋 Presale State (from on-chain):");
  console.log("   Presale Token Mint (stored in state):", state.presaleTokenMint.toString());
  console.log("   Status:", Object.keys(state.status)[0]);
  console.log("   Total Tokens Sold:", state.totalTokensSold.toString());
  console.log("");

  console.log("📋 Mint Comparison:");
  console.log("   Main Token Mint:", mainMint.toString());
  console.log("   Presale Token Mint (from JSON):", presaleMint.toString());
  console.log("   Presale Token Mint (from state):", state.presaleTokenMint.toString());
  console.log("   Match:", state.presaleTokenMint.toString() === presaleMint.toString() ? "✅ YES" : "❌ NO");
  console.log("   Same as main mint:", state.presaleTokenMint.toString() === mainMint.toString() ? "✅ YES" : "❌ NO");
  console.log("");

  // Derive vaults
  const [presaleVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      state.presaleTokenMint.toBuffer(), // Use mint from state
    ],
    presaleProgramId
  );

  const [mainMintVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      mainMint.toBuffer(), // Use main mint
    ],
    presaleProgramId
  );

  const presaleVault = await getAssociatedTokenAddress(
    state.presaleTokenMint,
    presaleVaultPda,
    true
  );

  const mainMintVault = await getAssociatedTokenAddress(
    mainMint,
    mainMintVaultPda,
    true
  );

  console.log("💰 Vault Analysis:");
  console.log("   Presale expects vault (from presale mint):");
  console.log("      PDA:", presaleVaultPda.toString());
  console.log("      ATA:", presaleVault.toString());
  
  console.log("   Vault you funded (from main mint):");
  console.log("      PDA:", mainMintVaultPda.toString());
  console.log("      ATA:", mainMintVault.toString());
  console.log("");

  // Check balances
  console.log("💵 Checking Token Balances:");
  
  try {
    const presaleVaultAccount = await getAccount(connection, presaleVault);
    const balance = presaleVaultAccount.amount / BigInt(10 ** 9);
    console.log("   ✅ Presale Vault (expected):", balance.toString(), "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Presale Vault (expected): Does not exist or empty");
  }

  try {
    const mainMintVaultAccount = await getAccount(connection, mainMintVault);
    const balance = mainMintVaultAccount.amount / BigInt(10 ** 9);
    console.log("   ✅ Main Mint Vault (where you sent tokens):", balance.toString(), "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Main Mint Vault: Does not exist or empty");
  }

  console.log("\n" + "=".repeat(70));
  
  // Conclusion
  if (state.presaleTokenMint.toString() !== mainMint.toString()) {
    console.log("\n❌ PROBLEM IDENTIFIED:");
    console.log("   Presale was initialized with a DIFFERENT mint than your main token!");
    console.log("   Presale expects tokens in vault derived from:", state.presaleTokenMint.toString());
    console.log("   But you have tokens in vault derived from:", mainMint.toString());
    console.log("   These are DIFFERENT vaults - presale cannot access your tokens!");
    console.log("\n💡 SOLUTION:");
    console.log("   You need to reinitialize presale with the main mint.");
    console.log("   Since presale state cannot be changed, you need to:");
    console.log("   1. Close the presale state account (if possible)");
    console.log("   2. OR redeploy presale program with new program ID");
    console.log("   3. Reinitialize with main mint");
    console.log("   4. Transfer tokens to correct vault");
  } else {
    console.log("\n✅ GOOD NEWS:");
    console.log("   Presale is using the correct mint!");
    console.log("   Tokens should be accessible.");
  }
}

main().catch(console.error);

