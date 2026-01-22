import { Keypair } from "@solana/web3.js";
import * as bs58 from "bs58";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

// Helper for deterministic keys (fallback)
function getFixedKeypair(seedString: string): Keypair {
  const seed = createHash('sha256').update(seedString).digest();
  return Keypair.fromSeed(seed);
}

// Load keys from config file or use deterministic fallback
export function loadTestKeys() {
  const keysPath = path.join(__dirname, 'test-keys.json');
  let keyConfig: any = {};
  
  try {
    if (fs.existsSync(keysPath)) {
      const fileContent = fs.readFileSync(keysPath, 'utf-8');
      keyConfig = JSON.parse(fileContent);
    }
  } catch (err) {
    // Silently fall back to deterministic keys
  }

  // Helper to create keypair from config or fallback
  function getKeypair(keyName: string, seedString: string): Keypair {
    const keyData = keyConfig[keyName];
    
    if (keyData && Array.isArray(keyData)) {
      // Private key provided as array
      if (keyData.length === 64) {
        try {
          const secretKey = Uint8Array.from(keyData);
          const keypair = Keypair.fromSecretKey(secretKey);
          return keypair;
        } catch (err) {
          console.warn(`⚠ Invalid key format for ${keyName}, using deterministic fallback`);
          return getFixedKeypair(seedString);
        }
      } else {
        console.warn(`⚠ Key ${keyName} has wrong length (${keyData.length}, expected 64), using deterministic fallback`);
        return getFixedKeypair(seedString);
      }
    } else if (keyData && typeof keyData === 'string') {
      // Try to parse as JSON string first
      try {
        const parsed = JSON.parse(keyData);
        if (Array.isArray(parsed) && parsed.length === 64) {
          const secretKey = Uint8Array.from(parsed);
          const keypair = Keypair.fromSecretKey(secretKey);
          return keypair;
        }
      } catch {
        // Not JSON, try base58 decoding
        try {
          const decoded = bs58.decode(keyData);
          if (decoded.length === 64) {
            const keypair = Keypair.fromSecretKey(decoded);
            return keypair;
          } else {
            console.warn(`⚠ Key ${keyName} decoded from base58 has wrong length (${decoded.length}, expected 64), using deterministic fallback`);
            return getFixedKeypair(seedString);
          }
        } catch (base58Err) {
          // Not base58 either, use fallback
          console.warn(`⚠ Key ${keyName} is a string but not JSON array or base58 format. Using deterministic fallback.`);
          return getFixedKeypair(seedString);
        }
      }
    } else if (keyData !== null && keyData !== undefined) {
      console.warn(`⚠ Key ${keyName} has unexpected type, using deterministic fallback`);
      return getFixedKeypair(seedString);
    }
    
    // No key provided, use deterministic fallback
    return getFixedKeypair(seedString);
  }

  return {
    authority: getKeypair('authority', 'admin-authority-seed'),
    signer1: getKeypair('signer1', 'signer-one-seed'),
    signer2: getKeypair('signer2', 'signer-two-seed'),
    signer3: getKeypair('signer3', 'signer-three-seed'),
    user: getKeypair('user', 'test-user-seed'),
    recipient: getKeypair('recipient', 'test-recipient-seed'),
    blacklistedUser: getKeypair('blacklistedUser', 'test-blacklisted-user-seed'),
    mint: getKeypair('mint', 'main-mint-seed'),
  };
}

// Helper to convert Phantom private key format to array
// Phantom exports private keys as base58 strings or arrays
export function convertPhantomKey(phantomKey: string | number[]): number[] {
  if (Array.isArray(phantomKey)) {
    return phantomKey;
  }
  
  // If it's a string, try to parse it
  // Phantom typically exports as base58, but we'll handle both
  if (typeof phantomKey === 'string') {
    try {
      // Try parsing as JSON array string
      const parsed = JSON.parse(phantomKey);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Not JSON, try base58 decoding
      try {
        const decoded = bs58.decode(phantomKey);
        return Array.from(decoded);
      } catch (base58Err) {
        console.warn('String key format not supported. Please provide as JSON array or base58 string.');
        return [];
      }
    }
  }
  
  return [];
}
