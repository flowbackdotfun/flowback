import { createHash } from "node:crypto";
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Base64EncodedWireTransaction,
  type Rpc,
  type SimulateTransactionApi,
} from "@solana/kit";

const SIMULATE_TIMEOUT_MS = 1000;

const SETTLE_CASHBACK_DISCRIMINATOR = new Uint8Array(
  createHash("sha256").update("global:settle_cashback").digest().subarray(0, 8),
);

export interface CashbackTxExpectations {
  programId: string;
  user: string;
  treasury: string;
  bidAmountLamports: bigint;
}

export async function validateBackrunTx(
  txBase64: string,
  rpc: Rpc<SimulateTransactionApi>,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(txBase64, "base64");
  } catch {
    return false;
  }
  if (bytes.length === 0) return false;

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

    return response.value.err === null;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function validateCashbackTx(
  txBase64: string,
  expected: CashbackTxExpectations,
): boolean {
  try {
    const bytes = Buffer.from(txBase64, "base64");
    if (bytes.length === 0) return false;

    const tx = getTransactionDecoder().decode(bytes);
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (msg.version !== "legacy" && msg.version !== 0) return false;

    for (const ix of msg.instructions) {
      const programAddr = msg.staticAccounts[ix.programAddressIndex];
      if (programAddr !== expected.programId) continue;

      const data = ix.data;
      if (!data || data.length < 8 + 8 + 32) continue;

      if (!matchesPrefix(data, SETTLE_CASHBACK_DISCRIMINATOR)) continue;

      const bidAmount = readU64LE(data, 8);
      if (bidAmount !== expected.bidAmountLamports) return false;

      const accountIndices = ix.accountIndices ?? [];
      if (accountIndices.length < 3) return false;

      const userIdx = accountIndices[1]!;
      const treasuryIdx = accountIndices[2]!;
      if (
        userIdx >= msg.staticAccounts.length ||
        treasuryIdx >= msg.staticAccounts.length
      ) {
        return false;
      }

      const userAddr = msg.staticAccounts[userIdx];
      const treasuryAddr = msg.staticAccounts[treasuryIdx];
      if (userAddr !== expected.user) return false;
      if (treasuryAddr !== expected.treasury) return false;

      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function matchesPrefix(
  data: { [i: number]: number; length: number },
  prefix: Uint8Array,
): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false;
  }
  return true;
}

function readU64LE(
  data: { [i: number]: number; length: number },
  offset: number,
): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(data[offset + i]!) << BigInt(i * 8);
  }
  return result;
}
