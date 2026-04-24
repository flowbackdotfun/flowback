"use client";

import { useState } from "react";

const items = [
  {
    q: "Is FlowBack safe to use?",
    a: "Yes. You sign the exact same Jupiter-routed transaction you would sign going direct. FlowBack never custodies your funds. The rebate program is an on-chain Anchor program — audited, verifiable. If our relayer goes down, your wallet falls back to a normal Jupiter submission.",
  },
  {
    q: "What if no searcher bids on my swap?",
    a: "Your swap lands exactly as it would have on Jupiter. No bid means no rebate, but no penalty either — you never pay anything for using FlowBack.",
  },
  {
    q: "Can the auction fail and cost me execution?",
    a: "No. The auction runs in parallel with transaction preparation. If it times out (200ms hard cap), the bundle ships without a backrun. The user-facing path is identical either way.",
  },
  {
    q: "Is my swap output ever worse than going to Jupiter directly?",
    a: "No. We use Jupiter v6 routing unchanged. The cashback is pure upside on top of the same execution quality you\u2019d get from the Jupiter frontend. Same input, same output, plus a rebate.",
  },
  {
    q: "Do I need to approve a new program or stake anything?",
    a: "No approvals, no staking, no token. You sign each swap the same way you do today. There is no FlowBack token — we're a protocol, funded by a small sliver (10%) of the winning bid.",
  },
];

export function FAQSection() {
  const [open, setOpen] = useState(0);

  return (
    <section className="section" id="faq">
      <div className="container faq-grid">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" />
            FAQs
          </span>
        </div>
        <div className="faq-list">
          {items.map((item, i) => (
            <div className="faq-item" key={i} data-open={open === i}>
              <button
                type="button"
                className="faq-q"
                onClick={() => setOpen(open === i ? -1 : i)}
              >
                <span>{item.q}</span>
                <span className="plus" />
              </button>
              <div className="faq-a">{item.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
