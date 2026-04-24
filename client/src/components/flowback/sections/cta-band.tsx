"use client";

export function CTABand() {
  return (
    <section className="section" id="cta">
      <div className="container">
        <div className="cta-band">
          <div>
            <h2>Start earning back what&apos;s yours.</h2>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btn btn-primary" aria-disabled="true" href="#">
              Launch App <span className="soon-tag">soon</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
