import {
  address,
  createSolanaRpcSubscriptions,
} from "@solana/kit";

import type { UserStatusEmitter } from "../ws/user.js";

type RpcSubscriptions = ReturnType<typeof createSolanaRpcSubscriptions>;

export interface CashbackIndexerDeps {
  rpcSubscriptions: RpcSubscriptions;
  programId: string;
  emitter: UserStatusEmitter;
}

/**
 * Subscribes to program logs and resolves `CashbackSettled` events into
 * `cashback_events` rows + `cashback_confirmed` WS notifications.
 *
 * STATUS: the subscription shell is live; the event parser is a stub.
 * Unblock: once the Anchor program ships `settle_cashback` and the event
 * discriminator is known, implement `parseCashbackSettledEvent` and the
 * (user, searcher) → auctionId lookup. Owned by teammate.
 */
export function startCashbackIndexer(
  deps: CashbackIndexerDeps,
): () => void {
  const abort = new AbortController();
  void runSubscription(deps, abort.signal);
  return () => abort.abort();
}

async function runSubscription(
  deps: CashbackIndexerDeps,
  signal: AbortSignal,
): Promise<void> {
  try {
    const programAddr = address(deps.programId);
    const subscription = await deps.rpcSubscriptions
      .logsNotifications(
        { mentions: [programAddr] },
        { commitment: "confirmed" },
      )
      .subscribe({ abortSignal: signal });

    for await (const notification of subscription) {
      const { signature, logs, err } = notification.value;
      if (err) continue;

      const event = parseCashbackSettledEvent(logs);
      if (!event) continue;

      // TODO(anchor-program): once the program is deployed and we can parse events,
      //   1. look up the auctionId from (user, searcher) + recent time window
      //   2. insert into cashback_events table
      //   3. deps.emitter.emitCashbackConfirmed(auctionId, event.userCashbackLamports, signature)
      console.log("[indexer] CashbackSettled (stub):", { signature, event });
    }
  } catch (err) {
    if (!signal.aborted) {
      console.error("[indexer] subscription error:", err);
    }
  }
}

interface ParsedCashbackSettledEvent {
  user: string;
  searcher: string;
  bidAmountLamports: bigint;
  userCashbackLamports: bigint;
  protocolFeeLamports: bigint;
  timestamp: bigint;
}

/**
 * Anchor emits events as log lines of the form "Program data: <base64>" where
 * the first 8 bytes of the decoded payload are the event discriminator and
 * the remainder is Borsh-encoded event data. This parser is inert until the
 * program is deployed — see file-level STATUS comment.
 */
function parseCashbackSettledEvent(
  _logs: readonly string[],
): ParsedCashbackSettledEvent | null {
  return null;
}
