use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer, CloseAccount};
use anchor_spl::associated_token::AssociatedToken;

const COMP_DEF_OFFSET_MATCH_ORDER: u32 = comp_def_offset("match_order");

declare_id!("5XQ8wk4T8haHVRBFF1XBnNUUifyXiv4WUTvnGC2P4oVo");

#[arcium_program]
pub mod dex {
    use super::*;

    pub fn init_match_order_comp_def(ctx: Context<InitMatchOrderCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        computation_offset: u64,
        amount_in: [u8; 32],
        amount_out_min: [u8; 32],
        token_in: [u8; 32],
        token_out: [u8; 32],
        nonce: [u8; 32],
        public_nonce: u64,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        
        // Initialize the settlement request
        let settlement = &mut ctx.accounts.settlement_request;
        settlement.active = false; // Not ready yet
        settlement.nonce = public_nonce;
        settlement.bump = ctx.bumps.settlement_request;

        let args = vec![
            Argument::EncryptedU64(amount_in),
            Argument::EncryptedU64(amount_out_min),
            Argument::EncryptedU64(token_in),
            Argument::EncryptedU64(token_out),
            Argument::EncryptedU64(nonce),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![MatchOrderCallback::callback_ix(&[])],
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "match_order", auto_serialize = false)]
    pub fn match_order_callback(
        ctx: Context<MatchOrderCallback>,
        output: ComputationOutputs<SwapOrder>,
    ) -> Result<()> {
        let o = match output {
            ComputationOutputs::Success(o) => o,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        // field_0 is the SwapOrder struct (plaintext)
        let amount_in = o.amount_in;
        let amount_out_min = o.amount_out_min;
        let token_in = o.token_in;
        let token_out = o.token_out;
        let nonce = o.nonce;

        require!(amount_in > 0, ErrorCode::InvalidOrderAmount);

        // Verify the settlement_request PDA matches the nonce from the circuit
        let (pda, _bump) = Pubkey::find_program_address(
            &[b"settlement", nonce.to_le_bytes().as_ref()],
            ctx.program_id
        );
        require_keys_eq!(ctx.accounts.settlement_request.key(), pda, ErrorCode::InvalidSettlementPDA);

        // Update the settlement request
        // We need to manually deserialize since it's an UncheckedAccount
        let mut data = ctx.accounts.settlement_request.try_borrow_mut_data()?;
        let mut settlement: SettlementRequest = AccountDeserialize::try_deserialize(&mut &data[..])?;
        
        settlement.amount_in = amount_in;
        settlement.min_out = amount_out_min;
        settlement.token_in = token_in;
        settlement.token_out = token_out;
        settlement.nonce = nonce;
        settlement.active = true;
        
        // Serialize back
        settlement.try_serialize(&mut *data)?;

        emit!(OrderSettledEvent {
            amount_in,
            min_out: amount_out_min,
            token_in,
            token_out,
            nonce,
        });

        msg!("Order Settled (Plaintext): In: {}, Min Out: {}, Token In ID: {}, Token Out ID: {}", 
             amount_in, amount_out_min, token_in, token_out);

        Ok(())
    }

    pub fn execute_swap(
        ctx: Context<ExecuteSwap>,
        data: Vec<u8>, // Jupiter route data
    ) -> Result<()> {
        let settlement = &mut ctx.accounts.settlement_request;
        require!(settlement.active, ErrorCode::SettlementNotActive);
        
        // Validation: 
        // In a real implementation, we would inspect `data` to ensure `min_out` matches settlement.min_out
        // For now, we trust the keeper/user to provide the correct route that yields >= min_out.
        // If the swap fails (slippage), the transaction reverts.
        
        // Mark as inactive/filled to prevent replay
        settlement.active = false;
        
        // Construct the instruction for Jupiter CPI
        // We pass through all remaining accounts to Jupiter
        let mut accounts = vec![];
        for acc in ctx.remaining_accounts.iter() {
            accounts.push(AccountMeta {
                pubkey: *acc.key,
                is_signer: acc.is_signer,
                is_writable: acc.is_writable,
            });
        }
        
        let jupiter_program = ctx.accounts.jupiter_program.key();
        
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: jupiter_program,
            accounts,
            data,
        };
        
        // Invoke Jupiter with PDA signing if needed (temp wallet custody)
        let bump = ctx.accounts.temp_wallet.bump;
        let bump_arr = [bump];
        let nonce_bytes = ctx.accounts.temp_wallet.nonce.to_le_bytes();
        let seeds = &[
            b"temp_wallet",
            ctx.accounts.temp_wallet.user.as_ref(),
            nonce_bytes.as_ref(),
            &bump_arr[..],
        ];
        let signer = &[&seeds[..]];
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            ctx.remaining_accounts,
            signer,
        )?;
        
        Ok(())
    }

    #[cfg(feature = "devnet")]
    pub fn execute_swap_test(
        ctx: Context<ExecuteSwap>,
        _nonce: u64,
    ) -> Result<()> {
        msg!("TEST MODE: Skipping Jupiter CPI");
        let settlement = &mut ctx.accounts.settlement_request;
        require!(settlement.active, ErrorCode::SettlementNotActive);
        settlement.active = false;
        Ok(())
    }

    // !!! TEST ONLY: Backdoor to simulate Arcium callback for testing Jupiter CPI integration !!!
    pub fn simulate_match_order(
        ctx: Context<SimulateMatchOrder>,
        amount_in: u64,
        amount_out_min: u64,
        token_in: u64,
        token_out: u64,
        nonce: u64,
    ) -> Result<()> {
        let settlement = &mut ctx.accounts.settlement_request;
        settlement.amount_in = amount_in;
        settlement.min_out = amount_out_min;
        settlement.token_in = token_in;
        settlement.token_out = token_out;
        settlement.nonce = nonce;
        settlement.active = true;
        
        emit!(OrderSettledEvent {
            amount_in,
            min_out: amount_out_min,
            token_in,
            token_out,
            nonce,
        });
        Ok(())
    }
    pub fn init_settlement_test(
        ctx: Context<InitSettlementTest>,
        public_nonce: u64,
    ) -> Result<()> {
        let settlement = &mut ctx.accounts.settlement_request;
        settlement.active = false;
        settlement.nonce = public_nonce;
        settlement.bump = ctx.bumps.settlement_request;
        Ok(())
    }

    pub fn register_token(ctx: Context<RegisterToken>, id: u64) -> Result<()> {
        let mapping = &mut ctx.accounts.token_mapping;
        mapping.mint = ctx.accounts.mint.key();
        mapping.id = id;
        msg!("Registered token ID {} for mint {}", id, mapping.mint);
        Ok(())
    }

    pub fn create_private_swap(
        ctx: Context<CreatePrivateSwap>,
        amount_in: u64,
        min_out: u64,
        nonce: u64,
        computation_offset: u64,
        encrypted_amount_in: [u8; 32],
        encrypted_amount_out_min: [u8; 32],
        encrypted_token_in: [u8; 32],
        encrypted_token_out: [u8; 32],
        encrypted_nonce: [u8; 32],
    ) -> Result<()> {
        let temp = &mut ctx.accounts.temp_wallet;
        temp.user = ctx.accounts.payer.key();
        temp.token_in_mint = ctx.accounts.token_in_mint.key();
        temp.token_out_mint = ctx.accounts.token_out_mint.key();
        temp.amount_in = amount_in;
        temp.min_out = min_out;
        temp.nonce = nonce;
        temp.active = true;
        temp.is_funded = false;
        temp.bump = ctx.bumps.temp_wallet;
        
        temp.computation_offset = computation_offset;
        temp.encrypted_amount_in = encrypted_amount_in;
        temp.encrypted_amount_out_min = encrypted_amount_out_min;
        temp.encrypted_token_in = encrypted_token_in;
        temp.encrypted_token_out = encrypted_token_out;
        temp.encrypted_nonce = encrypted_nonce;

        emit!(TempWalletCreated {
            temp_wallet: temp.key(),
            user: temp.user,
            token_in: temp.token_in_mint,
            token_out: temp.token_out_mint,
            amount: amount_in,
            nonce,
        });
        Ok(())
    }

    pub fn fund_and_place_order(ctx: Context<FundAndPlaceOrder>, computation_offset: u64) -> Result<()> {
        let temp = &mut ctx.accounts.temp_wallet;
        require!(temp.active, ErrorCode::SettlementNotActive);
        require!(!temp.is_funded, ErrorCode::AlreadyFunded);

        let balance = ctx.accounts.temp_token_account.amount;
        require!(balance >= temp.amount_in, ErrorCode::InsufficientFunds);

        temp.is_funded = true;
        
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        
        let settlement = &mut ctx.accounts.settlement_request;
        settlement.active = false;
        settlement.nonce = temp.nonce;
        settlement.bump = ctx.bumps.settlement_request;

        let enc_amount_in = temp.encrypted_amount_in;
        let enc_min_out = temp.encrypted_amount_out_min;
        let enc_token_in = temp.encrypted_token_in;
        let enc_token_out = temp.encrypted_token_out;
        let enc_nonce = temp.encrypted_nonce;

        let args = vec![
            Argument::EncryptedU64(enc_amount_in),
            Argument::EncryptedU64(enc_min_out),
            Argument::EncryptedU64(enc_token_in),
            Argument::EncryptedU64(enc_token_out),
            Argument::EncryptedU64(enc_nonce),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![MatchOrderCallback::callback_ix(&[])],
        )?;

        Ok(())
    }

    pub fn return_tokens_to_user(ctx: Context<ReturnTokensToUser>) -> Result<()> {
        let amount = ctx.accounts.temp_token_account_out.amount;
        if amount > 0 {
            let bump = ctx.accounts.temp_wallet.bump;
            let bump_arr = [bump];
            let nonce_bytes = ctx.accounts.temp_wallet.nonce.to_le_bytes();
            let seeds = &[
                b"temp_wallet",
                ctx.accounts.temp_wallet.user.as_ref(),
                nonce_bytes.as_ref(),
                &bump_arr[..]
            ];
            let signer = &[&seeds[..]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.temp_token_account_out.to_account_info(),
                        to: ctx.accounts.user_token_account_out.to_account_info(),
                        authority: ctx.accounts.temp_wallet.to_account_info(),
                    },
                    signer
                ),
                amount
            )?;
        }
        
        let bump = ctx.accounts.temp_wallet.bump;
        let bump_arr = [bump];
        let nonce_bytes = ctx.accounts.temp_wallet.nonce.to_le_bytes();
        let seeds = &[
            b"temp_wallet",
            ctx.accounts.temp_wallet.user.as_ref(),
            nonce_bytes.as_ref(),
            &bump_arr[..]
        ];
        let signer = &[&seeds[..]];

        token::close_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.temp_token_account_out.to_account_info(),
                    destination: ctx.accounts.user.to_account_info(),
                    authority: ctx.accounts.temp_wallet.to_account_info(),
                },
                signer
            )
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct RegisterToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 8,
        seeds = [b"token", id.to_le_bytes().as_ref()],
        bump
    )]
    pub token_mapping: Account<'info, TokenMapping>,
    /// CHECK: We just store the pubkey, we don't need full Mint struct validation here strictly, but using Account<'info, Mint> is safer if we want to ensure it exists.
    /// However, to avoid importing spl-token crate if not needed, we can just use UncheckedAccount or check owner.
    /// Since we imported anchor_spl::token::TokenAccount, let's assume we can import Mint.
    /// But wait, the user didn't import Mint in line 3, only Token and TokenAccount.
    /// Let's use UncheckedAccount for flexibility or add Mint to imports.
    pub mint: UncheckedAccount<'info>, 
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(public_nonce: u64)]
pub struct InitSettlementTest<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1,
        seeds = [b"settlement", public_nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_request: Account<'info, SettlementRequest>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount_in: u64, amount_out_min: u64, token_in: u64, token_out: u64, nonce: u64)]
pub struct SimulateMatchOrder<'info> {
    #[account(
        mut,
        seeds = [b"settlement", nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_request: Account<'info, SettlementRequest>,
    pub payer: Signer<'info>,
}

#[queue_computation_accounts("match_order", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, amount_in: [u8; 32], amount_out_min: [u8; 32], token_in: [u8; 32], token_out: [u8; 32], nonce: [u8; 32], public_nonce: u64)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1, // Discriminator + fields
        seeds = [b"settlement", public_nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_request: Account<'info, SettlementRequest>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_ORDER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("match_order")]
#[derive(Accounts)]
pub struct MatchOrderCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_ORDER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: Validated manually in instruction
    pub settlement_request: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        close = payer, // Close after execution to refund rent
    )]
    pub settlement_request: Account<'info, SettlementRequest>,
    #[account(
        seeds = [b"temp_wallet", temp_wallet.user.as_ref(), temp_wallet.nonce.to_le_bytes().as_ref()],
        bump = temp_wallet.bump
    )]
    pub temp_wallet: Account<'info, TempWallet>,
    
    #[account(
        seeds = [b"token", settlement_request.token_in.to_le_bytes().as_ref()],
        bump,
    )]
    pub token_in_mapping: Account<'info, TokenMapping>,
    
    #[account(
        seeds = [b"token", settlement_request.token_out.to_le_bytes().as_ref()],
        bump,
    )]
    pub token_out_mapping: Account<'info, TokenMapping>,

    /// CHECK: Jupiter Program ID
    pub jupiter_program: UncheckedAccount<'info>,
}

#[account]
pub struct TokenMapping {
    pub mint: Pubkey,
    pub id: u64,
}

#[account]
pub struct SettlementRequest {
    pub amount_in: u64,
    pub min_out: u64,
    pub token_in: u64,
    pub token_out: u64,
    pub nonce: u64,
    pub active: bool,
    pub bump: u8,
}


#[init_computation_definition_accounts("match_order", payer)]
#[derive(Accounts)]
pub struct InitMatchOrderCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount_in: u64, min_out: u64, nonce: u64)]
pub struct CreatePrivateSwap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1 + 8 + 32 + 32 + 32 + 32 + 32 + 1,
        seeds = [b"temp_wallet", payer.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub temp_wallet: Account<'info, TempWallet>,
    pub token_in_mint: Account<'info, Mint>,
    pub token_out_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("match_order", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct FundAndPlaceOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"temp_wallet", temp_wallet.user.as_ref(), temp_wallet.nonce.to_le_bytes().as_ref()],
        bump = temp_wallet.bump
    )]
    pub temp_wallet: Box<Account<'info, TempWallet>>,
    #[account(
        associated_token::mint = temp_wallet.token_in_mint,
        associated_token::authority = temp_wallet,
    )]
    pub temp_token_account: Box<Account<'info, TokenAccount>>,
    
    // Accounts for place_order logic
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, SignerAccount>>,
    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1,
        seeds = [b"settlement", temp_wallet.nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub settlement_request: Box<Account<'info, SettlementRequest>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: mempool
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_ORDER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[derive(Accounts)]
pub struct ReturnTokensToUser<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        close = user,
        seeds = [b"temp_wallet", user.key().as_ref(), temp_wallet.nonce.to_le_bytes().as_ref()],
        bump = temp_wallet.bump,
        has_one = user,
    )]
    pub temp_wallet: Account<'info, TempWallet>,
    /// CHECK: Verified by has_one on temp_wallet
    #[account(mut)]
    pub user: SystemAccount<'info>,
    
    #[account(
        mut,
        associated_token::mint = temp_wallet.token_out_mint,
        associated_token::authority = temp_wallet,
    )]
    pub temp_token_account_out: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = temp_wallet.token_out_mint,
        associated_token::authority = user,
    )]
    pub user_token_account_out: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct TempWallet {
    pub user: Pubkey,
    pub token_in_mint: Pubkey,
    pub token_out_mint: Pubkey,
    pub amount_in: u64,
    pub min_out: u64,
    pub nonce: u64,
    pub active: bool,
    pub is_funded: bool,
    // Ciphertexts for place_order
    pub computation_offset: u64,
    pub encrypted_amount_in: [u8; 32],
    pub encrypted_amount_out_min: [u8; 32],
    pub encrypted_token_in: [u8; 32],
    pub encrypted_token_out: [u8; 32],
    pub encrypted_nonce: [u8; 32],
    pub bump: u8,
}

#[event]
pub struct TempWalletCreated {
    pub temp_wallet: Pubkey,
    pub user: Pubkey,
    pub token_in: Pubkey,
    pub token_out: Pubkey,
    pub amount: u64,
    pub nonce: u64,
}

#[event]
pub struct OrderSettledEvent {
    pub amount_in: u64,
    pub min_out: u64,
    pub token_in: u64,
    pub token_out: u64,
    pub nonce: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Invalid Settlement PDA")]
    InvalidSettlementPDA,
    #[msg("Settlement Request not active")]
    SettlementNotActive,
    #[msg("Invalid order amount")]
    InvalidOrderAmount,
    #[msg("Temp wallet already funded")]
    AlreadyFunded,
    #[msg("Insufficient funds in temp wallet")]
    InsufficientFunds,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct SwapOrder {
    pub amount_in: u64,
    pub amount_out_min: u64,
    pub token_in: u64,
    pub token_out: u64,
    pub nonce: u64,
}
