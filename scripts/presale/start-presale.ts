import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../../target/types/presale";
import { PublicKey } from "@solana/web3.js";
import * as path from "path";
import * as fs from "fs";

async function main() {
  // Load deployment info first
  let presaleInfo: any;
  try {
    presaleInfo = JSON.parse(
      fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
    );
  } catch (error) {
    throw new Error("❌ presale-deployment-info.json not found. Run 'yarn deploy:presale' first.");
  }

  // Validate required fields
  if (!presaleInfo.presaleProgramId) {
    throw new Error("❌ presaleProgramId not found in deployment info.");
  }
  if (!presaleInfo.presaleStatePda) {
    throw new Error("❌ presaleStatePda not found in deployment info.");
  }

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || presaleInfo.network || "https://api.devnet.solana.com",
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

  // Load program - try workspace first, fallback to IDL
  let program: Program<Presale>;
  let expectedProgramId: PublicKey;
  try {
    expectedProgramId = new PublicKey(String(presaleInfo.presaleProgramId).trim());
  } catch (error: any) {
    throw new Error(`❌ Invalid presaleProgramId in deployment info: "${presaleInfo.presaleProgramId}". Error: ${error.message}`);
  }
  
  try {
    if (!anchor.workspace || !anchor.workspace.Presale) {
      throw new Error("Workspace not available");
    }
    const workspaceProgram = anchor.workspace.Presale as Program<Presale>;
    // Verify program ID matches
    if (workspaceProgram && workspaceProgram.programId.toString() === expectedProgramId.toString()) {
      program = workspaceProgram;
      console.log("   📦 Loaded program from workspace");
    } else {
      throw new Error("Program ID mismatch or program not found in workspace");
    }
  } catch (error) {
    console.log("   ⚠️  Workspace program not available, loading from IDL...");
    // Fallback: load from IDL file
    // Try multiple possible paths
    const possiblePaths = [
      path.join(__dirname, "..", "..", "target", "idl", "presale.json"),
      path.join(process.cwd(), "target", "idl", "presale.json"),
      "target/idl/presale.json"
    ];
    
    let idlPath: string | null = null;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        idlPath = possiblePath;
        break;
      }
    }
    
    if (!idlPath) {
      throw new Error(`❌ Error: IDL not found. Tried: ${possiblePaths.join(", ")}. Run 'anchor build' first.`);
    }
    
    const idlJson = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    // Use type assertion to bypass TypeScript error (runtime should work)
    program = new (anchor.Program as any)(idlJson, expectedProgramId, provider) as Program<Presale>;
    console.log("   📦 Loaded program from IDL file:", idlPath);
  }
  
  // Use presale state PDA from deployment info
  let presaleStatePda: PublicKey;
  try {
    const pdaString = String(presaleInfo.presaleStatePda).trim();
    if (!pdaString || pdaString.length === 0) {
      throw new Error("presaleStatePda is empty");
    }
    presaleStatePda = new PublicKey(pdaString);
  } catch (error: any) {
    throw new Error(`❌ Invalid presaleStatePda in deployment info: "${presaleInfo.presaleStatePda}". Error: ${error.message}`);
  }

  console.log("🚀 Starting presale...");
  console.log("   Presale Program ID:", program.programId.toString());
  console.log("   Presale State PDA:", presaleStatePda.toString());
  console.log("   Admin:", walletKeypair.publicKey.toString());

  // Verify the presale state exists
  try {
    const state = await program.account.presaleState.fetch(presaleStatePda);
    console.log("   ✅ Presale state found");
    console.log("   Current Status:", Object.keys(state.status)[0]);
  } catch (error: any) {
    throw new Error(`❌ Presale state not found at ${presaleStatePda.toString()}. Make sure presale is initialized.`);
  }

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
  console.log("   Status:", Object.keys(state.status)[0]);
  console.log("   Total Tokens Sold:", state.totalTokensSold.toString());
  console.log("   Total Raised:", state.totalRaised.toString());
}

main().catch(console.error);

