import type { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

import type { Signer } from "./types.js";

/**
 * Wrap a raw `@solana/web3.js` `Keypair` as a {@link Signer}. The secret key
 * never leaves the SDK consumer's process — it's used only to produce
 * Ed25519 signatures over the auth message and over `cashbackTx` / `tipTx`.
 *
 * For non-keypair custody (HSM, KMS, hardware wallet), implement {@link Signer}
 * yourself and pass it directly to `new FlowbackSearcher({ signer, ... })`.
 */
export function keypairSigner(keypair: Keypair): Signer {
  return {
    publicKey: keypair.publicKey,
    async signMessage(bytes) {
      return nacl.sign.detached(bytes, keypair.secretKey);
    },
    async signTransaction(tx) {
      tx.partialSign(keypair);
      return tx;
    },
  };
}
