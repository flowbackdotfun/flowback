<p align="center">
  <img src="../client/public/brand/flowback-mark.png" alt="FlowBack" width="80" />
</p>

<h3 align="center">Flowback-Seed-Bot</h3>

<p align="center">
  Reference integration example for the <code>@flowback/searcher</code> SDK.
</p>

---

## Overview

A minimal, self-contained searcher that demonstrates a complete `@flowback/searcher` SDK integration. It covers every step a real searcher needs:

1. **Load keypair** from a JSON file (or generate an ephemeral one)
2. **Initialize + fund escrow PDA** on first run
3. **Connect** to the relay WebSocket and authenticate
4. **React to hints** - sign bid commitments, build backrun + tip txs, submit bids
5. **Handle auction results** - log wins and losses

The bot bids on every hint with a fixed base amount + random jitter. It is not optimized for profitability - it exists as a readable reference for searchers building their own integration.

For the step-by-step walkthrough of each SDK API used here, see the [Quick Start](../docs/content/docs/quick-start.mdx) docs.

---

## Environment Variables

```bash
FLOWBACK_PROGRAM_ID=D3T1iprZ1D43...   # Required - deployed FlowBack program ID
SOLANA_RPC_URL=http://localhost:8899   # Solana RPC endpoint (default: localhost)
RELAY_WS_URL=ws://localhost:3002       # Relay WebSocket URL (default: localhost)
KEYPAIR_PATH=./searcher-keypair.json   # Path to keypair JSON (optional - generates ephemeral if unset)
ESCROW_DEPOSIT=2000000000              # Escrow deposit in lamports (default: 2 SOL)
```

---

## Running

### Prerequisites

- Node.js 20+
- pnpm 10+
- A funded Solana keypair
- A running FlowBack relay

### Setup

```bash
cd seed-bot
pnpm install
```

### Run

```bash
pnpm dev          # Development with hot reload
pnpm build        # TypeScript compilation
pnpm start        # Production
```

---

## What to change for a real searcher

| This example | Your searcher |
|-------------|---------------|
| `computeBid()` returns a fixed base + jitter | Your pricing model based on `hint.priceImpactBps`, `hint.sizeBucket`, and your own DEX state |
| `buildBackrunTx()` sends a no-op ComputeBudget ix | Your actual arbitrage transaction |
| Bids on every hint | Skip hints where expected profit < bid + tip + gas |

Everything else (escrow management, auth, bid signing, tip construction) stays the same.

---

## Stack

| Dependency | Purpose |
|-----------|---------|
| @flowback/searcher | FlowBack SDK - WebSocket client, bid signing, escrow/tip builders |
| @solana/web3.js | Solana RPC + transaction construction |
| tsx | TypeScript execution (dev) |
