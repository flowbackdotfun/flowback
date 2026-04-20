"use client";

const logos = ["Solana", "Jupiter", "Jito", "Anchor"];

export function BuiltOnSection() {
  return (
    <section className="section" id="built-on">
      <div className="container">
        <div className="section-head" style={{ marginBottom: 40 }}>
          <span className="eyebrow">
            <span className="dot" />
            Built on
          </span>
          <h2>Standing on Solana&apos;s shoulders.</h2>
        </div>
        <div className="built-on">
          {logos.map((l) => (
            <div className="logo-tile" key={l}>
              <div className="ph" />
              <div className="name">{l}</div>
            </div>
          ))}
        </div>
        <p
          style={{
            marginTop: 20,
            color: "var(--fg-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          Placeholder wordmarks. Production build swaps in real brand marks with
          permission.
        </p>
      </div>
    </section>
  );
}
