use anchor_lang::prelude::*;

use crate::{FlowbackError, ProtocolConfig, CONFIG_SEED, MAX_BPS};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    protocol_fee_bps: u16,
    treasury: Pubkey,
    paused: bool,
) -> Result<()> {
    require!(
        protocol_fee_bps <= MAX_BPS,
        FlowbackError::InvalidProtocolFeeBps
    );

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.treasury = treasury;
    config.protocol_fee_bps = protocol_fee_bps;
    config.paused = paused;
    config.total_cashback_paid = 0;
    config.total_swaps_processed = 0;
    config.bump = ctx.bumps.config;

    Ok(())
}
