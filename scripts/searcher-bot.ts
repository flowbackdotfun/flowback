import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Keypair,
} from "@solana/web3.js";

import {
  FlowbackSearcher,
  buildEscrowDepositTx,
  buildEscrowInitTx,
  buildJitoTipTx,
  deriveEscrowPda,
  keypairSigner,
  pickJitoTipAccount,
  signBidCommitment,
  type SearcherHint,
} from "@flowback/searcher";

import {
  DEFAULT_PROGRAM_ID,
  DEFAULT_RELAY_WS,
  DEFAULT_RPC,
  airdropIfLow,
  connection,
  loadOrCreateKeypair,
  shortPubkey,
} from "./lib/util.js";

const BOT_INDEX = Number(process.argv[2] ?? 0);
const BOT_NAME = `searcher-${BOT_INDEX}`;
const ESCROW_TARGET_LAMPORTS = 2_000_000_000n; // 2 SOL — enough for hundreds of bids
const TIP_LAMPORTS = 10_000n;

/** Small randomness so multiple bots produce distinct bids — winner is highest. */
function bidLamportsFor(hint: SearcherHint): bigint {
  const base = 1_000_000n; // 0.001 SOL
  const variance = BigInt(BOT_INDEX) * 200_000n;
  const jitter = BigInt(Math.floor(Math.random() * 100_000));
  return base + variance + jitter;
}

async function ensureEscrow(
  conn: Connection,
  programId: PublicKey,
  kp: Keypair,
): Promise<void> {
  const signer = keypairSigner(kp);
  const [escrowPda] = deriveEscrowPda(programId, kp.publicKey);
  const existing = await conn.getAccountInfo(escrowPda);

  let blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;

  if (!existing) {
    const initB64 = await buildEscrowInitTx({
      signer,
      programId: programId.toBase58(),
      recentBlockhash: blockhash,
    });
    const initSig = await conn.sendRawTransaction(Buffer.from(initB64, "base64"));
    await conn.confirmTransaction(initSig, "confirmed");
    console.log(`[${BOT_NAME}] ✓ escrow_init    ${initSig.slice(0, 16)}…`);
  }

  const balance = await conn.getBalance(escrowPda);
  // Top up to target if low. Subtract rent-exempt min when judging "current escrow balance".
  const rentMin = await conn.getMinimumBalanceForRentExemption(8 + 33);
  const usable = BigInt(Math.max(0, balance - rentMin));

  if (usable < ESCROW_TARGET_LAMPORTS) {
    const need = ESCROW_TARGET_LAMPORTS - usable;
    blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    const depositB64 = await buildEscrowDepositTx({
      signer,
      programId: programId.toBase58(),
      amount: need,
      recentBlockhash: blockhash,
    });
    const depSig = await conn.sendRawTransaction(
      Buffer.from(depositB64, "base64"),
    );
    await conn.confirmTransaction(depSig, "confirmed");
    console.log(
      `[${BOT_NAME}] ✓ escrow_deposit ${need} lamports  ${depSig.slice(0, 16)}…`,
    );
  } else {
    console.log(
      `[${BOT_NAME}] escrow already funded (${usable.toString()} lamports usable)`,
    );
  }
}

/**
 * Build a placeholder backrun tx. ComputeBudget.setComputeUnitLimit is the
 * canonical "no-op probe" instruction — touches zero accounts, has no rent
 * implications, and the ComputeBudget program is always loaded on every
 * cluster including `solana-test-validator`. So the relay's tier-2
 * `simulateTransaction` always succeeds. Real searchers replace this with
 * their actual arb instructions.
 */
async function buildDummyBackrunTx(
  conn: Connection,
  kp: Keypair,
  _hintId: string,
): Promise<string> {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
  const tx = new Transaction().add(ix);
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(kp);
  return tx.serialize().toString("base64");
}

async function main(): Promise<void> {
  const conn = connection();
  const programId = new PublicKey(DEFAULT_PROGRAM_ID);
  const kp = loadOrCreateKeypair(BOT_NAME);
  console.log(`[${BOT_NAME}] pubkey  ${kp.publicKey.toBase58()}`);

  await airdropIfLow(conn, kp.publicKey, 4_000_000_000);
  await ensureEscrow(conn, programId, kp);

  const searcher = new FlowbackSearcher({
    relayUrl: `${DEFAULT_RELAY_WS}/searcher`,
    signer: keypairSigner(kp),
    programId: programId.toBase58(),
    rpcUrl: DEFAULT_RPC,
  });

  searcher.onError((err) => console.error(`[${BOT_NAME}] error:`, err.message));
  searcher.onDisconnect(() => console.log(`[${BOT_NAME}] disconnected`));

  searcher.onHint(async (hint) => {
    const start = Date.now();
    try {
      const bidAmount = bidLamportsFor(hint);
      const blockhash = await searcher.getRecentBlockhash();
      const [bidCommitmentSig, tipTx, backrunTx] = await Promise.all([
        signBidCommitment({
          signer: keypairSigner(kp),
          hintId: hint.hintId,
          bidAmount,
        }),
        buildJitoTipTx({
          signer: keypairSigner(kp),
          tipAccount: pickJitoTipAccount(),
          tipLamports: TIP_LAMPORTS,
          recentBlockhash: blockhash,
        }),
        buildDummyBackrunTx(conn, kp, hint.hintId),
      ]);

      await searcher.submitBid({
        hintId: hint.hintId,
        userCashbackLamports: bidAmount,
        jitoTipLamports: TIP_LAMPORTS,
        backrunTx,
        tipTx,
        bidCommitmentSig,
      });
      console.log(
        `[${BOT_NAME}] ▲ bid    hint=${hint.hintId.slice(0, 8)}  bid=${bidAmount}  in ${Date.now() - start}ms`,
      );
    } catch (err) {
      console.error(`[${BOT_NAME}] bid failed:`, (err as Error).message);
    }
  });

  searcher.onAuctionResult((r) => {
    const tag = r.won ? "🏆 WON" : "lost";
    console.log(
      `[${BOT_NAME}] ${tag}   hint=${r.hintId.slice(0, 8)}  yours=${r.yourBid}  winning=${r.winningBid}`,
    );
  });

  await searcher.connect();
  console.log(`[${BOT_NAME}] ✓ connected to ${DEFAULT_RELAY_WS}/searcher`);
  console.log(`[${BOT_NAME}] listening for hints…`);
}

main().catch((err) => {
  console.error(`[${BOT_NAME}] fatal:`, err);
  process.exit(1);
});
