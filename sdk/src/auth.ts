import bs58 from "bs58";

import type { AuthMessage, Signer } from "./types.js";

const AUTH_MESSAGE_PREFIX = "flowback-searcher-auth";

/**
 * Build the auth message expected by the relay's `/searcher` WebSocket. The
 * message body `<prefix>:<base58 pubkey>:<timestampMs>` must be Ed25519-signed
 * by the searcher's keypair; the relay rejects timestamps older or newer than
 * 60 seconds.
 */
export async function buildAuthMessage(
  signer: Signer,
  timestamp: number = Date.now(),
): Promise<AuthMessage> {
  const pubkey = signer.publicKey.toBase58();
  const payload = `${AUTH_MESSAGE_PREFIX}:${pubkey}:${timestamp}`;
  const signature = await signer.signMessage(new TextEncoder().encode(payload));
  return {
    type: "auth",
    pubkey,
    signature: bs58.encode(signature),
    timestamp,
  };
}
