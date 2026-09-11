import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { StatementPublisher } from '../src/publishing/statement-publisher.js';
import { ApplicationDatabase } from '../src/storage/database.js';

async function createDatabase(): Promise<ApplicationDatabase> {
  const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
  await database.migrate();
  return database;
}

async function readyStatement(database: ApplicationDatabase): Promise<{ id: number; transactionId: number }> {
  const timestamp = '2026-01-01T00:00:00.000Z';
  const statement = await database.db.insertInto('statements').values({
    content_hash: 'publisher-test',
    original_filename: 'synthetic.pdf',
    parser_id: 'activobank',
    status: 'ready for review',
    created_at: timestamp,
    updated_at: timestamp,
  }).returning('id').executeTakeFirstOrThrow();
  const transaction = await database.db.insertInto('statement_transactions').values({
    amount_cents: -1299,
    date: '02-01-2026',
    description: 'Synthetic Grocer',
    excluded: 0,
    position: 0,
    stable_import_id: 'statement-1-transaction-1',
    statement_id: statement.id,
  }).returning('id').executeTakeFirstOrThrow();
  return { id: statement.id, transactionId: transaction.id };
}

describe('statement publishing', () => {
  it('imports reviewed transactions, verifies them, synchronizes, and records publication', async () => {
    const database = await createDatabase();
    const statement = await readyStatement(database);
    await database.db.updateTable('statement_transactions').set({
      actual_category_id: 'category-1',
      reviewed_amount_cents: -1300,
      reviewed_date: '03-01-2026',
      reviewed_description: 'Reviewed grocer',
    }).where('id', '=', statement.transactionId).execute();
    const actualBudget = {
      importTransactions: vi.fn().mockResolvedValue(undefined),
      findTransactions: vi.fn().mockResolvedValue([{ id: 'actual-1', amount: -1300, date: '2026-01-03', imported_id: 'statement-1-transaction-1' }]),
      synchronize: vi.fn().mockResolvedValue(undefined),
      updateTransaction: vi.fn().mockResolvedValue(undefined),
    };
    const publisher = new StatementPublisher(database.db, actualBudget, () => new Date('2026-01-02T00:00:00.000Z'));

    await publisher.publish(statement.id);

    expect(actualBudget.importTransactions).toHaveBeenCalledWith([expect.objectContaining({
      amount: -1300,
      category: 'category-1',
      date: '2026-01-03',
      imported_id: 'statement-1-transaction-1',
      imported_payee: 'Synthetic Grocer',
      payee_name: 'Reviewed grocer',
    })]);
    expect(actualBudget.updateTransaction).toHaveBeenCalledWith('actual-1', expect.objectContaining({ category: 'category-1' }));
    expect(actualBudget.synchronize).toHaveBeenCalledOnce();
    await expect(database.db.selectFrom('statements').select('status').where('id', '=', statement.id).executeTakeFirstOrThrow())
      .resolves.toEqual({ status: 'published' });
    await expect(database.db.selectFrom('publication_records').selectAll().executeTakeFirstOrThrow())
      .resolves.toMatchObject({ actual_transaction_id: 'actual-1', statement_transaction_id: statement.transactionId });
    await database.close();
  });

  it('keeps the statement unpublished with a sanitized failure when publishing fails', async () => {
    const database = await createDatabase();
    const statement = await readyStatement(database);
    const publisher = new StatementPublisher(database.db, {
      importTransactions: vi.fn().mockRejectedValue(new Error('password=private')),
      findTransactions: vi.fn(), synchronize: vi.fn(), updateTransaction: vi.fn(),
    });

    await expect(publisher.publish(statement.id)).rejects.toThrow('password=private');

    const saved = await database.db.selectFrom('statements').select(['diagnostic_id', 'error_message', 'status']).where('id', '=', statement.id).executeTakeFirstOrThrow();
    expect(saved.status).toBe('publish failed');
    expect(saved.error_message).not.toContain('private');
    expect(saved.diagnostic_id).toBeTruthy();
    await database.close();
  });

  it('verifies only included transactions when exclusions are present', async () => {
    const database = await createDatabase();
    const statement = await readyStatement(database);
    await database.db.insertInto('statement_transactions').values({
      amount_cents: -500,
      date: '02-01-2026',
      description: 'Excluded transaction',
      excluded: 1,
      position: 1,
      stable_import_id: 'statement-1-transaction-2',
      statement_id: statement.id,
    }).execute();
    const actualBudget = {
      importTransactions: vi.fn().mockResolvedValue(undefined),
      findTransactions: vi.fn().mockResolvedValue([{ id: 'actual-1', amount: -1299, date: '2026-01-02', imported_id: 'statement-1-transaction-1' }]),
      synchronize: vi.fn().mockResolvedValue(undefined),
      updateTransaction: vi.fn().mockResolvedValue(undefined),
    };
    await new StatementPublisher(database.db, actualBudget).publish(statement.id);
    expect(actualBudget.importTransactions).toHaveBeenCalledWith([expect.objectContaining({ imported_id: 'statement-1-transaction-1' })]);
    expect(actualBudget.updateTransaction).toHaveBeenCalledOnce();
    await database.close();
  });

  it('marks interrupted publishing as a retryable publish failure after restart', async () => {
    const database = await createDatabase();
    const statement = await readyStatement(database);
    await database.db.updateTable('statements').set({ status: 'publishing' }).where('id', '=', statement.id).execute();
    const publisher = new StatementPublisher(database.db, {
      importTransactions: vi.fn(), findTransactions: vi.fn(), synchronize: vi.fn(), updateTransaction: vi.fn(),
    });

    await publisher.recoverInterruptedPublishing();

    await expect(database.db.selectFrom('statements').select(['error_message', 'status']).where('id', '=', statement.id).executeTakeFirstOrThrow())
      .resolves.toMatchObject({ status: 'publish failed', error_message: expect.stringContaining('publishing failed') });
    await database.close();
  });
});
