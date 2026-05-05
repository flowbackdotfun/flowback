import { eq, sql } from "drizzle-orm";

import { db as defaultDb } from "../db/client.js";
import { auctions, cashbackEvents } from "../db/schema.js";
import {
  fetchWalletSwaps,
  type HeliusEnhancedTransaction,
} from "../helius/client.js";
import { HeliusUnavailableError } from "./errors.js";

// ── Public types ────────────────────────────────────────────────────

type MevType = "sandwiched" | "frontrun" | "backrun_target" | "clean";
type Confidence = "high" | "medium";

export interface AnalyzedSwap {
  signature: string;
  timestamp: number;
  slot: number;
  source: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  actualOutputAmount: string;
  expectedOutputAmount: string;
  estimatedLossUsd: number;
  estimatedLossToken: string;
  estimatedCashbackToken: string;
  mevType: MevType;
  confidence: Confidence;
}

export interface MevAnalysisResult {
  wallet: string;
  analyzedFrom: number;
  analyzedTo: number;
  totalSwaps: number;
  swaps: AnalyzedSwap[];
  page: number;
  hasMore: boolean;
  totalEstimatedLossUsd: number;
  flowbackWouldReturnUsd: number;
  flowbackWouldReturnSol: number;
  cashbackSampleSize: number;
  topPairsByLoss: { inputMint: string; outputMint: string; lossUsd: number }[];
  cumulativeLoss: { month: string; lossUsd: number; count: number }[];
  breakdown: {
    sandwiched: number;
    frontrun: number;
    backrunTarget: number;
    clean: number;
  };
}

// ── Constants ───────────────────────────────────────────────────────

const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;
const MOCK_MODE = process.env.MOCK_CALCULATOR_VALUE === "true";
const DEFAULT_CASHBACK_RATIO = 0.003;

const VULNERABLE_AMMS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM V4
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",   // Orca Whirlpools
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",   // Raydium CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",   // Raydium CPMM
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",   // Meteora DLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",   // Meteora Pools
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",     // Phoenix
]);

const POPULAR_PAIRS = new Set([
  `${SOL_MINT}-EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,   // SOL/USDC
  `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v-${SOL_MINT}`,   // USDC/SOL
  `${SOL_MINT}-Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`,   // SOL/USDT
  `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB-${SOL_MINT}`,   // USDT/SOL
  `${SOL_MINT}-DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`, // SOL/BONK
  `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263-${SOL_MINT}`, // BONK/SOL
  `${SOL_MINT}-JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN`,   // SOL/JUP
  `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN-${SOL_MINT}`,   // JUP/SOL
  `${SOL_MINT}-EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`, // SOL/WIF
  `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm-${SOL_MINT}`, // WIF/SOL
  `${SOL_MINT}-J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn`, // SOL/JITO
  `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn-${SOL_MINT}`, // JITO/SOL
  `${SOL_MINT}-4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R`, // SOL/RAY
  `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R-${SOL_MINT}`, // RAY/SOL
]);

const MINT_SYMBOLS: Record<string, string> = {
  [SOL_MINT]: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "WIF",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JITO",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAY",
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: "ORCA",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "PYTH",
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: "JTO",
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": "W",
  rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: "RENDER",
  TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6: "TNSR",
};

function mintSymbol(mint: string): string {
  return MINT_SYMBOLS[mint] ?? mint.slice(0, 6);
}

// ── Internal types ──────────────────────────────────────────────────

type SizeBucket = "small" | "medium" | "large" | "whale";

interface NormalizedSwap {
  signature: string;
  timestamp: number;
  slot: number;
  source: string;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  inputDecimals: number;
  outputDecimals: number;
  isSinglePool: boolean;
  usesVulnerableAmm: boolean;
}

interface Classification {
  mevType: MevType;
  confidence: Confidence;
  estimatedLossUsd: number;
  lossSol: number;
  expectedOutput: number;
}

interface BucketStats {
  ratio: number;
  sampleSize: number;
}

// ── Entry point ─────────────────────────────────────────────────────

export async function analyzeWalletMev(params: {
  wallet: string;
  pages?: number;
}): Promise<MevAnalysisResult> {
  if (MOCK_MODE) return mockResult(params.wallet);

  const pages = params.pages ?? 1;

  let txs: HeliusEnhancedTransaction[];
  let hasMore: boolean;
  try {
    const result = await fetchWalletSwaps(params.wallet, { maxPages: pages });
    txs = result.txs;
    hasMore = result.hasMore;
  } catch (err) {
    throw new HeliusUnavailableError(err as Error);
  }

  const normalized = txs
    .map(extractSwap)
    .filter((s): s is NormalizedSwap => s !== null);

  if (normalized.length === 0)
    return emptyResult(params.wallet, pages, hasMore);

  const prices = await buildPriceCache(normalized);

  const latestTs = Math.max(...normalized.map((s) => s.timestamp));
  const solPrice = lookupPrice(prices, SOL_MINT, latestTs) ?? 0;

  const cashbackRatios = await getCashbackRatios();
  const totalSampleSize = [...cashbackRatios.values()].reduce(
    (sum, s) => sum + s.sampleSize,
    0,
  );

  const inputUsdValues = normalized
    .map((s) => {
      const p = lookupPrice(prices, s.inputMint, s.timestamp) ?? 0;
      return s.inputAmount * p;
    })
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const p75 =
    inputUsdValues.length > 0
      ? inputUsdValues[Math.floor(inputUsdValues.length * 0.75)]
      : 0;

  // Phase 1: heuristic classification
  const heuristicResults: { swap: NormalizedSwap; c: Classification }[] = [];
  for (const swap of normalized) {
    const c = classifySwap(swap, prices, p75);
    heuristicResults.push({ swap, c });
  }

  // Phase 2: block-level verification for flagged swaps
  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (heliusApiKey) {
    const flagged = heuristicResults.filter(
      (r) => r.c.mevType !== "clean",
    );

    const slotGroups = new Map<number, typeof flagged>();
    for (const item of flagged) {
      let group = slotGroups.get(item.swap.slot);
      if (!group) {
        group = [];
        slotGroups.set(item.swap.slot, group);
      }
      group.push(item);
    }

    const VERIFY_CONCURRENCY = 3;
    const slotEntries = [...slotGroups.entries()];
    for (let i = 0; i < slotEntries.length; i += VERIFY_CONCURRENCY) {
      const batch = slotEntries.slice(i, i + VERIFY_CONCURRENCY);
      const results = await Promise.all(
        batch.map(([slot, items]) =>
          fetchBlockSwapNeighbors(slot, items.map((it) => it.swap), heliusApiKey),
        ),
      );
      for (const verified of results) {
        for (const [sig, result] of verified) {
          if (!result.confirmed) {
            const item = flagged.find((f) => f.swap.signature === sig);
            if (item) {
              item.c = {
                mevType: "clean",
                confidence: "high",
                estimatedLossUsd: 0,
                lossSol: 0,
                expectedOutput: item.swap.outputAmount,
              };
            }
          }
        }
      }
    }
  }

  const allSwaps: AnalyzedSwap[] = [];
  const breakdown = { sandwiched: 0, frontrun: 0, backrunTarget: 0, clean: 0 };
  const pairLosses = new Map<
    string,
    { inputMint: string; outputMint: string; lossUsd: number }
  >();
  const monthlyLosses = new Map<string, { lossUsd: number; count: number }>();
  let totalLossUsd = 0;
  let totalCashbackSol = 0;

  for (const { swap, c } of heuristicResults) {
    const key = c.mevType === "backrun_target" ? "backrunTarget" : c.mevType;
    breakdown[key]++;

    let cashbackSol = 0;
    if (c.mevType !== "clean") {
      const inputPrice = lookupPrice(prices, swap.inputMint, swap.timestamp) ?? 0;
      const swapSolPrice = lookupPrice(prices, SOL_MINT, swap.timestamp) ?? solPrice;
      const inputSolEquiv =
        swapSolPrice > 0 ? (swap.inputAmount * inputPrice) / swapSolPrice : 0;
      const bucket = bucketForSol(inputSolEquiv);
      const ratio = cashbackRatios.get(bucket)?.ratio ?? DEFAULT_CASHBACK_RATIO;
      cashbackSol = inputSolEquiv * ratio;
      totalCashbackSol += cashbackSol;

      const inSym = mintSymbol(swap.inputMint);
      const outSym = mintSymbol(swap.outputMint);
      const pairKey = `${inSym}-${outSym}`;
      const existing = pairLosses.get(pairKey);
      if (existing) {
        existing.lossUsd += c.estimatedLossUsd;
      } else {
        pairLosses.set(pairKey, {
          inputMint: inSym,
          outputMint: outSym,
          lossUsd: c.estimatedLossUsd,
        });
      }

      const month = new Date(swap.timestamp * 1000).toISOString().slice(0, 7);
      const me = monthlyLosses.get(month);
      if (me) {
        me.lossUsd += c.estimatedLossUsd;
        me.count++;
      } else {
        monthlyLosses.set(month, { lossUsd: c.estimatedLossUsd, count: 1 });
      }

      totalLossUsd += c.estimatedLossUsd;
    }

    allSwaps.push({
      signature: swap.signature,
      timestamp: swap.timestamp,
      slot: swap.slot,
      source: swap.source,
      inputMint: mintSymbol(swap.inputMint),
      outputMint: mintSymbol(swap.outputMint),
      inputAmount: fmtDisplay(swap.inputAmount, swap.inputDecimals),
      actualOutputAmount: fmtDisplay(swap.outputAmount, swap.outputDecimals),
      expectedOutputAmount: fmtDisplay(c.expectedOutput, swap.outputDecimals),
      estimatedLossUsd: c.estimatedLossUsd,
      estimatedLossToken: c.lossSol.toFixed(3),
      estimatedCashbackToken: cashbackSol.toFixed(3),
      mevType: c.mevType,
      confidence: c.confidence,
    });
  }

  allSwaps.sort((a, b) => b.timestamp - a.timestamp);

  const topPairsByLoss = [...pairLosses.values()]
    .sort((a, b) => b.lossUsd - a.lossUsd)
    .slice(0, 5)
    .map((p) => ({ ...p, lossUsd: round2(p.lossUsd) }));

  const cumulativeLoss = [...monthlyLosses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      lossUsd: round2(d.lossUsd),
      count: d.count,
    }));

  const timestamps = normalized.map((s) => s.timestamp);

  return {
    wallet: params.wallet,
    analyzedFrom: Math.min(...timestamps),
    analyzedTo: Math.max(...timestamps),
    totalSwaps: normalized.length,
    swaps: allSwaps,
    page: pages,
    hasMore,
    totalEstimatedLossUsd: round2(totalLossUsd),
    flowbackWouldReturnUsd: round2(totalCashbackSol * solPrice),
    flowbackWouldReturnSol: round2(totalCashbackSol),
    cashbackSampleSize: totalSampleSize,
    topPairsByLoss,
    cumulativeLoss,
    breakdown,
  };
}

// ── Cashback estimation from DB ─────────────────────────────────────

async function getCashbackRatios(): Promise<Map<SizeBucket, BucketStats>> {
  const ratios = new Map<SizeBucket, BucketStats>();
  try {
    const rows = await defaultDb
      .select({
        sizeBucket: auctions.sizeBucket,
        avgCashback: sql<string>`AVG(${cashbackEvents.cashbackLamports}::numeric)::text`,
        avgInput: sql<string>`AVG(${auctions.inputAmountLamports}::numeric)::text`,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(cashbackEvents)
      .innerJoin(auctions, eq(auctions.id, cashbackEvents.auctionId))
      .groupBy(auctions.sizeBucket);

    for (const row of rows) {
      const avgCashback = Number(row.avgCashback);
      const avgInput = Number(row.avgInput);
      if (avgInput > 0) {
        ratios.set(row.sizeBucket as SizeBucket, {
          ratio: avgCashback / avgInput,
          sampleSize: Number(row.count),
        });
      }
    }
  } catch {
    // DB unavailable — will use DEFAULT_CASHBACK_RATIO
  }
  return ratios;
}

function bucketForSol(solAmount: number): SizeBucket {
  if (solAmount < 1) return "small";
  if (solAmount < 10) return "medium";
  if (solAmount < 100) return "large";
  return "whale";
}

// ── Swap extraction ────────────────────────��────────────────────────

function extractSwap(tx: HeliusEnhancedTransaction): NormalizedSwap | null {
  const swap = tx.events?.swap;
  if (swap) return extractFromSwapEvent(tx, swap);
  return extractFromTransfers(tx);
}

function extractFromSwapEvent(
  tx: HeliusEnhancedTransaction,
  swap: NonNullable<HeliusEnhancedTransaction["events"]["swap"]>,
): NormalizedSwap | null {
  let inputMint: string;
  let inputAmount: number;
  let inputDecimals: number;

  if (swap.nativeInput && BigInt(swap.nativeInput.amount) > 0n) {
    inputMint = SOL_MINT;
    inputDecimals = SOL_DECIMALS;
    inputAmount = Number(swap.nativeInput.amount) / 1e9;
  } else if (swap.tokenInputs?.length > 0) {
    const ti = swap.tokenInputs[0];
    inputMint = ti.mint;
    inputDecimals = ti.rawTokenAmount.decimals;
    inputAmount = Number(ti.rawTokenAmount.tokenAmount) / 10 ** inputDecimals;
  } else {
    return null;
  }

  let outputMint: string;
  let outputAmount: number;
  let outputDecimals: number;

  if (swap.nativeOutput && BigInt(swap.nativeOutput.amount) > 0n) {
    outputMint = SOL_MINT;
    outputDecimals = SOL_DECIMALS;
    outputAmount = Number(swap.nativeOutput.amount) / 1e9;
  } else if (swap.tokenOutputs?.length > 0) {
    const to = swap.tokenOutputs[0];
    outputMint = to.mint;
    outputDecimals = to.rawTokenAmount.decimals;
    outputAmount = Number(to.rawTokenAmount.tokenAmount) / 10 ** outputDecimals;
  } else {
    return null;
  }

  const innerSwaps = swap.innerSwaps ?? [];

  return {
    signature: tx.signature,
    timestamp: tx.timestamp,
    slot: tx.slot,
    source: tx.source,
    inputMint,
    outputMint,
    inputAmount,
    outputAmount,
    inputDecimals,
    outputDecimals,
    isSinglePool: innerSwaps.length === 1,
    usesVulnerableAmm: innerSwaps.some((s) => VULNERABLE_AMMS.has(s.programId)),
  };
}

function extractFromTransfers(
  tx: HeliusEnhancedTransaction,
): NormalizedSwap | null {
  const wallet = tx.feePayer;
  const tokenSent = (tx.tokenTransfers ?? []).filter(
    (t) => t.fromUserAccount === wallet && t.tokenAmount > 0,
  );
  const tokenRecv = (tx.tokenTransfers ?? []).filter(
    (t) => t.toUserAccount === wallet && t.tokenAmount > 0,
  );
  const nativeRecv = (tx.nativeTransfers ?? []).filter(
    (t) => t.toUserAccount === wallet && t.amount > 0,
  );

  let inputMint: string;
  let inputAmount: number;
  let inputDecimals: number;

  if (tokenSent.length > 0) {
    const t = tokenSent[0];
    inputMint = normalizeMint(t.mint);
    inputDecimals = inputMint === SOL_MINT ? SOL_DECIMALS : 6;
    inputAmount = t.tokenAmount;
  } else {
    return null;
  }

  let outputMint: string;
  let outputAmount: number;
  let outputDecimals: number;

  if (tokenRecv.length > 0) {
    const t = tokenRecv[0];
    outputMint = normalizeMint(t.mint);
    outputDecimals = outputMint === SOL_MINT ? SOL_DECIMALS : 6;
    outputAmount = t.tokenAmount;
  } else if (nativeRecv.length > 0) {
    outputMint = SOL_MINT;
    outputDecimals = SOL_DECIMALS;
    outputAmount = nativeRecv.reduce((s, t) => s + t.amount, 0) / 1e9;
  } else {
    return null;
  }

  if (inputMint === outputMint) return null;

  const allProgramIds = new Set<string>();
  for (const ix of tx.instructions ?? []) {
    allProgramIds.add(ix.programId);
    for (const inner of ix.innerInstructions ?? []) {
      allProgramIds.add(inner.programId);
    }
  }
  const usesVulnerableAmm = [...allProgramIds].some((id) =>
    VULNERABLE_AMMS.has(id),
  );
  const dexCount = [...allProgramIds].filter((id) =>
    VULNERABLE_AMMS.has(id),
  ).length;

  return {
    signature: tx.signature,
    timestamp: tx.timestamp,
    slot: tx.slot,
    source: tx.source,
    inputMint,
    outputMint,
    inputAmount,
    outputAmount,
    inputDecimals,
    outputDecimals,
    isSinglePool: dexCount === 1,
    usesVulnerableAmm,
  };
}

function normalizeMint(mint: string): string {
  return mint;
}

// ── Classification ──────────────────────────────────────────────────

function classifySwap(
  swap: NormalizedSwap,
  cache: PriceCache,
  p75UsdInput: number,
): Classification {
  const clean: Classification = {
    mevType: "clean",
    confidence: "high",
    estimatedLossUsd: 0,
    lossSol: 0,
    expectedOutput: swap.outputAmount,
  };

  const inputPrice = lookupPrice(cache, swap.inputMint, swap.timestamp);
  const outputPrice = lookupPrice(cache, swap.outputMint, swap.timestamp);
  const solPrice = lookupPrice(cache, SOL_MINT, swap.timestamp) ?? 0;
  if (!inputPrice || !outputPrice || swap.inputAmount === 0) return clean;

  const fairRate = inputPrice / outputPrice;
  const actualRate = swap.outputAmount / swap.inputAmount;
  const deviation = (fairRate - actualRate) / fairRate;

  if (deviation <= 0.005 || deviation > 0.15) return clean;

  const expectedOutput = swap.inputAmount * fairRate;
  const lossTokens = expectedOutput - swap.outputAmount;
  const lossUsd = lossTokens * outputPrice;
  const lossSol = solPrice > 0 ? lossUsd / solPrice : 0;

  if (lossUsd < 0.10) return clean;

  const pairKey = `${swap.inputMint}-${swap.outputMint}`;
  const isPopularPair = POPULAR_PAIRS.has(pairKey);
  const isLargeSwap = swap.inputAmount * inputPrice >= p75UsdInput;

  let mevType: MevType;
  let confidence: Confidence;

  if (swap.isSinglePool && swap.usesVulnerableAmm && deviation > 0.01) {
    mevType = "sandwiched";
    confidence = "high";
  } else if (swap.usesVulnerableAmm && deviation > 0.008 && isPopularPair) {
    mevType = "frontrun";
    confidence = "medium";
  } else if (isLargeSwap && swap.isSinglePool && deviation > 0.005) {
    mevType = "backrun_target";
    confidence = "medium";
  } else {
    return clean;
  }

  return {
    mevType,
    confidence,
    estimatedLossUsd: round2(lossUsd),
    lossSol,
    expectedOutput,
  };
}

// ── Price cache (DeFiLlama historical) ─────────────────────────────

type PriceCache = Map<string, number>;

function hourBucket(ts: number): number {
  return Math.floor(ts / 3600) * 3600;
}

function priceKey(mint: string, ts: number): string {
  return `${mint}:${hourBucket(ts)}`;
}

function lookupPrice(
  cache: PriceCache,
  mint: string,
  ts: number,
): number | undefined {
  return cache.get(priceKey(mint, ts));
}

async function fetchHistoricalPrices(
  mints: string[],
  timestamp: number,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (mints.length === 0) return prices;

  try {
    const ids = mints.map((m) => `solana:${m}`).join(",");
    const res = await fetch(
      `https://coins.llama.fi/prices/historical/${timestamp}/${ids}`,
    );
    if (!res.ok) return prices;

    const json = (await res.json()) as {
      coins?: Record<string, { price?: number } | undefined>;
    };
    for (const [key, info] of Object.entries(json.coins ?? {})) {
      const mint = key.replace("solana:", "");
      if (info?.price) prices.set(mint, info.price);
    }
  } catch {
    // Best-effort
  }

  return prices;
}

async function buildPriceCache(swaps: NormalizedSwap[]): Promise<PriceCache> {
  const cache: PriceCache = new Map();

  const bucketMints = new Map<number, Set<string>>();
  for (const s of swaps) {
    const bucket = hourBucket(s.timestamp);
    let mints = bucketMints.get(bucket);
    if (!mints) {
      mints = new Set();
      bucketMints.set(bucket, mints);
    }
    mints.add(s.inputMint);
    mints.add(s.outputMint);
    mints.add(SOL_MINT);
  }

  const CONCURRENCY = 4;
  const entries = [...bucketMints.entries()];
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(([bucket, mints]) =>
        fetchHistoricalPrices([...mints], bucket).then((prices) => ({
          bucket,
          prices,
        })),
      ),
    );
    for (const { bucket, prices } of results) {
      for (const [mint, price] of prices) {
        cache.set(`${mint}:${bucket}`, price);
      }
    }
  }

  return cache;
}

// ── Block-level sandwich verification ──────────────────────────────

interface BlockVerification {
  confirmed: boolean;
  frontrunSig?: string;
  backrunSig?: string;
}

const WELL_KNOWN_PROGRAMS = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "ComputeBudget111111111111111111111111111111",
  "Vote111111111111111111111111111111111111111",
  SOL_MINT,
]);

interface BlockTx {
  transaction: {
    signatures: string[];
    message: { accountKeys: (string | { pubkey: string })[] };
  };
  meta: {
    err: unknown;
    fee: number;
    loadedAddresses?: { writable: string[]; readonly: string[] };
  };
}

function txAccountSet(tx: BlockTx): Set<string> {
  const keys = tx.transaction.message.accountKeys ?? [];
  const loaded = tx.meta?.loadedAddresses;
  const accounts = new Set<string>();
  for (const k of keys) {
    accounts.add(typeof k === "object" ? k.pubkey : k);
  }
  if (loaded) {
    for (const k of [...(loaded.writable ?? []), ...(loaded.readonly ?? [])]) {
      accounts.add(k);
    }
  }
  return accounts;
}

function txFeePayer(tx: BlockTx): string {
  const k = tx.transaction.message.accountKeys[0];
  return typeof k === "object" ? k.pubkey : k;
}

async function fetchBlockSwapNeighbors(
  slot: number,
  swaps: NormalizedSwap[],
  apiKey: string,
): Promise<Map<string, BlockVerification>> {
  const results = new Map<string, BlockVerification>();
  for (const s of swaps) {
    results.set(s.signature, { confirmed: false });
  }

  try {
    const res = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBlock",
          params: [
            slot,
            {
              encoding: "json",
              transactionDetails: "full",
              maxSupportedTransactionVersion: 0,
            },
          ],
        }),
      },
    );

    if (!res.ok) return results;
    const json = (await res.json()) as { result?: { transactions: BlockTx[] } };
    const txs = json.result?.transactions;
    if (!txs) return results;

    for (const swap of swaps) {
      const victimIdx = txs.findIndex(
        (t) => t.transaction.signatures[0] === swap.signature,
      );
      if (victimIdx === -1) continue;

      const victimAccounts = txAccountSet(txs[victimIdx]);
      const victimWallet = txFeePayer(txs[victimIdx]);

      const victimAmm = [...victimAccounts].find((a) =>
        VULNERABLE_AMMS.has(a),
      );
      if (!victimAmm) continue;

      const excluded = new Set([
        ...WELL_KNOWN_PROGRAMS,
        ...VULNERABLE_AMMS,
        victimWallet,
        swap.inputMint,
        swap.outputMint,
      ]);
      const poolAccounts = new Set<string>();
      for (const acc of victimAccounts) {
        if (!excluded.has(acc)) poolAccounts.add(acc);
      }

      const searchStart = Math.max(0, victimIdx - 60);
      const searchEnd = Math.min(txs.length, victimIdx + 60);

      let frontrun: { sig: string; payer: string } | null = null;
      let backrun: { sig: string; payer: string } | null = null;

      for (let i = searchStart; i < searchEnd; i++) {
        if (i === victimIdx) continue;
        const tx = txs[i];
        if (tx.meta?.err) continue;

        const accounts = txAccountSet(tx);
        const payer = txFeePayer(tx);
        if (payer === victimWallet) continue;

        if (!accounts.has(victimAmm)) continue;

        let sharedCount = 0;
        for (const a of poolAccounts) {
          if (accounts.has(a)) sharedCount++;
          if (sharedCount >= 2) break;
        }
        if (sharedCount < 2) continue;

        if (i < victimIdx && !frontrun) {
          frontrun = { sig: tx.transaction.signatures[0], payer };
        } else if (i > victimIdx && !backrun) {
          backrun = { sig: tx.transaction.signatures[0], payer };
        }

        if (frontrun && backrun) break;
      }

      if (frontrun && backrun) {
        results.set(swap.signature, {
          confirmed: true,
          frontrunSig: frontrun.sig,
          backrunSig: backrun.sig,
        });
      }
    }
  } catch {
    // Block fetch failed — leave defaults (confirmed: false)
  }

  return results;
}

// ── Helpers ─────────────────────────────────────────────────────────

function fmtDisplay(amount: number, decimals: number): string {
  if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(2) + "M";

  const dp = amount >= 1 ? 2 : Math.min(decimals, 4);
  const fixed = amount.toFixed(dp);
  const [whole, frac] = fixed.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${withCommas}.${frac}` : withCommas;
}

function emptyResult(
  wallet: string,
  page: number,
  hasMore: boolean,
): MevAnalysisResult {
  return {
    wallet,
    analyzedFrom: 0,
    analyzedTo: 0,
    totalSwaps: 0,
    swaps: [],
    page,
    hasMore,
    totalEstimatedLossUsd: 0,
    flowbackWouldReturnUsd: 0,
    flowbackWouldReturnSol: 0,
    cashbackSampleSize: 0,
    topPairsByLoss: [],
    cumulativeLoss: [],
    breakdown: { sandwiched: 0, frontrun: 0, backrunTarget: 0, clean: 0 },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Mock data ───────────────────────────────────────────────────────

function mockResult(wallet: string): MevAnalysisResult {
  const now = Date.now();
  const d = (days: number) => now - days * 86_400_000;

  return {
    wallet,
    analyzedFrom: d(28),
    analyzedTo: now,
    totalSwaps: 10,
    page: 1,
    hasMore: true,
    totalEstimatedLossUsd: 27.72,
    flowbackWouldReturnUsd: 18.52,
    flowbackWouldReturnSol: 0.124,
    cashbackSampleSize: 42,
    breakdown: { sandwiched: 4, frontrun: 1, backrunTarget: 1, clean: 4 },
    topPairsByLoss: [
      { inputMint: "SOL", outputMint: "USDC", lossUsd: 21.77 },
      { inputMint: "SOL", outputMint: "JUP", lossUsd: 4.32 },
      { inputMint: "SOL", outputMint: "BONK", lossUsd: 1.79 },
    ],
    cumulativeLoss: [
      { month: "2026-03", lossUsd: 15.64, count: 2 },
      { month: "2026-04", lossUsd: 21.77, count: 3 },
      { month: "2026-05", lossUsd: 27.72, count: 6 },
    ],
    swaps: [
      mockSwap(
        "5KqBr9mXZC8yNwHj7V4pLfG2kD3nT1bQzR6vA8eW7nXz",
        d(3),
        287114002,
        "RAYDIUM",
        "SOL",
        "USDC",
        "12.40",
        "1,847.62",
        "1,853.73",
        6.11,
        "0.041",
        "0.027",
        "sandwiched",
        "high",
      ),
      mockSwap(
        "2pHmK4sYfL9WvZxJ3qA8nC6tR5bG7dE1hN0mP2iO4qX4",
        d(3),
        287113401,
        "JUPITER",
        "USDC",
        "BONK",
        "420.00",
        "1.84M",
        "1.84M",
        0,
        "0",
        "0",
        "clean",
        "high",
      ),
      mockSwap(
        "7gNzP1qR4sT8wX2bD5fH3jK6mV9cY0eA7uL1iO3aR2k",
        d(5),
        286940817,
        "RAYDIUM",
        "SOL",
        "JUP",
        "8.90",
        "12,460",
        "12,502",
        4.32,
        "0.029",
        "0.019",
        "sandwiched",
        "high",
      ),
      mockSwap(
        "9bKeL3mN6pQ1rS4tU7vW0xY2zA5bC8dE1fG4hI7tP8c",
        d(8),
        286612904,
        "JUPITER",
        "WIF",
        "SOL",
        "1,200",
        "3.71",
        "3.71",
        0,
        "0",
        "0",
        "clean",
        "high",
      ),
      mockSwap(
        "3xAbC4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW4xY5zA6b",
        d(10),
        286421730,
        "ORCA",
        "SOL",
        "WIF",
        "4.50",
        "5,420",
        "5,444",
        1.19,
        "0.008",
        "0.005",
        "frontrun",
        "medium",
      ),
      mockSwap(
        "2yBcD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4aB5c",
        d(15),
        285900234,
        "RAYDIUM",
        "JITO",
        "SOL",
        "150",
        "1.64",
        "1.65",
        0.45,
        "0.003",
        "0.002",
        "backrun_target",
        "medium",
      ),
      mockSwap(
        "4mWpJ2kL5nH8qT1rG3sV6bA9cX0dF7eI1jK4lM2dQ1f",
        d(12),
        286209455,
        "ORCA",
        "SOL",
        "USDC",
        "6.20",
        "924.10",
        "926.78",
        2.68,
        "0.018",
        "0.012",
        "sandwiched",
        "medium",
      ),
      mockSwap(
        "1eDxQ3fR6gS9hT2iU5jV8kW1lX4mY7nZ0oP3qA6cV9j",
        d(18),
        285603171,
        "JUPITER",
        "JITO",
        "SOL",
        "84",
        "0.92",
        "0.92",
        0,
        "0",
        "0",
        "clean",
        "high",
      ),
      mockSwap(
        "8aLpN5mO2pP9qQ1rR4sS7tT0uU3vV6wW2xX8yY5fR4q",
        d(21),
        285288062,
        "RAYDIUM",
        "SOL",
        "USDC",
        "22.10",
        "3,289.40",
        "3,302.36",
        12.96,
        "0.087",
        "0.059",
        "sandwiched",
        "high",
      ),
      mockSwap(
        "6sFyG4hH7iI0jJ3kK6lL9mM2nN5oO8pP1qQ4rR7hM3w",
        d(28),
        284579308,
        "JUPITER",
        "BONK",
        "USDC",
        "2.4M",
        "532.18",
        "532.18",
        0,
        "0",
        "0",
        "clean",
        "high",
      ),
    ],
  };
}

function mockSwap(
  signature: string,
  timestamp: number,
  slot: number,
  source: string,
  inputMint: string,
  outputMint: string,
  inputAmount: string,
  actualOutputAmount: string,
  expectedOutputAmount: string,
  estimatedLossUsd: number,
  estimatedLossToken: string,
  estimatedCashbackToken: string,
  mevType: MevType,
  confidence: Confidence,
): AnalyzedSwap {
  return {
    signature,
    timestamp,
    slot,
    source,
    inputMint,
    outputMint,
    inputAmount,
    actualOutputAmount,
    expectedOutputAmount,
    estimatedLossUsd,
    estimatedLossToken,
    estimatedCashbackToken,
    mevType,
    confidence,
  };
}
