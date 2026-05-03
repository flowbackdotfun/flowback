import { Router } from "express";

import {
  createQuoteController,
  type QuoteControllerDeps,
} from "../controllers/quote.controller.js";
import { createRateLimit } from "../rate-limit.js";

export type QuoteRoutesDeps = QuoteControllerDeps;

export function createQuoteRoutes(deps: QuoteRoutesDeps = {}): Router {
  const router = Router();
  const controller = createQuoteController(deps);

  router.get("/quote", createRateLimit(30), controller.getQuote);

  return router;
}
