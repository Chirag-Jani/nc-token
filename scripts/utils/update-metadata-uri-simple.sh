#!/bin/bash
# Simple script to update metadata URI using Metaplex CLI
# First, install Metaplex CLI: npm install -g @metaplex-foundation/metaplex-cli

MINT_ADDRESS="${MINT_ADDRESS:-$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('deployments/deployment-info.json')); console.log(d.mintAddress || d.mint)")}"
METADATA_URI="${METADATA_URI:-}"

if [ -z "$MINT_ADDRESS" ]; then
  echo "Error: MINT_ADDRESS not set"
  exit 1
fi

if [ -z "$METADATA_URI" ]; then
  echo "Error: METADATA_URI not set"
  exit 1
fi

echo "Updating metadata URI for mint: $MINT_ADDRESS"
echo "New URI: $METADATA_URI"

# Note: This requires Metaplex CLI to be installed
# For now, use a web-based tool or the TypeScript script
echo ""
echo "To update metadata URI, you can:"
echo "1. Use SolanaFM: https://solana.fm/"
echo "2. Use Shyft API: https://www.shyft.to/"
echo "3. Use Metaplex JS SDK v2"
