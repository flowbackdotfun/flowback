"use client";

import Link from "next/link";
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
            <Link
              href={
                process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3001/docs"
              }
            >
              Docs
            </Link>
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
