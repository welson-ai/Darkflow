import { Connection } from "@solana/web3.js";

export function getNetwork(
  connection: Connection
): "mainnet" | "devnet" | "localhost" {
  const endpoint = connection.rpcEndpoint;
  if (
    endpoint.includes("mainnet") ||
    endpoint.includes("helius") ||
    endpoint.includes("quicknode")
  )
    return "mainnet";
  if (endpoint.includes("devnet")) return "devnet";
  return "localhost";
}
