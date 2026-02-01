import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@solana/wallet-adapter-react-ui/styles.css";

const w: any = window as any;
function patchProvider(p: any) {
  if (!p) return;
  if (!p.supportedTransactionVersions) {
    p.supportedTransactionVersions = new Set(["legacy", 0]);
  }
  if (!p.features) {
    p.features = new Set();
  }
}
function ensurePhantomProvider() {
  const provider =
    (window as any).solana ?? (window as any).phantom?.solana ?? null;
  if (provider?.isPhantom) {
    patchProvider(provider);
    try {
      provider.connect?.({ onlyIfTrusted: true });
    } catch {}
    return true;
  }
  return false;
}
if (!ensurePhantomProvider()) {
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (ensurePhantomProvider() || tries > 20) {
      clearInterval(timer);
    }
  }, 200);
}

{
  const provider = w.solana ?? w.phantom?.solana ?? null;
  patchProvider(provider);
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: error?.message || "Unexpected error" };
  }
  componentDidCatch(error: any) {
    console.error("Runtime error:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100vh",
            width: "100vw",
            background: "#0b0f1a",
            color: "#e5e7eb",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              background: "#121826",
              border: "1px solid #233047",
              borderRadius: 16,
              padding: 32,
              textAlign: "center",
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
              maxWidth: 400,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ color: "#9aa0aa", marginBottom: 24, fontSize: 14 }}>
              {this.state.message}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#4f46e5",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
