"use client";

import Link from "next/link";

export function CTABand() {
  return (
    <section className="section" id="cta">
      <div className="container">
        <div className="cta-band">
          <div>
            <h2>Start earning back what&apos;s yours.</h2>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href="/swap">
              Launch App
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
