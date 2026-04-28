use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};

use crate::{EscrowDeposited, FlowbackError, SearcherEscrow, ESCROW_SEED};

#[derive(Accounts)]
pub struct EscrowDeposit<'info> {
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, searcher.key().as_ref()],
        bump = escrow.bump,
        has_one = searcher,
    )]
    pub escrow: Account<'info, SearcherEscrow>,
    pub system_program: Program<'info, System>,
}

pub fn handle_escrow_deposit(ctx: Context<EscrowDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, FlowbackError::MathOverflow);

    let cpi_accounts = Transfer {
        from: ctx.accounts.searcher.to_account_info(),
        to: ctx.accounts.escrow.to_account_info(),
    };
    system_program::transfer(
        CpiContext::new(system_program::ID, cpi_accounts),
        amount,
    )?;

    let balance = ctx.accounts.escrow.to_account_info().lamports();

    emit!(EscrowDeposited {
        searcher: ctx.accounts.searcher.key(),
        amount,
        balance,
    });

    Ok(())
}
