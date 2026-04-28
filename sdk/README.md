# @flowback/searcher

Searcher-facing TypeScript SDK for [FlowBack](https://github.com/flowback/flowback) — a Solana sealed-bid backrun auction with on-chain cashback.

Connect to the relay, sign bid commitments, manage your escrow, and assemble Jito bundles. The SDK never asks for your private key: it accepts a `Signer` interface, so you can wire it to a `Keypair`, a remote KMS, a hardware wallet, or anything else that can produce Ed25519 signatures.

## Install

```bash
pnpm add @flowback/searcher
# or
npm install @flowback/searcher
```

Requires Node 18+.

## Quick start

```ts
import { Keypair } from "@solana/web3.js";
import {
  FlowbackSearcher,
  keypairSigner,
  signBidCommitment,
  buildJitoTipTx,
  pickJitoTipAccount,
} from "@flowback/searcher";

const keypair = Keypair.fromSecretKey(/* ... */);

const searcher = new FlowbackSearcher({
  relayUrl: "wss://relay.flowback.xyz/searcher",
  signer: keypairSigner(keypair),
  programId: process.env.FLOWBACK_PROGRAM_ID!,
  rpcUrl: process.env.SOLANA_RPC_URL!,
});

await searcher.connect();

searcher.onHint(async (hint) => {
  const bidAmount = computeBid(hint);            // your bid logic
  const tipLamports = 10_000n;
  const blockhash = await searcher.getRecentBlockhash();

  const bidCommitmentSig = await signBidCommitment({
    signer: searcher.signer,
    hintId: hint.hintId,
    bidAmount,
  });

  const backrunTx = await yourBuildBackrunTx(hint, blockhash);
  const tipTx = await buildJitoTipTx({
    signer: searcher.signer,
    tipLamports,
    tipAccount: pickJitoTipAccount(),
    blockhash,
  });

  await searcher.submitBid({
    hintId: hint.hintId,
    bidAmountLamports: bidAmount,
    jitoTipLamports: tipLamports,
    backrunTx,
    tipTx,
    bidCommitmentSig,
  });
});

searcher.onAuctionResult((r) =>
  console.log(r.won ? `won ${r.hintId}` : `lost ${r.hintId}`),
);
```

## Concepts

**Auth.** Every WebSocket connection authenticates with a signed message — `flowback-searcher-auth:<pubkey>:<timestamp>` — so the relay knows which searcher each bid came from and can rate-limit per pubkey. `connect()` handles this automatically: it builds the auth payload, signs it with your `Signer`, sends it on open, and resolves only after the relay returns `auth_ok` (rejects on timeout or `auth_error`). The timestamp must be within ±60s of relay clock; the SDK uses `Date.now()`. If you ever need the raw payload (e.g. to sign offline or proxy through your own service), `buildAuthMessage(signer, timestamp?)` is exported.

**Hints.** When a user submits an intent, the relay broadcasts a hint to every authenticated searcher. Hints deliberately omit the user's wallet address and exact swap size — only the token pair, a coarse size bucket, and the price-impact estimate are revealed. Searchers have until `auctionDeadlineMs` to bid.

**Bid commitment.** Searchers sign an off-chain message — `flowback-bid:<hintId>:<bidAmount>` — committing to their bid amount for a specific hint. The signature is sent over WebSocket; the FlowBack on-chain program later verifies it via Solana's Ed25519 sigverify precompile when the relay constructs the settlement tx. The user pubkey is never revealed to searchers.

**Escrow.** Every searcher keeps a SOL balance in a program-owned escrow PDA. When you win an auction, the program debits your escrow by `bidAmount + reimbursement`, credits the user (90%) and treasury (10%), and reimburses the relay's tx fee + rent (~`10_000` lamports + UsedHint rent). You fund the escrow with `buildEscrowDepositTx` and pull idle balance with `buildEscrowWithdrawTx`.

**Bundles.** Searchers supply two transactions — a backrun and a Jito tip — and the relay assembles the final bundle (Tx1 user swap + Tx2 backrun + Tx3 settlement). The SDK gives you `buildJitoTipTx` for the tip leg; the backrun is your own logic.

## API

### `new FlowbackSearcher(config)`

```ts
interface ClientConfig {
  relayUrl: string;        // ws:// or wss:// — relay's /searcher endpoint
  signer: Signer;          // your Ed25519 signer (see `keypairSigner`)
  programId: string;       // FlowBack on-chain program id
  rpcUrl: string;          // Solana RPC for blockhash fetching
}
```

Methods:

- `connect(): Promise<void>` — opens the WebSocket, signs the auth challenge, and resolves on `auth_ok`. Rejects on auth failure or 5s timeout.
- `disconnect(): void` — closes cleanly.
- `getRecentBlockhash(): Promise<string>` — convenience wrapper.
- `submitBid(bid): Promise<void>` — resolves on `bid_accepted`, rejects on `bid_rejected`.
- `onHint(cb)`, `onAuctionResult(cb)`, `onBidAccepted(cb)`, `onBidRejected(cb)`, `onError(cb)`, `onDisconnect(cb)` — typed event hooks.

### Signers

```ts
import { keypairSigner } from "@flowback/searcher";

const signer = keypairSigner(keypair);
```

Or implement the `Signer` interface yourself for KMS / hardware wallet / remote signing setups:

```ts
interface Signer {
  publicKey: PublicKey;
  signMessage(msg: Uint8Array): Promise<Uint8Array>;     // raw Ed25519
  signTransaction(tx: Transaction): Promise<Transaction>;
}
```

### Builders

- `buildAuthMessage(signer, timestamp?)` — produces the signed `{ type: "auth", pubkey, signature, timestamp }` payload. Normally you don't call this directly; `connect()` does. Useful if you proxy the WS connection through your own service.
- `signBidCommitment({ signer, hintId, bidAmount })` — produces the base58 Ed25519 signature of `flowback-bid:<hintId>:<bidAmount>`.
- `buildEscrowInitTx`, `buildEscrowDepositTx`, `buildEscrowWithdrawTx` — manage your escrow PDA.
- `buildJitoTipTx` — single `SystemProgram.transfer` to a Jito tip account, signed by you.

### Jito tip accounts

```ts
import {
  JITO_TIP_ACCOUNTS,           // hardcoded snapshot (8 mainnet accounts)
  fetchJitoTipAccounts,        // optional refresh via getTipAccounts RPC
  pickJitoTipAccount,
} from "@flowback/searcher";

// zero-network default
const tip = pickJitoTipAccount();

// long-running bots can refresh periodically
const fresh = await fetchJitoTipAccounts();
const tip2 = pickJitoTipAccount(fresh);
```

### PDAs and discriminators

If you're rolling your own tx builders, the seeds and Anchor instruction discriminators are exported:

```ts
import {
  CONFIG_SEED,
  ESCROW_SEED,
  USED_HINT_SEED,
  ESCROW_INIT_DISCRIMINATOR,
  ESCROW_DEPOSIT_DISCRIMINATOR,
  ESCROW_WITHDRAW_DISCRIMINATOR,
  SETTLE_FROM_ESCROW_DISCRIMINATOR,
  deriveConfigPda,
  deriveEscrowPda,
} from "@flowback/searcher";
```

## License

MIT — see [LICENSE](./LICENSE).
