import {
  address,
  getAddressEncoder,
  getBase64Encoder,
  getTransactionDecoder,
  signatureBytes as toSignatureBytes,
  verifySignature,
  type Rpc,
  type SendTransactionApi,
  type SimulateTransactionApi,
} from "@solana/kit";
import type { Connection, Keypair } from "@solana/web3.js";

import { AuctionManager, bucketFor } from "../auction/manager.js";
import type { SearcherBid, SwapIntent } from "../auction/types.js";
import {
  orchestrateSwap,
  type OrchestrateResult,
  type OrchestrateStatus,
} from "../bundle/orchestrator.js";
import { db as defaultDb } from "../db/client.js";
import { auctions } from "../db/schema.js";
import type { SearcherWsRegistry } from "../ws/searcher.js";
import type { UserStatusEmitter } from "../ws/user.js";
import { PreparedSwapStore, type PreparedSwap } from "./prepare-store.js";

type Db = typeof defaultDb;

export class UnknownPrepareIdError extends Error {
  constructor() {
    super("unknown_or_expired_prepare_id");
    this.name = "UnknownPrepareIdError";
  }
}

export class SignedTxMismatchError extends Error {
  constructor() {
    super("signed_tx_does_not_match_prepared");
    this.name = "SignedTxMismatchError";
  }
}

export class InvalidSignatureError extends Error {
  constructor() {
    super("invalid_signature");
    this.name = "InvalidSignatureError";
  }
}

export interface IntentServiceDeps {
  auctionManager: AuctionManager;
  registry: SearcherWsRegistry;
  emitter: UserStatusEmitter;
  store: PreparedSwapStore;
  programId: string;
  treasury: string;
  rpc: Rpc<SimulateTransactionApi & SendTransactionApi>;
  /** Relay keypair — signs the on-chain settlement tx (Tx3). */
  relayKeypair: Keypair;
  /** Web3.js connection used to fetch recent blockhashes for Tx3. */
  connection: Connection;
  db?: Db;
}

export interface SubmitIntentInput {
  prepareId: string;
  signedTx: string; // base64 wire bytes
}

export interface SubmitIntentResult {
  auctionId: string;
}

/**
 * Validates a user-signed swap tx against the earlier /prepare entry and
 * dispatches the auction.
 *
 * Synchronous steps (before returning the auctionId):
 *   1. look up the prepared swap by prepareId (one-shot take)
 *   2. decode the signed tx; verify its messageBytes match the prepared ones
 *   3. verify the user's Ed25519 signature on the tx message
 *   4. start the 200ms auction using the prepared market context
 *
 * Asynchronous continuation (kicked off, not awaited):
 *   - await auction close, run bundle/fallback pipeline (Tx1 = user-signed)
 *   - notify bidding searchers of the auction result
 *   - emit WS updates to the subscribed frontend
 *   - persist the auction row
 */
export async function submitIntent(
  input: SubmitIntentInput,
  deps: IntentServiceDeps,
): Promise<SubmitIntentResult> {
  const prepared = deps.store.take(input.prepareId);
  if (!prepared) throw new UnknownPrepareIdError();

  const signedTxBytes = base64Encoder.encode(input.signedTx);
  let signedMessageBytes: Uint8Array;
  let userSignatureBytes: Uint8Array;
  try {
    const decoded = getTransactionDecoder().decode(signedTxBytes);
    signedMessageBytes = new Uint8Array(decoded.messageBytes);
    const sig = decoded.signatures[address(prepared.user)];
    if (!sig) throw new InvalidSignatureError();
    userSignatureBytes = new Uint8Array(sig);
  } catch (err) {
    if (err instanceof InvalidSignatureError) throw err;
    throw new InvalidSignatureError();
  }

  if (!bytesEqual(signedMessageBytes, prepared.messageBytes)) {
    throw new SignedTxMismatchError();
  }

  if (!(await verifyUserSignature(prepared.user, userSignatureBytes, signedMessageBytes))) {
    throw new InvalidSignatureError();
  }

  const intent: SwapIntent = {
    user: prepared.user,
    inputMint: prepared.inputMint,
    outputMint: prepared.outputMint,
    inputAmount: prepared.inputAmount,
    minOutputAmount: prepared.minOutputAmount,
    maxSlippageBps: prepared.maxSlippageBps,
  };

  const { hintId, resolved } = deps.auctionManager.startAuction(intent, {
    priceImpactPct: prepared.priceImpactPct,
  });

  void finalizeAuction({
    intent,
    hintId,
    prepared,
    signedTx: input.signedTx,
    resolvedBids: resolved,
    deps,
  });

  return { auctionId: hintId };
}

interface FinalizeParams {
  intent: SwapIntent;
  hintId: string;
  prepared: PreparedSwap;
  signedTx: string;
  resolvedBids: Promise<SearcherBid[]>;
  deps: IntentServiceDeps;
}

async function finalizeAuction(args: FinalizeParams): Promise<void> {
  let bids: SearcherBid[] = [];
  let result: OrchestrateResult | null = null;

  try {
    bids = await args.resolvedBids;
    result = await orchestrateSwap({
      intent: args.intent,
      hintId: args.hintId,
      userSignedSwapTx: args.signedTx,
      bids,
      programId: args.deps.programId,
      treasury: args.deps.treasury,
      relayKeypair: args.deps.relayKeypair,
      connection: args.deps.connection,
      rpc: args.deps.rpc,
      onBundleSubmitted: (bundleId) => {
        args.deps.emitter.emitBundleSubmitted(args.hintId, bundleId);
      },
    });

    args.deps.registry.sendAuctionResult({
      hintId: args.hintId,
      bids,
      winnerPubkey: result.winnerBid?.searcherPubkey ?? null,
      winningBidLamports: result.winnerBid?.userCashbackLamports ?? null,
    });

    if (result.status === "fallback" && result.txSignature) {
      args.deps.emitter.emitFallbackExecuted(args.hintId, result.txSignature);
    }
  } catch (err) {
    console.error(
      `[intent-service] orchestration error for ${args.hintId}:`,
      err,
    );
  } finally {
    try {
      await persistAuction(
        args.deps.db ?? defaultDb,
        args.intent,
        args.hintId,
        bids,
        result,
      );
    } catch (err) {
      console.error(
        `[intent-service] persist error for ${args.hintId}:`,
        err,
      );
    }
  }
}

async function persistAuction(
  db: Db,
  intent: SwapIntent,
  hintId: string,
  bids: readonly SearcherBid[],
  result: OrchestrateResult | null,
): Promise<void> {
  await db.insert(auctions).values({
    hintId,
    userPubkey: intent.user,
    inputMint: intent.inputMint,
    outputMint: intent.outputMint,
    inputAmountLamports: intent.inputAmount,
    sizeBucket: bucketFor(intent.inputAmount),
    winnerPubkey: result?.winnerBid?.searcherPubkey ?? null,
    winningBidLamports: result?.winnerBid?.userCashbackLamports ?? null,
    totalBids: bids.length,
    bundleId: result?.bundleId ?? null,
    status: toAuctionStatus(result?.status, bids.length),
    settledAt: new Date(),
  });
}

function toAuctionStatus(
  status: OrchestrateStatus | undefined,
  bidsCount: number,
): string {
  if (!status) return "failed";
  if (status === "landed") return "won";
  if (status === "fallback") return bidsCount === 0 ? "no_bids" : "fallback";
  return "failed";
}

const base64Encoder = getBase64Encoder();

async function verifyUserSignature(
  userPubkey: string,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  try {
    if (signature.length !== 64) return false;
    const userAddr = address(userPubkey);
    const pubkeyBytes = getAddressEncoder().encode(userAddr) as Uint8Array;
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(pubkeyBytes),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await verifySignature(
      cryptoKey,
      toSignatureBytes(signature),
      message,
    );
  } catch {
    return false;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
