import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const queryClient = postgres(process.env.DATABASE_URL);

export const db = drizzle(queryClient, { schema });

export async function ensureRelayDbSchema(): Promise<void> {
  await queryClient`
    create table if not exists waitlist_signups (
      id text primary key,
      email text not null unique,
      name text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    )
  `;
}
