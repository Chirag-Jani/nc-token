# Test Keys Setup Guide

This guide explains how to set up private keys from Phantom wallet for testing.

## Quick Setup

1. **Export keys from Phantom:**
   - Open Phantom wallet
   - Go to Settings > Security & Privacy
   - Click "Export Private Key" for each account
   - Copy the private key (can be array format or base58 string)

2. **Update test-keys.json:**
   - Open `tests/test-keys.json`
   - Replace `null` values with the private keys from Phantom
   - **Two formats supported:**
     - **JSON Array**: `[123,45,67,89,...]` (64 numbers total)
     - **Base58 String**: `"4TPkYWDybiP6n2xXjkG2FN1pc1pxtJEESd9xtYtrrFXxxW93iv8KEA3cgyh5D4RSwYnrThcTJmS9KMeK6DkYrBGu"`

3. **Example (Array format):**
```json
{
  "authority": [123,45,67,89,...],  // 64 numbers
  "signer1": [234,56,78,90,...],    // 64 numbers
  "signer2": [345,67,89,01,...],    // 64 numbers
  "signer3": [456,78,90,12,...],    // 64 numbers
  "user": [567,89,01,23,...],       // 64 numbers
  "recipient": [678,90,12,34,...],  // 64 numbers
  "blacklistedUser": [789,01,23,45,...], // 64 numbers
  "mint": null  // Can leave as null, will use deterministic
}
```

**Example (Base58 format):**
```json
{
  "authority": "4TPkYWDybiP6n2xXjkG2FN1pc1pxtJEESd9xtYtrrFXxxW93iv8KEA3cgyh5D4RSwYnrThcTJmS9KMeK6DkYrBGu",
  "signer1": "5UQkYWDybiP6n2xXjkG2FN1pc1pxtJEESd9xtYtrrFXxxW93iv8KEA3cgyh5D4RSwYnrThcTJmS9KMeK6DkYrBGu",
  "signer2": null,
  "signer3": null,
  "user": null,
  "recipient": null,
  "blacklistedUser": null,
  "mint": null
}
```

**You can mix formats** - use array format for some keys and base58 strings for others!

## Using the Converter Script

Alternatively, use the interactive converter:

```bash
npx ts-node tests/convert-phantom-keys.ts
```

This will prompt you for each key and update `test-keys.json` automatically.

## Account Requirements

You need **7 accounts** with funded SOL:

1. **authority** - Main admin account
2. **signer1** - Governance signer #1
3. **signer2** - Governance signer #2
4. **signer3** - Governance signer #3
5. **user** - Regular user account
6. **recipient** - Recipient account for transfers
7. **blacklistedUser** - Account for blacklist testing

**Note:** The `mint` account is also needed but is typically created programmatically.

## Fallback Behavior

If a key is `null` in `test-keys.json`, the tests will use deterministic keypairs generated from seeds. This ensures tests work even without Phantom keys, but using actual funded accounts is recommended to avoid airdrop rate limits.

## Security Warning

⚠️ **Never commit test-keys.json with real private keys to version control!**

The file is already in `.gitignore`, but double-check before committing.
