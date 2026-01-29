import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

async function main() {
  const url = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
  const connection = new anchor.web3.Connection(url, "confirmed");
  const walletBytes = JSON.parse(
    fs.readFileSync("./test-wallet.json", "utf-8")
  );
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
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
  );

  const listener = await program.addEventListener(
    "OrderSettledEvent",
    async (event: any, slot: number, sig: string) => {
      try {
        const nonce = new anchor.BN(event.nonce.toString());
        const amountIn = new anchor.BN(event.amount_in.toString());
        const minOut = new anchor.BN(event.min_out.toString());
        const tokenIn = new anchor.BN(event.token_in.toString());
        const tokenOut = new anchor.BN(event.token_out.toString());

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
          return;
        }

        const data = Buffer.from([]);

        try {
          await program.methods
            .executeSwap(data)
            .accounts({
              payer: provider.wallet.publicKey,
              settlementRequest: settlementPda,
              tokenInMapping: tokenInMappingPda,
              tokenOutMapping: tokenOutMappingPda,
              jupiterProgram: jupiterProgramId,
            })
            .rpc();
        } catch (e) {}
      } catch (e) {}
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
