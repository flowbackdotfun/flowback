import { randomUUID } from "node:crypto";
import type { Connection } from "@solana/web3.js";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

import {
  buildSwap,
  JupiterError,
  type JupiterInstruction,
} from "../jupiter/client.js";
import { JupiterUnavailableError } from "./errors.js";
import { PreparedSwapStore, type PreparedSwap } from "./prepare-store.js";

export { JupiterUnavailableError } from "./errors.js";

// Read-only account added to Tx1 so Jito rejects any bundle placing a tx
// before the user's swap. Must be present at sign-time — the user signs the
// tx *with* this guard, so the compiled message bytes are stable.
const JITO_DONT_FRONT_ADDRESS = address(
  "jitodontfront111111111111111111111111111111",
);
const MEMO_PROGRAM_ID = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Client has 30s to sign + submit /intent. Jupiter's blockhash typically lives
// 60-90s, leaving headroom for auction + bundle land.
const PREPARE_TTL_MS = 30_000;

const MAX_SLIPPAGE_BPS = 10_000;

export interface PrepareServiceDeps {
  store: PreparedSwapStore;
  connection: Connection;
}

export interface PrepareSwapInput {
  user: string;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  maxSlippageBps: number;
}

export interface PrepareSwapResult {
  prepareId: string;
  unsignedTx: string;
  expiresAt: number;
}

export async function prepareSwap(
  input: PrepareSwapInput,
  deps: PrepareServiceDeps,
): Promise<PrepareSwapResult> {
  if (input.maxSlippageBps < 0 || input.maxSlippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error("maxSlippageBps out of range");
  }
  if (input.inputAmount <= 0n) throw new Error("inputAmount must be > 0");

  let build;
  try {
    build = await buildSwap({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.inputAmount,
      taker: input.user,
      slippageBps: input.maxSlippageBps,
    });
  } catch (err) {
    if (err instanceof JupiterError) throw new JupiterUnavailableError(err);
    throw err;
  }

  const instructions: Instruction[] = [];
  for (const ix of build.computeBudgetInstructions ?? []) {
    instructions.push(toKitInstruction(ix));
  }
  for (const ix of build.setupInstructions ?? []) {
    instructions.push(toKitInstruction(ix));
  }
  instructions.push(
    withFrontRunGuard(toKitInstruction(build.swapInstruction)),
  );
  if (build.cleanupInstruction) {
    instructions.push(toKitInstruction(build.cleanupInstruction));
  }

  const userAddress = address(input.user);
  const latestBlockhash = await deps.connection.getLatestBlockhash("confirmed");
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(userAddress, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: latestBlockhash.blockhash as Blockhash,
          lastValidBlockHeight: BigInt(latestBlockhash.lastValidBlockHeight),
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) =>
      compressTransactionMessageUsingAddressLookupTables(
        m,
        toKitLookupTables(build.addressesByLookupTableAddress),
      ),
  );

  const compiledTx = compileTransaction(message);
  const unsignedTxBase64 = getBase64EncodedWireTransaction(compiledTx);

  const now = Date.now();
  const prepared: PreparedSwap = {
    prepareId: randomUUID(),
    user: input.user,
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inputAmount: input.inputAmount,
    minOutputAmount: input.minOutputAmount,
    maxSlippageBps: input.maxSlippageBps,
    priceImpactPct: build.priceImpactPct,
    unsignedTxBase64,
    messageBytes: new Uint8Array(compiledTx.messageBytes),
    jupiterBuild: build,
    createdAt: now,
    expiresAt: now + PREPARE_TTL_MS,
  };
  deps.store.put(prepared);

  return {
    prepareId: prepared.prepareId,
    unsignedTx: unsignedTxBase64,
    expiresAt: prepared.expiresAt,
  };
}

function withFrontRunGuard(swapIx: Instruction): Instruction {
  // In MOCK_JUPITER, swapIx is a Memo instruction. Memo enforces that all
  // provided accounts are signers, so appending jito-dont-front (readonly,
  // non-signer) causes MissingRequiredSignature during simulation.
  if (swapIx.programAddress === MEMO_PROGRAM_ID) {
    return swapIx;
  }

  return {
    ...swapIx,
    accounts: [
      ...(swapIx.accounts ?? []),
      { address: JITO_DONT_FRONT_ADDRESS, role: AccountRole.READONLY },
    ],
  };
}

const base64Encoder = getBase64Encoder();

function toKitInstruction(ix: JupiterInstruction): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((a) => ({
      address: address(a.pubkey),
      role: roleFor(a.isSigner, a.isWritable),
    })),
    data: base64Encoder.encode(ix.data),
  };
}

function roleFor(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
  if (isSigner) return AccountRole.READONLY_SIGNER;
  if (isWritable) return AccountRole.WRITABLE;
  return AccountRole.READONLY;
}

function toKitLookupTables(
  raw: Record<string, readonly string[]>,
): AddressesByLookupTableAddress {
  const out: Record<Address, Address[]> = {};
  for (const [tableAddr, addrs] of Object.entries(raw)) {
    out[address(tableAddr)] = addrs.map((a) => address(a));
  }
  return out;
}
