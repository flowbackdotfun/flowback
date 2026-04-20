"use client";

import { Icon } from "../icons";

const steps = [
  {
    n: "01",
    t: "~50ms",
    title: "Sign intent",
    icon: "Signature" as const,
    body: "One signature on your Jupiter-routed swap. We forward the transaction to the FlowBack relayer — nothing leaks to the public mempool.",
    detail: "ed25519 · versioned tx",
  },
  {
    n: "02",
    t: "200ms",
    title: "Sealed-bid auction",
    icon: "Auction" as const,
    body: "Searchers bid for exclusive backrun rights. Bids stay sealed until the window closes; honest bidders price at their true expected profit.",
    detail: "fixed window · highest bid wins",
  },
  {
    n: "03",
    t: "~150ms",
    title: "Bundle lands",
    icon: "Bundle" as const,
    body: "Your swap and the winning backrun ship as one Jito bundle with jitodontfront. Nothing can land before yours. Same execution as going direct.",
    detail: "jito bundle · slot +1",
  },
  {
    n: "04",
    t: "same block",
    title: "Cashback on-chain",
    icon: "Cashback" as const,
    body: "90% of the winning bid is transferred to your wallet by the rebate program in the same block. Visible before you leave the page.",
    detail: "on-chain · program-signed",
  },
];

export function HowItWorksSection() {
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" />
            How it works
          </span>
          <h2>Four steps. Roughly 400 milliseconds. Every swap.</h2>
        </div>
        <div className="flow">
          {steps.map((s) => {
            const Ico = Icon[s.icon];
            return (
              <div className="step reveal-child" key={s.n}>
                <div className="num">
                  <span>{s.n} / STEP</span>
                  <span className="t">{s.t}</span>
                </div>
                <div className="icon-wrap">
                  <Ico />
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <div className="detail">{s.detail}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
