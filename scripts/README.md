# FlowBack end-to-end test scripts

Three scripts that drive a full auction cycle against a local validator + relay:

- `init-protocol.ts` — runs `initialize` on the deployed program (one-time per validator).
- `searcher-bot.ts` — connects via `@flowback/sdk`, ensures escrow funded, listens for hints, signs bid commitments, submits bids. Runs N copies in parallel for a multi-searcher auction.
- `send-intent.ts` — impersonates a frontend user: `POST /prepare` → sign → `POST /intent`, then listens on the user status WS for the outcome.

All scripts persist their generated keypairs under `scripts/keys/` so subsequent runs reuse the same identities (so escrow PDAs stay valid across restarts).

---

## One-time setup

```bash
cd /home/deep1910/Hacks/Flowback
pnpm --dir sdk install && pnpm --dir sdk build         # SDK must be built so scripts can resolve dist/
pnpm --dir scripts install
```

---

## Run order (six terminals)

### Terminal 1 — local validator

```bash
solana-test-validator --reset
```

### Terminal 2 — postgres (the relay needs a DB)

```bash
# any local postgres works; if you don't have one running:
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=flowback postgres:16
# then in relay/.env: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flowback
```

### Terminal 3 — deploy the Anchor program

```bash
cd anchor/flowback
anchor build --ignore-keys
solana config set --url http://localhost:8899
solana program deploy target/deploy/flowback.so --program-id target/deploy/flowback-keypair.json
```

Note the printed program id and put it in `relay/.env` as `FLOWBACK_PROGRAM_ID` (and `scripts/lib/util.ts`'s `DEFAULT_PROGRAM_ID` if it differs from the hardcoded one).

### Terminal 4 — initialise protocol + run the relay

```bash
# 4a. Initialise (one-time, idempotent)
cd scripts
pnpm init
# Note the printed treasury pubkey — paste into relay/.env as TREASURY_WALLET.

# 4b. Configure relay/.env (minimum):
cat > ../relay/.env <<'EOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flowback
SOLANA_RPC_URL=http://localhost:8899
FLOWBACK_PROGRAM_ID=BLZeEY7GZ5AK6gAZQW5BVi9w71yoJig4Kc97bL1HAnP8
TREASURY_WALLET=<paste from step 4a>
RELAY_KEYPAIR=<paste your CLI keypair JSON array from ~/.config/solana/id.json>
MOCK_JUPITER=true
MOCK_JITO=true
AUCTION_WINDOW_MS=200
PROTOCOL_FEE_BPS=1000
ALLOWED_ORIGIN=http://localhost:3000
REST_PORT=3001
WS_PORT=3002
EOF

# 4c. Start the relay (this also runs the on-chain log indexer in-process)
cd ../relay
pnpm install
pnpm dev
```

You should see: `[relay] http listening on :3001` and `[relay] ws listening on :3002`.

### Terminal 5 — start N searcher bots

```bash
cd scripts

# Three bots in parallel — each lazily inits its own escrow PDA + funds it.
pnpm searcher 0 &
pnpm searcher 1 &
pnpm searcher 2 &
wait
```

Each bot:

1. Generates / loads its keypair from `scripts/keys/searcher-N.json`.
2. Airdrops itself if the local balance is below 4 SOL.
3. Calls `escrow_init` (skipped if PDA exists) and tops up to 2 SOL of usable escrow.
4. Connects to the relay's `/searcher` WS, completes the auth handshake.
5. On every hint, signs a bid commitment and submits a bid with a placeholder memo backrun.

Bid amounts include a per-bot offset + jitter so the winner is deterministic per auction (highest BOT_INDEX usually wins).

### Terminal 6 — fire an intent

```bash
cd scripts
pnpm intent
```

The script will:

1. Hit `POST /prepare` with mock mints (any 32-char base58 — `MOCK_JUPITER=true` swaps in a memo ix).
2. Sign the returned v0 transaction with the user's keypair.
3. Hit `POST /intent` with `{ prepareId, signedTx }`.
4. Subscribe to the user-status WS and log every event until `cashback_confirmed` or `fallback_executed`.

---

## What "success" looks like

In the relay log:

```
[relay] auction <hintId> opened
[relay] auction <hintId>: 3 bids received
[relay] picked winner searcher-2 (1700000 lamports)
[jito-mock] submitBundle → <bundle-uuid> (4 txs)
```

In each searcher log:

```
[searcher-2] ▲ bid    hint=ab12cd34  bid=1700000  in 28ms
[searcher-2] 🏆 WON   hint=ab12cd34  yours=1700000  winning=1700000
```

In the intent log:

```
[intent] ← bundle_submitted { auctionId, bundleId }
[intent] ← cashback_confirmed { auctionId, ... }    # or fallback_executed
```

---

## What this verifies (and what it doesn't)

**Verified end-to-end:**

- User signing → relay ingestion → auction kickoff
- WS auth + hint broadcast to multiple connected searchers
- SDK builds correct bid-commitment signatures that pass the relay's tier-1 Ed25519 verify
- AuctionManager picks the highest bid and resolves on the 200ms timer
- Bundle constructor builds the relay-signed Tx3 (Ed25519 ix + `settle_from_escrow`) without throwing
- Tier-2 simulation runs against the dummy memo backrun
- Mock Jito returns "landed" → user-status WS fires the right events
- Auction result is delivered back to all bidding searchers

**Not verified by this flow** (these need a live Jito Block Engine):

- Actual on-chain settlement: with `MOCK_JITO=true` the bundle never lands. Searcher escrow doesn't get debited; user doesn't get cashback. The on-chain side is already exhaustively covered by `cargo test -p flowback` (litesvm tests), so this is a deliberate split — off-chain flow goes through the scripts, on-chain semantics go through litesvm.
- Real Jupiter routing: `MOCK_JUPITER=true` substitutes a memo ix. Real-route testing requires `MOCK_JUPITER=false` and a Jupiter API key.

---

## Multiple intents in one run

To stress-test the auction loop, run `pnpm intent` repeatedly while the searcher bots stay connected:

```bash
for i in 1 2 3 4 5; do pnpm intent; sleep 1; done
```

Each run uses the same user keypair (so the same escrow / wallet) but a fresh `prepareId` + `hintId`, so the auction's replay protection (per-`hintId` `UsedHint` PDA on-chain) is also exercised — even though the bundle doesn't land in mock mode, the relay's settle-tx construction includes a fresh hint id every time.

---

## Cleanup

```bash
# stop the validator
pkill solana-test-validator

# wipe local-only state (keypairs + ledger)
rm -rf scripts/keys/*.json test-ledger
```

Authority + treasury keypairs at `~/.config/solana/id.json` are NOT deleted by the cleanup above.
