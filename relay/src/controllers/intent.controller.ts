import type { Request, Response } from "express";

import {
  InvalidSignatureError,
  SignedTxMismatchError,
  UnknownPrepareIdError,
  submitIntent as submitIntentService,
  type IntentServiceDeps,
  type SubmitIntentInput,
} from "../services/intent.service.js";

export type IntentControllerDeps = IntentServiceDeps;

export interface IntentController {
  submitIntent: (req: Request, res: Response) => Promise<void>;
}

export function createIntentController(
  deps: IntentControllerDeps,
): IntentController {
  return {
    submitIntent: async (req, res) => {
      let input: SubmitIntentInput;
      try {
        input = parseIntentBody(req.body);
      } catch (err) {
        res
          .status(400)
          .json({ error: "invalid_body", reason: (err as Error).message });
        return;
      }

      try {
        const { auctionId } = await submitIntentService(input, deps);
        res.json({ auctionId, status: "pending" });
      } catch (err) {
        if (err instanceof UnknownPrepareIdError) {
          res.status(404).json({ error: "unknown_or_expired_prepare_id" });
          return;
        }
        if (err instanceof SignedTxMismatchError) {
          res.status(400).json({ error: "signed_tx_mismatch" });
          return;
        }
        if (err instanceof InvalidSignatureError) {
          res.status(401).json({ error: "invalid_signature" });
          return;
        }
        console.error("[/intent] unexpected error:", err);
        res.status(500).json({ error: "internal_error" });
      }
    },
  };
}

function parseIntentBody(body: unknown): SubmitIntentInput {
  if (!body || typeof body !== "object") {
    throw new Error("body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const prepareId = requireString(b, "prepareId");
  const signedTx = requireString(b, "signedTx");

  return { prepareId, signedTx };
}

function requireString(b: Record<string, unknown>, k: string): string {
  const v = b[k];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${k} must be a non-empty string`);
  }
  return v;
}
