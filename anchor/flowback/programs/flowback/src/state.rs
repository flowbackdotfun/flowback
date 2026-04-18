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
