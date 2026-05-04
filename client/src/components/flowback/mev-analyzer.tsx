"use client";

import { useState, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Minus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MevDashboard } from "./mev-dashboard";
import {
  fetchMevAnalysis,
  RelayRequestError,
  type MevAnalysisResult,
} from "@/lib/flowback-relay";

function isLikelyAddr(a: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());
}

function shortAddr(a: string): string {
  return a.slice(0, 4) + "…" + a.slice(-4);
}

type Phase = "idle" | "invalid" | "loading" | "ready" | "empty" | "error";

export function MevAnalyzer() {
  const [addr, setAddr] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<MevAnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback(
    async (val?: string) => {
      const v = (val ?? addr).trim();
      if (!v) return;
      if (!isLikelyAddr(v)) {
        setPhase("invalid");
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setPhase("loading");
      setErrorMsg("");

      try {
        const data = await fetchMevAnalysis(v, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (data.totalSwaps === 0) {
          setPhase("empty");
        } else {
          setResult(data);
          setPhase("ready");
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof RelayRequestError && err.status === 429) {
          setErrorMsg("Rate limited - please try again in a minute.");
        } else if (err instanceof RelayRequestError && err.status === 502) {
          setErrorMsg("Helius API unavailable - try again shortly.");
        } else {
          setErrorMsg("Something went wrong. Please try again.");
        }
        setPhase("error");
      }
    },
    [addr],
  );

  const loadMore = useCallback(async () => {
    if (!result?.hasMore) return;
    const nextPage = result.page + 1;
    if (nextPage > 5) return;

    try {
      const data = await fetchMevAnalysis(result.wallet, { pages: nextPage });
      setResult(data);
    } catch {
      // keep existing result on failure
    }
  }, [result]);

  const useConnectedWallet = () => {
    if (publicKey) {
      const walletAddr = publicKey.toBase58();
      setAddr(walletAddr);
      submit(walletAddr);
    } else {
      setVisible(true);
    }
  };

  return (
    <div className="relative z-2 mx-auto max-w-[1100px] px-6 pb-20">
      {/* Input section */}
      <div className={`mx-auto max-w-2xl pt-40`}>
        {phase === "idle" && (
          <div className="flex flex-col gap-y-4 text-center text-5xl">
            <h1 className="mb-8 text-center text-xl leading-relaxed font-medium tracking-tight">
              How much have MEV bots taken from you?
            </h1>
            <p className="mt-10 text-[15px] leading-relaxed text-(--fg-muted)">
              Paste a Solana wallet to scan its swap history for sandwich
              attacks. See losses, see what FlowBack would have rebated.
            </p>
          </div>
        )}

        {/* Input row */}
        <div
          className={`mt-10 flex items-stretch gap-2.5 rounded-xl border bg-(--bg-elev) p-1.5 text-center transition-colors duration-200 ${
            phase === "invalid"
              ? "border-[var(--danger)]"
              : "border-(--line) focus-within:border-(--line-strong)"
          }`}
        >
          <Input
            type="text"
            placeholder="Solana wallet address"
            value={addr}
            onChange={(e) => {
              setAddr(e.target.value);
              if (phase === "invalid") setPhase("idle");
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            spellCheck={false}
            className="h-auto min-w-0 flex-1 border-0 bg-transparent px-3.5 font-mono text-sm text-(--fg) placeholder:text-(--fg-dim) focus-visible:border-0 focus-visible:ring-0"
          />
          <Button
            onClick={() => submit()}
            disabled={!addr.trim() || phase === "loading"}
            className="h-11 rounded-[9px] border-0 bg-(--accent) px-5.5 text-sm font-medium text-(--accent-ink) shadow-[0_0_0_1px_var(--accent),0_10px_30px_-10px_var(--accent-glow)] hover:shadow-[0_0_0_1px_var(--accent),0_14px_40px_-10px_var(--accent-glow)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55"
          >
            {phase === "loading" ? "Scanning…" : "Analyze"}
          </Button>
        </div>

        {/* Helper text */}
        {phase === "invalid" && (
          <div className="mt-4 font-mono text-[12.5px] text-(--danger)">
            Not a valid Solana address. Expecting a base58 string, 32-44 chars.
          </div>
        )}
        {phase !== "invalid" && phase !== "loading" && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-(--fg-dim)">
              Scans up to 500 recent swap transactions. Read-only - no signature
              required.
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-(--fg-dim)">
              <button
                type="button"
                onClick={useConnectedWallet}
                className="cursor-pointer rounded-md border border-dashed border-(--line-strong) bg-transparent px-2.5 py-1 font-mono text-[11px] text-(--fg-muted) hover:border-solid hover:text-(--fg)"
              >
                {publicKey ? "Use connected wallet" : "Connect wallet"}
              </button>
            </div>
          </div>
        )}

        {/* Example + connected wallet buttons */}
      </div>

      {/* Loading state */}
      {phase === "loading" && (
        <div className="mt-14 grid gap-7">
          <div className="mb-5 flex items-center gap-2.5 font-mono text-xs tracking-[0.08em] text-(--fg-dim) uppercase">
            <span>Scanning swap history</span>
            <span className="analyzer-dots" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="skeleton-shimmer h-[142px] gap-0 bg-(--bg-elev) p-0 ring-[var(--line)]" />
            <Card className="skeleton-shimmer h-[142px] gap-0 bg-(--bg-elev) p-0 ring-[var(--line)]" />
            <Card className="skeleton-shimmer h-[142px] gap-0 bg-(--bg-elev) p-0 ring-[var(--line)]" />
          </div>

          <Card className="gap-0 rounded-2xl bg-(--bg-elev) p-0 ring-[var(--line)]">
            <CardContent className="grid gap-2 p-4">
              <div className="skeleton-shimmer h-16 rounded-xl border border-(--line) bg-(--bg-elev)" />
              <div className="skeleton-shimmer h-16 rounded-xl border border-(--line) bg-(--bg-elev)" />
              <div className="skeleton-shimmer h-16 rounded-xl border border-(--line) bg-(--bg-elev)" />
              <div className="skeleton-shimmer h-16 rounded-xl border border-(--line) bg-(--bg-elev)" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results */}
      {phase === "ready" && result && (
        <MevDashboard
          data={result}
          onLoadMore={result.hasMore ? loadMore : undefined}
        />
      )}

      {/* Error state */}
      {phase === "error" && (
        <div className="mt-14">
          <Card className="gap-0 bg-(--bg-elev) p-0 ring-[var(--line)]">
            <CardContent className="px-7 py-14 text-center text-[14.5px] text-(--fg-muted)">
              <div className="mb-3.5 inline-grid size-10 place-items-center rounded-full border border-(--line) bg-(--chip) text-(--danger)">
                <Minus size={18} strokeWidth={1.5} />
              </div>
              <div>{errorMsg}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {phase === "empty" && (
        <div className="mt-14">
          <Card className="gap-0 bg-(--bg-elev) p-0 ring-[var(--line)]">
            <CardContent className="px-7 py-14 text-center text-[14.5px] text-(--fg-muted)">
              <div className="mb-3.5 inline-grid size-10 place-items-center rounded-full border border-(--line) bg-(--chip) text-(--fg-dim)">
                <Minus size={18} strokeWidth={1.5} />
              </div>
              <div>No swap activity found for this wallet.</div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
