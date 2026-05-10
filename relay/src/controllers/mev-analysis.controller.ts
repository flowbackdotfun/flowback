import { address } from "@solana/kit";
import type { Request, Response } from "express";

import { getCache, setCache } from "../db/redis.js";
import { HeliusUnavailableError } from "../services/errors.js";
import {
  analyzeWalletMev,
  type MevAnalysisResult,
} from "../services/mev-analysis.service.js";

const CACHE_TTL = 300;

export interface MevAnalysisController {
  analyze: (req: Request, res: Response) => Promise<void>;
}

export function createMevAnalysisController(): MevAnalysisController {
  return {
    analyze: async (req, res) => {
      const wallet = req.params.wallet;
      if (typeof wallet !== "string" || wallet.length === 0) {
        res
          .status(400)
          .json({ error: "invalid_request", reason: "wallet path param required" });
        return;
      }
      try {
        address(wallet);
      } catch {
        res.status(400).json({
          error: "invalid_request",
          reason: "wallet is not a valid Solana address",
        });
        return;
      }

      const pagesRaw = req.query.pages;
      let pages = 1;
      if (typeof pagesRaw === "string") {
        const n = Number.parseInt(pagesRaw, 10);
        if (Number.isInteger(n) && n >= 1 && n <= 5) pages = n;
      }

      const cacheKey = `mev-analysis:${wallet}:${pages}`;
      const cached = await getCache<MevAnalysisResult>(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      try {
        const result = await analyzeWalletMev({ wallet, pages });
        await setCache(cacheKey, result, CACHE_TTL);
        res.json(result);
      } catch (err) {
        if (err instanceof HeliusUnavailableError) {
          console.error("[/mev-analysis] helius error:", err.message);
          res.status(502).json({ error: "helius_unavailable" });
          return;
        }
        console.error("[/mev-analysis] unexpected error:", err);
        res.status(500).json({ error: "internal_error" });
      }
    },
  };
}
