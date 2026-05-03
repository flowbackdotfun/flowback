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

const SOL_MINT = "So11111111111111111111111111111111";
const SOL_DECIMALS = 9;
const MOCK_MODE = process.env.MOCK_CALCULATOR_VALUE === "true";
const DEFAULT_CASHBACK_RATIO = 0.003;

const VULNERABLE_AMMS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
]);

const POPULAR_PAIRS = new Set([
  `${SOL_MINT}-EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
  `${SOL_MINT}-Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`,
]);

const MINT_SYMBOLS: Record<string, string> = {
  [SOL_MINT]: "SOL",
  So11111111111111111111111111111111111111112: "SOL",
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

  const uniqueMints = new Set<string>();
  for (const s of normalized) {
    uniqueMints.add(s.inputMint);
    uniqueMints.add(s.outputMint);
  }
  const prices = await fetchTokenPrices([...uniqueMints]);
  const solPrice = prices.get(SOL_MINT) ?? 0;

  const cashbackRatios = await getCashbackRatios();
  const totalSampleSize = [...cashbackRatios.values()].reduce(
    (sum, s) => sum + s.sampleSize,
    0,
  );

  const inputUsdValues = normalized
    .map((s) => s.inputAmount * (prices.get(s.inputMint) ?? 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const p75 =
    inputUsdValues.length > 0
      ? inputUsdValues[Math.floor(inputUsdValues.length * 0.75)]
      : 0;

  const allSwaps: AnalyzedSwap[] = [];
  const breakdown = { sandwiched: 0, frontrun: 0, backrunTarget: 0, clean: 0 };
  const pairLosses = new Map<
    string,
    { inputMint: string; outputMint: string; lossUsd: number }
  >();
  const monthlyLosses = new Map<string, { lossUsd: number; count: number }>();
  let totalLossUsd = 0;
  let totalCashbackSol = 0;

  for (const swap of normalized) {
    const c = classifySwap(swap, prices, p75);

    const key = c.mevType === "backrun_target" ? "backrunTarget" : c.mevType;
    breakdown[key]++;

    let cashbackSol = 0;
    if (c.mevType !== "clean") {
      const inputPrice = prices.get(swap.inputMint) ?? 0;
      const inputSolEquiv =
        solPrice > 0 ? (swap.inputAmount * inputPrice) / solPrice : 0;
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

const SOL_FULL_MINT = "So11111111111111111111111111111111111111112";

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
    isSinglePool: false,
    usesVulnerableAmm: false,
  };
}

function normalizeMint(mint: string): string {
  return mint === SOL_FULL_MINT ? SOL_MINT : mint;
}

// ── Classification ──────────────────────────────────────────────────

function classifySwap(
  swap: NormalizedSwap,
  prices: Map<string, number>,
  p75UsdInput: number,
): Classification {
  const clean: Classification = {
    mevType: "clean",
    confidence: "high",
    estimatedLossUsd: 0,
    lossSol: 0,
    expectedOutput: swap.outputAmount,
  };

  const inputPrice = prices.get(swap.inputMint);
  const outputPrice = prices.get(swap.outputMint);
  const solPrice = prices.get(SOL_MINT) ?? 0;
  if (!inputPrice || !outputPrice || swap.inputAmount === 0) return clean;

  const fairRate = inputPrice / outputPrice;
  const actualRate = swap.outputAmount / swap.inputAmount;
  const deviation = (fairRate - actualRate) / fairRate;

  if (deviation <= 0.001 || deviation > 0.05) return clean;

  const expectedOutput = swap.inputAmount * fairRate;
  const lossTokens = expectedOutput - swap.outputAmount;
  const lossUsd = lossTokens * outputPrice;
  const lossSol = solPrice > 0 ? lossUsd / solPrice : 0;

  const pairKey = `${swap.inputMint}-${swap.outputMint}`;
  const isPopularPair = POPULAR_PAIRS.has(pairKey);
  const isLargeSwap = swap.inputAmount * inputPrice >= p75UsdInput;

  let mevType: MevType;
  let confidence: Confidence;

  if (swap.isSinglePool && swap.usesVulnerableAmm && deviation > 0.005) {
    mevType = "sandwiched";
    confidence = "high";
  } else if (swap.usesVulnerableAmm && deviation > 0.003 && isPopularPair) {
    mevType = "frontrun";
    confidence = "medium";
  } else if (isLargeSwap && swap.isSinglePool && deviation > 0.001) {
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

// ── Helpers ─────────────────────────────────────────────────────────

async function fetchTokenPrices(mints: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (mints.length === 0) return prices;

  try {
    const ids = mints.join(",");
    const res = await fetch(
      `${process.env.JUPITER_PRICE_BASE_URL ?? "https://api.jup.ag"}/price/v2?ids=${ids}`,
    );
    if (!res.ok) return prices;

    const json = (await res.json()) as {
      data: Record<string, { price: string } | undefined>;
    };
    for (const [mint, info] of Object.entries(json.data)) {
      if (info?.price) prices.set(mint, Number(info.price));
    }
  } catch {
    // Best-effort
  }

  return prices;
}

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
