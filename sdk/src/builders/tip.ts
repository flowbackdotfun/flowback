import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import type { Signer } from "../types.js";

export interface BuildJitoTipTxParams {
  signer: Signer;
  /** Base58 Jito tip account — pick one with {@link pickJitoTipAccount}. */
  tipAccount: string;
  /** Tip amount in lamports. */
  tipLamports: bigint;
  recentBlockhash: string;
}

/**
 * Build, sign, and serialise the Jito tip transaction (Tx4 in the bundle).
 * A single SystemProgram transfer from the searcher to a Jito tip account.
 */
export async function buildJitoTipTx(
  params: BuildJitoTipTxParams,
): Promise<string> {
  const tipPk = new PublicKey(params.tipAccount);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: params.signer.publicKey,
      toPubkey: tipPk,
      lamports: params.tipLamports,
    }),
  );
  tx.feePayer = params.signer.publicKey;
  tx.recentBlockhash = params.recentBlockhash;

  const signed = await params.signer.signTransaction(tx);
  return signed.serialize().toString("base64");
}
