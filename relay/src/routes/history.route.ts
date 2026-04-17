import { Router } from "express";

import {
  createHistoryController,
  type HistoryControllerDeps,
} from "../controllers/history.controller.js";

export type HistoryRoutesDeps = HistoryControllerDeps;

export function createHistoryRoutes(deps: HistoryRoutesDeps = {}): Router {
  const router = Router();
  const controller = createHistoryController(deps);

  router.get("/history/:wallet", controller.getHistory);

  return router;
}
