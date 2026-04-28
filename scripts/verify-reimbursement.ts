/**
 * Verifies that a settle_from_escrow tx debited only the searcher's escrow
 * (by bid + reimbursement), credited the user/treasury correctly, and left
 * the relay with net-zero balance change.
 *
 * Usage:
 *   pnpm verify <settle-tx-signature>
 *   pnpm verify <settle-tx-signature> <expected-bid-lamports>   # optional: assert exact bid
 */

import { PublicKey } from "@solana/web3.js";

import { connection, DEFAULT_PROGRAM_ID } from "./lib/util.js";

const PROTOCOL_FEE_BPS = 1_000n; // matches `pnpm init` config
const TX_FEE_LAMPORTS = 10_000n; // 1 tx-level sig + 1 Ed25519 precompile sig × 5,000

interface AccountChange {
  index: number;
  pubkey: string;
  preLamports: bigint;
  postLamports: bigint;
  delta: bigint;
}

function fmt(n: bigint): string {
  const s = n.toString();
  if (s.startsWith("-")) return s.replace(/^-/, "−");
  return n > 0n ? `+${s}` : s;
}

async function main(): Promise<void> {
  const sig = process.argv[2];
  if (!sig) {
    console.error("usage: pnpm verify <signature> [expected-bid-lamports]");
    process.exit(1);
  }
  const expectedBidLamports = process.argv[3]
    ? BigInt(process.argv[3])
    : null;

  const conn = connection();
  const tx = await conn.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    console.error(`tx not found: ${sig}`);
    process.exit(2);
  }
  if (tx.meta?.err) {
    console.error(`tx failed: ${JSON.stringify(tx.meta.err)}`);
    process.exit(2);
  }

  const accountKeys = tx.transaction.message.staticAccountKeys.map((k) =>
    k.toBase58(),
  );
  const pre = tx.meta!.preBalances;
  const post = tx.meta!.postBalances;
  const fee = BigInt(tx.meta!.fee);

  const changes: AccountChange[] = accountKeys.map((pk, i) => ({
    index: i,
    pubkey: pk,
    preLamports: BigInt(pre[i]!),
    postLamports: BigInt(post[i]!),
    delta: BigInt(post[i]!) - BigInt(pre[i]!),
  }));

  // Account 0 of any tx is the fee payer = relay.
  const relay = changes[0]!;

  console.log(`\nTransaction: ${sig}`);
  console.log(`Slot: ${tx.slot}`);
  console.log(`Fee paid: ${fee} lamports (deducted from relay = account 0)`);
  console.log("");
  console.log("Account balances (pre → post):");
  console.log(
    "─────────────────────────────────────────────────────────────────────────────",
  );
  for (const c of changes) {
    const role =
      c.index === 0
        ? "RELAY (fee payer)"
        : c.pubkey === DEFAULT_PROGRAM_ID
          ? "FlowBack program"
          : "";
    console.log(
      `  [${c.index}] ${c.pubkey}  ${role}\n      ${c.preLamports.toString().padStart(15)} → ${c.postLamports
        .toString()
        .padStart(15)}   delta: ${fmt(c.delta).padStart(13)}`,
    );
  }
  console.log(
    "─────────────────────────────────────────────────────────────────────────────",
  );

  // ── invariants ──────────────────────────────────────────────────────────
  console.log("\nReimbursement audit:");

  // Expected: relay's net change is exactly 0 — fee + init-rent paid, both
  // refunded by the escrow inside the same tx.
  if (relay.delta === 0n) {
    console.log(
      `  ✓ relay net change is 0 (fee + init rent fully reimbursed by escrow)`,
    );
  } else {
    console.log(
      `  ✗ relay net change is ${fmt(relay.delta)} — expected 0`,
    );
    console.log(
      `    (positive = relay over-collected, negative = relay leaked SOL)`,
    );
  }

  // Find the escrow (negative delta), user (positive ~90% of bid),
  // treasury (positive ~10% of bid), used_hint (positive rent, freshly created).
  const decreasing = changes.filter((c) => c.delta < 0n && c.index !== 0);
  const increasing = changes.filter((c) => c.delta > 0n && c.index !== 0);
  const fresh = changes.filter(
    (c) => c.preLamports === 0n && c.postLamports > 0n,
  );

  if (decreasing.length === 1) {
    const escrow = decreasing[0]!;
    console.log(
      `  ✓ exactly one debited account (escrow PDA = account ${escrow.index})`,
    );

    if (expectedBidLamports !== null) {
      const expectedFee =
        (expectedBidLamports * PROTOCOL_FEE_BPS) / 10_000n;
      const expectedUser = expectedBidLamports - expectedFee;

      // total escrow drop = bid + used_hint_rent + tx_fee
      // fresh account = the new UsedHint PDA → its postLamports IS the rent
      const usedHintRent = fresh[0]?.postLamports ?? 0n;
      const expectedDebit =
        expectedBidLamports + usedHintRent + TX_FEE_LAMPORTS;
      const escrowDebit = -escrow.delta;

      if (escrowDebit === expectedDebit) {
        console.log(
          `  ✓ escrow debit = ${escrowDebit}  (= bid ${expectedBidLamports} + rent ${usedHintRent} + fee ${TX_FEE_LAMPORTS})`,
        );
      } else {
        console.log(
          `  ✗ escrow debit = ${escrowDebit}, expected ${expectedDebit} (off by ${fmt(escrowDebit - expectedDebit)})`,
        );
      }

      // user/treasury credit checks
      const userCredit = increasing.find((c) => c.delta === expectedUser);
      const treasuryCredit = increasing.find((c) => c.delta === expectedFee);
      console.log(
        userCredit
          ? `  ✓ user credited ${expectedUser} (account ${userCredit.index})`
          : `  ✗ no user credit of exactly ${expectedUser} found`,
      );
      console.log(
        treasuryCredit
          ? `  ✓ treasury credited ${expectedFee} (account ${treasuryCredit.index})`
          : `  ✗ no treasury credit of exactly ${expectedFee} found`,
      );
    }
  } else {
    console.log(
      `  ✗ expected exactly 1 debited account (escrow), found ${decreasing.length}`,
    );
  }

  // Lamport conservation across visible accounts: inputs - outputs = burn (50% of fee)
  const totalDelta = changes.reduce((acc, c) => acc + c.delta, 0n);
  const expectedBurn = -fee / 2n; // Solana burns 50% of base tx fees
  if (totalDelta === expectedBurn) {
    console.log(
      `  ✓ lamport conservation holds (total delta ${totalDelta} = -fee/2 burn)`,
    );
  } else {
    console.log(
      `  ⚠ lamport conservation off: total delta = ${totalDelta}, expected ${expectedBurn} (fee burn). Difference: ${fmt(totalDelta - expectedBurn)}`,
    );
  }

  console.log("");
  console.log("Program logs (looking for [settle: ...] msg! line):");
  for (const log of tx.meta?.logMessages ?? []) {
    if (log.includes("settle:") || log.includes("Program log:")) {
      console.log(`  ${log}`);
    }
  }
}

main().catch((err) => {
  console.error("verify failed:", err);
  process.exit(1);
});
