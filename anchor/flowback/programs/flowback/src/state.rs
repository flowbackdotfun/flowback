use anchor_lang::prelude::*;

#[account]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub protocol_fee_bps: u16,
    pub paused: bool,
    pub total_cashback_paid: u64,
    pub total_swaps_processed: u64,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const LEN: usize = 32 + 32 + 2 + 1 + 8 + 8 + 1;
}

/// Per-searcher escrow PDA. Lamports above the rent-exempt minimum form the
/// withdrawable escrow balance debited by `settle_from_escrow`.
#[account]
pub struct SearcherEscrow {
    pub searcher: Pubkey,
    pub bump: u8,
}

impl SearcherEscrow {
    pub const LEN: usize = 32 + 1;
}

/// Replay-protection marker. Existence at PDA `[USED_HINT_SEED, hint_id]`
/// means the auction with that `hint_id` has already settled. The `init`
/// constraint on `settle_from_escrow` fails on re-use.
#[account]
pub struct UsedHint {
    pub bump: u8,
}

impl UsedHint {
    pub const LEN: usize = 1;
}
