import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ParserSettings } from '../src/parsers/parser-settings.js';
import { StatementManagement } from '../src/statements/statement-management.js';
import { ApplicationDatabase } from '../src/storage/database.js';

describe('parser settings', () => {
  it('defaults parsers to visible and persists dropdown visibility', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const settings = new ParserSettings(database.db, [
      { countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank' },
      { countryCode: 'PT', countryName: 'Portugal', id: 'wizink', name: 'WiZink' },
    ]);

    expect(await settings.listParsers()).toHaveLength(2);
    await settings.setParserEnabled('wizink', false);

    expect(await settings.listParsers()).toEqual([{ countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank', enabled: true }]);
    expect(await settings.listParsers(true)).toEqual([
      { countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank', enabled: true },
      { countryCode: 'PT', countryName: 'Portugal', id: 'wizink', name: 'WiZink', enabled: false },
    ]);
    await database.close();
  });

  it('atomically saves the selected parsers and completes initial setup', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const settings = new ParserSettings(database.db, [
      { countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank' },
      { countryCode: 'PT', countryName: 'Portugal', id: 'wizink', name: 'WiZink' },
    ]);

    expect(await settings.isSetupComplete()).toBe(false);
    await settings.saveSelection(['wizink']);

    expect(await settings.isSetupComplete()).toBe(true);
    expect(await settings.listParsers()).toEqual([
      { countryCode: 'PT', countryName: 'Portugal', id: 'wizink', name: 'WiZink', enabled: true },
    ]);
    await expect(settings.saveSelection(['missing'])).rejects.toMatchObject({ code: 'INVALID_PARSER' });
    expect(await settings.listParsers()).toHaveLength(1);
    await database.close();
  });

  it('lists seen Paperless correspondents and saves automatic parser rules', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const settings = new ParserSettings(database.db, [{ countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank' }]);
    await database.db.insertInto('statements').values({
      created_at: '2026-01-01T00:00:00.000Z',
      paperless_correspondent_id: 7,
      paperless_correspondent_name: 'My bank',
      paperless_document_id: 23,
      status: 'awaiting parser selection',
      updated_at: '2026-01-01T00:00:00.000Z',
    }).execute();

    expect(await settings.listCorrespondents()).toEqual([
      { correspondentId: 7, correspondentName: 'My bank', parserId: null },
    ]);
    await settings.setCorrespondentParser(7, 'activobank');
    expect(await settings.listCorrespondents()).toEqual([
      { correspondentId: 7, correspondentName: 'My bank', parserId: 'activobank' },
    ]);
    await settings.setCorrespondentParser(7, null);
    expect((await settings.listCorrespondents())[0]?.parserId).toBeNull();
    await database.close();
  });

  it('resolves and caches missing correspondent names from Paperless', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    await database.db.insertInto('statements').values({
      created_at: '2026-01-01T00:00:00.000Z',
      paperless_correspondent_id: 9,
      paperless_document_id: 24,
      status: 'awaiting parser selection',
      updated_at: '2026-01-01T00:00:00.000Z',
    }).execute();
    const settings = new ParserSettings(
      database.db,
      [{ countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank' }],
      { getCorrespondentName: async () => 'Synthetic bank' },
    );

    expect(await settings.listCorrespondents()).toEqual([
      { correspondentId: 9, correspondentName: 'Synthetic bank', parserId: null },
    ]);
    const statement = await database.db.selectFrom('statements')
      .select('paperless_correspondent_name').executeTakeFirstOrThrow();
    expect(statement.paperless_correspondent_name).toBe('Synthetic bank');
    await database.close();
  });
});

describe('statement correspondent names', () => {
  it('resolves and caches missing names for dashboard cards', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    await database.db.insertInto('statements').values({
      created_at: '2026-01-01T00:00:00.000Z',
      original_filename: 'synthetic.pdf',
      paperless_correspondent_id: 9,
      paperless_document_id: 24,
      status: 'awaiting parser selection',
      updated_at: '2026-01-01T00:00:00.000Z',
    }).execute();
    const statements = new StatementManagement(
      database.db,
      undefined,
      { getCorrespondentName: async () => 'Synthetic bank' },
    );

    expect((await statements.list())[0]?.paperlessCorrespondentName).toBe('Synthetic bank');
    const saved = await database.db.selectFrom('statements')
      .select('paperless_correspondent_name').executeTakeFirstOrThrow();
    expect(saved.paperless_correspondent_name).toBe('Synthetic bank');
    await database.close();
  });
});
