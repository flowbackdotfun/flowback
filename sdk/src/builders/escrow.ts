import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import type { Signer } from "../types.js";
import {
  deriveEscrowPda,
  ESCROW_DEPOSIT_DISCRIMINATOR,
  ESCROW_INIT_DISCRIMINATOR,
  ESCROW_WITHDRAW_DISCRIMINATOR,
} from "./discriminator.js";

interface CommonParams {
  signer: Signer;
  programId: string;
  recentBlockhash: string;
}

export type BuildEscrowInitTxParams = CommonParams;

/**
 * Build a signed `escrow_init` transaction (base64 wire). Allocates the
 * searcher's `SearcherEscrow` PDA on-chain — must be called once per searcher
 * before any deposit. Idempotent failure if already initialised (Anchor's
 * `init` constraint).
 */
export async function buildEscrowInitTx(
  params: BuildEscrowInitTxParams,
): Promise<string> {
  const programId = new PublicKey(params.programId);
  const [escrowPda] = deriveEscrowPda(programId, params.signer.publicKey);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(ESCROW_INIT_DISCRIMINATOR),
  });

  return signAndSerialise(ix, params);
}

export interface BuildEscrowDepositTxParams extends CommonParams {
  /** Lamports to add to the escrow PDA. */
  amount: bigint;
}

/**
 * Build a signed `escrow_deposit` transaction (base64 wire). Transfers `amount`
 * lamports from the searcher into their `SearcherEscrow` PDA via a
 * SystemProgram CPI inside the FlowBack program.
 */
export async function buildEscrowDepositTx(
  params: BuildEscrowDepositTxParams,
): Promise<string> {
  const programId = new PublicKey(params.programId);
  const [escrowPda] = deriveEscrowPda(programId, params.signer.publicKey);

  const data = Buffer.alloc(8 + 8);
  data.set(ESCROW_DEPOSIT_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(params.amount, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return signAndSerialise(ix, params);
}

export interface BuildEscrowWithdrawTxParams extends CommonParams {
  /** Lamports to withdraw from the escrow PDA back to the searcher. */
  amount: bigint;
}

/**
 * Build a signed `escrow_withdraw` transaction (base64 wire). Pulls `amount`
 * lamports from the searcher's escrow PDA back to their wallet. The program
 * enforces the rent-exempt floor — over-withdraw fails with `RentBreach` /
 * `InsufficientEscrow`.
 */
export async function buildEscrowWithdrawTx(
  params: BuildEscrowWithdrawTxParams,
): Promise<string> {
  const programId = new PublicKey(params.programId);
  const [escrowPda] = deriveEscrowPda(programId, params.signer.publicKey);

  const data = Buffer.alloc(8 + 8);
  data.set(ESCROW_WITHDRAW_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(params.amount, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
    ],
    data,
  });

  return signAndSerialise(ix, params);
}

async function signAndSerialise(
  ix: TransactionInstruction,
  params: CommonParams,
): Promise<string> {
  const tx = new Transaction().add(ix);
  tx.feePayer = params.signer.publicKey;
  tx.recentBlockhash = params.recentBlockhash;
  const signed = await params.signer.signTransaction(tx);
  return signed.serialize().toString("base64");
}
