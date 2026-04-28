import { Connection } from "@solana/web3.js";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

import { buildAuthMessage } from "./auth.js";
import type {
  AuctionResult,
  BidInput,
  ClientConfig,
  SearcherHint,
  ServerMessage,
} from "./types.js";

const AUTH_TIMEOUT_MS = 5_000;
const BID_ACK_TIMEOUT_MS = 5_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

type EventName =
  | "hint"
  | "auction_result"
  | "bid_accepted"
  | "bid_rejected"
  | "error"
  | "disconnect";

interface PendingBidAck {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * High-level searcher client. Manages the WebSocket lifecycle (connect, auth,
 * automatic reconnect with backoff, re-auth) and exposes typed event hooks for
 * the four messages the relay sends post-auth: `hint`, `bid_accepted`,
 * `bid_rejected`, and `auction_result`.
 *
 * @example
 * ```ts
 * const searcher = new FlowbackSearcher({ relayUrl, signer, programId, treasury, rpcUrl });
 * await searcher.connect();
 * searcher.onHint(async (hint) => { ... });
 * ```
 */
export class FlowbackSearcher {
  private readonly emitter = new EventEmitter();
  private readonly connection: Connection;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private explicitlyClosed = false;
  private readonly pendingBidAcks = new Map<string, PendingBidAck>();

  constructor(private readonly config: ClientConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
  }

  /** Open the WS, send the auth message, and resolve once the relay sends `auth_ok`. */
  async connect(): Promise<void> {
    this.explicitlyClosed = false;
    await this.openAndAuth();
  }

  /** Close the connection. After this, `onDisconnect` fires once and no reconnect is attempted. */
  disconnect(): void {
    this.explicitlyClosed = true;
    this.ws?.close(1000);
    this.ws = null;
  }

  /**
   * Submit a bid. Resolves once the relay sends `bid_accepted` for the matching
   * `hintId`, or rejects on `bid_rejected` with the relay's reason. Times out
   * after 5 s.
   */
  submitBid(bid: BidInput): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const wire = {
      type: "bid" as const,
      hintId: bid.hintId,
      userCashbackLamports: bid.userCashbackLamports.toString(),
      jitoTipLamports: bid.jitoTipLamports.toString(),
      backrunTx: bid.backrunTx,
      tipTx: bid.tipTx,
      bidCommitmentSig: bid.bidCommitmentSig,
    };
    const ackPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBidAcks.delete(bid.hintId);
        reject(new Error(`bid ack timeout for hintId=${bid.hintId}`));
      }, BID_ACK_TIMEOUT_MS);
      this.pendingBidAcks.set(bid.hintId, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify(wire));
    return ackPromise;
  }

  /** Latest blockhash from the configured RPC. Cache or refresh on your own cadence. */
  async getRecentBlockhash(): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    return blockhash;
  }

  /** Register a callback for new auction hints. */
  onHint(cb: (hint: SearcherHint) => void | Promise<void>): void {
    this.emitter.on("hint", cb);
  }

  /** Register a callback for auction outcome notifications. */
  onAuctionResult(cb: (result: AuctionResult) => void): void {
    this.emitter.on("auction_result", cb);
  }

  /** Register a callback for connection errors. */
  onError(cb: (err: Error) => void): void {
    this.emitter.on("error", cb);
  }

  /** Register a callback for disconnect events (fires once per drop). */
  onDisconnect(cb: () => void): void {
    this.emitter.on("disconnect", cb);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async openAndAuth(): Promise<void> {
    const ws = new WebSocket(this.config.relayUrl);
    this.ws = ws;

    const authMessage = await buildAuthMessage(this.config.signer);

    await new Promise<void>((resolve, reject) => {
      const authTimer = setTimeout(() => {
        ws.removeAllListeners();
        ws.close();
        reject(new Error("auth timeout"));
      }, AUTH_TIMEOUT_MS);

      ws.once("open", () => {
        ws.send(JSON.stringify(authMessage));
      });
      ws.once("error", (err) => {
        clearTimeout(authTimer);
        reject(err);
      });
      ws.once("message", (raw) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(raw.toString("utf-8"));
        } catch {
          clearTimeout(authTimer);
          reject(new Error("invalid auth response"));
          return;
        }
        if (msg.type !== "auth_ok") {
          clearTimeout(authTimer);
          reject(new Error(`auth failed: ${JSON.stringify(msg)}`));
          return;
        }
        clearTimeout(authTimer);
        this.reconnectAttempts = 0;
        this.attachMessageHandlers(ws);
        resolve();
      });
    });
  }

  private attachMessageHandlers(ws: WebSocket): void {
    ws.on("message", (raw) => this.handleMessage(raw.toString("utf-8")));
    ws.on("error", (err) => this.emitter.emit("error", err));
    ws.on("close", () => this.handleClose());
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.emitter.emit("error", new Error("invalid server message"));
      return;
    }
    switch (msg.type) {
      case "hint": {
        const hint: SearcherHint = {
          hintId: msg.hintId,
          tokenPair: msg.tokenPair,
          sizeBucket: msg.sizeBucket,
          priceImpactBps: msg.priceImpactBps,
          auctionDeadlineMs: msg.auctionDeadlineMs,
        };
        this.emitter.emit("hint", hint);
        return;
      }
      case "auction_result": {
        const result: AuctionResult = {
          hintId: msg.hintId,
          won: msg.won,
          yourBid: BigInt(msg.yourBid),
          winningBid: msg.winningBid === null ? null : BigInt(msg.winningBid),
        };
        this.emitter.emit("auction_result", result);
        return;
      }
      case "bid_accepted": {
        const ack = this.pendingBidAcks.get(msg.hintId);
        if (ack) {
          clearTimeout(ack.timer);
          this.pendingBidAcks.delete(msg.hintId);
          ack.resolve();
        }
        return;
      }
      case "bid_rejected": {
        const ack = this.pendingBidAcks.get(msg.hintId);
        if (ack) {
          clearTimeout(ack.timer);
          this.pendingBidAcks.delete(msg.hintId);
          ack.reject(new Error(`bid rejected: ${msg.reason}`));
        }
        return;
      }
      case "error":
        this.emitter.emit("error", new Error(`relay error: ${msg.reason}`));
        return;
      case "auth_ok":
        // Already handled in openAndAuth.
        return;
    }
  }

  private handleClose(): void {
    this.ws = null;
    for (const ack of this.pendingBidAcks.values()) {
      clearTimeout(ack.timer);
      ack.reject(new Error("connection closed"));
    }
    this.pendingBidAcks.clear();
    this.emitter.emit("disconnect");
    if (this.explicitlyClosed) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts += 1;
    setTimeout(() => {
      this.openAndAuth().catch((err) => this.emitter.emit("error", err));
    }, delay);
  }
}
