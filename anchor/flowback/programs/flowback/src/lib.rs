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

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        protocol_fee_bps: u16,
        treasury: Pubkey,
        paused: bool,
    ) -> Result<()> {
        update_config::handle_update_config(ctx, protocol_fee_bps, treasury, paused)
    }

    pub fn escrow_init(ctx: Context<EscrowInit>) -> Result<()> {
        escrow_init::handle_escrow_init(ctx)
    }

    pub fn escrow_deposit(ctx: Context<EscrowDeposit>, amount: u64) -> Result<()> {
        escrow_deposit::handle_escrow_deposit(ctx, amount)
    }

    pub fn escrow_withdraw(ctx: Context<EscrowWithdraw>, amount: u64) -> Result<()> {
        escrow_withdraw::handle_escrow_withdraw(ctx, amount)
    }

    pub fn settle_from_escrow(
        ctx: Context<SettleFromEscrow>,
        bid_amount: u64,
        user: Pubkey,
        hint_id: [u8; HINT_ID_LEN],
    ) -> Result<()> {
        settle_from_escrow::handle_settle_from_escrow(ctx, bid_amount, user, hint_id)
    }
}
