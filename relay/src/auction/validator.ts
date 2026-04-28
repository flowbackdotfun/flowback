import {
  address,
  getAddressEncoder,
  getBase58Encoder,
  signatureBytes as toSignatureBytes,
  verifySignature,
  type Address,
  type Base64EncodedWireTransaction,
  type Rpc,
  type SimulateTransactionApi,
} from "@solana/kit";

const SIMULATE_TIMEOUT_MS = 1000;

export interface BidCommitmentExpectations {
  /** UUID-shaped hint id (with or without dashes). */
  hintId: string;
  /** Base58 searcher pubkey claimed in the WS bid envelope. */
  searcherPubkey: string;
  /** Bid amount in lamports as declared in the WS envelope. */
  bidAmountLamports: bigint;
}

/**
 * Tier-2: simulate the searcher's backrun transaction against current state.
 * Cheap proxy for "is the arb still alive?" before we waste a Jito submission.
 *
 * Logs the RPC error reason on failure so the orchestrator's "skip" message
 * can be cross-referenced against the actual simulation outcome.
 */
export async function validateBackrunTx(
  txBase64: string,
  rpc: Rpc<SimulateTransactionApi>,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(txBase64, "base64");
  } catch (err) {
    console.warn(`[tier2] decode failed: ${(err as Error).message}`);
    return false;
  }
  if (bytes.length === 0) {
    console.warn("[tier2] empty backrun tx");
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMULATE_TIMEOUT_MS);

  try {
    const response = await rpc
      .simulateTransaction(txBase64 as Base64EncodedWireTransaction, {
        encoding: "base64",
        replaceRecentBlockhash: true,
        sigVerify: false,
      })
      .send({ abortSignal: controller.signal });

    if (response.value.err !== null) {
      console.warn(
        `[tier2] sim err: ${JSON.stringify(response.value.err)} logs=${JSON.stringify(response.value.logs ?? [])}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[tier2] rpc threw: ${(err as Error).message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tier-1: verify the searcher's off-chain Ed25519 signature over the canonical
 * bid commitment message. Cheap, no RPC. The same signature is later embedded
 * in the on-chain settlement tx and re-verified by the FlowBack program via
 * the Ed25519 sigverify precompile, so a Tier-1 pass is necessary but not
 * sufficient.
 */
export async function validateBidCommitment(
  bidCommitmentSig: string,
  expected: BidCommitmentExpectations,
): Promise<boolean> {
  let pubkeyAddr: Address;
  try {
    pubkeyAddr = address(expected.searcherPubkey);
  } catch {
    return false;
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = new Uint8Array(getBase58Encoder().encode(bidCommitmentSig));
  } catch {
    return false;
  }
  if (sigBytes.length !== 64) return false;

  try {
    const pubkeyBytes = getAddressEncoder().encode(pubkeyAddr) as Uint8Array;
    const message = new TextEncoder().encode(
      buildBidMessage(expected.hintId, expected.bidAmountLamports),
    );
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(pubkeyBytes),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await verifySignature(cryptoKey, toSignatureBytes(sigBytes), message);
  } catch {
    return false;
  }
}

/** Canonical bid commitment string. Must byte-match what the searcher signs and what the on-chain program reconstructs. */
export function buildBidMessage(hintId: string, bidAmount: bigint): string {
  return `flowback-bid:${normaliseHintIdHex(hintId)}:${bidAmount.toString()}`;
}

/** Strip dashes from a UUID and lower-case any hex digits. */
export function normaliseHintIdHex(hintId: string): string {
  return hintId.replace(/-/g, "").toLowerCase();
}

/** Convert a UUID-shaped hint id into its 16 raw bytes. Throws on bad input. */
export function hintIdToBytes(hintId: string): Uint8Array {
  const hex = normaliseHintIdHex(hintId);
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`hintId must encode 16 bytes of hex (got "${hintId}")`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
