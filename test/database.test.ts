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
});
