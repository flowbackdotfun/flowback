import { and, desc, eq } from "drizzle-orm";

import { bucketFor } from "../auction/manager.js";
import type { SizeBucket } from "../auction/types.js";
import { db as defaultDb } from "../db/client.js";
import { auctions } from "../db/schema.js";
import {
  getQuote,
  JupiterError,
  type JupiterQuoteResponse,
} from "../jupiter/client.js";
import { JupiterUnavailableError } from "./errors.js";

export { JupiterUnavailableError } from "./errors.js";

type Db = typeof defaultDb;

const CASHBACK_SAMPLE_LIMIT = 50;

export interface QuoteServiceDeps {
  db?: Db;
}

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
}

export interface CashbackEstimate {
  lamports: string;
  sampleSize: number;
}

export interface QuoteResult {
  quote: JupiterQuoteResponse;
  cashbackEstimate: CashbackEstimate | null;
}

/**
 * Fetches a Jupiter quote and annotates it with a cashback estimate derived
 * from the relay's own auction history — the p50 winning bid across the most
 * recent auctions for the same (inputMint, outputMint, sizeBucket). Returns
 * `null` when there's no history to estimate against.
 */
export async function quoteWithCashbackEstimate(
  params: QuoteParams,
  deps: QuoteServiceDeps = {},
): Promise<QuoteResult> {
  let quote: JupiterQuoteResponse;
  try {
    quote = await getQuote(
      params.inputMint,
      params.outputMint,
      params.amount,
      params.slippageBps,
    );
  } catch (err) {
    if (err instanceof JupiterError) throw new JupiterUnavailableError(err);
    throw err;
  }

  const cashbackEstimate = await estimateCashback(
    deps.db ?? defaultDb,
    params.inputMint,
    params.outputMint,
    bucketFor(params.amount),
  );

  return { quote, cashbackEstimate };
}

async function estimateCashback(
  db: Db,
  inputMint: string,
  outputMint: string,
  sizeBucket: SizeBucket,
): Promise<CashbackEstimate | null> {
  const rows = await db
    .select({ winningBidLamports: auctions.winningBidLamports })
    .from(auctions)
    .where(
      and(
        eq(auctions.inputMint, inputMint),
        eq(auctions.outputMint, outputMint),
        eq(auctions.sizeBucket, sizeBucket),
        eq(auctions.status, "won"),
      ),
    )
    .orderBy(desc(auctions.createdAt))
    .limit(CASHBACK_SAMPLE_LIMIT);

  const bids = rows
    .map((r) => r.winningBidLamports)
    .filter((b): b is bigint => b !== null && b !== undefined);

  if (bids.length === 0) return null;

  bids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(bids.length / 2);
  const median =
    bids.length % 2 === 1
      ? bids[mid]!
      : (bids[mid - 1]! + bids[mid]!) / 2n;

  return { lamports: median.toString(), sampleSize: bids.length };
}
