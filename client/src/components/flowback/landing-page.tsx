"use client";

import { useEffect, useRef, useState } from "react";
import { Nav } from "./nav";
import { Hero } from "./hero";
import {
  BuiltOnSection,
  ComparisonSection,
  CTABand,
  FAQSection,
  Footer,
  HowItWorksSection,
  ProblemSection,
  SearchersSection,
} from "./sections";
import type { FlowTheme } from "./types";

export function LandingPage() {
  const [theme, setTheme] = useState<FlowTheme>("dark");
  const skipFirstThemeApply = useRef(true);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") {
      setTheme(attr);
    }
    document.documentElement.style.setProperty("--grain-opacity", "0");

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => {
      setTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onSystemThemeChange);
    return () => mq.removeEventListener("change", onSystemThemeChange);
  }, []);

  useEffect(() => {
    if (skipFirstThemeApply.current) {
      skipFirstThemeApply.current = false;
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.setProperty("--grain-opacity", "0");
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  return (
    <>
      <Nav onToggleTheme={toggleTheme} theme={theme} />
      <main>
        <Hero />
        <ProblemSection />
        <HowItWorksSection />
        <SearchersSection />
        <ComparisonSection />
        <BuiltOnSection />
        <FAQSection />
        <CTABand />
      </main>
      <Footer />
    </>
  );
}
