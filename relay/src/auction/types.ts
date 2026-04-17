export type SizeBucket = "small" | "medium" | "large" | "whale";

export interface AuctionMarketContext {
  priceImpactPct: string;
}

export type AuctionStatus = "open" | "closed" | "settled" | "fallback";

export interface SwapIntent {
  user: string;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  maxSlippageBps: number;
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
  market: AuctionMarketContext;
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
