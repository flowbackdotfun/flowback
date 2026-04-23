import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "../db/client.js";
import { waitlistSignups } from "../db/schema.js";

type Db = typeof defaultDb;

export interface WaitlistServiceDeps {
  db?: Db;
}

export interface WaitlistSignupInput {
  email: string;
  name?: string;
}

export interface WaitlistSignupResult {
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  alreadyJoined: boolean;
}

export async function joinWaitlist(
  input: WaitlistSignupInput,
  deps: WaitlistServiceDeps = {},
): Promise<WaitlistSignupResult> {
  const db = deps.db ?? defaultDb;
  const email = input.email.trim().toLowerCase();
  const name = normalizeName(input.name);

  const [existing] = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.email, email))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(waitlistSignups)
      .set({
        name: name ?? existing.name,
        updatedAt: new Date(),
      })
      .where(eq(waitlistSignups.email, email))
      .returning();

    return {
      email: updated.email,
      name: updated.name,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      alreadyJoined: true,
    };
  }

  const now = new Date();
  const [created] = await db
    .insert(waitlistSignups)
    .values({
      id: randomUUID(),
      email,
      name,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return {
    email: created.email,
    name: created.name,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    alreadyJoined: false,
  };
}

function normalizeName(name: string | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}
