import "dotenv/config";
import { randomUUID } from "node:crypto";
import type {
  AuctionMarketContext,
  AuctionState,
  SearcherBid,
  SearcherHint,
  SizeBucket,
  SwapIntent,
} from "./types.js";

const DEFAULT_AUCTION_WINDOW_MS = 200;

export interface SearcherRegistry {
  broadcast(hint: SearcherHint): void;
}

export interface AuctionManagerOptions {
  searcherRegistry: SearcherRegistry;
  auctionWindowMs?: number;
}

export interface AuctionHandle {
  hintId: string;
  // Resolves with bids sorted desc by userCashbackLamports after the window closes.
  resolved: Promise<SearcherBid[]>;
}

export class AuctionManager {
  private readonly auctions = new Map<string, AuctionState>();
  private readonly searcherRegistry: SearcherRegistry;
  private readonly auctionWindowMs: number;

  constructor(opts: AuctionManagerOptions) {
    this.searcherRegistry = opts.searcherRegistry;
    this.auctionWindowMs =
      opts.auctionWindowMs ??
      Number(process.env.AUCTION_WINDOW_MS ?? DEFAULT_AUCTION_WINDOW_MS);
  }

  startAuction(
    intent: SwapIntent,
    market: AuctionMarketContext,
  ): AuctionHandle {
    const hintId = randomUUID();
    const createdAt = Date.now();
    const auctionDeadlineMs = createdAt + this.auctionWindowMs;

    let resolveFn!: (bidsByCashbackDesc: SearcherBid[]) => void;
    const promise = new Promise<SearcherBid[]>((res) => {
      resolveFn = res;
    });

    const state: AuctionState = {
      hintId,
      intent,
      market,
      bids: [],
      status: "open",
      createdAt,
      resolve: resolveFn,
    };
    this.auctions.set(hintId, state);

    const hint: SearcherHint = {
      hintId,
      tokenPair: {
        inputMint: intent.inputMint,
        outputMint: intent.outputMint,
      },
      sizeBucket: bucketFor(intent.inputAmount),
      priceImpactBps: priceImpactToBps(market.priceImpactPct),
      auctionDeadlineMs,
    };
    this.searcherRegistry.broadcast(hint);
    console.log(
      `[auction] open      hint=${hintId.slice(0, 8)}  bucket=${hint.sizeBucket}  impactBps=${hint.priceImpactBps}  windowMs=${this.auctionWindowMs}`,
    );

    setTimeout(() => this.closeAuction(hintId), this.auctionWindowMs);

    return { hintId, resolved: promise };
  }

  submitBid(hintId: string, bid: SearcherBid): void {
    const state = this.auctions.get(hintId);
    if (!state) {
      throw new Error(`Unknown hintId: ${hintId}`);
    }
    if (state.status !== "open") {
      throw new Error(`Auction ${hintId} is ${state.status}, not open`);
    }
    state.bids.push(bid);
    console.log(
      `[auction] bid       hint=${hintId.slice(0, 8)}  searcher=${bid.searcherPubkey.slice(0, 6)}…  amount=${bid.userCashbackLamports}  total=${state.bids.length}`,
    );
  }

  getAuction(hintId: string): AuctionState | undefined {
    return this.auctions.get(hintId);
  }

  private closeAuction(hintId: string): void {
    const state = this.auctions.get(hintId);
    if (!state || state.status !== "open") return;

    state.status = "closed";
    const sorted = [...state.bids].sort((a, b) => {
      if (a.userCashbackLamports > b.userCashbackLamports) return -1;
      if (a.userCashbackLamports < b.userCashbackLamports) return 1;
      return a.receivedAt - b.receivedAt;
    });
    const top = sorted[0];
    console.log(
      `[auction] close     hint=${hintId.slice(0, 8)}  bids=${sorted.length}  topBid=${top ? top.userCashbackLamports : "none"}`,
    );
    state.resolve(sorted);
    this.auctions.delete(hintId);
  }
}

export function bucketFor(inputAmountLamports: bigint): SizeBucket {
  const ONE_SOL = 1_000_000_000n;
  if (inputAmountLamports < ONE_SOL) return "small";
  if (inputAmountLamports < 10n * ONE_SOL) return "medium";
  if (inputAmountLamports < 100n * ONE_SOL) return "large";
  return "whale";
}

function priceImpactToBps(priceImpactPct: string): number {
  const pct = Number(priceImpactPct);
  if (!Number.isFinite(pct)) return 0;
  return Math.round(pct * 100);
}
