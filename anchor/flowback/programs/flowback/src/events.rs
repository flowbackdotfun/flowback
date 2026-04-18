use anchor_lang::prelude::*;

#[event]
pub struct CashbackSettled {
    pub user: Pubkey,
    pub searcher: Pubkey,
    pub bid_amount: u64,
    pub user_cashback: u64,
    pub protocol_fee: u64,
    pub timestamp: i64,
}
