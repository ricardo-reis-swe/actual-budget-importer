import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApplicationDatabase } from '../src/storage/database.js';

describe('application database', () => {
  it('creates a durable SQLite database with WAL enabled', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'actual-budget-importer-'));
    const database = new ApplicationDatabase(dataDirectory);
    await database.migrate();

    await database.db
      .insertInto('application_settings')
      .values({ key: 'example', value: 'saved' })
      .execute();

    await database.checkHealth();
    const setting = await database.db
      .selectFrom('application_settings')
      .selectAll()
      .where('key', '=', 'example')
      .executeTakeFirstOrThrow();

    expect(setting).toEqual({ key: 'example', value: 'saved' });
    await database.close();
  });

  it('migrates statement review data without retaining source PDFs', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'actual-budget-importer-'));
    const database = new ApplicationDatabase(dataDirectory);
    await database.migrate();
    await database.migrate();

    const statement = await database.db
      .insertInto('statements')
      .values({
        content_hash: 'synthetic-content-hash',
        original_filename: 'synthetic-statement.pdf',
        parser_id: 'activobank',
        status: 'ready for review',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await database.db
      .insertInto('statement_transactions')
      .values({
        statement_id: statement.id,
        position: 0,
        date: '31-12-2025',
        description: 'Synthetic merchant',
        amount_cents: -1234,
        excluded: 0,
        stable_import_id: 'synthetic-import-id',
      })
      .execute();

    const savedStatement = await database.db
      .selectFrom('statements')
      .selectAll()
      .where('id', '=', statement.id)
      .executeTakeFirstOrThrow();
    const transaction = await database.db
      .selectFrom('statement_transactions')
      .selectAll()
      .where('statement_id', '=', statement.id)
      .executeTakeFirstOrThrow();

    expect(savedStatement).not.toHaveProperty('pdf');
    expect(transaction).toMatchObject({ amount_cents: -1234, position: 0 });
    await database.close();
  });

  it('uses the former configured account only to backfill existing publication attempts', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const timestamp = '2026-01-01T00:00:00.000Z';
    await database.db.insertInto('statements').values([
      { content_hash: 'published', status: 'published', created_at: timestamp, updated_at: timestamp },
      { content_hash: 'failed', status: 'publish failed', created_at: timestamp, updated_at: timestamp },
      { content_hash: 'ready', status: 'ready for review', created_at: timestamp, updated_at: timestamp },
    ]).execute();

    await database.migrate('legacy-account');

    const statements = await database.db.selectFrom('statements').select(['actual_account_id', 'status']).orderBy('id').execute();
    expect(statements).toEqual([
      { actual_account_id: 'legacy-account', status: 'published' },
      { actual_account_id: 'legacy-account', status: 'publish failed' },
      { actual_account_id: null, status: 'ready for review' },
    ]);
    await database.close();
  });
});
