const statements = [
    `CREATE TABLE IF NOT EXISTS admins (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS projects (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    environment TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    owner_email TEXT NOT NULL,
    daily_token_cap BIGINT NOT NULL,
    rpm_cap INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS project_keys (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    provider TEXT NOT NULL,
    kms_ciphertext TEXT NOT NULL,
    key_suffix TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    rotated_at TIMESTAMPTZ,
    created_by_admin_id BIGINT REFERENCES admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS tools (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS tool_tokens (
    id TEXT PRIMARY KEY,
    tool_id BIGINT NOT NULL REFERENCES tools(id),
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS magic_links (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    subject_email TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS usage_events (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT REFERENCES projects(id),
    tool_id BIGINT REFERENCES tools(id),
    endpoint TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_usd NUMERIC(12, 6),
    status_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_email TEXT NOT NULL,
    actor_scope TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    metadata_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    `CREATE TABLE IF NOT EXISTS rate_counters (
    project_id BIGINT NOT NULL REFERENCES projects(id),
    bucket_minute TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL,
    token_count INTEGER NOT NULL,
    PRIMARY KEY (project_id, bucket_minute)
  );`,
    `CREATE INDEX IF NOT EXISTS idx_usage_events_project_created_at ON usage_events(project_id, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_magic_links_email_scope_expires ON magic_links(email, scope, expires_at);`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_subject_scope_expires ON sessions(subject_email, scope, expires_at);`,
    `CREATE INDEX IF NOT EXISTS idx_tool_tokens_tool_status_expires ON tool_tokens(tool_id, status, expires_at);`
];
export async function runMigrations(pool) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const statement of statements) {
            await client.query(statement);
        }
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
