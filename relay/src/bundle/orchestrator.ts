import type {
  Base64EncodedWireTransaction,
  Rpc,
  SendTransactionApi,
  SimulateTransactionApi,
} from "@solana/kit";

import type { SearcherBid, SwapIntent } from "../auction/types.js";
import {
  buildJitoBundle,
  BundleValidationError,
} from "./constructor.js";
import {
  pollBundleStatus,
  submitBundle,
  type BundleStatus,
} from "./submitter.js";

const DEFAULT_MAX_CANDIDATES = 3;

export type OrchestrateStatus =
  | "landed" // bundle confirmed on-chain
  | "failed" // every candidate bundle was rejected by Jito
  | "timeout" // Jito stream timed out for the winning candidate
  | "no_valid_winner" // every candidate failed tier-1 or tier-2 validation
  | "fallback"; // no bids — user-signed Jupiter swap submitted via plain RPC

export interface OrchestrateResult {
  status: OrchestrateStatus;
  bundleId?: string;
  winnerBid?: SearcherBid;
  txSignature?: string;
  attempts: number;
}

export interface OrchestrateSwapParams {
  intent: SwapIntent;
  // User-signed Jupiter v0 tx from /prepare. Same bytes are used both for Tx1
  // in the bundle path and for direct submission in the fallback path.
  userSignedSwapTx: string;
  // Sorted desc by userCashbackLamports — AuctionManager already returns them this way.
  bids: readonly SearcherBid[];
  programId: string;
  treasury: string;
  rpc: Rpc<SimulateTransactionApi & SendTransactionApi>;
  maxCandidates?: number;
  // Called as soon as Jito accepts a bundle UUID, before we wait on the result
  // stream. Lets the caller emit a `bundle_submitted` frontend event early.
  onBundleSubmitted?: (bundleId: string, winnerBid: SearcherBid) => void;
}

/**
 * Post-close pipeline. Two paths, one return type:
 *
 *   bids empty     → submit the user-signed Jupiter swap via plain RPC,
 *                    return status: 'fallback' with txSignature.
 *   bids present   → walk the top candidates; for each, validate + submit the
 *                    bundle and wait on the Jito gRPC stream for a terminal
 *                    state. Skip candidates that fail validation or that Jito
 *                    'fails'. 'landed' and 'timeout' stop the loop.
 */
export async function orchestrateSwap(
  params: OrchestrateSwapParams,
): Promise<OrchestrateResult> {
  if (params.bids.length === 0) {
    const txSignature = await executeFallbackSwap(params);
    return { status: "fallback", txSignature, attempts: 0 };
  }

  const maxCandidates = params.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const candidates = params.bids.slice(0, maxCandidates);
  let attempts = 0;

  for (const winnerBid of candidates) {
    attempts++;
    let wireTxs: readonly Base64EncodedWireTransaction[];
    try {
      wireTxs = await buildJitoBundle({
        userSignedSwapTx: params.userSignedSwapTx,
        winnerBid,
        cashbackExpectations: {
          programId: params.programId,
          user: params.intent.user,
          treasury: params.treasury,
          bidAmountLamports: winnerBid.userCashbackLamports,
        },
        rpc: params.rpc,
      });
    } catch (err) {
      if (err instanceof BundleValidationError) continue;
      throw err;
    }

    const bundleId = await submitBundle(wireTxs);
    params.onBundleSubmitted?.(bundleId, winnerBid);
    const status: BundleStatus = await pollBundleStatus(bundleId);

    if (status === "landed") {
      return { status: "landed", bundleId, winnerBid, attempts };
    }
    if (status === "timeout") {
      return { status: "timeout", bundleId, winnerBid, attempts };
    }
    // 'failed' — try the next candidate.
  }

  return { status: "no_valid_winner", attempts };
}

async function executeFallbackSwap(
  params: OrchestrateSwapParams,
): Promise<string> {
  return params.rpc
    .sendTransaction(
      params.userSignedSwapTx as Base64EncodedWireTransaction,
      { encoding: "base64" },
    )
    .send();
}
