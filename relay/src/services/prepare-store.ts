import type { JupiterBuildResponse } from "../jupiter/client.js";

export interface PreparedSwap {
  prepareId: string;
  user: string;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  maxSlippageBps: number;
  priceImpactPct: string;
  unsignedTxBase64: string;
  messageBytes: Uint8Array;
  jupiterBuild: JupiterBuildResponse;
  createdAt: number;
  expiresAt: number;
}

/**
 * Short-lived in-memory store for unsigned swap transactions. Frontends get a
 * prepareId from POST /prepare, sign the attached tx, then POST /intent with
 * {prepareId, signedTx}. The intent service `take`s the entry (one-shot) and
 * cross-checks the signed tx's message bytes against the prepared ones.
 */
export class PreparedSwapStore {
  private readonly entries = new Map<
    string,
    { data: PreparedSwap; timer: NodeJS.Timeout }
  >();

  put(swap: PreparedSwap): void {
    this.removeInternal(swap.prepareId);
    const ttlMs = Math.max(1_000, swap.expiresAt - Date.now());
    const timer = setTimeout(() => {
      this.entries.delete(swap.prepareId);
    }, ttlMs);
    timer.unref();
    this.entries.set(swap.prepareId, { data: swap, timer });
  }

  take(prepareId: string): PreparedSwap | null {
    const entry = this.entries.get(prepareId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.entries.delete(prepareId);
    return entry.data;
  }

  size(): number {
    return this.entries.size;
  }

  private removeInternal(prepareId: string): void {
    const existing = this.entries.get(prepareId);
    if (!existing) return;
    clearTimeout(existing.timer);
    this.entries.delete(prepareId);
  }
}
