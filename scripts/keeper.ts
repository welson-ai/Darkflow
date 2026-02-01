import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

async function main() {
  const url =
    process.env.KEEPER_RPC_URL ||
    process.env.ANCHOR_PROVIDER_URL ||
    "https://api.devnet.solana.com";
  const connection = new anchor.web3.Connection(url, "confirmed");
  const envWallet =
    process.env.ANCHOR_WALLET || process.env.WALLET || "./test-wallet.json";
  const walletPath = envWallet.startsWith("~")
    ? path.join(process.env.HOME || "", envWallet.slice(2))
    : envWallet;
  const walletBytes = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const kp = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(walletBytes));
  const wallet = new NodeWallet(kp);
  const provider = new anchor.AnchorProvider(
    connection,
    wallet,
    anchor.AnchorProvider.defaultOptions()
  );
  anchor.setProvider(provider);
  const program: any = (anchor.workspace as any).Dex;

  const jupiterProgramId = new PublicKey(
    process.env.JUPITER_PROGRAM_ID ||
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
  );

  const getNetwork = (
    connection: anchor.web3.Connection
  ): "mainnet" | "devnet" | "localhost" => {
    const endpoint = connection.rpcEndpoint;
    if (
      endpoint.includes("mainnet") ||
      endpoint.includes("helius") ||
      endpoint.includes("quicknode")
    )
      return "mainnet";
    if (endpoint.includes("devnet")) return "devnet";
    return "localhost";
  };

  const network = getNetwork(connection);
  console.log(`Keeper running on ${network}`);

  const listener = await program.addEventListener(
    "OrderSettledEvent",
    async (event: any, slot: number, sig: string) => {
      try {
        const nonce = new anchor.BN(event.nonce.toString());
        const amountIn = new anchor.BN(event.amount_in.toString());
        const minOut = new anchor.BN(event.min_out.toString());
        const tokenIn = new anchor.BN(event.token_in.toString());
        const tokenOut = new anchor.BN(event.token_out.toString());

        console.log(`Processing order nonce: ${nonce.toString()}`);

        // Find TempWallet by nonce to get user and address
        // Offset 120 = 8 (discriminator) + 32 (user) + 32 (token_in) + 32 (token_out) + 8 (amount_in) + 8 (min_out)
        const tempWallets = await program.account.tempWallet.all([
          {
            memcmp: {
              offset: 120,
              bytes: nonce.toArrayLike(Buffer, "le", 8) as any, // Cast to any to avoid TS issues with Buffer
            },
          },
        ]);

        if (tempWallets.length === 0) {
          console.log("No temp wallet found for nonce", nonce.toString());
          return;
        }
        const tempWalletPubkey = tempWallets[0].publicKey;

        const settlementPda = PublicKey.findProgramAddressSync(
          [Buffer.from("settlement"), nonce.toArrayLike(Buffer, "le", 8)],
          program.programId
        )[0];

        const tokenInMappingPda = PublicKey.findProgramAddressSync(
          [Buffer.from("token"), tokenIn.toArrayLike(Buffer, "le", 8)],
          program.programId
        )[0];
        const tokenOutMappingPda = PublicKey.findProgramAddressSync(
          [Buffer.from("token"), tokenOut.toArrayLike(Buffer, "le", 8)],
          program.programId
        )[0];

        const settlementAcc = await program.account["settlementRequest"].fetch(
          settlementPda
        );
        if (!settlementAcc.active) {
          console.log("Settlement not active");
          return;
        }

        if (network === "mainnet") {
          const data = Buffer.from([]); // TODO: Fetch real Jupiter route data
          console.log("Executing Mainnet Swap");
          try {
            await program.methods
              .executeSwap(data)
              .accounts({
                payer: provider.wallet.publicKey,
                settlementRequest: settlementPda,
                tempWallet: tempWalletPubkey,
                tokenInMapping: tokenInMappingPda,
                tokenOutMapping: tokenOutMappingPda,
                jupiterProgram: jupiterProgramId,
              })
              .rpc();
            console.log("Swap executed");
          } catch (e) {
            console.error("Swap failed", e);
          }
        } else {
          console.log("Executing Test Swap (Mock)");
          try {
            // executeSwapTest takes nonce as argument
            await program.methods
              .executeSwapTest(nonce)
              .accounts({
                payer: provider.wallet.publicKey,
                settlementRequest: settlementPda,
                tempWallet: tempWalletPubkey,
                tokenInMapping: tokenInMappingPda,
                tokenOutMapping: tokenOutMappingPda,
                jupiterProgram: anchor.web3.SystemProgram.programId,
              })
              .rpc();
            console.log("Test Swap executed");
          } catch (e) {
            console.error("Test Swap failed", e);
          }
        }
      } catch (e) {
        console.error("Event processing error", e);
      }
    }
  );

  process.on("SIGINT", async () => {
    try {
      await program.removeEventListener(listener);
    } catch {}
    process.exit(0);
  });
}

main();
