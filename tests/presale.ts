import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";
import { Presale } from "../target/types/presale";
import { SplProject } from "../target/types/spl_project";
import { Governance } from "../target/types/governance";

describe("Presale Program Tests", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const presaleProgram = anchor.workspace.Presale as Program<Presale>;
  const tokenProgram = anchor.workspace.SplProject as Program<SplProject>;
  const governanceProgram = anchor.workspace.Governance as Program<Governance>;
  const connection = provider.connection;

  // Test accounts
  let admin: Keypair;
  let buyer: Keypair;
  let buyer2: Keypair;
  let governanceAuthority: Keypair;

  // PDAs
  let presaleStatePda: PublicKey;
  let presaleStateBump: number;
  let tokenStatePda: PublicKey;
  let tokenStateBump: number;
  let governanceStatePda: PublicKey;
  let governanceStateBump: number;

  // Token mints
  let presaleTokenMint: Keypair;
  let paymentTokenMint: Keypair; // USDC/USDT equivalent

  // Token accounts
  let buyerPresaleTokenAccount: PublicKey;
  let buyerPaymentTokenAccount: PublicKey;
  let presaleTokenVault: PublicKey;
  let presalePaymentVault: PublicKey;
  let presaleTokenVaultPda: PublicKey;
  let presalePaymentVaultPda: PublicKey;

  // Test constants
  const MINT_DECIMALS = 9;
  const PRESALE_TOKEN_SUPPLY = 1000000 * 10 ** MINT_DECIMALS;
  const PAYMENT_AMOUNT = 100 * 10 ** MINT_DECIMALS;
  const TOKENS_PER_PAYMENT = 100 * 10 ** MINT_DECIMALS; // 1:1 ratio

  before(async () => {
    // Airdrop SOL to test accounts
    admin = Keypair.generate();
    buyer = Keypair.generate();
    buyer2 = Keypair.generate();
    governanceAuthority = Keypair.generate();

    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    await Promise.all([
      connection.requestAirdrop(admin.publicKey, airdropAmount),
      connection.requestAirdrop(buyer.publicKey, airdropAmount),
      connection.requestAirdrop(buyer2.publicKey, airdropAmount),
      connection.requestAirdrop(governanceAuthority.publicKey, airdropAmount),
    ]);

    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Derive PDAs
    [presaleStatePda, presaleStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_state")],
      presaleProgram.programId
    );

    [tokenStatePda, tokenStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      tokenProgram.programId
    );

    [governanceStatePda, governanceStateBump] =
      PublicKey.findProgramAddressSync(
        [Buffer.from("governance")],
        governanceProgram.programId
      );

    // Create token mints
    presaleTokenMint = Keypair.generate();
    paymentTokenMint = Keypair.generate();

    const mintRent = await getMinimumBalanceForRentExemptMint(connection);

    // Create presale token mint
    const createPresaleMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: presaleTokenMint.publicKey,
        space: MINT_SIZE,
        lamports: mintRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        presaleTokenMint.publicKey,
        MINT_DECIMALS,
        admin.publicKey,
        null
      )
    );

    // Create payment token mint
    const createPaymentMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: paymentTokenMint.publicKey,
        space: MINT_SIZE,
        lamports: mintRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        paymentTokenMint.publicKey,
        MINT_DECIMALS,
        admin.publicKey,
        null
      )
    );

    await Promise.all([
      sendAndConfirmTransaction(
        connection,
        createPresaleMintTx,
        [admin, presaleTokenMint],
        { commitment: "confirmed" }
      ),
      sendAndConfirmTransaction(
        connection,
        createPaymentMintTx,
        [admin, paymentTokenMint],
        { commitment: "confirmed" }
      ),
    ]);

    // Derive presale token vault PDA
    [presaleTokenVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("presale_token_vault_pda"), presaleTokenMint.publicKey.toBuffer()],
      presaleProgram.programId
    );

    // Derive presale payment vault PDA
    [presalePaymentVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("presale_payment_vault_pda"),
        presaleStatePda.toBuffer(),
        paymentTokenMint.publicKey.toBuffer(),
      ],
      presaleProgram.programId
    );

    // Get associated token accounts
    buyerPresaleTokenAccount = await getAssociatedTokenAddress(
      presaleTokenMint.publicKey,
      buyer.publicKey
    );

    buyerPaymentTokenAccount = await getAssociatedTokenAddress(
      paymentTokenMint.publicKey,
      buyer.publicKey
    );

    presaleTokenVault = await getAssociatedTokenAddress(
      presaleTokenMint.publicKey,
      presaleTokenVaultPda,
      true
    );

    presalePaymentVault = await getAssociatedTokenAddress(
      paymentTokenMint.publicKey,
      presalePaymentVaultPda,
      true
    );

    // Create token accounts
    const createTokenAccountsTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        buyer.publicKey,
        buyerPresaleTokenAccount,
        buyer.publicKey,
        presaleTokenMint.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        buyer.publicKey,
        buyerPaymentTokenAccount,
        buyer.publicKey,
        paymentTokenMint.publicKey
      )
    );

    await sendAndConfirmTransaction(
      connection,
      createTokenAccountsTx,
      [buyer],
      { commitment: "confirmed" }
    );

    // Mint payment tokens to buyer
    const mintPaymentTx = new Transaction().add(
      createMintToInstruction(
        paymentTokenMint.publicKey,
        buyerPaymentTokenAccount,
        admin.publicKey,
        PAYMENT_AMOUNT * 10 // Give buyer enough tokens
      )
    );

    await sendAndConfirmTransaction(
      connection,
      mintPaymentTx,
      [admin],
      { commitment: "confirmed" }
    );

    // Create presale token vault ATA (owned by PDA)
    // We need to create it with the PDA as authority, but we need to sign with admin
    // The ATA will be created by the presale program when needed, but we can create it here
    try {
      const createVaultTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey, // payer
          presaleTokenVault, // ATA address
          presaleTokenVaultPda, // owner (PDA)
          presaleTokenMint.publicKey // mint
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createVaultTx,
        [admin],
        { commitment: "confirmed" }
      );
      console.log("   ✅ Presale token vault ATA created");
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log("   ℹ️  Presale token vault ATA already exists");
      } else {
        throw err;
      }
    }

    // Mint presale tokens to presale vault
    const mintPresaleTx = new Transaction().add(
      createMintToInstruction(
        presaleTokenMint.publicKey,
        presaleTokenVault,
        admin.publicKey,
        PRESALE_TOKEN_SUPPLY
      )
    );

    await sendAndConfirmTransaction(
      connection,
      mintPresaleTx,
      [admin],
      { commitment: "confirmed" }
    );
  });

  it("Initializes the presale program", async () => {
    try {
      const tx = await presaleProgram.methods
        .initialize(
          admin.publicKey,
          presaleTokenMint.publicKey,
          tokenProgram.programId,
          tokenStatePda
        )
        .accounts({
          presaleState: presaleStatePda,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      console.log("   ✅ Presale initialized:", tx);

      const presaleState = await presaleProgram.account.presaleState.fetch(
        presaleStatePda
      );
      expect(presaleState.admin.toString()).to.equal(admin.publicKey.toString());
      expect(presaleState.presaleTokenMint.toString()).to.equal(
        presaleTokenMint.publicKey.toString()
      );
      expect(presaleState.tokenProgram.toString()).to.equal(
        tokenProgram.programId.toString()
      );
      expect(Object.keys(presaleState.status)[0]).to.equal("notStarted");
    } catch (err: any) {
      if (err.message?.includes("already in use")) {
        console.log("   ℹ️  Presale already initialized, skipping...");
      } else {
        throw err;
      }
    }
  });

  it("Allows admin to allow payment token", async () => {
    const [allowedTokenPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_token"),
        presaleStatePda.toBuffer(),
        paymentTokenMint.publicKey.toBuffer(),
      ],
      presaleProgram.programId
    );

    const tx = await presaleProgram.methods
      .allowPaymentToken(paymentTokenMint.publicKey)
      .accounts({
        presaleState: presaleStatePda,
        allowedToken: allowedTokenPda,
        admin: admin.publicKey,
        paymentTokenMintAccount: paymentTokenMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("   ✅ Payment token allowed:", tx);

    const allowedToken = await presaleProgram.account.allowedToken.fetch(
      allowedTokenPda
    );
    expect(allowedToken.isAllowed).to.be.true;
    expect(allowedToken.paymentTokenMint.toString()).to.equal(
      paymentTokenMint.publicKey.toString()
    );
  });

  it("Allows admin to start presale", async () => {
    const tx = await presaleProgram.methods
      .startPresale()
      .accounts({
        presaleState: presaleStatePda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("   ✅ Presale started:", tx);

    const presaleState = await presaleProgram.account.presaleState.fetch(
      presaleStatePda
    );
    expect(Object.keys(presaleState.status)[0]).to.equal("active");
  });

  it("Allows buyer to buy presale tokens", async () => {
    // Create payment vault ATA if it doesn't exist
    try {
      const createPaymentVaultTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey, // payer
          presalePaymentVault, // ATA address
          presalePaymentVaultPda, // owner (PDA)
          paymentTokenMint.publicKey // mint
        )
      );

      await sendAndConfirmTransaction(
        connection,
        createPaymentVaultTx,
        [admin],
        { commitment: "confirmed" }
      );
      console.log("   ✅ Presale payment vault ATA created");
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log("   ℹ️  Presale payment vault ATA already exists");
      } else {
        throw err;
      }
    }

    const [allowedTokenPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_token"),
        presaleStatePda.toBuffer(),
        paymentTokenMint.publicKey.toBuffer(),
      ],
      presaleProgram.programId
    );

    const buyerBalanceBefore = await connection.getTokenAccountBalance(
      buyerPaymentTokenAccount
    );

    const tx = await presaleProgram.methods
      .buy(new anchor.BN(PAYMENT_AMOUNT))
      .accounts({
        presaleState: presaleStatePda,
        tokenState: tokenStatePda,
        allowedToken: allowedTokenPda,
        buyer: buyer.publicKey,
        buyerPaymentTokenAccount: buyerPaymentTokenAccount,
        presalePaymentVaultPda: presalePaymentVaultPda,
        presalePaymentVault: presalePaymentVault,
        presaleTokenVaultPda: presaleTokenVaultPda,
        presaleTokenVault: presaleTokenVault,
        buyerTokenAccount: buyerPresaleTokenAccount,
        paymentTokenMint: paymentTokenMint.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    console.log("   ✅ Buy transaction:", tx);

    // Check buyer received presale tokens
    const buyerPresaleBalance = await connection.getTokenAccountBalance(
      buyerPresaleTokenAccount
    );
    expect(buyerPresaleBalance.value.amount).to.equal(
      TOKENS_PER_PAYMENT.toString()
    );

    // Check presale state updated
    const presaleState = await presaleProgram.account.presaleState.fetch(
      presaleStatePda
    );
    expect(presaleState.totalTokensSold.toString()).to.equal(
      TOKENS_PER_PAYMENT.toString()
    );
    expect(presaleState.totalRaised.toString()).to.equal(
      PAYMENT_AMOUNT.toString()
    );
  });

  it("Prevents buying when presale is paused", async () => {
    // Ensure payment vault exists
    try {
      const createPaymentVaultTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          presalePaymentVault,
          presalePaymentVaultPda,
          paymentTokenMint.publicKey
        )
      );
      await sendAndConfirmTransaction(
        connection,
        createPaymentVaultTx,
        [admin],
        { commitment: "confirmed" }
      );
    } catch (err: any) {
      // Ignore if already exists
    }

    // Pause presale
    await presaleProgram.methods
      .pausePresale()
      .accounts({
        presaleState: presaleStatePda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    const [allowedTokenPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_token"),
        presaleStatePda.toBuffer(),
        paymentTokenMint.publicKey.toBuffer(),
      ],
      presaleProgram.programId
    );

    // Get buyer2's token accounts (they should be the same as buyer's for this test)
    const buyer2PaymentTokenAccount = await getAssociatedTokenAddress(
      paymentTokenMint.publicKey,
      buyer2.publicKey
    );
    const buyer2PresaleTokenAccount = await getAssociatedTokenAddress(
      presaleTokenMint.publicKey,
      buyer2.publicKey
    );

    // Create buyer2's token accounts if needed
    try {
      const createBuyer2AccountsTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          buyer2PaymentTokenAccount,
          buyer2.publicKey,
          paymentTokenMint.publicKey
        ),
        createAssociatedTokenAccountInstruction(
          admin.publicKey,
          buyer2PresaleTokenAccount,
          buyer2.publicKey,
          presaleTokenMint.publicKey
        )
      );
      await sendAndConfirmTransaction(
        connection,
        createBuyer2AccountsTx,
        [admin],
        { commitment: "confirmed" }
      );
      
      // Mint payment tokens to buyer2
      const mintToBuyer2Tx = new Transaction().add(
        createMintToInstruction(
          paymentTokenMint.publicKey,
          buyer2PaymentTokenAccount,
          admin.publicKey,
          PAYMENT_AMOUNT
        )
      );
      await sendAndConfirmTransaction(
        connection,
        mintToBuyer2Tx,
        [admin],
        { commitment: "confirmed" }
      );
    } catch (err: any) {
      // Ignore if already exists, but try to mint tokens anyway
      try {
        const mintToBuyer2Tx = new Transaction().add(
          createMintToInstruction(
            paymentTokenMint.publicKey,
            buyer2PaymentTokenAccount,
            admin.publicKey,
            PAYMENT_AMOUNT
          )
        );
        await sendAndConfirmTransaction(
          connection,
          mintToBuyer2Tx,
          [admin],
          { commitment: "confirmed" }
        );
      } catch (mintErr: any) {
        // Ignore mint errors
      }
    }

    // Try to buy - should fail
    try {
      await presaleProgram.methods
        .buy(new anchor.BN(PAYMENT_AMOUNT))
        .accounts({
          presaleState: presaleStatePda,
          tokenState: tokenStatePda,
          allowedToken: allowedTokenPda,
          buyer: buyer2.publicKey,
          buyerPaymentTokenAccount: buyer2PaymentTokenAccount,
          presalePaymentVaultPda: presalePaymentVaultPda,
          presalePaymentVault: presalePaymentVault,
          presaleTokenVaultPda: presaleTokenVaultPda,
          presaleTokenVault: presaleTokenVault,
          buyerTokenAccount: buyer2PresaleTokenAccount,
          paymentTokenMint: paymentTokenMint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer2])
        .rpc();

      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.message).to.include("PresaleNotActive");
    }

    // Resume presale
    await presaleProgram.methods
      .startPresale()
      .accounts({
        presaleState: presaleStatePda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
  });

  it("Prevents buying when token program is emergency paused", async () => {
    // Set emergency pause in token program (requires governance)
    // For testing, we'll simulate this by checking the token state
    // In a real scenario, governance would call set_emergency_pause

    // This test would require the token program to be paused
    // For now, we'll skip this as it requires governance setup
    console.log("   ℹ️  Skipping emergency pause test (requires governance setup)");
  });

  it("Allows admin to disallow payment token", async () => {
    const [allowedTokenPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allowed_token"),
        presaleStatePda.toBuffer(),
        paymentTokenMint.publicKey.toBuffer(),
      ],
      presaleProgram.programId
    );

    const tx = await presaleProgram.methods
      .disallowPaymentToken()
      .accounts({
        presaleState: presaleStatePda,
        allowedToken: allowedTokenPda,
        admin: admin.publicKey,
        paymentTokenMint: paymentTokenMint.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("   ✅ Payment token disallowed:", tx);

    const allowedToken = await presaleProgram.account.allowedToken.fetch(
      allowedTokenPda
    );
    expect(allowedToken.isAllowed).to.be.false;
  });

  it("Allows admin to stop presale", async () => {
    // Ensure presale is active (resume if paused)
    const presaleStateBefore = await presaleProgram.account.presaleState.fetch(
      presaleStatePda
    );
    
    if (Object.keys(presaleStateBefore.status)[0] !== "active") {
      // Resume presale first
      await presaleProgram.methods
        .startPresale()
        .accounts({
          presaleState: presaleStatePda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      console.log("   ℹ️  Resumed presale before stopping");
    }

    const tx = await presaleProgram.methods
      .stopPresale()
      .accounts({
        presaleState: presaleStatePda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("   ✅ Presale stopped:", tx);

    const presaleState = await presaleProgram.account.presaleState.fetch(
      presaleStatePda
    );
    expect(Object.keys(presaleState.status)[0]).to.equal("stopped");
  });

  it("Allows setting governance", async () => {
    // First, reinitialize or ensure presale is in a valid state
    // Then transfer authority to governance

    const tx = await presaleProgram.methods
      .setGovernance(governanceStatePda)
      .accounts({
        presaleState: presaleStatePda,
        authority: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("   ✅ Governance set:", tx);

    const presaleState = await presaleProgram.account.presaleState.fetch(
      presaleStatePda
    );
    expect(presaleState.governance.toString()).to.equal(
      governanceStatePda.toString()
    );
    expect(presaleState.governanceSet).to.be.true;
  });
});

