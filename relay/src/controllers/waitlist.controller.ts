import type { Request, Response } from "express";

import {
  joinWaitlist,
  type WaitlistServiceDeps,
  type WaitlistSignupInput,
} from "../services/waitlist.service.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 50;
const MAX_NAME_LENGTH = 50;

export type WaitlistControllerDeps = WaitlistServiceDeps;

export interface WaitlistController {
  joinWaitlist: (req: Request, res: Response) => Promise<void>;
}

export function createWaitlistController(
  deps: WaitlistControllerDeps = {},
): WaitlistController {
  return {
    joinWaitlist: async (req, res) => {
      let input: WaitlistSignupInput;
      try {
        input = parseWaitlistRequest(req.body);
      } catch (err) {
        res
          .status(400)
          .json({ error: "invalid_request", reason: (err as Error).message });
        return;
      }

      try {
        const result = await joinWaitlist(input, deps);
        res.status(result.alreadyJoined ? 200 : 201).json(result);
      } catch (err) {
        console.error("[/waitlist] unexpected error:", err);
        res.status(500).json({ error: "internal_error" });
      }
    },
  };
}

function parseWaitlistRequest(body: unknown): WaitlistSignupInput {
  if (!body || typeof body !== "object") {
    throw new Error("request body must be an object");
  }

  const payload = body as Record<string, unknown>;
  const rawEmail = payload.email;
  const rawName = payload.name;

  if (typeof rawEmail !== "string") {
    throw new Error("email is required");
  }

  const email = rawEmail.trim().toLowerCase();
  if (email.length === 0) {
    throw new Error("email is required");
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new Error("email is too long");
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new Error("email must be valid");
  }

  if (
    rawName !== undefined &&
    rawName !== null &&
    typeof rawName !== "string"
  ) {
    throw new Error("name must be a string");
  }

  const name = typeof rawName === "string" ? rawName.trim() : undefined;
  if (name && name.length > MAX_NAME_LENGTH) {
    throw new Error("name is too long");
  }

  return { email, name };
}
