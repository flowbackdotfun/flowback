import type { Request, Response } from "express";

import {
  JupiterUnavailableError,
  prepareSwap,
  type PrepareServiceDeps,
  type PrepareSwapInput,
} from "../services/prepare.service.js";

const MAX_SLIPPAGE_BPS = 10_000;

export type PrepareControllerDeps = PrepareServiceDeps;

export interface PrepareController {
  prepare: (req: Request, res: Response) => Promise<void>;
}

export function createPrepareController(
  deps: PrepareControllerDeps,
): PrepareController {
  return {
    prepare: async (req, res) => {
      let input: PrepareSwapInput;
      try {
        input = parsePrepareBody(req.body);
      } catch (err) {
        res
          .status(400)
          .json({ error: "invalid_body", reason: (err as Error).message });
        return;
      }

      try {
        const result = await prepareSwap(input, deps);
        res.json(result);
      } catch (err) {
        if (err instanceof JupiterUnavailableError) {
          res
            .status(502)
            .json({ error: "jupiter_unavailable", message: err.message });
          return;
        }
        console.error("[/prepare] unexpected error:", err);
        res.status(500).json({ error: "internal_error" });
      }
    },
  };
}

function parsePrepareBody(body: unknown): PrepareSwapInput {
  if (!body || typeof body !== "object") {
    throw new Error("body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const user = requireString(b, "user");
  const inputMint = requireString(b, "inputMint");
  const outputMint = requireString(b, "outputMint");
  const inputAmount = requireBigInt(b, "inputAmount");
  const minOutputAmount = requireBigInt(b, "minOutputAmount");
  const maxSlippageBps = requireInt(b, "maxSlippageBps");

  if (inputAmount <= 0n) throw new Error("inputAmount must be > 0");
  if (minOutputAmount < 0n) throw new Error("minOutputAmount must be >= 0");
  if (maxSlippageBps < 0 || maxSlippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error("maxSlippageBps out of range");
  }

  return {
    user,
    inputMint,
    outputMint,
    inputAmount,
    minOutputAmount,
    maxSlippageBps,
  };
}

function requireString(b: Record<string, unknown>, k: string): string {
  const v = b[k];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${k} must be a non-empty string`);
  }
  return v;
}

function requireBigInt(b: Record<string, unknown>, k: string): bigint {
  const v = b[k];
  if (typeof v !== "string" && typeof v !== "number") {
    throw new Error(`${k} must be a numeric string`);
  }
  try {
    return BigInt(v);
  } catch {
    throw new Error(`${k} must be parseable as bigint`);
  }
}

function requireInt(b: Record<string, unknown>, k: string): number {
  const v = b[k];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`${k} must be an integer`);
  }
  return v;
}
