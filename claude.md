# FlowBack — CLAUDE.md

## What this project is

FlowBack is a Solana swap router that runs a sealed-bid backrun auction before every swap lands on-chain. Instead of MEV searchers silently profiting off a user's trade, they must compete in a 200ms auction for the exclusive right to backrun it. The auction winner pays 90% of their bid directly to the user as cashback via an on-chain Anchor program. The user gets the same Jupiter-routed swap output they would have gotten normally, plus SOL back in their wallet.

This is the Solana equivalent of Flashbots MEV-Share on Ethereum. That system exists and works. This does not exist on Solana yet.

Built for the Colosseum Frontier hackathon. 4-week sprint.

---

## Project structure

Each directory is standalone with its own `package.json` and dependencies. No monorepo tooling, no workspaces, no Turborepo. Install and run each package independently.

```
flowback/
├── anchor/                    Rust/Anchor on-chain program
│   ├── programs/flowback/
│   │   └── src/lib.rs         Main program entry point
│   ├── tests/                 Anchor integration tests (TypeScript)
│   └── Anchor.toml
│
├── relay/                     Off-chain auction relay server
│   ├── src/
│   │   ├── index.ts           Express + uWS server entry
│   │   ├── auction/
│   │   │   ├── manager.ts     AuctionManager class
│   │   │   ├── types.ts       SwapIntent, SearcherHint, SearcherBid
│   │   │   └── validator.ts   Bid validation + backrun tx simulation
│   │   ├── bundle/
│   │   │   ├── constructor.ts JitoBundle construction
│   │   │   └── submitter.ts   Jito Block Engine submission
│   │   ├── jupiter/
│   │   │   └── client.ts      Jupiter quote + swap instructions
│   │   ├── db/
│   │   │   ├── schema.ts      Drizzle schema
│   │   │   └── client.ts      Drizzle client
│   │   ├── ws/
│   │   │   ├── searcher.ts    uWS searcher connection handler
│   │   │   └── user.ts        uWS user status connection handler
│   │   └── routes/
│   │       ├── quote.ts       GET /quote
│   │       ├── intent.ts      POST /intent
│   │       └── history.ts     GET /history/:wallet
│   └── package.json
│
├── client/                    Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx       Swap interface
│   │   │   └── calculator/
│   │   │       └── page.tsx   MEV cost calculator
│   │   ├── components/
│   │   │   ├── SwapCard.tsx
│   │   │   ├── CashbackToast.tsx
│   │   │   └── MevCalculator.tsx
│   │   └── lib/
│   │       ├── relay.ts       Relay API client
│   │       └── wallet.ts      Solana wallet adapter setup
│   └── package.json
│
├── sdk/                       Searcher-facing TypeScript SDK
│   ├── src/
│   │   ├── index.ts           FlowBackSearcher class
│   │   └── types.ts
│   └── package.json
│
├── seed-bot/                  Internal seed searcher bot (guarantees demo cashback)
│   ├── src/
│   │   └── index.ts
│   └── package.json
│
└── CLAUDE.md                  This file
```

---

## Critical system understanding

### The happy path (auction has bids)

1. User opens app, connects Phantom wallet
2. User enters swap (e.g. 2 SOL → USDC)
3. Frontend calls `GET /quote` on relay → relay calls Jupiter v6 API → returns quote + cashback estimate
4. User clicks swap, signs an **intent message** (NOT a transaction) in their wallet
5. Frontend POSTs signed intent to `POST /intent` on relay
6. Relay validates the intent signature using `@solana/kit`
7. Relay broadcasts a **hint** to all connected searchers via uWS WebSocket:
   - Reveals: token pair, size bucket (small/medium/large/whale), estimated price impact bps
   - Hides: exact amount, user wallet address
8. Auction runs for **200ms**. Searchers submit bids (cashback lamports + backrun tx + jito tip)
9. Relay picks winner = highest `userCashbackLamports`
10. Relay validates winner's backrun tx by simulating against devnet RPC
11. Relay constructs Jito bundle (4 transactions in order):
    - Tx1: User's Jupiter swap (with `jitodontfront` account included)
    - Tx2: Searcher's backrun arb trade
    - Tx3: Searcher calls `settle_cashback` on FlowBack Anchor program
    - Tx4: Searcher's Jito tip transfer
12. Bundle submitted to Jito Block Engine
13. Bundle lands on-chain. Anchor program splits cashback: 90% → user, 10% → treasury
14. Relay indexes the `CashbackSettled` on-chain event
15. Frontend receives real-time WebSocket notification: cashback confirmed

### The fallback path (zero bids)

After 200ms with no bids, relay submits the user's Jupiter swap as a normal transaction directly via RPC. No bundle, no cashback, no worse execution than going to Jupiter directly. UI shows "Swap complete — no cashback this trade."

### Why `jitodontfront` matters

Including the `jitodontfront` public key as an account in Tx1 tells Jito's Block Engine to reject any bundle that places a transaction before Tx1 in the same block. This eliminates sandwich attacks within Jito infrastructure. The user gets sandwich protection AND cashback simultaneously.

---

## On-chain program (Anchor)

**Program ID**: generated at deploy time, stored in `anchor/Anchor.toml` and `relay/.env`

### Instructions

#### `initialize`

- Called once at deployment by the authority wallet
- Stores: `protocol_fee_bps: u16` (1000 = 10%), `treasury: Pubkey`, `paused: bool`
- Account: `ProtocolConfig` PDA seeded with `[b"config"]`

#### `settle_cashback`

- Called by the winning searcher inside the Jito bundle (Tx3)
- Args: `bid_amount: u64`, `user: Pubkey`
- Splits: `user_share = bid_amount * (10000 - protocol_fee_bps) / 10000`
- Does two System Program CPI transfers: bid_amount → user, remainder → treasury
- Emits: `CashbackSettled { user, searcher, bid_amount, user_cashback, protocol_fee, timestamp }`
- Searcher must be the transaction signer
- If `paused == true`, instruction fails with `ProtocolPaused` error

#### `update_config`

- Authority-only
- Can update `protocol_fee_bps`, `treasury`, `paused`

### Accounts

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
```

### Security constraints

- `settle_cashback` has NO constraint on minimum bid amount (searcher paid what they bid)
- `settle_cashback` DOES verify the `user` account matches the pubkey passed as arg
- Treasury account is stored in config, not passed as an arg (prevents treasury spoofing)

---

## Relay server

**Runtime**: Node.js 20+, TypeScript, tsx for dev
**Framework**: Express for REST, uWebSockets.js for WebSocket
**Port**: 3001

### Environment variables (relay/.env)

```
DATABASE_URL=postgresql://...
SOLANA_RPC_URL=https://api.devnet.solana.com
JITO_BLOCK_ENGINE_URL=https://frankfurt.mainnet.block-engine.jito.wtf  # use devnet equivalent
JUPITER_API_URL=https://quote-api.jup.ag/v6                             # preview /quote (no auth)
JUPITER_BUILD_API_URL=https://api.jup.ag/swap/v2                        # post-auction /build (x-api-key)
JUPITER_API_KEY=<jupiter api key>                                       # required for /build
FLOWBACK_PROGRAM_ID=<deployed program id>
TREASURY_WALLET=<base58 pubkey>
RELAY_KEYPAIR=<base58 encoded keypair JSON>  # relay pays tx fees
AUCTION_WINDOW_MS=200
PROTOCOL_FEE_BPS=1000
```

### REST endpoints

`GET /quote?inputMint=&outputMint=&amount=&slippageBps=`

- Calls Jupiter /quote
- Returns Jupiter quote + cashback estimate (based on recent auction history from DB)
- Cashback estimate: p50 of last 50 auctions for same pair+bucket, or null if no history

`POST /intent`

- Body: `{ user, inputMint, outputMint, inputAmount, minOutputAmount, maxSlippageBps, deadline, nonce, signature }`
- Validates signature
- Triggers auction
- Returns `{ auctionId, status: "pending" }`
- Frontend then listens on WebSocket for auction result

`GET /history/:walletAddress`

- Returns cashback history for a wallet from the DB
- Used by the MEV calculator page

### WebSocket protocol (uWS)

Two separate WebSocket paths:

`/searcher` — for searcher bots

- On connect: bot sends `{ type: "auth", pubkey, signature }` — signature proves ownership of pubkey
- Server sends: `{ type: "hint", hintId, tokenPair, sizeBucket, priceImpactBps, auctionDeadlineMs }`
- Client sends: `{ type: "bid", hintId, userCashbackLamports, jitoTipLamports, backrunTx, cashbackTx, tipTx }` — all three txs pre-signed by the searcher, base64 encoded
- After auction: server sends `{ type: "auction_result", hintId, won: bool, yourBid, winningBid }`

Why all three pre-signed: the searcher constructs and signs Tx2 (backrun), Tx3 (`settle_cashback`), and Tx4 (Jito tip) themselves. The relay only prepends Tx1 (the user's Jupiter swap) after picking a winner. This avoids a post-close WS round-trip to collect Tx3's signature and fits the Jito bundle pattern. The relay MUST decode Tx3 before accepting the bid and verify semantic correctness (see below).

### Bid validation (two tiers)

**Tier 1 — in-window, on bid receipt** (cheap, no RPC):

- Decode `cashbackTx`, locate the `settle_cashback` instruction, verify:
  - `programId` equals the deployed FlowBack program ID
  - 8-byte Anchor discriminator matches `sha256("global:settle_cashback")[0..8]`
  - `bid_amount` arg (u64 LE) equals `userCashbackLamports` from the bid message
  - `user` account equals `intent.user`
  - `treasury` account equals the protocol config's treasury
- Reject bid if any check fails. This is the critical defense against a searcher declaring a big cashback in the WS bid message but embedding a tiny `bid_amount` in Tx3 to shortchange the user.

**Tier 2 — post-close, winner only** (expensive, hits RPC):

- After the 200ms window closes and bids are sorted by `userCashbackLamports` descending, iterate from the top:
  - Call `simulateTransaction` on the winner's `backrunTx` with `replaceRecentBlockhash: true` and a 1000ms timeout
  - If it returns no error → use this winner, build the bundle, submit
  - If it fails → drop this bid, try the next-highest, repeat up to 3 candidates
- Simulation is only run on the prospective winner(s), never on losing bids. This keeps the RPC budget small and avoids duplicating work that rational searchers already do locally.

`/status` — for frontend

- On connect: client sends `{ type: "subscribe", auctionId }`
- Server sends: `{ type: "bundle_submitted", auctionId, bundleId }`
- Server sends: `{ type: "cashback_confirmed", auctionId, cashbackLamports, txSignature }`
- Server sends: `{ type: "fallback_executed", auctionId, txSignature }` (no bids case)

### AuctionManager

```typescript
// Core data structure
interface AuctionState {
  hintId: string;
  intent: SwapIntent;
  jupiterQuote: JupiterQuote;
  bids: SearcherBid[];
  status: "open" | "closed" | "settled" | "fallback";
  createdAt: number;
  resolve: (winner: SearcherBid | null) => void;
}
```

- `startAuction(intent, jupiterQuote)` → returns Promise<SearcherBid | null>
  - Creates AuctionState, stores in Map
  - Broadcasts hint to all connected searchers
  - Sets 200ms timeout that calls resolve(winner)
  - Resolve picks highest userCashbackLamports bid
- `submitBid(hintId, bid)` → void
  - Validates hintId exists and auction is still open
  - Validates bid has valid backrun tx (simulate against RPC)
  - Pushes bid to AuctionState.bids
- On auction close: if bids.length === 0, resolve(null) → fallback path

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
  inputAmountLamports: bigint("input_amount_lamports", {
    mode: "bigint",
  }).notNull(),
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
  bidAmountLamports: bigint("bid_amount_lamports", {
    mode: "bigint",
  }).notNull(),
  cashbackLamports: bigint("cashback_lamports", { mode: "bigint" }).notNull(),
  protocolFeeLamports: bigint("protocol_fee_lamports", {
    mode: "bigint",
  }).notNull(),
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
  totalCashbackPaidLamports: bigint("total_cashback_paid_lamports", {
    mode: "bigint",
  })
    .notNull()
    .default(0n),
  lastSeenAt: timestamp("last_seen_at"),
});
```

---

## Frontend (Next.js)

**Framework**: Next.js 14 app router
**Wallet**: `@solana/wallet-adapter-react` + Phantom + Backpack
**Styling**: Tailwind CSS, Shadcn UI
**RPC**: Helius RPC (for MEV calculator transaction fetching)

### Key components

`SwapCard` — the main swap interface

- Fetches quote from relay `GET /quote` on token/amount change (debounced 300ms)
- Shows Jupiter route, price impact, estimated cashback range
- On submit: calls `signMessage` on wallet adapter (NOT `signTransaction`)
- POSTs signed intent to relay `POST /intent`
- Opens WebSocket to `/status`, subscribes to auctionId
- On `cashback_confirmed`: shows `CashbackToast`

`CashbackToast` — the money shot of the demo

- Green notification that slides in from bottom right
- Shows: "0.0041 SOL cashback received"
- Links to Solana explorer with the tx signature
- Auto-dismisses after 8 seconds

`MevCalculator` — the viral marketing page

- Single text input: wallet address
- Calls relay `GET /history/:wallet` for FlowBack cashback history
- Calls Helius Enhanced Transactions API for historical swap analysis
- Runs sandwich detection heuristic client-side
- Shows: total swaps analyzed, estimated MEV lost, what FlowBack would have returned

### Intent signing

The user signs a message, not a transaction. This is critical — it means they don't pay any SOL for the signing step, and it feels instant.

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

const encodedMessage = new TextEncoder().encode(intentMessage);
const signature = await signMessage(encodedMessage);
```

---

## Seed bot (seed-bot/)

A standalone Node.js process that acts as the guaranteed searcher for the demo.

- Connects to relay WebSocket at `/searcher`
- On every hint received: submits a bid of `estimatedCashback = priceImpactBps * inputAmountEstimate * 0.003`
- Always bids — never skips a hint
- Uses a pre-funded devnet wallet
- Runs as a separate process: `node seed-bot/src/index.js`
- Kept dead simple — no real arb logic, just always bids a small amount

The seed bot exists purely so the demo always shows cashback. External searchers doing real arb is post-hackathon.

---

## Bundle construction (critical details)

### Transaction order in bundle (MUST be in this order)

```
Tx1: User Jupiter swap
  - Jupiter swap instructions (fetched via Jupiter /swap-instructions API)
  - jitodontfront public key included as a read account
  - Signed by: user (via relay holding their signed intent)
  - Fee payer: relay wallet

Tx2: Searcher backrun arb trade
  - Provided by winning searcher as part of their bid
  - Signed by: searcher
  - Must not touch user's accounts

Tx3: Cashback settlement
  - Calls FlowBack program `settle_cashback(bidAmount, userPubkey)`
  - Signed by: searcher (proves they authorized the payment)
  - Accounts: searcher wallet, user wallet, treasury, protocol config PDA, system program

Tx4: Jito tip
  - Simple SOL transfer to Jito tip account
  - Amount: searcher's jitoTipLamports from their bid
  - Signed by: searcher
```

### Why the user signs a message not a transaction

The relay constructs Tx1 after the auction. At intent-submission time, the relay doesn't know which searcher will win, so it can't construct the final transaction yet. The user's signed intent message serves as authorization — the relay uses it to build Tx1 on the user's behalf, with the relay wallet as fee payer. This means the user signs once (the intent) and never has to touch their wallet again.

### jitodontfront

The public key `jitodontfront111111111111111111111111111111` (or any key starting with `jitodontfront`) must be included as a non-signer, non-writable account in Tx1. This signals to Jito's Block Engine to reject any bundle that places a transaction before Tx1.

---

## Jupiter integration

Use Jupiter's **Swap Instructions API** (`/swap-instructions`), not the `/swap` endpoint.

The `/swap` endpoint returns a pre-built serialized transaction. The `/swap-instructions` endpoint returns raw instructions that you can add to your own transaction. This is necessary because you need to add the `jitodontfront` account and control the transaction structure.

```typescript
// GET /quote first
const quote = await fetch(
  `${JUPITER_API_URL}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`,
);

// Then POST /swap-instructions
const { swapInstruction, addressLookupTableAddresses } = await fetch(
  `${JUPITER_API_URL}/swap-instructions`,
  {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: userPubkey,
      wrapAndUnwrapSol: true,
    }),
  },
);
```

Important: Jupiter routes often use Address Lookup Tables (ALTs). Tx1 must be a VersionedTransaction (v0) that includes the ALT addresses. This is why you use `/swap-instructions` — you get the raw instruction and the ALT addresses separately, then construct a v0 transaction manually.

---

## Jito integration

Use `@jito-labs/jito-ts` for bundle submission.

For devnet testing, Jito's Block Engine devnet URL:
`https://dallas.devnet.block-engine.jito.wtf`

Bundle submission returns a bundle UUID. Poll `getBundleStatuses([bundleId])` to check if it landed. Once landed, search for the `CashbackSettled` event in the transaction logs.

The relay must subscribe to on-chain events from the FlowBack program to index cashback settlements in real-time. Use `connection.onLogs(programId, callback)` to stream program logs.

---

## What NOT to build (MVP scope guardrails)

Do NOT build:

- Searcher staking/slashing (just use an allowlist of pubkeys)
- Redis pub/sub (single relay instance is fine)
- Multiple relay instances / load balancing
- Token-2022 support (standard SPL tokens only)
- MEV cascade capture (secondary backruns)
- Mobile app
- Mainnet deployment (devnet only for hackathon)
- Real sandwich detection accuracy (estimates are fine for calculator)

These are all post-hackathon features. Scope creep will kill the demo.

---

## Demo script (the 15-second moment)

1. Open MEV calculator, paste a wallet address with swap history
2. Show "You've lost X SOL to MEV bots in 90 days"
3. Switch to swap interface
4. Connect Phantom wallet (devnet)
5. Enter 2 SOL → USDC swap
6. Show the Jupiter quote + cashback estimate in the UI
7. Click "Swap + earn cashback"
8. Sign the intent message in Phantom (instant, no gas)
9. Watch the relay find a winner (optionally show auction log in terminal)
10. Watch the green cashback toast appear: "0.0041 SOL cashback received"
11. Click the explorer link — show the on-chain `CashbackSettled` event

Total time: ~15 seconds from clicking swap to seeing cashback on-chain.

---

## Dev commands

Each directory is independent — `cd` into it and run commands directly.

```bash
# Anchor
cd anchor && anchor build
cd anchor && anchor test
cd anchor && anchor deploy --provider.cluster devnet

# Relay
cd relay && pnpm install
cd relay && pnpm dev

# Frontend
cd client && pnpm install
cd client && pnpm dev

# Seed bot
cd seed-bot && pnpm install
cd seed-bot && pnpm dev

# Database (from relay/)
cd relay && pnpm db:push      # push schema to postgres
cd relay && pnpm db:studio    # drizzle studio
```

---

## Key external dependencies

```
Anchor program:    anchor-lang = "1.0.0"
Relay:             jito-ts, @solana/kit, uWebSockets.js, drizzle-orm, express
Frontend:          @solana/wallet-adapter-base \
                   @solana/wallet-adapter-react \
                   @solana/wallet-adapter-react-ui \
                   @solana/wallet-adapter-wallets \
                   @solana/kit, next, tailwind, shadcn
Seed bot:          @solana/kit (same ws connection as external searchers)
```
