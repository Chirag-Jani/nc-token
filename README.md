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
# Default (NC token, 100M supply cap)
yarn deploy

# Custom
yarn deploy --name "MyToken" --symbol "MTK" --decimals 9 --totalSupply "100000000"
```

**Note:** The max supply cap is automatically set to 100 million tokens during initialization. This prevents infinite minting and enforces a hard cap on token supply.

## Available Scripts

### Deployment Scripts

| Command | Description |
|---------|-------------|
| `yarn deploy` | Main token deployment |
| `yarn deploy:all` | Deploy all programs (token, governance, presale) |
| `yarn deploy:presale` | Deploy presale program only |
| `yarn deploy:governance` | Deploy governance program only |

### Presale Scripts

| Command | Description |
|---------|-------------|
| `yarn presale:start` | Start the presale |
| `yarn presale:check` | Check current presale state |
| `yarn presale:buy` | Execute a presale purchase |

### Governance Scripts

| Command | Description |
|---------|-------------|
| `yarn governance:init` | Initialize governance with multisig |
| `yarn governance:transfer` | Transfer authority to governance |

### Utility Scripts

| Command | Description |
|---------|-------------|
| `yarn lint` | Check code formatting |
| `yarn lint:fix` | Fix code formatting |
| `yarn test:presale` | Run presale tests |
| `yarn utils:recover-tokens` | Recover tokens from wrong vault |
| `yarn utils:revoke-authorities` | Revoke mint/freeze authorities |
| `yarn utils:sync-ids` | Sync program IDs to files |

## Project Structure

```
nc-token/
├── programs/           # Solana programs (Rust)
│   ├── spl-project/    # Token program
│   ├── governance/     # Multisig governance
│   └── presale/        # Presale program
├── scripts/            # TypeScript scripts
│   ├── deploy/         # Deployment scripts
│   ├── presale/        # Presale operations
│   ├── governance/     # Governance operations
│   └── utils/          # Utility scripts
├── tests/              # Anchor tests
├── docs/               # Streamlined documentation
│   ├── QUICKSTART.md   # Setup & build
│   ├── OPERATIONS.md   # Deployment & scripts
│   ├── ARCHITECTURE.md # Business logic
│   └── REFERENCE.md    # Instruction list
├── reports/            # Project reports
└── deployments/        # Deployment info (JSON)
```

## Configuration

Edit `Anchor.toml`:

- `cluster` - localnet/devnet/mainnet-beta
- `wallet` - Path to keypair

## Output

`deployments/deployment-info.json` contains all deployed addresses.

## Documentation

The documentation has been streamlined for clarity and quick reference:

- [🚀 Quickstart Guide](docs/QUICKSTART.md) - Setup, build, and deploy in minutes.
- [🛠 Operations Guide](docs/OPERATIONS.md) - Production workflow, maintenance, and safety.
- [🏗 Architecture & Security](docs/ARCHITECTURE.md) - Deep dive into governance, treasury, and oracle logic.
- [📖 Reference](docs/REFERENCE.md) - Instruction map and project checklists.

Historical documentation can be found in `docs/archive/`.

