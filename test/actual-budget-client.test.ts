import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actual-app/api', () => ({
  downloadBudget: vi.fn(),
  getAccounts: vi.fn(),
  getPayees: vi.fn(),
  init: vi.fn(),
  shutdown: vi.fn(),
  sync: vi.fn(),
}));

import * as actual from '@actual-app/api';

import { loadConfiguration } from '../src/config.js';
import { ActualBudgetClient } from '../src/publishing/actual-budget-client.js';

const syncFailure = () => Object.assign(new Error('Synthetic sync failure'), { code: 'out-of-sync' });

describe('Actual Budget client lifecycle', () => {
  let directory: string;
  let client: ActualBudgetClient;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(actual.init).mockResolvedValue(undefined as never);
    vi.mocked(actual.downloadBudget).mockResolvedValue(undefined);
    vi.mocked(actual.shutdown).mockResolvedValue(undefined);
    vi.mocked(actual.sync).mockResolvedValue(undefined);
    vi.mocked(actual.getAccounts).mockResolvedValue([{ id: 'account-1', name: 'Synthetic current', offbudget: false, closed: false }]);
    directory = mkdtempSync(join(tmpdir(), 'actual-client-test-'));
    client = new ActualBudgetClient(loadConfiguration({
      ACTUAL_SERVER_URL: 'https://actual.example.test',
      ACTUAL_PASSWORD: 'synthetic',
      ACTUAL_BUDGET_ID: 'synthetic',
      APP_DATA_DIRECTORY: directory,
    }));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps the budget loaded across successful operations', async () => {
    await client.getAccounts();
    await client.getAccounts();

    expect(actual.init).toHaveBeenCalledOnce();
    expect(actual.downloadBudget).toHaveBeenCalledOnce();
    expect(actual.shutdown).not.toHaveBeenCalled();
  });

  it('reloads the budget after a sync fails on an initialized client', async () => {
    await client.getAccounts();
    vi.mocked(actual.sync).mockRejectedValueOnce(syncFailure());

    await expect(client.getAccounts()).rejects.toThrow('Synthetic sync failure');
    expect(actual.shutdown).toHaveBeenCalledOnce();

    await expect(client.getAccounts()).resolves.toHaveLength(1);
    expect(actual.init).toHaveBeenCalledTimes(2);
    expect(actual.downloadBudget).toHaveBeenCalledTimes(2);
  });

  it('fails the operation and reloads the budget when the closing sync fails', async () => {
    await client.getAccounts();
    vi.mocked(actual.sync).mockResolvedValueOnce(undefined).mockRejectedValueOnce(syncFailure());

    await expect(client.getAccounts()).rejects.toThrow('Synthetic sync failure');
    await client.getAccounts();

    expect(actual.shutdown).toHaveBeenCalledOnce();
    expect(actual.init).toHaveBeenCalledTimes(2);
  });

  it('reloads the budget after an unexpected Actual Budget error', async () => {
    await client.getAccounts();
    vi.mocked(actual.getAccounts).mockRejectedValueOnce(new Error('Synthetic database failure'));

    await expect(client.getAccounts()).rejects.toThrow('Synthetic database failure');
    await client.getAccounts();

    expect(actual.init).toHaveBeenCalledTimes(2);
  });

  it('keeps the budget loaded after a validation error', async () => {
    await client.getAccounts();

    await expect(client.resolveTransferPayee('account-1', 'account-1')).rejects.toThrow('different');
    await client.getAccounts();

    expect(actual.shutdown).not.toHaveBeenCalled();
    expect(actual.init).toHaveBeenCalledOnce();
  });

  it('serializes operations while recovering from a failure', async () => {
    await client.getAccounts();
    vi.mocked(actual.sync).mockRejectedValueOnce(syncFailure());

    const results = await Promise.allSettled([client.getAccounts(), client.getAccounts()]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(actual.init).toHaveBeenCalledTimes(2);
  });
});
