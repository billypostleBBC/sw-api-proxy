import pg from "pg";
import type { AppEnv } from "../config/env.js";

const { Pool } = pg;

export function createPool(env: AppEnv): pg.Pool {
  return new Pool({
    connectionString: env.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000
  });
}
