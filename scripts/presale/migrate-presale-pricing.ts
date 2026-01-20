import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../../target/types/presale";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

/**
 * Migration Script: Migrate Presale to Chainlink Oracle Pricing
 * 
 * This script migrates an existing presale contract from tokens_per_sol to token_price_usd_micro.
 * It calls the migrate_presale_state function to:
 * 1. Replace tokens_per_sol field with token_price_usd_micro
 * 2. Set the initial token price in micro-USD
 * 
 * Usage:
 *   # For devnet (default):
 *   anchor run migrate-presale-pricing
 *   
 *   # Or explicitly set devnet:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com anchor run migrate-presale-pricing
 * 
 *   # With custom token price:
 *   TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
 * 
 *   # For mainnet:
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com TOKEN_PRICE_USD_MICRO=1000 anchor run migrate-presale-pricing
 * 
 * Example: If token price is $0.001, use TOKEN_PRICE_USD_MICRO=1000 (1000 micro-USD = $0.001)
 * 
 * Note: This script defaults to devnet even if Anchor.toml is set to localnet.
 *       Set ANCHOR_PROVIDER_URL environment variable to override.
 */

async function main() {
  console.log("🔄 Starting Presale Oracle Pricing Migration...\n");
  console.log("=".repeat(70));

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME || process.env.USERPROFILE || "", 
              ".config", "solana", "id.json");
  
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}`);
  }

  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  // Setup connection for migration
  //
  // IMPORTANT:
  // - We IGNORE Anchor's localnet config here on purpose.
  // - By default, this script talks to DEVNET so you can migrate an
  //   already-deployed devnet program even if Anchor.toml has cluster = "localnet".
  // - To override, set MIGRATION_RPC_URL explicitly.
  //
  // Examples:
  //   MIGRATION_RPC_URL=https://api.devnet.solana.com anchor run migrate-presale-pricing
  //   MIGRATION_RPC_URL=https://api.mainnet-beta.solana.com anchor run migrate-presale-pricing
  const rpcUrl =
    process.env.MIGRATION_RPC_URL || "https://api.devnet.solana.com";

  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  console.log("📋 Configuration:");
  console.log("   Network:", connection.rpcEndpoint);
  console.log("   Wallet:", walletKeypair.publicKey.toString());
  console.log("");

  // Load presale program
  const presaleProgram = anchor.workspace.Presale as Program<Presale>;
  console.log("📦 Presale Program ID:", presaleProgram.programId.toString());
  console.log("");

  // Load deployment info
  let presaleStatePda: PublicKey;
  try {
    const presaleInfo = JSON.parse(
      fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
    );
    presaleStatePda = new PublicKey(presaleInfo.presaleStatePda);
    console.log("✅ Loaded presale state PDA from deployment info:", presaleStatePda.toString());
  } catch (err) {
    // Calculate PDA if deployment info doesn't exist
    [presaleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_state")],
      presaleProgram.programId
    );
    console.log("ℹ️  Calculated presale state PDA:", presaleStatePda.toString());
  }
  console.log("");

  // Check if account exists first
  console.log("📊 Checking presale state account...");
  const accountInfo = await connection.getAccountInfo(presaleStatePda);
  
  if (!accountInfo) {
    console.error("   ❌ Presale state account not found!");
    console.error("");
    console.error("   The presale has not been initialized yet.");
    console.error("   Please initialize the presale first:");
    console.error("   - Run: anchor run deploy-presale");
    console.error("   - Or: yarn deploy:presale");
    console.error("");
    console.error("   Account address:", presaleStatePda.toString());
    console.error("   Program ID:", presaleProgram.programId.toString());
    throw new Error("Presale state account does not exist. Please initialize the presale first.");
  }
  
  console.log("   ✅ Account exists");
  console.log("   Account size:", accountInfo.data.length, "bytes");
  console.log("   Owner:", accountInfo.owner.toString());
  console.log("");
  
  // Fetch current state
  console.log("📊 Fetching current presale state...");
  let currentState: any = null;
  let isOldStructure = false;
  let authority: PublicKey;
  
  try {
    // Try to fetch with new structure
    currentState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
    console.log("   ✅ Presale state found");
    console.log("   Admin:", currentState.admin.toString());
    console.log("   Authority:", currentState.authority.toString());
    console.log("   Status:", Object.keys(currentState.status)[0]);
    
    // Check for old tokens_per_sol or new token_price_usd_micro
    if (currentState.tokensPerSol !== undefined) {
      console.log("   Current tokens_per_sol (old):", currentState.tokensPerSol?.toString() || "0 (not set)");
    }
    if (currentState.tokenPriceUsdMicro !== undefined) {
      console.log("   Current token_price_usd_micro:", currentState.tokenPriceUsdMicro?.toString() || "0 (not set)");
    }
    authority = currentState.authority;
  } catch (err: any) {
    // If deserialization fails, it's likely the old structure
    if (err.message?.includes("offset") || err.message?.includes("out of range") || err.message?.includes("Invalid account discriminator")) {
      console.log("   ℹ️  Detected old account structure (needs migration)");
      isOldStructure = true;
      
      // Parse authority from raw data (offset: 8 discriminator + 32 admin = 40, then 32 bytes for authority)
      const authorityBytes = accountInfo.data.slice(40, 72);
      authority = new PublicKey(authorityBytes);
      
      console.log("   Authority (from raw data):", authority.toString());
      console.log("   Account size:", accountInfo.data.length, "bytes (old structure)");
    } else {
      console.error("   ❌ Failed to deserialize presale state");
      console.error("   Error:", err.message);
      console.error("");
      console.error("   This might indicate:");
      console.error("   - Account data is corrupted");
      console.error("   - Account structure doesn't match program");
      console.error("   - Program ID mismatch");
      throw new Error(`Failed to fetch presale state: ${err.message}`);
    }
  }
  console.log("");

  // Check if already migrated
  if (currentState && currentState.tokenPriceUsdMicro && currentState.tokenPriceUsdMicro.gt(new anchor.BN(0))) {
    console.log("⚠️  WARNING: token_price_usd_micro is already set!");
    console.log("   Current value:", currentState.tokenPriceUsdMicro.toString());
    console.log("   This script will UPDATE the existing value.");
    console.log("   (Set SKIP_WARNING=true to skip this message)");
    console.log("");
    
    if (process.env.SKIP_WARNING !== 'true') {
      console.log("   Continuing with update in 3 seconds... (Ctrl+C to cancel)");
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log("");
    }
  } else if (isOldStructure || (currentState && currentState.tokensPerSol)) {
    console.log("ℹ️  Account needs migration to oracle-based pricing");
    console.log("");
  }

  // Get token_price_usd_micro from environment or use default
  // Example: If token price is $0.001, use 1000 micro-USD
  // 1 USD = 1,000,000 micro-USD
  // $0.001 = 1,000 micro-USD
  const DEFAULT_TOKEN_PRICE_USD_MICRO = new anchor.BN(1000); // $0.001 per token
  
  let tokenPriceUsdMicro: anchor.BN;
  if (process.env.TOKEN_PRICE_USD_MICRO) {
    tokenPriceUsdMicro = new anchor.BN(process.env.TOKEN_PRICE_USD_MICRO);
    console.log("📝 Using TOKEN_PRICE_USD_MICRO from environment:", tokenPriceUsdMicro.toString());
  } else {
    tokenPriceUsdMicro = DEFAULT_TOKEN_PRICE_USD_MICRO;
    console.log("📝 Using default TOKEN_PRICE_USD_MICRO:", tokenPriceUsdMicro.toString(), "($0.001 per token)");
    console.log("   (Set TOKEN_PRICE_USD_MICRO environment variable to override)");
  }
  console.log("");

  // Verify authority
  const walletAuthority = walletKeypair.publicKey;
  const isAdmin = authority.equals(walletAuthority);
  
  // For governance check, we need to fetch it from raw data if old structure
  let isGovernance = false;
  if (!isOldStructure && currentState) {
    isGovernance = currentState.governanceSet && currentState.governance.equals(walletAuthority);
  } else if (isOldStructure) {
    console.log("   ℹ️  Governance check skipped for old structure (will use authority check)");
  }
  
  if (!isAdmin && !isGovernance) {
    throw new Error(
      `Current wallet (${walletAuthority.toString()}) is not authorized.\n` +
      `Required: Admin (${authority.toString()}) or Governance`
    );
  }

  console.log("🔐 Authorization:");
  console.log("   Wallet:", walletAuthority.toString());
  console.log("   Account Authority:", authority.toString());
  if (isAdmin) {
    console.log("   ✅ Authorized as Admin");
  } else if (isGovernance) {
    console.log("   ✅ Authorized as Governance");
  } else {
    throw new Error(
      `Current wallet (${walletAuthority.toString()}) is not authorized.\n` +
      `Required: Admin (${authority.toString()}) or Governance`
    );
  }
  console.log("");

  // Perform migration
  console.log("🚀 Executing migration...");
  console.log("   This will:");
  console.log("   1. Replace tokens_per_sol with token_price_usd_micro field");
  console.log("   2. Set token_price_usd_micro to:", tokenPriceUsdMicro.toString(), "micro-USD");
  console.log("   3. Presale will now use Chainlink SOL/USD oracle for pricing");
  console.log("");

  try {
    const migrateTx = await presaleProgram.methods
      .migratePresaleState(tokenPriceUsdMicro)
      .accountsPartial({
        presaleState: presaleStatePda,
        authority: walletAuthority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("   ✅ Migration transaction:", migrateTx);
    console.log("");

    // Verify migration
    console.log("🔍 Verifying migration...");
    const updatedState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
    console.log("   ✅ Migration successful!");
    console.log("   New token_price_usd_micro:", updatedState.tokenPriceUsdMicro.toString());
    console.log("");

    // Calculate example with Chainlink price
    console.log("📊 Example Calculation (using Chainlink oracle):");
    console.log("   Token price:", (tokenPriceUsdMicro.toNumber() / 1_000_000).toFixed(6), "USD per token");
    console.log("   For 1 SOL purchase:");
    console.log("   - Program will fetch SOL/USD price from Chainlink");
    console.log("   - Calculate tokens = (SOL_amount * SOL_price_USD) / token_price_usd");
    console.log("   - Price updates automatically with SOL market price");
    console.log("");

    console.log("=".repeat(70));
    console.log("✅ Migration completed successfully!");
    console.log("=".repeat(70));
    console.log("");
    console.log("📌 Next Steps:");
    console.log("   1. Update your frontend to pass Chainlink SOL/USD feed account");
    console.log("   2. Chainlink SOL/USD feed: CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU");
    console.log("   3. Note: Use mainnet feed for both devnet and mainnet (no devnet feed available)");
    console.log("   4. Program validates feed owner (Chainlink OCR2), not specific address");
    console.log("   5. Test buy_with_sol with the Chainlink feed account");

  } catch (err: any) {
    console.error("❌ Migration failed:", err.message);
    if (err.logs) {
      console.error("   Program logs:");
      err.logs.forEach((log: string) => console.error("   ", log));
    }
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
