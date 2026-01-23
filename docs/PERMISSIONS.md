# 🔐 Permissions & Authority

This document explains who can do what in the NC Token system.

## Overview

The system has three programs with different permission models:

- **Token Program**: Authority-based (can transfer to governance)
- **Governance Program**: Multisig-based (requires multiple approvals)
- **Presale Program**: Admin + Authority-based (admin-only or authority-based)

---

## Token Program Permissions

### Before Authority Transfer

**Authority**: Your wallet (deployer)

**Can do:**

- Mint tokens
- Burn tokens
- Set blacklist/whitelist/restricted
- Pause/unpause token program
- Transfer tokens
- Propose governance change

**Cannot do:**

- Finalize governance transfer (must wait 7 days)

### During Pending Transfer (After `governance:transfer`)

**Authority**: Still your wallet (unchanged)

**What happens:**

- A pending governance proposal is created
- 7-day cooldown period starts
- **Your authority remains unchanged** until you call `finalize`
- You can continue all operations normally

**Important:**

- The proposal does NOT execute automatically after 7 days
- You must manually call `governance:finalize` to complete the transfer
- You cannot cancel the proposal, but you can ignore it (it won't execute unless you finalize)
- If you never call `finalize`, you keep full control indefinitely

### After Authority Transfer

**Authority**: Governance PDA (multisig)

**Can do (via governance):**

- All token operations (mint, burn, blacklist, etc.)
- Requires 2+ signer approvals
- 30-minute cooldown on most actions

**Cannot do:**

- Individual wallet cannot directly control token program
- All changes must go through governance multisig

---

## Governance Program Permissions

**Authority**: Governance State PDA

**Signers**: 4 wallets (configurable, set during initialization)
**Required Approvals**: 2 out of 4 (configurable)

**Important**: Signers cannot be added or removed after initialization. The signer list is immutable once set.

### Permission Levels

**1. Authorized Signer** (any of the 4 signers)

- Can queue transactions
- Can approve transactions
- Can emergency pause (single signer, no approval needed)

**2. Multisig Execution** (2+ approvals required)

- Execute queued transactions after cooldown
- Most actions require this

**3. Emergency Actions** (1 signer)

- Emergency pause only
- Unpause requires full multisig

### Transaction Flow

1. **Queue**: Any signer proposes action
2. **Approve**: Other signers approve (need 2+ total)
3. **Cooldown**: Wait 30 minutes (configurable)
4. **Execute**: Transaction executes automatically

---

## Presale Program Permissions

### Admin Functions (Controlled by Authority)

**Who**: Current authority (initially admin, can be transferred)

**Can do:**

- `start_presale` - Start the presale
- `pause_presale` - Pause the presale
- `stop_presale` - Stop the presale
- `allow_payment_token` - Allow payment tokens
- `disallow_payment_token` - Disallow payment tokens
- `set_token_price_usd` - Update token price
- `update_presale_cap` - Update presale cap
- `update_max_per_user` - Update per-user limit
- `set_treasury_address` - Set treasury address
- `withdraw_sol_to_treasury` - Withdraw SOL
- `withdraw_to_treasury` - Withdraw payment tokens
- `withdraw_unsold_tokens` - Withdraw unsold tokens

**Note**: These functions check `presale_state.authority`, so whoever has authority has full admin control. The `admin` field is just a reference to the original deployer.

### Authority Actions (Admin OR Authority)

**Who**: Current authority (admin wallet or transferred authority wallet)

**Can do:**

- `set_token_price_usd` - Update token price
- `update_presale_cap` - Update presale cap
- `update_max_per_user` - Update per-user limit
- `set_treasury_address` - Set treasury address
- `withdraw_sol_to_treasury` - Withdraw SOL
- `withdraw_to_treasury` - Withdraw payment tokens
- `withdraw_unsold_tokens` - Withdraw unsold tokens
- `set_governance` - Transfer authority to another wallet (or governance PDA)

**Note**:

- Initially `authority = admin` (your wallet)
- Authority can be transferred to:
  - **A single wallet** (via `presale:transfer-authority`) - gives that wallet full solo control
  - **Governance PDA** (via `set_governance`) - gives multisig control
- Transfer is **irreversible** and can only be done once
- The `admin` field remains unchanged (reference only)

---

## Common Scenarios

### Scenario 1: Initial Deployment

**Token Program:**

- Authority: Your wallet
- You have full control

**Presale Program:**

- Admin: Your wallet
- Authority: Your wallet
- You can do everything

**Governance Program:**

- Initialized but not linked
- Signers configured but not active

### Scenario 2: Pending Governance Transfer (After `governance:transfer`, Before `finalize`)

**Token Program:**

- Authority: Still your wallet (unchanged)
- Pending proposal exists but hasn't executed
- You can continue all operations normally
- Proposal will only execute if you call `finalize` after 7 days

**Presale Program:**

- Admin: Your wallet
- Authority: Your wallet (unchanged)
- Full control maintained

**Governance Program:**

- Initialized and ready
- Waiting for authority transfer to complete

### Scenario 3: After Governance Transfer Finalized

**Token Program:**

- Authority: Governance PDA
- Changes require 2+ signer approvals

**Presale Program:**

- Admin: Your wallet (unchanged, reference only)
- Authority: Governance PDA (if transferred)
- Governance controls all presale functions (start/pause/stop, withdrawals, settings)

**Governance Program:**

- Active and linked
- Controls token program
- Controls presale (if authority transferred)

### Scenario 3b: After Presale Authority Transferred to Single Wallet

**Token Program:**

- Authority: Your wallet (unchanged) or Governance PDA (if transferred)

**Presale Program:**

- Admin: Your wallet (unchanged, reference only)
- Authority: New wallet (transferred via `presale:transfer-authority`)
- **New wallet has full solo control:**
  - Start/pause/stop presale
  - Allow/disallow payment tokens
  - Withdraw funds
  - Update price and caps
  - All admin functions
- **You lose all presale control** (irreversible)

**Governance Program:**

- Unchanged (not involved in presale authority transfer)

### Scenario 4: Emergency Situation

**Emergency Pause:**

- Any governance signer can pause token program immediately
- No approvals needed
- Unpause requires full multisig (2+ approvals)

**Presale Pause:**

- Admin can pause presale immediately
- No approvals needed

### Scenario 5: Regular Operations

**Token Operations:**

- Queue action (1 signer)
- Approve action (1+ more signers)
- Wait 30 minutes
- Execute automatically

**Presale Operations:**

- Admin actions: Immediate (start/pause/stop)
- Authority actions: Immediate if admin, or via governance if transferred

---

## Permission Matrix

| Action                  | Token Program        | Presale Program | Governance                       |
| ----------------------- | -------------------- | --------------- | -------------------------------- |
| **Mint Tokens**         | Authority/Governance | -               | Via multisig                     |
| **Burn Tokens**         | Authority/Governance | -               | Via multisig                     |
| **Blacklist**           | Authority/Governance | -               | Via multisig                     |
| **Pause Token**         | Authority/Governance | -               | 1 signer (emergency) or multisig |
| **Start Presale**       | -                    | Admin only      | -                                |
| **Pause Presale**       | -                    | Admin only      | -                                |
| **Stop Presale**        | -                    | Admin only      | -                                |
| **Update Price**        | -                    | Authority       | Admin or Governance              |
| **Withdraw Funds**      | -                    | Authority       | Admin or Governance              |
| **Allow Payment Token** | -                    | Admin only      | -                                |

---

## Key Points

1. **Admin vs Authority in Presale**:

   - The `admin` field is a reference to the original deployer (immutable)
   - The `authority` field controls all presale functions (transferable)
   - All admin functions (start/pause/stop, allow tokens, etc.) check `authority`, not `admin`
   - Transferring authority gives the new wallet full solo control

2. **Presale Authority Transfer**:

   - **To Single Wallet**: `yarn presale:transfer-authority <WALLET_ADDRESS>`
     - Immediate execution (no cooldown)
     - Irreversible (can only be done once)
     - New wallet gets full admin control
     - You lose all presale control
   - **To Governance**: Via `set_governance` instruction
     - Immediate execution
     - Irreversible
     - Governance PDA gets control (requires multisig)

3. **Token Program Governance Transfer**:

   - Two-step process: `governance:transfer` (propose) → wait 7 days → `governance:finalize` (execute)
   - You keep full control until you call `finalize`
   - Proposal does not execute automatically
   - Cannot be cancelled, but can be ignored (won't execute unless finalized)
   - One-way process - cannot be reversed after finalization

4. **Multisig Security**: Requires 2+ approvals for most actions, preventing single-point-of-failure.

5. **Emergency Override**: Single signer can pause immediately, but unpause requires consensus.

6. **Cooldown Periods**:

   - Token governance transfer: 7 days (minimum wait before finalization)
   - Regular governance actions: 30 minutes (configurable)
   - Presale authority transfer: None (immediate)

7. **Signer Management**:
   - Signers are set once during governance initialization
   - Cannot be added or removed after initialization
   - If you need different signers, you must reinitialize (requires closing account)

---

## Transferring Presale Authority

### To a Single Wallet (Solo Control)

```bash
# Transfer presale authority to another wallet
yarn presale:transfer-authority <NEW_WALLET_ADDRESS>
```

**What happens:**

- Authority is immediately transferred to the new wallet
- New wallet gets full admin control (start/pause/stop, allow tokens, withdraw, update settings)
- You lose all presale control
- Transfer is irreversible

**Use case**: When you want to give one person full control without multisig complexity.

### To Governance (Multisig Control)

```bash
# Transfer presale authority to governance PDA
# (Done via program instruction, not CLI script)
```

**What happens:**

- Authority is transferred to governance PDA
- All presale operations require multisig (2+ approvals)
- More secure but slower

**Use case**: When you want decentralized control with multiple signers.

---

## Checking Current Permissions

```bash
# Check token program authority
anchor run get-state

# Check governance signers
yarn governance:check-transfer

# Check presale admin/authority
yarn presale:check
```

<!--  -->

hiragjani@Chirags-Laptop onchain % akl
presale: 7LkwkH3TpyhvCuVBEecFYbYk1T7c66qoYa2UpR9Q8LQj
governance: 38iPVnmu4HXywjU4ivVjBLQUENFGGQXe5erx78niLkbK
spl_project: Bp6PD8dSwGgESvbAZ6mismyDuemZ1cKZ9FC8JmNXZ9uw
chiragjani@Chirags-Laptop onchain % yarn governance:transfer
yarn run v1.22.22
$ ts-node scripts/governance/transfer-authority.ts
🚀 Proposing governance change...
Current Authority: 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
New Authority (Governance): H2GrPMvpqpazFaZpL5AbYWz61ccJuWGSSyGF3JSjexMS
Token State PDA: 78bcciRThYeB1pdHwS9m9uPKJmwXHFdkMWwoV4h65qbb
✅ Governance change proposed: 5oLdN9mC59ucvjrBuxaZMq4bjqi6L1ApBkZEKsm7JjBT418gUP9xPmiebq5Hipp6Y1Y6REwCkwf8zKpknqqSU4s7

⏳ Wait 7 days cooldown period...
💡 After cooldown, call set_governance() to complete transfer

You can check the pending governance with:
anchor run get-state
✨ Done in 4.54s.
chiragjani@Chirags-Laptop onchain % yarn presale:transfer  
yarn run v1.22.22
error Command "presale:transfer" not found.
info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
chiragjani@Chirags-Laptop onchain % yarn presale:transfer-authority
yarn run v1.22.22
$ ts-node scripts/presale/transfer-authority.ts
❌ Error: New authority address required
Usage: yarn presale:transfer-authority <NEW_AUTHORITY_ADDRESS>
Or set: NEW_AUTHORITY=<address> yarn presale:transfer-authority
error Command failed with exit code 1.
info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
chiragjani@Chirags-Laptop onchain % yarn presale:transfer-authority 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz
yarn run v1.22.22
$ ts-node scripts/presale/transfer-authority.ts 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz
🔐 Transferring Presale Authority

============================================================

🔍 Checking current presale state...
✅ Presale state found
Current Authority: 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
Admin (reference): 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
Governance Set: false

📋 Transfer Details:
Current Authority: 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
New Authority: 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz
Presale State PDA: DJ61PndtxEzLgEbuukmKQAGBeHr8vbvF5kkZWLFbNjng

⚠️ WARNING: This transfer is IRREVERSIBLE!
After transfer, the new authority will have full control:

- Start/pause/stop presale
- Allow/disallow payment tokens
- Withdraw funds
- Update price and caps

You will lose all presale control.

🚀 Transferring authority...
✅ Authority transferred successfully!
Transaction: 33DRpaqPhfmkraHbRxVrH5t2WiGvea4K9VhHiZwpdqUhPjAN9Zma77sb1T3Jq4vT4WfbxaJhUsTQt2zQRvTpTyH

📋 Updated Presale State:
Authority: 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz
Governance: 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz
Governance Set: true
Admin (reference): 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj

✅ SUCCESS! Presale authority has been transferred.
The wallet 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz now has full control.
✨ Done in 3.88s
