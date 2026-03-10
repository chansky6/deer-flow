import "server-only";

import { Pool } from "pg";

import { env } from "@/env";

declare global {
  // eslint-disable-next-line no-var
  var __deerflowPgPool: Pool | undefined;
}

export function getDatabasePool() {
  if (!env.AUTH_DATABASE_URL) {
    throw new Error("AUTH_DATABASE_URL is required to enable authentication.");
  }

  globalThis.__deerflowPgPool ??= new Pool({
    connectionString: env.AUTH_DATABASE_URL,
  });

  return globalThis.__deerflowPgPool;
}
