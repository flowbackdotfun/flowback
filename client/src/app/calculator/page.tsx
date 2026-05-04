"use client";

import { useEffect, useRef, useState } from "react";
import { Nav } from "@/components/flowback/nav";
import { MevAnalyzer } from "@/components/flowback/mev-analyzer";
import type { FlowTheme } from "@/components/flowback/types";

export default function CalculatorPage() {
  const [theme, setTheme] = useState<FlowTheme>("dark");
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
      <main>
        <MevAnalyzer />
      </main>
    </div>
  );
}
