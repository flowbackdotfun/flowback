# FlowBack — CLAUDE.md

## What this project is

FlowBack is a Solana swap router that runs a sealed-bid backrun auction before every swap lands on-chain. Instead of MEV searchers silently profiting off a user's trade, they must compete in a ~200ms auction for the exclusive right to backrun it. The auction winner pays 90% of their bid directly to the user as cashback via an on-chain Anchor program. The user gets the same Jupiter-routed swap output they would have gotten normally, plus SOL back in their wallet.

The model parallels Flashbots MEV-Share on Ethereum, adapted to Solana's Jito bundle infrastructure.

---

## Project structure

Each directory is standalone with its own `package.json` and dependencies. No monorepo tooling, no workspaces, no Turborepo. Install and run each package independently.

```
flowback/
├── anchor/
│   └── flowback/                         Anchor workspace
│       ├── Anchor.toml
│       └── programs/flowback/
│           └── src/
│               ├── lib.rs                Program entry — 6 instructions
│               ├── instructions/         initialize, update_config, escrow_init,
│               │                         escrow_deposit, escrow_withdraw,
│               │                         settle_from_escrow
│               ├── state.rs              ProtocolConfig, SearcherEscrow, UsedHint
│               ├── events.rs             CashbackSettled, EscrowDeposited, EscrowWithdrawn
│               ├── error.rs              FlowbackError enum
│               └── constants.rs          PDA seeds, bid message prefix, fee constants
│
├── relay/                                Off-chain auction relay (Node.js)
│   ├── src/
│   │   ├── index.ts                      Express + uWS server entry
│   │   ├── rate-limit.ts                 Arcjet rate-limit middleware
│   │   ├── anchor/
│   │   │   └── flowback-ix.ts            Settle tx builder (Ed25519 + settle_from_escrow)
│   │   ├── auction/
│   │   │   ├── manager.ts                AuctionManager
│   │   │   ├── types.ts                  SwapIntent, SearcherHint, SearcherBid
│   │   │   └── validator.ts              Tier-1 (bid commitment) + Tier-2 (sim) checks
│   │   ├── bundle/
│   │   │   ├── constructor.ts            4-tx Jito bundle assembly
│   │   │   ├── orchestrator.ts           Winner-walk loop, fallback path
│   │   │   └── submitter.ts              Jito Block Engine submit + status polling
│   │   ├── jupiter/
│   │   │   └── client.ts                 Jupiter quote + swap-instructions client
│   │   ├── helius/
│   │   │   └── client.ts                 Helius Enhanced Tx API (MEV analyzer)
│   │   ├── indexer/
│   │   │   └── cashback.ts               onLogs subscriber for CashbackSettled
│   │   ├── db/
│   │   │   ├── schema.ts                 Drizzle schema
│   │   │   ├── client.ts                 Postgres client
│   │   │   └── redis.ts                  Upstash Redis cache
│   │   ├── ws/
│   │   │   ├── searcher.ts               /searcher WS handler + auth
│   │   │   └── user.ts                   /status WS handler + replay buffer
│   │   ├── routes/                       Thin Express handlers
│   │   ├── controllers/                  Request validation + response shaping
│   │   └── services/                     Business logic
│   │       ├── quote.service.ts
│   │       ├── prepare.service.ts
│   │       ├── prepare-store.ts          In-memory PreparedSwapStore
│   │       ├── intent.service.ts
│   │       ├── history.service.ts
│   │       ├── mev-analysis.service.ts   Sandwich/frontrun/backrun detection
│   │       ├── waitlist.service.ts
│   │       ├── pending-cashback.ts       PendingCashbackRegistry
│   │       └── errors.ts
│   └── package.json
│
├── client/                               Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                  Landing page
│   │   │   ├── swap/page.tsx             Swap interface
│   │   │   └── analyzer/page.tsx         MEV analyzer
│   │   ├── components/
│   │   │   ├── flowback/
│   │   │   │   ├── swap-card.tsx
│   │   │   │   ├── cashback-toast.tsx
│   │   │   │   ├── mev-analyzer.tsx      Analyzer input + state
│   │   │   │   ├── mev-dashboard.tsx     Analyzer results, virtualized swap list
│   │   │   │   ├── nav.tsx
│   │   │   │   ├── hero.tsx
│   │   │   │   ├── hero-diagram.tsx
│   │   │   │   ├── landing-page.tsx
│   │   │   │   ├── icons.tsx
│   │   │   │   ├── types.ts
│   │   │   │   └── sections/             Landing page sections
│   │   │   └── ui/                       shadcn-style primitives
│   │   ├── lib/
│   │   │   ├── flowback-relay.ts         Relay API client
│   │   │   ├── hooks/                    use-count-up, use-in-view
│   │   │   └── utils.ts
│   │   ├── providers/                    Wallet adapter, theme, etc.
│   │   └── styles/
│   └── package.json
│
├── sdk/                                  Searcher-facing TypeScript SDK
│   ├── src/
│   │   ├── index.ts                      FlowBackSearcher class
│   │   └── types.ts
│   └── package.json
│
├── seed-bot/                             Internal seed searcher (guarantees demo cashback)
│   ├── src/
│   │   └── index.ts
│   └── package.json
│
├── scripts/                              TS dev utilities (run via tsx)
│   ├── init-protocol.ts                  Call `initialize` on the Anchor program
│   ├── demo-setup.ts                     Set up demo state (treasury, seed escrow)
│   ├── send-intent.ts                    End-to-end sample intent submission
│   ├── searcher-bot.ts                   Programmable searcher harness
│   ├── verify-reimbursement.ts           Reconcile on-chain settle vs DB events
│   ├── lib/util.ts
│   ├── keys/                             Pre-funded devnet keypairs
│   └── package.json
│
├── docs/                                 Standalone Next.js documentation site
│   └── package.json
│
└── claude.md                             This file
```

---

## Critical system understanding

### One-time searcher setup

Before a searcher can bid, they must pre-fund an on-chain escrow. The `settle_from_escrow` instruction debits this PDA rather than the searcher's wallet, which is what lets the relay (not the searcher) sign Tx3.

1. Searcher calls `escrow_init` → creates a PDA at `[b"escrow", searcher_pubkey]`
2. Searcher calls `escrow_deposit(amount)` → tops up the PDA's lamport balance
3. Withdrawals via `escrow_withdraw(amount)` are gated on rent-exempt minimum

### The happy path (auction has bids)

1. User opens app, connects Phantom wallet
2. User enters swap (e.g. 2 SOL → USDC)
3. Frontend calls `GET /quote` on relay → relay calls Jupiter → returns quote + cashback estimate
4. User clicks swap; frontend POSTs `POST /prepare` — relay validates and stores the prepared Jupiter swap state in memory keyed by a prepare id
5. User signs an **intent message** (NOT a transaction) in their wallet
6. Frontend POSTs signed intent to `POST /intent` on relay
7. Relay validates the intent signature, opens an auction, broadcasts a **hint** to all connected searchers via uWS WebSocket:
   - Reveals: token pair, size bucket (small/medium/large/whale), price impact bps, auction deadline
   - Hides: exact amount, user wallet
8. Auction runs for **`AUCTION_WINDOW_MS`** (default 200ms). Searchers submit bids: `{ userCashbackLamports, jitoTipLamports, backrunTx, tipTx, bidCommitmentSig }`. Tier-1 (Ed25519 sig over the canonical bid message) runs on each bid as it arrives — no RPC
9. After the window closes, AuctionManager returns bids sorted desc by `userCashbackLamports`
10. Orchestrator walks up to 3 candidates: for each, run Tier-2 (`simulateTransaction` on `backrunTx` with `replaceRecentBlockhash`) and build Tx3. First success becomes the winner
11. Relay assembles the 4-tx Jito bundle:
    - **Tx1**: User's Jupiter swap (with `jitodontfront` guard) — pre-signed by user via the prepared swap
    - **Tx2**: Searcher's backrun arb (from bid, pre-signed by searcher)
    - **Tx3**: Settlement — `Ed25519Program` sigverify ix at index 0 + `settle_from_escrow` ix, signed by relay (relay = fee payer)
    - **Tx4**: Searcher's Jito tip transfer (from bid, pre-signed by searcher)
12. Bundle submitted to Jito Block Engine; relay polls `getBundleStatuses`
13. On-chain `settle_from_escrow` reads the instructions sysvar to verify the Ed25519 sig, debits the searcher's escrow PDA, splits the bid: 90% → user, 10% → treasury, with a small reimbursement back to the relay for tx fee + `used_hint` rent
14. Indexer (`onLogs` on the program ID) parses `CashbackSettled` events into `cashback_events` table
15. Frontend `/status` WebSocket receives `cashback_confirmed` notification with the tx signature

### The fallback path (zero bids)

After the auction window with no bids, the orchestrator submits the user's pre-signed Jupiter swap via plain RPC (no Jito bundle). Status is `fallback`; UI shows "Swap complete — no cashback this trade."

### Why `jitodontfront` matters

Including the `jitodontfront` public key (any key starting with `jitodontfront`) as a non-signer, non-writable account in Tx1 tells Jito's Block Engine to reject any bundle that places a transaction before Tx1 in the same block. This eliminates sandwich attacks within Jito infrastructure. The user gets sandwich protection AND cashback simultaneously.

### Why the relay (not the searcher) signs Tx3

The searcher's on-chain authorization is the Ed25519 signature over the bid commitment message — not a transaction signature. This means:

- The searcher only needs to know the `hintId` and `bidAmount`. They never need the user's pubkey.
- The relay assembles Tx3 with a fresh blockhash after winner selection — no risk of stale blockhash from a pre-signed Tx3.
- Same searcher pubkey can be used across many auctions without exposing it as a fee payer.

The trade-off: searchers must pre-fund an escrow PDA. The escrow + sigverify model treats the off-chain bid sig as a one-shot capability over `bid_amount` lamports of the escrow, scoped to a specific `hintId` (via the `used_hint` PDA replay guard).

---

## On-chain program (Anchor)

**Program ID**: `BLZeEY7GZ5AK6gAZQW5BVi9w71yoJig4Kc97bL1HAnP8` (declared in `lib.rs`)

**Location**: `anchor/flowback/programs/flowback/src/`

### PDA seeds

- `[b"config"]` — global `ProtocolConfig`
- `[b"escrow", searcher_pubkey]` — per-searcher `SearcherEscrow`
- `[b"used_hint", hint_id_bytes]` — per-auction replay marker (`hint_id_bytes` is the 16-byte UUID)

### Bid commitment message

The canonical message a searcher signs and the program reconstructs:

```
flowback-bid:<lowercase hex hint_id, no dashes>:<decimal bid_amount>
```

`BID_MESSAGE_PREFIX = b"flowback-bid:"`, `HINT_ID_LEN = 16`.

### Instructions

#### `initialize`

- Called once at deployment by the authority wallet
- Args: `protocol_fee_bps: u16`, `treasury: Pubkey`, `paused: bool`
- Creates `ProtocolConfig` at `[b"config"]`

#### `update_config`

- Authority-only
- Updates `protocol_fee_bps`, `treasury`, `paused`

#### `escrow_init`

- Called once per searcher
- Creates `SearcherEscrow` at `[b"escrow", searcher_pubkey]`. Searcher is the signer

#### `escrow_deposit(amount: u64)`

- Searcher tops up their escrow. System transfer from searcher → escrow PDA

#### `escrow_withdraw(amount: u64)`

- Searcher withdraws lamports above rent-exempt minimum. Signer = searcher

#### `settle_from_escrow(bid_amount: u64, user: Pubkey, hint_id: [u8; 16])`

The core of the protocol. Steps:

1. Requires `config.paused == false`
2. Loads instruction at index 0 of the same tx via `load_instruction_at_checked` — must be the Ed25519 sigverify precompile
3. Parses the single-signature Ed25519 layout (sig/pubkey/message all in the ix data buffer, `instruction_index == u16::MAX`)
4. Asserts: `verified_pubkey == escrow.searcher` (the sig is from the escrow's owner)
5. Asserts: `verified_message == flowback-bid:<hex hint_id>:<decimal bid_amount>` (the sig commits to this exact bid)
6. Computes split: `protocol_fee = bid_amount * config.protocol_fee_bps / 10_000`, `user_share = bid_amount - protocol_fee`
7. Computes relay reimbursement: `Rent(used_hint) + TX_FEE_REIMBURSEMENT_LAMPORTS (10_000)` — covers the relay's tx fee + the rent it pre-paid on `used_hint`. Relay's per-settlement net cost is zero
8. Debits escrow PDA (manual lamport mutation since it's program-owned); requires post-balance ≥ escrow rent-exempt minimum
9. Credits user, treasury, relay
10. `init` constraint on `used_hint` PDA fails if the hint was already settled (replay guard armed at this point)
11. Bumps `config.total_cashback_paid` and `config.total_swaps_processed`
12. Emits `CashbackSettled { user, searcher, bid_amount, user_cashback, protocol_fee, timestamp }`

### Account structs

```rust
#[account]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub protocol_fee_bps: u16,
    pub paused: bool,
    pub total_cashback_paid: u64,
    pub total_swaps_processed: u64,
    pub bump: u8,
}

#[account]
pub struct SearcherEscrow {
    pub searcher: Pubkey,
    pub bump: u8,
}

#[account]
pub struct UsedHint {
    pub bump: u8,
}
```

### Events

- `CashbackSettled { user, searcher, bid_amount, user_cashback, protocol_fee, timestamp }`
- `EscrowDeposited { searcher, amount, balance }`
- `EscrowWithdrawn { searcher, amount, balance }`

### Security constraints

- Replay protection via `used_hint` PDA (`init` constraint fails on existing PDA)
- Treasury is stored in `ProtocolConfig` and enforced with `address = config.treasury`, not passed as an unchecked arg
- User account enforced with `address = user @ FlowbackError::UserAccountMismatch`
- Bid signer enforced: Ed25519 sig pubkey must match `escrow.searcher`
- Bid message exact match: any drift in hex encoding or decimal formatting will fail verification
- `settle_from_escrow` allows `bid_amount` of any size that fits the escrow balance (no min/max — searcher already committed)

---

## Relay server

**Runtime**: Node.js 20+, TypeScript, tsx for dev
**Framework**: Express for REST, uWebSockets.js for WebSocket
**Ports**: `REST_PORT=3001` (Express), `WS_PORT=3002` (uWS)

### Environment variables (relay/.env)

```
# Server
REST_PORT=3001
WS_PORT=3002
ALLOWED_ORIGIN=http://localhost:3000

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_RPC_WS_URL=wss://api.devnet.solana.com
FLOWBACK_PROGRAM_ID=BLZeEY7GZ5AK6gAZQW5BVi9w71yoJig4Kc97bL1HAnP8
TREASURY_WALLET=<base58 pubkey>
RELAY_KEYPAIR=<Solana CLI JSON array, e.g. [12,34,...]>   # relay signs Tx3 + pays fees

# Database
DATABASE_URL=postgresql://...

# Jupiter
JUPITER_BUILD_API_URL=https://api.jup.ag/swap/v2
JUPITER_API_KEY=<jupiter api key>
JUPITER_DEXES=                                            # optional CSV filter
JUPITER_DIRECT_ROUTES=false                               # optional bool

# Jito
JITO_BLOCK_ENGINE_URL=https://dallas.devnet.block-engine.jito.wtf

# Auction
AUCTION_WINDOW_MS=200

# Helius (MEV analyzer)
HELIUS_API_KEY=<helius api key>

# Caching
UPSTASH_REDIS_URL=<redis url>

# Rate limiting
ARCJET_KEY=<arcjet key>
ARCJET_ENV=development

# Local development mocks
MOCK_JUPITER=false
MOCK_JITO=true
MOCK_ANALYZER_VALUE=false
```

### REST endpoints

Each endpoint has its own per-IP Arcjet rate limit. Pattern: `routes/<name>.route.ts` → `controllers/<name>.controller.ts` → `services/<name>.service.ts`.

| Method | Path | Limit | Purpose |
|--------|------|-------|---------|
| GET | `/quote` | 30/min | Jupiter quote + cashback estimate from auction history |
| POST | `/prepare` | 20/min | Validate intent, build the user's Jupiter v0 swap, store it in `PreparedSwapStore` |
| POST | `/intent` | 15/min | Submit signed intent, trigger auction, orchestrate settlement |
| GET | `/history/:wallet` | 30/min | Paginated cashback history from `cashback_events` |
| GET | `/mev-analysis/:wallet` | 10/min | Helius-backed sandwich/frontrun/backrun detection |
| POST | `/waitlist` | 5/min | Email signup → `waitlist_signups` table |
| GET | `/health` | — | `{ ok, searchers, preparedSwaps }` |

### WebSocket protocol (uWS, port 3002)

#### `/searcher` — for searcher bots

**Auth** (`{ type: "auth", pubkey, signature, timestamp }`):
- `signature` is base58 Ed25519 over `flowback-searcher-auth:<pubkey>:<timestampMs>`
- `timestamp` must be within ±60s of server time (replay protection without a server-issued challenge)
- Optional allowlist via `deps.allowlist` set
- On success: `{ type: "auth_ok" }`. Connection upgraded into the registry

**Hint** (server → searcher, `{ type: "hint", hintId, tokenPair, sizeBucket, priceImpactBps, auctionDeadlineMs }`):
- Broadcast to all authenticated searchers when an auction opens

**Bid** (searcher → server, `{ type: "bid", hintId, userCashbackLamports, jitoTipLamports, backrunTx, tipTx, bidCommitmentSig }`):
- `userCashbackLamports` and `jitoTipLamports` are decimal strings
- `backrunTx` and `tipTx` are base64-encoded pre-signed transactions
- `bidCommitmentSig` is base58 Ed25519 over `flowback-bid:<hex hintId>:<decimal bid_amount>`
- Server replies `{ type: "bid_accepted" }` or `{ type: "bid_rejected", reason }`

**Auction result** (server → searcher, `{ type: "auction_result", hintId, won, yourBid, winningBid }`):
- Sent to every searcher who bid

Note: the relay builds the on-chain settlement tx itself, so searchers do **not** send a pre-signed Tx3. The cryptographic capability is the off-chain `bidCommitmentSig`.

#### `/status` — for frontend

- Client: `{ type: "subscribe", auctionId }`
- Server emits: `bundle_submitted`, `cashback_confirmed`, `fallback_executed`, `auction_failed`
- 60-second in-memory replay buffer so late subscribers don't miss events

### Bid validation (two tiers)

**Tier 1 — in-window, on bid receipt** (cheap, no RPC):

`validateBidCommitment(bidCommitmentSig, { hintId, searcherPubkey, bidAmountLamports })` in [relay/src/auction/validator.ts](relay/src/auction/validator.ts) verifies the Ed25519 signature over `flowback-bid:<hex hintId>:<decimal bid_amount>`. The same signature is later embedded in the on-chain Ed25519 precompile ix and re-verified by the FlowBack program, so a Tier-1 pass is necessary but not sufficient.

**Tier 2 — post-close, prospective winner only** (expensive, hits RPC):

After the window closes, AuctionManager returns bids sorted desc by `userCashbackLamports`. Orchestrator walks up to 3 candidates:
- `validateBackrunTx` calls `simulateTransaction(backrunTx, { replaceRecentBlockhash: true, sigVerify: false })` with a 1000ms timeout
- If sim succeeds → build Tx3 → submit bundle
- If sim or settle build fails → drop this candidate, try the next

Simulation is only run on the prospective winner(s), never on losing bids. This keeps the RPC budget small and avoids duplicating work that rational searchers already do locally.

### AuctionManager

```typescript
// auction/types.ts (paraphrased)
interface AuctionState {
  hintId: string;
  intent: SwapIntent;
  market: AuctionMarketContext;
  bids: SearcherBid[];
  status: "open" | "closed" | "settled" | "fallback";
  createdAt: number;
  resolve: (bidsByCashbackDesc: SearcherBid[]) => void;
}
```

- `startAuction(intent, market)` → `{ hintId, resolved: Promise<SearcherBid[]> }`
  - Generates UUID `hintId`, stores `AuctionState` in a Map
  - Broadcasts hint via `SearcherWsRegistry`
  - `setTimeout(closeAuction, AUCTION_WINDOW_MS)`
- `submitBid(hintId, bid)` → void (throws if unknown or already closed)
- On `closeAuction`: sort bids desc by `userCashbackLamports`, tie-break by `receivedAt`, resolve and delete the state

### Bundle orchestration

`orchestrateSwap` in [relay/src/bundle/orchestrator.ts](relay/src/bundle/orchestrator.ts):

- `bids.length === 0` → submit the user-signed Jupiter swap via plain RPC, return `{ status: "fallback", txSignature }`
- Otherwise walk up to 3 candidates:
  - Call `buildJitoBundle` (which runs Tier-2 sim + builds Tx3 internally)
  - On `BundleValidationError` (stage `backrun` or `settle_build`) → try next candidate
  - On success → `submitBundle`, then `pollBundleStatus`
  - Statuses: `landed` (return), `timeout` (return), `failed` (try next)
- Callbacks `onBeforeBundleSubmit` and `onBundleSubmitted` let the caller register pending state in `PendingCashbackRegistry` and emit early frontend events before the on-chain log fires (the validator commits faster than the JS round-trip)

### Indexer

`startCashbackIndexer` in [relay/src/indexer/cashback.ts](relay/src/indexer/cashback.ts) subscribes to program logs via the Solana RPC subscriptions client, parses `CashbackSettled` (Anchor 8-byte event discriminator) from program logs, writes a row to `cashback_events`, and emits `cashback_confirmed` on the corresponding `/status` channel via `UserStatusEmitter`.

---

## Database schema (Drizzle)

```typescript
// relay/src/db/schema.ts

export const auctions = pgTable("auctions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hintId: text("hint_id").notNull().unique(),
  userPubkey: text("user_pubkey").notNull(),
  inputMint: text("input_mint").notNull(),
  outputMint: text("output_mint").notNull(),
  inputAmountLamports: bigint("input_amount_lamports", { mode: "bigint" }).notNull(),
  sizeBucket: text("size_bucket").notNull(),
  winnerPubkey: text("winner_pubkey"),
  winningBidLamports: bigint("winning_bid_lamports", { mode: "bigint" }),
  totalBids: integer("total_bids").notNull().default(0),
  bundleId: text("bundle_id"),
  status: text("status").notNull(), // 'won' | 'no_bids' | 'fallback' | 'failed'
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
});

export const cashbackEvents = pgTable("cashback_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  txSignature: text("tx_signature").notNull().unique(),
  userPubkey: text("user_pubkey").notNull(),
  searcherPubkey: text("searcher_pubkey").notNull(),
  bidAmountLamports: bigint("bid_amount_lamports", { mode: "bigint" }).notNull(),
  cashbackLamports: bigint("cashback_lamports", { mode: "bigint" }).notNull(),
  protocolFeeLamports: bigint("protocol_fee_lamports", { mode: "bigint" }).notNull(),
  auctionId: uuid("auction_id").references(() => auctions.id),
  timestamp: timestamp("timestamp").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow(),
});

export const searchers = pgTable("searchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  pubkey: text("pubkey").notNull().unique(),
  registeredAt: timestamp("registered_at").defaultNow(),
  totalBidsSubmitted: integer("total_bids_submitted").notNull().default(0),
  totalBidsWon: integer("total_bids_won").notNull().default(0),
  totalCashbackPaidLamports: bigint("total_cashback_paid_lamports", { mode: "bigint" }).notNull().default(sql`0`),
  lastSeenAt: timestamp("last_seen_at"),
});

export const waitlistSignups = pgTable("waitlist_signups", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Services that touch the DB:
- `history.service.ts` — reads from `cashbackEvents` joined with `auctions`
- `mev-analysis.service.ts` — read-mostly, occasional auction/cashback joins for FlowBack-vs-MEV deltas
- `waitlist.service.ts` — inserts into `waitlistSignups`
- `pending-cashback.ts` — in-memory only; the indexer writes to `cashbackEvents`
- `ws/searcher.ts` — upserts `searchers.lastSeenAt` on auth

---

## Frontend (Next.js)

**Stack**: Next.js 16 (App Router), React 19, Tailwind 4, shadcn-style primitives, `@base-ui/react`, `lucide-react`, `@tanstack/react-virtual`, `@solana/wallet-adapter-react`/`-react-ui`/`-wallets`.

### Routes

- `/` — landing page (`landing-page.tsx`, hero + marketing `sections/`)
- `/swap` — swap interface (`swap-card.tsx`)
- `/analyzer` — MEV analyzer (`mev-analyzer.tsx` input + `mev-dashboard.tsx` results)

### Key components (all under `client/src/components/flowback/`)

`swap-card.tsx` — main swap interface
- Debounced `fetchQuote` on token/amount change
- Shows Jupiter route, price impact, estimated cashback range
- On submit: `prepareSwap` → user signs intent message via `signMessage` (NOT `signTransaction`) → `submitIntent` → subscribes to `/status` via `subscribeToAuctionStatus`
- On `cashback_confirmed`: shows `CashbackToast`

`cashback-toast.tsx` — green slide-in notification
- Shows received cashback amount and links to the Solana explorer

`mev-analyzer.tsx` — analyzer input
- Wallet address input, fetch trigger, loading and error states

`mev-dashboard.tsx` — analyzer results
- Stat cards: total swaps, MEV loss (SOL + USD), affected swaps, estimated cashback
- Virtualized swap list (`@tanstack/react-virtual`) with tab filtering: all / sandwiched / frontrun / backrun / clean
- Sparkline of cumulative loss over time
- Evidence panels showing frontrun → your swap → backrun
- Top token pairs by loss

`nav.tsx` — navigation with theme toggle, wallet connect, and route links

### Intent signing

The user signs a message, not a transaction. This is critical — they don't pay any SOL for the signing step, and it feels instant.

```typescript
const intentMessage = JSON.stringify({
  user: publicKey.toString(),
  inputMint,
  outputMint,
  inputAmount: inputAmount.toString(),
  minOutputAmount: minOutputAmount.toString(),
  maxSlippageBps,
  deadline: Math.floor(Date.now() / 1000) + 30,
  nonce: crypto.randomUUID(),
});

const signature = await signMessage(new TextEncoder().encode(intentMessage));
```

### API client

`client/src/lib/flowback-relay.ts` exports:
- `fetchQuote(direction, amount)` — quote + cashback estimate
- `prepareSwap(...)` — pre-flight intent validation, returns prepare id
- `submitIntent(...)` — submit signed intent
- `subscribeToAuctionStatus(auctionId, handlers)` — open `/status` WS
- `fetchMevAnalysis(wallet, options)` — analyzer data
- `TOKENS` (mint registry), `RelayRequestError`, types (`MevAnalysisResult`, `AnalyzedSwap`, `MevType`, etc.)

---

## SDK, seed bot, scripts, docs

### `sdk/`

Searcher-facing TypeScript SDK. Exposes a `FlowBackSearcher` class that handles `/searcher` WS auth, hint subscription, and bid submission. Used by `seed-bot/` and external searchers.

### `seed-bot/`

A standalone Node.js process that acts as the guaranteed searcher for the demo.
- Connects to relay `/searcher` WS
- Pre-deposited escrow PDA on devnet
- Bids a small amount on every hint (`estimatedCashback = priceImpactBps * inputAmountEstimate * 0.003`)
- Uses the SDK; kept dead simple — no real arb logic

### `scripts/`

TypeScript dev utilities runnable via `pnpm tsx scripts/<name>.ts`:

- `init-protocol.ts` — call `initialize` on the Anchor program (authority key required)
- `demo-setup.ts` — set up demo state (treasury wallet, seed-bot escrow funding)
- `send-intent.ts` — submit a sample intent end-to-end for manual testing
- `searcher-bot.ts` — programmable searcher harness for tests and scripted scenarios
- `verify-reimbursement.ts` — reconcile on-chain `CashbackSettled` events against `cashback_events` table
- `lib/util.ts` — shared helpers
- `keys/` — pre-funded devnet keypairs (treasury, relay, seed-bot)

### `docs/`

Standalone Next.js documentation site with its own `package.json` and build pipeline. Hosts user-facing documentation, searcher integration guide, and protocol spec.

---

## Bundle construction (critical details)

### Transaction order in bundle (MUST be in this order)

```
Tx1: User Jupiter swap
  - Jupiter swap instructions (fetched via Jupiter Build API /swap-instructions)
  - jitodontfront public key included as a read account
  - Signed by: user (their /prepare-signed v0 tx)
  - Fee payer: relay wallet

Tx2: Searcher backrun arb trade
  - Provided by winning searcher as part of their bid
  - Signed by: searcher
  - Must not touch user's accounts

Tx3: Settlement (built by relay, signed by relay)
  - Instruction 0: Ed25519 sigverify precompile (single-sig layout) carrying:
      pubkey  = searcher
      message = "flowback-bid:<hex hintId>:<decimal bid_amount>"
      sig     = bidCommitmentSig from the WS bid envelope
  - Instruction 1: settle_from_escrow(bid_amount, user, hint_id)
      Accounts: relay_payer, escrow PDA, config PDA, user, treasury,
                used_hint PDA, instructions sysvar, system program
  - Signed by: relay (fee payer)

Tx4: Jito tip
  - Simple SOL transfer to a Jito tip account
  - Amount: searcher's jitoTipLamports from their bid
  - Signed by: searcher
```

### Why the user signs a message, not a transaction

The relay constructs Tx1 after the auction. At intent-submission time, the relay doesn't yet know which searcher will win, so it can't finalize the bundle. The user's signed intent serves as authorization — the relay uses it (along with the `/prepare`-stored Jupiter v0 tx) to assemble Tx1 with the relay wallet as fee payer. The user signs once (the intent) and never has to touch their wallet again.

### `jitodontfront`

Any public key whose base58 form starts with `jitodontfront` must be included as a non-signer, non-writable account in Tx1. This signals to Jito's Block Engine to reject any bundle that places a transaction before Tx1 in the same block.

---

## Jupiter integration

Use Jupiter's **Swap Instructions API** (`/swap-instructions`), not the `/swap` endpoint, so we can add the `jitodontfront` account and control v0 transaction structure (ALTs).

```typescript
// Quote
const quote = await fetch(
  `${JUPITER_BUILD_API_URL}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`,
  { headers: { "x-api-key": JUPITER_API_KEY } },
);

// Instructions
const { swapInstruction, addressLookupTableAddresses } = await fetch(
  `${JUPITER_BUILD_API_URL}/swap-instructions`,
  {
    method: "POST",
    headers: { "x-api-key": JUPITER_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: userPubkey, wrapAndUnwrapSol: true }),
  },
);
```

Jupiter routes typically use Address Lookup Tables. Tx1 must be a v0 `VersionedTransaction` that includes the ALT addresses. `JUPITER_DEXES` (CSV) and `JUPITER_DIRECT_ROUTES` (bool) env vars constrain routing when needed.

---

## Jito integration

Use `@jito-labs/jito-ts` for bundle submission. Devnet Block Engine URL: `https://dallas.devnet.block-engine.jito.wtf`.

Bundle submission returns a UUID; `submitter.ts` polls `getBundleStatuses([bundleId])` with terminal states `landed`, `failed`, or `timeout`. Once `landed`, the indexer picks up the `CashbackSettled` event from program logs.

Real-time event indexing uses Solana RPC subscriptions (`createSolanaRpcSubscriptions(SOLANA_RPC_WS_URL)`) to stream FlowBack program logs and parse the Anchor 8-byte event discriminator for `CashbackSettled`.

---

## Dev commands

Each directory is independent — `cd` into it and run commands directly.

```bash
# Anchor
cd anchor/flowback && anchor build
cd anchor/flowback && anchor test
cd anchor/flowback && anchor deploy --provider.cluster devnet

# Relay
cd relay && pnpm install
cd relay && pnpm dev
cd relay && pnpm db:push      # push schema to postgres
cd relay && pnpm db:studio    # drizzle studio

# Frontend
cd client && pnpm install
cd client && pnpm dev

# SDK
cd sdk && pnpm install && pnpm build

# Seed bot
cd seed-bot && pnpm install
cd seed-bot && pnpm dev

# Scripts (run any TS file via tsx)
cd scripts && pnpm install
cd scripts && pnpm tsx init-protocol.ts
cd scripts && pnpm tsx send-intent.ts

# Docs site
cd docs && pnpm install && pnpm dev
```

---

## Key external dependencies

```
Anchor program:    anchor-lang
Relay:             @solana/kit, @solana/web3.js, jito-ts, uWebSockets.js,
                   express, cors, drizzle-orm, postgres, ioredis,
                   @arcjet/node, dotenv
Frontend:          @solana/wallet-adapter-base, -react, -react-ui, -wallets,
                   @solana/web3.js, next, react, tailwindcss,
                   @base-ui/react, lucide-react, @tanstack/react-virtual,
                   class-variance-authority, tailwind-merge
SDK / seed-bot:    @solana/kit, ws, tweetnacl
Scripts:           @solana/kit, @solana/web3.js, tsx
```
