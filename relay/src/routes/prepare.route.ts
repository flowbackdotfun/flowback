import { Router } from "express";

import {
  createPrepareController,
  type PrepareControllerDeps,
} from "../controllers/prepare.controller.js";

export type PrepareRoutesDeps = PrepareControllerDeps;

export function createPrepareRoutes(deps: PrepareRoutesDeps): Router {
  const router = Router();
  const controller = createPrepareController(deps);

  router.post("/prepare", controller.prepare);

  return router;
}
