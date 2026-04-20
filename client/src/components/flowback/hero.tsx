"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/lib/hooks/use-in-view";
import { Icon } from "./icons";
import { HeroDiagram } from "./hero-diagram";

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  const [counter, setCounter] = useState(128_471_284);

  useEffect(() => {
    const id = setInterval(() => {
      setCounter((c) => c + Math.floor(Math.random() * 4800 + 1200));
    }, 1100);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="hero">
      <div className="hero-grid" />
      <div className="hero-bg" />
      <div className="container">
        <div className="hero-inner">
          <div
            className="hero-copy reveal"
            ref={ref}
            style={{
              opacity: seen ? 1 : 0,
              transform: seen ? "none" : "translateY(12px)",
            }}
          >
            <span className="eyebrow">
              <span className="dot" />
              v0.3 · Solana devnet
            </span>
            <h1>
              MEV belongs to <span className="accent">the trader</span>, not the
              bot.
            </h1>
            <p className="sub">
              FlowBack runs a 200 ms sealed-bid auction before every swap lands
              on Solana. Searchers compete to backrun you;{" "}
              <b>90% of the winning bid is rebated as SOL</b>
              in the same block — same Jupiter-routed output, plus cashback.
            </p>
            <div className="hero-ctas">
              <a className="btn btn-primary" aria-disabled="true" href="#">
                Launch App <Icon.Arrow /> <span className="soon-tag">soon</span>
              </a>
              <a className="btn btn-ghost" href="#">
                Read the docs
              </a>
            </div>
            <div className="hero-meta">
              <div>
                <div className="stat-label">Lamports returned · all time</div>
                <div className="stat-value">
                  {counter.toLocaleString()}
                  <span className="unit">lamports</span>
                </div>
              </div>
              <div>
                <div className="stat-label">Auction window</div>
                <div className="stat-value">
                  200<span className="unit">ms</span>
                </div>
              </div>
              <div>
                <div className="stat-label">Rebate share</div>
                <div className="stat-value">
                  90<span className="unit">%</span>
                </div>
              </div>
            </div>
          </div>
          <div>
            <HeroDiagram />
          </div>
        </div>
      </div>
    </section>
  );
}
