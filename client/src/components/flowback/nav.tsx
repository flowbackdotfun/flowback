"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { BrandMark, Icon } from "./icons";
import type { FlowTheme } from "./types";

type NavProps = {
  theme: FlowTheme;
  onToggleTheme: () => void;
};

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3001";

export function Nav({ onToggleTheme, theme }: NavProps) {
  const pathname = usePathname();
  const { connected, publicKey, disconnect, wallets, select } = useWallet();
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
  const onSwapPage = pathname === "/swap";
  const shortWallet = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : "";

  const connectWallet = () => {
    const preferred =
      wallets.find(
        (w) => w.readyState === "Installed" || w.readyState === "Loadable",
      ) ?? wallets[0];
    if (preferred) select(preferred.adapter.name);
  };

  const handleSwapCta = () => {
    if (connected) {
      disconnect();
      return;
    }
    connectWallet();
  };

  return (
    <nav className="nav" data-scrolled={scrolled} style={blurredSurfaceStyle}>
      <div className="nav-inner">
        <Link href="/" className="brand" onClick={close}>
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span>FlowBack</span>
        </Link>
        <div className="nav-links">
          {!onSwapPage ? (
            <>
              <a href="#how">How it works</a>
              <a href="#searchers">Searchers</a>
              <a href="#compare">Compare</a>
              <a href="#faq">FAQ</a>
              <a href={DOCS_URL}>Docs</a>
            </>
          ) : null}
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
          {onSwapPage ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm launch-full"
              onClick={handleSwapCta}
              title={connected ? "Disconnect wallet" : "Connect wallet"}
            >
              {connected ? (
                <>
                  <span
                    className="size-2 rounded-full bg-(--accent)"
                    style={{ boxShadow: "0 0 10px var(--accent-glow)" }}
                  />
                  {shortWallet}
                </>
              ) : (
                "Connect Wallet"
              )}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm launch-full"
              disabled
              aria-disabled="true"
            >
              Launch App <span className="soon-tag">soon</span>
            </button>
          )}
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
          {!onSwapPage ? (
            <>
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
              <a href={DOCS_URL} onClick={close}>
                Docs
              </a>
            </>
          ) : null}
          {onSwapPage ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm launch-full"
              onClick={() => {
                close();
                handleSwapCta();
              }}
              title={connected ? "Disconnect wallet" : "Connect wallet"}
            >
              {connected ? (
                <>
                  <span
                    className="size-2 rounded-full bg-(--accent)"
                    style={{ boxShadow: "0 0 10px var(--accent-glow)" }}
                  />
                  {shortWallet}
                </>
              ) : (
                "Connect Wallet"
              )}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm nav-button"
              disabled
              aria-disabled="true"
            >
              Launch App <span className="soon-tag">soon</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
