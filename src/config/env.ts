import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  AWS_REGION: z.string().default("eu-west-2"),
  KMS_KEY_ID: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(8),
  ADMIN_EMAIL_ALLOWLIST: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  RATE_LIMIT_DEFAULT_RPM: z.coerce.number().int().positive().default(60),
  TOKEN_CAP_DEFAULT_DAILY: z.coerce.number().int().positive().default(2_000_000),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(10),
  TOOL_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90)
});

export type AppEnv = {
  port: number;
  databaseUrl: string;
  awsRegion: string;
  kmsKeyId: string;
  adminPassword: string;
  adminEmailAllowlist: Set<string>;
  corsAllowedOrigins: string[];
  defaultRpm: number;
  defaultDailyTokenCap: number;
  openaiBaseUrl: string;
  sessionTtlHours: number;
  toolTokenTtlDays: number;
};

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.parse(raw);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    awsRegion: parsed.AWS_REGION,
    kmsKeyId: parsed.KMS_KEY_ID,
    adminPassword: parsed.ADMIN_PASSWORD,
    adminEmailAllowlist: new Set(
      parsed.ADMIN_EMAIL_ALLOWLIST.split(",").map((email) => email.trim().toLowerCase())
    ),
    corsAllowedOrigins: parsed.CORS_ALLOWED_ORIGINS
      ? parsed.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
      : [],
    defaultRpm: parsed.RATE_LIMIT_DEFAULT_RPM,
    defaultDailyTokenCap: parsed.TOKEN_CAP_DEFAULT_DAILY,
    openaiBaseUrl: parsed.OPENAI_BASE_URL,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    toolTokenTtlDays: parsed.TOOL_TOKEN_TTL_DAYS
  };
}
