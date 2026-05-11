import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
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

// ── Config ──────────────────────────────────────────────────────────────────

const RELAY_WS_URL = process.env.RELAY_WS_URL ?? "ws://localhost:3002";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const PROGRAM_ID = process.env.FLOWBACK_PROGRAM_ID!;
const KEYPAIR_PATH = process.env.KEYPAIR_PATH;
const ESCROW_DEPOSIT = BigInt(process.env.ESCROW_DEPOSIT ?? "2000000000"); // 2 SOL
const TIP_LAMPORTS = 10_000n;

if (!PROGRAM_ID) {
  console.error("FLOWBACK_PROGRAM_ID is required");
  process.exit(1);
}

// ── Keypair ─────────────────────────────────────────────────────────────────

function loadKeypair(): Keypair {
  if (KEYPAIR_PATH) {
    const raw = JSON.parse(readFileSync(KEYPAIR_PATH, "utf-8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  console.log("[seed-bot] generated ephemeral keypair:", kp.publicKey.toBase58());
  console.log("[seed-bot] fund it and restart, or set KEYPAIR_PATH to persist");
  return kp;
}

// ── Escrow setup ────────────────────────────────────────────────────────────

async function ensureEscrow(conn: Connection, kp: Keypair): Promise<void> {
  const signer = keypairSigner(kp);
  const programId = new PublicKey(PROGRAM_ID);
  const [escrowPda] = deriveEscrowPda(programId, kp.publicKey);
  const existing = await conn.getAccountInfo(escrowPda);

  let blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;

  if (!existing) {
    const initB64 = await buildEscrowInitTx({
      signer,
      programId: PROGRAM_ID,
      recentBlockhash: blockhash,
    });
    const sig = await conn.sendRawTransaction(Buffer.from(initB64, "base64"));
    await conn.confirmTransaction(sig, "confirmed");
    console.log("[seed-bot] escrow initialized");
  }

  const balance = await conn.getBalance(escrowPda);
  const rentMin = await conn.getMinimumBalanceForRentExemption(8 + 33);
  const usable = BigInt(Math.max(0, balance - rentMin));

  if (usable < ESCROW_DEPOSIT) {
    const amount = ESCROW_DEPOSIT - usable;
    blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    const depositB64 = await buildEscrowDepositTx({
      signer,
      programId: PROGRAM_ID,
      amount,
      recentBlockhash: blockhash,
    });
    const sig = await conn.sendRawTransaction(Buffer.from(depositB64, "base64"));
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`[seed-bot] deposited ${amount} lamports into escrow`);
  } else {
    console.log(`[seed-bot] escrow funded (${usable} lamports usable)`);
  }
}

// ── Bid logic ───────────────────────────────────────────────────────────────

const BUCKET_BASE: Record<string, [min: bigint, max: bigint]> = {
  small: [300_000n, 800_000n],
  medium: [1_500_000n, 4_000_000n],
  large: [8_000_000n, 25_000_000n],
  whale: [50_000_000n, 120_000_000n],
};

function computeBid(hint: SearcherHint): bigint {
  const [min, max] = BUCKET_BASE[hint.sizeBucket] ?? BUCKET_BASE.medium!;
  const range = max - min;
  return min + BigInt(Math.floor(Math.random() * Number(range)));
}

async function buildBackrunTx(conn: Connection, kp: Keypair): Promise<string> {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
  const tx = new Transaction().add(ix);
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(kp);
  return tx.serialize().toString("base64");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const kp = loadKeypair();
  const conn = new Connection(RPC_URL, "confirmed");
  const signer = keypairSigner(kp);

  console.log("[seed-bot] pubkey:", kp.publicKey.toBase58());
  console.log("[seed-bot] program:", PROGRAM_ID);
  console.log("[seed-bot] relay:", RELAY_WS_URL);

  await ensureEscrow(conn, kp);

  const searcher = new FlowbackSearcher({
    relayUrl: `${RELAY_WS_URL}/searcher`,
    signer,
    programId: PROGRAM_ID,
    rpcUrl: RPC_URL,
  });

  searcher.onHint(async (hint) => {
    try {
      const bidAmount = computeBid(hint);
      const blockhash = await searcher.getRecentBlockhash();

      const [bidCommitmentSig, tipTx, backrunTx] = await Promise.all([
        signBidCommitment({ signer, hintId: hint.hintId, bidAmount }),
        buildJitoTipTx({
          signer,
          tipAccount: pickJitoTipAccount(),
          tipLamports: TIP_LAMPORTS,
          recentBlockhash: blockhash,
        }),
        buildBackrunTx(conn, kp),
      ]);

      await searcher.submitBid({
        hintId: hint.hintId,
        userCashbackLamports: bidAmount,
        jitoTipLamports: TIP_LAMPORTS,
        backrunTx,
        tipTx,
        bidCommitmentSig,
      });

      console.log(`[seed-bot] bid ${bidAmount} on ${hint.hintId.slice(0, 8)}`);
    } catch (err) {
      console.error("[seed-bot] bid failed:", (err as Error).message);
    }
  });

  searcher.onAuctionResult((r) => {
    console.log(
      `[seed-bot] ${r.won ? "WON" : "lost"} ${r.hintId.slice(0, 8)}  yours=${r.yourBid}  winning=${r.winningBid}`,
    );
  });

  searcher.onError((err) => console.error("[seed-bot] error:", err.message));
  searcher.onDisconnect(() => console.log("[seed-bot] disconnected"));

  await searcher.connect();
  console.log("[seed-bot] connected, listening for hints...");
}

main().catch((err) => {
  console.error("[seed-bot] fatal:", err);
  process.exit(1);
});
