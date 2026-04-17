import type {
  Base64EncodedWireTransaction,
  Rpc,
  SimulateTransactionApi,
} from "@solana/kit";

import type { SearcherBid } from "../auction/types.js";
import {
  validateBackrunTx,
  validateCashbackTx,
  type CashbackTxExpectations,
} from "../auction/validator.js";

export class BundleValidationError extends Error {
  constructor(
    public readonly stage: "cashback" | "backrun",
    message: string,
  ) {
    super(message);
    this.name = "BundleValidationError";
  }
}

export interface BuildJitoBundleParams {
  // Base64 wire bytes of the user-signed Jupiter swap (already includes
  // the jitodontfront guard at sign-time).
  userSignedSwapTx: string;
  winnerBid: SearcherBid;
  cashbackExpectations: CashbackTxExpectations;
  rpc: Rpc<SimulateTransactionApi>;
}

/**
 * Assembles the 4-transaction Jito bundle in the order required by the protocol:
 *   Tx1: User's Jupiter swap        — pre-signed by the user, passed through
 *   Tx2: Searcher's backrun arb     — pre-signed by searcher, passed through
 *   Tx3: Searcher's settle_cashback — pre-signed by searcher, passed through
 *   Tx4: Searcher's Jito tip        — pre-signed by searcher, passed through
 *
 * Runs both validation tiers against the winner before returning:
 *   1. Decode cashbackTx and verify programId, discriminator, bid_amount, user, treasury
 *   2. Simulate backrunTx on the RPC with replaceRecentBlockhash
 * Throws BundleValidationError on either failure so the caller can fall back
 * to the next candidate bid.
 */
export async function buildJitoBundle(
  params: BuildJitoBundleParams,
): Promise<readonly Base64EncodedWireTransaction[]> {
  const { winnerBid, cashbackExpectations, rpc } = params;

  if (!validateCashbackTx(winnerBid.cashbackTx, cashbackExpectations)) {
    throw new BundleValidationError(
      "cashback",
      "winner cashbackTx failed tier-1 semantic validation",
    );
  }

  const backrunOk = await validateBackrunTx(winnerBid.backrunTx, rpc);
  if (!backrunOk) {
    throw new BundleValidationError(
      "backrun",
      "winner backrunTx failed tier-2 simulation",
    );
  }

  return [
    params.userSignedSwapTx as Base64EncodedWireTransaction,
    winnerBid.backrunTx as Base64EncodedWireTransaction,
    winnerBid.cashbackTx as Base64EncodedWireTransaction,
    winnerBid.tipTx as Base64EncodedWireTransaction,
  ];
}
