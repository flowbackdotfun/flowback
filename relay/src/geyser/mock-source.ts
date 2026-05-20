import bs58 from "bs58";

import {
  type CashbackSettledEvent,
  encodeCashbackSettledLog,
} from "./cashback-event.js";
import {
  makeCashbackTransactionUpdate,
  mapRandomIntraslotEvent,
  mapSlotBoundaryEvents,
} from "./mock-events.js";
import { AsyncQueue } from "./queue.js";
import type {
  GeyserSource,
  GeyserSubscription,
  SubscribeRequest,
  SubscribeUpdate,
} from "./types.js";

/**
 * In-process `GeyserSource` that emits synthetic `SubscribeUpdate`s, letting
 * the cashback indexer (and any other consumer) run without a validator or a
 * paid Yellowstone endpoint.
 *
 * Two cadences, matching real geyser:
 *  - slot boundary (~400ms): block / blockMeta / slot-status events
 *  - intra-slot (~10ms): a randomized tx / tx-status / account event
 *
 * It can also emit real `CashbackSettled` events — on demand via
 * `injectCashbackSettled`, or on a fixed interval — so the full
 * indexer → registry → WebSocket pipeline can be exercised end to end.
 */

const DEFAULT_INTRASLOT_INTERVAL_MS = 10;
const DEFAULT_SLOT_INTERVAL_MS = 400;

export interface MockGeyserConfig {
  startSlot?: number;
  intraslotIntervalMs?: number;
  slotIntervalMs?: number;
  /** When set, the mock self-emits a synthetic `CashbackSettled` this often. */
  syntheticCashbackIntervalMs?: number;
}

export class MockGeyserSource implements GeyserSource {
  private readonly config: MockGeyserConfig;
  private readonly active = new Set<MockSubscription>();

  constructor(config: MockGeyserConfig = {}) {
    this.config = config;
  }

  async subscribe(request: SubscribeRequest): Promise<GeyserSubscription> {
    const sub = new MockSubscription(request, this.config, (s) =>
      this.active.delete(s),
    );
    this.active.add(sub);
    return sub;
  }

  /**
   * Push a `CashbackSettled` event into every live subscription. Fields left
   * unset are filled with sensible random defaults. Returns the base58 tx
   * signature carried by the synthetic event.
   */
  injectCashbackSettled(partial: Partial<CashbackSettledEvent> = {}): string {
    const subs = [...this.active];
    if (subs.length === 0) {
      console.warn(
        "[geyser:mock] injectCashbackSettled called with no active subscription",
      );
      return "";
    }

    const event = fillCashbackEvent(partial);
    const { update, signature } = makeCashbackTransactionUpdate(
      subs[0]!.currentSlot(),
      encodeCashbackSettledLog(event),
    );
    for (const sub of subs) sub.enqueue(update);
    return bs58.encode(signature);
  }
}

class MockSubscription implements GeyserSubscription {
  readonly updates: AsyncQueue<SubscribeUpdate>;
  private slot: number;
  private readonly timers: NodeJS.Timeout[] = [];
  private closed = false;
  private readonly onClose: (self: MockSubscription) => void;

  constructor(
    request: SubscribeRequest,
    config: MockGeyserConfig,
    onClose: (self: MockSubscription) => void,
  ) {
    this.updates = new AsyncQueue<SubscribeUpdate>();
    this.slot = config.startSlot ?? 0;
    this.onClose = onClose;

    const intraslotMs =
      config.intraslotIntervalMs ?? DEFAULT_INTRASLOT_INTERVAL_MS;
    const slotMs = config.slotIntervalMs ?? DEFAULT_SLOT_INTERVAL_MS;

    this.addTimer(
      setInterval(() => {
        this.updates.push(mapRandomIntraslotEvent(request, this.slot));
      }, intraslotMs),
    );

    this.addTimer(
      setInterval(() => {
        for (const event of mapSlotBoundaryEvents(request, this.slot)) {
          this.updates.push(event);
        }
        this.slot += 1;
      }, slotMs),
    );

    if (
      config.syntheticCashbackIntervalMs &&
      config.syntheticCashbackIntervalMs > 0
    ) {
      this.addTimer(
        setInterval(() => {
          const { update } = makeCashbackTransactionUpdate(
            this.slot,
            encodeCashbackSettledLog(fillCashbackEvent({})),
          );
          this.updates.push(update);
        }, config.syntheticCashbackIntervalMs),
      );
    }
  }

  currentSlot(): number {
    return this.slot;
  }

  enqueue(update: SubscribeUpdate): void {
    this.updates.push(update);
  }

  async write(_request: SubscribeRequest): Promise<void> {
    // The mock has no server side, so dynamic filter updates are a no-op.
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    this.updates.end();
    this.onClose(this);
  }

  private addTimer(timer: NodeJS.Timeout): void {
    timer.unref();
    this.timers.push(timer);
  }
}

function fillCashbackEvent(
  partial: Partial<CashbackSettledEvent>,
): CashbackSettledEvent {
  const bidAmountLamports =
    partial.bidAmountLamports ?? BigInt(500_000 + Math.floor(Math.random() * 2_000_000));
  const userCashbackLamports =
    partial.userCashbackLamports ?? (bidAmountLamports * 90n) / 100n;
  const protocolFeeLamports =
    partial.protocolFeeLamports ?? bidAmountLamports - userCashbackLamports;

  return {
    user: partial.user ?? randomPubkey(),
    searcher: partial.searcher ?? randomPubkey(),
    bidAmountLamports,
    userCashbackLamports,
    protocolFeeLamports,
    timestamp: partial.timestamp ?? BigInt(Math.floor(Date.now() / 1000)),
  };
}

function randomPubkey(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bs58.encode(bytes);
}
