import { Router } from "express";

import {
  createIntentController,
  type IntentControllerDeps,
} from "../controllers/intent.controller.js";
import { createRateLimit } from "../rate-limit.js";

export type IntentRoutesDeps = IntentControllerDeps;

export function createIntentRoutes(deps: IntentRoutesDeps): Router {
  const router = Router();
  const controller = createIntentController(deps);

  router.post("/intent", createRateLimit(15), controller.submitIntent);

  return router;
}
