use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{CashbackSettled, FlowbackError, ProtocolConfig, CONFIG_SEED, MAX_BPS};

#[derive(Accounts)]
#[instruction(bid_amount: u64, user: Pubkey)]
pub struct SettleCashback<'info> {
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        address = user @ FlowbackError::UserAccountMismatch
    )]
    pub user_account: SystemAccount<'info>,
    #[account(
        mut,
        address = config.treasury @ FlowbackError::TreasuryMismatch
    )]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_settle_cashback(
    ctx: Context<SettleCashback>,
    bid_amount: u64,
    user: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.paused, FlowbackError::ProtocolPaused);
    require!(
        config.protocol_fee_bps <= MAX_BPS,
        FlowbackError::InvalidProtocolFeeBps
    );

    let protocol_fee = bid_amount
        .checked_mul(config.protocol_fee_bps as u64)
        .ok_or(FlowbackError::MathOverflow)?
        .checked_div(MAX_BPS as u64)
        .ok_or(FlowbackError::MathOverflow)?;
    let user_cashback = bid_amount
        .checked_sub(protocol_fee)
        .ok_or(FlowbackError::MathOverflow)?;

    transfer_lamports(
        &ctx.accounts.searcher,
        &ctx.accounts.user_account,
        user_cashback,
    )?;
    transfer_lamports(&ctx.accounts.searcher, &ctx.accounts.treasury, protocol_fee)?;

    config.total_cashback_paid = config
        .total_cashback_paid
        .checked_add(user_cashback)
        .ok_or(FlowbackError::MathOverflow)?;
    config.total_swaps_processed = config
        .total_swaps_processed
        .checked_add(1)
        .ok_or(FlowbackError::MathOverflow)?;

    emit!(CashbackSettled {
        user,
        searcher: ctx.accounts.searcher.key(),
        bid_amount,
        user_cashback,
        protocol_fee,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

fn transfer_lamports<'info>(
    from: &Signer<'info>,
    to: &SystemAccount<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
    };

    system_program::transfer(CpiContext::new(system_program::ID, cpi_accounts), amount)
}
