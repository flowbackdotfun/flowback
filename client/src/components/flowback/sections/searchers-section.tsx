"use client";

import { useEffect, useState } from "react";

const bids: [string, string][] = [
  ["9kF8…ePQ2", "0.0018"],
  ["A1pX…m9Wq", "0.0034"],
  ["7bNh…cR5z", "0.0029"],
  ["3vYT…kL8e", "0.0041"],
  ["dG4s…qN2m", "0.0026"],
];
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3001";

export function SearchersSection() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 2600);
    return () => clearInterval(id);
  }, []);

  const winner = tick % bids.length;
  const sorted = [...bids]
    .map((b, i) => ({ addr: b[0], amt: parseFloat(b[1]), win: i === winner }))
    .sort((a, b) => b.amt - a.amt);

  return (
    <section className="section" id="searchers">
      <div className="container">
        <div className="searchers">
          <div className="searchers-copy">
            <span className="eyebrow">
              <span className="dot" />
              For searchers
            </span>
            <h2 style={{ marginTop: 18 }}>Bid once. Win the whole backrun.</h2>
            <p>
              A private, sealed-bid market for Solana backrun rights. No mempool
              racing, no priority-fee wars, no sniping. Price your bid at what
              the opportunity is worth — the second-price mechanic keeps it
              honest.
            </p>
            <ul className="searchers-bullets">
              <li>
                Exclusive backrun rights on every winning trade
                <span className="k">no racing, no reverts</span>
              </li>
              <li>
                Sealed bids, second-price settlement
                <span className="k">honest pricing by construction</span>
              </li>
              <li>
                Post-trade proofs for every fill
                <span className="k">auditable by bidders and users</span>
              </li>
            </ul>
            <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
              <a className="btn btn-ghost btn-sm" href={DOCS_URL}>
                Read searcher docs
              </a>
            </div>
          </div>
          <div className="searchers-panel">
            <h4>Auction window · 200ms</h4>
            {sorted.map((b) => (
              <div
                className={"bid-row" + (b.win ? " winner" : "")}
                key={b.addr}
              >
                <span className="addr">{b.addr}</span>
                <span>
                  <span className="amt">{b.amt.toFixed(4)} SOL</span>
                  {b.win && <span className="tag">win</span>}
                </span>
              </div>
            ))}
            <div
              style={{
                marginTop: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--fg-dim)",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>slot 287,418,{200 + tick}</span>
              <span>settled · 90% to user</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
