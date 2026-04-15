import type { JupiterQuoteResponse } from "../jupiter/client.js";

export type SizeBucket = "small" | "medium" | "large" | "whale";

export type AuctionStatus = "open" | "closed" | "settled" | "fallback";

export interface SwapIntent {
  user: string;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  maxSlippageBps: number;
  deadline: number;
  nonce: string;
  signature: string;
}

export interface TokenPair {
  inputMint: string;
  outputMint: string;
}

export interface SearcherHint {
  hintId: string;
  tokenPair: TokenPair;
  sizeBucket: SizeBucket;
  priceImpactBps: number;
  auctionDeadlineMs: number;
}

export interface SearcherBid {
  hintId: string;
  searcherPubkey: string;
  userCashbackLamports: bigint;
  jitoTipLamports: bigint;
  backrunTx: string;
  cashbackTx: string;
  tipTx: string;
  receivedAt: number;
}

export interface AuctionState {
  hintId: string;
  intent: SwapIntent;
  jupiterQuote: JupiterQuoteResponse;
  bids: SearcherBid[];
  status: AuctionStatus;
  createdAt: number;
  resolve: (bidsByCashbackDesc: SearcherBid[]) => void;
}

export interface AuctionResult {
  hintId: string;
  won: boolean;
  yourBid: bigint | null;
  winningBid: bigint | null;
}
