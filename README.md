# SPL Token with Multisig Governance

## Programs

### SPL Token Program

- `initialize` - Setup program state
- `mint_tokens` / `burn_tokens` / `transfer_tokens` - Token operations
- `set_emergency_pause` - Pause all transfers
- `set_blacklist` / `set_whitelist` - Address restrictions
- `set_no_sell_limit` - Exempt address from sell limits
- `set_restricted` - Mark address as restricted
- `set_liquidity_pool` - Register LP address
- `revoke_mint_authority` - Make supply fixed

**Transfer Restrictions:**

- 10% sell limit within 24 hours (to liquidity pools)
- Blacklist/whitelist enforcement
- Emergency pause capability

### Governance Program

- `initialize` - Setup multisig with required approvals & cooldown
- `set_token_program` - Link to token program
- `queue_*` - Queue transactions (blacklist, unpause, sell limits, etc.)
- `approve_transaction` / `reject_transaction` - Multisig voting
- `execute_transaction` - Execute after cooldown
- `grant_role` / `revoke_role` - Role management
- `emergency_pause` - Immediate pause (no cooldown)

## Setup

```bash
yarn install
anchor build
```

## Testing

```bash
# Create test keypair
solana-keygen new -o ~/.config/solana/test-keypair.json --no-bip39-passphrase

# Run tests
anchor test
```

## Deployment

```bash
# Default (NC token, 100B supply)
yarn deploy

# Custom
yarn deploy --name "MyToken" --symbol "MTK" --decimals 9 --totalSupply "1000000000"
```

## Configuration

Edit `Anchor.toml`:

- `cluster` - localnet/devnet/mainnet-beta
- `wallet` - Path to keypair

## Output

`deployment-info.json` contains all deployed addresses.
