"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { X } from "lucide-react";
import { formatLamports } from "@/lib/flowback-relay";

type CashbackToastProps = {
  lamports: string;
  txSignature: string;
  onDismiss: () => void;
};

export function CashbackToast({ lamports, txSignature, onDismiss }: CashbackToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => handleDismiss(), 8000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDismiss() {
    setVisible(false);
    setTimeout(onDismiss, 350);
  }

  const solAmount = formatLamports(lamports);
  const explorerUrl = `https://explorer.solana.com/tx/${txSignature}`;

  return (
    <>
      <style>{`
        @keyframes cashback-in {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)  scale(1); }
        }
        @keyframes cashback-out {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(8px) scale(0.97); }
        }
        .cashback-toast {
          animation: cashback-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .cashback-toast.leaving {
          animation: cashback-out 0.3s ease forwards;
        }
        .cashback-progress {
          animation: cashback-progress-shrink 8s linear forwards;
        }
        @keyframes cashback-progress-shrink {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>

      <div
        className={`cashback-toast${!visible ? " leaving" : ""}`}
        style={{
          position: "fixed",
          bottom: 28,
          right: 28,
          zIndex: 300,
          width: 300,
          background: "var(--bg-elev)",
          border: "1px solid var(--accent)",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 20px 40px -10px oklch(0 0 0 / 0.5), 0 0 0 1px var(--accent-glow)",
        }}
      >
        <div style={{ height: 2, background: "var(--line)", position: "relative", overflow: "hidden" }}>
          <div
            className="cashback-progress"
            style={{ position: "absolute", inset: 0, background: "var(--accent)", transformOrigin: "left center" }}
          />
        </div>

        <div style={{ padding: "14px 16px 14px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent)",
              flexShrink: 0,
            }}>
              <Icon.Cashback width={16} height={16} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                  fontWeight: 500,
                }}>
                  Cashback received
                </span>
                <button
                  type="button"
                  onClick={handleDismiss}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg-dim)", padding: 2, display: "flex", flexShrink: 0 }}
                >
                  <X size={12} />
                </button>
              </div>

              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 20,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                color: "var(--fg)",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
                marginBottom: 6,
              }}>
                {solAmount}
                <span style={{ fontSize: 12, color: "var(--fg-dim)", marginLeft: 5, fontWeight: 400 }}>SOL</span>
              </div>

              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--fg-dim)",
                  textDecoration: "none",
                  letterSpacing: "0.02em",
                  transition: "color 0.15s ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--fg)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--fg-dim)"; }}
              >
                View on explorer
                <Icon.Arrow width={10} height={10} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
