import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { Presale } from "../../target/types/presale";

dotenv.config();

async function main() {
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  let walletPath = process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || process.env.USERPROFILE || "",
              ".config", "solana", "id.json");
  if (walletPath.startsWith("~")) {
    walletPath = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      walletPath.slice(1)
    );
  }

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
  
  // Load deployment info (prefer env vars for sync with nclaunch .env)
  let presaleInfo: any;
  let deploymentInfo: any;
  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
    );
    deploymentInfo = JSON.parse(
      fs.readFileSync("deployments/deployment-info.json", "utf-8")
    );
  } catch {
    presaleInfo = {};
    deploymentInfo = {};
  }

  const presaleStatePdaStr =
    process.env.PRESALE_STATE_PDA ||
    process.env.VITE_SOLANA_PRESALE_STATE_PDA ||
    presaleInfo.presaleStatePda;
  const presaleMintStr =
    process.env.PRESALE_TOKEN_MINT ||
    process.env.VITE_SOLANA_PRESALE_TOKEN_MINT ||
    presaleInfo.presaleTokenMint;

  if (!presaleStatePdaStr || !presaleMintStr) {
    throw new Error(
      "Missing presale config. Set PRESALE_STATE_PDA and PRESALE_TOKEN_MINT in .env, or ensure deployments/presale-deployment-info.json exists."
    );
  }

  const presaleStatePda = new PublicKey(presaleStatePdaStr);
  const presaleProgramId = new PublicKey(
    process.env.PRESALE_PROGRAM_ID ||
      process.env.VITE_SOLANA_PRESALE_PROGRAM_ID ||
      presaleInfo.presaleProgramId ||
      program.programId.toString()
  );
  const mainMint = new PublicKey(
    deploymentInfo.mint ||
      deploymentInfo.mintAddress ||
      presaleMintStr
  );
  const presaleMint = new PublicKey(presaleMintStr);

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  console.log("🔍 Checking Presale State and Vaults...\n");
  console.log("📡 RPC:", rpcUrl.includes("mainnet") ? "mainnet" : rpcUrl.includes("devnet") ? "devnet" : rpcUrl.slice(0, 50) + "...");
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("   Presale Token Mint:", presaleMint.toString());
  console.log("=".repeat(70));

  // Fetch presale state
  const state = await program.account.presaleState.fetch(presaleStatePda);
  
  console.log("\n📋 Presale State (from on-chain):");
  console.log("   Presale Token Mint (stored in state):", state.presaleTokenMint.toString());
  console.log("   Token Program (from state):", state.tokenProgram.toString());
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

  const tokenProgramFromState = state.tokenProgram;
  // Use mint's actual owner for vault derivation - ATA address depends on token program!
  // Presale state may have wrong token_program; NC token is SPL Project (Bp6PD8...), not SPL Token
  const mintAccountInfo = await connection.getAccountInfo(state.presaleTokenMint);
  const actualTokenProgram = mintAccountInfo
    ? new PublicKey(mintAccountInfo.owner)
    : tokenProgramFromState;
  const tokenProgramMismatch = actualTokenProgram.toString() !== tokenProgramFromState.toString();

  const presaleVault = await getAssociatedTokenAddress(
    state.presaleTokenMint,
    presaleVaultPda,
    true,
    actualTokenProgram
  );

  const mainMintVault = await getAssociatedTokenAddress(
    mainMint,
    mainMintVaultPda,
    true,
    actualTokenProgram
  );

  console.log("💰 Vault Analysis:");
  if (tokenProgramMismatch) {
    console.log("   ⚠️  Token program mismatch:");
    console.log("      Presale state says:", tokenProgramFromState.toString());
    console.log("      Mint owner (actual):", actualTokenProgram.toString());
    console.log("      Using mint owner for vault derivation.");
  }
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
    const presaleVaultAccount = await getAccount(connection, presaleVault, "confirmed", actualTokenProgram);
    const balance = presaleVaultAccount.amount / BigInt(10 ** 9);
    console.log("   ✅ Presale Vault (expected):", balance.toString(), "tokens");
  } catch (error: any) {
    console.log("   ⚠️  Presale Vault (expected): Does not exist or empty");
  }

  try {
    const mainMintVaultAccount = await getAccount(connection, mainMintVault, "confirmed", actualTokenProgram);
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

