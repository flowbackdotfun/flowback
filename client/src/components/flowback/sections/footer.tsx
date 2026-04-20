"use client";

import { BrandMark } from "../icons";

export function Footer() {
  return (
    <footer>
      <div className="container">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="brand-mark">
              <BrandMark />
            </span>
            <span style={{ fontWeight: 500 }}>FlowBack</span>
            <span
              style={{
                color: "var(--fg-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.04em",
                marginLeft: 8,
              }}
            >
              MEV, returned.
            </span>
          </div>
          <div className="footer-links">
            <a href="#">Docs</a>
            <a href="#">GitHub</a>
            <a href="https://x.com/flowbackdotfun" target="_blank">
              X / Twitter
            </a>
          </div>
        </div>
        <div className="footer-small">
          <span>© 2026 FlowBack Labs · Fair launch, no token, no pre-sale</span>
          <span>v0.3.0-devnet</span>
        </div>
      </div>
    </footer>
  );
}
