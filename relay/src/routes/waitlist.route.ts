import { Router } from "express";

import {
  createWaitlistController,
  type WaitlistControllerDeps,
} from "../controllers/waitlist.controller.js";
import { createRateLimit } from "../rate-limit.js";

export type WaitlistRoutesDeps = WaitlistControllerDeps;

export function createWaitlistRoutes(deps: WaitlistRoutesDeps = {}): Router {
  const router = Router();
  const controller = createWaitlistController(deps);

  router.post("/waitlist", createRateLimit(5), controller.joinWaitlist);

  return router;
}
