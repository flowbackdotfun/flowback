import { VersionedTransaction } from "@solana/web3.js";
import WebSocket from "ws";

import {
  DEFAULT_RELAY_REST,
  DEFAULT_RELAY_WS,
  airdropIfLow,
  connection,
  loadOrCreateKeypair,
} from "./lib/util.js";

// Mock mints — anything goes when MOCK_JUPITER=true; the relay swaps in a memo ix.
const INPUT_MINT =
  process.env.INPUT_MINT ?? "So11111111111111111111111111111111111111112";
const OUTPUT_MINT =
  process.env.OUTPUT_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const INPUT_AMOUNT = BigInt(process.env.INPUT_AMOUNT ?? 2_000_000_000); // 2 SOL
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 50);
const MIN_OUTPUT = BigInt(
  process.env.MIN_OUTPUT_AMOUNT ?? Number(INPUT_AMOUNT) * 0.98,
);

interface PrepareResponse {
  prepareId: string;
  unsignedTx: string;
  expiresAt: number;
}

interface IntentResponse {
  auctionId: string;
  status: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  const conn = connection();
  const user = loadOrCreateKeypair("user");
  console.log(`[intent] user pubkey   ${user.publicKey.toBase58()}`);
  console.log(`[intent] swap          ${INPUT_AMOUNT} lamports of ${INPUT_MINT.slice(0, 8)}… → ${OUTPUT_MINT.slice(0, 8)}…`);

  await airdropIfLow(conn, user.publicKey, 5_000_000_000);

  console.log(`[intent] → POST /prepare`);
  const prep = await postJson<PrepareResponse>(`${DEFAULT_RELAY_REST}/prepare`, {
    user: user.publicKey.toBase58(),
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    inputAmount: INPUT_AMOUNT.toString(),
    minOutputAmount: MIN_OUTPUT.toString(),
    maxSlippageBps: SLIPPAGE_BPS,
  });
  console.log(
    `[intent] ✓ prepared    prepareId=${prep.prepareId.slice(0, 8)}…  expiresAt=${new Date(prep.expiresAt).toISOString()}`,
  );

  // Sign the prepared v0 transaction with the user's keypair.
  const txBytes = Buffer.from(prep.unsignedTx, "base64");
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([user]);
  const signedTxB64 = Buffer.from(tx.serialize()).toString("base64");

  console.log(`[intent] → POST /intent`);
  const intent = await postJson<IntentResponse>(
    `${DEFAULT_RELAY_REST}/intent`,
    {
      prepareId: prep.prepareId,
      signedTx: signedTxB64,
    },
  );
  console.log(
    `[intent] ✓ submitted   auctionId=${intent.auctionId}  status=${intent.status}`,
  );

  await subscribeToAuction(intent.auctionId);
}

/**
 * Listen to the user-status WS for the lifecycle of this auction:
 *   bundle_submitted → cashback_confirmed (happy path)
 *                    | fallback_executed  (no bids / candidates exhausted)
 */
async function subscribeToAuction(auctionId: string): Promise<void> {
  const ws = new WebSocket(`${DEFAULT_RELAY_WS}/status`);
  let resolved = false;

  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  console.log(`[intent] ✓ ws open      subscribing to ${auctionId}`);
  ws.send(JSON.stringify({ type: "subscribe", auctionId }));

  const timeout = setTimeout(() => {
    if (!resolved) {
      console.warn(`[intent] timeout — no terminal event in 15s`);
      ws.close();
      process.exit(2);
    }
  }, 15_000);

  ws.on("message", (raw) => {
    let msg: { type: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw.toString("utf-8"));
    } catch {
      return;
    }
    console.log(`[intent] ← ${msg.type}`, msg);
    if (
      msg.type === "cashback_confirmed" ||
      msg.type === "fallback_executed"
    ) {
      resolved = true;
      clearTimeout(timeout);
      ws.close();
      process.exit(0);
    }
  });

  ws.on("error", (err) => console.error(`[intent] ws error:`, err.message));
  ws.on("close", () => console.log(`[intent] ws closed`));
}

main().catch((err) => {
  console.error("[intent] fatal:", err);
  process.exit(1);
});
