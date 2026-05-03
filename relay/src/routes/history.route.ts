import { Router } from "express";

import {
  createHistoryController,
  type HistoryControllerDeps,
} from "../controllers/history.controller.js";
import { createRateLimit } from "../rate-limit.js";

export type HistoryRoutesDeps = HistoryControllerDeps;

export function createHistoryRoutes(deps: HistoryRoutesDeps = {}): Router {
  const router = Router();
  const controller = createHistoryController(deps);

  router.get("/history/:wallet", createRateLimit(30), controller.getHistory);

  return router;
}
