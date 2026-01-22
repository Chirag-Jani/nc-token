import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { Governance } from "../target/types/governance";
import { Presale } from "../target/types/presale";
import { SplProject } from "../target/types/spl_project";
import { loadTestKeys } from "./key-loader";

describe("Presale Buy Function Test", () => {
  // Setup provider manually for devnet
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || 
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );
  const resolvedWalletPath = walletPath.replace(
    "~",
    process.env.HOME || process.env.USERPROFILE || ""
  );

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(resolvedWalletPath, "utf-8")))
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const presaleProgram = anchor.workspace.Presale as Program<Presale>;
  const tokenProgram = anchor.workspace.SplProject as Program<SplProject>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;

  // Load keypairs
  const keys = loadTestKeys();
  const admin = keys.authority;
  const mint = keys.mint;
  const user = keys.user;

  // PDAs
  let tokenStatePda: PublicKey;
  let governanceStatePda: PublicKey;
  let presaleStatePda: PublicKey;
  let presaleTokenVaultPda: PublicKey;
  let presaleTokenVault: PublicKey;
  let solVault: PublicKey;
  let buyerPresaleTokenAccount: PublicKey;

  // Chainlink SOL/USD feed (same for devnet and mainnet)
  const CHAINLINK_SOL_USD_FEED = new PublicKey("99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR");

  // SOL amount to spend (0.01 SOL)
  const SOL_AMOUNT_LAMPORTS = new anchor.BN(0.01 * LAMPORTS_PER_SOL);

  before(async () => {
    // Check balances - skip airdrop if already funded
    const accounts = [admin, user];
    for (const account of accounts) {
      const balance = await connection.getBalance(account.publicKey);
      if (balance < 2 * LAMPORTS_PER_SOL) {
        try {
          const sig = await connection.requestAirdrop(account.publicKey, 5 * LAMPORTS_PER_SOL);
          await connection.confirmTransaction(sig);
        } catch (err: any) {
          console.log(`ℹ Skipping airdrop for ${account.publicKey.toString().slice(0, 8)}... (balance: ${balance / LAMPORTS_PER_SOL} SOL)`);
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));

    // Derive PDAs
    [tokenStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")], 
      tokenProgram.programId
    );
    [governanceStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("governance")], 
      governanceProgram.programId
    );
    [presaleStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_state")], 
      presaleProgram.programId
    );
    [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_token_vault_pda"), mint.publicKey.toBuffer()],
      presaleProgram.programId
    );
    [solVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_sol_vault"), presaleStatePda.toBuffer()],
      presaleProgram.programId
    );

    // Initialize token program if needed
    try {
      await tokenProgram.methods.initialize()
        .accounts({
          state: tokenStatePda,
          authority: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      console.log("✓ Token program initialized");
    } catch (err: any) {
      if (!err.message?.includes("already in use")) {
        console.log("ℹ Token program initialization:", err.message);
      }
    }

    // Initialize governance if needed
    try {
      const existingGovState = await governanceProgram.account.governanceState.fetch(governanceStatePda);
      console.log("ℹ Governance already initialized");
      if (!existingGovState.tokenProgramSet) {
        const actualAuthority = existingGovState.authority;
        let authorityKeypair: Keypair | null = null;
        if (actualAuthority.equals(admin.publicKey)) {
          authorityKeypair = admin;
        }
        
        const txBuilder = governanceProgram.methods.setTokenProgram(tokenProgram.programId)
          .accounts({ governanceState: governanceStatePda, authority: actualAuthority });
        
        if (authorityKeypair) {
          txBuilder.signers([authorityKeypair]);
        }
        
        await txBuilder.rpc();
      }
    } catch (err: any) {
      // Governance not initialized - initialize it
      try {
        await governanceProgram.methods
          .initialize(2, new anchor.BN(1800), [provider.wallet.publicKey, keys.signer1.publicKey, keys.signer2.publicKey, keys.signer3.publicKey])
          .accounts({
            governanceState: governanceStatePda,
            authority: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        await governanceProgram.methods.setTokenProgram(tokenProgram.programId)
          .accounts({ governanceState: governanceStatePda, authority: provider.wallet.publicKey })
          .rpc();
        console.log("✓ Governance initialized");
      } catch (initErr: any) {
        if (!initErr.message?.includes("already in use")) {
          console.log("ℹ Governance initialization:", initErr.message);
        }
      }
    }

    // Initialize presale if needed
    try {
      const existingState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
      console.log("ℹ Presale already initialized");
      // Migrate if needed
      if (!existingState.tokenPriceUsdMicro || existingState.tokenPriceUsdMicro.eq(new anchor.BN(0))) {
        const DEFAULT_TOKEN_PRICE_USD_MICRO = new anchor.BN(1000);
        try {
          await presaleProgram.methods
            .migratePresaleState(DEFAULT_TOKEN_PRICE_USD_MICRO)
            .accounts({
              presaleState: presaleStatePda,
              authority: admin.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();
          console.log("✓ Presale migrated");
        } catch (migrateErr: any) {
          if (!migrateErr.message?.includes("already")) {
            console.log("ℹ Presale migration:", migrateErr.message);
          }
        }
      }
    } catch (err: any) {
      // Presale not initialized - initialize it
      try {
        const DEFAULT_TOKEN_PRICE_USD_MICRO = new anchor.BN(1000);
        await presaleProgram.methods
          .initialize(admin.publicKey, mint.publicKey, tokenProgram.programId, tokenStatePda, DEFAULT_TOKEN_PRICE_USD_MICRO)
          .accounts({
            presaleState: presaleStatePda,
            payer: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        console.log("✓ Presale initialized");
      } catch (initErr: any) {
        if (!initErr.message?.includes("already in use")) {
          throw initErr;
        }
      }
    }

    // Get token account addresses
    buyerPresaleTokenAccount = await getAssociatedTokenAddress(mint.publicKey, user.publicKey);
    presaleTokenVault = await getAssociatedTokenAddress(mint.publicKey, presaleTokenVaultPda, true);

    // Ensure presale is started
    try {
      const presaleState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
      if (presaleState.status.paused !== undefined || presaleState.status.notStarted !== undefined) {
        try {
          await presaleProgram.methods.startPresale()
            .accounts({ presaleState: presaleStatePda, admin: admin.publicKey })
            .signers([admin])
            .rpc();
          console.log("✓ Presale started");
        } catch (err: any) {
          console.log("ℹ Could not start presale:", err.message);
        }
      } else {
        console.log("✓ Presale is already active");
      }
    } catch (err: any) {
      console.log("ℹ Could not check presale status:", err.message);
    }
  });

  it("Buy presale tokens with SOL", async () => {
    // Check if presale is initialized
    let presaleState;
    try {
      presaleState = await presaleProgram.account.presaleState.fetch(presaleStatePda);
    } catch (err: any) {
      if (err.message?.includes("AccountNotInitialized") || err.message?.includes("3012")) {
        throw new Error(
          "Presale is not initialized. Please initialize presale first:\n" +
          "  Run: yarn deploy:presale\n" +
          "  Or use the presale initialization script"
        );
      }
      throw err;
    }

    // Check if presale is active
    if (presaleState.status.paused !== undefined) {
      throw new Error("Presale is paused. Please start the presale first.");
    }
    if (presaleState.status.notStarted !== undefined) {
      throw new Error("Presale has not started. Please start the presale first.");
    }

    // Check buyer has enough SOL
    const buyerBalance = await connection.getBalance(user.publicKey);
    if (buyerBalance < Number(SOL_AMOUNT_LAMPORTS.toString())) {
      throw new Error(
        `Buyer does not have enough SOL. Required: ${SOL_AMOUNT_LAMPORTS.toString()} lamports, ` +
        `Available: ${buyerBalance} lamports`
      );
    }

    // Derive required PDAs
    const [buyerBlacklistPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), user.publicKey.toBuffer()],
      tokenProgram.programId
    );

    const [userPurchasePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_purchase"), presaleStatePda.toBuffer(), user.publicKey.toBuffer()],
      presaleProgram.programId
    );

    // Get balance before
    const balanceBefore = await connection.getTokenAccountBalance(buyerPresaleTokenAccount).catch(() => ({ value: { amount: "0" } }));

    // Execute buy with SOL
    await presaleProgram.methods.buyWithSol(SOL_AMOUNT_LAMPORTS)
      .accounts({
        presaleState: presaleStatePda,
        tokenState: tokenStatePda,
        buyer: user.publicKey,
        solVault: solVault,
        presaleTokenVaultPda: presaleTokenVaultPda,
        presaleTokenVault: presaleTokenVault,
        buyerTokenAccount: buyerPresaleTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        userPurchase: userPurchasePda,
        buyerBlacklist: buyerBlacklistPda,
        chainlinkFeed: CHAINLINK_SOL_USD_FEED,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Get balance after
    const balanceAfter = await connection.getTokenAccountBalance(buyerPresaleTokenAccount);

    // Verify tokens were received
    expect(Number(balanceAfter.value.amount)).to.be.greaterThan(Number(balanceBefore.value.amount));
    
    console.log("✓ Buy with SOL transaction completed successfully");
    console.log(`  SOL spent: ${SOL_AMOUNT_LAMPORTS.toString()} lamports (${Number(SOL_AMOUNT_LAMPORTS.toString()) / LAMPORTS_PER_SOL} SOL)`);
    console.log(`  Balance before: ${balanceBefore.value.amount}`);
    console.log(`  Balance after: ${balanceAfter.value.amount}`);
    console.log(`  Tokens received: ${Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount)}`);
  });
});
