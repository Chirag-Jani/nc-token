# Complete Function Reference - NC Token Project

## Overview

This document provides a comprehensive list of all functions across all programs in the NC Token project, with one-line descriptions of what each function does.

**Last Updated:** [Date]  
**Total Functions:** 42 (40 active, 2 deprecated)

---

## 1. Token Contract (`programs/spl-project/src/lib.rs`)

**Program ID:** `HSW8GX2DxvZE3ekSnviVN7LPw2rsHp6EJy4oGDaSYCAz`  
**Total Functions:** 14

### Core Functions

- **`initialize()`** - Initializes token program state with default values and sets initial authority
- **`set_governance(new_authority)`** - Transfers authority from current owner to governance PDA (one-time operation)
- **`set_emergency_pause(value)`** - Sets emergency pause state (only governance can call)
- **`mint_tokens(amount)`** - Mints tokens to specified account (only governance can call)
- **`burn_tokens(amount)`** - Burns tokens from specified account (only governance can call)
- **`transfer_tokens(amount)`** - Transfers tokens with emergency pause check and sell limit tracking
- **`revoke_mint_authority()`** - Permanently revokes mint authority to make supply fixed

### Access Control Functions

- **`set_blacklist(account, value)`** - Sets blacklist status for an address (governance only)
- **`set_whitelist(account, value)`** - Sets whitelist status for an address (governance only)
- **`set_restricted(account, value)`** - Sets restricted status for an address (governance only)
- **`set_no_sell_limit(account, value)`** - Grants/revokes sell limit exemption for an address (governance only)
- **`set_liquidity_pool(pool, value)`** - Registers/unregisters a liquidity pool address (governance only)

### Bridge/NFT Functions

- **`set_bridge_address(bridge_address)`** - Sets bridge contract address in token state (governance only)
- **`set_bond_address(bond_address)`** - Sets bond contract address in token state (governance only)

---

## 2. Governance Contract (`programs/governance/src/lib.rs`)

**Program ID:** `5jsHpno8jwFTJCzTtqPWFLT96sQqFxiLTD2a8zvmiunj`  
**Total Functions:** 19 (17 active, 2 deprecated)

### Initialization & Setup

- **`initialize(required_approvals, cooldown_period, signers)`** - Initializes governance with multisig config, signer list, and minimum 2 approvals
- **`set_token_program(token_program)`** - Links governance to token program address (one-time, authority only)

### Transaction Queuing Functions

- **`queue_unpause()`** - Queues transaction to unpause token (requires multisig approval + cooldown)
- **`queue_set_blacklist(account, value)`** - Queues transaction to blacklist/unblacklist an address (requires multisig)
- **`queue_set_no_sell_limit(account, value)`** - Queues transaction to grant/revoke sell limit exemption (requires multisig)
- **`queue_set_restricted(account, value)`** - Queues transaction to set restricted status (requires multisig)
- **`queue_set_liquidity_pool(pool, value)`** - Queues transaction to register/unregister liquidity pool (requires multisig)
- **`queue_set_bridge_address(bridge_address)`** - Queues transaction to set bridge address (requires multisig)
- **`queue_set_bond_address(bond_address)`** - Queues transaction to set bond address (requires multisig)
- **`queue_set_required_approvals(required)`** - Queues transaction to change required approvals (requires multisig, min 2)
- **`queue_set_cooldown_period(period)`** - Queues transaction to change cooldown period (requires multisig, min 30 min)

### Transaction Management Functions

- **`approve_transaction(tx_id)`** - Approves a queued transaction (only authorized signers, auto-executes if conditions met)
- **`reject_transaction(tx_id, reason)`** - Rejects a queued transaction with reason
- **`execute_transaction(tx_id)`** - Executes approved transaction after cooldown expires (performs CPI calls to token contract)

### Emergency Functions

- **`emergency_pause()`** - Immediately pauses token contract (1 signer allowed, no cooldown, bypasses multisig)

### Role Management Functions

- **`grant_role(role, account)`** - Grants a role to an account (authority only)
- **`revoke_role(role, account)`** - Revokes a role from an account (authority only)

### Deprecated Functions (Should Not Be Used)

- **`set_required_approvals(required)`** - Directly sets required approvals (deprecated, use queue instead)
- **`set_cooldown_period(period)`** - Directly sets cooldown period (deprecated, use queue instead)

---

## 3. Presale Contract (`programs/presale/src/lib.rs`)

**Program ID:** `3gRbrfhqsNnXG7QpbEDPuQBbRr59D733DfhCXVxSWanp`  
**Total Functions:** 9

### Initialization & Setup

- **`initialize(admin, presale_token_mint, token_program, token_program_state)`** - Initializes presale contract with admin, token mint, and program references
- **`set_governance(new_authority)`** - Transfers authority to governance PDA (one-time operation)
- **`set_token_program(token_program, token_program_state)`** - Updates token program references (admin or governance)

### Presale Management Functions

- **`start_presale()`** - Changes presale status to Active (admin/governance only)
- **`stop_presale()`** - Changes presale status to Stopped (admin/governance only)
- **`pause_presale()`** - Changes presale status to Paused (admin/governance only)
- **`allow_payment_token(payment_token_mint)`** - Allows a payment token (USDC, USDT, etc.) for purchases (admin/governance)
- **`disallow_payment_token()`** - Disallows a payment token from being used (admin/governance)

### Purchase Function

- **`buy(amount)`** - Allows users to buy presale tokens with allowed payment tokens (checks presale active, emergency pause, payment token allowed, transfers tokens)

---

## Summary Statistics

| Program | Total Functions | Public Functions | Deprecated |
|---------|----------------|------------------|------------|
| Token Contract | 14 | 14 | 0 |
| Governance Contract | 19 | 17 | 2 |
| Presale Contract | 9 | 9 | 0 |
| **TOTAL** | **42** | **40** | **2** |

---

## Function Categories

### By Access Control

- **Governance Only:** 12 functions (token contract setters + mint/burn)
- **Multisig Required:** 9 functions (all queue functions)
- **Admin/Governance:** 6 functions (presale management)
- **Public:** 1 function (buy)
- **Emergency (1 signer):** 1 function (emergency_pause)
- **Authority Only:** 3 functions (governance setup + roles)

### By Functionality

- **Initialization:** 3 functions
- **Authority Transfer:** 2 functions
- **Token Operations:** 3 functions (mint, burn, transfer)
- **Access Control:** 5 functions (blacklist, whitelist, restricted, sell limit, pool)
- **Bridge/NFT:** 2 functions
- **Governance Queue:** 9 functions
- **Transaction Management:** 3 functions
- **Emergency:** 1 function
- **Role Management:** 2 functions
- **Presale Management:** 6 functions
- **Purchase:** 1 function

---

## Access Control Matrix

| Function | Access Level | Multisig Required | Cooldown |
|----------|-------------|-------------------|----------|
| `initialize` | Authority | ❌ | ❌ |
| `set_governance` | Current Authority | ❌ | ❌ |
| `set_emergency_pause` | Governance | ❌ | ❌ |
| `mint_tokens` | Governance | ❌ | ❌ |
| `burn_tokens` | Governance | ❌ | ❌ |
| `transfer_tokens` | Public | ❌ | ❌ |
| `revoke_mint_authority` | Governance | ❌ | ❌ |
| `set_blacklist` | Governance | ❌ | ❌ |
| `set_whitelist` | Governance | ❌ | ❌ |
| `set_restricted` | Governance | ❌ | ❌ |
| `set_no_sell_limit` | Governance | ❌ | ❌ |
| `set_liquidity_pool` | Governance | ❌ | ❌ |
| `set_bridge_address` | Governance | ❌ | ❌ |
| `set_bond_address` | Governance | ❌ | ❌ |
| `queue_unpause` | Any Signer | ✅ | ✅ |
| `queue_set_blacklist` | Any Signer | ✅ | ✅ |
| `queue_set_no_sell_limit` | Any Signer | ✅ | ✅ |
| `queue_set_restricted` | Any Signer | ✅ | ✅ |
| `queue_set_liquidity_pool` | Any Signer | ✅ | ✅ |
| `queue_set_bridge_address` | Any Signer | ✅ | ✅ |
| `queue_set_bond_address` | Any Signer | ✅ | ✅ |
| `queue_set_required_approvals` | Any Signer | ✅ | ✅ |
| `queue_set_cooldown_period` | Any Signer | ✅ | ✅ |
| `approve_transaction` | Authorized Signer | ❌ | ❌ |
| `reject_transaction` | Authorized Signer | ❌ | ❌ |
| `execute_transaction` | Any | ❌ | ❌ |
| `emergency_pause` | Authorized Signer (1-of-3) | ❌ | ❌ |
| `grant_role` | Authority | ❌ | ❌ |
| `revoke_role` | Authority | ❌ | ❌ |
| `set_required_approvals` | Authority | ❌ | ❌ (Deprecated) |
| `set_cooldown_period` | Authority | ❌ | ❌ (Deprecated) |
| `presale::initialize` | Payer | ❌ | ❌ |
| `presale::set_governance` | Current Authority | ❌ | ❌ |
| `presale::set_token_program` | Admin/Governance | ❌ | ❌ |
| `presale::start_presale` | Admin/Governance | ❌ | ❌ |
| `presale::stop_presale` | Admin/Governance | ❌ | ❌ |
| `presale::pause_presale` | Admin/Governance | ❌ | ❌ |
| `presale::allow_payment_token` | Admin/Governance | ❌ | ❌ |
| `presale::disallow_payment_token` | Admin/Governance | ❌ | ❌ |
| `presale::buy` | Public | ❌ | ❌ |

---

## Multisig Flow

### Functions Requiring Multisig Approval

All `queue_*` functions require:
1. **Queue** - Any authorized signer can queue
2. **Approve** - 2-of-3 signers must approve (minimum)
3. **Cooldown** - Wait for cooldown period (minimum 30 minutes)
4. **Execute** - Execute transaction (auto-executes if conditions met)

### Functions NOT Requiring Multisig

- Direct token contract calls (governance PDA signs directly)
- Emergency pause (1 signer allowed)
- Presale management (admin/governance direct calls)
- Public functions (buy, transfer)

---

## Notes

- All governance-controlled functions in token contract require governance PDA to sign
- Multisig transactions are queued, approved, and executed with cooldown periods
- Emergency pause bypasses multisig for fast response (1 signer allowed)
- Presale functions can be called by admin or governance after `set_governance`
- Deprecated functions should not be used in production

---

**Generated:** [Date]  
**Version:** 1.0