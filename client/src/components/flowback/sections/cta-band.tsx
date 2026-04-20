"use client";

import { Icon } from "../icons";

export function CTABand() {
  return (
    <section className="section" id="cta">
      <div className="container">
        <div className="cta-band">
          <div>
            <h2>Start earning back what&apos;s yours.</h2>
            <p>Join the waitlist — Devnet is launching soon.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btn btn-primary" aria-disabled="true" href="#">
              Launch App <span className="soon-tag">soon</span>
            </a>
            <a className="btn btn-ghost" href="#">
              Read the docs <Icon.Arrow />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
