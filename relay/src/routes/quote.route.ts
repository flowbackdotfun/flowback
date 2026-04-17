import { Router } from "express";

import {
  createQuoteController,
  type QuoteControllerDeps,
} from "../controllers/quote.controller.js";

export type QuoteRoutesDeps = QuoteControllerDeps;

export function createQuoteRoutes(deps: QuoteRoutesDeps = {}): Router {
  const router = Router();
  const controller = createQuoteController(deps);

  router.get("/quote", controller.getQuote);

  return router;
}
