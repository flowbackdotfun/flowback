import { Router } from "express";

import {
  createWaitlistController,
  type WaitlistControllerDeps,
} from "../controllers/waitlist.controller.js";

export type WaitlistRoutesDeps = WaitlistControllerDeps;

export function createWaitlistRoutes(deps: WaitlistRoutesDeps = {}): Router {
  const router = Router();
  const controller = createWaitlistController(deps);

  router.post("/waitlist", controller.joinWaitlist);

  return router;
}
