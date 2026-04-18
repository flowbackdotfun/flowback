use anchor_lang::prelude::*;

#[error_code]
pub enum FlowbackError {
    #[msg("Protocol fee basis points cannot exceed 10,000")]
    InvalidProtocolFeeBps,
    #[msg("The protocol is currently paused")]
    ProtocolPaused,
    #[msg("The provided user account does not match the instruction argument")]
    UserAccountMismatch,
    #[msg("The provided treasury account does not match the configured treasury")]
    TreasuryMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
