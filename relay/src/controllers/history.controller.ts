import { address } from "@solana/kit";
import type { Request, Response } from "express";

import {
  getCashbackHistory,
  type HistoryParams,
  type HistoryServiceDeps,
} from "../services/history.service.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type HistoryControllerDeps = HistoryServiceDeps;

export interface HistoryController {
  getHistory: (req: Request, res: Response) => Promise<void>;
}

export function createHistoryController(
  deps: HistoryControllerDeps = {},
): HistoryController {
  return {
    getHistory: async (req, res) => {
      let params: HistoryParams;
      try {
        const walletParam = req.params.wallet;
        params = parseHistoryRequest(
          typeof walletParam === "string" ? walletParam : undefined,
          req.query,
        );
      } catch (err) {
        res
          .status(400)
          .json({ error: "invalid_request", reason: (err as Error).message });
        return;
      }

      try {
        const result = await getCashbackHistory(params, deps);
        res.json(result);
      } catch (err) {
        console.error("[/history] unexpected error:", err);
        res.status(500).json({ error: "internal_error" });
      }
    },
  };
}

function parseHistoryRequest(
  walletParam: string | undefined,
  query: unknown,
): HistoryParams {
  if (typeof walletParam !== "string" || walletParam.length === 0) {
    throw new Error("wallet path param required");
  }
  try {
    // Throws if walletParam is not a valid base58 Solana address.
    address(walletParam);
  } catch {
    throw new Error("wallet is not a valid Solana address");
  }

  const q = (query && typeof query === "object" ? query : {}) as Record<
    string,
    unknown
  >;

  const limit = parseBoundedInt(q.limit, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
  const offset = parseBoundedInt(q.offset, "offset", 0, Number.MAX_SAFE_INTEGER, 0);

  return { wallet: walletParam, limit, offset };
}

function parseBoundedInt(
  raw: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") {
    throw new Error(`${name} must be a query string`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}
