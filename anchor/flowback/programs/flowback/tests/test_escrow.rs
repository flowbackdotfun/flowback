use {
    anchor_lang::{
        error::ERROR_CODE_OFFSET, solana_program::instruction::Instruction, InstructionData,
        ToAccountMetas,
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    solana_ed25519_program::new_ed25519_instruction_with_signature,
    solana_keypair::Keypair,
    solana_signer::Signer,
    solana_transaction::{InstructionError, Transaction, TransactionError},
};

const AIRDROP_LAMPORTS: u64 = 5_000_000_000;
const PROTOCOL_FEE_BPS: u16 = 1_000;
const ESCROW_DEPOSIT: u64 = 2_000_000_000;
const BID_LAMPORTS: u64 = 100_000_000;

struct EscrowCtx {
    svm: LiteSVM,
    program_id: anchor_lang::prelude::Pubkey,
    relay: Keypair,
    searcher: Keypair,
    other_searcher: Keypair,
    treasury: Keypair,
    user: Keypair,
    config: anchor_lang::prelude::Pubkey,
    escrow: anchor_lang::prelude::Pubkey,
}

#[test]
fn escrow_init_then_deposit_increases_balance() {
    let mut ctx = setup();
    let before = ctx.svm.get_balance(&ctx.escrow).unwrap();
    deposit(&mut ctx, ESCROW_DEPOSIT).expect("deposit ok");
    let after = ctx.svm.get_balance(&ctx.escrow).unwrap();
    assert_eq!(after - before, ESCROW_DEPOSIT);
}

#[test]
fn escrow_withdraw_returns_lamports_and_keeps_rent() {
    let mut ctx = setup();
    deposit(&mut ctx, ESCROW_DEPOSIT).expect("deposit ok");
    let searcher_before = ctx.svm.get_balance(&ctx.searcher.pubkey()).unwrap();

    withdraw(&mut ctx, ESCROW_DEPOSIT / 2).expect("withdraw ok");

    let searcher_after = ctx.svm.get_balance(&ctx.searcher.pubkey()).unwrap();
    assert!(searcher_after > searcher_before);

    // Withdrawing the entire escrow balance should fail (rent breach).
    let escrow_balance = ctx.svm.get_balance(&ctx.escrow).unwrap();
    let err = withdraw(&mut ctx, escrow_balance).unwrap_err();
    assert!(matches!(
        err.err,
        TransactionError::InstructionError(0, InstructionError::Custom(_)),
    ));
}

#[test]
fn settle_from_escrow_happy_path_credits_user_and_treasury() {
    let mut ctx = setup();
    deposit(&mut ctx, ESCROW_DEPOSIT).expect("deposit ok");

    let user_before = ctx.svm.get_balance(&ctx.user.pubkey()).unwrap();
    let treasury_before = ctx.svm.get_balance(&ctx.treasury.pubkey()).unwrap();
    let escrow_before = ctx.svm.get_balance(&ctx.escrow).unwrap();
    let relay_before = ctx.svm.get_balance(&ctx.relay.pubkey()).unwrap();

    let hint_id = make_hint_id(0xA1);
    let searcher = ctx.searcher.insecure_clone();
    settle(&mut ctx, BID_LAMPORTS, hint_id, &searcher).expect("settle ok");

    let expected_fee = BID_LAMPORTS * PROTOCOL_FEE_BPS as u64 / 10_000;
    let expected_user = BID_LAMPORTS - expected_fee;

    assert_eq!(
        ctx.svm.get_balance(&ctx.user.pubkey()).unwrap() - user_before,
        expected_user
    );
    assert_eq!(
        ctx.svm.get_balance(&ctx.treasury.pubkey()).unwrap() - treasury_before,
        expected_fee
    );

    // Escrow drops by bid + reimbursement (tx fee + UsedHint rent).
    let used_hint_rent = ctx
        .svm
        .minimum_balance_for_rent_exemption(8 + flowback::UsedHint::LEN);
    let reimbursement = used_hint_rent + flowback::TX_FEE_REIMBURSEMENT_LAMPORTS;
    assert_eq!(
        escrow_before - ctx.svm.get_balance(&ctx.escrow).unwrap(),
        BID_LAMPORTS + reimbursement,
    );

    // Relay's net cost is zero: it pays (tx fee + UsedHint rent via Anchor's
    // `init`) up-front and gets reimbursed exactly that amount from the escrow.
    let relay_after = ctx.svm.get_balance(&ctx.relay.pubkey()).unwrap();
    assert_eq!(
        relay_after, relay_before,
        "relay should net zero after reimbursement (before={} after={})",
        relay_before, relay_after,
    );
}

#[test]
fn settle_from_escrow_rejects_replay() {
    let mut ctx = setup();
    deposit(&mut ctx, ESCROW_DEPOSIT).expect("deposit ok");

    let hint_id = make_hint_id(0xB2);
    let searcher = ctx.searcher.insecure_clone();
    settle(&mut ctx, BID_LAMPORTS, hint_id, &searcher).expect("first settle");

    // Force a fresh blockhash so the duplicate signature isn't deduped by the runtime.
    ctx.svm.expire_blockhash();

    let err = settle(&mut ctx, BID_LAMPORTS, hint_id, &searcher).unwrap_err();
    // Anchor's `init` constraint failure on an existing account surfaces as a
    // generic InstructionError — assert the second call fails on the settle ix.
    assert!(matches!(
        err.err,
        TransactionError::InstructionError(1, _),
    ));
}

#[test]
fn settle_from_escrow_rejects_pubkey_mismatch() {
    let mut ctx = setup();
    deposit(&mut ctx, ESCROW_DEPOSIT).expect("deposit ok");

    // Sign with a key that doesn't own this escrow.
    let hint_id = make_hint_id(0xC3);
    let imposter = ctx.other_searcher.insecure_clone();
    let err = settle(&mut ctx, BID_LAMPORTS, hint_id, &imposter).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(
            1,
            InstructionError::Custom(anchor_error(flowback::FlowbackError::Ed25519PubkeyMismatch))
        )
    );
}

#[test]
fn settle_from_escrow_rejects_message_tamper() {
    let mut ctx = setup();
    deposit(&mut ctx, ESCROW_DEPOSIT).expect("deposit ok");

    let hint_id = make_hint_id(0xD4);
    // Sign for amount X but submit ix arg amount Y → message mismatch.
    let signed_amount = BID_LAMPORTS;
    let arg_amount = BID_LAMPORTS + 1;
    let signed_message = build_bid_message(&hint_id, signed_amount);
    let signature = ctx.searcher.sign_message(&signed_message);
    let sig_bytes: [u8; 64] = signature.as_ref().try_into().unwrap();
    let pk_bytes = ctx.searcher.pubkey().to_bytes();

    let ed25519_ix_v3 =
        new_ed25519_instruction_with_signature(&signed_message, &sig_bytes, &pk_bytes);
    let ed25519_ix = convert_ix(ed25519_ix_v3);

    let settle_ix = build_settle_ix(&ctx, arg_amount, hint_id);

    let err = send_tx(&mut ctx.svm, &ctx.relay, &[ed25519_ix, settle_ix]).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(
            1,
            InstructionError::Custom(anchor_error(flowback::FlowbackError::Ed25519MessageMismatch))
        )
    );
}

#[test]
fn settle_from_escrow_rejects_missing_ed25519_ix() {
    let mut ctx = setup();
    deposit(&mut ctx, ESCROW_DEPOSIT).expect("deposit ok");

    let hint_id = make_hint_id(0xE5);
    // Submit settle without the prior ed25519 ix.
    let settle_ix = build_settle_ix(&ctx, BID_LAMPORTS, hint_id);
    let err = send_tx(&mut ctx.svm, &ctx.relay, &[settle_ix]).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(anchor_error(flowback::FlowbackError::MissingEd25519Ix))
        )
    );
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn setup() -> EscrowCtx {
    let program_id = flowback::id();
    let authority = Keypair::new();
    let relay = Keypair::new();
    let searcher = Keypair::new();
    let other_searcher = Keypair::new();
    let treasury = Keypair::new();
    let user = Keypair::new();
    let mut svm = LiteSVM::new().with_precompiles();
    let bytes = include_bytes!("../../../target/deploy/flowback.so");
    svm.add_program(program_id, bytes).unwrap();

    for key in [
        authority.pubkey(),
        relay.pubkey(),
        searcher.pubkey(),
        other_searcher.pubkey(),
        treasury.pubkey(),
        user.pubkey(),
    ] {
        svm.airdrop(&key, AIRDROP_LAMPORTS).unwrap();
    }

    let (config, _) =
        anchor_lang::prelude::Pubkey::find_program_address(&[flowback::CONFIG_SEED], &program_id);

    let init_ix = Instruction {
        program_id,
        accounts: flowback::accounts::Initialize {
            authority: authority.pubkey(),
            config,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::Initialize {
            protocol_fee_bps: PROTOCOL_FEE_BPS,
            treasury: treasury.pubkey(),
            paused: false,
        }
        .data(),
    };
    send_tx(&mut svm, &authority, &[init_ix]).expect("init protocol");

    let (escrow, _) = anchor_lang::prelude::Pubkey::find_program_address(
        &[flowback::ESCROW_SEED, &searcher.pubkey().to_bytes()],
        &program_id,
    );
    let escrow_init_ix = Instruction {
        program_id,
        accounts: flowback::accounts::EscrowInit {
            searcher: searcher.pubkey(),
            escrow,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::EscrowInit {}.data(),
    };
    send_tx(&mut svm, &searcher, &[escrow_init_ix]).expect("init escrow");

    EscrowCtx {
        svm,
        program_id,
        relay,
        searcher,
        other_searcher,
        treasury,
        user,
        config,
        escrow,
    }
}

fn deposit(
    ctx: &mut EscrowCtx,
    amount: u64,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let ix = Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::EscrowDeposit {
            searcher: ctx.searcher.pubkey(),
            escrow: ctx.escrow,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::EscrowDeposit { amount }.data(),
    };
    let searcher_clone = ctx.searcher.insecure_clone();
    send_tx(&mut ctx.svm, &searcher_clone, &[ix])
}

fn withdraw(
    ctx: &mut EscrowCtx,
    amount: u64,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let ix = Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::EscrowWithdraw {
            searcher: ctx.searcher.pubkey(),
            escrow: ctx.escrow,
        }
        .to_account_metas(None),
        data: flowback::instruction::EscrowWithdraw { amount }.data(),
    };
    let searcher_clone = ctx.searcher.insecure_clone();
    send_tx(&mut ctx.svm, &searcher_clone, &[ix])
}

fn settle(
    ctx: &mut EscrowCtx,
    bid_amount: u64,
    hint_id: [u8; 16],
    signing_key: &Keypair,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let message = build_bid_message(&hint_id, bid_amount);
    let signature = signing_key.sign_message(&message);
    let sig_bytes: [u8; 64] = signature.as_ref().try_into().unwrap();
    let pk_bytes = signing_key.pubkey().to_bytes();
    let ed25519_ix_v3 = new_ed25519_instruction_with_signature(&message, &sig_bytes, &pk_bytes);
    let ed25519_ix = convert_ix(ed25519_ix_v3);
    let settle_ix = build_settle_ix(ctx, bid_amount, hint_id);
    let relay_clone = ctx.relay.insecure_clone();
    send_tx(&mut ctx.svm, &relay_clone, &[ed25519_ix, settle_ix])
}

fn build_settle_ix(ctx: &EscrowCtx, bid_amount: u64, hint_id: [u8; 16]) -> Instruction {
    let (used_hint, _) = anchor_lang::prelude::Pubkey::find_program_address(
        &[flowback::USED_HINT_SEED, hint_id.as_ref()],
        &ctx.program_id,
    );
    Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::SettleFromEscrow {
            relay_payer: ctx.relay.pubkey(),
            escrow: ctx.escrow,
            config: ctx.config,
            user_account: ctx.user.pubkey(),
            treasury: ctx.treasury.pubkey(),
            used_hint,
            instructions_sysvar: instructions_sysvar_id(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::SettleFromEscrow {
            bid_amount,
            user: ctx.user.pubkey(),
            hint_id,
        }
        .data(),
    }
}

fn build_bid_message(hint_id: &[u8; 16], bid_amount: u64) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"flowback-bid:");
    for byte in hint_id {
        out.push(hex_nibble(byte >> 4));
        out.push(hex_nibble(byte & 0x0f));
    }
    out.push(b':');
    out.extend_from_slice(bid_amount.to_string().as_bytes());
    out
}

fn hex_nibble(n: u8) -> u8 {
    match n {
        0..=9 => b'0' + n,
        _ => b'a' + (n - 10),
    }
}

fn instructions_sysvar_id() -> anchor_lang::prelude::Pubkey {
    "Sysvar1nstructions1111111111111111111111111".parse().unwrap()
}

fn make_hint_id(seed: u8) -> [u8; 16] {
    let mut out = [0u8; 16];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = seed.wrapping_add(i as u8);
    }
    out
}

/// Convert a `solana_instruction::Instruction` (v3) into the `Instruction`
/// type re-exported via Anchor's `solana_program`. Same wire layout, just a
/// crate split that requires a manual hop.
fn convert_ix(ix: solana_instruction::Instruction) -> Instruction {
    Instruction {
        program_id: anchor_lang::prelude::Pubkey::new_from_array(ix.program_id.to_bytes()),
        accounts: ix
            .accounts
            .into_iter()
            .map(|m| anchor_lang::prelude::AccountMeta {
                pubkey: anchor_lang::prelude::Pubkey::new_from_array(m.pubkey.to_bytes()),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}

fn send_tx(
    svm: &mut LiteSVM,
    payer: &Keypair,
    instructions: &[Instruction],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let tx = Transaction::new_signed_with_payer(
        instructions,
        Some(&payer.pubkey()),
        &[payer],
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx)
}

fn anchor_error(code: flowback::FlowbackError) -> u32 {
    ERROR_CODE_OFFSET + code as u32
}
