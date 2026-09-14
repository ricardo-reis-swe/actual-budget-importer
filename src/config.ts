import { resolve } from 'node:path';

export interface ApplicationConfiguration {
  actualBudget: {
    budgetId: string;
    encryptionPassword?: string;
    legacyAccountId?: string;
    password: string;
    serverUrl: URL;
  };
  dataDirectory: string;
  paperless?: {
    apiToken: string;
    serverUrl: URL;
  };
  port: number;
  maximumPdfSizeBytes: number;
  extractionTimeoutMs: number;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new ConfigurationError(`${name} must be configured.`);
  }
  return value;
}

function optional(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  return environment[name]?.trim() || undefined;
}

function url(value: string, name: string): URL {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
    return parsed;
  } catch {
    throw new ConfigurationError(`${name} must be a valid HTTP or HTTPS URL.`);
  }
}

function port(value: string | undefined): number {
  if (!value) {
    return 3000;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new ConfigurationError('APP_PORT must be an integer between 1 and 65535.');
  }
  return parsed;
}

function positiveNumber(value: string | undefined, name: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ConfigurationError(`${name} must be a positive integer.`);
  return parsed;
}

export function loadConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ApplicationConfiguration {
  const paperlessUrl = optional(environment, 'PAPERLESS_URL');
  const paperlessToken = optional(environment, 'PAPERLESS_API_TOKEN');

  if (Boolean(paperlessUrl) !== Boolean(paperlessToken)) {
    throw new ConfigurationError(
      'PAPERLESS_URL and PAPERLESS_API_TOKEN must be configured together.',
    );
  }

  const encryptionPassword = optional(environment, 'ACTUAL_ENCRYPTION_PASSWORD');
  const legacyAccountId = optional(environment, 'ACTUAL_ACCOUNT_ID');

  return {
    actualBudget: {
      budgetId: required(environment, 'ACTUAL_BUDGET_ID'),
      ...(encryptionPassword ? { encryptionPassword } : {}),
      ...(legacyAccountId ? { legacyAccountId } : {}),
      password: required(environment, 'ACTUAL_PASSWORD'),
      serverUrl: url(required(environment, 'ACTUAL_SERVER_URL'), 'ACTUAL_SERVER_URL'),
    },
    dataDirectory: resolve(optional(environment, 'APP_DATA_DIRECTORY') ?? 'data'),
    ...(paperlessUrl && paperlessToken
      ? { paperless: { apiToken: paperlessToken, serverUrl: url(paperlessUrl, 'PAPERLESS_URL') } }
      : {}),
    port: port(optional(environment, 'APP_PORT')),
    maximumPdfSizeBytes: positiveNumber(environment.MAX_PDF_SIZE_BYTES, 'MAX_PDF_SIZE_BYTES', 100 * 1024 * 1024),
    extractionTimeoutMs: positiveNumber(environment.EXTRACTION_TIMEOUT_MS, 'EXTRACTION_TIMEOUT_MS', 5 * 60 * 1000),
  };
}
