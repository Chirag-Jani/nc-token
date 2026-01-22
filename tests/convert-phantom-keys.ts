#!/usr/bin/env ts-node

/**
 * Helper script to convert Phantom wallet private keys to test-keys.json format
 * 
 * Usage:
 *   1. Export private keys from Phantom (Settings > Security & Privacy > Export Private Key)
 *   2. Run this script: npx ts-node tests/convert-phantom-keys.ts
 *   3. Follow the prompts to enter each private key
 *   4. The script will update test-keys.json with the converted keys
 */

import * as fs from "fs";
import * as path from "path";
import { Keypair } from "@solana/web3.js";
import * as readline from "readline";
import * as bs58 from "bs58";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function convertPrivateKey(input: string): number[] | null {
  // Try parsing as JSON array first
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed) && parsed.length === 64) {
      return parsed;
    }
  } catch {
    // Not JSON, continue to base58
  }

  // Try base58 decoding
  try {
    const decoded = bs58.decode(input);
    if (decoded.length === 64) {
      return Array.from(decoded);
    } else {
      console.warn(`Base58 key has wrong length (${decoded.length}, expected 64)`);
      return null;
    }
  } catch {
    // Not base58 either
    console.warn("Key format not recognized. Please provide as JSON array [123,45,...] or base58 string.");
    return null;
  }
}

async function main() {
  const keysPath = path.join(__dirname, "test-keys.json");
  let keyConfig: any = {};

  // Load existing config if it exists
  if (fs.existsSync(keysPath)) {
    const fileContent = fs.readFileSync(keysPath, "utf-8");
    keyConfig = JSON.parse(fileContent);
  } else {
    // Initialize with null values
    keyConfig = {
      authority: null,
      signer1: null,
      signer2: null,
      signer3: null,
      user: null,
      recipient: null,
      blacklistedUser: null,
      mint: null,
    };
  }

  console.log("\n=== Phantom Key Converter ===\n");
  console.log("This script will help you convert Phantom private keys to test-keys.json format.\n");
  console.log("To export from Phantom:");
  console.log("  1. Open Phantom wallet");
  console.log("  2. Go to Settings > Security & Privacy");
  console.log("  3. Click 'Export Private Key'");
  console.log("  4. Copy the private key (can be array format or base58 string)\n");
  console.log("Supported formats:");
  console.log("  - JSON array: [123,45,67,...] (64 numbers)");
  console.log("  - Base58 string: 4TPkYWDybiP6n2xXjkG2FN1pc1pxtJEESd9xtYtrrFXxxW93iv8KEA3cgyh5D4RSwYnrThcTJmS9KMeK6DkYrBGu\n");

  const keyNames = [
    "authority",
    "signer1",
    "signer2",
    "signer3",
    "user",
    "recipient",
    "blacklistedUser",
    "mint",
  ];

  for (const keyName of keyNames) {
    const currentValue = keyConfig[keyName];
    if (currentValue && Array.isArray(currentValue)) {
      const skip = await question(
        `\n${keyName} already has a value. Skip? (y/n): `
      );
      if (skip.toLowerCase() === "y") {
        continue;
      }
    }

    console.log(`\nEnter private key for ${keyName}:`);
    console.log("  Format: [123,45,67,...] or base58 string");
    const input = await question("  Key: ");

    if (input.trim() === "" || input.trim().toLowerCase() === "skip") {
      console.log(`  Skipping ${keyName}`);
      continue;
    }

    const converted = convertPrivateKey(input.trim());
    if (converted) {
      keyConfig[keyName] = converted;
      // Verify the keypair works
      try {
        const keypair = Keypair.fromSecretKey(Uint8Array.from(converted));
        console.log(`  ✓ ${keyName} updated (pubkey: ${keypair.publicKey.toString().slice(0, 8)}...)`);
      } catch {
        console.log(`  ✓ ${keyName} updated`);
      }
    } else {
      console.log(`  ✗ Invalid format for ${keyName}. Please provide as JSON array or base58 string.`);
    }
  }

  // Write updated config
  fs.writeFileSync(keysPath, JSON.stringify(keyConfig, null, 2));
  console.log("\n✓ test-keys.json updated!");

  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  rl.close();
  process.exit(1);
});
