# 🛠 Operations Guide

## 1. Deployment Workflow (Production)
The order of operations is critical. Each step depends on the previous one's state file (`deployments/*.json`).

1. **Build & ID Sync**: `anchor build` -> `anchor keys sync`. Essential to ensure on-chain IDs match local binaries.
2. **Token Launch**: Core of the project. Must be initialized before the Presale can use the mint address.
3. **Governance Launch**: Deploys the multisig. Initial signers cannot be changed easily after this.
4. **Presale Launch**: Configures the sale parameters (Price, Vaults).
5. **Linking**: 
   - `yarn governance:link-token`: Tells Governance which program to control.
   - `yarn governance:link-presale`: Connects Governance to the sale for treasury management.
6. **Authority Handover**: `yarn governance:transfer`. Once executed, only the Multisig can mint or change settings.

## 2. Maintenance & Safety
Routine and emergency tools for program management.
- **Revoke Authorities**: `yarn utils:revoke-authorities`. Removes the "update authority," making the token immutable and trustworthy for the community.
- **Oracle Validation**: The presale relies on the Chainlink SOL/USD bridge. If the feed is stale (>1 hr), buys will fail to protect the treasury.
- **Recovery**: `yarn utils:recover-tokens`. Used if tokens are accidentally sent to the wrong vault or if a manual sweep is required.

## 3. Essential Checklist
Final verification before going live on Mainnet.
- [ ] Wallet contains >5 SOL (Account rent for 3 programs + metadata).
- [ ] `Anchor.toml` cluster is set to `mainnet-beta`.
- [ ] Program IDs in `lib.rs` are verified against `target/deploy/*.json`.
- [ ] Governance threshold is set (2-of-3 is the recommended security standard).
- [ ] Treasury address is pointing to an external secure Multisig or Cold Wallet.

