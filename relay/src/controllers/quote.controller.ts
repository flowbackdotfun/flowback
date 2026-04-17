import type { Request, Response } from "express";

import {
  JupiterUnavailableError,
  quoteWithCashbackEstimate,
  type QuoteParams,
  type QuoteServiceDeps,
} from "../services/quote.service.js";

const MAX_SLIPPAGE_BPS = 10_000;

export type QuoteControllerDeps = QuoteServiceDeps;

export interface QuoteController {
  getQuote: (req: Request, res: Response) => Promise<void>;
}

export function createQuoteController(
  deps: QuoteControllerDeps = {},
): QuoteController {
  return {
    getQuote: async (req, res) => {
      let params: QuoteParams;
      try {
        params = parseQuoteQuery(req.query);
      } catch (err) {
        res
          .status(400)
          .json({ error: "invalid_query", reason: (err as Error).message });
        return;
      }

      try {
        const result = await quoteWithCashbackEstimate(params, deps);
        res.json({
          quote: result.quote,
          cashbackEstimate: result.cashbackEstimate,
        });
      } catch (err) {
        if (err instanceof JupiterUnavailableError) {
          res
            .status(502)
            .json({ error: "jupiter_unavailable", message: err.message });
          return;
        }
        console.error("[/quote] unexpected error:", err);
        res.status(500).json({ error: "internal_error" });
      }
    },
  };
}

function parseQuoteQuery(query: unknown): QuoteParams {
  if (!query || typeof query !== "object") {
    throw new Error("query params required");
  }
  const q = query as Record<string, unknown>;

  const inputMint = requireQueryString(q, "inputMint");
  const outputMint = requireQueryString(q, "outputMint");
  const amountStr = requireQueryString(q, "amount");
  const slippageBpsStr = requireQueryString(q, "slippageBps");

  let amount: bigint;
  try {
    amount = BigInt(amountStr);
  } catch {
    throw new Error("amount must be parseable as bigint");
  }
  if (amount <= 0n) throw new Error("amount must be > 0");

  const slippageBps = Number.parseInt(slippageBpsStr, 10);
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > MAX_SLIPPAGE_BPS
  ) {
    throw new Error("slippageBps out of range");
  }

  return { inputMint, outputMint, amount, slippageBps };
}

function requireQueryString(q: Record<string, unknown>, k: string): string {
  const v = q[k];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${k} required`);
  }
  return v;
}
