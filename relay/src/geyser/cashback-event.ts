import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

/**
 * Single source of truth for the on-chain `CashbackSettled` wire format.
 *
 * The indexer decodes it from a geyser stream; the mock encodes it so injected
 * events are parsed through the exact same path. Keeping both directions here
 * means the encoder and decoder can never silently drift.
 */

// Anchor event discriminator: sha256("event:CashbackSettled")[0..8].
export const EVENT_DISCRIMINATOR: Buffer = createHash("sha256")
  .update("event:CashbackSettled")
  .digest()
  .subarray(0, 8);

// Fixed payload: 8 disc + 32 user + 32 searcher + 8 bid + 8 cashback + 8 fee + 8 ts.
export const EVENT_BYTE_LENGTH = 104;

const PROGRAM_DATA_PREFIX = "Program data: ";

export interface CashbackSettledEvent {
  user: string;
  searcher: string;
  bidAmountLamports: bigint;
  userCashbackLamports: bigint;
  protocolFeeLamports: bigint;
  timestamp: bigint;
}

/**
 * Scan a transaction's log messages for a `CashbackSettled` event and decode it.
 * Returns null when no matching `Program data:` line is present.
 */
export function decodeCashbackSettled(
  logs: readonly string[],
): CashbackSettledEvent | null {
  for (const log of logs) {
    if (!log.startsWith(PROGRAM_DATA_PREFIX)) continue;

    let bytes: Buffer;
    try {
      bytes = Buffer.from(log.slice(PROGRAM_DATA_PREFIX.length), "base64");
    } catch {
      continue;
    }

    if (bytes.length !== EVENT_BYTE_LENGTH) continue;
    if (!matchesDiscriminator(bytes)) continue;

    return decodeEvent(bytes);
  }

  return null;
}

/**
 * Encode an event back into a `Program data: <base64>` log line — the inverse
 * of `decodeCashbackSettled`. Used by the mock to emit events the indexer can
 * parse for real.
 */
export function encodeCashbackSettledLog(event: CashbackSettledEvent): string {
  const bytes = Buffer.alloc(EVENT_BYTE_LENGTH);
  let offset = EVENT_DISCRIMINATOR.copy(bytes, 0);

  offset += new PublicKey(event.user).toBuffer().copy(bytes, offset);
  offset += new PublicKey(event.searcher).toBuffer().copy(bytes, offset);
  offset = bytes.writeBigUInt64LE(event.bidAmountLamports, offset);
  offset = bytes.writeBigUInt64LE(event.userCashbackLamports, offset);
  offset = bytes.writeBigUInt64LE(event.protocolFeeLamports, offset);
  bytes.writeBigInt64LE(event.timestamp, offset);

  return PROGRAM_DATA_PREFIX + bytes.toString("base64");
}

function matchesDiscriminator(bytes: Buffer): boolean {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== EVENT_DISCRIMINATOR[i]) return false;
  }
  return true;
}

function decodeEvent(bytes: Buffer): CashbackSettledEvent {
  let offset = 8; // skip discriminator

  const user = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
  offset += 32;

  const searcher = new PublicKey(
    bytes.subarray(offset, offset + 32),
  ).toBase58();
  offset += 32;

  const bidAmountLamports = bytes.readBigUInt64LE(offset);
  offset += 8;

  const userCashbackLamports = bytes.readBigUInt64LE(offset);
  offset += 8;

  const protocolFeeLamports = bytes.readBigUInt64LE(offset);
  offset += 8;

  const timestamp = bytes.readBigInt64LE(offset);

  return {
    user,
    searcher,
    bidAmountLamports,
    userCashbackLamports,
    protocolFeeLamports,
    timestamp,
  };
}
