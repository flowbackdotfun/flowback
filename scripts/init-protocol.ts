import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { deriveConfigPda } from "@flowback/searcher";

import {
  DEFAULT_PROGRAM_ID,
  airdropIfLow,
  connection,
  loadOrCreateKeypair,
  shortPubkey,
} from "./lib/util.js";

/**
 * Anchor discriminator: first 8 bytes of sha256("global:initialize").
 */
const INITIALIZE_DISCRIMINATOR = createHash("sha256")
  .update("global:initialize")
  .digest()
  .subarray(0, 8);

const PROTOCOL_FEE_BPS = Number(process.env.PROTOCOL_FEE_BPS ?? 1_000); // 10%

async function main(): Promise<void> {
  const conn = connection();
  const programId = new PublicKey(DEFAULT_PROGRAM_ID);
  const authority = loadOrCreateKeypair("authority");
  const treasury = loadOrCreateKeypair("treasury");

  console.log(`[init] program       ${programId.toBase58()}`);
  console.log(`[init] authority     ${authority.publicKey.toBase58()}`);
  console.log(`[init] treasury      ${treasury.publicKey.toBase58()}`);

  await airdropIfLow(conn, authority.publicKey, 5_000_000_000);
  await airdropIfLow(conn, treasury.publicKey, 1_000_000_000);

  const [configPda] = deriveConfigPda(programId);
  console.log(`[init] config PDA    ${configPda.toBase58()}`);

  // Skip if config already exists.
  const existing = await conn.getAccountInfo(configPda);
  if (existing) {
    console.log(`[init] config already initialised — skipping`);
    return;
  }

  // Layout: discriminator (8) + protocol_fee_bps (u16 LE) + treasury (32) + paused (u8)
  const data = Buffer.alloc(8 + 2 + 32 + 1);
  data.set(INITIALIZE_DISCRIMINATOR, 0);
  data.writeUInt16LE(PROTOCOL_FEE_BPS, 8);
  data.set(treasury.publicKey.toBytes(), 10);
  data.writeUInt8(0, 42); // paused = false

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = authority.publicKey;
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(authority);

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");

  console.log(`[init] ✓ initialised  protocol_fee_bps=${PROTOCOL_FEE_BPS}`);
  console.log(`[init] ✓ tx           ${sig}`);
  console.log("");
  console.log(
    `Set TREASURY_WALLET=${treasury.publicKey.toBase58()} in relay/.env`,
  );
}

main().catch((err) => {
  console.error("[init] fatal:", err);
  process.exit(1);
});
