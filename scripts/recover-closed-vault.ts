/**
 * Recover tokens from the closed presale vault (7LkwkH3...).
 *
 * Prerequisites:
 * 1. Save your 7LkwkH3... keypair as: target/deploy/vault_recover-keypair.json
 * 2. Build: anchor build -p vault_recover
 * 3. Deploy: anchor deploy -p vault_recover --program-keypair target/deploy/vault_recover-keypair.json
 * 4. Run this script: npx ts-node scripts/recover-closed-vault.ts [amount]
 *
 * The keypair must have public key 7LkwkH3TpyhvCuVBEecFYbYk1T7c66qoYa2UpR9Q8LQj
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultRecover } from "../target/types/vault_recover";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const VAULT_RECOVER_PROGRAM_ID = new PublicKey(
  "7LkwkH3TpyhvCuVBEecFYbYk1T7c66qoYa2UpR9Q8LQj"
);
const PRESALE_TOKEN_MINT = new PublicKey(
  "EZqbnH1vttC6bdWFFMJfCMuVnyB5KCWF8k3WsmPoRUMD"
);
const PRESALE_TOKEN_VAULT_ATA = new PublicKey(
  "6sWrLVXxitu5yFnz8vHLGQKEFahxbSfq38dz5Y7HHSJM"
);

async function main() {
  const amountArg = process.argv[2] || "1000000000"; // default: 1B tokens (8 decimals)
  const amount = BigInt(amountArg);
  const decimals = 8;
  const transferAmount = amount * BigInt(10 ** decimals);

  const rpcUrl =
    process.env.ANCHOR_PROVIDER_URL || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  let walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );
  if (walletPath.startsWith("~")) {
    walletPath = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      walletPath.slice(1)
    );
  }

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  // Get mint's token program (NC token is SPL Project)
  const mintInfo = await connection.getAccountInfo(PRESALE_TOKEN_MINT);
  const tokenProgramId = mintInfo
    ? new PublicKey(mintInfo.owner)
    : TOKEN_PROGRAM_ID;

  const [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_token_vault_pda"), PRESALE_TOKEN_MINT.toBuffer()],
    VAULT_RECOVER_PROGRAM_ID
  );

  const destinationTokenAccount = await getAssociatedTokenAddress(
    PRESALE_TOKEN_MINT,
    walletKeypair.publicKey,
    false,
    tokenProgramId
  );

  console.log("🔓 Recover Tokens from Closed Vault\n");
  console.log("=".repeat(60));
  console.log("   Vault (ATA):", PRESALE_TOKEN_VAULT_ATA.toString());
  console.log("   Vault PDA:", presaleTokenVaultPda.toString());
  console.log("   Destination (your ATA):", destinationTokenAccount.toString());
  console.log("   Amount:", amount.toString(), "tokens");
  console.log("   Amount (raw):", transferAmount.toString());
  console.log("");

  // Check vault balance
  try {
    const vaultAccount = await getAccount(
      connection,
      PRESALE_TOKEN_VAULT_ATA,
      "confirmed",
      tokenProgramId
    );
    const vaultBalance = vaultAccount.amount;
    console.log("   Vault balance:", vaultBalance.toString(), "raw units");
    if (vaultBalance < transferAmount) {
      throw new Error(
        `Insufficient vault balance. Have ${vaultBalance}, need ${transferAmount}`
      );
    }
  } catch (e: any) {
    if (e.message?.includes("could not find account")) {
      throw new Error("Vault account not found. Wrong token program?");
    }
    throw e;
  }

  // Ensure destination ATA exists
  let createAtaIx = null;
  try {
    await getAccount(
      connection,
      destinationTokenAccount,
      "confirmed",
      tokenProgramId
    );
  } catch {
    createAtaIx = createAssociatedTokenAccountInstruction(
      walletKeypair.publicKey,
      destinationTokenAccount,
      walletKeypair.publicKey,
      PRESALE_TOKEN_MINT,
      tokenProgramId
    );
    console.log("   Will create destination ATA");
  }

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync("target/idl/vault_recover.json", "utf-8")
  );
  const program = new Program(idl, VAULT_RECOVER_PROGRAM_ID, provider) as Program<VaultRecover>;

  const transaction = new Transaction();
  if (createAtaIx) transaction.add(createAtaIx);

  const recoverIx = await program.methods
    .recoverTokens(new anchor.BN(transferAmount.toString()))
    .accounts({
      presaleTokenVaultPda,
      presaleTokenVault: PRESALE_TOKEN_VAULT_ATA,
      destinationTokenAccount,
      mint: PRESALE_TOKEN_MINT,
      tokenProgram: tokenProgramId,
      authority: walletKeypair.publicKey,
    })
    .instruction();
  transaction.add(recoverIx);

  console.log("\n🚀 Sending recovery transaction...");
  const sig = await sendAndConfirmTransaction(
    connection,
    transaction,
    [walletKeypair],
    { commitment: "confirmed" }
  );

  console.log("✅ Recovery successful!");
  console.log("   Signature:", sig);
  console.log(
    "   Explorer:",
    `https://explorer.solana.com/tx/${sig}?cluster=mainnet-beta`
  );
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
