import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import {
  DEFAULT_PROGRAM_ID,
  DEFAULT_RPC,
  airdropIfLow,
  connection,
  loadOrCreateKeypair,
} from "./lib/util.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ANCHOR_DIR = path.join(ROOT, "anchor", "flowback");
const PROGRAM_SO = path.join(ANCHOR_DIR, "target", "deploy", "flowback.so");
const PROGRAM_KEYPAIR = path.join(
  ANCHOR_DIR,
  "target",
  "deploy",
  "flowback-keypair.json",
);
const RELAY_ENV = path.join(ROOT, "relay", ".env");

function log(msg: string): void {
  console.log(`[demo] ${msg}`);
}

function loadRelayKeypair(): Keypair | null {
  if (!existsSync(RELAY_ENV)) return null;
  const content = readFileSync(RELAY_ENV, "utf-8");
  const match = content.match(/^RELAY_KEYPAIR=(.+)$/m);
  if (!match) return null;
  try {
    const bytes = JSON.parse(match[1]!) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const conn = connection();

  log("═══════════════════════════════════════════");
  log("  FlowBack Demo Setup (Surfpool)");
  log("═══════════════════════════════════════════");

  // 1. Check RPC connectivity
  log("");
  log("▸ Checking RPC at " + DEFAULT_RPC);
  try {
    const version = await conn.getVersion();
    log(`✓ Connected (solana-core ${version["solana-core"]})`);
  } catch {
    log("✗ Cannot reach " + DEFAULT_RPC);
    log("  Start Surfpool first:");
    log("    surfpool start --network mainnet");
    process.exit(1);
  }

  // 2. Fund default CLI wallet (needed for program deploy + init)
  log("");
  log("▸ Funding CLI wallet for deployment...");
  const authority = loadOrCreateKeypair("authority");
  log(`  authority: ${authority.publicKey.toBase58()}`);
  await airdropIfLow(conn, authority.publicKey, 10_000_000_000, 100_000_000_000);
  log("✓ Authority funded");

  // 3. Deploy FlowBack program
  log("");
  log("▸ Deploying FlowBack program...");
  const programId = new PublicKey(DEFAULT_PROGRAM_ID);
  const progInfo = await conn.getAccountInfo(programId);
  if (progInfo?.executable) {
    log("✓ Program already deployed");
  } else {
    if (!existsSync(PROGRAM_SO)) {
      log("  Building anchor program...");
      execSync("anchor build", { cwd: ANCHOR_DIR, stdio: "inherit" });
    }
    execSync(
      `solana program deploy "${PROGRAM_SO}" --program-id "${PROGRAM_KEYPAIR}" -u ${DEFAULT_RPC} -k ~/.config/solana/id.json`,
      { stdio: "inherit" },
    );
    log("✓ Program deployed");
  }

  // 4. Init protocol config
  log("");
  log("▸ Initializing protocol...");
  execSync("pnpm run init", { cwd: import.meta.dirname, stdio: "inherit" });

  // 5. Fund relay keypair
  log("");
  log("▸ Funding relay keypair...");
  const relayKp = loadRelayKeypair();
  if (relayKp) {
    await airdropIfLow(conn, relayKp.publicKey, 5_000_000_000, 10_000_000_000);
    log(`✓ Relay funded: ${relayKp.publicKey.toBase58()}`);
  } else {
    log("⚠ Could not load RELAY_KEYPAIR from relay/.env — fund manually");
  }

  // 6. Fund and setup searcher bot escrow
  log("");
  log("▸ Setting up searcher escrow...");
  const searcherKp = loadOrCreateKeypair("searcher-0");
  log(`  searcher: ${searcherKp.publicKey.toBase58()}`);
  await airdropIfLow(conn, searcherKp.publicKey, 5_000_000_000, 10_000_000_000);
  log("✓ Searcher funded (escrow will be initialized when bot starts)");

  // Done
  log("");
  log("═══════════════════════════════════════════");
  log("  Setup complete! Start the demo:");
  log("═══════════════════════════════════════════");
  log("");
  log("  1. Start relay:        cd relay && pnpm dev");
  log("  2. Start searcher bot: cd scripts && pnpm run searcher");
  log("  3. Start client:       cd client && pnpm dev");
  log("");
  log("  Then in the browser:");
  log("  4. Set wallet RPC to:  " + DEFAULT_RPC);
  log("  5. Airdrop SOL:");
  log("     solana airdrop 10 <WALLET_PUBKEY> -u " + DEFAULT_RPC);
  log("  6. Swap!");
  log("");
}

main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
