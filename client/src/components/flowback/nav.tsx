"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { BrandMark, Icon } from "./icons";
import type { FlowTheme } from "./types";

type NavProps = {
  theme: FlowTheme;
  onToggleTheme: () => void;
};

export function Nav({ onToggleTheme, theme }: NavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const blurredSurfaceStyle: CSSProperties = {
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 760) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const close = () => setMenuOpen(false);

  return (
    <nav className="nav" data-scrolled={scrolled} style={blurredSurfaceStyle}>
      <div className="nav-inner">
        <a href="#" className="brand">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span>FlowBack</span>
        </a>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#searchers">Searchers</a>
          <a href="#compare">Compare</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="nav-right">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            title="Toggle theme"
          >
            {theme === "dark" ? <Icon.Sun /> : <Icon.Moon />}
          </button>
          <a
            className="btn btn-primary btn-sm launch-full"
            aria-disabled="true"
            href="#"
          >
            Launch App <span className="soon-tag">soon</span>
          </a>
          <button
            type="button"
            className="nav-burger"
            aria-expanded={menuOpen}
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <div
          className="nav-drawer"
          data-open={menuOpen}
          style={blurredSurfaceStyle}
        >
          <a href="#how" onClick={close}>
            How it works
          </a>
          <a href="#searchers" onClick={close}>
            Searchers
          </a>
          <a href="#compare" onClick={close}>
            Compare
          </a>
          <a href="#faq" onClick={close}>
            FAQ
          </a>
          <a
            className="btn btn-primary btn-sm launch-full text-black!"
            aria-disabled="true"
            href="#"
          >
            Launch App <span className="soon-tag">soon</span>
          </a>
        </div>
      </div>
    </nav>
  );
}
