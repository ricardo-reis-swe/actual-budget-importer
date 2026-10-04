import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actual from '@actual-app/api';
import { describe, expect, it, vi } from 'vitest';

import { loadConfiguration } from '../src/config.js';
import { ActualBudgetClient } from '../src/publishing/actual-budget-client.js';
import { StatementPublisher } from '../src/publishing/statement-publisher.js';
import { StatementManagement } from '../src/statements/statement-management.js';
import { ApplicationDatabase } from '../src/storage/database.js';
import { buildServer } from '../src/server.js';

async function row(database: ApplicationDatabase, hash: string, amount: number, target: string, date = '02-01-2026') {
  const statement = await database.db.insertInto('statements').values({
    content_hash: hash, status: 'ready for review', created_at: '2026-01-01', updated_at: '2026-01-01',
  }).returning('id').executeTakeFirstOrThrow();
  const transaction = await database.db.insertInto('statement_transactions').values({
    statement_id: statement.id, amount_cents: amount, date, description: 'Synthetic transfer',
    excluded: 0, position: 0, stable_import_id: hash, transfer_account_id: target,
  }).returning('id').executeTakeFirstOrThrow();
  return { statementId: statement.id, transactionId: transaction.id };
}

describe('Actual Budget transfers', () => {
  it('creates and reconciles linked transfers from both PDFs, retries, and publishes corrections', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actual-transfer-test-'));
    const database = new ApplicationDatabase(join(directory, 'importer'));
    await database.migrate();
    try {
      mkdirSync(join(directory, 'actual'));
      const engine = await actual.init({ dataDir: join(directory, 'actual'), verbose: false });
      await engine.send('create-budget', { budgetName: 'Synthetic transfer test', avoidUpload: true });
      const first = await actual.createAccount({ name: 'Synthetic current' });
      const second = await actual.createAccount({ name: 'Synthetic savings' });
      const configuration = loadConfiguration({ ACTUAL_SERVER_URL: 'https://actual.example.test', ACTUAL_PASSWORD: 'synthetic', ACTUAL_BUDGET_ID: 'synthetic' });
      const client = new ActualBudgetClient(configuration);
      // Keep this test on its temporary local budget; no server or credentials are used.
      vi.spyOn(client as unknown as { withBudget<T>(operation: () => Promise<T>): Promise<T> }, 'withBudget')
        .mockImplementation(async (operation) => operation());
      vi.spyOn(client, 'synchronize').mockResolvedValue(undefined);
      const publisher = new StatementPublisher(database.db, client);
      const outgoing = await row(database, 'outgoing', -5000, second);
      await publisher.publish(outgoing.statementId, { id: first, name: 'Synthetic current' });
      let sources = await actual.getTransactions(first, '2026-01-01', '2026-12-31');
      let targets = await actual.getTransactions(second, '2026-01-01', '2026-12-31');
      expect(sources).toHaveLength(1);
      expect(targets).toHaveLength(1);
      expect(sources[0]).toMatchObject({ amount: -5000, transfer_id: targets[0]!.id, imported_id: 'outgoing', category: null });
      expect(targets[0]).toMatchObject({ amount: 5000, transfer_id: sources[0]!.id });
      const group = await actual.createCategoryGroup({ name: 'Synthetic expenses' });
      const category = await actual.createCategory({ name: 'Synthetic category', group_id: group });
      await database.db.updateTable('statement_transactions').set({ actual_category_id: category }).where('id', '=', outgoing.transactionId).execute();
      await publisher.publish(outgoing.statementId, { id: first, name: 'Synthetic current' });
      expect((await actual.getTransactions(first, '2026-01-01', '2026-12-31'))[0]?.category).toBeNull();
      const originalIds = [sources[0]!.id, targets[0]!.id];

      const incoming = await row(database, 'incoming', 5000, first, '04-01-2026');
      const synchronize = vi.spyOn(client, 'synchronize').mockRejectedValueOnce(new Error('Synthetic interruption')).mockResolvedValue(undefined);
      await expect(publisher.publish(incoming.statementId, { id: second, name: 'Synthetic savings' })).rejects.toThrow('Synthetic interruption');
      await publisher.publish(incoming.statementId, { id: second, name: 'Synthetic savings' });
      expect(synchronize).toHaveBeenCalled();
      sources = await actual.getTransactions(first, '2026-01-01', '2026-12-31');
      targets = await actual.getTransactions(second, '2026-01-01', '2026-12-31');
      expect(sources).toHaveLength(1);
      expect(targets).toHaveLength(1);
      expect([sources[0]!.id, targets[0]!.id]).toEqual(originalIds);
      expect(targets[0]).toMatchObject({ imported_id: 'incoming', cleared: true, date: '2026-01-04' });

      await new StatementManagement(database.db).updateReview(outgoing.statementId, outgoing.transactionId, { reviewedAmountCents: -6000, reviewedDate: '15-08-2026' });
      await publisher.publish(outgoing.statementId, { id: first, name: 'Synthetic current' });
      sources = await actual.getTransactions(first, '2026-01-01', '2026-12-31');
      targets = await actual.getTransactions(second, '2026-01-01', '2026-12-31');
      expect(sources).toHaveLength(1);
      expect(targets).toHaveLength(1);
      expect(sources[0]).toMatchObject({ id: originalIds[0], amount: -6000, date: '2026-08-15' });
      expect(targets[0]).toMatchObject({ id: originalIds[1], amount: 6000, date: '2026-08-15' });

      const offBudget = await actual.createAccount({ name: 'Synthetic tracking', offbudget: true });
      const crossing = await row(database, 'crossing', -1234, offBudget);
      await database.db.updateTable('statement_transactions').set({ actual_category_id: category }).where('id', '=', crossing.transactionId).execute();
      await publisher.publish(crossing.statementId, { id: first, name: 'Synthetic current' });
      expect((await actual.getTransactions(first, '2026-01-01', '2026-12-31')).find((item) => item.imported_id === 'crossing')?.category).toBe(category);
      const fromTracking = await row(database, 'from-tracking', -2345, first);
      await database.db.updateTable('statement_transactions').set({ actual_category_id: category }).where('id', '=', fromTracking.transactionId).execute();
      await publisher.publish(fromTracking.statementId, { id: offBudget, name: 'Synthetic tracking' });
      const trackingSource = (await actual.getTransactions(offBudget, '2026-01-01', '2026-12-31')).find((item) => item.imported_id === 'from-tracking');
      expect(trackingSource?.category).toBeNull();
      expect((await actual.getTransactions(first, '2026-01-01', '2026-12-31')).find((item) => item.id === trackingSource?.transfer_id)?.category).toBe(category);

      const third = await actual.createAccount({ name: 'Synthetic third' });
      await new StatementManagement(database.db).updateReview(outgoing.statementId, outgoing.transactionId, { transferAccountId: third });
      await publisher.publish(outgoing.statementId, { id: first, name: 'Synthetic current' });
      expect(await actual.getTransactions(second, '2026-01-01', '2026-12-31')).toHaveLength(0);
      expect((await actual.getTransactions(third, '2026-01-01', '2026-12-31'))[0]).toMatchObject({ id: originalIds[1], amount: 6000 });
      await new StatementManagement(database.db).updateReview(outgoing.statementId, outgoing.transactionId, { transferAccountId: null });
      await publisher.publish(outgoing.statementId, { id: first, name: 'Synthetic current' });
      expect((await actual.getTransactions(first, '2026-01-01', '2026-12-31')).find((item) => item.id === originalIds[0])?.transfer_id).toBeNull();
      expect(await actual.getTransactions(third, '2026-01-01', '2026-12-31')).toHaveLength(0);

      await expect(client.resolveTransferPayee(first, first)).rejects.toThrow('different');
      await expect(client.resolveTransferPayee('missing', first)).rejects.toThrow('active');
      const closed = await actual.createAccount({ name: 'Synthetic closed' });
      await actual.closeAccount(closed);
      await expect(client.resolveTransferPayee(closed, first)).rejects.toThrow('active');
    } finally {
      await actual.shutdown();
      await database.close();
      vi.restoreAllMocks();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects self-transfers and closed or missing targets before claiming publication', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'transfer-validation-test-'));
    const database = new ApplicationDatabase(directory);
    await database.migrate();
    const transaction = await row(database, 'validation', -5000, 'current');
    const publish = vi.fn().mockResolvedValue(undefined);
    const app = buildServer({
      database,
      statements: new StatementManagement(database.db),
      publisher: { publish } as unknown as StatementPublisher,
      accountSource: { getAccounts: async () => [
        { id: 'current', name: 'Current', offBudget: false, closed: false },
        { id: 'closed', name: 'Closed', offBudget: false, closed: true },
        { id: 'savings', name: 'Savings', offBudget: false, closed: false },
      ] },
    });
    try {
      for (const target of ['current', 'closed', 'missing']) {
        await new StatementManagement(database.db).updateReview(transaction.statementId, transaction.transactionId, { transferAccountId: target });
        const response = await app.inject({ method: 'POST', url: `/api/statements/${transaction.statementId}/publish`, payload: { accountId: 'current', confirm: true } });
        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('different active transfer account');
      }
      expect(publish).not.toHaveBeenCalled();
      expect((await new StatementManagement(database.db).get(transaction.statementId))?.actualAccount).toBeNull();
      await new StatementManagement(database.db).updateReview(transaction.statementId, transaction.transactionId, { transferAccountId: 'savings' });
      const response = await app.inject({ method: 'POST', url: `/api/statements/${transaction.statementId}/publish`, payload: { accountId: 'current', confirm: true } });
      expect(response.statusCode).toBe(204);
      expect(publish).toHaveBeenCalledOnce();
    } finally {
      await app.close();
      await database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists transfer review choices and rejects malformed account identifiers', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'transfer-review-test-'));
    const database = new ApplicationDatabase(directory);
    await database.migrate();
    const transaction = await row(database, 'review', -5000, 'savings');
    const app = buildServer({ database, statements: new StatementManagement(database.db) });
    try {
      const url = `/api/statements/${transaction.statementId}/transactions/${transaction.transactionId}`;
      const invalid = await app.inject({ method: 'PATCH', url, payload: { transferAccountId: 42 } });
      expect(invalid.statusCode).toBe(400);
      const response = await app.inject({ method: 'PATCH', url, payload: { transferAccountId: 'credit-card' } });
      expect(response.json()).toMatchObject({ transferAccountId: 'credit-card' });
      expect((await new StatementManagement(database.db).get(transaction.statementId))?.transactions[0]?.transferAccountId).toBe('credit-card');
      const cleared = await app.inject({ method: 'PATCH', url, payload: { transferAccountId: null } });
      expect(cleared.json()).toMatchObject({ transferAccountId: null });
    } finally {
      await app.close();
      await database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
