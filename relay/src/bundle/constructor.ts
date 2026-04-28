import type {
  Base64EncodedWireTransaction,
  Rpc,
  SimulateTransactionApi,
} from "@solana/kit";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { buildSettleTxIxs } from "../anchor/flowback-ix.js";
import type { SearcherBid, SwapIntent } from "../auction/types.js";
import { validateBackrunTx } from "../auction/validator.js";

export class BundleValidationError extends Error {
  constructor(
    public readonly stage: "settle_build" | "backrun",
    message: string,
  ) {
    super(message);
    this.name = "BundleValidationError";
  }
}

export interface BuildJitoBundleParams {
  /** Base64 wire bytes of the user-signed Jupiter swap (already includes the jitodontfront guard at sign-time). */
  userSignedSwapTx: string;
  winnerBid: SearcherBid;
  intent: SwapIntent;
  hintId: string;
  programId: string;
  treasury: string;
  /** Relay keypair — fee payer + signer for the settlement tx (Tx3). */
  relayKeypair: Keypair;
  /** Web3.js connection used to fetch the latest blockhash for Tx3. */
  connection: Connection;
  /** Kit RPC used for tier-2 backrun simulation. */
  rpc: Rpc<SimulateTransactionApi>;
}

/**
 * Assembles the 4-transaction Jito bundle in the order required by the protocol:
 *   Tx1: User's Jupiter swap        — pre-signed by the user, passed through
 *   Tx2: Searcher's backrun arb     — pre-signed by searcher, passed through
 *   Tx3: Settlement (relay-built)   — Ed25519 sigverify + settle_from_escrow,
 *                                     signed by the relay; the searcher's
 *                                     off-chain bid commitment authorises the
 *                                     escrow debit on-chain, so the searcher
 *                                     never had to learn the user's pubkey
 *   Tx4: Searcher's Jito tip        — pre-signed by searcher, passed through
 *
 * Tier-2 simulation runs against the searcher's backrun before returning. If
 * either the settle build or the simulation fails, throws so the caller can
 * fall back to the next candidate bid.
 */
export async function buildJitoBundle(
  params: BuildJitoBundleParams,
): Promise<readonly Base64EncodedWireTransaction[]> {
  const { winnerBid, rpc } = params;

  const backrunOk = await validateBackrunTx(winnerBid.backrunTx, rpc);
  if (!backrunOk) {
    throw new BundleValidationError(
      "backrun",
      "winner backrunTx failed tier-2 simulation",
    );
  }

  let settleTxBase64: string;
  try {
    settleTxBase64 = await buildSettleTx(params);
  } catch (err) {
    throw new BundleValidationError(
      "settle_build",
      (err as Error).message ?? "failed to build settle tx",
    );
  }

  return [
    params.userSignedSwapTx as Base64EncodedWireTransaction,
    winnerBid.backrunTx as Base64EncodedWireTransaction,
    settleTxBase64 as Base64EncodedWireTransaction,
    winnerBid.tipTx as Base64EncodedWireTransaction,
  ];
}

async function buildSettleTx(params: BuildJitoBundleParams): Promise<string> {
  const programId = new PublicKey(params.programId);
  const treasury = new PublicKey(params.treasury);
  const user = new PublicKey(params.intent.user);
  const searcher = new PublicKey(params.winnerBid.searcherPubkey);

  const ixs = buildSettleTxIxs({
    programId,
    relayKeypair: params.relayKeypair,
    searcher,
    user,
    treasury,
    bidAmount: params.winnerBid.userCashbackLamports,
    bidCommitmentSig: params.winnerBid.bidCommitmentSig,
    hintId: params.hintId,
  });

  const { blockhash } = await params.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: params.relayKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([params.relayKeypair]);

  return Buffer.from(tx.serialize()).toString("base64");
}
