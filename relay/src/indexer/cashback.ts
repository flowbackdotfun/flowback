import bs58 from "bs58";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "../db/client.js";
import { auctions, cashbackEvents } from "../db/schema.js";
import {
  type CashbackSettledEvent,
  decodeCashbackSettled,
} from "../geyser/cashback-event.js";
import {
  buildProgramTxRequest,
  type GeyserSource,
  type GeyserSubscription,
  type SubscribeUpdate,
} from "../geyser/types.js";
import type { PendingCashbackRegistry } from "../services/pending-cashback.js";
import type { UserStatusEmitter } from "../ws/user.js";

type Db = typeof defaultDb;

export interface CashbackIndexerDeps {
  source: GeyserSource;
  programId: string;
  emitter: UserStatusEmitter;
  pendingCashbacks: PendingCashbackRegistry;
  db?: Db;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// A stream that stayed open at least this long is treated as healthy: the next
// reconnect restarts from the base delay rather than an inflated backoff.
const STABLE_CONNECTION_MS = 30_000;

/**
 * Start indexing on-chain `CashbackSettled` events off a `GeyserSource`.
 * Returns a function that aborts the indexer (stops the reconnect loop and
 * closes the active subscription).
 */
export function startCashbackIndexer(deps: CashbackIndexerDeps): () => void {
  const abort = new AbortController();
  void runIndexer(deps, abort.signal);
  return () => abort.abort();
}

/**
 * Subscribe to the geyser stream and process updates, reconnecting with
 * exponential backoff whenever the stream errors or ends. Unlike the previous
 * RPC-subscription indexer, a dropped connection no longer silently kills
 * indexing — it reconnects until aborted.
 */
async function runIndexer(
  deps: CashbackIndexerDeps,
  signal: AbortSignal,
): Promise<void> {
  const db = deps.db ?? defaultDb;
  const request = buildProgramTxRequest(deps.programId);
  let backoff = RECONNECT_BASE_MS;

  while (!signal.aborted) {
    const startedAt = Date.now();
    let subscription: GeyserSubscription | undefined;

    try {
      subscription = await deps.source.subscribe(request);
      const active = subscription;
      const onAbort = () => active.close();
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        for await (const update of active.updates) {
          if (signal.aborted) break;
          await handleUpdate(db, deps, update);
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      if (!signal.aborted) console.error("[indexer] geyser stream error:", err);
    } finally {
      subscription?.close();
    }

    if (signal.aborted) return;

    if (Date.now() - startedAt > STABLE_CONNECTION_MS) {
      backoff = RECONNECT_BASE_MS;
    }
    console.warn(
      `[indexer] geyser stream closed; reconnecting in ${backoff}ms`,
    );
    await delay(backoff, signal);
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
  }
}

/**
 * Inspect one geyser update. Only confirmed, non-failed transactions carrying
 * a `CashbackSettled` log are acted on; everything else is ignored.
 */
async function handleUpdate(
  db: Db,
  deps: CashbackIndexerDeps,
  update: SubscribeUpdate,
): Promise<void> {
  const info = update.transaction?.transaction;
  if (!info) return;
  if (info.meta?.err) return;

  const logs = info.meta?.logMessages;
  if (!logs || logs.length === 0) return;

  const event = decodeCashbackSettled(logs);
  if (!event) return;

  const signature = bs58.encode(info.signature);
  await handleEvent(db, deps.emitter, deps.pendingCashbacks, signature, event);
}

async function handleEvent(
  db: Db,
  emitter: UserStatusEmitter,
  pendingCashbacks: PendingCashbackRegistry,
  signature: string,
  event: CashbackSettledEvent,
): Promise<void> {
  // Resolve hintId via the in-memory registry the relay populated when it
  // submitted the bundle. The on-chain event carries no hint_id, so without
  // this we'd have to guess from (user, searcher, bidAmount) by querying the
  // DB — which (a) races with persistAuction and (b) is ambiguous when the
  // same searcher won a recent prior auction for the same user.
  const pending = pendingCashbacks.take(
    event.user,
    event.searcher,
    event.bidAmountLamports,
  );

  if (pending) {
    emitter.emitCashbackConfirmed(
      pending.hintId,
      event.userCashbackLamports,
      signature,
    );
  } else {
    console.warn("[indexer] CashbackSettled with no pending registry entry", {
      signature,
      user: event.user,
      searcher: event.searcher,
      bidAmountLamports: event.bidAmountLamports.toString(),
    });
  }

  // Persist for /history. Best-effort: a failure here doesn't affect the WS
  // subscriber, which already settled above.
  try {
    const auctionId = await resolveAuctionId(db, pending?.hintId);
    await db
      .insert(cashbackEvents)
      .values({
        txSignature: signature,
        userPubkey: event.user,
        searcherPubkey: event.searcher,
        bidAmountLamports: event.bidAmountLamports,
        cashbackLamports: event.userCashbackLamports,
        protocolFeeLamports: event.protocolFeeLamports,
        auctionId,
        timestamp: new Date(Number(event.timestamp) * 1000),
      })
      .onConflictDoNothing();

    console.log("[indexer] CashbackSettled:", {
      signature,
      user: event.user,
      cashbackLamports: event.userCashbackLamports.toString(),
      protocolFeeLamports: event.protocolFeeLamports.toString(),
      hintId: pending?.hintId ?? null,
    });
  } catch (err) {
    console.error("[indexer] failed to persist CashbackSettled:", {
      signature,
      err,
    });
  }
}

async function resolveAuctionId(
  db: Db,
  hintId: string | undefined,
): Promise<string | null> {
  if (!hintId) return null;
  const rows = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(eq(auctions.hintId, hintId))
    .limit(1);
  return rows[0]?.id ?? null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: NodeJS.Timeout;
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
