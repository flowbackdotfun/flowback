import type {
  Base64EncodedWireTransaction,
  Rpc,
  SendTransactionApi,
  SimulateTransactionApi,
} from "@solana/kit";
import type { Connection, Keypair } from "@solana/web3.js";

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
  | "no_valid_winner" // every candidate failed tier-2 / settle build
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
  hintId: string;
  /** User-signed Jupiter v0 tx from /prepare. Same bytes are used both for Tx1 in the bundle path and for direct submission in the fallback path. */
  userSignedSwapTx: string;
  /** Sorted desc by userCashbackLamports — AuctionManager already returns them this way. */
  bids: readonly SearcherBid[];
  programId: string;
  treasury: string;
  /** Relay keypair — fee payer + signer for the on-chain settlement tx (Tx3). */
  relayKeypair: Keypair;
  /** Web3.js connection used to fetch the latest blockhash for Tx3. */
  connection: Connection;
  rpc: Rpc<SimulateTransactionApi & SendTransactionApi>;
  maxCandidates?: number;
  /** Fires immediately before `submitBundle` — the caller can register pending state keyed by `winnerBid` while the on-chain settle log still hasn't been observed. */
  onBeforeBundleSubmit?: (winnerBid: SearcherBid) => void;
  /** Called as soon as Jito accepts a bundle UUID, before we wait on the result stream. Lets the caller emit a `bundle_submitted` frontend event early. */
  onBundleSubmitted?: (bundleId: string, winnerBid: SearcherBid) => void;
}

/**
 * Post-close pipeline. Two paths, one return type:
 *
 *   bids empty     → submit the user-signed Jupiter swap via plain RPC,
 *                    return status: 'fallback' with txSignature.
 *   bids present   → walk the top candidates; for each, run tier-2 simulation
 *                    and build the relay-signed settle tx. If both succeed,
 *                    submit the bundle and wait on the Jito result stream for
 *                    a terminal state. Skip candidates that fail validation
 *                    or that Jito 'fails'. 'landed' and 'timeout' stop the loop.
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
    console.log(
      `[orch] candidate  hint=${params.hintId.slice(0, 8)}  attempt=${attempts}  searcher=${winnerBid.searcherPubkey.slice(0, 6)}…  bid=${winnerBid.userCashbackLamports}`,
    );
    let wireTxs: readonly Base64EncodedWireTransaction[];
    try {
      wireTxs = await buildJitoBundle({
        userSignedSwapTx: params.userSignedSwapTx,
        winnerBid,
        intent: params.intent,
        hintId: params.hintId,
        programId: params.programId,
        treasury: params.treasury,
        relayKeypair: params.relayKeypair,
        connection: params.connection,
        rpc: params.rpc,
      });
    } catch (err) {
      if (err instanceof BundleValidationError) {
        console.warn(
          `[orch] skip       hint=${params.hintId.slice(0, 8)}  stage=${err.stage}  reason="${err.message}"`,
        );
        continue;
      }
      throw err;
    }

    console.log(
      `[orch] submit     hint=${params.hintId.slice(0, 8)}  txs=${wireTxs.length}`,
    );
    // Notify before submitting: the on-chain `CashbackSettled` log can fire
    // before `submitBundle` resolves (validator commits faster than the JS
    // confirmTransaction round-trip), so any indexer-side state must be in
    // place by now.
    params.onBeforeBundleSubmit?.(winnerBid);
    const bundleId = await submitBundle(wireTxs);
    params.onBundleSubmitted?.(bundleId, winnerBid);
    const status: BundleStatus = await pollBundleStatus(bundleId);
    console.log(
      `[orch] result     hint=${params.hintId.slice(0, 8)}  bundleId=${bundleId.slice(0, 8)}…  status=${status}`,
    );

    if (status === "landed") {
      return { status: "landed", bundleId, winnerBid, attempts };
    }
    if (status === "timeout") {
      return { status: "timeout", bundleId, winnerBid, attempts };
    }
    // 'failed' — try the next candidate.
  }

  console.warn(
    `[orch] no winner  hint=${params.hintId.slice(0, 8)}  attempts=${attempts}`,
  );
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
