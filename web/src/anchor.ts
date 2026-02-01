import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import idl from "./idl/dex.json";

export const PROGRAM_ID = new PublicKey((idl as any).address);

export function getConnection() {
  const env: any = (import.meta as any).env || {};
  const rpcEnv = env.VITE_RPC_URL;
  const heliusKey = env.VITE_HELIUS_API_KEY;
  const heliusNetwork = env.VITE_HELIUS_NETWORK || "devnet";
  const rpc =
    rpcEnv ||
    (heliusKey
      ? `https://${heliusNetwork}.helius-rpc.com/?api-key=${heliusKey}`
      : "https://api.devnet.solana.com");
  const conn = new Connection(rpc, "confirmed");
  const c: any = conn as any;
  if (!c.supportedTransactionVersions) {
    c.supportedTransactionVersions = new Set(["legacy", 0]);
  }
  if (!c.features) {
    c.features = new Set();
  }
  return conn;
}

export function getProvider(wallet: any) {
  if (!wallet) {
    console.log("getProvider: wallet is null");
    return null;
  }
  console.log(
    "getProvider: creating provider with wallet",
    wallet.publicKey.toString()
  );
  return new AnchorProvider(getConnection(), wallet, {
    preflightCommitment: "confirmed",
  });
}

export function getProgram(provider: AnchorProvider): any {
  if (!provider) {
    console.log("getProgram: provider is null");
    return null;
  }
  try {
    const override = (import.meta as any).env?.VITE_PROGRAM_ID;
    const idlToUse: any = override
      ? { ...(idl as any), address: override }
      : (idl as any);
    const resolvedProgramId = new PublicKey(idlToUse.address).toString();
    console.log("getProgram: resolved program id:", resolvedProgramId);
    console.log("getProgram: initializing program", resolvedProgramId);
    const prog = new (Program as any)(idlToUse, provider as any);

    console.log("getProgram: success");
    return prog;
  } catch (e) {
    console.error("Program init error:", e);
    return null;
  }
}

export function findSettlementPda(programId: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("settlement"),
      new Uint8Array(nonce.toArray("le", 8)),
    ],
    programId
  )[0];
}

export function findTokenMapPda(programId: PublicKey, id: BN) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("token"), new Uint8Array(id.toArray("le", 8))],
    programId
  )[0];
}

export function findTempWalletPda(
  programId: PublicKey,
  user: PublicKey,
  nonce: BN
) {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("temp_wallet"),
      user.toBuffer(),
      new Uint8Array(nonce.toArray("le", 8)),
    ],
    programId
  )[0];
}
