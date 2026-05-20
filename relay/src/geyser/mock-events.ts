import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type {
  SubscribeRequest,
  SubscribeRequestFilterAccounts,
  SubscribeRequestFilterAccountsFilter,
  SubscribeRequestFilterAccountsFilterMemcmp,
  SubscribeUpdate,
  SubscribeUpdateTransactionInfo,
} from "@triton-one/yellowstone-grpc";

/**
 * Synthetic Yellowstone `SubscribeUpdate` generators. Pure functions with no
 * timers of their own — the mock source owns the cadence and calls these to
 * shape each tick's payload.
 *
 * The generators honor the `SubscribeRequest` the way real geyser would —
 * account/owner/datasize/memcmp filters, slot status transitions, per-filter
 * fan-out — so a consumer's filter handling is exercised, not bypassed.
 */

// Proto SlotStatus is a numeric enum: 0 Processed, 1 Confirmed, 2 Finalized.
const SLOT_PROCESSED = 0;
const SLOT_FINALIZED = 2;

/**
 * Pick one intra-slot event (transaction / transaction-status / account)
 * uniformly from the kinds the request actually subscribed to. If none of
 * those kinds are subscribed, emit a fully random event so the stream stays
 * lively.
 */
export function mapRandomIntraslotEvent(
  req: SubscribeRequest,
  slot: number,
): SubscribeUpdate {
  const kinds: Array<"tx" | "txStatus" | "account"> = [];
  if (Object.keys(req.transactions).length > 0) kinds.push("tx");
  if (Object.keys(req.transactionsStatus).length > 0) kinds.push("txStatus");
  if (Object.keys(req.accounts).length > 0) kinds.push("account");

  if (kinds.length === 0) {
    return randomIntraslotEventUnconstrained(slot);
  }

  switch (pick(kinds)) {
    case "tx": {
      return randomTransactionUpdate(pick(Object.keys(req.transactions)), slot);
    }
    case "txStatus": {
      return randomTransactionStatusUpdate(
        pick(Object.keys(req.transactionsStatus)),
        slot,
      );
    }
    case "account": {
      const [filterName, cfg] = pick(Object.entries(req.accounts));
      return randomAccountUpdate(filterName, cfg, slot);
    }
  }
}

/**
 * Emit the once-per-slot events: one block + one block-meta per registered
 * filter, plus the three slot status transitions (Processed → Confirmed →
 * Finalized) per slot filter. With no slot filter, a single fallback slot tick
 * keeps the stream alive.
 */
export function mapSlotBoundaryEvents(
  req: SubscribeRequest,
  slot: number,
): SubscribeUpdate[] {
  const events: SubscribeUpdate[] = [];

  for (const filter of Object.keys(req.blocks)) {
    events.push(randomBlockUpdate(filter, slot));
  }
  for (const filter of Object.keys(req.blocksMeta)) {
    events.push(randomBlockMetaUpdate(filter, slot));
  }

  const slotFilters = Object.keys(req.slots);
  if (slotFilters.length === 0) {
    events.push(slotUpdate("slot", slot, slot % 3));
  } else {
    for (const filter of slotFilters) {
      for (let status = SLOT_PROCESSED; status <= SLOT_FINALIZED; status++) {
        events.push(slotUpdate(filter, slot, status));
      }
    }
  }

  return events;
}

/**
 * Build a transaction update whose log messages carry a real `CashbackSettled`
 * line. Used by the mock to inject events the indexer decodes for real.
 */
export function makeCashbackTransactionUpdate(
  slot: number,
  cashbackLogLine: string,
): { update: SubscribeUpdate; signature: Uint8Array } {
  const info = randomTransactionInfo([
    "Program FLowBackXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX invoke [1]",
    cashbackLogLine,
    "Program FLowBackXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX success",
  ]);
  return {
    update: {
      filters: ["flowback"],
      transaction: { transaction: info, slot: String(slot) },
      createdAt: new Date(),
    },
    signature: info.signature,
  };
}

function randomIntraslotEventUnconstrained(slot: number): SubscribeUpdate {
  switch (randInt(3)) {
    case 0:
      return randomTransactionUpdate("__mock_random_tx", slot);
    case 1:
      return randomTransactionStatusUpdate("__mock_random_tx_status", slot);
    default:
      return randomAccountUpdate(
        "__mock_random_account",
        { account: [], owner: [], filters: [], nonemptyTxnSignature: undefined },
        slot,
      );
  }
}

function randomTransactionUpdate(filter: string, slot: number): SubscribeUpdate {
  return {
    filters: [filter],
    transaction: {
      transaction: randomTransactionInfo([]),
      slot: String(slot),
    },
    createdAt: new Date(),
  };
}

function randomTransactionStatusUpdate(
  filter: string,
  slot: number,
): SubscribeUpdate {
  return {
    filters: [filter],
    transactionStatus: {
      slot: String(slot),
      signature: randomBytes(64),
      isVote: false,
      index: String(randInt(1024)),
      err: undefined,
    },
    createdAt: new Date(),
  };
}

function randomAccountUpdate(
  filter: string,
  cfg: SubscribeRequestFilterAccounts,
  slot: number,
): SubscribeUpdate {
  let txnSignature: Uint8Array | undefined;
  if (cfg.nonemptyTxnSignature === true) txnSignature = randomBytes(64);
  else if (cfg.nonemptyTxnSignature === false) txnSignature = undefined;
  else txnSignature = randInt(2) === 0 ? randomBytes(64) : undefined;

  return {
    filters: [filter],
    account: {
      account: {
        pubkey: pickPubkeyOrRandom(cfg.account),
        lamports: String(randInt(1_000_000_000)),
        owner: pickPubkeyOrRandom(cfg.owner),
        executable: false,
        rentEpoch: "0",
        data: buildAccountData(cfg.filters),
        writeVersion: String(randInt(2_000_000_000)),
        txnSignature,
      },
      slot: String(slot),
      isStartup: false,
    },
    createdAt: new Date(),
  };
}

function randomBlockUpdate(filter: string, slot: number): SubscribeUpdate {
  return {
    filters: [filter],
    block: {
      slot: String(slot),
      blockhash: bs58.encode(randomBytes(32)),
      rewards: undefined,
      blockTime: undefined,
      blockHeight: undefined,
      parentSlot: String(Math.max(0, slot - 1)),
      parentBlockhash: "",
      executedTransactionCount: "0",
      transactions: [],
      updatedAccountCount: "0",
      accounts: [],
      entriesCount: "0",
      entries: [],
    },
    createdAt: new Date(),
  };
}

function randomBlockMetaUpdate(filter: string, slot: number): SubscribeUpdate {
  return {
    filters: [filter],
    blockMeta: {
      slot: String(slot),
      blockhash: bs58.encode(randomBytes(32)),
      rewards: undefined,
      blockTime: undefined,
      blockHeight: undefined,
      parentSlot: String(Math.max(0, slot - 1)),
      parentBlockhash: "",
      executedTransactionCount: "0",
      entriesCount: "0",
    },
    createdAt: new Date(),
  };
}

function slotUpdate(
  filter: string,
  slot: number,
  status: number,
): SubscribeUpdate {
  return {
    filters: [filter],
    slot: {
      slot: String(slot),
      parent: String(Math.max(0, slot - 1)),
      status,
      deadError: undefined,
    },
    createdAt: new Date(),
  };
}

function randomTransactionInfo(
  logMessages: string[],
): SubscribeUpdateTransactionInfo {
  const signature = randomBytes(64);
  return {
    signature,
    isVote: false,
    transaction: {
      signatures: [signature],
      message: {
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1,
        },
        accountKeys: [randomBytes(32), randomBytes(32)],
        recentBlockhash: randomBytes(32),
        instructions: [
          {
            programIdIndex: 1,
            accounts: new Uint8Array([0]),
            data: randomBytes(randInt(32)),
          },
        ],
        versioned: false,
        addressTableLookups: [],
      },
    },
    meta: {
      err: undefined,
      fee: String(randIntRange(5_000, 50_000)),
      preBalances: ["1000000000", "0"],
      postBalances: ["999995000", "0"],
      innerInstructions: [],
      innerInstructionsNone: true,
      logMessages,
      logMessagesNone: logMessages.length === 0,
      preTokenBalances: [],
      postTokenBalances: [],
      rewards: [],
      loadedWritableAddresses: [],
      loadedReadonlyAddresses: [],
      returnData: undefined,
      returnDataNone: true,
      computeUnitsConsumed: String(randIntRange(1_000, 200_000)),
      costUnits: undefined,
    },
    index: String(randInt(1024)),
  };
}

/** Build account data honoring datasize and memcmp constraints. */
function buildAccountData(
  filters: SubscribeRequestFilterAccountsFilter[],
): Uint8Array {
  let datasize: number | undefined;
  for (const f of filters) {
    if (f.datasize !== undefined) datasize = Number(f.datasize);
  }

  let data = randomBytes(datasize ?? randInt(256));

  for (const f of filters) {
    if (!f.memcmp) continue;
    const bytes = memcmpBytes(f.memcmp);
    if (!bytes) continue;
    const offset = Number(f.memcmp.offset);
    const end = offset + bytes.length;
    if (end > data.length) {
      const grown = new Uint8Array(end);
      grown.set(data);
      data = grown;
    }
    data.set(bytes, offset);
  }

  return data;
}

function memcmpBytes(
  memcmp: SubscribeRequestFilterAccountsFilterMemcmp,
): Uint8Array | null {
  if (memcmp.bytes && memcmp.bytes.length > 0) return memcmp.bytes;
  if (memcmp.base58) {
    try {
      return bs58.decode(memcmp.base58);
    } catch {
      return null;
    }
  }
  if (memcmp.base64) {
    try {
      return new Uint8Array(Buffer.from(memcmp.base64, "base64"));
    } catch {
      return null;
    }
  }
  return null;
}

/** Decode a configured pubkey (base58) or generate a random 32-byte key. */
function pickPubkeyOrRandom(configured: string[]): Uint8Array {
  if (configured.length > 0) {
    try {
      return new PublicKey(pick(configured)).toBytes();
    } catch {
      // malformed config — fall through to random rather than throw
    }
  }
  return randomBytes(32);
}

function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function randIntRange(minInclusive: number, maxExclusive: number): number {
  return minInclusive + randInt(maxExclusive - minInclusive);
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = randInt(256);
  return out;
}

function pick<T>(items: readonly T[]): T {
  return items[randInt(items.length)] as T;
}
