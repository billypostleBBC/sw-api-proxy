import { z } from "zod";
import { sha256 } from "../utils/crypto.js";

const BaseEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  AWS_REGION: z.string().default("eu-west-2"),
  KMS_KEY_ID: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  RATE_LIMIT_DEFAULT_RPM: z.coerce.number().int().positive().default(60),
  TOKEN_CAP_DEFAULT_DAILY: z.coerce.number().int().positive().default(2_000_000),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com"),
  TOOL_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),
  RELAY_PUBLIC_BASE_URL: z.string().url().optional()
});

const ProxyEnvSchema = BaseEnvSchema.extend({
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_PASSWORD_HASH: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "ADMIN_PASSWORD_HASH must be a 64-char SHA-256 hex string")
    .optional(),
  ADMIN_EMAIL_ALLOWLIST: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(10)
}).superRefine((env, ctx) => {
  if (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ADMIN_PASSWORD"],
      message: "Either ADMIN_PASSWORD or ADMIN_PASSWORD_HASH must be set"
    });
  }
});

const RelayEnvSchema = BaseEnvSchema.extend({
  RELAY_PASSWORD: z.string().min(8).optional(),
  RELAY_PASSWORD_HASH: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "RELAY_PASSWORD_HASH must be a 64-char SHA-256 hex string")
    .optional(),
  RELAY_EMAIL_DOMAIN_ALLOWLIST: z.string().default("bbc.co.uk"),
  RELAY_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24)
}).superRefine((env, ctx) => {
  if (!env.RELAY_PASSWORD && !env.RELAY_PASSWORD_HASH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RELAY_PASSWORD"],
      message: "Either RELAY_PASSWORD or RELAY_PASSWORD_HASH must be set"
    });
  }
});

export type AppEnv = {
  port: number;
  databaseUrl: string;
  awsRegion: string;
  kmsKeyId: string;
  corsAllowedOrigins: string[];
  defaultRpm: number;
  defaultDailyTokenCap: number;
  openaiBaseUrl: string;
  toolTokenTtlDays: number;
  relayPublicBaseUrl?: string;
  adminPasswordHash?: string;
  adminEmailAllowlist?: Set<string>;
  sessionTtlHours?: number;
  relayPasswordHash?: string;
  relayEmailDomainAllowlist?: Set<string>;
  relaySessionTtlHours?: number;
};

function toLowercaseSet(input: string, transform: (value: string) => string = (value) => value): Set<string> {
  return new Set(
    input
      .split(",")
      .map((value) => transform(value.trim().toLowerCase()))
      .filter(Boolean)
  );
}

function baseEnv(parsed: z.infer<typeof BaseEnvSchema>): AppEnv {
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    awsRegion: parsed.AWS_REGION,
    kmsKeyId: parsed.KMS_KEY_ID,
    corsAllowedOrigins: parsed.CORS_ALLOWED_ORIGINS
      ? parsed.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
      : [],
    defaultRpm: parsed.RATE_LIMIT_DEFAULT_RPM,
    defaultDailyTokenCap: parsed.TOKEN_CAP_DEFAULT_DAILY,
    openaiBaseUrl: parsed.OPENAI_BASE_URL,
    toolTokenTtlDays: parsed.TOOL_TOKEN_TTL_DAYS,
    relayPublicBaseUrl: parsed.RELAY_PUBLIC_BASE_URL
  };
}

export function loadProxyEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = ProxyEnvSchema.parse(raw);

  return {
    ...baseEnv(parsed),
    adminPasswordHash: (parsed.ADMIN_PASSWORD_HASH ?? sha256(parsed.ADMIN_PASSWORD!)).toLowerCase(),
    adminEmailAllowlist: toLowercaseSet(parsed.ADMIN_EMAIL_ALLOWLIST),
    sessionTtlHours: parsed.SESSION_TTL_HOURS
  };
}

export function loadRelayEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = RelayEnvSchema.parse(raw);

  return {
    ...baseEnv(parsed),
    relayPasswordHash: (parsed.RELAY_PASSWORD_HASH ?? sha256(parsed.RELAY_PASSWORD!)).toLowerCase(),
    relayEmailDomainAllowlist: toLowercaseSet(parsed.RELAY_EMAIL_DOMAIN_ALLOWLIST, (value) =>
      value.startsWith("@") ? value.slice(1) : value
    ),
    relaySessionTtlHours: parsed.RELAY_SESSION_TTL_HOURS
  };
}
