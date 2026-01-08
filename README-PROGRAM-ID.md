# How to Update Program IDs Automatically

Anchor provides a built-in command to automatically sync program IDs from your keypair files to the `declare_id!()` macros in your source code.

## Quick Method

Run this command from the project root:

```bash
anchor keys sync
```

This will:
1. Read the program IDs from `target/deploy/*-keypair.json` files
2. Update the `declare_id!()` macros in your `lib.rs` files
3. Update `Anchor.toml` with the correct program IDs

## Step-by-Step Setup

### 1. Generate Keypair (if not exists)

If you don't have a keypair for the presale program yet:

```bash
solana-keygen new --outfile target/deploy/presale-keypair.json --no-bip39-passphrase
```

### 2. Add to Anchor.toml

The presale program should already be in `Anchor.toml`:

```toml
[programs.localnet]
governance = "H9NZEYkoG3jzfKQMZXYbNYgG47dYmaieEqtYbcA8wvgE"
spl_project = "Aa5wVELo2qAmVKQMJfMvtHYBrRvH9gyn2gyv9hqzyRKc"
presale = "55bnh7iZ6Xbt4JKMYG1mzpsuUPGee3CuJPea2Q819tyY"
```

### 3. Sync Program IDs

Run the sync command:

```bash
# On Linux/Mac
./scripts/sync-program-ids.sh

# On Windows (PowerShell)
.\scripts\sync-program-ids.ps1

# Or directly
anchor keys sync
```

## How It Works

1. **Anchor reads keypair files**: Looks in `target/deploy/` for `*-keypair.json` files
2. **Extracts public keys**: Gets the program ID (public key) from each keypair
3. **Updates source code**: Finds `declare_id!()` in each program's `lib.rs` and updates it
4. **Updates Anchor.toml**: Ensures the program IDs match in the config file

## Manual Update (Alternative)

If you prefer to update manually:

1. Get the program ID from the keypair:
   ```bash
   solana-keygen pubkey target/deploy/presale-keypair.json
   ```

2. Update `programs/presale/src/lib.rs`:
   ```rust
   declare_id!("YOUR_PROGRAM_ID_HERE");
   ```

3. Update `Anchor.toml`:
   ```toml
   [programs.localnet]
   presale = "YOUR_PROGRAM_ID_HERE"
   ```

## Important Notes

- **Always commit keypair files**: The keypair files in `target/deploy/` should be committed to version control (they're public keys, not private keys)
- **Keep IDs in sync**: After generating a new keypair, always run `anchor keys sync`
- **Different clusters**: You can have different program IDs for different clusters (localnet, devnet, mainnet) in `Anchor.toml`

## Troubleshooting

### Error: "Program ID mismatch"

If you get a program ID mismatch error:
1. Run `anchor keys sync` to update all IDs
2. Rebuild: `anchor build`

### Error: "Keypair not found"

Make sure the keypair file exists:
```bash
ls target/deploy/presale-keypair.json
```

If it doesn't exist, generate it:
```bash
solana-keygen new --outfile target/deploy/presale-keypair.json --no-bip39-passphrase
```

### Error: "anchor: command not found"

Install Anchor CLI:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

