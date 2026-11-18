import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actual from '@actual-app/api';
import { describe, expect, it, vi } from 'vitest';

import { loadConfiguration } from '../src/config.js';
import { ActualBudgetClient } from '../src/publishing/actual-budget-client.js';

describe('Actual Budget category management', () => {
  it('renames groups, moves categories between groups, and merges categories in a real budget', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actual-category-test-'));
    try {
      mkdirSync(join(directory, 'actual'));
      const engine = await actual.init({ dataDir: join(directory, 'actual'), verbose: false });
      await engine.send('create-budget', { budgetName: 'Synthetic category test', avoidUpload: true });
      const client = new ActualBudgetClient(loadConfiguration({ ACTUAL_SERVER_URL: 'https://actual.example.test', ACTUAL_PASSWORD: 'synthetic', ACTUAL_BUDGET_ID: 'synthetic' }));
      // Keep this test on its temporary local budget; no server or credentials are used.
      vi.spyOn(client as unknown as { withBudget<T>(operation: () => Promise<T>): Promise<T> }, 'withBudget')
        .mockImplementation(async (operation) => operation());

      const first = await actual.createCategoryGroup({ name: 'Synthetic first' });
      const second = await actual.createCategoryGroup({ name: 'Synthetic second' });
      const removed = await actual.createCategory({ name: 'Synthetic removed', group_id: first });
      const receiving = await actual.createCategory({ name: 'Synthetic receiving', group_id: second });
      const account = await actual.createAccount({ name: 'Synthetic account' });
      await actual.addTransactions(account, [{ date: '2026-01-02', amount: -1234, category: removed }]);

      await client.updateCategoryGroup(first, 'Synthetic renamed');
      await client.updateCategory(removed, 'Synthetic moved', second);
      const groups = await client.getCategoriesGrouped();
      expect(groups.find((group) => group.id === first)?.name).toBe('Synthetic renamed');
      expect(groups.find((group) => group.id === first)?.categories.map((category) => category.id)).not.toContain(removed);
      expect(groups.find((group) => group.id === second)?.categories).toContainEqual(expect.objectContaining({ id: removed, name: 'Synthetic moved' }));

      await client.deleteCategory(removed, receiving);
      const [transaction] = await actual.getTransactions(account, '2026-01-01', '2026-12-31');
      expect(transaction?.category).toBe(receiving);
      expect((await client.getCategoriesGrouped()).flatMap((group) => group.categories).map((category) => category.id)).not.toContain(removed);
    } finally {
      await actual.shutdown();
      vi.restoreAllMocks();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
});
