import arcjet, { slidingWindow } from "@arcjet/node";
import type { Request, Response, NextFunction } from "express";

export function createRateLimit(max: number, interval: number = 60) {
  const key = process.env.ARCJET_KEY;
  if (!key) {
    return (_req: Request, _res: Response, next: NextFunction) => {
      next();
    };
  }

  const aj = arcjet({
    key,
    rules: [slidingWindow({ mode: "LIVE", interval, max })],
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    const decision = await aj.protect(req);
    if (decision.isDenied()) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}
