import { createRequire } from "node:module";
import type {
  SubscribeRequest,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";

/**
 * Source-agnostic abstraction over a Yellowstone gRPC geyser stream.
 *
 * The consumer — the cashback indexer — is written against `GeyserSource` and
 * never needs to know whether updates come from a real validator stream or the
 * in-process mock; swapping one for the other is a config change, not a code
 * change. The Yellowstone proto types are re-exported here so the rest of the
 * relay has a single shared vocabulary for geyser data.
 */

export type { SubscribeRequest, SubscribeUpdate };

// The published package declares `"type": "git"` in its package.json, which
// breaks static ESM named *value* imports under some loaders (tsx). The
// type-only imports above are erased and safe; runtime values are pulled from
// the CJS build via `require`, which resolves deterministically everywhere.
const nodeRequire = createRequire(import.meta.url);

export const CommitmentLevel: {
  readonly PROCESSED: 0;
  readonly CONFIRMED: 1;
  readonly FINALIZED: 2;
  readonly UNRECOGNIZED: -1;
} = nodeRequire("@triton-one/yellowstone-grpc").CommitmentLevel;

export type CommitmentLevel =
  (typeof CommitmentLevel)[keyof typeof CommitmentLevel];

/**
 * A live subscription. `updates` is the server→client stream of events;
 * `write` is the client→server channel for dynamic filter updates or keepalive
 * pings; `close` tears the subscription down and releases its resources.
 */
export interface GeyserSubscription {
  readonly updates: AsyncIterableIterator<SubscribeUpdate>;
  write(request: SubscribeRequest): Promise<void>;
  close(): void;
}

export interface GeyserSource {
  subscribe(request: SubscribeRequest): Promise<GeyserSubscription>;
}

/**
 * Build a fully-populated `SubscribeRequest` that streams confirmed, non-vote,
 * non-failed transactions touching `programId`. Yellowstone requires every
 * top-level field to be present even when empty.
 */
export function buildProgramTxRequest(
  programId: string,
  commitment: CommitmentLevel = CommitmentLevel.CONFIRMED,
): SubscribeRequest {
  return {
    accounts: {},
    slots: {},
    transactions: {
      flowback: {
        vote: false,
        failed: false,
        signature: undefined,
        accountInclude: [programId],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment,
    accountsDataSlice: [],
    ping: undefined,
  };
}
