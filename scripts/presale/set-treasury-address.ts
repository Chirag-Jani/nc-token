import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Presale } from "../../target/types/presale";

async function main() {
  // Get treasury address from CLI args or environment
  const treasuryAddressArg = process.argv[2] || process.env.TREASURY_ADDRESS;
  
  if (!treasuryAddressArg) {
    console.error("❌ Error: Treasury address required");
    console.error("Usage: ts-node scripts/presale/set-treasury-address.ts <TREASURY_ADDRESS>");
    console.error("   Or set TREASURY_ADDRESS environment variable");
    console.error("");
    console.error("💡 The treasury address is where presale proceeds will be withdrawn to.");
    console.error("   It should be a secure wallet (multisig recommended for production).");
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

  const TREASURY_ADDRESS = new PublicKey(treasuryAddressArg);

  console.log("💰 Setting Treasury Address\n");
  console.log("=".repeat(60));
  console.log("📋 Configuration:");
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("   Treasury Address:", TREASURY_ADDRESS.toString());
  console.log("   Admin (Signer):", walletKeypair.publicKey.toString());
  console.log("");

  // Check current treasury address
  try {
    const state = await program.account.presaleState.fetch(presaleStatePda);
    const currentTreasury = state.treasuryAddress;
    
    if (currentTreasury.toString() !== PublicKey.default.toString()) {
      console.log("⚠️  Current treasury address:", currentTreasury.toString());
      console.log("   This will update it to:", TREASURY_ADDRESS.toString());
      console.log("");
    } else {
      console.log("ℹ️  No treasury address currently set (using default)");
      console.log("");
    }
  } catch (error: any) {
    console.error("❌ Failed to fetch presale state:", error.message);
    process.exit(1);
  }

  // Set treasury address
  console.log("🚀 Setting treasury address...");
  try {
    const tx = await program.methods
      .setTreasuryAddress(TREASURY_ADDRESS)
      .accountsPartial({
        presaleState: presaleStatePda,
        authority: walletKeypair.publicKey,
      })
      .rpc();

    console.log("   ✅ Treasury address set:", tx);
    console.log("");

    // Verify
    const updatedState = await program.account.presaleState.fetch(presaleStatePda);
    console.log("📋 Updated Presale State:");
    console.log("   Treasury Address:", updatedState.treasuryAddress.toString());
    console.log("");

    if (updatedState.treasuryAddress.toString() === TREASURY_ADDRESS.toString()) {
      console.log("✅ SUCCESS! Treasury address has been set.");
      console.log("   Presale proceeds can now be withdrawn to this address.");
    } else {
      console.error("   ⚠️  WARNING: Treasury address may not have been set correctly.");
    }
  } catch (error: any) {
    console.error("   ❌ Failed to set treasury address:", error.message);
    if (error.logs) {
      console.error("\nTransaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
