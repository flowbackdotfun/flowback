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

#[event]
pub struct EscrowDeposited {
    pub searcher: Pubkey,
    pub amount: u64,
    pub balance: u64,
}

#[event]
pub struct EscrowWithdrawn {
    pub searcher: Pubkey,
    pub amount: u64,
    pub balance: u64,
}
