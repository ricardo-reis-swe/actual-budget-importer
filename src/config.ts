import { resolve } from 'node:path';

export interface ApplicationConfiguration {
  actualBudget: {
    accountId: string;
    budgetId: string;
    encryptionPassword?: string;
    password: string;
    serverUrl: URL;
  };
  dataDirectory: string;
  paperless?: {
    apiToken: string;
    serverUrl: URL;
  };
  port: number;
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

  return {
    actualBudget: {
      accountId: required(environment, 'ACTUAL_ACCOUNT_ID'),
      budgetId: required(environment, 'ACTUAL_BUDGET_ID'),
      ...(encryptionPassword ? { encryptionPassword } : {}),
      password: required(environment, 'ACTUAL_PASSWORD'),
      serverUrl: url(required(environment, 'ACTUAL_SERVER_URL'), 'ACTUAL_SERVER_URL'),
    },
    dataDirectory: resolve(optional(environment, 'APP_DATA_DIRECTORY') ?? 'data'),
    paperless: paperlessUrl && paperlessToken
      ? { apiToken: paperlessToken, serverUrl: url(paperlessUrl, 'PAPERLESS_URL') }
      : undefined,
    port: port(optional(environment, 'APP_PORT')),
  };
}
