---
name: lightspark-sdk
description: >-
  Lightspark Lightning Network SDK - Bitcoin payments, invoices, channels, and
  wallets via the Lightspark GraphQL API. Use when user asks about Lightning
  payments, Bitcoin invoices, node management, or Lightspark operations.
---

# Lightspark SDK MCP Skill

Lightning Network payments, invoices, channels & wallets via the Lightspark GraphQL API.

## Quick Reference

| Tool | Purpose | Category |
|------|---------|----------|
| `get_current_account` | Account details, nodes, balances | Account |
| `get_entity` | Look up any entity by ID | Account |
| `get_bitcoin_fee_estimate` | L1 fee estimates (fast/min) | Fees |
| `get_lightning_fee_estimate_for_invoice` | Lightning fee for invoice | Fees |
| `get_lightning_fee_estimate_for_node` | Lightning fee for node | Fees |
| `get_withdrawal_fee_estimate` | Withdrawal fee estimate | Fees |
| `decode_payment_request` | Decode BOLT11 invoice | Lookups |
| `get_incoming_payments_for_invoice` | Incoming payments for invoice | Lookups |
| `get_incoming_payments_for_payment_hash` | Incoming payments by hash | Lookups |
| `get_invoice_for_payment_hash` | Invoice by payment hash | Lookups |
| `get_outgoing_payment_by_idempotency_key` | Outgoing payment by key | Lookups |
| `get_outgoing_payments_for_invoice` | Outgoing payments for invoice | Lookups |
| `get_outgoing_payments_for_payment_hash` | Outgoing payments by hash | Lookups |
| `create_invoice` | Create BOLT11 invoice | Invoices |
| `create_offer` | Create BOLT12 offer | Invoices |
| `create_lnurl_invoice` | Create LNURL invoice | Invoices |
| `create_uma_invoice` | Create UMA invoice | Invoices |
| `cancel_invoice` | Cancel open invoice | Invoices |
| `pay_invoice` | Pay BOLT11 invoice | Payments |
| `pay_offer` | Pay BOLT12 offer | Payments |
| `pay_uma_invoice` | Pay UMA invoice | Payments |
| `send_payment` | Keysend by public key | Payments |
| `create_node_wallet_address` | Generate deposit address | Wallet |
| `request_withdrawal` | Withdraw to Bitcoin address | Wallet |
| `fund_node` | Add test funds (REGTEST) | Wallet |
| `create_api_token` | Create API token | Tokens |
| `delete_api_token` | Delete API token | Tokens |
| `screen_node` | Screen node for risk | Compliance |
| `register_payment` | Register with compliance | Compliance |
| `lookup_uma_address` | Check UMA address exists | UMA |
| `get_uma_invitation_by_code` | Get invitation details | UMA |
| `create_uma_invitation` | Create UMA invitation | UMA |
| `claim_uma_invitation` | Claim UMA invitation | UMA |
| `cancel_uma_invitation` | Cancel UMA invitation | UMA |
| `create_test_mode_invoice` | Test invoice (REGTEST) | Testing |
| `create_test_mode_payment` | Simulate payment (REGTEST) | Testing |
| `pay_test_mode_invoice` | Test with failure reasons | Testing |

## Common Patterns

### Check Account & Balances
```
get_current_account
# Returns: account name, nodes, balances (owned, available_to_send, available_to_withdraw)
```

### Create & Pay Invoice
```
# Step 1: Create invoice
create_invoice node_id="LightsparkNodeWithOSK:..." amount_msats=100000 memo="Coffee payment"

# Step 2: Pay it from another node
pay_invoice node_id="LightsparkNodeWithOSK:..." encoded_invoice="lnbc..." timeout_secs=60 maximum_fees_msats=1000
```

### Decode an Invoice
```
decode_payment_request encoded_payment_request="lnbc1u1p..."
# Returns: payment_hash, amount, memo, expires_at, destination
```

### Generate Bitcoin Deposit Address
```
create_node_wallet_address node_id="LightsparkNodeWithOSK:..."
# Returns: bcrt1q... or bc1q... address
```

### Withdraw to Bitcoin
```
# Step 1: Check fees
get_withdrawal_fee_estimate node_id="..." amount_sats=50000 withdrawal_mode="WALLET_ONLY"

# Step 2: Withdraw
request_withdrawal node_id="..." bitcoin_address="bc1q..." amount_sats=50000 withdrawal_mode="WALLET_ONLY" fee_target="MEDIUM"
```

### Test Mode Flow (REGTEST)
```
# Fund node with test sats
fund_node node_id="..." amount_sats=10000000

# Create test invoice
create_test_mode_invoice local_node_id="..." amount_msats=50000 memo="Test"

# Simulate payment
create_test_mode_payment local_node_id="..." encoded_invoice="lnbcrt..."
```

### Look Up Any Entity
```
get_entity id="Invoice:019c39ed-..."
get_entity id="LightsparkNodeWithOSK:019c39c7-..."
get_entity id="Channel:..."
```

## Key Concepts

- **Amount units**: Most amounts use millisatoshi (msats). 1 sat = 1000 msats. 1 BTC = 100,000,000 sats.
- **Node ID**: Format is `LightsparkNodeWithOSK:{uuid}` or `LightsparkNodeWithRemoteSigning:{uuid}`
- **Networks**: MAINNET (production), REGTEST (testing), TESTNET, SIGNET
- **Withdrawal modes**: WALLET_ONLY (on-chain only) or WALLET_THEN_CHANNELS (can close channels)
- **Fee targets**: HIGH (2 blocks), MEDIUM (6 blocks), LOW (18 blocks), BACKGROUND (50 blocks)
- **Invoice types**: STANDARD (regular) or AMP (Atomic Multi-Path)

## Account Info

| Property | Value |
|----------|-------|
| Account | Agenticledger |
| Node | LightsparkNodeWithOSK:019c39c7-9474-f96b-0000-fbc9230d0ec5 |
| Network | REGTEST |
| Balance | 10,000,000 SATOSHI |
| API Token | MCP TEST (REGTEST_VIEW, TESTNET_VIEW, REGTEST_TRANSACT, TESTNET_TRANSACT) |
