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
            <button
              type="button"
              className="btn btn-primary"
              disabled
              aria-disabled="true"
            >
              Launch App <span className="soon-tag">soon</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
