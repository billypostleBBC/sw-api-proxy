import { parseOpaqueToken, safeEqualHex, sha256 } from "../utils/crypto.js";
export class Repo {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async upsertAdmins(emails) {
        for (const email of emails) {
            await this.pool.query(`INSERT INTO admins (email, status)
         VALUES ($1, 'active')
         ON CONFLICT (email) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`, [email]);
        }
    }
    async createProject(input) {
        const result = await this.pool.query(`INSERT INTO projects (slug, name, environment, owner_email, daily_token_cap, rpm_cap)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`, [input.slug, input.name, input.environment, input.ownerEmail, input.dailyTokenCap, input.rpmCap]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("Failed to create project");
        }
        return row;
    }
    async listProjects(filter) {
        const where = [];
        const args = [];
        if (!filter.includeInactive) {
            where.push(`status = 'active'`);
        }
        if (filter.slug) {
            args.push(filter.slug);
            where.push(`slug = $${args.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const result = await this.pool.query(`SELECT id, slug, name, environment, status, owner_email, rpm_cap, daily_token_cap
       FROM projects
       ${whereSql}
       ORDER BY id DESC`, args);
        return result.rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            environment: row.environment,
            status: row.status,
            ownerEmail: row.owner_email,
            rpmCap: row.rpm_cap,
            dailyTokenCap: Number(row.daily_token_cap)
        }));
    }
    async setActiveProjectKey(input) {
        const admin = await this.pool.query(`SELECT id FROM admins WHERE email = $1 AND status = 'active'`, [input.adminEmail]);
        const adminId = admin.rows[0]?.id ?? null;
        await this.pool.query(`UPDATE project_keys SET status = 'inactive', updated_at = now() WHERE project_id = $1`, [
            input.projectId
        ]);
        await this.pool.query(`INSERT INTO project_keys (project_id, provider, kms_ciphertext, key_suffix, status, rotated_at, created_by_admin_id)
       VALUES ($1, $2, $3, $4, 'active', now(), $5)`, [input.projectId, input.provider, input.kmsCiphertext, input.keySuffix, adminId]);
    }
    async createTool(input) {
        const result = await this.pool.query(`INSERT INTO tools (slug, project_id, mode)
       VALUES ($1, $2, $3)
       RETURNING id`, [input.slug, input.projectId, input.mode]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("Failed to create tool");
        }
        return row;
    }
    async listTools(filter) {
        const where = [];
        const args = [];
        if (!filter.includeInactive) {
            where.push(`status = 'active'`);
        }
        if (filter.slug) {
            args.push(filter.slug);
            where.push(`slug = $${args.length}`);
        }
        if (filter.projectId) {
            args.push(filter.projectId);
            where.push(`project_id = $${args.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const result = await this.pool.query(`SELECT id, slug, project_id, mode, status
       FROM tools
       ${whereSql}
       ORDER BY id DESC`, args);
        return result.rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            projectId: row.project_id,
            mode: row.mode,
            status: row.status
        }));
    }
    async getToolById(toolId) {
        const result = await this.pool.query(`SELECT id, slug, project_id, mode, status
       FROM tools
       WHERE id = $1`, [toolId]);
        const row = result.rows[0];
        if (!row) {
            return null;
        }
        return {
            id: row.id,
            slug: row.slug,
            projectId: row.project_id,
            mode: row.mode,
            status: row.status
        };
    }
    async createToolToken(input) {
        await this.pool.query(`INSERT INTO tool_tokens (id, tool_id, token_hash, expires_at, status)
       VALUES ($1, $2, $3, $4, 'active')`, [input.tokenId, input.toolId, input.tokenHash, input.expiresAt]);
    }
    async listToolTokens(toolId) {
        const result = await this.pool.query(`SELECT id, status, expires_at, last_used_at, created_at
       FROM tool_tokens
       WHERE tool_id = $1
       ORDER BY created_at DESC`, [toolId]);
        return result.rows.map((row) => ({
            id: row.id,
            status: row.status,
            expiresAt: row.expires_at,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at
        }));
    }
    async revokeToolToken(toolId, tokenId) {
        const result = await this.pool.query(`UPDATE tool_tokens
       SET status = 'revoked', updated_at = now()
       WHERE id = $1 AND tool_id = $2`, [tokenId, toolId]);
        return (result.rowCount ?? 0) > 0;
    }
    async deactivateTool(toolId) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const tool = await client.query(`SELECT id FROM tools WHERE id = $1`, [toolId]);
            if (!tool.rows[0]) {
                await client.query("ROLLBACK");
                return null;
            }
            await client.query(`UPDATE tools SET status = 'inactive', updated_at = now() WHERE id = $1`, [toolId]);
            const revokedTokens = await client.query(`UPDATE tool_tokens
         SET status = 'revoked', updated_at = now()
         WHERE tool_id = $1 AND status <> 'revoked'`, [toolId]);
            await client.query("COMMIT");
            return { tokensRevoked: revokedTokens.rowCount ?? 0 };
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async deactivateProject(projectId) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const project = await client.query(`SELECT id FROM projects WHERE id = $1`, [projectId]);
            if (!project.rows[0]) {
                await client.query("ROLLBACK");
                return null;
            }
            await client.query(`UPDATE projects SET status = 'inactive', updated_at = now() WHERE id = $1`, [projectId]);
            await client.query(`UPDATE project_keys
         SET status = 'inactive', updated_at = now()
         WHERE project_id = $1 AND status <> 'inactive'`, [projectId]);
            const deactivatedTools = await client.query(`UPDATE tools
         SET status = 'inactive', updated_at = now()
         WHERE project_id = $1 AND status <> 'inactive'`, [projectId]);
            const revokedTokens = await client.query(`UPDATE tool_tokens tt
         SET status = 'revoked', updated_at = now()
         FROM tools t
         WHERE tt.tool_id = t.id
           AND t.project_id = $1
           AND tt.status <> 'revoked'`, [projectId]);
            await client.query("COMMIT");
            return {
                toolsDeactivated: deactivatedTools.rowCount ?? 0,
                tokensRevoked: revokedTokens.rowCount ?? 0
            };
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async findAuthByToolToken(rawToken) {
        const parsed = parseOpaqueToken(rawToken, "tt");
        if (!parsed) {
            return null;
        }
        const row = await this.pool.query(`SELECT
         tt.id,
         tt.token_hash,
         tt.expires_at,
         tt.status,
         t.id as tool_id,
         t.slug as tool_slug,
         t.status as tool_status,
         p.id as project_id,
         p.slug as project_slug,
         p.status as project_status,
         p.rpm_cap,
         p.daily_token_cap
       FROM tool_tokens tt
       JOIN tools t ON t.id = tt.tool_id
       JOIN projects p ON p.id = t.project_id
       WHERE tt.id = $1`, [parsed.id]);
        const token = row.rows[0];
        if (!token) {
            return null;
        }
        if (token.status !== "active" || token.expires_at <= new Date()) {
            return null;
        }
        if (!safeEqualHex(sha256(parsed.secret), token.token_hash)) {
            return null;
        }
        await this.pool.query(`UPDATE tool_tokens SET last_used_at = now(), updated_at = now() WHERE id = $1`, [token.id]);
        return {
            mode: "tool",
            toolId: token.tool_id,
            toolSlug: token.tool_slug,
            toolStatus: token.tool_status,
            projectId: token.project_id,
            projectSlug: token.project_slug,
            projectStatus: token.project_status,
            rpmCap: token.rpm_cap,
            dailyTokenCap: Number(token.daily_token_cap)
        };
    }
    async createSession(input) {
        await this.pool.query(`INSERT INTO sessions (id, token_hash, subject_email, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5)`, [input.id, input.tokenHash, input.subjectEmail, input.scope, input.expiresAt]);
    }
    async findSession(input) {
        const result = await this.pool.query(`SELECT token_hash, subject_email, expires_at
       FROM sessions
       WHERE id = $1 AND scope = $2`, [input.id, input.scope]);
        const row = result.rows[0];
        if (!row || row.expires_at <= new Date()) {
            return null;
        }
        if (!safeEqualHex(sha256(input.secret), row.token_hash)) {
            return null;
        }
        return { subjectEmail: row.subject_email };
    }
    async findToolBySlug(slug) {
        const result = await this.pool.query(`SELECT t.id as tool_id, p.id as project_id, p.slug as project_slug, t.status as tool_status, p.status as project_status, p.rpm_cap, p.daily_token_cap
       FROM tools t
       JOIN projects p ON p.id = t.project_id
       WHERE t.slug = $1`, [slug]);
        const row = result.rows[0];
        if (!row) {
            return null;
        }
        return {
            toolId: row.tool_id,
            projectId: row.project_id,
            projectSlug: row.project_slug,
            toolStatus: row.tool_status,
            projectStatus: row.project_status,
            rpmCap: row.rpm_cap,
            dailyTokenCap: Number(row.daily_token_cap)
        };
    }
    async getActiveProjectKey(projectId) {
        const result = await this.pool.query(`SELECT kms_ciphertext FROM project_keys WHERE project_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [projectId]);
        const row = result.rows[0];
        return row ? { kmsCiphertext: row.kms_ciphertext } : null;
    }
    async getDailyTokensUsed(projectId) {
        const result = await this.pool.query(`SELECT COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0)::TEXT AS total
       FROM usage_events
       WHERE project_id = $1 AND created_at >= date_trunc('day', now())`, [projectId]);
        return Number(result.rows[0]?.total ?? 0);
    }
    async incrementRateCounter(projectId, bucketMinute) {
        const result = await this.pool.query(`INSERT INTO rate_counters (project_id, bucket_minute, request_count, token_count)
       VALUES ($1, $2, 1, 0)
       ON CONFLICT (project_id, bucket_minute)
       DO UPDATE SET request_count = rate_counters.request_count + 1
       RETURNING request_count`, [projectId, bucketMinute]);
        const row = result.rows[0];
        if (!row) {
            throw new Error("Failed to increment rate counter");
        }
        return row.request_count;
    }
    async logUsage(input) {
        await this.pool.query(`INSERT INTO usage_events (project_id, tool_id, endpoint, model, input_tokens, output_tokens, estimated_cost_usd, status_code, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
            input.projectId,
            input.toolId,
            input.endpoint,
            input.model,
            input.inputTokens,
            input.outputTokens,
            input.estimatedCostUsd,
            input.statusCode,
            input.latencyMs
        ]);
    }
    async logAudit(input) {
        await this.pool.query(`INSERT INTO audit_logs (actor_email, actor_scope, action, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [input.actorEmail, input.actorScope, input.action, input.targetType, input.targetId, JSON.stringify(input.metadata)]);
    }
    async getUsage(projectId, from, to) {
        const where = [];
        const args = [];
        if (projectId) {
            args.push(projectId);
            where.push(`project_id = $${args.length}`);
        }
        if (from) {
            args.push(from);
            where.push(`created_at >= $${args.length}::timestamptz`);
        }
        if (to) {
            args.push(to);
            where.push(`created_at <= $${args.length}::timestamptz`);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const result = await this.pool.query(`SELECT id, project_id, tool_id, endpoint, model, input_tokens, output_tokens, estimated_cost_usd, status_code, latency_ms, created_at
       FROM usage_events
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT 1000`, args);
        return result.rows;
    }
}
