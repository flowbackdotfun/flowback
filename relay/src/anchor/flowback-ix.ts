import { createHash } from "node:crypto";
import {
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
  type Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";

import { hintIdToBytes, buildBidMessage } from "../auction/validator.js";

export const ESCROW_SEED = Buffer.from("escrow");
export const USED_HINT_SEED = Buffer.from("used_hint");
export const CONFIG_SEED = Buffer.from("config");

/**
 * 8-byte Anchor instruction discriminator: `sha256("global:settle_from_escrow")[..8]`.
 * Computed once at module load to avoid drift if the IDL is regenerated.
 */
export const SETTLE_FROM_ESCROW_DISCRIMINATOR: Uint8Array = new Uint8Array(
  createHash("sha256")
    .update("global:settle_from_escrow")
    .digest()
    .subarray(0, 8),
);

export function deriveEscrowPda(
  programId: PublicKey,
  searcher: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ESCROW_SEED, searcher.toBuffer()],
    programId,
  );
}

export function deriveUsedHintPda(
  programId: PublicKey,
  hintIdBytes: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USED_HINT_SEED, Buffer.from(hintIdBytes)],
    programId,
  );
}

export function deriveConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

export interface BuildSettleFromEscrowIxParams {
  programId: PublicKey;
  relayPayer: PublicKey;
  searcher: PublicKey;
  user: PublicKey;
  treasury: PublicKey;
  bidAmount: bigint;
  /** UUID-shaped hint id (with or without dashes). Encoded as 16 raw bytes on-chain. */
  hintId: string;
}

/**
 * Build the `settle_from_escrow` instruction. Account order matches the
 * `SettleFromEscrow` struct in the FlowBack Anchor program; the discriminator
 * + args (bid_amount LE u64, user pubkey, hint_id [u8;16]) form the data
 * blob. The accompanying Ed25519 sigverify ix must be at index 0 of the same
 * transaction (see `buildBidCommitmentEd25519Ix`).
 */
export function buildSettleFromEscrowIx(
  params: BuildSettleFromEscrowIxParams,
): TransactionInstruction {
  const hintIdBytes = hintIdToBytes(params.hintId);
  const [escrowPda] = deriveEscrowPda(params.programId, params.searcher);
  const [configPda] = deriveConfigPda(params.programId);
  const [usedHintPda] = deriveUsedHintPda(params.programId, hintIdBytes);

  // 8 (discriminator) + 8 (bid_amount) + 32 (user) + 16 (hint_id)
  const data = Buffer.alloc(8 + 8 + 32 + 16);
  data.set(SETTLE_FROM_ESCROW_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(params.bidAmount, 8);
  data.set(params.user.toBytes(), 16);
  data.set(hintIdBytes, 48);

  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.relayPayer, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: params.user, isSigner: false, isWritable: true },
      { pubkey: params.treasury, isSigner: false, isWritable: true },
      { pubkey: usedHintPda, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface BuildBidCommitmentEd25519IxParams {
  searcher: PublicKey;
  /** Base58-encoded 64-byte Ed25519 signature submitted by the searcher. */
  bidCommitmentSig: string;
  hintId: string;
  bidAmount: bigint;
}

/**
 * Build the Ed25519 sigverify precompile instruction that authenticates the
 * searcher's bid commitment on-chain. Layout produced here matches what
 * `parse_ed25519_ix` in the program decodes (single-signature, all blobs
 * inline at offsets 16/48/112).
 */
export function buildBidCommitmentEd25519Ix(
  params: BuildBidCommitmentEd25519IxParams,
): TransactionInstruction {
  const sigBytes = bs58.decode(params.bidCommitmentSig);
  if (sigBytes.length !== 64) {
    throw new Error(
      `bidCommitmentSig must decode to 64 bytes, got ${sigBytes.length}`,
    );
  }
  const message = new TextEncoder().encode(
    buildBidMessage(params.hintId, params.bidAmount),
  );
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: params.searcher.toBytes(),
    signature: sigBytes,
    message,
  });
}

export interface BuildSettleTxIxsParams {
  programId: PublicKey;
  relayKeypair: Keypair;
  searcher: PublicKey;
  user: PublicKey;
  treasury: PublicKey;
  bidAmount: bigint;
  bidCommitmentSig: string;
  hintId: string;
}

/**
 * Convenience: emit the two instructions that constitute the on-chain
 * settlement (Ed25519 verify followed by `settle_from_escrow`). Caller is
 * responsible for assembling them into a v0 transaction with the relay's
 * recent blockhash and signing as fee payer.
 */
export function buildSettleTxIxs(
  params: BuildSettleTxIxsParams,
): TransactionInstruction[] {
  return [
    buildBidCommitmentEd25519Ix({
      searcher: params.searcher,
      bidCommitmentSig: params.bidCommitmentSig,
      hintId: params.hintId,
      bidAmount: params.bidAmount,
    }),
    buildSettleFromEscrowIx({
      programId: params.programId,
      relayPayer: params.relayKeypair.publicKey,
      searcher: params.searcher,
      user: params.user,
      treasury: params.treasury,
      bidAmount: params.bidAmount,
      hintId: params.hintId,
    }),
  ];
}
