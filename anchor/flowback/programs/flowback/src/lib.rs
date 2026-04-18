pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("BLZeEY7GZ5AK6gAZQW5BVi9w71yoJig4Kc97bL1HAnP8");

#[program]
pub mod flowback {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        protocol_fee_bps: u16,
        treasury: Pubkey,
        paused: bool,
    ) -> Result<()> {
        initialize::handle_initialize(ctx, protocol_fee_bps, treasury, paused)
    }

    pub fn settle_cashback(
        ctx: Context<SettleCashback>,
        bid_amount: u64,
        user: Pubkey,
    ) -> Result<()> {
        settle_cashback::handle_settle_cashback(ctx, bid_amount, user)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        protocol_fee_bps: u16,
        treasury: Pubkey,
        paused: bool,
    ) -> Result<()> {
        update_config::handle_update_config(ctx, protocol_fee_bps, treasury, paused)
    }
}
