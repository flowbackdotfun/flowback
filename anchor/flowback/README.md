<p align="center">
  <img src="../../client/public/brand/flowback-mark.png" alt="FlowBack" width="80" />
</p>

<h3 align="center">Flowback-Program</h3>

<p align="center">
  On-chain Anchor program for escrow-based MEV cashback settlement on Solana.
</p>

---

## Overview

The FlowBack program manages searcher escrow accounts and settles backrun auction results on-chain. When a searcher wins an auction, the relay constructs a settlement transaction that:

1. Verifies the searcher's off-chain Ed25519 bid commitment via Solana's sigverify precompile
2. Debits the searcher's escrow PDA by the bid amount
3. Credits the user (90%) and protocol treasury (10%)
4. Creates a replay-guard PDA to prevent double-settlement

The searcher never signs the settlement transaction directly - their authorization comes entirely from the Ed25519 signature verified on-chain. This preserves user privacy: the searcher's wallet never learns the user's pubkey.

**Program ID**: `D3T1iprZ1D43RGLPB8E57MQo2QW6xhtA6tQ4Cp3HqmB5`

---

## Accounts

### ProtocolConfig

PDA seed: `[b"config"]`

| Field | Type | Description |
|-------|------|-------------|
| authority | Pubkey | Can update config |
| treasury | Pubkey | Receives protocol fees |
| protocol_fee_bps | u16 | Fee percentage (0–10,000 BPS) |
| paused | bool | Emergency pause flag |
| total_cashback_paid | u64 | Cumulative cashback distributed |
| total_swaps_processed | u64 | Cumulative auctions settled |
| bump | u8 | PDA bump |

### SearcherEscrow

PDA seed: `[b"escrow", searcher_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| searcher | Pubkey | Escrow owner |
| bump | u8 | PDA bump |

Lamports above rent-exempt minimum = withdrawable balance.

### UsedHint

PDA seed: `[b"used_hint", hint_id_bytes]`

| Field | Type | Description |
|-------|------|-------------|
| bump | u8 | PDA bump |

Existence = "this auction already settled". Anchor's `init` constraint is the replay guard.

---

## Instructions

### `initialize(protocol_fee_bps, treasury, paused)`

One-time protocol setup. Authority creates the `ProtocolConfig` PDA.

### `update_config(protocol_fee_bps, treasury, paused)`

Authority-only. Update fee, treasury, or pause flag.

### `escrow_init()`

Searcher allocates their escrow PDA. Idempotent failure if already exists.

### `escrow_deposit(amount: u64)`

Searcher transfers lamports into their escrow via SystemProgram CPI.

### `escrow_withdraw(amount: u64)`

Searcher withdraws from escrow. Rejects if post-balance drops below rent-exempt minimum.

### `settle_from_escrow(bid_amount, user, hint_id)`

The core settlement instruction. **Fee payer = relay**, not the searcher.

1. Loads the Ed25519 sigverify instruction at tx index 0
2. Verifies the signed pubkey matches `escrow.searcher`
3. Verifies the signed message matches `flowback-bid:<hex hint_id>:<bid_amount>`
4. Splits bid: user gets `bid_amount - protocol_fee`, treasury gets `protocol_fee`
5. Reimburses relay for tx fees + UsedHint rent from escrow
6. Emits `CashbackSettled`

---

## Events

| Event | Fields |
|-------|--------|
| `CashbackSettled` | user, searcher, bid_amount, user_cashback, protocol_fee, timestamp |
| `EscrowDeposited` | searcher, amount, balance |
| `EscrowWithdrawn` | searcher, amount, balance |

---

## Errors

| Error | Code | Description |
|-------|------|-------------|
| InvalidProtocolFeeBps | 6000 | Fee BPS exceeds 10,000 |
| ProtocolPaused | 6001 | Protocol is paused |
| UserAccountMismatch | 6002 | User account doesn't match arg |
| TreasuryMismatch | 6003 | Treasury doesn't match config |
| MathOverflow | 6004 | Arithmetic overflow |
| EscrowOwnerMismatch | 6005 | Escrow searcher != Ed25519 pubkey |
| RentBreach | 6006 | Withdrawal below rent-exempt |
| InsufficientEscrow | 6007 | Not enough escrow balance |
| MissingEd25519Ix | 6008 | No Ed25519 sigverify at index 0 |
| InvalidEd25519Ix | 6009 | Malformed Ed25519 instruction |
| Ed25519PubkeyMismatch | 6010 | Verified pubkey mismatch |
| Ed25519MessageMismatch | 6011 | Verified message mismatch |

---

## Development

### Prerequisites

- Rust 1.79+
- Anchor CLI 1.0
- Solana CLI 2.x

### Build

```bash
cd anchor/flowback
anchor build --ignore-keys
```

### Test

Tests use [LiteSVM](https://github.com/LiteSVM/litesvm) with the `precompiles` feature so the Ed25519 sigverify program is available.

```bash
cd anchor/flowback
cargo test -p flowback
```

**Test coverage (9 tests):**

- `initialize` stores protocol config correctly
- `update_config` enforces authority and persists changes
- `escrow_init` + deposit increases PDA balance
- `escrow_withdraw` returns lamports, rejects rent breaches
- `settle_from_escrow` happy path - user + treasury credited, escrow debited
- `settle_from_escrow` replay rejection (same hint_id fails)
- `settle_from_escrow` rejects wrong searcher pubkey
- `settle_from_escrow` rejects tampered bid amount
- `settle_from_escrow` rejects missing Ed25519 instruction

### Deploy

```bash
cd anchor/flowback
anchor deploy --provider.cluster devnet
```

---

## Stack

| Dependency | Version | Purpose |
|-----------|---------|---------|
| anchor-lang | 1.0.0 | Anchor framework |
| solana-sdk-ids | 3.0.0 | Program ID constants |
| solana-instructions-sysvar | 3.0.0 | Ed25519 instruction introspection |
| litesvm | 0.10.0 | Local VM testing (dev) |
| solana-ed25519-program | 3.0.0 | Ed25519 test helpers (dev) |
