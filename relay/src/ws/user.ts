import type {
  TemplatedApp,
  WebSocket as UwsWebSocket,
} from "uWebSockets.js";

const BUFFER_TTL_MS = 60_000;

export type UserStatusEvent =
  | {
      type: "bundle_submitted";
      auctionId: string;
      bundleId: string;
    }
  | {
      type: "cashback_confirmed";
      auctionId: string;
      cashbackLamports: string;
      txSignature: string;
    }
  | {
      type: "fallback_executed";
      auctionId: string;
      txSignature: string;
    }
  | {
      type: "auction_failed";
      auctionId: string;
      reason: string;
    };

interface UserSocketData {
  auctionIds: Set<string>;
}

type UserSocket = UwsWebSocket<UserSocketData>;

interface SubscribeMessage {
  type: "subscribe";
  auctionId: string;
}

interface UnsubscribeMessage {
  type: "unsubscribe";
  auctionId: string;
}

type IncomingMessage = SubscribeMessage | UnsubscribeMessage;

/**
 * In-process pub/sub for per-auction status updates to subscribed frontends.
 *
 * Buffers recent events per auctionId for a short window so that a frontend
 * subscribing *just after* the event was emitted (which happens when the
 * auction resolves fast relative to the subscribe round-trip) still receives
 * it on subscribe-replay.
 */
export class UserStatusEmitter {
  private readonly subscribers = new Map<string, Set<UserSocket>>();
  private readonly buffer = new Map<string, UserStatusEvent[]>();
  private readonly bufferTimeouts = new Map<string, NodeJS.Timeout>();

  subscribe(auctionId: string, ws: UserSocket): void {
    let set = this.subscribers.get(auctionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(auctionId, set);
    }
    set.add(ws);

    const buffered = this.buffer.get(auctionId);
    if (buffered) {
      for (const event of buffered) {
        safeSend(ws, JSON.stringify(event));
      }
    }
  }

  unsubscribe(auctionId: string, ws: UserSocket): void {
    const set = this.subscribers.get(auctionId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.subscribers.delete(auctionId);
  }

  emitBundleSubmitted(auctionId: string, bundleId: string): void {
    this.emit({ type: "bundle_submitted", auctionId, bundleId });
  }

  emitCashbackConfirmed(
    auctionId: string,
    cashbackLamports: bigint,
    txSignature: string,
  ): void {
    this.emit({
      type: "cashback_confirmed",
      auctionId,
      cashbackLamports: cashbackLamports.toString(),
      txSignature,
    });
  }

  emitFallbackExecuted(auctionId: string, txSignature: string): void {
    this.emit({ type: "fallback_executed", auctionId, txSignature });
  }

  emitAuctionFailed(auctionId: string, reason: string): void {
    this.emit({ type: "auction_failed", auctionId, reason });
  }

  subscriberCount(auctionId: string): number {
    return this.subscribers.get(auctionId)?.size ?? 0;
  }

  private emit(event: UserStatusEvent): void {
    this.pushBuffer(event);
    const subs = this.subscribers.get(event.auctionId);
    if (!subs || subs.size === 0) return;
    const payload = JSON.stringify(event);
    for (const ws of subs) safeSend(ws, payload);
  }

  private pushBuffer(event: UserStatusEvent): void {
    const existing = this.buffer.get(event.auctionId) ?? [];
    existing.push(event);
    this.buffer.set(event.auctionId, existing);

    const oldTimeout = this.bufferTimeouts.get(event.auctionId);
    if (oldTimeout) clearTimeout(oldTimeout);
    const t = setTimeout(() => {
      this.buffer.delete(event.auctionId);
      this.bufferTimeouts.delete(event.auctionId);
    }, BUFFER_TTL_MS);
    t.unref();
    this.bufferTimeouts.set(event.auctionId, t);
  }
}

/**
 * Registers the `/status` WebSocket handler. Frontends subscribe to one or
 * more auctionIds per socket — emitter pushes their events as they occur.
 */
export function attachUserStatusWs(
  app: TemplatedApp,
  emitter: UserStatusEmitter,
): void {
  app.ws<UserSocketData>("/status", {
    idleTimeout: 120,
    maxPayloadLength: 16 * 1024,
    upgrade: (res, req, context) => {
      res.upgrade<UserSocketData>(
        { auctionIds: new Set() },
        req.getHeader("sec-websocket-key"),
        req.getHeader("sec-websocket-protocol"),
        req.getHeader("sec-websocket-extensions"),
        context,
      );
    },
    message: (ws, raw) => {
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

      const data = ws.getUserData();

      if (msg.type === "subscribe" && typeof msg.auctionId === "string") {
        data.auctionIds.add(msg.auctionId);
        emitter.subscribe(msg.auctionId, ws);
        safeSend(
          ws,
          JSON.stringify({ type: "subscribed", auctionId: msg.auctionId }),
        );
        return;
      }

      if (msg.type === "unsubscribe" && typeof msg.auctionId === "string") {
        data.auctionIds.delete(msg.auctionId);
        emitter.unsubscribe(msg.auctionId, ws);
        return;
      }

      safeSend(
        ws,
        JSON.stringify({ type: "error", reason: "unknown_message_type" }),
      );
    },
    close: (ws) => {
      const data = ws.getUserData();
      for (const auctionId of data.auctionIds) {
        emitter.unsubscribe(auctionId, ws);
      }
      data.auctionIds.clear();
    },
  });
}

function safeSend(ws: UserSocket, payload: string): void {
  try {
    ws.send(payload);
  } catch {
    // Connection closed between event loop ticks.
  }
}
