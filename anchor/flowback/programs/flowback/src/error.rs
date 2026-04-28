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
    #[msg("Escrow account searcher does not match the Ed25519-verified pubkey")]
    EscrowOwnerMismatch,
    #[msg("Withdrawal or settlement would drop the escrow below the rent-exempt minimum")]
    RentBreach,
    #[msg("Escrow balance is insufficient for the requested settlement")]
    InsufficientEscrow,
    #[msg("settle_from_escrow must be preceded by an Ed25519 sigverify instruction at index 0")]
    MissingEd25519Ix,
    #[msg("The Ed25519 sigverify instruction has an unexpected layout")]
    InvalidEd25519Ix,
    #[msg("The Ed25519-verified pubkey does not match the searcher escrow's owner")]
    Ed25519PubkeyMismatch,
    #[msg("The Ed25519-verified message does not match the canonical bid commitment")]
    Ed25519MessageMismatch,
}
