import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfiguration } from '../src/config.js';

const requiredConfiguration = {
  ACTUAL_BUDGET_ID: 'budget-id',
  ACTUAL_PASSWORD: 'password',
  ACTUAL_SERVER_URL: 'https://actual.example.test',
};

describe('application configuration', () => {
  it('loads required settings and safe defaults', () => {
    const configuration = loadConfiguration(requiredConfiguration);

    expect(configuration.actualBudget.serverUrl.href).toBe('https://actual.example.test/');
    expect(configuration.dataDirectory).toMatch(/data$/);
    expect(configuration.port).toBe(3000);
    expect(configuration.paperless).toBeUndefined();
    expect(configuration.actualBudget.legacyAccountId).toBeUndefined();
  });

  it('accepts the former destination account as an optional migration aid', () => {
    expect(loadConfiguration({ ...requiredConfiguration, ACTUAL_ACCOUNT_ID: 'legacy-account' }).actualBudget.legacyAccountId)
      .toBe('legacy-account');
  });

  it('rejects missing Actual Budget settings', () => {
    expect(() => loadConfiguration({ ...requiredConfiguration, ACTUAL_PASSWORD: '' }))
      .toThrow(new ConfigurationError('ACTUAL_PASSWORD must be configured.'));
  });

  it('requires Paperless URL and token together', () => {
    expect(() => loadConfiguration({ ...requiredConfiguration, PAPERLESS_URL: 'https://paperless.example.test' }))
      .toThrow('PAPERLESS_URL and PAPERLESS_API_TOKEN must be configured together.');
  });

  it('loads Paperless-ngx settings only when both values are configured', () => {
    const configuration = loadConfiguration({
      ...requiredConfiguration,
      PAPERLESS_API_TOKEN: 'synthetic-token',
      PAPERLESS_URL: 'https://paperless.example.test',
    });

    expect(configuration.paperless).toEqual({
      apiToken: 'synthetic-token',
      serverUrl: new URL('https://paperless.example.test'),
    });
  });

  it('validates the listener port and integration URL', () => {
    expect(() => loadConfiguration({ ...requiredConfiguration, APP_PORT: '0' }))
      .toThrow('APP_PORT must be an integer between 1 and 65535.');
    expect(() => loadConfiguration({ ...requiredConfiguration, ACTUAL_SERVER_URL: 'file:///tmp/actual' }))
      .toThrow('ACTUAL_SERVER_URL must be a valid HTTP or HTTPS URL.');
  });
});
