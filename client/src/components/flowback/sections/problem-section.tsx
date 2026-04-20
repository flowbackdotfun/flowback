"use client";

import { useId, useRef } from "react";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { useInView } from "@/lib/hooks/use-in-view";

function StatCard({
  eyebrow,
  target,
  format,
  unit,
  caption,
  sparkPath,
  decimals = 0,
  prefix = "",
}: {
  eyebrow: string;
  target: number;
  format?: (v: number) => string;
  unit?: string;
  caption?: string;
  sparkPath?: string;
  decimals?: number;
  prefix?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  const val = useCountUp(target, { active: seen, decimals });
  const display = format ? format(val) : val.toLocaleString();
  const gradId = useId().replace(/:/g, "");

  return (
    <div
      className="stat-card reveal"
      ref={ref}
      style={{
        opacity: seen ? 1 : 0,
        transform: seen ? "none" : "translateY(12px)",
      }}
    >
      <div className="k">{eyebrow}</div>
      <div className="v">
        <span>
          {prefix}
          {display}
        </span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {caption && <div className="caption">{caption}</div>}
      {sparkPath && (
        <svg className="spark" viewBox="0 0 200 34" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`${sparkPath} L200,34 L0,34 Z`}
            fill={`url(#${gradId})`}
            opacity={seen ? 1 : 0}
            style={{ transition: "opacity .8s ease .4s" }}
          />
          <path
            d={sparkPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.2"
            strokeDasharray="400"
            strokeDashoffset={seen ? 0 : 400}
            style={{ transition: "stroke-dashoffset 1.6s ease .3s" }}
          />
        </svg>
      )}
    </div>
  );
}

export function ProblemSection() {
  return (
    <section className="section" id="problem">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" />
            The problem
          </span>
          <h2>
            Every day, Solana traders lose money to bots they can&apos;t see.
          </h2>
          <p>
            MEV isn&apos;t an abstraction. It&apos;s the difference between the
            quote you saw and the price you got — skimmed by searchers, routed
            through private lanes, and paid back to no one.
          </p>
        </div>
        <div className="stats-row">
          <StatCard
            eyebrow="MEV extracted on Solana / 30d"
            target={41.8}
            prefix="$"
            unit="M"
            decimals={1}
            format={(v) => v.toFixed(1)}
            caption="Aggregate value captured by searchers across major Solana DEX volume, trailing 30 days."
            sparkPath="M0,28 L20,22 L40,25 L60,18 L80,21 L100,14 L120,16 L140,10 L160,12 L180,6 L200,8"
          />
          <StatCard
            eyebrow="Median sandwich loss / trade"
            target={0.42}
            unit="%"
            decimals={2}
            format={(v) => v.toFixed(2)}
            caption="On sandwich-affected swaps above $1k. Peaks above 1.1% on low-liquidity pairs."
            sparkPath="M0,18 L25,20 L50,15 L75,24 L100,16 L125,22 L150,12 L175,19 L200,14"
          />
          <StatCard
            eyebrow="Returned to users today"
            target={0}
            unit="SOL"
            caption="Existing tooling captures MEV for searchers and builders. Users see none of it."
            sparkPath="M0,30 L40,30 L80,30 L120,30 L160,30 L200,30"
          />
        </div>
      </div>
    </section>
  );
}
