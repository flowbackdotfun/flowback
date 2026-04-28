import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Keypair, Connection, type PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export const DEFAULT_RPC =
  process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
export const DEFAULT_RELAY_REST =
  process.env.RELAY_REST_URL ?? "http://localhost:3001";
export const DEFAULT_RELAY_WS =
  process.env.RELAY_WS_URL ?? "ws://localhost:3002";
export const DEFAULT_PROGRAM_ID = process.env.FLOWBACK_PROGRAM_ID;

const KEYS_DIR = path.join(import.meta.dirname ?? __dirname, "..", "keys");

export function ensureKeysDir(): void {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
}

/**
 * Load a keypair from `~/.config/solana/id.json` or fall back to a generated
 * one stored under `scripts/keys/<name>.json`. New keypairs are persisted so
 * subsequent runs reuse the same identity (so escrow PDAs stay valid).
 */
export function loadOrCreateKeypair(name: string): Keypair {
  ensureKeysDir();
  if (name === "authority") {
    const cli = path.join(homedir(), ".config", "solana", "id.json");
    if (existsSync(cli)) {
      const arr = JSON.parse(readFileSync(cli, "utf8")) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  }
  const file = path.join(KEYS_DIR, `${name}.json`);
  if (existsSync(file)) {
    const arr = JSON.parse(readFileSync(file, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const kp = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export function loadKeypairFromFile(filePath: string): Keypair {
  const arr = JSON.parse(readFileSync(filePath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export function connection(): Connection {
  return new Connection(DEFAULT_RPC, "confirmed");
}

/**
 * Top up a wallet from the validator's faucet. Idempotent — skips if balance
 * already exceeds `minLamports`.
 */
export async function airdropIfLow(
  conn: Connection,
  pubkey: PublicKey,
  minLamports: number,
  topUpLamports = 10 * 1_000_000_000,
): Promise<void> {
  const bal = await conn.getBalance(pubkey);
  if (bal >= minLamports) return;
  const sig = await conn.requestAirdrop(pubkey, topUpLamports);
  await conn.confirmTransaction(sig, "confirmed");
}

export function shortPubkey(pk: PublicKey | string): string {
  const s = typeof pk === "string" ? pk : pk.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function bs58ToBytes(s: string): Uint8Array {
  return bs58.decode(s);
}

export function bytesToBs58(b: Uint8Array): string {
  return bs58.encode(b);
}
