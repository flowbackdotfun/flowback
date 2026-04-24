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
            <span style={{ fontWeight: 500 }}>
              FlowBack{" "}
              <span className="ml-1 text-xs text-muted-foreground">
                © 2026 FlowBack
              </span>
            </span>
          </div>
          <div className="footer-links">
            <a href="#">Docs</a>
            <a href="https://github.com/flowbackdotfun/flowback">GitHub</a>
            <a href="https://x.com/flowbackdotfun" target="_blank">
              X / Twitter
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
