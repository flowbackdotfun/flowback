import { Router } from "express";

import { createMevAnalysisController } from "../controllers/mev-analysis.controller.js";
import { createRateLimit } from "../rate-limit.js";

export function createMevAnalysisRoutes(): Router {
  const router = Router();
  const controller = createMevAnalysisController();

  router.get("/mev-analysis/:wallet", createRateLimit(10), controller.analyze);

  return router;
}
