"use client";

import { useEffect, useRef, useState } from "react";
import { Nav } from "@/components/flowback/nav";
import { SwapCard } from "@/components/flowback/swap-card";
import { CashbackToast } from "@/components/flowback/cashback-toast";
import type { FlowTheme } from "@/components/flowback/types";

type Toast = { lamports: string; sig: string; id: number };

export default function SwapPage() {
  const [theme, setTheme] = useState<FlowTheme>("dark");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const skipFirst = useRef(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const attr = document.documentElement.getAttribute("data-theme");
      setTheme(
        attr === "light" || attr === "dark" ? attr : mq.matches ? "dark" : "light",
      );
    };
    const raf = requestAnimationFrame(sync);
    const onSystemThemeChange = () => setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onSystemThemeChange);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-(--bg)">
      <Nav
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />

      <main className="swap-page">
        <div className="hero-bg" />
        <div className="hero-grid" />
        <SwapCard
          onCashback={(lamports: string, sig: string) =>
            setToasts((p) => [...p, { lamports, sig, id: Date.now() }])
          }
        />
      </main>

      <div className="fixed bottom-7 right-7 z-300 flex flex-col-reverse gap-3">
        {toasts.map((t) => (
          <CashbackToast
            key={t.id}
            lamports={t.lamports}
            txSignature={t.sig}
            onDismiss={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
          />
        ))}
      </div>
    </div>
  );
}
