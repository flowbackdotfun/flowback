use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const MAX_BPS: u16 = 10_000;

#[constant]
pub const ESCROW_SEED: &[u8] = b"escrow";

#[constant]
pub const USED_HINT_SEED: &[u8] = b"used_hint";

/// Prefix of the off-chain message a searcher signs to authorise a bid.
/// Full canonical form: `flowback-bid:<hint_id_hex>:<bid_amount_decimal>`.
pub const BID_MESSAGE_PREFIX: &[u8] = b"flowback-bid:";

/// Length of the hint id in raw bytes (matches a UUID).
pub const HINT_ID_LEN: usize = 16;

/// Total fee the relay pays per settlement, in lamports. Solana charges
/// 5,000 lamports per signature, counting BOTH tx-level signatures and
/// signatures inside precompile (Ed25519/secp256k1) instructions.
///
/// Tx3 has:
///   - 1 tx-level signature (relay as fee payer) → 5,000
///   - 1 Ed25519 precompile signature (searcher's bid commitment) → 5,000
/// Total = 10,000 lamports.
///
pub const TX_FEE_REIMBURSEMENT_LAMPORTS: u64 = 10_000;
