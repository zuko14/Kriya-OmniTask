/**
 * Kriya Omnitask — Runtime Mode Gate (docs/kriya WP-0.3)
 * Sandbox/test may use simulated adapters. Staging/production must use real ones,
 * and production refuses to boot on unsafe configuration instead of degrading silently.
 */

import { config } from './config.js';

export type AppMode = 'production' | 'staging' | 'sandbox' | 'test';

export function getAppMode(): AppMode {
  const explicit = (process.env.APP_MODE as AppMode | undefined) || (config.get('APP_MODE') as AppMode | undefined);
  if (explicit) return explicit;
  const env = config.get('NODE_ENV');
  if (env === 'production') return 'production';
  if (env === 'staging') return 'staging';
  if (env === 'test') return 'test';
  return 'sandbox';
}

/** True when simulated adapters, demo tools and fixtures are permitted. */
export function isSandboxMode(): boolean {
  const mode = getAppMode();
  return mode === 'sandbox' || mode === 'test';
}

/** Thrown when a capability has no real implementation/connector in a non-sandbox mode. */
export class NotConfiguredError extends Error {
  public readonly code = 'CAPABILITY_NOT_CONFIGURED';
  constructor(capability: string, hint: string) {
    super(`${capability} is not configured for ${getAppMode()} mode: ${hint}`);
  }
}

const KNOWN_DEFAULT_SECRETS = [
  'xylarc_default_secure_jwt_secret_must_be_32_chars_long',
  'xylarc_default_encryption_key_32_bytes_min_length',
  'xylarc_whatsapp_app_secret_test_2026',
  'xylarc_whatsapp_verify_token_secure_2026',
];

/**
 * Returns every reason the current configuration is unsafe for its mode.
 * Empty array = safe. Sandbox/test always pass.
 */
export function collectReadinessViolations(): string[] {
  const mode = getAppMode();
  if (mode === 'sandbox' || mode === 'test') return [];

  const violations: string[] = [];
  const secrets: Array<[string, string | undefined]> = [
    ['JWT_SECRET', config.get('JWT_SECRET')],
    ['ENCRYPTION_KEY', config.get('ENCRYPTION_KEY')],
    ['WHATSAPP_APP_SECRET', config.get('WHATSAPP_APP_SECRET')],
    ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')],
  ];
  for (const [key, value] of secrets) {
    if (value && KNOWN_DEFAULT_SECRETS.includes(value)) {
      violations.push(`${key} is a published default value; generate a real secret (openssl rand -base64 32).`);
    }
  }

  if (!config.get('PROOF_SIGNING_PRIVATE_KEY')) {
    violations.push('No Proof signing key: set PROOF_SIGNING_PRIVATE_KEY (Ed25519), or receipts cannot be issued.');
  }

  if (!config.get('OPENROUTER_API_KEY')) {
    violations.push('No real model provider configured: set OPENROUTER_API_KEY.');
  }

  const driver = config.get('DB_DRIVER');
  const url = config.get('DATABASE_URL');
  if (mode === 'production' && driver !== 'postgres') {
    violations.push('Production requires DB_DRIVER=postgres (SQLite is for tests/staging only).');
  }
  if (driver === 'sqlite' && url === ':memory:') {
    violations.push('DATABASE_URL=:memory: loses all data on restart; use a file path or Postgres.');
  }

  return violations;
}

/** Fails fast at boot when the configuration is unsafe for its mode. */
export function assertRuntimeReadiness(): void {
  const violations = collectReadinessViolations();
  if (violations.length > 0) {
    throw new Error(
      `[Runtime Readiness] Refusing to start in ${getAppMode()} mode:\n - ${violations.join('\n - ')}`
    );
  }
}
