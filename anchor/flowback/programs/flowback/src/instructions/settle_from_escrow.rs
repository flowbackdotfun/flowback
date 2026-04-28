use anchor_lang::prelude::*;
use solana_instructions_sysvar::load_instruction_at_checked;
use solana_sdk_ids::{ed25519_program, sysvar::instructions::ID as IX_SYSVAR_ID};

use crate::{
    CashbackSettled, FlowbackError, ProtocolConfig, SearcherEscrow, UsedHint, BID_MESSAGE_PREFIX,
    CONFIG_SEED, ESCROW_SEED, HINT_ID_LEN, MAX_BPS, TX_FEE_REIMBURSEMENT_LAMPORTS, USED_HINT_SEED,
};

#[derive(Accounts)]
#[instruction(bid_amount: u64, user: Pubkey, hint_id: [u8; HINT_ID_LEN])]
pub struct SettleFromEscrow<'info> {
    /// Relay (or any caller) that pays tx fees and the rent for `used_hint`.
    /// The on-chain authority over the bid amount comes from the Ed25519
    /// signature, not from this signer.
    #[account(mut)]
    pub relay_payer: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.searcher.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, SearcherEscrow>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        address = user @ FlowbackError::UserAccountMismatch,
    )]
    pub user_account: SystemAccount<'info>,
    #[account(
        mut,
        address = config.treasury @ FlowbackError::TreasuryMismatch,
    )]
    pub treasury: SystemAccount<'info>,
    #[account(
        init,
        payer = relay_payer,
        space = 8 + UsedHint::LEN,
        seeds = [USED_HINT_SEED, hint_id.as_ref()],
        bump,
    )]
    pub used_hint: Account<'info, UsedHint>,
    /// CHECK: verified by address constraint to the instructions sysvar.
    #[account(address = IX_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_settle_from_escrow(
    ctx: Context<SettleFromEscrow>,
    bid_amount: u64,
    user: Pubkey,
    hint_id: [u8; HINT_ID_LEN],
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.paused, FlowbackError::ProtocolPaused);
    require!(
        config.protocol_fee_bps <= MAX_BPS,
        FlowbackError::InvalidProtocolFeeBps
    );
    require!(bid_amount > 0, FlowbackError::MathOverflow);

    // 1. Verify a single-signature Ed25519 sigverify ix at index 0.
    let ed25519_ix = load_instruction_at_checked(0, &ctx.accounts.instructions_sysvar)
        .map_err(|_| error!(FlowbackError::MissingEd25519Ix))?;
    require!(
        ed25519_ix.program_id == ed25519_program::ID,
        FlowbackError::MissingEd25519Ix
    );

    let (verified_pubkey, verified_message) = parse_ed25519_ix(&ed25519_ix.data)?;

    // 2. The signer of the off-chain bid commitment must be the escrow's searcher.
    require!(
        verified_pubkey == ctx.accounts.escrow.searcher.to_bytes(),
        FlowbackError::Ed25519PubkeyMismatch
    );

    // 3. Reconstruct the canonical message and require an exact match.
    let expected_message = build_bid_message(&hint_id, bid_amount);
    require!(
        verified_message == expected_message,
        FlowbackError::Ed25519MessageMismatch
    );

    // 4. Compute the split.
    let protocol_fee = bid_amount
        .checked_mul(config.protocol_fee_bps as u64)
        .ok_or(FlowbackError::MathOverflow)?
        .checked_div(MAX_BPS as u64)
        .ok_or(FlowbackError::MathOverflow)?;
    let user_share = bid_amount
        .checked_sub(protocol_fee)
        .ok_or(FlowbackError::MathOverflow)?;

    // 5. Compute the relay reimbursement: tx fee (paid from relay's wallet
    //    when this tx lands) + UsedHint rent (already paid by relay via the
    //    `init` constraint above). Both come back to the relay from the
    //    searcher's escrow so the relay's per-settlement net-cost is zero.
    let used_hint_rent = Rent::get()?.minimum_balance(8 + UsedHint::LEN);
    let reimbursement = used_hint_rent
        .checked_add(TX_FEE_REIMBURSEMENT_LAMPORTS)
        .ok_or(FlowbackError::MathOverflow)?;
    let total_debit = bid_amount
        .checked_add(reimbursement)
        .ok_or(FlowbackError::MathOverflow)?;

    // 6. Debit the escrow PDA directly (program-owned, can't use System::transfer).
    let escrow_info = ctx.accounts.escrow.to_account_info();
    let escrow_rent_min = Rent::get()?.minimum_balance(escrow_info.data_len());
    let escrow_balance = escrow_info.lamports();
    let post_balance = escrow_balance
        .checked_sub(total_debit)
        .ok_or(FlowbackError::InsufficientEscrow)?;
    require!(
        post_balance >= escrow_rent_min,
        FlowbackError::InsufficientEscrow
    );

    let user_info = ctx.accounts.user_account.to_account_info();
    let treasury_info = ctx.accounts.treasury.to_account_info();
    let relay_info = ctx.accounts.relay_payer.to_account_info();

    **escrow_info.try_borrow_mut_lamports()? = post_balance;
    **user_info.try_borrow_mut_lamports()? = user_info
        .lamports()
        .checked_add(user_share)
        .ok_or(FlowbackError::MathOverflow)?;
    **treasury_info.try_borrow_mut_lamports()? = treasury_info
        .lamports()
        .checked_add(protocol_fee)
        .ok_or(FlowbackError::MathOverflow)?;
    **relay_info.try_borrow_mut_lamports()? = relay_info
        .lamports()
        .checked_add(reimbursement)
        .ok_or(FlowbackError::MathOverflow)?;

    msg!(
        "settle: bid={} user_share={} fee={} reimburse={}",
        bid_amount,
        user_share,
        protocol_fee,
        reimbursement
    );

    // 7. Record the used_hint bump (replay guard already armed via init).
    ctx.accounts.used_hint.bump = ctx.bumps.used_hint;

    // 8. Update counters and emit.
    config.total_cashback_paid = config
        .total_cashback_paid
        .checked_add(user_share)
        .ok_or(FlowbackError::MathOverflow)?;
    config.total_swaps_processed = config
        .total_swaps_processed
        .checked_add(1)
        .ok_or(FlowbackError::MathOverflow)?;

    emit!(CashbackSettled {
        user,
        searcher: ctx.accounts.escrow.searcher,
        bid_amount,
        user_cashback: user_share,
        protocol_fee,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Decode the Ed25519 sigverify instruction that lives at index 0 in the
/// transaction. We expect a single-signature layout where the signature,
/// pubkey, and message all live inside the same instruction's data buffer
/// (the most common case, produced by `Ed25519Program::new_ed25519_instruction`).
fn parse_ed25519_ix(data: &[u8]) -> Result<([u8; 32], Vec<u8>)> {
    // Layout (per solana-program ed25519_program docs):
    //   u8  num_signatures
    //   u8  padding
    //   Ed25519SignatureOffsets[num_signatures]   // 14 bytes each
    //   ...message/pubkey/signature blobs...
    //
    // Ed25519SignatureOffsets:
    //   u16 signature_offset
    //   u16 signature_instruction_index
    //   u16 public_key_offset
    //   u16 public_key_instruction_index
    //   u16 message_data_offset
    //   u16 message_data_size
    //   u16 message_instruction_index
    require!(data.len() >= 2 + 14, FlowbackError::InvalidEd25519Ix);
    let num_sigs = data[0];
    require!(num_sigs == 1, FlowbackError::InvalidEd25519Ix);

    let offsets = &data[2..16];
    let signature_offset = u16::from_le_bytes([offsets[0], offsets[1]]) as usize;
    let signature_instruction_index = u16::from_le_bytes([offsets[2], offsets[3]]);
    let public_key_offset = u16::from_le_bytes([offsets[4], offsets[5]]) as usize;
    let public_key_instruction_index = u16::from_le_bytes([offsets[6], offsets[7]]);
    let message_offset = u16::from_le_bytes([offsets[8], offsets[9]]) as usize;
    let message_size = u16::from_le_bytes([offsets[10], offsets[11]]) as usize;
    let message_instruction_index = u16::from_le_bytes([offsets[12], offsets[13]]);

    // We require all blobs to live in this same instruction's data
    // (instruction_index == u16::MAX in the sysvar convention). 0xFFFF means
    // "current instruction" per Solana's Ed25519 precompile spec.
    const CURRENT_IX: u16 = u16::MAX;
    require!(
        signature_instruction_index == CURRENT_IX
            && public_key_instruction_index == CURRENT_IX
            && message_instruction_index == CURRENT_IX,
        FlowbackError::InvalidEd25519Ix
    );

    require!(
        public_key_offset + 32 <= data.len()
            && signature_offset + 64 <= data.len()
            && message_offset + message_size <= data.len(),
        FlowbackError::InvalidEd25519Ix
    );

    let mut pubkey = [0u8; 32];
    pubkey.copy_from_slice(&data[public_key_offset..public_key_offset + 32]);
    let message = data[message_offset..message_offset + message_size].to_vec();
    Ok((pubkey, message))
}

/// Canonical bid commitment message:
///   `flowback-bid:<lowercase hex hint_id>:<decimal bid_amount>`
fn build_bid_message(hint_id: &[u8; HINT_ID_LEN], bid_amount: u64) -> Vec<u8> {
    let mut out = Vec::with_capacity(BID_MESSAGE_PREFIX.len() + HINT_ID_LEN * 2 + 1 + 20);
    out.extend_from_slice(BID_MESSAGE_PREFIX);
    for byte in hint_id {
        out.push(hex_nibble(byte >> 4));
        out.push(hex_nibble(byte & 0x0f));
    }
    out.push(b':');
    let amount_str = bid_amount.to_string();
    out.extend_from_slice(amount_str.as_bytes());
    out
}

#[inline]
fn hex_nibble(n: u8) -> u8 {
    match n {
        0..=9 => b'0' + n,
        _ => b'a' + (n - 10),
    }
}
