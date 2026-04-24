"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

function useInViewOnce(ref: RefObject<HTMLDivElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setSeen(true);
        });
      },
      { threshold: 0.25 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

function useTick(active: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return t;
}

type NodeKey = "user" | "auction" | "bundle" | "cashback";

type NodePos = { x: number; y: number; label: string; sub: string };

export function HeroDiagram() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInViewOnce(wrapRef);
  const t = useTick(inView);
  const cycle = 4.2;
  const phase = (t % cycle) / cycle;
  const cycleCount = Math.floor(t / cycle);
  const baseLamports =
    12470000 +
    cycleCount * 2310 +
    Math.floor((phase > 0.9 ? (phase - 0.9) * 10 : 0) * 487);
  const display = inView ? baseLamports : 12470000;
  return (
    <DiagramA
      wrapRef={wrapRef}
      phase={phase}
      inView={inView}
      display={display}
      t={t}
    />
  );
}

type Seg = {
  a: NodeKey;
  b: NodeKey;
  from: number;
  to: number;
};

function DiagramA({
  wrapRef,
  phase,
  inView,
  display,
  t,
}: {
  wrapRef: RefObject<HTMLDivElement | null>;
  phase: number;
  inView: boolean;
  display: number;
  t: number;
}) {
  const W = 400;
  const H = 400;
  const nodes: Record<NodeKey, NodePos> = {
    user: { x: 60, y: 210, label: "USER", sub: "wallet" },
    auction: { x: 200, y: 120, label: "AUCTION", sub: "200ms sealed bid" },
    bundle: { x: 340, y: 210, label: "BUNDLE", sub: "jitodontfront" },
    cashback: { x: 200, y: 310, label: "CASHBACK", sub: "90% of backrun" },
  };
  const segs: Seg[] = [
    { a: "user", b: "auction", from: 0.0, to: 0.28 },
    { a: "auction", b: "bundle", from: 0.28, to: 0.55 },
    { a: "bundle", b: "cashback", from: 0.55, to: 0.75 },
    { a: "cashback", b: "user", from: 0.75, to: 1.0 },
  ];
  const activeNode: NodeKey =
    phase < 0.28
      ? "user"
      : phase < 0.55
        ? "auction"
        : phase < 0.75
          ? "bundle"
          : "cashback";
  const seg = segs.find((s) => phase >= s.from && phase <= s.to) ?? segs[0];
  const segT = (phase - seg.from) / (seg.to - seg.from);
  const a = nodes[seg.a];
  const b = nodes[seg.b];
  const pkt = {
    x: a.x + (b.x - a.x) * segT,
    y: a.y + (b.y - a.y) * segT,
  };
  const auctionActive = phase >= 0.25 && phase <= 0.58;
  const orbitPhase = (t * 1.8) % 1;

  return (
    <div
      className="diagram-frame reveal"
      ref={wrapRef}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(12px)",
      }}
    >
      <div className="hdr">
        <span>flowback / live</span>
        <span className="live">streaming</span>
      </div>

      <svg
        className="diagram-canvas"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="100%"
        style={{ display: "block" }}
      >
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        <g opacity="0.35">
          {Array.from({ length: 9 }).map((_, r) =>
            Array.from({ length: 9 }).map((_, c) => (
              <circle
                key={`${r}-${c}`}
                cx={40 + c * 40}
                cy={40 + r * 40}
                r="0.8"
                fill="var(--line-strong)"
              />
            )),
          )}
        </g>

        {segs.map((s, i) => {
          const na = nodes[s.a];
          const nb = nodes[s.b];
          const traveled = phase >= s.from;
          return (
            <g key={i}>
              <line
                x1={na.x}
                y1={na.y}
                x2={nb.x}
                y2={nb.y}
                stroke="var(--line-strong)"
                strokeWidth="1"
                strokeDasharray="3 4"
              />
              {traveled && phase <= s.to && (
                <line
                  x1={na.x}
                  y1={na.y}
                  x2={pkt.x}
                  y2={pkt.y}
                  stroke="var(--accent)"
                  strokeWidth="1.2"
                  opacity="0.6"
                />
              )}
            </g>
          );
        })}

        {auctionActive && (
          <g>
            <circle
              cx={nodes.auction.x}
              cy={nodes.auction.y}
              r="46"
              fill="url(#glow)"
              opacity="0.5"
            />
            <circle
              cx={nodes.auction.x}
              cy={nodes.auction.y}
              r="38"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1"
              opacity="0.45"
              strokeDasharray="4 6"
              style={{
                transformOrigin: `${nodes.auction.x}px ${nodes.auction.y}px`,
                transform: `rotate(${(t * 60) % 360}deg)`,
              }}
            />
            {[0, 0.33, 0.66].map((o, i) => {
              const ang = (orbitPhase + o) * Math.PI * 2;
              return (
                <circle
                  key={i}
                  r="2.2"
                  fill="var(--accent)"
                  cx={nodes.auction.x + Math.cos(ang) * 30}
                  cy={nodes.auction.y + Math.sin(ang) * 30}
                  opacity={0.4 + 0.6 * Math.abs(Math.cos(ang))}
                />
              );
            })}
          </g>
        )}

        {(Object.entries(nodes) as [NodeKey, NodePos][]).map(([k, n]) => {
          const isActive = k === activeNode;
          return (
            <g key={k}>
              <circle
                cx={n.x}
                cy={n.y}
                r={isActive ? 28 : 22}
                fill={isActive ? "var(--accent-soft)" : "var(--bg-elev-2)"}
                stroke={isActive ? "var(--accent)" : "var(--line-strong)"}
                strokeWidth="1"
                style={{
                  transition: "r .3s ease, fill .3s ease, stroke .3s ease",
                }}
              />
              <circle
                cx={n.x}
                cy={n.y}
                r="3"
                fill={isActive ? "var(--accent)" : "var(--fg-dim)"}
                style={{ transition: "fill .3s ease" }}
              />
              <text
                x={n.x}
                y={n.y + 45}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="9.5"
                letterSpacing="1"
                fill="var(--fg)"
                fontWeight="500"
              >
                {n.label}
              </text>
              <text
                x={n.x}
                y={n.y + 58}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="8.5"
                fill="var(--fg-dim)"
              >
                {n.sub}
              </text>
            </g>
          );
        })}

        <g>
          <circle cx={pkt.x} cy={pkt.y} r="8" fill="url(#glow)" />
          <circle cx={pkt.x} cy={pkt.y} r="3" fill="var(--accent)" />
        </g>

        {phase > 0.75 && (
          <g opacity={Math.min(1, (phase - 0.75) * 4)}>
            <text
              x={pkt.x + 14}
              y={pkt.y + 4}
              fontFamily="var(--font-mono)"
              fontSize="10"
              fill="var(--accent)"
              fontWeight="500"
            >
              +0.0038 SOL
            </text>
          </g>
        )}
      </svg>

      <div className="ftr">
        <span>lamports returned</span>
        <span
          style={{ color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}
        >
          {display.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
