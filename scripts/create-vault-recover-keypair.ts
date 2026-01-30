/**
 * Creates vault_recover-keypair.json from your private key.
 *
 * Usage:
 *   npx ts-node scripts/create-vault-recover-keypair.ts "<your-private-key>"
 *   npx ts-node scripts/create-vault-recover-keypair.ts "<private-key>" --force
 *
 * You need the PROGRAM's private key (the one whose pubkey is 7LkwkH3...),
 * NOT the deployer wallet that paid for deployment.
 *
 * Private key formats supported:
 *   - Base58 string (e.g. from Phantom export or solana-keygen export)
 *   - JSON array: [1,2,3,...,64]
 *   - Comma-separated: 1,2,3,...,64
 *
 * Output: target/deploy/vault_recover-keypair.json
 * Verify: solana-keygen pubkey target/deploy/vault_recover-keypair.json
 *         Should show: 7LkwkH3TpyhvCuVBEecFYbYk1T7c66qoYa2UpR9Q8LQj
 */

import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const EXPECTED_PUBKEY = "7LkwkH3TpyhvCuVBEecFYbYk1T7c66qoYa2UpR9Q8LQj";

function main() {
  const args = process.argv.slice(2);
  const forceFlag = args.includes("--force");
  const input = args.find((a) => !a.startsWith("--"));

  if (!input) {
    console.error("Usage: npx ts-node scripts/create-vault-recover-keypair.ts \"<private-key>\" [--force]");
    console.error("");
    console.error("You need the PROGRAM's private key (pubkey 7LkwkH3...), not the deployer wallet.");
    console.error("");
    console.error("Private key can be:");
    console.error("  - Base58 string (from Phantom or solana-keygen pubkey <path>)");
    console.error("  - JSON array: [1,2,3,...,64]");
    console.error("  - Comma-separated numbers: 1,2,3,...,64");
    console.error("");
    console.error("Use --force to create the keypair even if pubkey doesn't match 7LkwkH3...");
    process.exit(1);
  }

  let secretKey: Uint8Array;

  try {
    const trimmed = input.trim();

    // Format 1: JSON array [1,2,3,...,64]
    if (trimmed.startsWith("[")) {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr) || arr.length !== 64) {
        throw new Error("JSON array must have exactly 64 numbers");
      }
      secretKey = new Uint8Array(arr);
    }
    // Format 2: Comma-separated numbers
    else if (/^\d+(,\d+)*$/.test(trimmed)) {
      const arr = trimmed.split(",").map((n) => parseInt(n.trim(), 10));
      if (arr.length !== 64) {
        throw new Error("Must have exactly 64 comma-separated numbers");
      }
      secretKey = new Uint8Array(arr);
    }
    // Format 3: Base58 string
    else {
      const bs58 = require("bs58");
      const decoded = bs58.decode(trimmed);
      if (decoded.length !== 64) {
        throw new Error(`Base58 decoded to ${decoded.length} bytes, expected 64`);
      }
      secretKey = new Uint8Array(decoded);
    }

    const keypair = Keypair.fromSecretKey(secretKey);
    const pubkey = keypair.publicKey.toString();

    if (pubkey !== EXPECTED_PUBKEY && !forceFlag) {
      console.error(`⚠️  This keypair's pubkey is ${pubkey}`);
      console.error(`   Expected for Presale B program: ${EXPECTED_PUBKEY}`);
      console.error("");
      console.error("   You need the PROGRAM's private key (whose pubkey is 7LkwkH3...),");
      console.error("   not the deployer wallet. Use --force to create anyway.");
      process.exit(1);
    }

    if (pubkey !== EXPECTED_PUBKEY && forceFlag) {
      console.warn(`⚠️  Pubkey ${pubkey} != ${EXPECTED_PUBKEY}. Created anyway (--force).`);
    }

    const keypairJson = Array.from(secretKey);
    const outDir = path.join(__dirname, "..", "target", "deploy");
    const outPath = path.join(outDir, "vault_recover-keypair.json");

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outPath, JSON.stringify(keypairJson), "utf-8");
    console.log("✅ Created:", outPath);
    console.log("   Pubkey:", pubkey);
    console.log("");
    console.log("Next steps:");
    console.log("  1. anchor build -p vault_recover");
    console.log("  2. anchor deploy -p vault_recover --program-keypair target/deploy/vault_recover-keypair.json");
    console.log("  3. yarn recover:closed-vault 1000000000");
  } catch (err: any) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
