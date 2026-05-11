<p align="center">
  <img src="../client/public/brand/flowback-mark.png" alt="FlowBack" width="80" />
</p>

<h3 align="center">Flowback-Relay</h3>

<p align="center">
  Off-chain auction relay server - REST API, WebSocket hub, and Jito bundle submitter.
</p>

---

## Overview

The relay is the central off-chain coordinator for FlowBack. It handles the full auction lifecycle:

1. **Quote** - fetches Jupiter pricing and estimates cashback from historical auction data
2. **Prepare** - constructs the unsigned Jupiter swap transaction with frontrun protection
3. **Intent** - validates the user's signed transaction, starts the 200ms auction
4. **Auction** - broadcasts hints to searchers, collects bids, picks the winner
5. **Bundle** - assembles the 4-tx Jito bundle (swap → backrun → settlement → tip)
6. **Settlement** - submits to Jito Block Engine, monitors for on-chain confirmation
7. **Indexing** - watches for `CashbackSettled` events, pushes real-time updates to frontend

Two server processes run on separate ports:

| Server | Port | Protocol | Purpose |
|--------|------|----------|---------|
| Express | 3001 | HTTP | REST API for quotes, prepare, intent, history |
| uWebSockets.js | 3002 | WebSocket | Real-time searcher bids + user status updates |

---

## REST Endpoints

### `GET /quote`

Fetches a Jupiter swap quote with cashback estimate.

| Param | Type | Description |
|-------|------|-------------|
| inputMint | string | Input token mint address |
| outputMint | string | Output token mint address |
| amount | string | Input amount in raw lamports |
| slippageBps | number | Slippage tolerance in BPS |

### `POST /prepare`

Constructs the unsigned v0 Jupiter swap transaction with `jitodontfront` guard.

| Field | Type | Description |
|-------|------|-------------|
| user | string | User wallet pubkey |
| inputMint | string | Input token mint |
| outputMint | string | Output token mint |
| inputAmount | string | Raw input amount |
| minOutputAmount | string | Minimum acceptable output |
| maxSlippageBps | number | Max slippage BPS |

Returns `{ prepareId, unsignedTx, expiresAt }`.

### `POST /intent`

Submits the user-signed swap transaction and starts the auction.

| Field | Type | Description |
|-------|------|-------------|
| prepareId | string | From `/prepare` response |
| signedTx | string | Base64 wire bytes of signed transaction |

Returns `{ auctionId }`.

### `GET /history/:walletAddress`

Returns cashback history for a wallet (used by the MEV calculator page).

### `POST /mev/analyze`

Analyzes a wallet's historical swaps for MEV exposure.

---

## WebSocket Endpoints

### `/searcher` - Searcher bots (port 3002)

**Auth handshake:**
```json
{ "type": "auth", "pubkey": "...", "signature": "...", "timestamp": 1234567890 }
```

**Server → Searcher:**
```json
{ "type": "hint", "hintId": "...", "tokenPair": {...}, "sizeBucket": "medium", "priceImpactBps": 42, "auctionDeadlineMs": 1234567890 }
{ "type": "auction_result", "hintId": "...", "won": true, "yourBid": "1000000", "winningBid": "1000000" }
```

**Searcher → Server:**
```json
{ "type": "bid", "hintId": "...", "userCashbackLamports": "1000000", "jitoTipLamports": "10000", "backrunTx": "...", "tipTx": "...", "bidCommitmentSig": "..." }
```

### `/status` - Frontend (port 3002)

**Subscribe:**
```json
{ "type": "subscribe", "auctionId": "..." }
```

**Events:** `bundle_submitted`, `cashback_confirmed`, `fallback_executed`, `auction_failed`.

---

## Environment Variables

```bash
# ── Server ─────────────────────────────────────────────────
REST_PORT=3001                              # Express REST API port
WS_PORT=3002                                # uWebSockets.js port
ALLOWED_ORIGIN=http://localhost:3000         # CORS origin

# ── Solana ─────────────────────────────────────────────────
SOLANA_RPC_URL=http://127.0.0.1:8899        # Solana RPC endpoint
SOLANA_RPC_WS_URL=ws://127.0.0.1:8900       # Solana WS for log subscriptions

# ── Program ────────────────────────────────────────────────
FLOWBACK_PROGRAM_ID=D3T1iprZ1D43...         # Deployed FlowBack program ID
TREASURY_WALLET=Eycq1cLWoRcY...             # Treasury pubkey for protocol fees

# ── Database ───────────────────────────────────────────────
DATABASE_URL=postgresql://...               # PostgreSQL connection string

# ── Jupiter ────────────────────────────────────────────────
JUPITER_BUILD_API_URL=https://api.jup.ag/swap/v2   # Jupiter v2 /build endpoint
JUPITER_API_KEY=jup_...                             # Jupiter API key (required)
JUPITER_DEXES=Raydium CLMM,Whirlpool,Raydium       # Restrict to specific DEXes (optional)
JUPITER_DIRECT_ROUTES=true                          # Single-hop only (optional)

# ── Jito ───────────────────────────────────────────────────
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
RELAY_KEYPAIR=[12,34,...]                   # JSON byte array - signs Tx3 + Jito auth

# ── Auction ────────────────────────────────────────────────
AUCTION_WINDOW_MS=200                       # Bid collection window (ms)

# ── Helius ─────────────────────────────────────────────────
HELIUS_API_KEY=...                          # For MEV analysis (historical lookups)

# ── Redis ──────────────────────────────────────────────────
UPSTASH_REDIS_URL=redis://localhost:6379    # Rate limiting cache

# ── Arcjet ─────────────────────────────────────────────────
ARCJET_KEY=ajkey_...                        # Rate limiting / security
ARCJET_ENV=development

# ── Mock Mode ──────────────────────────────────────────────
MOCK_JUPITER=false        # true = fake quotes (no real swaps)
MOCK_JITO=true            # true = submit txs via RPC (no Jito bundles)
```

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL 15+

### Setup

```bash
cd relay
pnpm install

# Push database schema
pnpm db:push
```

### Run

```bash
pnpm dev          # Development with hot reload (tsx watch)
pnpm build        # TypeScript compilation
pnpm start        # Production (node dist/index.js)
```

### Database

```bash
pnpm db:push      # Push schema to PostgreSQL
pnpm db:studio    # Open Drizzle Studio (visual DB browser)
```

### Type Check

```bash
pnpm exec tsc --noEmit
```

---

## Architecture

Three-layer REST pattern per route:

```
routes/{name}.route.ts       → Express Router
controllers/{name}.controller.ts → (req, res) translation
services/{name}.service.ts   → Pure business logic
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `auction/manager.ts` | Opens auctions, broadcasts hints, collects bids, sorts by cashback |
| `auction/validator.ts` | Tier-1 (Ed25519 sig verify) + Tier-2 (backrun simulation) |
| `bundle/constructor.ts` | Assembles 4-tx Jito bundle with relay-built Tx3 |
| `bundle/orchestrator.ts` | Post-auction pipeline - try top candidates, fallback to plain RPC |
| `bundle/submitter.ts` | Jito Block Engine gRPC submission + bundle result stream |
| `anchor/flowback-ix.ts` | Settlement + Ed25519 instruction builders, PDA derivation |
| `jupiter/client.ts` | Jupiter v2 /build API - quotes and swap instructions |
| `ws/searcher.ts` | Searcher WebSocket auth, hint broadcast, bid collection |
| `ws/user.ts` | Frontend status WebSocket - auction progress events |
| `services/prepare-store.ts` | In-memory prepared swap cache with TTL |
| `services/pending-cashback.ts` | Pre-registers cashback lookups to win the indexer race |

---

## Stack

| Dependency | Purpose |
|-----------|---------|
| Express 5 | REST API |
| uWebSockets.js | WebSocket server (searchers + users) |
| @solana/kit | RPC, transaction decoding |
| @solana/web3.js | Transaction construction (Tx3) |
| jito-ts | Jito Block Engine gRPC client |
| Drizzle ORM + postgres | Database |
| ioredis | Rate limiting cache |
| Arcjet | Security middleware |
