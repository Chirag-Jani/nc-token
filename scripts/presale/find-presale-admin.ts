import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Presale } from "../../target/types/presale";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const presaleInfo = JSON.parse(
    fs.readFileSync("deployments/presale-deployment-info.json", "utf-8")
  );

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || presaleInfo.network || "https://api.devnet.solana.com",
    "confirmed"
  );

  const programId = new PublicKey(presaleInfo.presaleProgramId);
  const presaleStatePda = new PublicKey(presaleInfo.presaleStatePda);

  const idlPath = ["target/idl/presale.json", path.join(__dirname, "../../target/idl/presale.json")].find((p) => fs.existsSync(p));
  if (!idlPath) throw new Error("IDL not found. Run 'anchor build' first.");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(anchor.web3.Keypair.generate()),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(
    { ...idl, address: programId.toString() },
    provider
  ) as Program<Presale>;

  const state = await program.account.presaleState.fetch(presaleStatePda);

  // start_presale checks: authority == signer OR (governance_set && governance == signer)
  // So the real admin = authority (current holder of presale control)
  const realAdmin = state.authority;

  console.log("admin (original):", state.admin.toString());
  console.log("authority (real admin, can start presale):", realAdmin.toString());
  console.log("governance:", state.governance.toString());
  console.log("governanceSet:", state.governanceSet);
  console.log("");
  console.log("-> Real admin that can start presale:", realAdmin.toString());
}

main().catch(console.error);
