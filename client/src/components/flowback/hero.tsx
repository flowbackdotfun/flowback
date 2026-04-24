"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useInView } from "@/lib/hooks/use-in-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "./icons";
import { HeroDiagram } from "./hero-diagram";

interface WaitlistResponse {
  email: string;
  name: string | null;
  alreadyJoined: boolean;
}

interface WaitlistErrorResponse {
  reason?: string;
  error?: string;
}

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  const [counter, setCounter] = useState(128_471_284);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WaitlistResponse | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setCounter((c) => c + Math.floor(Math.random() * 4800 + 1200));
    }, 1100);
    return () => clearInterval(id);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | WaitlistResponse
        | WaitlistErrorResponse
        | null;

      if (!response.ok) {
        const reason =
          payload && "reason" in payload ? payload.reason : undefined;
        throw new Error(reason || "Could not join the waitlist.");
      }

      setResult(payload as WaitlistResponse);
      setName("");
      setEmail("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not join the waitlist.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDialogChange(open: boolean) {
    setIsDialogOpen(open);
    if (!open) {
      setError(null);
      setResult(null);
    }
  }

  return (
    <>
      <section className="hero">
        <div className="hero-grid" />
        <div className="hero-bg" />
        <div className="container">
          <div className="hero-inner">
            <div
              className="hero-copy reveal"
              ref={ref}
              style={{
                opacity: seen ? 1 : 0,
                transform: seen ? "none" : "translateY(12px)",
              }}
            >
              <span className="eyebrow">
                <span className="dot" />
                MEV redistribution on Solana
              </span>
              <h1>
                MEV belongs to <span className="accent">the trader</span>, not
                the bot.
              </h1>
              <p className="sub">
                FlowBack runs a 200 ms sealed-bid auction before every swap
                lands on Solana. Searchers compete to backrun you;{" "}
                <b>90% of the winning bid is rebated as SOL </b>
                in the same block and same Jupiter routed output, plus cashback.
              </p>
              <div className="hero-ctas">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => setIsDialogOpen(true)}
                >
                  Join Waitlist <Icon.Arrow />
                </button>
              </div>
              <div className="hero-meta">
                <div>
                  <div className="stat-label">Lamports returned · all time</div>
                  <div className="stat-value">
                    {counter.toLocaleString()}
                    <span className="unit">lamports</span>
                  </div>
                </div>
                <div>
                  <div className="stat-label">Auction window</div>
                  <div className="stat-value">
                    200<span className="unit">ms</span>
                  </div>
                </div>
                <div>
                  <div className="stat-label">Rebate share</div>
                  <div className="stat-value">
                    90<span className="unit">%</span>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <HeroDiagram />
            </div>
          </div>
        </div>
      </section>

      <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="gap-5 border-border/70 bg-background/95 p-5 shadow-xl shadow-black/8 supports-backdrop-filter:bg-background/90 sm:max-w-120 sm:rounded-2xl sm:p-6">
          <DialogHeader className="gap-3 pr-8">
            <DialogTitle className="text-[1.9rem]! leading-[0.96]! tracking-[-0.045em] sm:text-[2rem]! sm:whitespace-nowrap">
              Join the FlowBack waitlist
            </DialogTitle>
            <DialogDescription className="max-w-[37ch] text-[0.95rem] leading-6 text-muted-foreground/90">
              Be the first to access cashback-enabled swaps.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/35 p-4">
                <p className="text-sm font-medium text-foreground">
                  {result.alreadyJoined
                    ? "You’re already on the list."
                    : "You’re on the list."}
                </p>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  We’ll reach out at{" "}
                  <span className="text-foreground">{result.email}</span> when
                  access opens.
                </p>
              </div>
              <Button
                className="h-11 w-full rounded-xl text-sm font-semibold shadow-none"
                size="lg"
                onClick={() => setIsDialogOpen(false)}
              >
                Close
              </Button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label
                  className="text-[0.95rem] font-medium tracking-[-0.01em]"
                  htmlFor="waitlist-name"
                >
                  Name
                </Label>
                <Input
                  id="waitlist-name"
                  autoComplete="name"
                  className="h-11 rounded-xl border-foreground/15 bg-background px-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--foreground)_8%,transparent)] placeholder:opacity-55 focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/30"
                  placeholder="Optional"
                  spellCheck={false}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label
                  className="text-[0.95rem] font-medium tracking-[-0.01em]"
                  htmlFor="waitlist-email"
                >
                  Email
                </Label>
                <Input
                  id="waitlist-email"
                  autoComplete="email"
                  className="h-11 rounded-xl border-foreground/15 bg-background px-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--foreground)_8%,transparent)] placeholder:opacity-55 focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/30"
                  inputMode="email"
                  placeholder="you@company.com"
                  required
                  spellCheck={false}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              {error ? (
                <p className="text-sm leading-6 text-destructive">{error}</p>
              ) : null}
              <Button
                aria-busy={isSubmitting}
                className="h-11 w-full rounded-xl text-sm font-semibold shadow-none"
                disabled={isSubmitting}
                size="lg"
                type="submit"
              >
                {isSubmitting ? "Joining..." : "Join Waitlist"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
