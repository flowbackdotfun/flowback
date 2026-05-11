<p align="center">
  <img src="../client/public/brand/flowback-mark.png" alt="FlowBack" width="80" />
</p>

<h3 align="center">Flowback-Scripts</h3>

<p align="center">
  Protocol initialization, searcher bots, and demo setup scripts.
</p>

---

## Overview

Standalone scripts for bootstrapping and operating a local FlowBack environment. Includes:

- **Demo setup** - one-shot script that funds wallets, deploys the program, and initializes the protocol
- **Protocol init** - creates the on-chain `ProtocolConfig` PDA
- **Searcher bot** - connects to the relay, receives hints, and bids in auctions
- **Send intent** - simulates a user swap through the full auction lifecycle
- **Verify reimbursement** - audits settlement transactions for correctness

---

## Scripts

### `pnpm demo` - Automated Demo Setup

One-command setup for the entire local environment:

1. Checks RPC connectivity to local validator
2. Funds the authority wallet (10 SOL)
3. Deploys the FlowBack Anchor program (if not already deployed)
4. Initializes the protocol config (10% fee, treasury wallet)
5. Funds the relay keypair (5 SOL, extracted from `relay/.env`)
6. Funds the searcher bot keypair (5 SOL)

```bash
pnpm demo
```

### `pnpm init` - Initialize Protocol

One-time setup. Creates the `ProtocolConfig` PDA on-chain with protocol fee and treasury settings. Idempotent - skips if config already exists.

```bash
pnpm init
```

### `pnpm searcher <index>` - Run Searcher Bot

Connects to the relay's `/searcher` WebSocket, authenticates, and bids on every hint.

```bash
pnpm searcher 0    # Bot index 0 (lowest bids)
pnpm searcher 1    # Bot index 1 (higher bids)
pnpm searcher 2    # Bot index 2 (highest bids)
```

Each bot index produces different bid amounts (~1M + index × 200k lamports + jitter). Run multiple bots to simulate competitive auctions.

On first run, the bot:
- Generates a keypair at `scripts/keys/searcher-{index}.json`
- Airdrops 4 SOL
- Initializes and funds the escrow PDA (2 SOL usable balance)

### `pnpm intent` - Send User Swap Intent

Simulates a user swap through the full lifecycle: prepare → sign → submit intent → monitor auction via WebSocket.

```bash
pnpm intent
```

### `pnpm verify <tx-signature> [expected-bid]` - Verify Settlement

Audits a settlement transaction for correct relay reimbursement, user/treasury credits, and lamport conservation.

```bash
pnpm verify <TRANSACTION_SIGNATURE> 1000000
```

---

## Environment Variables

All scripts use defaults from `lib/util.ts`. Override via env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLANA_RPC_URL` | `http://localhost:8899` | Solana RPC endpoint |
| `RELAY_REST_URL` | `http://localhost:3001` | Relay REST API |
| `RELAY_WS_URL` | `ws://localhost:3002` | Relay WebSocket |
| `FLOWBACK_PROGRAM_ID` | `D3T1iprZ1D43...` | Deployed program ID |
| `PROTOCOL_FEE_BPS` | `1000` (10%) | Protocol fee for init |

---

## Keypair Management

All keypairs are persisted to `scripts/keys/` for consistency across restarts:

```
scripts/keys/
├── authority.json       # Protocol authority (or uses ~/.config/solana/id.json)
├── treasury.json        # Treasury wallet
├── searcher-0.json      # Searcher bot 0
├── searcher-1.json      # Searcher bot 1
└── ...
```

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 10+
- A running Solana validator (Surfpool or solana-test-validator)

### Setup

```bash
cd scripts
pnpm install
```

---

## Stack

| Dependency | Purpose |
|-----------|---------|
| @flowback/searcher | FlowBack SDK (searcher client, builders) |
| @solana/web3.js | Solana RPC + transaction construction |
| bs58 | Base58 encoding/decoding |
| ws | WebSocket client |
| tsx | TypeScript execution |
