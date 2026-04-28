import { PublicKey } from "@solana/web3.js";

/**
 * Anchor instruction discriminators (first 8 bytes of `sha256("global:<ix>")`).
 * Hardcoded so the SDK has zero runtime dependency on the IDL or an Anchor
 * client. Verified against the FlowBack program's compiled IDL.
 */
export const SETTLE_FROM_ESCROW_DISCRIMINATOR = Uint8Array.of(
  133, 156, 159, 225, 55, 206, 255, 88,
);
export const ESCROW_INIT_DISCRIMINATOR = Uint8Array.of(
  11, 31, 91, 199, 154, 124, 137, 116,
);
export const ESCROW_DEPOSIT_DISCRIMINATOR = Uint8Array.of(
  137, 100, 252, 219, 140, 205, 146, 215,
);
export const ESCROW_WITHDRAW_DISCRIMINATOR = Uint8Array.of(
  18, 43, 142, 216, 48, 23, 21, 254,
);

/** PDA seeds used by the FlowBack program. */
export const CONFIG_SEED = Buffer.from("config");
export const ESCROW_SEED = Buffer.from("escrow");
export const USED_HINT_SEED = Buffer.from("used_hint");

/** Derive the per-program `ProtocolConfig` PDA. */
export function deriveConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

/** Derive the per-searcher `SearcherEscrow` PDA. */
export function deriveEscrowPda(
  programId: PublicKey,
  searcher: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ESCROW_SEED, searcher.toBuffer()],
    programId,
  );
}
