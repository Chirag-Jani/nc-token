import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
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

  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    program.programId
  );

  // Get mint address (check both 'mint' and 'mintAddress' for compatibility)
  const mintAddressStr = deploymentInfo.mint || deploymentInfo.mintAddress;
  if (!mintAddressStr) {
    throw new Error("❌ mint or mintAddress not found in deployment-info.json");
  }
  const mintAddress = new PublicKey(mintAddressStr);
  const [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      mintAddress.toBuffer(),
    ],
    program.programId
  );

  const { getAssociatedTokenAddress } = await import("@solana/spl-token");
  const presaleTokenVault = await getAssociatedTokenAddress(
    mintAddress,
    presaleTokenVaultPda,
    true
  );

  console.log("🔍 Checking Presale Status...\n");
  console.log("=".repeat(60));

  // Fetch presale state
  const state = await program.account.presaleState.fetch(presaleStatePda);
  
  console.log("📋 Presale State:");
  // Display status as string (Anchor enums are objects)
  let statusDisplay = "Unknown";
  if (state.status.active) statusDisplay = "Active";
  else if (state.status.notStarted) statusDisplay = "NotStarted";
  else if (state.status.paused) statusDisplay = "Paused";
  else if (state.status.stopped) statusDisplay = "Stopped";
  console.log("   Status:", statusDisplay);
  console.log("   Admin:", state.admin.toString());
  console.log("   Authority:", state.authority.toString());
  console.log("   Presale Token Mint:", state.presaleTokenMint.toString());
  console.log("   Total Tokens Sold:", state.totalTokensSold.toString());
  console.log("   Total Raised:", state.totalRaised.toString(), "lamports");
  console.log("   Max Presale Cap:", state.maxPresaleCap.toString(), "(0 = unlimited)");
  console.log("   Max Per User:", state.maxPerUser.toString(), "(0 = unlimited)");

  // Check vault balance
  try {
    const vaultInfo = await connection.getTokenAccountBalance(presaleTokenVault);
    console.log("\n💰 Presale Vault Balance:");
    console.log("   Vault Address:", presaleTokenVault.toString());
    console.log("   Balance:", vaultInfo.value.uiAmount?.toString() || "0", "tokens");
    console.log("   Decimals:", vaultInfo.value.decimals);
  } catch (err) {
    console.log("\n⚠️  Could not fetch vault balance (vault may not exist yet)");
  }

  // Check if presale is active
  // Anchor enums are objects, not strings
  console.log("\n✅ Presale Status Check:");
  let statusStr = "Unknown";
  if (state.status.active) {
    statusStr = "ACTIVE";
    console.log("   ✅ Presale is ACTIVE - ready to accept purchases");
  } else if (state.status.notStarted) {
    statusStr = "NOT_STARTED";
    console.log("   ⚠️  Presale is NOT_STARTED - not accepting purchases");
    console.log("   💡 Run: ts-node scripts/start-presale.ts");
  } else if (state.status.paused) {
    statusStr = "PAUSED";
    console.log("   ⚠️  Presale is PAUSED - not accepting purchases");
    console.log("   💡 Run: ts-node scripts/start-presale.ts");
  } else if (state.status.stopped) {
    statusStr = "STOPPED";
    console.log("   ⚠️  Presale is STOPPED - not accepting purchases");
  } else {
    console.log("   ⚠️  Presale status is unknown");
  }

  console.log("\n" + "=".repeat(60));
  console.log("📝 To test a purchase:");
  console.log("   ts-node scripts/buy-presale.ts <SOL_AMOUNT>");
  console.log("=".repeat(60));
}

main().catch(console.error);