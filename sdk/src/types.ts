import type { PublicKey } from "@solana/web3.js";

/**
 * Coarse size classification the relay broadcasts to obscure exact swap
 * amounts while still letting searchers gauge profitability.
 */
export type SizeBucket = "small" | "medium" | "large" | "whale";

export interface TokenPair {
  inputMint: string;
  outputMint: string;
}

/**
 * Hint broadcast by the relay to every authenticated searcher when a new
 * auction opens. Searchers have until `auctionDeadlineMs` (Unix ms) to
 * submit a bid via {@link FlowbackSearcher.submitBid}.
 *
 * The hint deliberately omits the user's wallet address and the exact swap
 * size — only the token pair, a coarse size bucket, and the price-impact
 * estimate are revealed pre-auction. The user pubkey is **never** revealed
 * to searchers: the searcher signs an off-chain bid commitment binding only
 * `(hintId, bidAmount)`, and the relay constructs the on-chain settlement tx
 * itself, with the FlowBack program verifying the searcher's signature via
 * Solana's Ed25519 sigverify precompile.
 */
export interface SearcherHint {
  hintId: string;
  tokenPair: TokenPair;
  sizeBucket: SizeBucket;
  priceImpactBps: number;
  auctionDeadlineMs: number;
}

/**
 * Outcome message sent by the relay after the 200 ms auction window closes.
 * Every searcher who submitted a bid for the matching `hintId` receives one.
 */
export interface AuctionResult {
  hintId: string;
  won: boolean;
  yourBid: bigint;
  winningBid: bigint | null;
}

export interface AuthMessage {
  type: "auth";
  pubkey: string;
  signature: string;
  timestamp: number;
}

/**
 * The wire-shape of a bid submission. Lamport amounts are decimal strings on
 * the wire; the SDK accepts `bigint` and serialises for you in
 * {@link FlowbackSearcher.submitBid}.
 */
export interface BidWireMessage {
  type: "bid";
  hintId: string;
  userCashbackLamports: string;
  jitoTipLamports: string;
  backrunTx: string;
  tipTx: string;
  bidCommitmentSig: string;
}

/** Convenience input shape passed into {@link FlowbackSearcher.submitBid}. */
export interface BidInput {
  hintId: string;
  userCashbackLamports: bigint;
  jitoTipLamports: bigint;
  backrunTx: string;
  tipTx: string;
  /**
   * Base58 Ed25519 signature over `flowback-bid:<hex hintId>:<bidAmount>`.
   * Produce with {@link signBidCommitment}.
   */
  bidCommitmentSig: string;
}

export type ServerMessage =
  | { type: "auth_ok" }
  | { type: "bid_accepted"; hintId: string }
  | { type: "bid_rejected"; hintId: string; reason: string }
  | { type: "hint"; hintId: string; tokenPair: TokenPair; sizeBucket: SizeBucket; priceImpactBps: number; auctionDeadlineMs: number }
  | { type: "auction_result"; hintId: string; won: boolean; yourBid: string; winningBid: string | null }
  | { type: "error"; reason: string };

/**
 * Minimal signing surface the SDK needs. A raw `Keypair` works via the
 * {@link keypairSigner} adapter; remote signers (KMS, HSM, hardware wallets)
 * can implement this directly.
 */
export interface Signer {
  publicKey: PublicKey;
  signMessage(bytes: Uint8Array): Promise<Uint8Array>;
  signTransaction<T extends { partialSign: (...keys: any[]) => void }>(tx: T): Promise<T>;
}

export interface ClientConfig {
  /** Full WS URL including the `/searcher` path. e.g. `ws://localhost:3001/searcher`. */
  relayUrl: string;
  /** Searcher signer. The pubkey is sent in the auth message and must match the escrow PDA's stored owner. */
  signer: Signer;
  /** FlowBack on-chain program ID (base58). */
  programId: string;
  /** Solana JSON-RPC URL — used for `getLatestBlockhash`. */
  rpcUrl: string;
  /** Override Jito tip accounts (base58). Defaults to the canonical eight. */
  tipAccounts?: string[];
}
