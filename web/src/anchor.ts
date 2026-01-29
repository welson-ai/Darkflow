import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Idl, BN } from "@coral-xyz/anchor";
import idl from "./idl/dex.json";

export const PROGRAM_ID = new PublicKey((idl as any).address);

export function getConnection() {
  return new Connection("https://api.devnet.solana.com", "confirmed");
}

export function getProvider(wallet: any) {
  return new AnchorProvider(getConnection(), wallet, {
    preflightCommitment: "confirmed",
  });
}

export function getProgram<T extends Idl>(provider: AnchorProvider) {
  return new Program(idl as T, PROGRAM_ID, provider) as unknown as Program<T>;
}

export function findSettlementPda(programId: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("settlement"), nonce.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

export function findTokenMapPda(programId: PublicKey, id: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token"), id.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

export function findTempWalletPda(programId: PublicKey, user: PublicKey, nonce: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("temp_wallet"), user.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}
