import "dotenv/config";
import {
  address,
  getAddressEncoder,
  getBase58Encoder,
  signatureBytes as toSignatureBytes,
  verifySignature,
  type Address,
} from "@solana/kit";
import type {
  TemplatedApp,
  WebSocket as UwsWebSocket,
} from "uWebSockets.js";

import type { AuctionManager, SearcherRegistry } from "../auction/manager.js";
import type { SearcherBid, SearcherHint } from "../auction/types.js";
import { validateBidCommitment } from "../auction/validator.js";
import { db as defaultDb } from "../db/client.js";
import { searchers } from "../db/schema.js";

const AUTH_MESSAGE_PREFIX = "flowback-searcher-auth";
const AUTH_MAX_SKEW_MS = 60_000;

type Db = typeof defaultDb;

interface SearcherSocketData {
  pubkey: string | null;
  authenticatedAt: number | null;
}

type SearcherSocket = UwsWebSocket<SearcherSocketData>;

interface AuthMessage {
  type: "auth";
  pubkey: string;
  signature: string; // base58
  timestamp: number; // unix ms
}

interface BidMessage {
  type: "bid";
  hintId: string;
  userCashbackLamports: string;
  jitoTipLamports: string;
  backrunTx: string;
  tipTx: string;
  /** Base58 Ed25519 signature over `flowback-bid:<hex hintId>:<bidAmount>`. */
  bidCommitmentSig: string;
}

type IncomingMessage = AuthMessage | BidMessage;

export interface SearcherWsDeps {
  auctionManager: AuctionManager;
  registry: SearcherWsRegistry;
  db?: Db;
  allowlist?: ReadonlySet<string>;
}

/**
 * Tracks authenticated searcher connections and implements the SearcherRegistry
 * interface consumed by AuctionManager (for hint broadcast). Also exposes a
 * direct `sendAuctionResult` method used post-close by the orchestrator to
 * notify winners and losers.
 */
export class SearcherWsRegistry implements SearcherRegistry {
  private readonly connections = new Map<string, SearcherSocket>();

  register(pubkey: string, ws: SearcherSocket): void {
    const existing = this.connections.get(pubkey);
    if (existing && existing !== ws) {
      safeEnd(existing, 1000, "replaced by newer session");
    }
    this.connections.set(pubkey, ws);
  }

  unregister(pubkey: string, ws?: SearcherSocket): void {
    const current = this.connections.get(pubkey);
    if (!current) return;
    if (ws && current !== ws) return;
    this.connections.delete(pubkey);
  }

  size(): number {
    return this.connections.size;
  }

  broadcast(hint: SearcherHint): void {
    const payload = JSON.stringify({ type: "hint", ...hint });
    for (const ws of this.connections.values()) {
      safeSend(ws, payload);
    }
  }

  sendAuctionResult(params: {
    hintId: string;
    bids: readonly SearcherBid[];
    winnerPubkey: string | null;
    winningBidLamports: bigint | null;
  }): void {
    const winningBid = params.winningBidLamports?.toString() ?? null;
    for (const bid of params.bids) {
      const ws = this.connections.get(bid.searcherPubkey);
      if (!ws) continue;
      const payload = JSON.stringify({
        type: "auction_result",
        hintId: params.hintId,
        won: bid.searcherPubkey === params.winnerPubkey,
        yourBid: bid.userCashbackLamports.toString(),
        winningBid,
      });
      safeSend(ws, payload);
    }
  }
}

/**
 * Registers the `/searcher` WebSocket handler on the given uWS app. Searchers
 * must authenticate with a time-bound signed message before any bid is accepted.
 */
export function attachSearcherWs(app: TemplatedApp, deps: SearcherWsDeps): void {
  const db = deps.db ?? defaultDb;

  app.ws<SearcherSocketData>("/searcher", {
    idleTimeout: 120,
    maxPayloadLength: 256 * 1024,
    upgrade: (res, req, context) => {
      res.upgrade<SearcherSocketData>(
        { pubkey: null, authenticatedAt: null },
        req.getHeader("sec-websocket-key"),
        req.getHeader("sec-websocket-protocol"),
        req.getHeader("sec-websocket-extensions"),
        context,
      );
    },
    message: async (ws, raw) => {
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(Buffer.from(raw).toString("utf-8"));
      } catch {
        safeSend(
          ws,
          JSON.stringify({ type: "error", reason: "invalid_json" }),
        );
        return;
      }

      if (msg.type === "auth") {
        await handleAuth(ws, msg, deps, db);
        return;
      }
      if (msg.type === "bid") {
        await handleBid(ws, msg, deps);
        return;
      }
      safeSend(
        ws,
        JSON.stringify({ type: "error", reason: "unknown_message_type" }),
      );
    },
    close: (ws) => {
      const data = ws.getUserData();
      if (data.pubkey) {
        deps.registry.unregister(data.pubkey, ws);
      }
    },
  });
}

async function handleAuth(
  ws: SearcherSocket,
  msg: AuthMessage,
  deps: SearcherWsDeps,
  db: Db,
): Promise<void> {
  const data = ws.getUserData();
  if (data.authenticatedAt) {
    safeEnd(ws, 1008, "already_authenticated");
    return;
  }

  if (deps.allowlist && !deps.allowlist.has(msg.pubkey)) {
    safeEnd(ws, 1008, "not_allowlisted");
    return;
  }

  const ok = await verifyAuthMessage(msg.pubkey, msg.signature, msg.timestamp);
  if (!ok) {
    safeEnd(ws, 1008, "auth_failed");
    return;
  }

  try {
    await upsertSearcher(db, msg.pubkey);
  } catch (err) {
    console.error("[ws/searcher] searcher upsert failed:", err);
    safeEnd(ws, 1011, "internal_error");
    return;
  }

  data.pubkey = msg.pubkey;
  data.authenticatedAt = Date.now();
  deps.registry.register(msg.pubkey, ws);
  safeSend(ws, JSON.stringify({ type: "auth_ok" }));
}

async function handleBid(
  ws: SearcherSocket,
  msg: BidMessage,
  deps: SearcherWsDeps,
): Promise<void> {
  const data = ws.getUserData();
  if (!data.authenticatedAt || !data.pubkey) {
    safeEnd(ws, 1008, "not_authenticated");
    return;
  }

  const auction = deps.auctionManager.getAuction(msg.hintId);
  if (!auction) {
    safeSend(
      ws,
      JSON.stringify({
        type: "bid_rejected",
        hintId: msg.hintId,
        reason: "unknown_hint",
      }),
    );
    return;
  }

  let userCashbackLamports: bigint;
  let jitoTipLamports: bigint;
  try {
    userCashbackLamports = BigInt(msg.userCashbackLamports);
    jitoTipLamports = BigInt(msg.jitoTipLamports);
  } catch {
    safeSend(
      ws,
      JSON.stringify({
        type: "bid_rejected",
        hintId: msg.hintId,
        reason: "invalid_lamports",
      }),
    );
    return;
  }

  const bid: SearcherBid = {
    hintId: msg.hintId,
    searcherPubkey: data.pubkey,
    userCashbackLamports,
    jitoTipLamports,
    backrunTx: msg.backrunTx,
    tipTx: msg.tipTx,
    bidCommitmentSig: msg.bidCommitmentSig,
    receivedAt: Date.now(),
  };

  // Tier-1: verify the searcher's Ed25519 signature over the canonical bid
  // commitment. The relay re-uses this signature when constructing the
  // on-chain settlement tx, where the FlowBack program re-verifies it via
  // the Ed25519 sigverify precompile.
  const tier1 = await validateBidCommitment(bid.bidCommitmentSig, {
    hintId: bid.hintId,
    searcherPubkey: bid.searcherPubkey,
    bidAmountLamports: bid.userCashbackLamports,
  });
  if (!tier1) {
    safeSend(
      ws,
      JSON.stringify({
        type: "bid_rejected",
        hintId: msg.hintId,
        reason: "bid_commitment_invalid",
      }),
    );
    return;
  }

  try {
    deps.auctionManager.submitBid(msg.hintId, bid);
    safeSend(
      ws,
      JSON.stringify({ type: "bid_accepted", hintId: msg.hintId }),
    );
  } catch (err) {
    safeSend(
      ws,
      JSON.stringify({
        type: "bid_rejected",
        hintId: msg.hintId,
        reason: (err as Error).message,
      }),
    );
  }
}

/**
 * Verifies an Ed25519 signature over `"<prefix>:<pubkey>:<timestampMs>"`.
 * The timestamp must be within ±60s of now — this bounds replay attacks on
 * allowlisted keys without requiring a server-issued challenge round-trip.
 */
async function verifyAuthMessage(
  pubkey: string,
  signatureB58: string,
  timestampMs: number,
): Promise<boolean> {
  if (!Number.isFinite(timestampMs)) return false;
  if (Math.abs(Date.now() - timestampMs) > AUTH_MAX_SKEW_MS) return false;

  let addr: Address;
  try {
    addr = address(pubkey);
  } catch {
    return false;
  }

  try {
    const pubkeyBytes = getAddressEncoder().encode(addr) as Uint8Array;
    const sigBytesRaw = getBase58Encoder().encode(signatureB58);
    if (sigBytesRaw.length !== 64) return false;

    const message = new TextEncoder().encode(
      `${AUTH_MESSAGE_PREFIX}:${pubkey}:${timestampMs}`,
    );

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(pubkeyBytes),
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await verifySignature(cryptoKey, toSignatureBytes(sigBytesRaw), message);
  } catch {
    return false;
  }
}

async function upsertSearcher(db: Db, pubkey: string): Promise<void> {
  const now = new Date();
  await db
    .insert(searchers)
    .values({ pubkey, lastSeenAt: now })
    .onConflictDoUpdate({
      target: searchers.pubkey,
      set: { lastSeenAt: now },
    });
}

function safeSend(ws: SearcherSocket, payload: string): void {
  try {
    ws.send(payload);
  } catch {
    // Connection closed between event loop ticks; nothing to do.
  }
}

function safeEnd(ws: SearcherSocket, code: number, reason: string): void {
  try {
    ws.end(code, reason);
  } catch {
    // Already closed.
  }
}
