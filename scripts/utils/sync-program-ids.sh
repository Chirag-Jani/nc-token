#!/bin/bash

# Script to automatically sync program IDs from keypairs to source code
# This updates the declare_id!() macros in lib.rs files

echo "🔄 Syncing program IDs from keypairs to source code..."
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Use Anchor's built-in keys sync command
# This automatically updates declare_id!() in source files based on Anchor.toml
anchor keys sync

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Program IDs synced successfully!"
    echo ""
    echo "Updated program IDs:"
    echo "  - governance: $(grep -A 1 '\[programs.localnet\]' Anchor.toml | grep governance | cut -d'"' -f2)"
    echo "  - spl_project: $(grep -A 1 '\[programs.localnet\]' Anchor.toml | grep spl_project | cut -d'"' -f2)"
    echo "  - presale: $(grep -A 1 '\[programs.localnet\]' Anchor.toml | grep presale | cut -d'"' -f2)"
else
    echo ""
    echo "❌ Failed to sync program IDs"
    exit 1
fi

