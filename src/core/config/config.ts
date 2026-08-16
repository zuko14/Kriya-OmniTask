/**
 * Xylarc AI — Environment & Configuration Manager
 * Strict schema validation using Zod with zero unvalidated environment access.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const emptyToUndef = (val: unknown) => (typeof val === 'string' && val.trim() === '' ? undefined : val);
const optString = (defaultValue?: string) =>
  defaultValue !== undefined
    ? z.preprocess(emptyToUndef, z.string().default(defaultValue))
    : z.preprocess(emptyToUndef, z.string().optional());
const optUrl = (defaultValue?: string) =>
  defaultValue !== undefined
    ? z.preprocess(emptyToUndef, z.string().url().default(defaultValue))
    : z.preprocess(emptyToUndef, z.string().url().optional());
const optEmail = () => z.preprocess(emptyToUndef, z.string().email().optional());
const optNumber = (defaultValue?: number) =>
  defaultValue !== undefined
    ? z.preprocess(emptyToUndef, z.coerce.number().default(defaultValue))
    : z.preprocess(emptyToUndef, z.coerce.number().optional());
const optEnum = <T extends [string, ...string[]]>(values: T, defaultValue?: T[number]) =>
  defaultValue !== undefined
    ? z.preprocess(emptyToUndef, z.enum(values).default(defaultValue))
    : z.preprocess(emptyToUndef, z.enum(values).optional());

export const ConfigSchema = z.object({
  // Server & Environment
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PRETTY_LOGS: z.coerce.boolean().default(false),
  API_PREFIX: z.string().default('/api/v1'),

  // Database & Persistence
  DB_DRIVER: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_URL: z.string().default(':memory:'),
  PGSSLMODE: optEnum(['disable', 'require', 'verify-ca', 'verify-full']),
  DB_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),

  // Supabase Platform Integration
  SUPABASE_URL: optUrl(),
  SUPABASE_ANON_KEY: optString(),
  SUPABASE_SERVICE_ROLE_KEY: optString(),
  SUPABASE_DB_PASSWORD: optString(),

  // Cache & Distributed Queues (Redis)
  REDIS_URL: optString(),
  REDIS_PASSWORD: optString(),

  // Security, Cryptography & Auth
  JWT_SECRET: z.string().min(32).default('xylarc_default_secure_jwt_secret_must_be_32_chars_long'),
  JWT_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().min(32).default('xylarc_default_encryption_key_32_bytes_min_length'),
  SESSION_SECRET: optString(),
  COOKIE_SECRET: optString(),

  // AI Model Provider API Keys & Gateways
  OPENROUTER_API_KEY: optString(),
  OPENROUTER_BASE_URL: optUrl('https://openrouter.ai/api/v1'),
  GEMINI_API_KEY: optString(),
  GOOGLE_VERTEX_PROJECT_ID: optString(),
  GOOGLE_VERTEX_LOCATION: optString('us-central1'),
  OPENAI_API_KEY: optString(),
  OPENAI_ORG_ID: optString(),
  ANTHROPIC_API_KEY: optString(),
  MISTRAL_API_KEY: optString(),
  GROQ_API_KEY: optString(),
  HUGGINGFACE_API_KEY: optString(),
  OLLAMA_BASE_URL: optUrl(),

  // Knowledge Fabric & Vector Embeddings
  EMBEDDING_PROVIDER: optEnum(['openai', 'gemini', 'huggingface', 'local'], 'gemini'),
  EMBEDDING_MODEL: optString('text-embedding-004'),
  PINECONE_API_KEY: optString(),
  PINECONE_INDEX: optString(),
  QDRANT_URL: optUrl(),
  QDRANT_API_KEY: optString(),

  // Billing & Payment Processing (Stripe)
  STRIPE_SECRET_KEY: optString(),
  STRIPE_PUBLISHABLE_KEY: optString(),
  STRIPE_WEBHOOK_SECRET: optString(),

  // Omnichannel Communication Gateways
  // WhatsApp Cloud API
  WHATSAPP_ACCESS_TOKEN: optString(),
  WHATSAPP_PHONE_NUMBER_ID: optString(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: optString(),
  WHATSAPP_APP_SECRET: z.string().default('xylarc_whatsapp_app_secret_test_2026'),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default('xylarc_whatsapp_verify_token_secure_2026'),

  // Twilio (Voice / SMS)
  TWILIO_ACCOUNT_SID: optString(),
  TWILIO_AUTH_TOKEN: optString(),
  TWILIO_PHONE_NUMBER: optString(),

  // Outbound Email (Resend / SMTP)
  RESEND_API_KEY: optString(),
  SMTP_HOST: optString(),
  SMTP_PORT: optNumber(),
  SMTP_USER: optString(),
  SMTP_PASSWORD: optString(),
  SMTP_FROM_EMAIL: optEmail(),

  // Enterprise Governance & Multi-Tenant Guardrails
  TENANT_ISOLATION_STRICT: z.coerce.boolean().default(true),
  MAX_AGENT_DELEGATION_DEPTH: z.coerce.number().int().positive().default(5),
  DEFAULT_AUTONOMY_LEVEL: z.coerce.number().int().min(0).max(5).default(1),
  ENABLE_AUDIT_LOGGING: z.coerce.boolean().default(true),

  // Observability & SRE
  SENTRY_DSN: optUrl(),
  OTEL_EXPORTER_OTLP_ENDPOINT: optUrl(),
  PROMETHEUS_METRICS_ENABLED: z.coerce.boolean().default(true),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

class ConfigurationManager {
  private static instance: ConfigurationManager;
  private config: AppConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  public getAll(): Readonly<AppConfig> {
    return Object.freeze({ ...this.config });
  }

  public getRedacted(): Record<string, unknown> {
    const sensitiveKeys = new Set([
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'SESSION_SECRET',
      'COOKIE_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_DB_PASSWORD',
      'REDIS_PASSWORD',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'OPENROUTER_API_KEY',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'MISTRAL_API_KEY',
      'GROQ_API_KEY',
      'HUGGINGFACE_API_KEY',
      'PINECONE_API_KEY',
      'QDRANT_API_KEY',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_APP_SECRET',
      'TWILIO_AUTH_TOKEN',
      'RESEND_API_KEY',
      'SMTP_PASSWORD',
    ]);

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.config)) {
      if (sensitiveKeys.has(k)) {
        result[k] = v ? '[REDACTED]' : undefined;
      } else if (k === 'DATABASE_URL' && typeof v === 'string' && v.includes('@')) {
        result[k] = v.replace(/:([^:@]+)@/, ':***@');
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  public resetForTesting(overrides: Partial<AppConfig> = {}): void {
    const parsed = ConfigSchema.parse({
      ...process.env,
      ...overrides,
    });
    this.config = parsed;
  }

  private loadConfig(): AppConfig {
    const result = ConfigSchema.safeParse(process.env);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`[Configuration Error] Invalid environment configuration: ${issues}`);
    }
    return result.data;
  }
}

export const config = ConfigurationManager.getInstance();
