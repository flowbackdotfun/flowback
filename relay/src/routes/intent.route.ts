import { Router } from "express";

import {
  createIntentController,
  type IntentControllerDeps,
} from "../controllers/intent.controller.js";

export type IntentRoutesDeps = IntentControllerDeps;

export function createIntentRoutes(deps: IntentRoutesDeps): Router {
  const router = Router();
  const controller = createIntentController(deps);

  router.post("/intent", controller.submitIntent);

  return router;
}
