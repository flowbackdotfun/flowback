use {
    anchor_lang::{
        error::ERROR_CODE_OFFSET, solana_program::instruction::Instruction, AccountDeserialize,
        InstructionData, ToAccountMetas,
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
    solana_transaction::{InstructionError, Transaction, TransactionError},
};

const AIRDROP_LAMPORTS: u64 = 2_000_000_000;
const INITIAL_PROTOCOL_FEE_BPS: u16 = 1_000;
const INITIAL_BID_LAMPORTS: u64 = 1_000_000;

struct TestContext {
    svm: LiteSVM,
    program_id: anchor_lang::prelude::Pubkey,
    authority: Keypair,
    unauthorized: Keypair,
    searcher: Keypair,
    treasury: Keypair,
    updated_treasury: Keypair,
    user: Keypair,
    config: anchor_lang::prelude::Pubkey,
}

#[test]
fn initialize_stores_protocol_config() {
    let ctx = initialize_program(false);
    let config = read_config(&ctx.svm, &ctx.config);

    assert_eq!(config.authority, ctx.authority.pubkey());
    assert_eq!(config.treasury, ctx.treasury.pubkey());
    assert_eq!(config.protocol_fee_bps, INITIAL_PROTOCOL_FEE_BPS);
    assert!(!config.paused);
    assert_eq!(config.total_cashback_paid, 0);
    assert_eq!(config.total_swaps_processed, 0);
}

#[test]
fn settle_cashback_splits_lamports_and_updates_counters() {
    let mut ctx = initialize_program(false);
    let user_before = ctx.svm.get_balance(&ctx.user.pubkey()).unwrap();
    let treasury_before = ctx.svm.get_balance(&ctx.treasury.pubkey()).unwrap();

    let settle_ix = Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::SettleCashback {
            searcher: ctx.searcher.pubkey(),
            config: ctx.config,
            user_account: ctx.user.pubkey(),
            treasury: ctx.treasury.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::SettleCashback {
            bid_amount: INITIAL_BID_LAMPORTS,
            user: ctx.user.pubkey(),
        }
        .data(),
    };

    let result = send_tx(&mut ctx.svm, &ctx.searcher, &[settle_ix]);
    assert!(result.is_ok());

    let user_cashback = INITIAL_BID_LAMPORTS * (10_000 - INITIAL_PROTOCOL_FEE_BPS as u64) / 10_000;
    let protocol_fee = INITIAL_BID_LAMPORTS - user_cashback;

    assert_eq!(
        ctx.svm.get_balance(&ctx.user.pubkey()).unwrap() - user_before,
        user_cashback
    );
    assert_eq!(
        ctx.svm.get_balance(&ctx.treasury.pubkey()).unwrap() - treasury_before,
        protocol_fee
    );

    let config = read_config(&ctx.svm, &ctx.config);
    assert_eq!(config.total_cashback_paid, user_cashback);
    assert_eq!(config.total_swaps_processed, 1);
}

#[test]
fn settle_cashback_fails_when_protocol_is_paused() {
    let mut ctx = initialize_program(true);
    let settle_ix = Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::SettleCashback {
            searcher: ctx.searcher.pubkey(),
            config: ctx.config,
            user_account: ctx.user.pubkey(),
            treasury: ctx.treasury.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::SettleCashback {
            bid_amount: INITIAL_BID_LAMPORTS,
            user: ctx.user.pubkey(),
        }
        .data(),
    };

    let err = send_tx(&mut ctx.svm, &ctx.searcher, &[settle_ix]).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(anchor_error(flowback::FlowbackError::ProtocolPaused))
        )
    );
}

#[test]
fn settle_cashback_rejects_mismatched_user_account() {
    let mut ctx = initialize_program(false);
    let settle_ix = Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::SettleCashback {
            searcher: ctx.searcher.pubkey(),
            config: ctx.config,
            user_account: ctx.unauthorized.pubkey(),
            treasury: ctx.treasury.pubkey(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::SettleCashback {
            bid_amount: INITIAL_BID_LAMPORTS,
            user: ctx.user.pubkey(),
        }
        .data(),
    };

    let err = send_tx(&mut ctx.svm, &ctx.searcher, &[settle_ix]).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(anchor_error(flowback::FlowbackError::UserAccountMismatch))
        )
    );
}

#[test]
fn update_config_requires_authority_and_persists_changes() {
    let mut ctx = initialize_program(false);

    let update_ix = Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::UpdateConfig {
            authority: ctx.authority.pubkey(),
            config: ctx.config,
        }
        .to_account_metas(None),
        data: flowback::instruction::UpdateConfig {
            protocol_fee_bps: 500,
            treasury: ctx.updated_treasury.pubkey(),
            paused: true,
        }
        .data(),
    };

    let result = send_tx(&mut ctx.svm, &ctx.authority, &[update_ix]);
    assert!(result.is_ok());

    let updated_config = read_config(&ctx.svm, &ctx.config);
    assert_eq!(updated_config.protocol_fee_bps, 500);
    assert_eq!(updated_config.treasury, ctx.updated_treasury.pubkey());
    assert!(updated_config.paused);

    let unauthorized_ix = Instruction {
        program_id: ctx.program_id,
        accounts: flowback::accounts::UpdateConfig {
            authority: ctx.unauthorized.pubkey(),
            config: ctx.config,
        }
        .to_account_metas(None),
        data: flowback::instruction::UpdateConfig {
            protocol_fee_bps: 250,
            treasury: ctx.treasury.pubkey(),
            paused: false,
        }
        .data(),
    };

    let err = send_tx(&mut ctx.svm, &ctx.unauthorized, &[unauthorized_ix]);
    assert!(err.is_err());

    let config_after_failed_update = read_config(&ctx.svm, &ctx.config);
    assert_eq!(config_after_failed_update.protocol_fee_bps, 500);
    assert_eq!(
        config_after_failed_update.treasury,
        ctx.updated_treasury.pubkey()
    );
    assert!(config_after_failed_update.paused);
}

fn initialize_program(paused: bool) -> TestContext {
    let program_id = flowback::id();
    let authority = Keypair::new();
    let unauthorized = Keypair::new();
    let searcher = Keypair::new();
    let treasury = Keypair::new();
    let updated_treasury = Keypair::new();
    let user = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/flowback.so");
    let (config, _) =
        anchor_lang::prelude::Pubkey::find_program_address(&[flowback::CONFIG_SEED], &program_id);

    svm.add_program(program_id, bytes).unwrap();

    for key in [
        authority.pubkey(),
        unauthorized.pubkey(),
        searcher.pubkey(),
        treasury.pubkey(),
        updated_treasury.pubkey(),
        user.pubkey(),
    ] {
        svm.airdrop(&key, AIRDROP_LAMPORTS).unwrap();
    }

    let initialize_ix = Instruction {
        program_id,
        accounts: flowback::accounts::Initialize {
            authority: authority.pubkey(),
            config,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: flowback::instruction::Initialize {
            protocol_fee_bps: INITIAL_PROTOCOL_FEE_BPS,
            treasury: treasury.pubkey(),
            paused,
        }
        .data(),
    };

    let result = send_tx(&mut svm, &authority, &[initialize_ix]);
    assert!(result.is_ok());

    TestContext {
        svm,
        program_id,
        authority,
        unauthorized,
        searcher,
        treasury,
        updated_treasury,
        user,
        config,
    }
}

fn read_config(
    svm: &LiteSVM,
    config_address: &anchor_lang::prelude::Pubkey,
) -> flowback::ProtocolConfig {
    let account = svm.get_account(config_address).unwrap();
    let mut data = account.data.as_slice();
    flowback::ProtocolConfig::try_deserialize(&mut data).unwrap()
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
