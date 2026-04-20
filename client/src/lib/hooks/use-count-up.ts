"use client";

import { useEffect, useRef, useState } from "react";

export function useCountUp(
  target: number,
  {
    duration = 1800,
    start = 0,
    active = true,
    decimals = 0,
  }: {
    duration?: number;
    start?: number;
    active?: boolean;
    decimals?: number;
  } = {},
): number {
  const [v, setV] = useState(start);
  const started = useRef(false);
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    const t0 = performance.now();
    let raf: number;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setV(start + (target - start) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration, start]);
  return decimals === 0 ? Math.round(v) : Number(v.toFixed(decimals));
}
