import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../../target/types/presale";
import { PublicKey } from "@solana/web3.js";
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
  
  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    program.programId
  );

  console.log("🚀 Starting presale...");
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("   Admin:", walletKeypair.publicKey.toString());

  const tx = await program.methods
    .startPresale()
    .accountsPartial({
      presaleState: presaleStatePda,
      admin: walletKeypair.publicKey,
    })
    .rpc();

  console.log("✅ Presale started:", tx);

  // Verify
  const state = await program.account.presaleState.fetch(presaleStatePda);
  console.log("\n📋 Presale State:");
  console.log("   Status:", state.status);
  console.log("   Total Tokens Sold:", state.totalTokensSold.toString());
  console.log("   Total Raised:", state.totalRaised.toString());
}

main().catch(console.error);

