import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Get payment token mint from CLI args or environment
  const paymentTokenMintArg = process.argv[2] || process.env.PAYMENT_TOKEN_MINT;
  
  if (!paymentTokenMintArg) {
    console.error("❌ Error: Payment token mint address required");
    console.error("Usage: ts-node scripts/allow-payment-token.ts <PAYMENT_TOKEN_MINT>");
    console.error("   Or set PAYMENT_TOKEN_MINT environment variable");
    process.exit(1);
  }

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
  
  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    program.programId
  );

  const PAYMENT_TOKEN_MINT = new PublicKey(paymentTokenMintArg);

  const [allowedTokenPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_token"),
      presaleStatePda.toBuffer(),
      PAYMENT_TOKEN_MINT.toBuffer(),
    ],
    program.programId
  );

  console.log("✅ Allowing payment token...");
  console.log("   Payment Token Mint:", PAYMENT_TOKEN_MINT.toString());
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("   Allowed Token PDA:", allowedTokenPda.toString());

  const tx = await program.methods
    .allowPaymentToken(PAYMENT_TOKEN_MINT)
    .accountsPartial({
      presaleState: presaleStatePda,
      allowedToken: allowedTokenPda,
      authority: walletKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Payment token allowed:", tx);
}

main().catch(console.error);

