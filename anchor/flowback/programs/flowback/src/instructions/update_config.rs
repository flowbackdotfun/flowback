use anchor_lang::prelude::*;

use crate::{FlowbackError, ProtocolConfig, MAX_BPS};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority
    )]
    pub config: Account<'info, ProtocolConfig>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfig>,
    protocol_fee_bps: u16,
    treasury: Pubkey,
    paused: bool,
) -> Result<()> {
    require!(
        protocol_fee_bps <= MAX_BPS,
        FlowbackError::InvalidProtocolFeeBps
    );

    let config = &mut ctx.accounts.config;
    config.protocol_fee_bps = protocol_fee_bps;
    config.treasury = treasury;
    config.paused = paused;

    Ok(())
}
