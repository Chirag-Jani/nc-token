# Step-by-Step Guide: Fix Presale Mint Issue (WSL/Linux)

## Problem Summary
- Presale was initialized with wrong mint (`7w4qbcAihrQGGfLbyeVpCEY5C8EFQYwZ5m7oZ47g3WoZ`)
- 40M tokens are in wrong vault (derived from main mint)
- Presale expects vault derived from presale mint
- Solution: Redeploy presale with new program ID to get fresh PDAs

---

## Step 1: Generate New Program ID for Presale

**Run in WSL terminal:**

```bash
# Navigate to project directory
cd /mnt/c/Dev/Jani/nc-token

# Remove old keypair (if exists)
rm -f target/deploy/presale-keypair.json

# Generate new keypair
solana-keygen new --outfile target/deploy/presale-keypair.json --force --no-bip39-passphrase

# Get the new program ID
solana-keygen pubkey target/deploy/presale-keypair.json
```

**Save the new program ID** - you'll need it for the next steps!

---

## Step 2: Update Program ID in Code

**Update `programs/presale/src/lib.rs` line 37:**

Replace:
```rust
declare_id!("3gRbrfhqsNnXG7QpbEDPuQBbRr59D733DfhCXVxSWanp");
```

With:
```rust
declare_id!("YOUR_NEW_PROGRAM_ID_HERE");
```

---

## Step 3: Update Anchor.toml

**Update `Anchor.toml` line 10:**

Replace:
```toml
presale = "3gRbrfhqsNnXG7QpbEDPuQBbRr59D733DfhCXVxSWanp"
```

With:
```toml
presale = "YOUR_NEW_PROGRAM_ID_HERE"
```

---

## Step 4: Build Programs

```bash
anchor build
anchor keys sync
```

This will:
- Compile all programs with new presale program ID
- Update any remaining references

---

## Step 5: Deploy Presale Program

```bash
anchor deploy --program-name presale --provider.cluster devnet
```

**Verify deployment:**
```bash
# Check the deployed program ID matches
solana program show $(solana-keygen pubkey target/deploy/presale-keypair.json) --url devnet
```

---

## Step 6: Reinitialize Presale (Now Uses Main Mint)

```bash
yarn deploy:presale
```

This will:
- Use main token mint (from deployment-info.json)
- Create new presale state PDA
- Initialize with correct mint

**Verify:**
```bash
ts-node scripts/check-presale-state.ts
```

**Expected output:**
- Presale Token Mint should match Main Token Mint ✅
- Presale Vault should be derived from main mint ✅

---

## Step 7: Transfer 40M Tokens to Correct Vault

```bash
ts-node scripts/fund-presale-vault.ts 40000000
```

This will transfer 40M tokens from your wallet to the **correct** vault (derived from main mint).

**Verify transfer:**
```bash
ts-node scripts/test-presale.ts
```

---

## Step 8: Link Presale to Governance

```bash
ts-node scripts/set-presale-program.ts
```

---

## Step 9: Start Presale

```bash
ts-node scripts/start-presale.ts
```

---

## Step 10: Test Purchase

```bash
ts-node scripts/buy-presale.ts 0.1
```

---

## Quick Command Summary (Copy-Paste Ready)

```bash
# 1. Generate new program ID
cd /mnt/c/Dev/Jani/nc-token
rm -f target/deploy/presale-keypair.json
solana-keygen new --outfile target/deploy/presale-keypair.json --force --no-bip39-passphrase
NEW_PROGRAM_ID=$(solana-keygen pubkey target/deploy/presale-keypair.json)
echo "New Program ID: $NEW_PROGRAM_ID"

# 2. Update declare_id! in programs/presale/src/lib.rs (line 37)
# Replace: declare_id!("3gRbrfhqsNnXG7QpbEDPuQBbRr59D733DfhCXVxSWanp");
# With: declare_id!("$NEW_PROGRAM_ID");

# 3. Update Anchor.toml (line 10)
# Replace: presale = "3gRbrfhqsNnXG7QpbEDPuQBbRr59D733DfhCXVxSWanp"
# With: presale = "$NEW_PROGRAM_ID"

# 4. Build
anchor build
anchor keys sync

# 5. Deploy
anchor deploy --program-name presale --provider.cluster devnet

# 6. Reinitialize
yarn deploy:presale

# 7. Verify
ts-node scripts/check-presale-state.ts

# 8. Transfer tokens
ts-node scripts/fund-presale-vault.ts 40000000

# 9. Link to governance
ts-node scripts/set-presale-program.ts

# 10. Start presale
ts-node scripts/start-presale.ts

# 11. Test
ts-node scripts/buy-presale.ts 0.1
```

---

## Verification Commands

After each step, verify:

```bash
# Check presale state
ts-node scripts/test-presale.ts

# Check vault balances and mint addresses
ts-node scripts/check-presale-state.ts
```

---

## Important Notes

1. **Old Presale State**: The old presale state account will remain but won't be used
2. **Old Vault Tokens**: The 40M tokens in the old vault are locked (PDA can't sign externally)
3. **New Deployment**: You'll have a fresh presale with correct mint
4. **Token Program**: No changes needed - your 100M tokens remain safe
5. **Wallet Balance**: Make sure you have at least 40M tokens available in your wallet

---

## Troubleshooting

**If `solana-keygen` not found:**
```bash
# Install Solana CLI (if not installed)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

**If build fails:**
- Check `target/deploy/presale-keypair.json` exists
- Verify program ID in `declare_id!` matches keypair
- Run `anchor clean` then `anchor build`

**If deploy fails:**
- Check you have enough SOL: `solana balance --url devnet`
- Airdrop if needed: `solana airdrop 2 $(solana address) --url devnet`

**If reinitialize fails:**
- Check old presale state is not blocking (it shouldn't - new PDA)
- Verify program ID matches in code and Anchor.toml
- Check `deployment-info.json` has correct `mint` field

---

## What Happens to Old Presale?

- **Old Program**: Still deployed but not used
- **Old State**: Remains on-chain but inaccessible
- **Old Vault**: Tokens locked (can't be recovered without program)
- **New Presale**: Fresh start with correct mint ✅
