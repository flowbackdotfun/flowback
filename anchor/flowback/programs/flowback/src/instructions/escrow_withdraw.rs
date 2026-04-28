use anchor_lang::prelude::*;

use crate::{EscrowWithdrawn, FlowbackError, SearcherEscrow, ESCROW_SEED};

#[derive(Accounts)]
pub struct EscrowWithdraw<'info> {
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, searcher.key().as_ref()],
        bump = escrow.bump,
        has_one = searcher,
    )]
    pub escrow: Account<'info, SearcherEscrow>,
}

pub fn handle_escrow_withdraw(ctx: Context<EscrowWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, FlowbackError::MathOverflow);

    let escrow_info = ctx.accounts.escrow.to_account_info();
    let rent_min = Rent::get()?.minimum_balance(escrow_info.data_len());
    let current = escrow_info.lamports();

    let post = current
        .checked_sub(amount)
        .ok_or(FlowbackError::InsufficientEscrow)?;
    require!(post >= rent_min, FlowbackError::RentBreach);

    let searcher_info = ctx.accounts.searcher.to_account_info();

    **escrow_info.try_borrow_mut_lamports()? = post;
    **searcher_info.try_borrow_mut_lamports()? = searcher_info
        .lamports()
        .checked_add(amount)
        .ok_or(FlowbackError::MathOverflow)?;

    emit!(EscrowWithdrawn {
        searcher: ctx.accounts.searcher.key(),
        amount,
        balance: post,
    });

    Ok(())
}
