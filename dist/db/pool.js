import pg from "pg";
const { Pool } = pg;
export function createPool(env) {
    return new Pool({
        connectionString: env.databaseUrl,
        max: 20,
        idleTimeoutMillis: 30_000
    });
}
