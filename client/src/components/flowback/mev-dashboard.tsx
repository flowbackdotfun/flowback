"use client";

import { useState, useMemo, useRef } from "react";
import { ExternalLink, Copy, Check, CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  MevAnalysisResult,
  AnalyzedSwap,
  MevType,
} from "@/lib/flowback-relay";

const TOKEN_COLORS: Record<string, string> = {
  SOL: "oklch(0.85 0.04 280)",
  USDC: "oklch(0.82 0.10 230)",
  BONK: "oklch(0.78 0.12 50)",
  JUP: "oklch(0.78 0.10 110)",
  WIF: "oklch(0.85 0.06 50)",
  JITO: "oklch(0.78 0.08 160)",
};

const SOL_PRICE_USD_FALLBACK = 150;

const MEV_TYPE_STYLES: Record<MevType, { color: string; label: string }> = {
  sandwiched: { color: "oklch(0.70 0.13 25)", label: "Sandwiched" },
  frontrun: { color: "oklch(0.78 0.14 65)", label: "Frontrun" },
  backrun_target: { color: "oklch(0.80 0.12 90)", label: "Backrun Target" },
  clean: { color: "transparent", label: "Clean" },
};

type Tab = "all" | "sandwiched" | "frontrun" | "backrun_target" | "clean";
type Sort = "newest" | "loss";

function shortAddr(a: string): string {
  return a.slice(0, 4) + "…" + a.slice(-4);
}

function shortSig(sig: string): string {
  return sig.slice(0, 4) + "…" + sig.slice(-4);
}

function timeAgo(timestamp: number): string {
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CopyBtn({ text, size = 12 }: { text: string; size?: number }) {
  const [done, setDone] = useState(false);
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    });
  };
  return (
    <div
      className="inline-grid place-items-center bg-transparent border-0 p-0 text-(--fg-dim) cursor-pointer transition-colors duration-150 hover:text-(--fg)"
      onClick={click}
      title="Copy"
    >
      {done ? (
        <Check size={size} strokeWidth={1.6} />
      ) : (
        <Copy size={size} strokeWidth={1.5} />
      )}
    </div>
  );
}

function TokenCircle({ symbol }: { symbol: string }) {
  const bg = TOKEN_COLORS[symbol] ?? "oklch(0.7 0 0)";
  return (
    <span
      className="size-[22px] rounded-full grid place-items-center font-mono text-[9px] font-medium shrink-0"
      style={{
        background: bg,
        border: "1.5px solid var(--bg-elev)",
        color: "oklch(0.18 0 0)",
      }}
    >
      {symbol[0]}
    </span>
  );
}

function MevBadge({ type }: { type: MevType }) {
  const style = MEV_TYPE_STYLES[type];
  const isClean = type === "clean";

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.08em] uppercase px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${
        isClean ? "text-(--fg-dim) border-(--line) bg-(--chip)" : ""
      }`}
      style={
        !isClean
          ? {
              color: style.color,
              borderColor: `color-mix(in oklch, ${style.color} 35%, transparent)`,
              backgroundColor: `color-mix(in oklch, ${style.color} 8%, transparent)`,
            }
          : undefined
      }
    >
      <span
        className="size-[5px] rounded-full"
        style={{ background: "currentColor" }}
      />
      {style.label}
    </span>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" }) {
  const isHigh = level === "high";
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase px-2 py-0.5 rounded-full border whitespace-nowrap ${
        isHigh
          ? "text-(--fg-muted) border-(--line-strong) bg-(--chip)"
          : "text-(--fg-dim) border-(--line) bg-transparent"
      }`}
      title={
        isHigh
          ? "Closely matches known MEV patterns"
          : "Unusual price impact detected - may or may not be MEV"
      }
    >
      {isHigh ? "high conf." : "medium conf."}
    </span>
  );
}

function SwapRowContent({ swap }: { swap: AnalyzedSwap }) {
  const isBad = swap.mevType !== "clean";
  const typeColor = isBad ? MEV_TYPE_STYLES[swap.mevType].color : undefined;
  const lossNum = parseFloat(swap.estimatedLossToken);
  const wouldNum = parseFloat(swap.estimatedCashbackToken || "0");

  return (
    <div
      className={`mev-row grid gap-4 items-center px-5 py-4 border-b border-(--line) transition-colors duration-150 ${
        isBad ? "cursor-pointer" : "cursor-default"
      }`}
      data-affected={isBad || undefined}
      style={
        {
          gridTemplateColumns: "1.4fr 1.1fr 1fr 0.85fr 1.1fr 28px",
          ...(isBad
            ? {
                "--mev-type-color": typeColor,
                borderLeft: `2px solid ${typeColor}`,
                backgroundColor: `color-mix(in oklch, ${typeColor} 6%, transparent)`,
              }
            : {}),
        } as React.CSSProperties
      }
    >
      {/* Pair */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex">
          <TokenCircle symbol={swap.inputMint} />
          <span className="-ml-2">
            <TokenCircle symbol={swap.outputMint} />
          </span>
        </span>
        <span className="font-mono text-[13px] text-(--fg) inline-flex items-center gap-1.5">
          {swap.inputMint}
          <span className="text-(--fg-dim)">
            <svg
              viewBox="0 0 16 16"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </span>
          {swap.outputMint}
        </span>
      </div>

      {/* Amounts */}
      <div className="flex flex-col gap-0.5 font-mono text-[12.5px] min-w-0">
        <span className="text-(--fg)">
          {swap.inputAmount} {swap.inputMint}
        </span>
        <span className="text-(--fg-dim)">
          &rarr; {swap.actualOutputAmount} {swap.outputMint}
        </span>
      </div>

      {/* Tx meta */}
      <div className="flex flex-col gap-0.5 font-mono text-xs min-w-0">
        <span className="text-(--fg-muted)">{timeAgo(swap.timestamp)}</span>
        <span className="text-(--fg-dim) inline-flex items-center gap-1.5">
          {shortSig(swap.signature)}
          <CopyBtn text={swap.signature} />
        </span>
      </div>

      {/* Badge */}
      <div className="flex flex-col items-start gap-1.5">
        <MevBadge type={swap.mevType} />
        {isBad && <ConfidenceBadge level={swap.confidence} />}
      </div>

      {/* Loss numbers */}
      <div className="flex flex-col gap-0.5 text-right font-mono text-[13px] min-w-0">
        {isBad ? (
          <>
            <span className="text-(--danger) font-medium">
              &minus;{lossNum.toFixed(3)} SOL
            </span>
            <span className="text-[10px] text-(--fg-dim) tracking-[0.08em] uppercase">
              lost
            </span>
            <span className="text-(--accent) font-medium">
              +{wouldNum.toFixed(3)} SOL
            </span>
            <span className="text-[10px] text-(--fg-dim) tracking-[0.08em] uppercase inline-flex items-center gap-1">
              would&rsquo;ve earned
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="inline-grid place-items-center">
                    <CircleHelp
                      size={10}
                      strokeWidth={1.5}
                      className="text-(--fg-dim) cursor-help"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    Estimate based on mock data. Actual amounts depend on live
                    auction results.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </>
        ) : (
          <span className="text-(--fg-dim) font-medium text-base">-</span>
        )}
      </div>

      {/* External link */}
      <a
        href={`https://solscan.io/tx/${swap.signature}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-grid place-items-center text-(--fg-dim) transition-colors duration-150 hover:text-(--fg-muted)"
        onClick={(e) => e.stopPropagation()}
        title="View on Solscan"
      >
        <ExternalLink size={14} strokeWidth={1.5} />
      </a>
    </div>
  );
}

function MobileSwapRow({ swap }: { swap: AnalyzedSwap }) {
  const isBad = swap.mevType !== "clean";
  const typeColor = isBad ? MEV_TYPE_STYLES[swap.mevType].color : undefined;
  const lossNum = parseFloat(swap.estimatedLossToken);
  const wouldNum = parseFloat(swap.estimatedCashbackToken || "0");

  return (
    <div
      className={`mev-row grid gap-3 px-4 py-3.5 border-b border-(--line) transition-colors duration-150 ${
        isBad ? "cursor-pointer" : "cursor-default"
      }`}
      data-affected={isBad || undefined}
      style={
        {
          gridTemplateColumns: "1fr auto auto",
          gridTemplateAreas: `"pair pill loss" "amt amt amt" "meta meta link"`,
          ...(isBad
            ? {
                "--mev-type-color": typeColor,
                borderLeft: `2px solid ${typeColor}`,
                backgroundColor: `color-mix(in oklch, ${typeColor} 6%, transparent)`,
              }
            : {}),
        } as React.CSSProperties
      }
    >
      <div
        className="flex items-center gap-2.5 min-w-0"
        style={{ gridArea: "pair" }}
      >
        <span className="inline-flex">
          <TokenCircle symbol={swap.inputMint} />
          <span className="-ml-2">
            <TokenCircle symbol={swap.outputMint} />
          </span>
        </span>
        <span className="font-mono text-[13px] text-(--fg) inline-flex items-center gap-1.5">
          {swap.inputMint}
          <span className="text-(--fg-dim)">
            <svg
              viewBox="0 0 16 16"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </span>
          {swap.outputMint}
        </span>
      </div>

      <div style={{ gridArea: "pill" }} className="flex items-center gap-1.5">
        <MevBadge type={swap.mevType} />
        {isBad && <ConfidenceBadge level={swap.confidence} />}
      </div>

      <div
        style={{ gridArea: "loss" }}
        className="flex flex-col gap-0.5 text-right font-mono text-[13px] min-w-0"
      >
        {isBad ? (
          <>
            <span className="text-(--danger) font-medium">
              &minus;{lossNum.toFixed(3)} SOL
            </span>
            <span className="text-(--accent) font-medium inline-flex items-center gap-1">
              +{wouldNum.toFixed(3)} SOL
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="inline-grid place-items-center">
                    <CircleHelp
                      size={10}
                      strokeWidth={1.5}
                      className="text-(--fg-dim) cursor-help"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    Estimate based on mock data. Actual amounts depend on live
                    auction results.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </>
        ) : (
          <span className="text-(--fg-dim) font-medium text-base">-</span>
        )}
      </div>

      <div
        style={{ gridArea: "amt" }}
        className="flex gap-2 font-mono text-[12.5px] min-w-0"
      >
        <span className="text-(--fg)">
          {swap.inputAmount} {swap.inputMint}
        </span>
        <span className="text-(--fg-dim)">
          &rarr; {swap.actualOutputAmount} {swap.outputMint}
        </span>
      </div>

      <div
        style={{ gridArea: "meta" }}
        className="flex gap-3 font-mono text-xs min-w-0 items-center"
      >
        <span className="text-(--fg-muted)">{timeAgo(swap.timestamp)}</span>
        <span className="text-(--fg-dim) inline-flex items-center gap-1.5">
          {shortSig(swap.signature)}
          <CopyBtn text={swap.signature} />
        </span>
      </div>

      <div
        style={{ gridArea: "link" }}
        className="flex items-center justify-end"
      >
        <a
          href={`https://solscan.io/tx/${swap.signature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-grid place-items-center text-(--fg-dim) hover:text-(--fg-muted)"
          onClick={(e) => e.stopPropagation()}
          title="View on Solscan"
        >
          <ExternalLink size={14} strokeWidth={1.5} />
        </a>
      </div>
    </div>
  );
}

function EvidencePanel({ swap }: { swap: AnalyzedSwap }) {
  const lossNum = parseFloat(swap.estimatedLossToken);
  const frontrunSig =
    swap.signature.slice(0, 4) + "…" + swap.signature.slice(8, 12);
  const backrunSig =
    swap.signature.slice(4, 8) + "…" + swap.signature.slice(12, 16);

  return (
    <div className="px-6 py-5 border-t border-dashed border-(--line) grid gap-4">
      <div className="hidden md:grid grid-cols-[1fr_24px_1fr_24px_1fr] gap-3.5 items-center">
        <EvidenceCard
          role="Frontrun"
          variant="bot"
          pubkey={frontrunSig}
          slot={swap.slot}
          detail={{
            label: "impact",
            value: `+${Math.round(lossNum * 100)} bps`,
            bad: true,
          }}
        />
        <div className="ev-arrow" />
        <EvidenceCard
          role="Your swap"
          variant="you"
          pubkey={shortSig(swap.signature)}
          slot={swap.slot}
          detail={{ label: "price", value: "worsened", bad: true }}
        />
        <div className="ev-arrow" />
        <EvidenceCard
          role="Backrun"
          variant="bot"
          pubkey={backrunSig}
          slot={swap.slot}
          detail={{
            label: "profit",
            value: `+${lossNum.toFixed(3)} SOL`,
            bad: true,
          }}
        />
      </div>

      <div className="grid md:hidden gap-3">
        <EvidenceCard
          role="Frontrun"
          variant="bot"
          pubkey={frontrunSig}
          slot={swap.slot}
          detail={{
            label: "impact",
            value: `+${Math.round(lossNum * 100)} bps`,
            bad: true,
          }}
        />
        <EvidenceCard
          role="Your swap"
          variant="you"
          pubkey={shortSig(swap.signature)}
          slot={swap.slot}
          detail={{ label: "price", value: "worsened", bad: true }}
        />
        <EvidenceCard
          role="Backrun"
          variant="bot"
          pubkey={backrunSig}
          slot={swap.slot}
          detail={{
            label: "profit",
            value: `+${lossNum.toFixed(3)} SOL`,
            bad: true,
          }}
        />
      </div>

      <div className="text-[13.5px] leading-relaxed text-(--fg-muted) px-4 py-3.5 border-l border-dashed border-(--line-strong) tracking-[-0.005em]">
        A bot bought{" "}
        <b className="text-(--fg) font-medium">{swap.inputAmount}</b> of{" "}
        {swap.outputMint} in slot{" "}
        <b className="text-(--fg) font-medium">{swap.slot.toLocaleString()}</b>,
        your swap executed at a worsened price, then the bot sold in the same
        slot for{" "}
        <b className="text-(--fg) font-medium">{lossNum.toFixed(3)} SOL</b>{" "}
        profit at your expense.
      </div>
    </div>
  );
}

function EvidenceCard({
  role,
  variant,
  pubkey,
  slot,
  detail,
}: {
  role: string;
  variant: "bot" | "you";
  pubkey: string;
  slot: number;
  detail: { label: string; value: string; bad?: boolean };
}) {
  const isBot = variant === "bot";
  return (
    <Card
      className={`p-0 gap-0 ${
        isBot
          ? "bg-(--bg) ring-[color-mix(in_oklch,var(--danger)_25%,transparent)]"
          : "bg-(--bg-elev-2) ring-[var(--line-strong)]"
      }`}
    >
      <CardContent className="p-3.5 px-4 grid gap-2">
        <div
          className={`font-mono text-[10.5px] tracking-[0.08em] uppercase ${
            isBot ? "text-(--danger)" : "text-(--accent)"
          }`}
        >
          {role}
        </div>
        <div className="font-mono text-[12.5px] text-(--fg)">{pubkey}</div>
        <div className="flex justify-between font-mono text-[11.5px] text-(--fg-dim)">
          <span>slot</span>
          <span className="text-(--fg-muted)">{slot.toLocaleString()}</span>
        </div>
        <div className="flex justify-between font-mono text-[11.5px] text-(--fg-dim)">
          <span>{detail.label}</span>
          <span
            className={detail.bad ? "text-(--danger)" : "text-(--fg-muted)"}
          >
            {detail.value}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Sparkline({ data }: { data: MevAnalysisResult }) {
  const points = useMemo(() => {
    const lossy = data.swaps.filter(
      (s) => parseFloat(s.estimatedLossToken || "0") > 0,
    );
    if (lossy.length === 0) return Array(30).fill(0) as number[];

    const sorted = [...lossy].sort((a, b) => a.timestamp - b.timestamp);
    const oldest = sorted[0].timestamp;
    const newest = sorted[sorted.length - 1].timestamp;
    const rawSpan = newest - oldest;
    const DAY = 86_400;
    const span = Math.max(rawSpan, DAY);
    const buckets = Math.max(Math.min(Math.ceil(span / DAY), 90), 2);

    const pts: number[] = [];
    let cumulative = 0;

    for (let i = 0; i < buckets; i++) {
      const bucketStart = oldest + i * (span / buckets);
      const bucketEnd = oldest + (i + 1) * (span / buckets);
      for (const s of sorted) {
        const inBucket =
          i === 0
            ? s.timestamp >= bucketStart && s.timestamp <= bucketEnd
            : s.timestamp > bucketStart && s.timestamp <= bucketEnd;
        if (inBucket) {
          cumulative += parseFloat(s.estimatedLossToken || "0");
        }
      }
      pts.push(cumulative);
    }
    return pts;
  }, [data.swaps]);

  const W = 600;
  const H = 160;
  const pad = 6;
  const max = Math.max(...points, 0.001);

  const path = points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (W - pad * 2);
      const y = H - pad - (p / max) * (H - pad * 2);
      return (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    })
    .join(" ");

  const fillPath = `${path} L ${W - pad} ${H - pad} L ${pad} ${H - pad} Z`;

  const totalLoss = data.swaps.reduce(
    (sum, s) => sum + parseFloat(s.estimatedLossToken || "0"),
    0,
  );

  return (
    <>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block w-full h-40"
        >
          <path d={fillPath} fill="var(--accent-soft)" />
          <path
            d={path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="flex justify-between mt-2.5 font-mono text-[10.5px] tracking-[0.06em] uppercase text-(--fg-dim)">
        <span>oldest</span>
        <span>today</span>
      </div>
      <div className="flex justify-between items-baseline mt-3.5 pt-3.5 border-t border-dashed border-(--line)">
        <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-(--fg-dim)">
          Total
        </span>
        <span className="font-mono text-lg text-(--danger) font-medium">
          &minus;{totalLoss.toFixed(3)} SOL
        </span>
      </div>
    </>
  );
}

export function MevDashboard({
  data,
  onLoadMore,
}: {
  data: MevAnalysisResult;
  onLoadMore?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const scrollRef = useRef<HTMLDivElement>(null);

  const totalLostSol = useMemo(
    () =>
      data.swaps.reduce(
        (sum, s) => sum + parseFloat(s.estimatedLossToken || "0"),
        0,
      ),
    [data.swaps],
  );
  const totalWouldSol = data.flowbackWouldReturnSol;
  const solPriceUsd =
    data.flowbackWouldReturnSol > 0
      ? data.flowbackWouldReturnUsd / data.flowbackWouldReturnSol
      : data.totalEstimatedLossUsd > 0 && totalLostSol > 0
        ? data.totalEstimatedLossUsd / totalLostSol
        : SOL_PRICE_USD_FALLBACK;
  const usdLost = (totalLostSol * solPriceUsd).toFixed(2);

  const counts = useMemo(
    () => ({
      all: data.totalSwaps,
      sandwiched: data.breakdown.sandwiched,
      frontrun: data.breakdown.frontrun,
      backrun_target: data.breakdown.backrunTarget,
      clean: data.breakdown.clean,
    }),
    [data.totalSwaps, data.breakdown],
  );

  const affectedCount =
    counts.sandwiched + counts.frontrun + counts.backrun_target;
  const affectedPct =
    counts.all > 0 ? ((affectedCount / counts.all) * 100).toFixed(1) : "0.0";

  const swaps = useMemo(() => {
    let arr = [...data.swaps];
    if (tab !== "all") arr = arr.filter((s) => s.mevType === tab);
    if (sort === "loss")
      arr.sort(
        (a, b) =>
          parseFloat(b.estimatedLossToken || "0") -
          parseFloat(a.estimatedLossToken || "0"),
      );
    return arr;
  }, [data.swaps, tab, sort]);

  const virtualizer = useVirtualizer({
    count: swaps.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 10,
  });

  const topPairs = useMemo(() => {
    const maxLoss = Math.max(
      ...data.topPairsByLoss.map((p) => p.lossUsd),
      0.001,
    );
    return data.topPairsByLoss.slice(0, 5).map((p, i) => ({
      ...p,
      label: `${p.inputMint}/${p.outputMint}`,
      pct: (p.lossUsd / maxLoss) * 100,
      solLoss: p.lossUsd / solPriceUsd,
      worst: i === 0,
    }));
  }, [data.topPairsByLoss]);

  return (
    <div className="mt-14 grid gap-7">
      {/* Results header */}
      <div className="flex justify-between items-baseline gap-3 flex-wrap pb-4 border-b border-(--line)">
        <span className="font-mono text-[13px] text-(--fg) inline-flex items-center gap-2">
          {shortAddr(data.wallet)}
          <CopyBtn text={data.wallet} size={13} />
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-(--fg-dim)">
          {data.totalSwaps} swaps scanned &middot; {affectedCount} affected
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-(--bg-elev) ring-[var(--line)] p-0 gap-0">
          <CardContent className="p-7">
            <div className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-(--fg-dim) mb-4">
              Total lost to MEV
            </div>
            <div className="font-mono text-[clamp(32px,3.4vw,42px)] tracking-tight leading-none text-(--danger) font-medium">
              <span className="text-[0.65em] mr-1">&minus;</span>
              {totalLostSol.toFixed(3)}
              <span className="text-(--fg-dim) font-normal text-[0.55em] ml-2">
                SOL
              </span>
            </div>
            <div className="mt-2 font-mono text-[13px] text-(--fg-dim)">
              &asymp; ${usdLost}
            </div>
            <div className="mt-3.5 text-(--fg-muted) text-[13px] leading-relaxed max-w-[32ch]">
              Estimated against next-block reference price across all sandwiched
              trades.
            </div>
          </CardContent>
        </Card>

        <Card className="bg-(--bg-elev) ring-[var(--line)] p-0 gap-0">
          <CardContent className="p-7">
            <div className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-(--fg-dim) mb-4">
              Swaps affected
            </div>
            <div className="font-mono text-[clamp(32px,3.4vw,42px)] tracking-tight leading-none text-(--fg) font-medium">
              {affectedCount}
              <span className="text-(--fg-dim) font-normal text-[0.55em] ml-2">
                / {counts.all}
              </span>
            </div>
            <div className="mt-2 font-mono text-[13px] text-(--fg-dim)">
              {affectedPct}% of trades
            </div>
            <div className="mt-3.5 text-(--fg-muted) text-[13px] leading-relaxed max-w-[32ch]">
              Sandwiched, frontrun, or backrun target patterns detected in the
              same slot.
            </div>
          </CardContent>
        </Card>

        <Card className="bg-(--bg-elev) ring-[var(--line)] p-0 gap-0">
          <CardContent className="p-7">
            <div className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-(--fg-dim) mb-4 flex items-center gap-1.5">
              Estimated cashback
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="inline-grid place-items-center">
                    <CircleHelp
                      size={13}
                      strokeWidth={1.5}
                      className="text-(--fg-dim) cursor-help"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[240px]">
                    This is an estimate based on mock auction data. Actual
                    cashback amounts will vary once live auctions are running.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="font-mono text-[clamp(32px,3.4vw,42px)] tracking-tight leading-none text-(--accent) font-medium">
              <span className="text-[0.65em] mr-1">+</span>
              {totalWouldSol.toFixed(3)}
              <span className="text-(--fg-dim) font-normal text-[0.55em] ml-2">
                SOL
              </span>
            </div>
            <div className="mt-2 font-mono text-[13px] text-(--fg-dim)">
              &asymp; ${data.flowbackWouldReturnUsd.toFixed(2)}
            </div>
            <div className="mt-3.5 text-(--fg-muted) text-[13px] leading-relaxed max-w-[32ch]">
              {data.cashbackSampleSize > 0
                ? `Based on ${data.cashbackSampleSize} historical auction${data.cashbackSampleSize !== 1 ? "s" : ""} routed through FlowBack.`
                : "Estimated using FlowBack’s sealed-bid auction model."}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Swap list card */}
      <Card className="bg-(--bg-elev) ring-[var(--line)] p-0 gap-0 rounded-2xl">
        {/* List header */}
        <div className="flex justify-between items-center gap-4 px-5 py-4 border-b border-(--line) bg-(--bg-elev-2) rounded-t-2xl flex-wrap">
          <div className="inline-flex gap-1 bg-(--bg) border border-(--line) rounded-[9px] p-[3px] flex-wrap">
            {(
              [
                { key: "all" as Tab, label: "All", count: data.swaps.length },
                {
                  key: "sandwiched" as Tab,
                  label: "Sandwiched",
                  count: counts.sandwiched,
                },
                {
                  key: "frontrun" as Tab,
                  label: "Frontrun",
                  count: counts.frontrun,
                },
                {
                  key: "backrun_target" as Tab,
                  label: "Backrun",
                  count: counts.backrun_target,
                },
                { key: "clean" as Tab, label: "Clean", count: counts.clean },
              ] as const
            ).map(({ key, label, count }) => (
              <button
                key={key}
                data-active={tab === key}
                onClick={() => setTab(key)}
                className={`appearance-none border-0 font-sans text-[13px] font-medium px-3.5 py-1.5 rounded-md cursor-pointer transition-all duration-200 tracking-[-0.005em] inline-flex items-center gap-2 ${
                  tab === key
                    ? "bg-(--bg-elev-2) text-(--fg)"
                    : "bg-transparent text-(--fg-muted) hover:text-(--fg)"
                }`}
              >
                {label}
                <span
                  className={`font-mono text-[10.5px] ${
                    tab === key ? "text-(--fg-muted)" : "text-(--fg-dim)"
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          <select
            className="analyzer-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="newest">NEWEST</option>
            <option value="loss">LARGEST LOSS</option>
          </select>
        </div>

        {/* Virtualized swap rows */}
        <div
          ref={scrollRef}
          className="max-h-[600px] overflow-y-auto"
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            <Accordion className="analyzer-accordion">
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const s = swaps[virtualRow.index];
                return (
                  <div
                    key={s.signature}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                  >
                    <AccordionItem value={s.signature}>
                      <AccordionTrigger
                        className="w-full p-0 hover:no-underline rounded-none border-0 items-stretch"
                        data-clean={s.mevType === "clean" || undefined}
                      >
                        {/* Desktop row */}
                        <div className="hidden md:block w-full">
                          <SwapRowContent swap={s} />
                        </div>
                        {/* Mobile row */}
                        <div className="md:hidden w-full">
                          <MobileSwapRow swap={s} />
                        </div>
                      </AccordionTrigger>
                      {s.mevType !== "clean" && (
                        <AccordionContent className="p-0">
                          <EvidencePanel swap={s} />
                        </AccordionContent>
                      )}
                    </AccordionItem>
                  </div>
                );
              })}
            </Accordion>
          </div>
        </div>

        {/* Load more transactions from parent */}
        {onLoadMore && (
          <div className="px-5 py-4 border-t border-(--line) text-center">
            <Button
              onClick={onLoadMore}
              variant="outline"
              className="font-mono text-xs"
            >
              Load more transactions
            </Button>
          </div>
        )}
      </Card>

      {/* Breakdown charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-(--bg-elev) ring-[var(--line)] p-0 gap-0">
          <CardContent className="p-6">
            <div className="flex justify-between items-baseline mb-5">
              <h3 className="text-sm font-medium text-(--fg) tracking-[-0.01em]">
                Top loss by token pair
              </h3>
              <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-(--fg-dim)">
                SOL
              </span>
            </div>
            <div className="grid gap-3.5">
              {topPairs.map((pair) => (
                <div
                  key={pair.label}
                  className="grid items-center gap-3"
                  style={{ gridTemplateColumns: "80px 1fr auto" }}
                >
                  <span className="font-mono text-xs text-(--fg-muted)">
                    {pair.label}
                  </span>
                  <span className="h-2 bg-(--bg) border border-(--line) rounded-full overflow-hidden relative">
                    <span
                      className={`block h-full rounded-full ${
                        pair.worst ? "bg-(--danger)" : "bg-(--fg-dim)"
                      }`}
                      style={{ width: `${pair.pct}%` }}
                    />
                  </span>
                  <span
                    className={`font-mono text-xs ${
                      pair.worst ? "text-(--danger)" : "text-(--fg)"
                    }`}
                  >
                    {pair.solLoss.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-(--bg-elev) ring-[var(--line)] p-0 gap-0">
          <CardContent className="p-6">
            <div className="flex justify-between items-baseline mb-5">
              <h3 className="text-sm font-medium text-(--fg) tracking-[-0.01em]">
                Cumulative MEV loss
              </h3>
              <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-(--fg-dim)">
                SOL
              </span>
            </div>
            <Sparkline data={data} />
          </CardContent>
        </Card>
      </div>

      {/* Footer note */}
      <div className="mt-8 pt-6 border-t border-(--line) text-center text-(--fg-dim) text-[12.5px] leading-relaxed max-w-[720px] mx-auto">
        Results are estimates based on price deviation analysis. Swaps marked
        with high confidence closely match known MEV patterns. Medium confidence
        flags unusual price impact that may or may not be MEV. Losses are
        estimated against real-time market prices.
      </div>
    </div>
  );
}
