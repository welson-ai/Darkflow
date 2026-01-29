import { useMemo, useState, useEffect } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getProvider, getProgram, PROGRAM_ID, findSettlementPda, findTokenMapPda, findTempWalletPda } from "./anchor";
import "./styles.css";

function Inner() {
  const wallet = useAnchorWallet();
  const [step, setStep] = useState<"input" | "deposit" | "processing" | "complete">("input");
  const [fromToken, setFromToken] = useState<keyof typeof TOKEN_REGISTRY>("USDC");
  const [toToken, setToToken] = useState<keyof typeof TOKEN_REGISTRY>("SOL");
  const [amount, setAmount] = useState<string>("1000");
  const [estimatedOutput, setEstimatedOutput] = useState<string>("0.00");
  const [loading, setLoading] = useState(false);
  const [tempWalletAddr, setTempWalletAddr] = useState<string>("");
  const [nonce, setNonce] = useState<string>(() => Date.now().toString());
  const [status, setStatus] = useState<string>("");
  const [balance, setBalance] = useState<string>("0.00");
  const [error, setError] = useState<string>("");
  const [swapResult, setSwapResult] = useState<any | null>(null);
  const [startToBalance, setStartToBalance] = useState<number | null>(null);

  const provider = useMemo<AnchorProvider | null>(() => (wallet ? getProvider(wallet) : null), [wallet]);
  const program = useMemo(() => (provider ? getProgram(provider) : null), [provider]);

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!amount || parseFloat(amount) <= 0) {
        setEstimatedOutput("0.00");
        return;
      }
      try {
        const { createJupiterApiClient } = await import("@jup-ag/api");
        const jupiterQuoteApi = createJupiterApiClient();
        const fromInfo = TOKEN_REGISTRY[fromToken];
        const toInfo = TOKEN_REGISTRY[toToken];
        const amtSmall = Math.floor(parseFloat(amount) * Math.pow(10, fromInfo.decimals));
        const quote = await jupiterQuoteApi.quoteGet({
          inputMint: fromInfo.mint.toString(),
          outputMint: toInfo.mint.toString(),
          amount: amtSmall,
          slippageBps: 100,
        });
        const outputAmount = parseInt(quote.outAmount) / Math.pow(10, toInfo.decimals);
        setEstimatedOutput(outputAmount.toFixed(toInfo.decimals === 9 ? 4 : 2));
      } catch (e) {
        console.error("Quote error:", e);
        setEstimatedOutput("Error");
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [amount, fromToken, toToken]);

  useEffect(() => {
    if (!program || !wallet?.publicKey) return;
    (async () => {
      try {
        for (const [symbol, info] of Object.entries(TOKEN_REGISTRY)) {
          const id = new BN(info.tokenId);
          const pda = findTokenMapPda(program.programId, id);
          try {
            await program.methods
              .registerToken(id)
              .accounts({ payer: wallet.publicKey, tokenMapping: pda, mint: info.mint })
              .rpc();
          } catch {
            // ignore if already registered
          }
        }
      } catch (e) {
        // silent
      }
    })();
  }, [program, wallet?.publicKey]);

  const fetchBalance = async (tokenSymbol: string) => {
    if (!program || !wallet?.publicKey) return;
    try {
      const tokenInfo = TOKEN_REGISTRY[tokenSymbol];
      const connection = program.provider.connection;
      if (tokenSymbol === "SOL") {
        const lamports = await connection.getBalance(wallet.publicKey);
        setBalance((lamports / 1e9).toFixed(4));
      } else {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
          mint: tokenInfo.mint,
        });
        if (tokenAccounts.value.length > 0) {
          const uiAmt =
            tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
          setBalance(Number(uiAmt).toFixed(2));
        } else {
          setBalance("0.00");
        }
      }
    } catch (error) {
      console.error("Balance fetch error:", error);
      setBalance("Error");
    }
  };

  const fetchBalanceNumeric = async (tokenSymbol: string): Promise<number> => {
    if (!program || !wallet?.publicKey) return 0;
    try {
      const tokenInfo = TOKEN_REGISTRY[tokenSymbol];
      const connection = program.provider.connection;
      if (tokenSymbol === "SOL") {
        const lamports = await connection.getBalance(wallet.publicKey);
        return lamports / 1e9;
      } else {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
          mint: tokenInfo.mint,
        });
        if (tokenAccounts.value.length > 0) {
          const uiAmt =
            tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
          return Number(uiAmt);
        }
        return 0;
      }
    } catch {
      return 0;
    }
  };

  useEffect(() => {
    if (wallet && (wallet as any).connected && fromToken) {
      fetchBalance(fromToken);
    }
  }, [wallet, fromToken]);

  async function handleSwapPrivately() {
    if (!program || !wallet?.publicKey) return;
    if (!(wallet as any).connected) {
      setError("Please connect your wallet first");
      return;
    }
    const n = new BN(nonce);
    const fromInfo = TOKEN_REGISTRY[fromToken];
    const toInfo = TOKEN_REGISTRY[toToken];
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    if (fromToken === toToken) {
      setError("Cannot swap the same token");
      return;
    }
    if (balance !== "Error" && parseFloat(balance) < parsed) {
      setError(`Insufficient ${fromToken} balance. You have ${balance} ${fromToken}`);
      return;
    }
    const amtInSmall = Math.floor(parsed * Math.pow(10, fromInfo.decimals));
    const amtIn = new BN(amtInSmall);
    const mOut = new BN(0);
    const tempWallet = findTempWalletPda(program.programId, wallet.publicKey, n);
    
    const dummyEnc = new Array(32).fill(0);
    
    try {
      setError("");
      setLoading(true);
      const startBal = await fetchBalanceNumeric(toToken);
      setStartToBalance(startBal);
      await program.methods
        .createPrivateSwap(
          amtIn,
          mOut,
          n,
          new BN(0), // computation_offset
          dummyEnc,
          dummyEnc,
          dummyEnc,
          dummyEnc,
          dummyEnc
        )
        .accounts({
          payer: wallet.publicKey,
          tempWallet: tempWallet,
          tokenInMint: fromInfo.mint,
          tokenOutMint: toInfo.mint,
        })
        .rpc()
        .then((txid: string) => {
          setSwapResult((prev: any) => ({ ...(prev || {}), txSignature: txid }));
        });
      setTempWalletAddr(tempWallet.toBase58());
      setStep("deposit");
      setStatus("");
    } catch (e: any) {
      console.error(e);
      if (e?.message?.includes("User rejected")) {
        setError("Transaction cancelled");
      } else if (e?.message?.includes("insufficient funds")) {
        setError("Insufficient SOL for transaction fees");
      } else {
        setError(`Swap failed: ${e?.message || e}`);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!program || !wallet?.publicKey || !tempWalletAddr) return;
    let timer: any;
    const n = new BN(nonce);
    const settlementPda = findSettlementPda(program.programId, n);
    const run = async () => {
      try {
        const tempWallet = await (program as any).account.tempWallet.fetch(new PublicKey(tempWalletAddr));
        if (tempWallet.isFunded && step === "deposit") {
          setStep("processing");
        }
        const info = await program.provider.connection.getAccountInfo(settlementPda);
        if (!info && step === "processing") {
          const finalBal = await fetchBalanceNumeric(toToken);
          const amountOut = startToBalance !== null ? Math.max(finalBal - startToBalance, 0) : 0;
          const privacyFee = (parseFloat(amount) || 0) * 0.003;
          const rate = amountOut > 0 ? (parseFloat(amount) || 0) / amountOut : 0;
          setSwapResult({
            amountIn: amount,
            tokenIn: fromToken,
            amountOut: amountOut.toFixed(TOKEN_REGISTRY[toToken].decimals === 9 ? 4 : 2),
            tokenOut: toToken,
            rate: rate.toFixed(4),
            privacyFee: privacyFee.toFixed(4),
            txSignature: (swapResult && swapResult.txSignature) || "",
          });
          setStep("complete");
        }
      } catch {
        // ignore
      }
    };
    timer = setInterval(run, 5000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [program, wallet?.publicKey, tempWalletAddr, step, nonce]);

  return (
    <div className="container">
      <div className="header">
        <WalletMultiButton />
      </div>
      {step === "input" && (
        <div className="swap-card">
          <div className="title">🔒 Private Swap</div>
          <div className="input-section">
            <label>You Pay</label>
            <div className="token-input">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              <select value={fromToken} onChange={(e) => setFromToken(e.target.value as any)}>
                {Object.keys(TOKEN_REGISTRY).map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {TOKEN_REGISTRY[symbol as keyof typeof TOKEN_REGISTRY].icon} {symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="swap-arrow-container">
            <button
              className="swap-direction-button"
              onClick={() => {
                const temp = fromToken;
                setFromToken(toToken);
                setToToken(temp);
              }}
              title="Reverse swap direction"
            >
              ⬇️⬆️
            </button>
          </div>
          <div className="input-section">
            <label>You Receive (estimated)</label>
            <div className="token-input">
              <input type="text" value={estimatedOutput} disabled placeholder="0.00" />
              <select value={toToken} onChange={(e) => setToToken(e.target.value as any)}>
                {Object.keys(TOKEN_REGISTRY).map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {TOKEN_REGISTRY[symbol as keyof typeof TOKEN_REGISTRY].icon} {symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="info-row">
            <span>Privacy Fee: 0.3%</span>
            <span>Slippage: 1%</span>
          </div>
          <button className="swap-button" onClick={handleSwapPrivately} disabled={loading || !(wallet as any)?.connected}>
            {loading ? (
              <>
                <span className="spinner">⏳</span> Creating Swap...
              </>
            ) : (
              <>🔒 Swap Privately</>
            )}
          </button>
          {error && <div className="error-message">⚠️ {error}</div>}
          {status && <div className="status">{status}</div>}
        </div>
      )}
      {step === "deposit" && (
        <div className="deposit-card">
          <div className="title">Deposit Tokens</div>
          <div className="warn">Send EXACTLY {amount} {fromToken}</div>
          <div className="warn">One-time address only</div>
          <div className="address-box">
            <span>{tempWalletAddr}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(tempWalletAddr);
              }}
            >
              Copy
            </button>
          </div>
          <div className="hint">Waiting for deposit... We’ll detect it automatically.</div>
        </div>
      )}
      {step === "processing" && (
        <div className="processing-card">
          <div className="title">Processing Swap</div>
          <div className="hint">Your private order is being matched and executed.</div>
        </div>
      )}
      {step === "complete" && (
        <div className="complete-card">
          <div className="title">Swap Complete</div>
          {swapResult ? (
            <>
              <div className="success-message">
                🎉 You received: {swapResult.amountOut} {swapResult.tokenOut}
              </div>
              <div className="trade-summary">
                <div className="summary-row">
                  <span>Paid:</span>
                  <span>{swapResult.amountIn} {swapResult.tokenIn}</span>
                </div>
                <div className="summary-row">
                  <span>Received:</span>
                  <span>{swapResult.amountOut} {swapResult.tokenOut}</span>
                </div>
                <div className="summary-row">
                  <span>Exchange Rate:</span>
                  <span>1 {swapResult.tokenOut} = {swapResult.rate} {swapResult.tokenIn}</span>
                </div>
                <div className="summary-row">
                  <span>Privacy Fee:</span>
                  <span>{swapResult.privacyFee} {swapResult.tokenIn} (0.3%)</span>
                </div>
              </div>
              <div className="action-buttons">
                <button onClick={() => setStep("input")}>Trade Again</button>
                {swapResult.txSignature && (
                  <a
                    href={`https://solscan.io/tx/${swapResult.txSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on Solscan ↗
                  </a>
                )}
              </div>
            </>
          ) : (
            <div className="hint">Funds returned. Thank you for using private swaps.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint="https://api.devnet.solana.com">
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Inner />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

const TOKEN_REGISTRY: Record<
  string,
  { tokenId: number; mint: PublicKey; decimals: number; icon: string }
> = {
  USDC: {
    tokenId: 1,
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6,
    icon: "💵",
  },
  SOL: {
    tokenId: 2,
    mint: new PublicKey("So11111111111111111111111111111111111111112"),
    decimals: 9,
    icon: "◎",
  },
  USDT: {
    tokenId: 3,
    mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    decimals: 6,
    icon: "💲",
  },
  BONK: {
    tokenId: 4,
    mint: new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
    decimals: 5,
    icon: "🐕",
  },
};
