import { useMemo, useState, useEffect } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getProvider, getProgram, PROGRAM_ID, findSettlementPda, findTokenMapPda, findTempWalletPda } from "./anchor";
import { getNetwork } from "./utils/network";
import { getSwapQuote } from "./services/quotes";
import "./styles.css";

function Inner() {
  const wallet = useAnchorWallet();
  const { connected } = useWallet();
  const [step, setStep] = useState<"input" | "deposit" | "processing" | "complete">("input");
  const [fromToken, setFromToken] = useState<string>("");
  const [toToken, setToToken] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [estimatedOutput, setEstimatedOutput] = useState<string>("");
  const [isMock, setIsMock] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [tempWalletAddr, setTempWalletAddr] = useState<string>("");
  const [nonce, setNonce] = useState<string>(() => Date.now().toString());
  const [status, setStatus] = useState<string>("");
  const [balance, setBalance] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [swapResult, setSwapResult] = useState<any | null>(null);
  const [startToBalance, setStartToBalance] = useState<number | null>(null);
  const [validatorOK, setValidatorOK] = useState<boolean>(false);
  const [networkLabel, setNetworkLabel] = useState<string>("");

  const provider = useMemo<AnchorProvider | null>(() => {
    if (wallet) {
      console.log("App: Wallet present, getting provider");
      return getProvider(wallet);
    }
    console.log("App: Wallet null");
    return null;
  }, [wallet]);

  const program = useMemo(() => {
    if (provider) {
      console.log("App: Provider present, getting program");
      return getProgram(provider);
    }
    console.log("App: Provider null");
    return null;
  }, [provider]);

  const DEFAULT_DEVNET_POOL_ID = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
  // USE_MOCK_SWAP removed in favor of dynamic network detection
  const MOCK_PRICE_USDC_PER_SOL = 40;

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (!amount || parseFloat(amount) <= 0 || !fromToken || !toToken) {
        setEstimatedOutput("");
        return;
      }
      try {
        if (!program) return;
        const connection = program.provider.connection;
        const fromInfo = TOKEN_REGISTRY[fromToken];
        const toInfo = TOKEN_REGISTRY[toToken];
        
        const quote = await getSwapQuote(
            fromInfo.mint.toString(),
            toInfo.mint.toString(),
            parseFloat(amount),
            fromInfo.decimals,
            toInfo.decimals,
            connection
        );
        
        setEstimatedOutput(quote.outAmount.toFixed(toInfo.decimals === 9 ? 4 : 2));
        setIsMock(quote.isMock);
      } catch (e) {
        console.error("Quote error:", e);
        setEstimatedOutput("");
        setIsMock(false);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [amount, fromToken, toToken, program]);

  useEffect(() => {
    if (!program || !wallet?.publicKey) return;
    (async () => {
      try {
        for (const [symbol, info] of Object.entries(TOKEN_REGISTRY)) {
          const id = new BN(info.tokenId);
          const pda = findTokenMapPda(program.programId, id);
          try {
            // Check if already registered
            await program.account.tokenMapping.fetch(pda);
            console.log(`Token ${symbol} already registered`);
          } catch (e) {
            // Not registered, try to register
            console.log(`Registering token ${symbol}...`);
            try {
              await program.methods
                .registerToken(id)
                .accounts({ payer: wallet.publicKey, tokenMapping: pda, mint: info.mint })
                .rpc();
              console.log(`Registered ${symbol}`);
            } catch (regError) {
              console.warn(`Failed to register ${symbol}:`, regError);
            }
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

  const requestAirdrop = async () => {
    if (!program || !wallet?.publicKey) return;
    try {
      setError("");
      setStatus("Requesting Devnet airdrop...");
      const sig = await program.provider.connection.requestAirdrop(wallet.publicKey, 2 * 1e9);
      await program.provider.connection.confirmTransaction(sig, "confirmed");
      await fetchBalance("SOL");
      setStatus("Airdrop complete");
    } catch (e: any) {
      console.error(e);
      setError(`Airdrop failed: ${e?.message || e}`);
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
    if (wallet && connected && fromToken) {
      fetchBalance(fromToken);
    }
  }, [wallet, connected, fromToken]);
  
  useEffect(() => {
    if (!program) return;
    const conn = program.provider.connection;
    const net = getNetwork(conn);
    setNetworkLabel(net);
    (async () => {
      try {
        if (net !== "mainnet") {
          await conn.getLatestBlockhash();
          setValidatorOK(true);
        } else {
          setValidatorOK(false);
        }
      } catch {
        setValidatorOK(false);
      }
    })();
  }, [program]);

  async function handleSwapPrivately() {
    console.log("handleSwapPrivately initiated");
    if (!connected) {
      setError("Please connect your wallet first");
      return;
    }
    if (!wallet?.publicKey) {
      setError("Wallet not ready. Please try disconnecting and reconnecting.");
      return;
    }
    if (!program) {
      setError("System not ready. Please reload the page.");
      return;
    }
    if (!fromToken) {
      setError("Select the token you pay");
      return;
    }
    if (!toToken) {
      setError("Select the token you receive");
      return;
    }
    // proceed with Raydium CPMM swap on devnet

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
    const numericBalance = parseFloat(balance);
    if (balance !== "Error" && Number.isFinite(numericBalance) && numericBalance < parsed) {
      setError(`Insufficient ${fromToken} balance. You have ${balance} ${fromToken}`);
      return;
    }
    const amtInSmall = Math.floor(parsed * Math.pow(10, fromInfo.decimals));
    const amtIn = new BN(amtInSmall);

    try {
      setError("");
      setLoading(true);

      const connection = program.provider.connection;
      const network = getNetwork(connection);
      
      // Calculate minOut (using quote or estimate)
      // Since we just need to initiate, we can use the current estimated output
      // For real flow, we should probably re-quote here.
      const estOut = parseFloat(estimatedOutput || "0");
      const minOutSmall = Math.floor(estOut * Math.pow(10, toInfo.decimals) * 0.99); // 1% slippage
      const minOut = new BN(minOutSmall);

      // 1. Create Private Swap (Temp Wallet)
      const dummyEncrypted = Array(32).fill(0);
      const computationOffset = new BN(0);

      const tempWalletPda = findTempWalletPda(program.programId, wallet.publicKey, n);
      setTempWalletAddr(tempWalletPda.toString());

      const tx = new Transaction();
      
      // We need token mints
      const tokenInMint = new PublicKey(fromInfo.mint);
      const tokenOutMint = new PublicKey(toInfo.mint);

      const createIx = await program.methods
        .createPrivateSwap(
            amtIn,
            minOut,
            n,
            computationOffset,
            dummyEncrypted, // amount_in
            dummyEncrypted, // amount_out_min
            dummyEncrypted, // token_in
            dummyEncrypted, // token_out
            dummyEncrypted  // nonce
        )
        .accounts({
            payer: wallet.publicKey,
            tempWallet: tempWalletPda,
            tokenInMint: tokenInMint,
            tokenOutMint: tokenOutMint,
        })
        .instruction();
      
      tx.add(createIx);

      if (network !== 'mainnet') {
        // Devnet/Localhost: Simulate Match Order (Test Flow)
        // We can do this in the same transaction for testing convenience, 
        // OR separate it. Separate is better to mimic async nature.
        // But for user experience, let's just do create first.
      }

      const sig = await (program.provider as any).sendAndConfirm(tx, []);
      console.log("Private Swap Created:", sig);

      setStep("deposit");
      setStatus("Swap initiated. Waiting for deposit...");

      // Simulate Match Order (Test Flow) - Moved to run after deposit detection or immediately if needed
      // But for "Option 1" style, let's keep it here but clearly mark it as part of the test flow setup
      if (network !== 'mainnet') {
         console.log("Simulating Match Order for Test Network...");
         const tokenInId = new BN(fromInfo.tokenId);
         const tokenOutId = new BN(toInfo.tokenId);
         
         const simTx = new Transaction();
         const simIx = await program.methods
            .simulateMatchOrder(
                amtIn,
                minOut,
                tokenInId,
                tokenOutId,
                n
            )
            .accounts({
                payer: wallet.publicKey,
                settlementRequest: findSettlementPda(program.programId, n)
            })
            .instruction();
         
         simTx.add(simIx);
         await (program.provider as any).sendAndConfirm(simTx, []);
         console.log("✅ Settlement active (Simulated)");
      }

    } catch (e: any) {
      console.error(e);
      let logs: string[] | null = null;
      try {
        if (typeof e?.getLogs === "function") {
          const l = await e.getLogs();
          if (Array.isArray(l)) logs = l;
        } else if (Array.isArray(e?.logs)) {
          logs = e.logs;
        }
      } catch {}
      if (e?.message?.includes("User rejected")) {
        setError("Transaction cancelled");
      } else if (e?.message?.includes("insufficient funds")) {
        setError("Insufficient SOL for transaction fees");
      } else {
        setError(`Swap failed: ${e?.message || e}`);
        if (logs && logs.length) {
          setStatus(logs.join("\n"));
        }
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
        let isSettled = false;
        if (!info) {
             // Account closed (Mainnet behavior)
             isSettled = true;
        } else {
             // Check if active (Devnet behavior)
             try {
                const acc = await program.account.settlementRequest.fetch(settlementPda);
                
                // If we are on Localhost/Devnet, we need to manually trigger execution when funded
                const network = getNetwork(program.provider.connection);
                if (network !== 'mainnet' && tempWallet.isFunded && acc.active && step === "processing") {
                    console.log("Auto-executing swap for test network...");
                    // We need token IDs and empty route data
                    const fromInfo = TOKEN_REGISTRY[fromToken];
                    const toInfo = TOKEN_REGISTRY[toToken];
                    // Find mapping PDAs
                    const tokenInMappingPda = findTokenMapPda(program.programId, new BN(fromInfo.tokenId));
                    const tokenOutMappingPda = findTokenMapPda(program.programId, new BN(toInfo.tokenId));
                    
                    try {
                        await program.methods
                            .executeSwapTest(n)
                            .accounts({
                                payer: wallet.publicKey,
                                settlementRequest: settlementPda,
                                tempWallet: new PublicKey(tempWalletAddr),
                                tokenInMapping: tokenInMappingPda,
                                tokenOutMapping: tokenOutMappingPda,
                                jupiterProgram: new PublicKey("11111111111111111111111111111111"), // Dummy
                            })
                            .rpc();
                         console.log("Execute Swap Test sent");
                    } catch (exErr) {
                        console.error("Execute Swap Test failed", exErr);
                    }
                }

                if (!acc.active) {
                    isSettled = true;
                }
             } catch (e) {
                 // Might be closed now
                 isSettled = true;
             }
        }

        if (isSettled && step === "processing") {
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
    <div>
      <div className="site-header">
        <div className="site-brand">
          <img
            className="brand-image"
            src="https://i.postimg.cc/tgbDCVXC/Untitled-design-1-removebg-preview.png"
            alt="logo"
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <WalletMultiButton />
        </div>
      </div>
      <div className="hero">
        <h1>Privacy-first swapping</h1>
        <p>Darkflow lets you swap tokens without exposing your trading intent.</p>
      </div>
      {/* Network Status Indicator */}
      <div style={{
          position: 'fixed',
          top: 20,
          right: 20,
          background: 'rgba(0,0,0,0.8)',
          padding: '8px 16px',
          borderRadius: 20,
          border: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          zIndex: 100
      }}>
          <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: validatorOK ? '#00ff88' : '#ff4444',
              boxShadow: validatorOK ? '0 0 10px #00ff88' : 'none'
          }} />
          <span style={{ color: '#aaa' }}>
              {validatorOK ? 'Test Validator: Connected' : 'Test Validator: Not Connected'}
          </span>
          {networkLabel && networkLabel !== 'mainnet' && (
             <span style={{ 
                 background: '#333', 
                 padding: '2px 6px', 
                 borderRadius: 4, 
                 color: '#fff',
                 fontWeight: 'bold'
             }}>
                 TEST MODE ({networkLabel})
             </span>
          )}
      </div>
      
      {networkLabel && networkLabel !== 'mainnet' && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          background: 'rgba(20,20,20,0.95)',
          padding: '16px',
          borderRadius: 12,
          border: '1px solid #333',
          width: 280,
          zIndex: 99
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#fff' }}>Test Validator Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: validatorOK ? '#00ff88' : '#ff4444',
              boxShadow: validatorOK ? '0 0 10px #00ff88' : 'none'
            }} />
            <div style={{ color: '#ccc' }}>{validatorOK ? 'Connected' : 'Not connected'}</div>
          </div>
          <div style={{ marginTop: 8, color: '#aaa', fontSize: 12 }}>
            Network: {networkLabel}
          </div>
        </div>
      )}

      <div className="container">
      {step === "input" && (
        <div className="swap-card">
          <div className="title">
            🔒 Private Swap
            {isMock && <span style={{ 
                marginLeft: '10px', 
                fontSize: '0.6em', 
                background: '#ff9800', 
                color: 'black', 
                padding: '2px 6px', 
                borderRadius: '4px' 
            }}>MOCK</span>}
          </div>
          <div className="input-section">
            <label>You Pay</label>
            <div className="token-input">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
              <select value={fromToken} onChange={(e) => setFromToken(e.target.value)}>
                <option value="" disabled>
                  Select token
                </option>
                {Object.keys(TOKEN_REGISTRY).map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {TOKEN_REGISTRY[symbol as keyof typeof TOKEN_REGISTRY].icon} {symbol}
                  </option>
                ))}
              </select>
            </div>
            {connected && fromToken && balance && (
              <div className="balance-display">
                <span>Balance: {balance} {fromToken}</span>
              </div>
            )}
          </div>
          <div className="swap-arrow-container">
            <button
              className="swap-direction-button"
              onClick={() => {
                if (!fromToken || !toToken) return;
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
              <input type="text" value={estimatedOutput} disabled placeholder="—" />
              <select value={toToken} onChange={(e) => setToToken(e.target.value)}>
                <option value="" disabled>
                  Select token
                </option>
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
          <button
            className="swap-button"
            onClick={handleSwapPrivately}
            disabled={loading || !connected || !amount || !fromToken || !toToken}
          >
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
      <div className="site-footer">
        © {new Date().getFullYear()} Private DEX — Privacy-preserving swaps on Solana
      </div>
    </div>
  );
}

export default function App() {
  const env: any = (import.meta as any).env || {};
  const rpcEnv = env.VITE_RPC_URL;
  const heliusKey = env.VITE_HELIUS_API_KEY;
  const heliusNetwork = env.VITE_HELIUS_NETWORK || "devnet";
  
  // Force Localhost for testing as per recent success
  // const endpoint =
  //   rpcEnv ||
  //   (heliusKey ? `https://${heliusNetwork}.helius-rpc.com/?api-key=${heliusKey}` : "https://api.devnet.solana.com");
  const endpoint = "http://127.0.0.1:8899";
  
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
    ],
    []
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
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
    mint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
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
    mint: new PublicKey("EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS"),
    decimals: 6,
    icon: "💲",
  },
};
