# NC Token - Mainnet Readiness Acceptance Checklist

**Status**: ⚠️ **IN PROGRESS** - Critical fixes required before mainnet deployment

**Last Updated**: Based on client technical review feedback

---

## 📋 Executive Summary

This checklist tracks mandatory security and governance fixes required for mainnet deployment. All items must be completed and verified before launch.

---

## 🟥 CRITICAL ISSUES - Must Fix Before Mainnet

### **Ethereum Token (NCToken.sol)**
> ⚠️ **Note**: Ethereum contracts not found in this repository. If they exist elsewhere, these items must be addressed.

#### [CRITICAL] Public Setter Vulnerability
- [ ] **Issue**: `setSellWindowDuration()` function is publicly callable
- [ ] **Risk**: Any external wallet can modify sell-window logic
- [ ] **Required Fix**:
  - [ ] Remove function entirely OR
  - [ ] Restrict with `onlyGovernance` modifier
  - [ ] Add unit test proving unauthorized calls fail
- [ ] **Verification**: Test that external wallet cannot call this function

#### [CRITICAL] Sell Limit Enforcement
- [ ] **Current**: Constant should enforce 10% daily
- [ ] **Required Fix**:
  - [ ] Verify `MAX_SELL_BPS = 1000` (10%)
  - [ ] Update all related unit tests
  - [ ] Confirm rule is per-wallet per 24h window
- [ ] **Verification**: Unit tests pass, sell limit correctly enforced

#### [HIGH] Sell Limit Documentation
- [ ] **Required**:
  - [ ] Document that sell limit is based on start-of-window wallet balance
  - [ ] List all exemptions (LP, router, exchange wallets) explicitly
  - [ ] Ensure any exemption setter uses `onlyGovernance`
- [ ] **Verification**: Documentation updated, exemptions clearly listed

#### [REQUIRED] No Post-Deploy Minting
- [ ] **Verification**: Mint authority revoked after initial deployment
- [ ] **Evidence**: Transaction hash showing mint authority revocation

---

### **Ethereum Governance (MultiSigGovernance.sol)**
> ⚠️ **Note**: Ethereum contracts not found in this repository. If they exist elsewhere, these items must be addressed.

#### [CRITICAL] Multisig Must Never Allow 1 Approval
- [ ] **Issue**: Current logic allows `requiredApprovals` to be set to 1
- [ ] **Required Fix**:
  - [ ] Enforce: `requiredApprovals >= 2`
  - [ ] Enforce: `requiredApprovals <= signerCount`
  - [ ] Default config: 2-of-3
- [ ] **Verification**: Unit tests prove setting to 1 fails

#### [CRITICAL] Governance Parameters Must Not Change Instantly
- [ ] **Issue**: Direct admin calls for:
  - `setCooldownPeriod()`
  - `setRequiredApprovals()`
  - Signer add/remove
- [ ] **Required Fix**:
  - [ ] These actions must be executed via queued multisig transactions
  - [ ] Cooldown must apply
  - [ ] Minimum cooldown enforced (≥ 30 minutes)
- [ ] **Verification**: Unit tests prove direct calls fail, queued transactions work

#### [CONFIRMED] Emergency Pause Behavior
- [ ] **Design Approved**:
  - [ ] Pause: 1 signer allowed
  - [ ] Unpause: 2-of-3 approvals + cooldown
- [ ] **Required Tests**:
  - [ ] Single signer can pause
  - [ ] Single signer cannot unpause
  - [ ] Two signers can unpause after cooldown
- [ ] **Verification**: All tests pass

#### [REQUIRED] Multisig Configuration
- [ ] **Configuration**:
  - [ ] 3 signers configured
  - [ ] Normal actions = 2 approvals
  - [ ] Emergency pause = 1 approval
  - [ ] Unpause = 2 approvals + cooldown
  - [ ] No path to reduce approvals to 1
- [ ] **Evidence**: Configuration proof provided

---

### **Solana Governance Program (lib.rs)**

#### [CRITICAL] Approvals Not Restricted to Authorized Signers
- [x] **Issue**: `approve_transaction()` allows any signer to approve
- [x] **Required Fix**:
  - [x] Store authorized signer list in `GovernanceState`
  - [x] Reject approvals from non-signers
  - [x] Enforce `required_approvals <= signers.len()`
- [ ] **Verification**: Unit test proves unauthorized approver fails

#### [CRITICAL] Execute Must Perform Real Actions
- [x] **Issue**: `execute_transaction()` only marks status without applying real state changes
- [x] **Required Fix**:
  - [x] **Option A**: Implement CPI calls that apply real effects (unpause, blacklist, etc.)
    - [x] Unpause: Full CPI implementation with PDA signing
    - [x] SetRequiredApprovals: Direct state update
    - [x] SetCooldownPeriod: Direct state update
    - [ ] Blacklist, NoSellLimit, Restrict, Pair: Requires additional accounts in context (TODO)
- [ ] **Verification**: Either CPI calls work OR scope is clearly documented

#### [CRITICAL] Required Approvals Can Be Set to 1
- [x] **Issue**: `set_required_approvals()` allows setting to 1
- [x] **Required Fix**:
  - [x] Enforce: `required >= 2` (MIN_REQUIRED_APPROVALS = 2)
  - [x] Enforce: `required <= signer_count`
  - [x] Make this function require multisig approval (queue_set_required_approvals added)
- [ ] **Verification**: Unit test proves setting to 1 fails

#### [CRITICAL] Governance Parameters Changed Instantly
- [x] **Issue**: `set_cooldown_period()` and `set_required_approvals()` are direct admin calls
- [x] **Required Fix**:
  - [x] These actions must be executed via queued multisig transactions (queue functions added)
  - [x] Cooldown must apply
  - [x] Minimum cooldown enforced (≥ 30 minutes = 1800 seconds, MIN_COOLDOWN_SECONDS constant)
- [ ] **Verification**: Unit tests prove direct calls fail, queued transactions work

#### [CRITICAL] Emergency Pause Requires Authority (Should Allow 1 Signer)
- [x] **Issue**: `emergency_pause()` requires full authority, not just 1 signer
- [x] **Required Fix**:
  - [x] Allow any authorized signer to call emergency pause (1-of-3)
  - [x] Implement signer list validation (uses is_authorized_signer)
- [ ] **Verification**: Unit test proves single signer can pause

#### [REQUIRED] Signer List Implementation
- [x] **Missing**: No signer list stored in `GovernanceState`
- [x] **Required Fix**:
  - [x] Add `signers: Vec<Pubkey>` to `GovernanceState`
  - [x] Initialize with signers during setup (initialize() accepts signers parameter)
  - [x] Add `is_authorized_signer()` helper method
  - [ ] Add/remove signers only via queued multisig transactions (TODO: queue functions needed)
- [ ] **Verification**: Signer list stored and validated

---

## ✅ Acceptance Criteria (Must Pass)

### **Ethereum Token**
- [ ] No post-deploy minting
- [ ] 10% daily sell limit enforced
- [ ] No public setters affecting sell logic
- [ ] Pause/unpause rules enforced correctly
- [ ] Governance parameters only changeable via queued multisig

### **Governance**
- [ ] 3 signers configured
- [ ] Normal actions = 2 approvals
- [ ] Emergency pause = 1 approval
- [ ] Unpause = 2 approvals + cooldown
- [ ] No path to reduce approvals to 1

### **Solana**
- [ ] Approver authorization enforced
- [ ] Execution applies real state changes OR scope clearly defined
- [ ] Evidence provided for:
  - [ ] Mint authority status (revoked)
  - [ ] Freeze authority status (if applicable)
  - [ ] Upgrade authority status (if applicable)

---

## 📦 Required Developer Deliverables

### **1. Updated Verified Sepolia Contracts**
- [ ] NCToken.sol verified on Sepolia
- [ ] MultiSigGovernance.sol verified on Sepolia
- [ ] Contract addresses provided
- [ ] Verification links provided

### **2. Updated Unit Test Results**
- [ ] All Ethereum tests passing
- [ ] All Solana tests passing
- [ ] Test coverage report
- [ ] Test results file attached

### **3. Final Multisig Configuration Proof**
- [ ] 2-of-3 enforced (proof provided)
- [ ] Signer addresses listed
- [ ] Configuration transaction hash
- [ ] Verification script output

### **4. Solana Evidence**
- [ ] **Authority Revocations**:
  - [ ] Mint authority revocation transaction hash
  - [ ] Freeze authority status (if applicable)
  - [ ] Upgrade authority status (if applicable)
- [ ] **Signer Validation Logic**:
  - [ ] Code showing signer list validation
  - [ ] Unit test proving unauthorized approver fails
- [ ] **Clarified Execution Scope**:
  - [ ] Documentation of what governance can/cannot control
  - [ ] CPI implementation OR scope limitation clearly stated

---

## 🔍 Verification Steps

### **For Each Critical Fix:**
1. [ ] Code change implemented
2. [ ] Unit test added/updated
3. [ ] Test passes locally
4. [ ] Code review completed
5. [ ] Deployed to testnet
6. [ ] Testnet verification successful
7. [ ] Documentation updated

### **Final Verification:**
- [ ] All checklist items completed
- [ ] All tests passing
- [ ] All evidence collected
- [ ] Client review scheduled
- [ ] Mainnet deployment approved

---

## 📝 Notes

### **Architecture Decisions (Confirmed)**
- **Ethereum / BNB**: Hard-enforced 10% daily sell limit at token level
- **Solana**: Standard SPL token with stability enforced via:
  - Vesting schedules
  - Project vault lock-ups
  - Liquidity locks
  - Transparency & monitoring

### **Governance Policy (Final)**
- Signers: 3 total (wallet addresses needed)
- Normal actions: 2-of-3 approvals required
- Emergency pause: 1-of-3 allowed (fast response)
- Unpause / parameter changes: 2-of-3 approvals + cooldown
- Sell limit enforcement:
  - Ethereum / BNB: Hard-enforced on-chain (10% daily)
  - Solana: Stability enforced via vesting, vault locks, and liquidity controls

---

## 🚨 Priority Order

1. **P0 - Blocking Mainnet**:
   - Solana: Signer authorization in `approve_transaction`
   - Solana: Prevent `required_approvals` from being set to 1
   - Solana: Make governance parameter changes require multisig
   - Ethereum: Remove/restrict public `setSellWindowDuration`

2. **P1 - High Priority**:
   - Solana: Implement signer list in `GovernanceState`
   - Solana: Fix `execute_transaction` to perform real actions OR document scope
   - Solana: Allow 1 signer for emergency pause
   - Ethereum: Verify sell limit enforcement

3. **P2 - Documentation & Evidence**:
   - Collect all authority revocation evidence
   - Update documentation
   - Provide multisig configuration proof

---

**Next Steps**: Address P0 items first, then proceed with P1 and P2.


