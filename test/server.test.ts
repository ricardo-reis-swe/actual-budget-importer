import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildServer, type ApplicationLogger } from '../src/server.js';
import { StatementManagement } from '../src/statements/statement-management.js';
import { ApplicationDatabase } from '../src/storage/database.js';

async function createStatementServer() {
  const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
  await database.migrate();
  const timestamp = '2026-01-01T00:00:00.000Z';
  const statement = await database.db.insertInto('statements').values({
    content_hash: 'synthetic-hash',
    original_filename: 'synthetic.pdf',
    parser_id: 'activobank',
    status: 'ready for review',
    created_at: timestamp,
    updated_at: timestamp,
  }).returning('id').executeTakeFirstOrThrow();
  const transaction = await database.db.insertInto('statement_transactions').values({
    statement_id: statement.id,
    position: 0,
    date: '31-12-2025',
    description: 'Synthetic merchant',
    amount_cents: -1234,
    excluded: 0,
    stable_import_id: 'synthetic-import-id',
  }).returning('id').executeTakeFirstOrThrow();
  const app = buildServer({
    database,
    statements: new StatementManagement(database.db, () => new Date(timestamp)),
  });
  return { app, database, statement, transaction };
}

describe('server baseline', () => {
  it('reports a generic healthy status after checking the database', async () => {
    const checkHealth = vi.fn();
    const app = buildServer({ database: { checkHealth } });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(checkHealth).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns no database details when the health check fails', async () => {
    const logger: ApplicationLogger = { error: vi.fn() };
    const app = buildServer({
      database: { checkHealth: () => { throw new Error('password=secret'); } },
      logger,
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'synchronization',
      status: 'failed',
    }));
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('secret');
    await app.close();
  });

  it('returns a sanitized diagnostic response for an unexpected endpoint error', async () => {
    const logger: ApplicationLogger = { error: vi.fn() };
    const app = buildServer({ database: { checkHealth: () => undefined }, logger });
    app.get('/test-error', () => { throw new Error('token=private'); });

    const response = await app.inject({ method: 'GET', url: '/test-error' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      message: expect.stringContaining('contact support with reference'),
    });
    expect(response.body).not.toContain('private');
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('private');
    await app.close();
  });

  it('lists statement summaries and returns a statement with its review data', async () => {
    const { app, database, statement, transaction } = await createStatementServer();

    const list = await app.inject({ method: 'GET', url: '/api/statements' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ statements: [expect.objectContaining({
      id: statement.id, transactionCount: 1, originalFilename: 'synthetic.pdf',
    })] });

    const detail = await app.inject({ method: 'GET', url: `/api/statements/${statement.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: statement.id,
      transactions: [expect.objectContaining({ id: transaction.id, excluded: false })],
    });
    await app.close();
    await database.close();
  });

  it('saves validated review changes and protects published statements', async () => {
    const { app, database, statement, transaction } = await createStatementServer();

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/statements/${statement.id}/transactions/${transaction.id}`,
      payload: { reviewedDate: '01-01-2026', reviewedDescription: '  Edited merchant ', reviewedAmountCents: -456, excluded: true },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      reviewedDate: '01-01-2026', reviewedDescription: 'Edited merchant', reviewedAmountCents: -456, excluded: true,
    });

    await database.db.updateTable('statements').set({ status: 'published' }).where('id', '=', statement.id).execute();
    const publishedUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/statements/${statement.id}/transactions/${transaction.id}`,
      payload: { excluded: false },
    });
    expect(publishedUpdate.statusCode).toBe(400);
    expect(publishedUpdate.json()).toEqual({ message: 'Published statements cannot be edited.' });
    await app.close();
    await database.close();
  });

  it('requires confirmation and removes statement records only when not active', async () => {
    const { app, database, statement } = await createStatementServer();

    const unconfirmed = await app.inject({ method: 'DELETE', url: `/api/statements/${statement.id}` });
    expect(unconfirmed.statusCode).toBe(400);
    const deleted = await app.inject({
      method: 'DELETE', url: `/api/statements/${statement.id}`,
      payload: { confirm: true },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await database.db.selectFrom('statements').select('id').where('id', '=', statement.id).executeTakeFirst()).toBeUndefined();
    expect(await database.db.selectFrom('statement_transactions').select('id').where('statement_id', '=', statement.id).execute()).toEqual([]);
    await app.close();
    await database.close();
  });
});
