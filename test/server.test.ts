import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildServer, type ApplicationLogger } from '../src/server.js';
import { StatementManagement } from '../src/statements/statement-management.js';
import { DirectUploadProcessor } from '../src/processing/direct-upload.js';
import { CategoryCreation } from '../src/categories/category-creation.js';
import { CategorizationRules } from '../src/rules/categorization-rules.js';
import type { BankParser } from '../src/parsers/bank-parser.js';
import { ParserSettings } from '../src/parsers/parser-settings.js';
import { ApplicationDatabase } from '../src/storage/database.js';

function multipart(fields: Record<string, string>, pdf: Buffer): { contentType: string; payload: Buffer } {
  const boundary = 'synthetic-boundary';
  const parts = Object.entries(fields).map(([name, value]) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  ));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n`));
  parts.push(Buffer.from(pdf), Buffer.from(`\r\n--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, payload: Buffer.concat(parts) };
}

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
  const rules = new CategorizationRules(database.db, () => new Date(timestamp));
  const app = buildServer({
    database,
    categorizationRules: rules,
    statements: new StatementManagement(database.db, () => new Date(timestamp), undefined, rules),
  });
  return { app, database, rules, statement, transaction };
}

describe('server baseline', () => {
  it('returns parser setup state and saves a complete parser selection', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const parsers = [
      { countryCode: 'PT', countryName: 'Portugal', enabledByDefault: true, id: 'activobank', name: 'ActivoBank' },
      { countryCode: 'PT', countryName: 'Portugal', enabledByDefault: true, id: 'wizink', name: 'WiZink' },
      { countryCode: 'SG', countryName: 'Singapore', id: 'posb-dbs', name: 'POSB/DBS' },
    ];
    const app = buildServer({ database, parserSettings: new ParserSettings(database.db, parsers) });

    const initial = await app.inject({ method: 'GET', url: '/api/parser-settings' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      paperlessConfigured: false,
      setupComplete: false,
      parsers: [
        { countryCode: 'PT', countryName: 'Portugal', enabled: true, id: 'activobank', name: 'ActivoBank' },
        { countryCode: 'PT', countryName: 'Portugal', enabled: true, id: 'wizink', name: 'WiZink' },
        { countryCode: 'SG', countryName: 'Singapore', enabled: false, id: 'posb-dbs', name: 'POSB/DBS' },
      ],
    });

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/parser-settings/selection',
      payload: { enabledParserIds: ['activobank'] },
    });
    expect(saved.statusCode).toBe(204);
    const visible = await app.inject({ method: 'GET', url: '/api/parsers' });
    expect(visible.json().parsers).toEqual([
      { countryCode: 'PT', countryName: 'Portugal', enabled: true, id: 'activobank', name: 'ActivoBank' },
    ]);
    const completed = await app.inject({ method: 'GET', url: '/api/parser-settings' });
    expect(completed.json().setupComplete).toBe(true);

    await app.close();
    await database.close();
  });

  it('reports when Paperless correspondent matching is available', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const app = buildServer({
      database,
      parserSettings: new ParserSettings(database.db, []),
      paperlessControls: {
        mappings: vi.fn().mockResolvedValue([]),
        retry: vi.fn(),
        selectParser: vi.fn(),
        setMapping: vi.fn(),
        synchronize: vi.fn(),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/parser-settings' });
    expect(response.json().paperlessConfigured).toBe(true);

    await app.close();
    await database.close();
  });

  it('serves the built interface and falls back to it for browser routes', async () => {
    const frontendDirectory = mkdtempSync(join(tmpdir(), 'actual-budget-importer-frontend-'));
    writeFileSync(join(frontendDirectory, 'index.html'), '<!doctype html><title>Actual Budget Importer</title>');
    writeFileSync(join(frontendDirectory, 'app.js'), 'console.log("synthetic");');
    const app = buildServer({ database: { checkHealth: () => undefined }, frontendDirectory });

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.body).toContain('Actual Budget Importer');

    const browserRoute = await app.inject({ method: 'GET', url: '/statements/42' });
    expect(browserRoute.statusCode).toBe(200);
    expect(browserRoute.body).toBe(root.body);

    const asset = await app.inject({ method: 'GET', url: '/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');

    const missingAsset = await app.inject({ method: 'GET', url: '/missing.js' });
    expect(missingAsset.statusCode).toBe(404);
    await app.close();
  });

  it('creates an exclusion-only rule through the API', async () => {
    const { app, database } = await createStatementServer();

    const created = await app.inject({
      method: 'POST',
      url: '/api/categorization-rules',
      payload: { categoryId: null, descriptionContains: 'internal transfer', excluded: true, parserId: null },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ categoryId: null, descriptionContains: 'internal transfer', excluded: true });
    await app.close();
    await database.close();
  });

  it('passes parser selection confirmation through to Paperless controls', async () => {
    const selectParser = vi.fn().mockResolvedValue(undefined);
    const app = buildServer({
      database: { checkHealth: () => undefined },
      paperlessControls: {
        mappings: vi.fn().mockResolvedValue([]),
        retry: vi.fn(),
        selectParser,
        setMapping: vi.fn(),
        synchronize: vi.fn(),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/statements/42/paperless/parser',
      payload: { confirm: true, parserId: 'activobank' },
    });

    expect(response.statusCode).toBe(202);
    expect(selectParser).toHaveBeenCalledWith(42, 'activobank', true);
    await app.close();
  });

  it('accepts configured Paperless webhooks and returns the durable statement state', async () => {
    const acceptPaperlessDocument = vi.fn().mockResolvedValue({ id: 42, status: 'queued' });
    const info = vi.fn();
    const app = buildServer({
      database: { checkHealth: () => undefined },
      logger: { error: vi.fn(), info },
      paperlessLifecycle: { acceptPaperlessDocument },
    });

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paperless',
      headers: { 'content-type': 'application/json' },
      payload: { document_id: 23 },
    });

    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ statementId: 42, status: 'queued' });
    expect(acceptPaperlessDocument).toHaveBeenCalledWith(23);
    expect(info).toHaveBeenCalledWith({
      event: 'paperless_webhook_accepted',
      httpStatus: 202,
      paperlessDocumentId: 23,
      statementId: 42,
      statementStatus: 'queued',
    });

    const parameterEncoded = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paperless',
      headers: { 'content-type': 'application/json' },
      payload: { document_id: '24' },
    });
    expect(parameterEncoded.statusCode).toBe(202);
    expect(acceptPaperlessDocument).toHaveBeenCalledWith(24);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paperless',
      headers: { 'content-type': 'application/json' },
      payload: { document_id: 0 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(info).toHaveBeenCalledWith({
      bodyKeys: ['document_id'],
      bodyKind: 'object',
      contentType: 'application/json',
      documentIdType: 'number',
      event: 'paperless_webhook_rejected',
      httpStatus: 400,
      reason: 'invalid_document_id',
    });

    const formEncoded = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paperless',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'document_id=23',
    });
    expect(formEncoded.statusCode).toBe(202);
    expect(acceptPaperlessDocument).toHaveBeenCalledWith(23);

    const unsupported = await app.inject({
      method: 'POST',
      url: '/api/webhooks/paperless',
      headers: { 'content-type': 'text/plain' },
      payload: 'document_id=23',
    });
    expect(unsupported.statusCode).toBe(415);
    expect(info).toHaveBeenCalledWith({
      event: 'paperless_webhook_rejected',
      httpStatus: 415,
      reason: 'unsupported_content_type',
    });
    await app.close();
  });

  it('manually retrieves a Paperless document through the same duplicate-safe lifecycle', async () => {
    const acceptPaperlessDocument = vi.fn().mockResolvedValue({ id: 42, status: 'processing' });
    const app = buildServer({
      database: { checkHealth: () => undefined },
      paperlessLifecycle: { acceptPaperlessDocument },
    });

    const accepted = await app.inject({
      method: 'POST', url: '/api/statements/paperless', payload: { documentId: 23 },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ statementId: 42, status: 'processing' });
    expect(acceptPaperlessDocument).toHaveBeenCalledWith(23);

    const invalid = await app.inject({
      method: 'POST', url: '/api/statements/paperless', payload: { documentId: '23' },
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('does not expose Paperless routes without the configured integration', async () => {
    const app = buildServer({ database: { checkHealth: () => undefined } });
    const response = await app.inject({ method: 'POST', url: '/api/webhooks/paperless', payload: { document_id: 23 } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('creates categories only with confirmation and returns the Actual Budget category ID', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'actual-category-1', name: 'Groceries' });
    const app = buildServer({
      database: { checkHealth: () => undefined },
      categoryCreation: new CategoryCreation({ createCategory, createCategoryGroup: vi.fn(), deleteCategory: vi.fn(), updateCategory: vi.fn() }),
    });

    const unconfirmed = await app.inject({
      method: 'POST', url: '/api/categories', payload: { confirmed: false, groupId: 'group-1', name: 'Groceries' },
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json()).toEqual({ message: 'Category creation requires confirmation.' });
    expect(createCategory).not.toHaveBeenCalled();

    const created = await app.inject({
      method: 'POST', url: '/api/categories', payload: { confirmed: true, groupId: 'group-1', name: 'Groceries' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ id: 'actual-category-1', name: 'Groceries' });
    expect(createCategory).toHaveBeenCalledWith('group-1', 'Groceries');
    await app.close();
  });

  it('creates category groups only with confirmation and returns the Actual Budget group ID', async () => {
    const createCategoryGroup = vi.fn().mockResolvedValue({ id: 'actual-group-1', name: 'Everyday' });
    const app = buildServer({
      database: { checkHealth: () => undefined },
      categoryCreation: new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup, deleteCategory: vi.fn(), updateCategory: vi.fn() }),
    });

    const unconfirmed = await app.inject({
      method: 'POST', url: '/api/category-groups', payload: { confirmed: false, name: 'Everyday' },
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json()).toEqual({ message: 'Category group creation requires confirmation.' });
    expect(createCategoryGroup).not.toHaveBeenCalled();

    const created = await app.inject({
      method: 'POST', url: '/api/category-groups', payload: { confirmed: true, name: 'Everyday' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ id: 'actual-group-1', name: 'Everyday' });
    expect(createCategoryGroup).toHaveBeenCalledWith('Everyday');
    await app.close();
  });

  it('renames and removes categories through Actual Budget', async () => {
    const updateCategory = vi.fn().mockResolvedValue({ id: 'category-1', name: 'Food' });
    const deleteCategory = vi.fn();
    const app = buildServer({
      database: { checkHealth: () => undefined },
      categoryCreation: new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup: vi.fn(), deleteCategory, updateCategory }),
    });

    const invalidUpdate = await app.inject({
      method: 'PATCH', url: '/api/categories/category-1', payload: { name: ' ' },
    });
    expect(invalidUpdate.statusCode).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();

    const updated = await app.inject({
      method: 'PATCH', url: '/api/categories/category-1', payload: { name: 'Food' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ id: 'category-1', name: 'Food' });
    expect(updateCategory).toHaveBeenCalledWith('category-1', 'Food');

    const unconfirmedDelete = await app.inject({
      method: 'DELETE', url: '/api/categories/category-1', payload: { confirmed: false },
    });
    expect(unconfirmedDelete.statusCode).toBe(400);
    expect(deleteCategory).not.toHaveBeenCalled();

    const deleted = await app.inject({
      method: 'DELETE', url: '/api/categories/category-1', payload: { confirmed: true },
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleteCategory).toHaveBeenCalledWith('category-1');
    await app.close();
  });

  it('queues a direct PDF upload and returns existing statements for duplicate content', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const parser: BankParser = { countryCode: 'PT', countryName: 'Portugal', id: 'synthetic', name: 'Synthetic', parse: vi.fn().mockResolvedValue([]) };
    const app = buildServer({ database, directUploads: new DirectUploadProcessor(database.db, [parser]) });
    const boundary = 'synthetic-boundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parserId"\r\n\r\nsynthetic\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from('%PDF-synthetic'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const first = await app.inject({ method: 'POST', url: '/api/statements/upload', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ statementId: expect.any(Number), status: 'queued' });
    const duplicate = await app.inject({ method: 'POST', url: '/api/statements/upload', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().statementId).toBe(first.json().statementId);
    await app.close();
    await database.close();
  });

  it('retries a failed direct upload only when the original PDF matches', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const parser: BankParser = { countryCode: 'PT', countryName: 'Portugal', id: 'synthetic', name: 'Synthetic', parse: vi.fn().mockResolvedValue([]) };
    const app = buildServer({ database, directUploads: new DirectUploadProcessor(database.db, [parser]) });
    const pdf = Buffer.from('%PDF-synthetic');
    const uploaded = multipart({ parserId: 'synthetic' }, pdf);
    const first = await app.inject({ method: 'POST', url: '/api/statements/upload', headers: { 'content-type': uploaded.contentType }, payload: uploaded.payload });
    const statementId = first.json().statementId;
    await database.db.updateTable('statements').set({ status: 'extraction failed', error_message: 'failed' }).where('id', '=', statementId).execute();
    const retry = await app.inject({ method: 'POST', url: `/api/statements/${statementId}/retry`, headers: { 'content-type': uploaded.contentType }, payload: uploaded.payload });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ statementId, status: 'queued' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(parser.parse).toHaveBeenCalledTimes(2);
    await database.db.updateTable('statements').set({ status: 'extraction failed' }).where('id', '=', statementId).execute();
    const changed = multipart({}, Buffer.from('%PDF-different'));
    const mismatched = await app.inject({ method: 'POST', url: `/api/statements/${statementId}/retry`, headers: { 'content-type': changed.contentType }, payload: changed.payload });
    expect(mismatched.statusCode).toBe(400);
    expect(mismatched.json()).toEqual({ message: 'The selected PDF does not match this statement.' });
    await app.close();
    await database.close();
  });

  it('requires confirmation and the original PDF before changing a direct upload parser', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const oldParser: BankParser = { countryCode: 'PT', countryName: 'Portugal', id: 'old', name: 'Old', parse: vi.fn().mockResolvedValue([]) };
    const newParser: BankParser = { countryCode: 'PT', countryName: 'Portugal', id: 'new', name: 'New', parse: vi.fn().mockResolvedValue([]) };
    const app = buildServer({ database, directUploads: new DirectUploadProcessor(database.db, [oldParser, newParser]) });
    const pdf = Buffer.from('%PDF-synthetic');
    const uploaded = multipart({ parserId: 'old' }, pdf);
    const first = await app.inject({ method: 'POST', url: '/api/statements/upload', headers: { 'content-type': uploaded.contentType }, payload: uploaded.payload });
    const statementId = first.json().statementId;
    await new Promise((resolve) => setImmediate(resolve));
    const transaction = await database.db.insertInto('statement_transactions').values({ statement_id: statementId, position: 1, date: '01-01-2026', description: 'Synthetic', amount_cents: 100, excluded: 0, stable_import_id: 'second-import-id' }).execute();
    expect(transaction).toHaveLength(1);
    const unconfirmed = multipart({ parserId: 'new' }, pdf);
    const rejected = await app.inject({ method: 'POST', url: `/api/statements/${statementId}/parser`, headers: { 'content-type': unconfirmed.contentType }, payload: unconfirmed.payload });
    expect(rejected.statusCode).toBe(400);
    expect(await database.db.selectFrom('statement_transactions').select('id').where('statement_id', '=', statementId).execute()).not.toEqual([]);
    const confirmed = multipart({ parserId: 'new', confirm: 'true' }, pdf);
    const changed = await app.inject({ method: 'POST', url: `/api/statements/${statementId}/parser`, headers: { 'content-type': confirmed.contentType }, payload: confirmed.payload });
    expect(changed.statusCode).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    const statement = await database.db.selectFrom('statements').select(['parser_id', 'status']).where('id', '=', statementId).executeTakeFirstOrThrow();
    expect(statement).toMatchObject({ parser_id: 'new', status: 'ready for review' });
    expect(newParser.parse).toHaveBeenCalledWith(pdf);
    await app.close();
    await database.close();
  });
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
      id: statement.id,
      transactionCount: 1,
      originalFilename: 'synthetic.pdf',
      dateRange: { start: '31-12-2025', end: '31-12-2025' },
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

  it('reports the first rule covering each transaction and refreshes it after review edits', async () => {
    const { app, database, rules, statement, transaction } = await createStatementServer();
    const parserRule = await rules.create({ categoryId: 'groceries', descriptionContains: 'merchant', parserId: 'activobank' });
    await rules.create({ categoryId: 'general', descriptionContains: 'synthetic' });

    const detail = await app.inject({ method: 'GET', url: `/api/statements/${statement.id}` });
    expect(detail.json().transactions[0].matchingRule).toMatchObject({
      id: parserRule.id,
      categoryId: 'groceries',
      descriptionContains: 'merchant',
      parserId: 'activobank',
    });

    const manualOverride = await app.inject({
      method: 'PATCH',
      url: `/api/statements/${statement.id}/transactions/${transaction.id}`,
      payload: { actualCategoryId: 'manual' },
    });
    expect(manualOverride.json().matchingRule.id).toBe(parserRule.id);

    const changedDescription = await app.inject({
      method: 'PATCH',
      url: `/api/statements/${statement.id}/transactions/${transaction.id}`,
      payload: { reviewedDescription: 'Unmatched description' },
    });
    expect(changedDescription.json().matchingRule).toBeNull();

    await app.close();
    await database.close();
  });

  it('orders ISO transaction dates correctly in statement summaries', async () => {
    const { app, database, statement } = await createStatementServer();

    await database.db.insertInto('statement_transactions').values([
      { statement_id: statement.id, position: 1, date: '2026-08-16', description: 'Later transaction', amount_cents: -100, excluded: 0, stable_import_id: 'iso-later' },
      { statement_id: statement.id, position: 2, date: '2026-07-16', description: 'Earlier transaction', amount_cents: -100, excluded: 0, stable_import_id: 'iso-earlier' },
    ]).execute();

    const list = await app.inject({ method: 'GET', url: '/api/statements' });

    expect(list.json()).toEqual({ statements: [expect.objectContaining({
      id: statement.id,
      dateRange: { start: '31-12-2025', end: '2026-08-16' },
    })] });
    await app.close();
    await database.close();
  });

  it('allows published transaction corrections while keeping inclusion locked', async () => {
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
      payload: { actualCategoryId: 'corrected-category', reviewedDescription: 'Corrected merchant' },
    });
    expect(publishedUpdate.statusCode).toBe(200);
    expect(publishedUpdate.json()).toMatchObject({
      actualCategoryId: 'corrected-category', reviewedDescription: 'Corrected merchant', excluded: true,
    });

    const inclusionUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/statements/${statement.id}/transactions/${transaction.id}`,
      payload: { excluded: false },
    });
    expect(inclusionUpdate.statusCode).toBe(400);
    expect(inclusionUpdate.json()).toEqual({ message: 'Transaction inclusion cannot be changed after the statement is published.' });
    await app.close();
    await database.close();
  });

  it('applies matching rules only to uncategorized transactions in an unpublished statement', async () => {
    const { app, database, rules, statement, transaction } = await createStatementServer();
    await rules.create({ categoryId: 'groceries', descriptionContains: 'merchant' });
    await database.db.insertInto('statement_transactions').values({
      statement_id: statement.id, position: 1, date: '01-01-2026', description: 'Merchant already assigned',
      amount_cents: -100, actual_category_id: 'manual', excluded: 0, stable_import_id: 'manual-category',
    }).execute();

    const applied = await app.inject({ method: 'POST', url: `/api/statements/${statement.id}/apply-rules` });

    expect(applied.statusCode).toBe(200);
    expect(applied.json().appliedCount).toBe(1);
    expect(applied.json().statement.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: transaction.id, actualCategoryId: 'groceries' }),
      expect.objectContaining({ actualCategoryId: 'manual' }),
    ]));
    const appliedAgain = await app.inject({ method: 'POST', url: `/api/statements/${statement.id}/apply-rules` });
    expect(appliedAgain.json().appliedCount).toBe(0);
    await app.close();
    await database.close();
  });

  it('applies include and exclude effects without overwriting an assigned category', async () => {
    const { app, database, rules, statement, transaction } = await createStatementServer();
    await database.db.updateTable('statement_transactions').set({ actual_category_id: 'manual' })
      .where('id', '=', transaction.id).execute();
    await rules.create({ categoryId: null, descriptionContains: 'merchant', excluded: true });

    const applied = await app.inject({ method: 'POST', url: `/api/statements/${statement.id}/apply-rules` });

    expect(applied.statusCode).toBe(200);
    expect(applied.json().appliedCount).toBe(1);
    expect(applied.json().statement.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: transaction.id, actualCategoryId: 'manual', excluded: true }),
    ]));
    await database.close();
    await app.close();
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
