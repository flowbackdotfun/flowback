/**
 * In-memory map of bundles whose settle tx has been submitted on-chain but
 * whose `CashbackSettled` log hasn't been observed yet by the indexer.
 *
 * The on-chain event carries `(user, searcher, bid_amount)` but no `hint_id`.
 * Without this registry the indexer would have to ask the DB which auction
 * those three values belong to — and because `persistAuction` runs in
 * `finalizeAuction`'s `finally` block (after orchestrate returns) while the
 * settle tx lands *during* orchestrate, the row often doesn't exist yet.
 *
 * The relay knows the mapping at the moment it submits the bundle, so we keep
 * it here. Indexer lookup is then O(1) and the DB write becomes purely
 * historical persistence — no race, no retry loop.
 */

const ENTRY_TTL_MS = 5 * 60 * 1000;

export interface PendingCashbackEntry {
  hintId: string;
}

export class PendingCashbackRegistry {
  private readonly entries = new Map<string, PendingCashbackEntry>();
  private readonly timeouts = new Map<string, NodeJS.Timeout>();

  register(
    userPubkey: string,
    searcherPubkey: string,
    bidAmountLamports: bigint,
    hintId: string,
  ): void {
    const key = makeKey(userPubkey, searcherPubkey, bidAmountLamports);
    this.entries.set(key, { hintId });

    const old = this.timeouts.get(key);
    if (old) clearTimeout(old);
    const t = setTimeout(() => {
      this.entries.delete(key);
      this.timeouts.delete(key);
    }, ENTRY_TTL_MS);
    t.unref();
    this.timeouts.set(key, t);
  }

  take(
    userPubkey: string,
    searcherPubkey: string,
    bidAmountLamports: bigint,
  ): PendingCashbackEntry | null {
    const key = makeKey(userPubkey, searcherPubkey, bidAmountLamports);
    const entry = this.entries.get(key);
    if (!entry) return null;

    this.entries.delete(key);
    const t = this.timeouts.get(key);
    if (t) {
      clearTimeout(t);
      this.timeouts.delete(key);
    }
    return entry;
  }

  size(): number {
    return this.entries.size;
  }
}

function makeKey(
  userPubkey: string,
  searcherPubkey: string,
  bidAmountLamports: bigint,
): string {
  return `${userPubkey}|${searcherPubkey}|${bidAmountLamports.toString()}`;
}
