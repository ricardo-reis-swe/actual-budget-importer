import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { CategoryCatalog } from '../src/categories/category-catalog.js';
import { ApplicationDatabase } from '../src/storage/database.js';

describe('category catalog synchronization', () => {
  it('keeps empty active groups available for category creation', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const catalog = new CategoryCatalog(database.db);

    await expect(catalog.refresh({
      getCategoriesGrouped: vi.fn().mockResolvedValue([{ id: 'empty-group', name: 'Everyday', categories: [] }]),
    })).resolves.toEqual([{ id: 'empty-group', name: 'Everyday', deleted: false, categories: [] }]);

    await database.close();
  });

  it('caches groups and retains categories used by transactions after deletion', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const statement = await database.db.insertInto('statements').values({
      content_hash: 'synthetic-category-catalog', original_filename: 'synthetic.pdf', parser_id: 'synthetic',
      status: 'ready for review', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }).returning('id').executeTakeFirstOrThrow();
    await database.db.insertInto('statement_transactions').values({
      statement_id: statement.id, position: 0, date: '01-01-2026', description: 'Synthetic', amount_cents: -100,
      excluded: 0, stable_import_id: 'synthetic-category-import', actual_category_id: 'deleted-category',
    }).execute();
    const source = { getCategoriesGrouped: vi.fn()
      .mockResolvedValueOnce([{ id: 'group-1', name: 'Needs', categories: [{ id: 'deleted-category', name: 'Old' }, { id: 'hidden-category', name: 'Hidden', hidden: true }] }])
      .mockResolvedValueOnce([{ id: 'group-1', name: 'Needs', categories: [{ id: 'hidden-category', name: 'Hidden', hidden: true }] }]) };
    const catalog = new CategoryCatalog(database.db);

    await catalog.refresh(source);
    await expect(catalog.list()).resolves.toEqual([{ id: 'group-1', name: 'Needs', deleted: false, categories: [
      { id: 'hidden-category', name: 'Hidden', groupId: 'group-1', hidden: true, deleted: false },
      { id: 'deleted-category', name: 'Old', groupId: 'group-1', hidden: false, deleted: false },
    ] }]);
    await catalog.refresh(source);
    await expect(catalog.list()).resolves.toEqual([{ id: 'group-1', name: 'Needs', deleted: false, categories: [
      { id: 'hidden-category', name: 'Hidden', groupId: 'group-1', hidden: true, deleted: false },
      { id: 'deleted-category', name: 'Old', groupId: 'group-1', hidden: false, deleted: true },
    ] }]);
    await database.close();
  });
});
