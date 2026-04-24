import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { Base64EncodedWireTransaction } from "@solana/kit";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { BundleResult } from "jito-ts/dist/gen/block-engine/bundle.js";
import {
  searcherClient,
  type SearcherClient,
} from "jito-ts/dist/sdk/block-engine/searcher.js";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types.js";

const MOCK_JITO = process.env.MOCK_JITO === "true";

const JITO_BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL;
if (!MOCK_JITO && !JITO_BLOCK_ENGINE_URL) {
  throw new Error("JITO_BLOCK_ENGINE_URL is not set");
}

const WAIT_TIMEOUT_MS = 30_000;
const MAX_TXS_PER_BUNDLE = 5;
const STREAM_RESUBSCRIBE_DELAY_MS = 1_000;

export type BundleStatus = "landed" | "failed" | "timeout";

export class JitoError extends Error {
  constructor(
    public readonly method: string,
    message: string,
  ) {
    super(`Jito ${method}: ${message}`);
    this.name = "JitoError";
  }
}

let clientSingleton: SearcherClient | null = null;
const pendingByBundleId = new Map<string, (status: BundleStatus) => void>();

/**
 * Submits the 4-tx bundle (base64 wire format from the bundle constructor) to
 * the Jito block engine via jito-ts's gRPC searcher client and returns the
 * bundle UUID.
 */
export async function submitBundle(
  transactions: readonly Base64EncodedWireTransaction[],
): Promise<string> {
  if (MOCK_JITO) {
    const bundleId = randomUUID();
    console.log("[jito-mock] submitBundle →", bundleId, `(${transactions.length} txs)`);
    return bundleId;
  }

  const txs = transactions.map((b64) =>
    VersionedTransaction.deserialize(Buffer.from(b64, "base64")),
  );
  const bundle = new Bundle(txs, MAX_TXS_PER_BUNDLE);
  const result = await getClient().sendBundle(bundle);
  if (!result.ok) {
    throw new JitoError("sendBundle", result.error.message);
  }
  return result.value;
}

/**
 * Resolves when Jito reports a terminal state for the given bundle, or after
 * 30s. Backed by a single persistent `onBundleResult` stream — no polling,
 * no rate-limit risk regardless of how many bundles are in flight.
 *
 *   'landed'  — bundle reached processed or finalized commitment
 *   'failed'  — rejected or dropped by the block engine
 *   'timeout' — no terminal result within 30s
 */
export async function pollBundleStatus(bundleId: string): Promise<BundleStatus> {
  if (MOCK_JITO) {
    console.log("[jito-mock] pollBundleStatus →", bundleId, "→ landed");
    return "landed";
  }

  getClient();
  return new Promise<BundleStatus>((resolve) => {
    const timeout = setTimeout(() => {
      pendingByBundleId.delete(bundleId);
      resolve("timeout");
    }, WAIT_TIMEOUT_MS);

    pendingByBundleId.set(bundleId, (status) => {
      clearTimeout(timeout);
      resolve(status);
    });
  });
}

function getClient(): SearcherClient {
  if (clientSingleton) return clientSingleton;
  clientSingleton = searcherClient(JITO_BLOCK_ENGINE_URL!, loadAuthKeypair());
  subscribeBundleResults(clientSingleton);
  return clientSingleton;
}

function loadAuthKeypair(): Keypair | undefined {
  const raw = process.env.RELAY_KEYPAIR;
  if (!raw) return undefined;
  const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  return Keypair.fromSecretKey(bytes);
}

function subscribeBundleResults(client: SearcherClient): void {
  client.onBundleResult(handleBundleResult, (err) => {
    console.error("[jito] bundle result stream error:", err.message);
    setTimeout(
      () => subscribeBundleResults(client),
      STREAM_RESUBSCRIBE_DELAY_MS,
    );
  });
}

function handleBundleResult(result: BundleResult): void {
  const resolver = pendingByBundleId.get(result.bundleId);
  if (!resolver) return;

  if (result.finalized || result.processed) {
    pendingByBundleId.delete(result.bundleId);
    resolver("landed");
    return;
  }
  if (result.rejected || result.dropped) {
    pendingByBundleId.delete(result.bundleId);
    resolver("failed");
    return;
  }
  // `accepted` — forwarded to a validator but not yet landed; keep waiting.
}
