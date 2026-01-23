chiragjani@Chirags-Laptop nc-token % ad
Deploying cluster: https://api.mainnet-beta.solana.com
Upgrade authority: /Users/chiragjani/.config/solana/id.json
Deploying program "presale"...
Program path: /Users/chiragjani/Documents/me/nc-token/target/deploy/presale.so...
^C
chiragjani@Chirags-Laptop nc-token % sb
11.795570038 SOL
chiragjani@Chirags-Laptop nc-token % ad
Deploying cluster: https://api.mainnet-beta.solana.com
Upgrade authority: /Users/chiragjani/.config/solana/id.json
Deploying program "presale"...
Program path: /Users/chiragjani/Documents/me/nc-token/target/deploy/presale.so...
Program Id: 8DAZJvKw8LzpZMi5aQ3Nj3UZ2LEmL3ieiS7g9E7Gzxyx

Signature: 3ewz2xBGAV7NZ91o2sKUNEESpg97mWo8gx4pNSCzGWbowvYp4bRRruRkYHtFTpRz6Ynho1Fup2Gfn6WHg6iVsCaE

Deploying program "governance"...
Program path: /Users/chiragjani/Documents/me/nc-token/target/deploy/governance.so...
Program Id: eFgtAai6S3N3dygPG9ajxxHVQJ2evn1o5sZ3LjmYqAL

Signature: 63mpV7L95sJU9LC7dex4XhSe6oEgfLxmF7SA2UnHWMEBmffgoszLFu8wTy6eFqdheng9wmaL8ypWScwo3GFXmLKE

Deploying program "spl_project"...
Program path: /Users/chiragjani/Documents/me/nc-token/target/deploy/spl_project.so...
Blockhash expired. 29 retries remaining
Blockhash expired. 28 retries remaining
Blockhash expired. 27 retries remaining
Blockhash expired. 26 retries remaining
Blockhash expired. 25 retries remaining
Blockhash expired. 24 retries remaining
Error: 2 write transactions failed
There was a problem deploying: Output { status: ExitStatus(unix_wait_status(256)), stdout: "", stderr: "" }.
chiragjani@Chirags-Laptop nc-token % sb
0.76168545 SOL
chiragjani@Chirags-Laptop nc-token % akl
presale: 8DAZJvKw8LzpZMi5aQ3Nj3UZ2LEmL3ieiS7g9E7Gzxyx
governance: eFgtAai6S3N3dygPG9ajxxHVQJ2evn1o5sZ3LjmYqAL
spl_project: 6GYb43UvYNuy7dHj495V2euT2Dx3oDKtvFkuYaDj5Kmo
chiragjani@Chirags-Laptop nc-token % solana program show
error: The following required arguments were not provided:
--buffers
--programs

USAGE:
solana program show --buffers --config <FILEPATH> --programs

For more information try --help
chiragjani@Chirags-Laptop nc-token % solana program show 8DAZJvKw8LzpZMi5aQ3Nj3UZ2LEmL3ieiS7g9E7Gzxyx

Program Id: 8DAZJvKw8LzpZMi5aQ3Nj3UZ2LEmL3ieiS7g9E7Gzxyx
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: F1pF5zQ6UHyAztS6KaSBxEk7T5Z7HLCt7s4YwF2ZG8Qo
Authority: 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
Last Deployed In Slot: 395341338
Data Length: 463080 (0x710e8) bytes
Balance: 3.22424088 SOL

chiragjani@Chirags-Laptop nc-token % solana program show eFgtAai6S3N3dygPG9ajxxHVQJ2evn1o5sZ3LjmYqAL

Program Id: eFgtAai6S3N3dygPG9ajxxHVQJ2evn1o5sZ3LjmYqAL
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: C6DJx5ZZUbb1C1eqqxA4KVSeR4cPR9pE87V8KEgRG5tq
Authority: 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
Last Deployed In Slot: 395341412
Data Length: 629304 (0x99a38) bytes
Balance: 4.38115992 SOL

chiragjani@Chirags-Laptop nc-token % solana program show 6GYb43UvYNuy7dHj495V2euT2Dx3oDKtvFkuYaDj5Kmo
Error: Unable to find the account 6GYb43UvYNuy7dHj495V2euT2Dx3oDKtvFkuYaDj5Kmo
chiragjani@Chirags-Laptop nc-token % solana program show --buffers

Buffer Address | Authority | Balance
AHMCs9VK57wGfXPK9986dVwdQi6ZDCyKzU3NLYab1ep8 | 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj | 3.41789592 SOL

chiragjani@Chirags-Laptop nc-token % solana program close AHMCs9VK57wGfXPK9986dVwdQi6ZDCyKzU3NLYab1ep8

Buffer Address | Authority | Balance
AHMCs9VK57wGfXPK9986dVwdQi6ZDCyKzU3NLYab1ep8 | 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj | 3.41789592 SOL

chiragjani@Chirags-Laptop nc-token % anchor deploy --program-name spl-project
Deploying cluster: https://api.mainnet-beta.solana.com
Upgrade authority: /Users/chiragjani/.config/solana/id.json
Deploying program "spl_project"...
Program path: /Users/chiragjani/Documents/me/nc-token/target/deploy/spl_project.so...
Program Id: 6GYb43UvYNuy7dHj495V2euT2Dx3oDKtvFkuYaDj5Kmo

Signature: 4FtctXHPNHrkVtwRCivKj9rKJFRG6RfYykBju3PGm42S1SffpxQjfx1z2MMpJvQzbiMBN5PPgsBbRcyhkNpAvc1Y

Deploy success
chiragjani@Chirags-Laptop nc-token % sb
0.75795901 SOL
chiragjani@Chirags-Laptop nc-token % yarn deploy:all
yarn run v1.22.22
$ ts-node scripts/deploy/deploy-all.ts
🚀 Starting complete deployment...

============================================================
📋 Configuration:
Token Name: NC Token
Token Symbol: NC
Token Decimals: 8
Total Supply: 30000000000
Required Approvals: 2
Cooldown Period: 1800 seconds
Signers: 3 1. 7AR2iUkdY6PR5abRRrHfgcLkSJjEKmLBg7CjNcWd9kri 2. 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz 3. 8UvcoXkL5epY5e3Q3KFv5EqWLCnTz3ZcmcGfbVjyvQzZ
============================================================

⚠️ Warning: Low wallet balance: 0.7580 SOL
Recommended: At least 5.00 SOL for deployment
Continuing anyway...

📝 Wallet: 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
🌐 Network: https://mainnet.helius-rpc.com/?api-key=519f61a1-0ac3-43b0-8037-f33a83718978
💰 Balance: 0.7580 SOL

📦 Program IDs:
Token: 6GYb43UvYNuy7dHj495V2euT2Dx3oDKtvFkuYaDj5Kmo
Governance: eFgtAai6S3N3dygPG9ajxxHVQJ2evn1o5sZ3LjmYqAL
Presale: 8DAZJvKw8LzpZMi5aQ3Nj3UZ2LEmL3ieiS7g9E7Gzxyx

============================================================
PHASE 1: Token Program Deployment
============================================================

1️⃣ Initializing token program state...
✅ State initialized: UcDWqY9H6GfBxqPoun5uL29TVrwLB4Qu1Kk2k6LFaEdh8UtxReBKqD3xJEuNyK7kmWYhZyNvEnMzkwuKdDJAEKm

2️⃣ Creating token mint...
✅ Mint created: CMgrXFXeiRuiwpiyhga2BiPQDxDBwbyqq5Re3KQUMCev

3️⃣ Creating token metadata...
✅ Metadata created: AB9hVPnxbeFNY1hEHS9vL718w8efGhTW7eVQhYrwijdH
📝 Name: NC Token
🏷️ Symbol: NC

4️⃣ Transferring mint authority to state PDA...
✅ Mint authority transferred

5️⃣ Creating token account and minting supply...
✅ Token account: HjVcom4wMUNDmSqUZxLukab4tVCtuHkjoohGSScmhduS
📦 Minting 30000000000 tokens...
📊 Total amount: 3000000000000000000 base units
✅ Tokens minted: 4yFU6s6HtYntZ6U18F1x8chnb1jTx271MADooKB6qJYVqHRTjsAJe5HhbK7QgN89S1Mvh2ShoUP4iwWy6J73xXCZ

============================================================
PHASE 2: Governance Program Deployment
============================================================

⚠️ Wallet not in signers list, adding it...

6️⃣ Initializing governance...
Required Approvals: 2
Cooldown Period: 1800 seconds
Signers: 4 1. 7AR2iUkdY6PR5abRRrHfgcLkSJjEKmLBg7CjNcWd9kri 2. 5pRAkTdec31NCJ152pJRVPAgGEHydJQ8kwc6oZFdzKJz 3. 8UvcoXkL5epY5e3Q3KFv5EqWLCnTz3ZcmcGfbVjyvQzZ 4. 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
✅ Governance initialized: FqQnQJGFxCPyMiUu8nYCKgxFtGrxY91pPTkWojmE3HBZbpEL2rgqrvAYFkbwvPyA3Cwg1JR38T86J71eTmvR1Li

7️⃣ Linking token program to governance...
✅ Token program linked: 61q5uhp5e9rHvqLMskZsse6m8x2burBjBdN7fL7rt34syQEaGjqtFDB6TnrXhq7XxXd8VV1rwniAnVw72zz81JyX

============================================================
PHASE 3: Presale Program Deployment
============================================================

8️⃣ Initializing presale...
Setting token_price_usd_micro to: 1000 micro-USD
Token price: 0.001000 USD per token
💡 Presale will use Chainlink SOL/USD oracle for dynamic pricing
✅ Presale initialized: 2uyNKYZpKU95M1DqzZaERRzr82j3TMAAUujvu23uE6HEYvn3d4P6WPqFyiZ6xmmwxhnVbfXdaWzZvoL14rfT2PWV

9️⃣ Linking presale program to governance...
✅ Presale program linked: 3TCBNbQwFMfwbXFb7VRh4aU9UCKay6KNbFSpUqtRynkJr8a1ojGuDPHaYF5S6v8Z4HuzWVMK49KqiWYtDjS4Ufmp

============================================================
PHASE 4: Setting Treasury Address
============================================================

🔟 Setting treasury address...
✅ Treasury address set: 9zhKaNwsuY4yQfdWUe6SVg5XLxfvZ1ZNVL2WAhX3oUrf1bpKNPMdi6pQfHTu9udicff9gRpJEA8FiGsUjQXZh1m
Treasury: 7AR2iUkdY6PR5abRRrHfgcLkSJjEKmLBg7CjNcWd9kri

============================================================
💾 Saving deployment information...
============================================================

✅ All deployment info saved!

- deployment-info.json (complete info)
- governance-deployment-info.json
- presale-deployment-info.json

============================================================
🎉 DEPLOYMENT COMPLETE!
============================================================

📋 Summary:
✅ Token Program: 6GYb43UvYNuy7dHj495V2euT2Dx3oDKtvFkuYaDj5Kmo
✅ Governance Program: eFgtAai6S3N3dygPG9ajxxHVQJ2evn1o5sZ3LjmYqAL
✅ Presale Program: 8DAZJvKw8LzpZMi5aQ3Nj3UZ2LEmL3ieiS7g9E7Gzxyx
✅ Mint Address: CMgrXFXeiRuiwpiyhga2BiPQDxDBwbyqq5Re3KQUMCev
✅ Total Supply: 30000000000 NC

📝 Next Steps:

1.  Review deployment-info.json
2.  Transfer token authority to governance (optional):
    yarn governance:transfer
3.  Allow payment tokens in presale:
    yarn presale:allow <PAYMENT_TOKEN_MINT>
4.  Start presale:
    yarn presale:start

============================================================
✨ Done in 18.55s.
chiragjani@Chirags-Laptop nc-token % yarn presale:start
yarn run v1.22.22
$ ts-node scripts/presale/start-presale.ts
🚀 Starting presale...
Presale State PDA: FcZd9nRYqf6YMVrgLwZrkiCA8RzRGL1B27jJy5knmtpW
Admin: 9Yhqmv2CvHwEzRLmQoSaz6z2C5xGngu5DqRgoNYpMPyj
SendTransactionError: Simulation failed.
Message: Transaction simulation failed: Attempt to load a program that does not exist.
Logs:
[].
Catch the `SendTransactionError` and call `getLogs()` on it for full details.
at Connection.sendEncodedTransaction (/Users/chiragjani/Documents/me/nc-token/node_modules/@solana/web3.js/src/connection.ts:6053:13)
at processTicksAndRejections (node:internal/process/task_queues:105:5)
at async Connection.sendRawTransaction (/Users/chiragjani/Documents/me/nc-token/node_modules/@solana/web3.js/src/connection.ts:6009:20)
at async sendAndConfirmRawTransaction (/Users/chiragjani/Documents/me/nc-token/node_modules/@coral-xyz/anchor/src/provider.ts:396:25)
at async AnchorProvider.sendAndConfirm (/Users/chiragjani/Documents/me/nc-token/node_modules/@coral-xyz/anchor/src/provider.ts:167:14)
at async MethodsBuilder.rpc [as _rpcFn] (/Users/chiragjani/Documents/me/nc-token/node_modules/@coral-xyz/anchor/src/program/namespace/rpc.ts:29:16) {
signature: '',
transactionMessage: 'Transaction simulation failed: Attempt to load a program that does not exist',
transactionLogs: [],
programErrorStack: ProgramErrorStack { stack: [] }
}
✨ Done in 2.34s.
chiragjani@Chirags-Laptop nc-token %
