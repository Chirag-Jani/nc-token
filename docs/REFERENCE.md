# 📖 Reference

## 1. Instruction Map
A high-level summary of available program functions and their roles.

### Token Program (Spl-Project)
*Primary responsibility: Token supply, minting, and transfer policies.*
- `initialize`: Setup state & authority.
- `set_governance`: Transfer control to Governance PDA.
- `mint_tokens` / `burn_tokens`: Reserved for Governance.
- `transfer_tokens`: Main transfer with LP sell-limits.
- `set_blacklist` / `set_whitelist` / `set_restricted`: Access control.

### Governance Program
*Primary responsibility: Multisig coordination and instruction queuing.*
- `initialize`: Setup multisig (signers, approvals, cooldown).
- `queue_*`: Propose an action (blacklist, pause, etc).
- `approve_transaction`: Signer approval (auto-executes on threshold).
- `emergency_pause`: 1-signer bypass for safety.

### Presale Program
*Primary responsibility: Public token distribution and fund collection.*
- `initialize`: Setup price & token programs.
- `buy`: Purchase with SOL (Oracle dynamic pricing).
- `withdraw_to_treasury`: Move proceeds to Multisig treasury.

## 2. Acceptance Checklist
Final verification that the environment and programs are healthy.
- [ ] All programs built with `anchor build`.
- [ ] Program IDs synced via `anchor keys sync`.
- [ ] Initial supply minted & authority transferred to Multisig.
- [ ] Governance threshold tested with at least 2 signers.
- [ ] Presale price validated against Chainlink feed (run `yarn presale:check`).
- [ ] Deployment info files verified in the `deployments/` folder.

