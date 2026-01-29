use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub struct SwapOrder {
        amount_in: u64,
        amount_out_min: u64,
        token_in: u64,  // Using u64 ID for PoC (Pubkey split or mapping)
        token_out: u64, // Using u64 ID for PoC
        nonce: u64,
    }

    #[instruction]
    pub fn match_order(order: Enc<Shared, SwapOrder>) -> SwapOrder {
        let o = order.to_arcis();
        
        // PoC Matching Logic:
        // We check if amount_in > 0 as a basic validity check.
        let valid = o.amount_in > 0;
        
        // In a real implementation, we would only return if valid.
        // For PoC, we reveal the order details so the on-chain program can settle it.
        o
    }
}
