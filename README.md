# DarkFlow

Privacy-First Trading on Solana DEXs

- Website: https://privateswap.com
- Docs: ./README.md
- Community: see “Community” below

## Overview
- Problem: On-chain trading is public; wallet identities and trade details can be traced across DEXs.
- Solution: A privacy proxy that creates an ephemeral PDA (“Temp Wallet”) to interface with Jupiter on behalf of the user. Encrypted order parameters are processed via Arcium MPC, and swaps execute from the Temp Wallet, not the user’s wallet.
- Value: The public ledger shows the Temp Wallet as the trader; funds are returned to the user post-execution, improving privacy while retaining composability with the Solana ecosystem.

## How It Works
- Flow: User → Temp Wallet → Jupiter → User
- Steps:
  - User connects wallet and defines swap (USDC → SOL).
  - Program creates a Temp Wallet PDA seeded by user key + nonce.
  - User deposits token_in to the Temp Wallet’s ATA.
  - Keeper queues computation to Arcium (match_order) and prepares Jupiter route.
  - Program executes swap via CPI signed by the Temp Wallet PDA.
  - Token_out returns to the user; Temp Wallet token accounts are closed to reclaim rent.
- Technical architecture:
  - Frontend (React + Vite): guides the user and shows deposit statuses.
  - Solana Program (Anchor + Arcium): manages Temp Wallet lifecycle and MPC order matching.
  - Keeper (TypeScript): listens to program events, detects deposits, and submits Jupiter routes.
  - Jupiter: routes liquidity; receives CPI from the Temp Wallet authority.

## Key Features
- Privacy via ephemeral PDAs that act as on-chain trading proxies.
- DEX compatibility with Jupiter aggregation.
- Automated funding detection and execution via keeper.
- Encrypted order inputs processed by Arcium MPC.
- Simple user flow with deposit and automatic processing.

## Getting Started
- Users:
  - Connect Phantom on devnet.
  - Choose tokens and amount; click “Swap Privately”.
  - Copy deposit address and send token_in; watch status progress to completion.
- Developers:
  - Install prerequisites (Node.js, Rust, Anchor).
  - Clone repository and install dependencies.
  - Run web dev server and keeper; run program tests with Anchor.

## Installation & Setup
- Prerequisites:
  - Node.js 18+ and Yarn/NPM
  - Rust toolchain + Solana CLI
  - Anchor CLI (0.31.x)
- Clone:
  - git clone <repo> && cd dex
- Dependencies:
  - Root: npm install
  - Web: yarn --cwd web install
- Environment:
  - Create .env from .env.example and update RPC URLs and wallet paths.
- Local development:
  - Frontend dev server: yarn --cwd web dev
  - Keeper: yarn run keeper
  - Program tests: anchor test

## Architecture
- System components:
  - Frontend: React/Vite UI, wallet adapter.
  - Solana Program: Anchor program integrating Arcium MPC.
  - Keeper: Node.js script reacting to program events and executing CPI routes.
  - Arcium: MPC network for matching encrypted orders.
  - Jupiter: DEX aggregation for executing swaps.
- Smart contract structure:
  - Accounts:
    - TempWallet: tracks user, mints, amounts, nonce, encrypted fields, bump.
    - SettlementRequest: settlement parameters produced by MPC.
    - TokenMapping: registry mapping token IDs to mints.
  - Instructions:
    - create_private_swap: creates Temp Wallet and stores encrypted fields.
    - fund_and_place_order: verifies deposit and queues MPC computation.
    - match_order_callback: sets settlement params after MPC completion.
    - execute_swap: performs Jupiter CPI signed by Temp Wallet PDA.
    - return_tokens_to_user: returns token_out and closes Temp Wallet ATA.
    - register_token: registers token ID to mint.
    - init_match_order_comp_def / init_settlement_test / simulate_match_order: setup/testing.
  - Data flow:
    - Encrypted arguments → Arcium → callback sets plaintext settlement → keeper retrieves route → execute_swap (Temp Wallet signer) → return_tokens_to_user.
- Key references:
  - Program: [lib.rs](file:///Users/h/dex/programs/dex/src/lib.rs)
  - Frontend UI: [App.tsx](file:///Users/h/dex/web/src/App.tsx)
  - PDA helpers: [anchor.ts](file:///Users/h/dex/web/src/anchor.ts)
  - Keeper script: [keeper.ts](file:///Users/h/dex/scripts/keeper.ts)

## Project Structure
```
.
├─ Anchor.toml
├─ package.json
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ README.md
├─ SECURITY.md
├─ .env.example
├─ programs/
│  └─ dex/
│     ├─ Cargo.toml
│     └─ src/
│        └─ lib.rs
├─ scripts/
│  └─ keeper.ts
├─ tests/
│  └─ dex.ts
└─ web/
   ├─ package.json
   ├─ tsconfig.json
   ├─ index.html
   └─ src/
      ├─ App.tsx
      ├─ anchor.ts
      ├─ main.tsx
      ├─ styles.css
      ├─ types/
      │  └─ jup-ag-api.d.ts
      └─ idl/
         └─ dex.json
```

- Root
  - package.json: root scripts and dependencies for tests/keeper.
  - Anchor.toml: Anchor workspace and test configuration.
  - .env.example: environment variables for web/keeper/program settings.
  - CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, README.md: project documentation.
- programs/dex
  - [lib.rs](file:///Users/h/dex/programs/dex/src/lib.rs): Anchor program implementing Temp Wallet, settlement, MPC queueing, Jupiter CPI, and cleanup.
- scripts
  - [keeper.ts](file:///Users/h/dex/scripts/keeper.ts): event listener that reacts to program events, prepares Jupiter route data, and triggers execute_swap.
- tests
  - [dex.ts](file:///Users/h/dex/tests/dex.ts): ts-mocha tests covering initialization and private swap creation.
- web
  - [App.tsx](file:///Users/h/dex/web/src/App.tsx): private swap UI with step-based flow, quotes, balances, and deposit screen.
  - [anchor.ts](file:///Users/h/dex/web/src/anchor.ts): Anchor provider/program setup, PDA helpers.
  - [styles.css](file:///Users/h/dex/web/src/styles.css): card-based layout and responsive styles.
  - [dex.json](file:///Users/h/dex/web/src/idl/dex.json): program IDL consumed by the frontend.
  - [jup-ag-api.d.ts](file:///Users/h/dex/web/src/types/jup-ag-api.d.ts): minimal type shim for dynamic Jupiter API imports.

## API Reference
- Program Instructions (parameters abbreviated):
  - create_private_swap(amount_in, min_out, nonce, computation_offset, enc_amount_in, enc_min_out, enc_token_in, enc_token_out, enc_nonce)
  - fund_and_place_order(computation_offset)
  - execute_swap(data)
  - return_tokens_to_user()
  - register_token(id)
  - init_match_order_comp_def()
  - init_settlement_test(public_nonce)
  - simulate_match_order(amount_in, min_out, token_in, token_out, nonce)
- Frontend Methods:
  - handleSwapPrivately(): initializes Temp Wallet and deposit flow.
  - Quote fetching: Jupiter API client (debounced).
  - Balance helpers and MAX action.

## Security
- Audit status: in-progress; do not deploy to mainnet without review.
- PDA security: Temp Wallet is derived from seeds [“temp_wallet”, user, nonce, bump]; signer seeds are used for CPI.
- Keeper trust model: keeper triggers execution routes; it must be well-behaved and monitored. Funds remain under Temp Wallet custody until returned.
- Best practices:
  - Validate routes and enforce min_out where possible.
  - Close accounts to reclaim rent.
  - Restrict and monitor keeper credentials and RPC endpoints.

## Testing
- Unit & integration:
  - anchor test
  - Tests use ts-mocha, see [tests/dex.ts](file:///Users/h/dex/tests/dex.ts)
- Coverage: add coverage tooling as needed for TypeScript and Rust.

## Deployment
- Devnet:
  - Configure .env for devnet RPC and keeper wallet.
  - Deploy program and run keeper; serve frontend.
- Mainnet:
  - Run audits and readiness checks.
  - Update program ID and token registry; harden keeper ops.
  - Scale RPC and monitoring; configure alerts.

## Configuration
- Supported tokens: registry of USDC/SOL/USDT/BONK (mint, decimals, IDs).
- Fees: privacy fee display (e.g., 0.3%).
- Slippage: user-configurable (default 1%).
- Environment: RPC URLs, keeper wallet path, Jupiter program.

## Troubleshooting
- Wallet not connected: connect Phantom before swapping.
- Insufficient balance: check SPL token ATA and SOL for fees.
- Anchor CLI mismatch: align versions for program tests.
- Jupiter quote error: network issues or token support; retry or adjust slippage.
- Temp Wallet not funding: confirm deposit to correct ATA (mint and address).

## Roadmap
- Completed:
  - Temp Wallet PDA, create_private_swap, deposit flow, MPC queueing.
  - Jupiter CPI signed by Temp Wallet, basic frontend flow with quotes/balances.
- In-Progress:
  - Keeper automation for funding detection, route building, and return.
  - On-chain min_out enforcement in execute_swap.
- Planned:
  - Tailwind UI, componentization, analytics and alerts, multi-route retries.

## Contributing
- See [CONTRIBUTING.md](file:///Users/h/dex/CONTRIBUTING.md) for guidelines.
- Please open issues and PRs with clear descriptions and references.

## FAQ
- What privacy guarantees? Temp Wallet acts as the on-chain trader; your personal wallet does not sign the DEX swap.
- Fees? Standard DEX fees plus optional privacy fee display; keeper may incur RPC costs.
- Is it safe? Funds reside in Temp Wallet during execution; ensure keeper reliability and program audits.
- Timing? Depends on funding detection, MPC completion, and DEX route execution.

## Performance
- Latency: deposit detection (~seconds), MPC completion (variable), Jupiter route execution (sub-second to seconds).
- Throughput: depends on keeper scaling and RPC/provider capacity.

## Resources
- Arcium: https://arcium.xyz
- Jupiter: https://www.jup.ag
- Solana: https://solana.com
- Anchor: https://www.anchor-lang.com

## Community
- Discord/Telegram/Twitter: coming soon
- Email: contact@privateswap.com

## License
- MIT

## Acknowledgments
- Arcium, Jupiter, Solana ecosystems

## Disclaimers
- Experimental software; use at your own risk.
- No guarantees of returns, privacy completeness, or uptime; subject to change. 
