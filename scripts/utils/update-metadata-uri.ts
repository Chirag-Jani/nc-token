import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Parse command-line arguments
function parseArgs() {
  const args: { [key: string]: string } = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--?/, "");
    const value = process.argv[i + 1];
    if (key && value) {
      args[key] = value;
    }
  }
  return args;
}

const cliArgs = parseArgs();

// Configuration - can be overridden by environment variables or command-line arguments
const MINT_ADDRESS =
  cliArgs.mint ||
  process.env.MINT_ADDRESS ||
  (() => {
    try {
      const deploymentInfo = JSON.parse(
        fs.readFileSync("deployments/deployment-info.json", "utf-8")
      );
      return deploymentInfo.mintAddress || deploymentInfo.mint;
    } catch {
      return null;
    }
  })();

const METADATA_URI =
  cliArgs.uri ||
  cliArgs.metadataUri ||
  process.env.METADATA_URI ||
  "";

if (!MINT_ADDRESS) {
  throw new Error(
    "MINT_ADDRESS not provided. Set via --mint, MINT_ADDRESS env var, or deployment-info.json"
  );
}

if (!METADATA_URI) {
  throw new Error(
    "METADATA_URI not provided. Set via --uri/--metadataUri or METADATA_URI env var"
  );
}

async function main() {
  console.log("🔄 Updating token metadata URI...\n");

  // Setup connection
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );

  // Load wallet
  const defaultWallet =
    process.env.ANCHOR_WALLET ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "solana",
      "id.json"
    );
  const walletPath = defaultWallet.replace(
    "~",
    process.env.HOME || process.env.USERPROFILE || ""
  );

  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Wallet not found at ${walletPath}. Please set ANCHOR_WALLET environment variable or ensure id.json exists.`
    );
  }

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const mintPubkey = new PublicKey(MINT_ADDRESS);

  console.log("📝 Wallet:", walletKeypair.publicKey.toString());
  console.log("🌐 Network:", connection.rpcEndpoint);
  console.log("🪙 Mint:", mintPubkey.toString());
  console.log("🔗 Metadata URI:", METADATA_URI);
  console.log("");

  // Derive metadata PDA
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mintPubkey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  console.log("📍 Metadata PDA:", metadataPda.toString());
  console.log("");

  // Check if metadata account exists
  const metadataInfo = await connection.getAccountInfo(metadataPda);
  if (!metadataInfo) {
    throw new Error(
      `Metadata account not found at ${metadataPda.toString()}. Make sure the token has been deployed with metadata.`
    );
  }

  // Get existing metadata name and symbol from environment or use defaults
  const TOKEN_NAME = process.env.TOKEN_NAME || "NC Token";
  const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "NC";

  // Helper to serialize string with u32 length prefix (Borsh format)
  const serializeString = (str: string): Buffer => {
    const strBytes = Buffer.from(str, "utf8");
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(strBytes.length, 0);
    return Buffer.concat([len, strBytes]);
  };

  // UpdateMetadataAccountV2 instruction discriminator
  // From Metaplex package: discriminator = 15 (u8)
  const discriminator = Buffer.from([15]);

  // Serialize DataV2 struct (Borsh format)
  const nameBytes = serializeString(TOKEN_NAME);
  const symbolBytes = serializeString(TOKEN_SYMBOL);
  const uriBytes = serializeString(METADATA_URI);

  // DataV2 struct: name, symbol, uri, seller_fee_basis_points, creators, collection, uses
  const dataV2Parts: Buffer[] = [
    nameBytes, // name: String
    symbolBytes, // symbol: String
    uriBytes, // uri: String
    Buffer.from([0, 0]), // seller_fee_basis_points: u16 (little-endian)
    Buffer.from([0]), // creators: Option<Vec<Creator>> - None
    Buffer.from([0]), // collection: Option<Collection> - None
    Buffer.from([0]), // uses: Option<Uses> - None
  ];
  const dataV2 = Buffer.concat(dataV2Parts);

  // UpdateMetadataAccountV2 args structure (Borsh serialized):
  // struct UpdateMetadataAccountArgsV2 {
  //   data: Option<DataV2>,           // Some = [1] + DataV2, None = [0]
  //   update_authority: Option<Pubkey>, // Some(Some) = [1, 1] + 32 bytes, Some(None) = [1, 0], None = [0]
  //   primary_sale_happened: Option<bool>, // Some = [1] + bool, None = [0]
  //   is_mutable: Option<bool>,       // Some = [1] + bool, None = [0]
  // }
  const args = Buffer.concat([
    Buffer.from([1]), // data: Some(DataV2) = 1
    dataV2, // DataV2 struct
    Buffer.from([0]), // update_authority: None (keep existing) = 0
    Buffer.from([0]), // primary_sale_happened: None (keep existing) = 0
    Buffer.from([0]), // is_mutable: None (keep existing) = 0
  ]);

  // Full instruction: discriminator + args
  const instructionData = Buffer.concat([discriminator, args]);

  // UpdateMetadataAccountV2 account order (from Metaplex source):
  // 0. metadata (writable, signer)
  // 1. update_authority (signer)
  const updateMetadataInstruction = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: false },
    ],
    data: instructionData,
  });

  try {
    console.log("📤 Sending update transaction...");
    const transaction = new Transaction().add(updateMetadataInstruction);
    
    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletKeypair.publicKey;
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [walletKeypair],
      { commitment: "confirmed" }
    );

    console.log("   ✅ Metadata URI updated successfully!");
    console.log("   📝 Transaction:", signature);
    console.log("   🔗 New URI:", METADATA_URI);
    console.log("");

    // Verify the update
    console.log("🔍 Verifying update...");
    const updatedMetadataInfo = await connection.getAccountInfo(metadataPda);
    if (updatedMetadataInfo) {
      console.log("   ✅ Metadata account confirmed");
      console.log("   💡 You can verify with: spl-token display", MINT_ADDRESS);
    }
  } catch (error: any) {
    console.error("   ❌ Metadata update failed:", error.message);
    if (error.logs) {
      console.error("   Logs:", error.logs.join("\n"));
    }
    if (error.message.includes("UpdateAuthorityInvalid")) {
      console.error(
        "   ⚠️  The wallet is not the update authority for this metadata."
      );
      console.error(
        "   💡 Check who the current update authority is and use that wallet."
      );
    }
    throw error;
  }

  console.log("\n✨ Done!");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
