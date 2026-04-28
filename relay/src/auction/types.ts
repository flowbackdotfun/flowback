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
  tipTx: string;
  /**
   * Base58 Ed25519 signature by the searcher over the canonical bid
   * commitment message: `flowback-bid:<hex hintId>:<decimal bidAmount>`.
   * The settlement tx (built by the relay) embeds this signature in an
   * Ed25519Program instruction; the FlowBack program verifies it via the
   * instructions sysvar before debiting the searcher's escrow PDA.
   */
  bidCommitmentSig: string;
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
