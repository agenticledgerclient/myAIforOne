---
name: frexplorer
description: >-
  Query wallet balances and transaction history across 100+ blockchain networks
  via the Frexplorer API. Token prices, wallet balances, transactions,
  historical data. Use when user asks about crypto balances, wallet contents,
  or on-chain analytics via Frexplorer.
---

# Frexplorer MCP Skill

Query wallet balances and transaction history across 100+ blockchain networks via the Frexplorer API.

## Quick Reference

| Tool | Purpose | Auth |
|------|---------|------|
| `chains_list` | List all 107 supported chains | No |
| `chain_check` | Check if chain is supported | No |
| `balance_get` | Get wallet balance (native + tokens) | No |
| `block_at_timestamp` | Convert timestamp to block number | No |
| `tx_chains_list` | List chains with tx explorer | No |
| `tx_list` | Fetch transaction history | No |
| `tx_mappings_list` | List CSV export templates | No |
| `tx_export` | Export transactions as CSV | No |
| `wallets_list` | List org wallets | Yes |
| `wallet_get` | Get wallet by ID | Yes |
| `wallet_stats` | Dashboard stats | Yes |
| `wallet_assets` | Asset breakdown | Yes |
| `balance_refresh` | Trigger balance refresh | Yes |

## Common Patterns

### Get Current Balance
```
balance_get address="0x..." chain="ethereum"
```

### Historical Balance (at block)
```
balance_get address="0x..." chain="ethereum" block=18500000
```

### Historical Balance (at timestamp)
```
# First convert timestamp to block
block_at_timestamp chain="ethereum" timestamp=1700000000

# Then query at that block
balance_get address="0x..." chain="ethereum" block=<result>
```

### Transaction History
```
tx_list address="0x..." chain="polygon" limit=100
```

### Transactions with Date Filter
```
tx_list address="0x..." chain="arbitrum" from_date="2024-01-01" to_date="2024-06-30"
```

### Paginate Through All Transactions
```
# First call
tx_list address="0x..." chain="ethereum" limit=100

# If hasMore=true, use nextCursor
tx_list address="0x..." chain="ethereum" limit=100 cursor="<nextCursor>"
```

## Supported Chains

### EVM Chains (Full Balance + Tokens)
ethereum, polygon, arbitrum, optimism, base, bnb, avalanche, fantom, gnosis, cronos, moonbeam, zksync, linea, scroll, blast, mantle, abstract, apechain, sonic, taiko, unichain, fraxtal, sei, opbnb, bittorrent

### Avalanche L1s (42 chains)
avax_cchain, avax_pchain, avax_xchain, avax_dfk, avax_beam, avax_shrapnel, avax_gunz, avax_dexalot, and 34 more

### Non-EVM Chains
bitcoin, solana, cardano, polkadot, cosmos, stellar, hedera, near, sui, filecoin, arweave, stacks, canton

### Historical Balance Support
- **Block-based:** All EVM chains, Stacks
- **Timestamp-based:** Hedera (~15 min granularity), Canton (~10 min)
- **Not supported:** Bitcoin, Solana, Cosmos (pruned nodes), Stellar, Sui

## Chain ID Reference

Use these IDs with `chain` parameter:

| Chain | ID | Native Symbol |
|-------|-----|---------------|
| Ethereum | `ethereum` | ETH |
| Polygon | `polygon` | MATIC |
| Arbitrum | `arbitrum` | ETH |
| Optimism | `optimism` | ETH |
| Base | `base` | ETH |
| BNB Chain | `bnb` | BNB |
| Avalanche C-Chain | `avalanche` | AVAX |
| Avalanche P-Chain | `avax_pchain` | AVAX |
| Fantom | `fantom` | FTM |
| Solana | `solana` | SOL |
| Bitcoin | `bitcoin` | BTC |
| Cosmos Hub | `cosmos` | ATOM |
| Hedera | `hedera` | HBAR |
| Canton Network | `canton` | CC |

For full list: `chains_list`

## Response Examples

### Balance Response
```json
{
  "address": "0x...",
  "chain": { "id": "ethereum", "name": "Ethereum Mainnet" },
  "native": { "symbol": "ETH", "balance": "32.11", "balanceUsd": null },
  "tokens": [...],
  "totalBalanceUsd": 0,
  "balanceAt": { "type": "current" }
}
```

### Transaction Response
```json
{
  "address": "0x...",
  "chain": "ethereum",
  "transactions": [
    {
      "hash": "0x...",
      "from": "0x...",
      "to": "0x...",
      "value": "1.5",
      "status": "success",
      "datetimeUtc": "2024-01-15T10:30:00Z"
    }
  ],
  "hasMore": true,
  "nextCursor": "..."
}
```

## Tips & Gotchas

1. **Rate Limits:** 10 requests/minute per IP for public endpoints
2. **Token Balances:** Only 8 chains have full token support (use `chains_list` to check)
3. **P-Chain/X-Chain:** Use `avax_pchain` / `avax_xchain` IDs, not just "avalanche"
4. **Canton Network:** Uses timestamp-based historical, not blocks
5. **Address Format:** Validated per chain type (EVM=0x, Cosmos=prefix1..., etc.)
6. **CSV Export:** Max 5 pages (~500 transactions) per export

## Authenticated Endpoints

Require `FREXPLORER_API_KEY` and `FREXPLORER_ORG_ID` env vars.

Used for:
- Managing organization wallets
- Triggering balance refreshes
- Getting aggregated portfolio stats

## API Base URL

```
https://backend-production-2871d.up.railway.app
```

## References

| File | When to read |
|------|--------------|
| [apis.md](references/frexplorer-apis.md) | Full API endpoint documentation, response formats, error codes |
