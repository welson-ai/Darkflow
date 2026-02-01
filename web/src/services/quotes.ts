import { Connection } from "@solana/web3.js";
import { createJupiterApiClient } from "@jup-ag/api";
import { getNetwork } from "../utils/network";

const jupiterQuoteApi = createJupiterApiClient();

export interface QuoteResult {
  outAmount: number; // UI amount
  outAmountLamports?: string; // Stringified integer for BN
  isMock: boolean;
  routeData?: any; // Original Jupiter quote response
}

export async function getSwapQuote(
  fromMint: string,
  toMint: string,
  amount: number, // UI amount
  fromDecimals: number,
  toDecimals: number,
  connection: Connection
): Promise<QuoteResult> {
  const network = getNetwork(connection);

  if (network === "mainnet") {
    try {
      // Convert amount to lamports/integers
      const amountLamports = Math.floor(amount * Math.pow(10, fromDecimals));

      const params = {
        inputMint: fromMint,
        outputMint: toMint,
        amount: amountLamports,
        slippageBps: 50, // 0.5%
      };

      const quote = await jupiterQuoteApi.quoteGet(params);

      if (!quote) {
        throw new Error("No quote found");
      }

      return {
        outAmount: Number(quote.outAmount) / Math.pow(10, toDecimals),
        outAmountLamports: quote.outAmount,
        isMock: false,
        routeData: quote,
      };
    } catch (error) {
      console.error("Jupiter API Error:", error);
      throw error;
    }
  } else {
    // Mock for Devnet/Localhost
    const out = calculateMockOutput(fromMint, toMint, amount);
    const outLamports = Math.floor(out * Math.pow(10, toDecimals)).toString();

    return {
      outAmount: out,
      outAmountLamports: outLamports,
      isMock: true,
    };
  }
}

function calculateMockOutput(
  fromMint: string,
  toMint: string,
  amount: number
): number {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  // We assume any other mint is USDC/Stable for the mock ratio
  const RATE_SOL_USDC = 40;

  if (fromMint === SOL_MINT && toMint !== SOL_MINT) {
    // SOL -> USDC (or other)
    return amount * RATE_SOL_USDC;
  } else if (fromMint !== SOL_MINT && toMint === SOL_MINT) {
    // USDC -> SOL
    return amount / RATE_SOL_USDC;
  } else {
    // Stable -> Stable or Unknown (1:1)
    return amount;
  }
}
