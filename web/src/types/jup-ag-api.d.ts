declare module "@jup-ag/api" {
  export function createJupiterApiClient(): {
    quoteGet(params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps?: number;
    }): Promise<{ outAmount: string }>;
  };
}
