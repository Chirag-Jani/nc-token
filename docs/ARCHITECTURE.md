# 🏗 Architecture & Security

## 1. Governance Model
The core of our security is a 2-of-N Multisig (Governance Program) that acts as the owner of the Token and Presale programs.
- **Cooldowns**: Prevents "flash" changes. Actions are queued and only executable after 30 minutes. High-impact transfers carry a 7-day wait.
- **Emergency Pause**: A single signer can halt transfers immediately if a bug or hack is detected. Unpausing requires full multisig consensus.

## 2. Treasury System
A hybrid model designed to keep funds in program custody rather than private wallets.
- **Collection**: All SOL/Tokens from the presale accumulate in Program Derived Address (PDA) vaults. These are on-chain wallets controlled only by program logic.
- **Withdrawal**: The Multisig periodically moves funds from PDAs to the designated `treasury_address` (usually a Gnosis/Squads multisig for long-term storage).

## 3. Token Restrictions
On-chain rules to prevent manipulation and maintain supply integrity.
- **LP Sell Limits**: Wallets are restricted to selling 10% of their balance per 24 hours specifically to Liquidity Pools, mitigating large "dumps."
- **Immutable Status**: After deployment, authorities are revoked, permanently locking the supply and metadata.

## 4. Oracle Integration
Dynamic pricing powered by Chainlink data feeds.
- **Feed**: `CH31XdtpZpi9vW9BsnU9989G8YyWdSuN7F9pX7o3N8xU` (SOL/USD).
- **Safety**: The program reads the "Latest Round" from Chainlink. If the data is older than 60 minutes, the buy instruction is blocked to prevent arbitrage against stale prices.

