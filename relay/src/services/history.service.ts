import { desc, eq, sql } from "drizzle-orm";

import { db as defaultDb } from "../db/client.js";
import { auctions, cashbackEvents } from "../db/schema.js";

type Db = typeof defaultDb;

export interface HistoryServiceDeps {
  db?: Db;
}

export interface HistoryParams {
  wallet: string;
  limit: number;
  offset: number;
}

export interface CashbackHistoryEvent {
  txSignature: string;
  timestamp: string;
  cashbackLamports: string;
  bidAmountLamports: string;
  protocolFeeLamports: string;
  searcherPubkey: string;
  auctionId: string | null;
  inputMint: string | null;
  outputMint: string | null;
  inputAmountLamports: string | null;
  bundleId: string | null;
}

export interface HistoryResult {
  wallet: string;
  totalCashbackLamports: string;
  eventCount: number;
  limit: number;
  offset: number;
  events: CashbackHistoryEvent[];
}

/**
 * Returns cashback history for a wallet: lifetime totals plus a paginated
 * list of CashbackSettled events, each joined with its auction's trade
 * context (mints + input amount + bundle id) for display in the MEV calculator.
 */
export async function getCashbackHistory(
  params: HistoryParams,
  deps: HistoryServiceDeps = {},
): Promise<HistoryResult> {
  const db = deps.db ?? defaultDb;

  const rows = await db
    .select({
      txSignature: cashbackEvents.txSignature,
      timestamp: cashbackEvents.timestamp,
      cashbackLamports: cashbackEvents.cashbackLamports,
      bidAmountLamports: cashbackEvents.bidAmountLamports,
      protocolFeeLamports: cashbackEvents.protocolFeeLamports,
      searcherPubkey: cashbackEvents.searcherPubkey,
      auctionId: cashbackEvents.auctionId,
      inputMint: auctions.inputMint,
      outputMint: auctions.outputMint,
      inputAmountLamports: auctions.inputAmountLamports,
      bundleId: auctions.bundleId,
    })
    .from(cashbackEvents)
    .leftJoin(auctions, eq(auctions.id, cashbackEvents.auctionId))
    .where(eq(cashbackEvents.userPubkey, params.wallet))
    .orderBy(desc(cashbackEvents.timestamp))
    .limit(params.limit)
    .offset(params.offset);

  const [totals] = await db
    .select({
      totalCashback: sql<string>`COALESCE(SUM(${cashbackEvents.cashbackLamports}), 0)::text`,
      count: sql<string>`COUNT(*)::text`,
    })
    .from(cashbackEvents)
    .where(eq(cashbackEvents.userPubkey, params.wallet));

  const events: CashbackHistoryEvent[] = rows.map((r) => ({
    txSignature: r.txSignature,
    timestamp: r.timestamp!.toISOString(),
    cashbackLamports: r.cashbackLamports.toString(),
    bidAmountLamports: r.bidAmountLamports.toString(),
    protocolFeeLamports: r.protocolFeeLamports.toString(),
    searcherPubkey: r.searcherPubkey,
    auctionId: r.auctionId ?? null,
    inputMint: r.inputMint ?? null,
    outputMint: r.outputMint ?? null,
    inputAmountLamports: r.inputAmountLamports?.toString() ?? null,
    bundleId: r.bundleId ?? null,
  }));

  return {
    wallet: params.wallet,
    totalCashbackLamports: totals?.totalCashback ?? "0",
    eventCount: Number(totals?.count ?? "0"),
    limit: params.limit,
    offset: params.offset,
    events,
  };
}
