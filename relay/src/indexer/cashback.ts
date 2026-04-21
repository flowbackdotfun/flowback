import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { createSolanaRpcSubscriptions } from "@solana/kit";
import { eq, and, gt, desc } from "drizzle-orm";

import { db as defaultDb } from "../db/client.js";
import { auctions, cashbackEvents } from "../db/schema.js";
import type { UserStatusEmitter } from "../ws/user.js";

type RpcSubscriptions = ReturnType<typeof createSolanaRpcSubscriptions>;
type Db = typeof defaultDb;

export interface CashbackIndexerDeps {
  rpcSubscriptions: RpcSubscriptions;
  programId: string;
  emitter: UserStatusEmitter;
  db?: Db;
}

// Anchor event discriminator: sha256("event:CashbackSettled")[0..8]
const EVENT_DISCRIMINATOR = createHash("sha256")
  .update("event:CashbackSettled")
  .digest()
  .subarray(0, 8);

// Fixed event payload size: 8 disc + 32 user + 32 searcher + 8 bid + 8 cashback + 8 fee + 8 ts
const EVENT_BYTE_LENGTH = 104;

// Look back 5 minutes when matching an event to an auction row
const AUCTION_LOOKUP_WINDOW_MS = 5 * 60 * 1000;

export function startCashbackIndexer(deps: CashbackIndexerDeps): () => void {
  const abort = new AbortController();
  void runSubscription(deps, abort.signal);
  return () => abort.abort();
}

async function runSubscription(
  deps: CashbackIndexerDeps,
  signal: AbortSignal,
): Promise<void> {
  const db = deps.db ?? defaultDb;

  try {
    const subscription = await deps.rpcSubscriptions
      .logsNotifications(
        { mentions: [deps.programId as Parameters<typeof deps.rpcSubscriptions.logsNotifications>[0]["mentions"][0]] },
        { commitment: "confirmed" },
      )
      .subscribe({ abortSignal: signal });

    for await (const notification of subscription) {
      const { signature, logs, err } = notification.value;
      if (err) continue;

      const event = parseCashbackSettledEvent(logs);
      if (!event) continue;

      await handleEvent(db, deps.emitter, signature, event);
    }
  } catch (err) {
    if (!signal.aborted) {
      console.error("[indexer] subscription error:", err);
    }
  }
}

interface CashbackSettledEvent {
  user: string;
  searcher: string;
  bidAmountLamports: bigint;
  userCashbackLamports: bigint;
  protocolFeeLamports: bigint;
  timestamp: bigint;
}

async function handleEvent(
  db: Db,
  emitter: UserStatusEmitter,
  signature: string,
  event: CashbackSettledEvent,
): Promise<void> {
  try {
    const auction = await lookupAuction(db, event.user, event.searcher);

    await db.insert(cashbackEvents).values({
      txSignature: signature,
      userPubkey: event.user,
      searcherPubkey: event.searcher,
      bidAmountLamports: event.bidAmountLamports,
      cashbackLamports: event.userCashbackLamports,
      protocolFeeLamports: event.protocolFeeLamports,
      auctionId: auction?.id ?? null,
      timestamp: new Date(Number(event.timestamp) * 1000),
    }).onConflictDoNothing();

    if (auction) {
      emitter.emitCashbackConfirmed(
        auction.hintId,
        event.userCashbackLamports,
        signature,
      );
    }

    console.log("[indexer] CashbackSettled:", {
      signature,
      user: event.user,
      cashbackLamports: event.userCashbackLamports.toString(),
      protocolFeeLamports: event.protocolFeeLamports.toString(),
      auctionId: auction?.id ?? null,
    });
  } catch (err) {
    console.error("[indexer] failed to handle CashbackSettled:", { signature, err });
  }
}

async function lookupAuction(
  db: Db,
  userPubkey: string,
  searcherPubkey: string,
): Promise<{ id: string; hintId: string } | null> {
  const cutoff = new Date(Date.now() - AUCTION_LOOKUP_WINDOW_MS);

  const rows = await db
    .select({ id: auctions.id, hintId: auctions.hintId })
    .from(auctions)
    .where(
      and(
        eq(auctions.userPubkey, userPubkey),
        eq(auctions.winnerPubkey, searcherPubkey),
        gt(auctions.settledAt, cutoff),
      ),
    )
    .orderBy(desc(auctions.settledAt))
    .limit(1);

  return rows[0] ?? null;
}

function parseCashbackSettledEvent(
  logs: readonly string[],
): CashbackSettledEvent | null {
  for (const log of logs) {
    if (!log.startsWith("Program data: ")) continue;

    let bytes: Buffer;
    try {
      bytes = Buffer.from(log.slice("Program data: ".length), "base64");
    } catch {
      continue;
    }

    if (bytes.length !== EVENT_BYTE_LENGTH) continue;
    if (!matchesDiscriminator(bytes)) continue;

    return decodeEvent(bytes);
  }

  return null;
}

function matchesDiscriminator(bytes: Buffer): boolean {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== EVENT_DISCRIMINATOR[i]) return false;
  }
  return true;
}

function decodeEvent(bytes: Buffer): CashbackSettledEvent {
  let offset = 8; // skip discriminator

  const user = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
  offset += 32;

  const searcher = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
  offset += 32;

  const bidAmountLamports = bytes.readBigUInt64LE(offset);
  offset += 8;

  const userCashbackLamports = bytes.readBigUInt64LE(offset);
  offset += 8;

  const protocolFeeLamports = bytes.readBigUInt64LE(offset);
  offset += 8;

  const timestamp = bytes.readBigInt64LE(offset);

  return {
    user,
    searcher,
    bidAmountLamports,
    userCashbackLamports,
    protocolFeeLamports,
    timestamp,
  };
}
