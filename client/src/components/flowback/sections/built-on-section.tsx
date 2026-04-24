"use client";

import Image from "next/image";

const logos = [
  { name: "Solana", src: "/logos/solana.svg" },
  { name: "Jupiter", src: "/logos/Jupiter.png" },
  { name: "Jito", src: "/logos/Jito-dark.png", className: "logo-img logo-jito" },
  { name: "Anchor", src: "/logos/Anchor.png" },
] as const;

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
            <div className="logo-tile" key={l.name}>
              <Image
                src={l.src}
                alt={l.name}
                width={200}
                height={80}
                className={"className" in l ? l.className : "logo-img"}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
