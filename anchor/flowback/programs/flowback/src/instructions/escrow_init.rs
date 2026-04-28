use anchor_lang::prelude::*;

use crate::{SearcherEscrow, ESCROW_SEED};

#[derive(Accounts)]
pub struct EscrowInit<'info> {
    #[account(mut)]
    pub searcher: Signer<'info>,
    #[account(
        init,
        payer = searcher,
        space = 8 + SearcherEscrow::LEN,
        seeds = [ESCROW_SEED, searcher.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, SearcherEscrow>,
    pub system_program: Program<'info, System>,
}

pub fn handle_escrow_init(ctx: Context<EscrowInit>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    escrow.searcher = ctx.accounts.searcher.key();
    escrow.bump = ctx.bumps.escrow;
    Ok(())
}
