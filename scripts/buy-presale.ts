import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../target/types/presale";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

async function main() {
  const solAmount = parseFloat(process.argv[2] || "0.1"); // Default 0.1 SOL
  const solAmountLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

  if (solAmount <= 0) {
    console.error("❌ Error: SOL amount must be greater than 0");
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
  
  // Load deployment info
  let presaleInfo: any;
  let deploymentInfo: any;
  
  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
  }

  try {
    deploymentInfo = JSON.parse(
      fs.readFileSync("deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ deployment-info.json not found. Run 'yarn deploy' first.");
  }

  const [presaleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale_state")],
    program.programId
  );

  // Get token program ID
  if (!deploymentInfo.programId) {
    throw new Error("❌ programId not found in deployment-info.json");
  }
  const tokenProgramId = new PublicKey(deploymentInfo.programId);
  const [tokenStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    tokenProgramId
  );

  // IMPORTANT: Use presale token mint from presale-deployment-info.json, not the main token mint
  // The presale was initialized with its own mint (presaleTokenMint)
  if (!presaleInfo.presaleTokenMint) {
    throw new Error("❌ presaleTokenMint not found in presale-deployment-info.json");
  }
  const presaleTokenMint = new PublicKey(presaleInfo.presaleTokenMint);

  // Derive presale_token_vault_pda using the presale token mint (not the main token mint)
  const [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_token_vault_pda"),
      presaleTokenMint.toBuffer(),
    ],
    program.programId
  );

  const presaleTokenVault = await getAssociatedTokenAddress(
    presaleTokenMint,
    presaleTokenVaultPda,
    true
  );

  const buyerTokenAccount = await getAssociatedTokenAddress(
    presaleTokenMint,
    walletKeypair.publicKey
  );

  // Derive sol_vault PDA - seeds are ["presale_sol_vault", presale_state_pda]
  const [solVault] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("presale_sol_vault"),
      presaleStatePda.toBuffer()
    ],
    program.programId
  );

  const [userPurchasePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_purchase"),
      presaleStatePda.toBuffer(),
      walletKeypair.publicKey.toBuffer(),
    ],
    program.programId
  );

  // Chainlink SOL/USD feed addresses
  // Note: The Chainlink OCR2 program ID is the same on both devnet and mainnet
  // Since our program only validates the feed owner (Chainlink OCR2), we can use
  // the mainnet feed address for both networks. The program will accept any feed
  // owned by the Chainlink OCR2 program.
  const CHAINLINK_SOL_USD_FEED = new PublicKey("CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU");
  
  // Use the same feed for both devnet and mainnet
  // The program validates owner == Chainlink OCR2 program, not the specific address
  const chainlinkFeed = CHAINLINK_SOL_USD_FEED;
  const isMainnet = connection.rpcEndpoint.includes("mainnet");

  console.log("🛒 Buying presale tokens...");
  console.log("   SOL Amount:", solAmount, "SOL");
  console.log("   Buyer:", walletKeypair.publicKey.toString());
  console.log("   Chainlink Feed:", chainlinkFeed.toString(), isMainnet ? "(Mainnet)" : "(Devnet)");

  try {
    const tx = await program.methods
      .buyWithSol(new anchor.BN(solAmountLamports))
      .accountsPartial({
        presaleState: presaleStatePda,
        buyer: walletKeypair.publicKey,
        tokenState: tokenStatePda,
        buyerBlacklist: SystemProgram.programId,
        solVault: solVault,
        presaleTokenVault: presaleTokenVault,
        presaleTokenVaultPda: presaleTokenVaultPda,
        buyerTokenAccount: buyerTokenAccount,
        chainlinkFeed: chainlinkFeed, // Add Chainlink feed account
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        userPurchase: userPurchasePda,
      })
      .rpc();

    console.log("✅ Purchase successful!");
    console.log("   Transaction:", tx);

    // Check balance
    const balance = await connection.getTokenAccountBalance(buyerTokenAccount);
    console.log("   Your token balance:", balance.value.uiAmount?.toString() || "0");
  } catch (error: any) {
    console.error("❌ Purchase failed:", error.message);
    if (error.logs) {
      console.error("\nTransaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

main().catch(console.error);