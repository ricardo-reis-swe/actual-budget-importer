import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { StatementLifecycle } from '../src/processing/statement-lifecycle.js';
import { ApplicationDatabase } from '../src/storage/database.js';

async function createDatabase(): Promise<ApplicationDatabase> {
  const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
  await database.migrate();
  return database;
}

describe('statement lifecycle', () => {
  it('durably queues a Paperless document and does not duplicate deliveries', async () => {
    const database = await createDatabase();
    const processor = { process: vi.fn().mockResolvedValue(undefined) };
    const lifecycle = new StatementLifecycle(database.db, processor, () => new Date('2026-01-01T00:00:00Z'));

    const first = await lifecycle.acceptPaperlessDocument(42);
    const duplicate = await lifecycle.acceptPaperlessDocument(42);

    expect(first).toEqual({ id: first.id, status: 'queued' });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.status).toBe('processing');
    await vi.waitFor(() => expect(processor.process).toHaveBeenCalledTimes(1));
    expect(processor.process).toHaveBeenCalledWith(first.id);
    await database.close();
  });

  it('marks interrupted direct uploads as failed and resumes Paperless work after restart', async () => {
    const database = await createDatabase();
    const timestamp = '2026-01-01T00:00:00.000Z';
    const direct = await database.db.insertInto('statements').values({
      content_hash: 'direct-upload', original_filename: 'synthetic.pdf', parser_id: 'activobank',
      status: 'processing', created_at: timestamp, updated_at: timestamp,
    }).returning('id').executeTakeFirstOrThrow();
    const paperless = await database.db.insertInto('statements').values({
      paperless_document_id: 99, status: 'queued', created_at: timestamp, updated_at: timestamp,
    }).returning('id').executeTakeFirstOrThrow();
    const processor = { process: vi.fn().mockResolvedValue(undefined) };
    const lifecycle = new StatementLifecycle(database.db, processor);

    await lifecycle.recoverAfterRestart();

    const failedDirect = await database.db.selectFrom('statements').selectAll().where('id', '=', direct.id).executeTakeFirstOrThrow();
    expect(failedDirect).toMatchObject({ status: 'extraction failed' });
    expect(failedDirect.error_message).toContain('statement extraction failed');
    expect(failedDirect.diagnostic_id).toBeTruthy();
    await vi.waitFor(() => expect(processor.process).toHaveBeenCalledWith(paperless.id));
    await database.close();
  });

  it('records a sanitized extraction failure when Paperless processing fails', async () => {
    const database = await createDatabase();
    const lifecycle = new StatementLifecycle(database.db, {
      process: vi.fn().mockRejectedValue(new Error('password=private transaction=secret')),
    });

    const statement = await lifecycle.acceptPaperlessDocument(11);
    await vi.waitFor(async () => {
      const saved = await database.db.selectFrom('statements').selectAll().where('id', '=', statement.id).executeTakeFirstOrThrow();
      expect(saved.status).toBe('extraction failed');
    });
    const saved = await database.db.selectFrom('statements').selectAll().where('id', '=', statement.id).executeTakeFirstOrThrow();
    expect(saved.error_message).not.toContain('private');
    expect(saved.error_message).not.toContain('secret');
    await database.close();
  });
});
