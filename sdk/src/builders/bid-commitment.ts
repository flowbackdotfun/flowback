import bs58 from "bs58";

import type { Signer } from "../types.js";

/**
 * Build the canonical bid commitment string the searcher signs and the
 * FlowBack program later reconstructs and verifies on-chain. Strips dashes
 * from UUID-shaped hint ids so the encoding matches the program's
 * `build_bid_message` byte-for-byte.
 *
 * Format: `flowback-bid:<lowercase 32-char hex>:<decimal bidAmount>`
 */
export function buildBidMessage(hintId: string, bidAmount: bigint): string {
  return `flowback-bid:${normaliseHintIdHex(hintId)}:${bidAmount.toString()}`;
}

function normaliseHintIdHex(hintId: string): string {
  return hintId.replace(/-/g, "").toLowerCase();
}

export interface SignBidCommitmentParams {
  signer: Signer;
  /** Hint id from the relay's broadcast (UUID, with or without dashes). */
  hintId: string;
  /** Bid amount in lamports — must equal `userCashbackLamports` in the bid. */
  bidAmount: bigint;
}

/**
 * Sign the off-chain bid commitment. The returned base58 string travels in
 * the WS bid envelope and is later embedded by the relay into an Ed25519
 * sigverify instruction; the FlowBack program reads that instruction via
 * `Sysvar::Instructions` to authorise the escrow debit.
 *
 * The searcher never reveals the user's pubkey here — the message binds
 * `(hintId, bidAmount)` only.
 */
export async function signBidCommitment(
  params: SignBidCommitmentParams,
): Promise<string> {
  const message = new TextEncoder().encode(
    buildBidMessage(params.hintId, params.bidAmount),
  );
  const sig = await params.signer.signMessage(message);
  return bs58.encode(sig);
}
