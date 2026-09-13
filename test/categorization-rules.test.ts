import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CategorizationRuleError,
  CategorizationRules,
} from '../src/rules/categorization-rules.js';
import { DirectUploadProcessor } from '../src/processing/direct-upload.js';
import { ApplicationDatabase } from '../src/storage/database.js';

async function createRules(): Promise<{ database: ApplicationDatabase; rules: CategorizationRules }> {
  const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
  await database.migrate();
  return { database, rules: new CategorizationRules(database.db, () => new Date('2026-01-01T00:00:00.000Z')) };
}

describe('categorization rules', () => {
  it('persists rules in their matching order and finds case-insensitive substrings', async () => {
    const { database, rules } = await createRules();
    const coffee = await rules.create({ categoryId: 'coffee', descriptionContains: 'Coffee' });
    const market = await rules.create({ categoryId: 'groceries', descriptionContains: 'MARKET' });

    expect(await rules.match('Morning COFFEE shop')).toBe('coffee');
    expect(await rules.match('Local market')).toBe('groceries');
    expect(await rules.match('Unrelated purchase')).toBeNull();
    expect(await rules.list()).toEqual([
      expect.objectContaining({ id: coffee.id, position: 0 }),
      expect.objectContaining({ id: market.id, position: 1 }),
    ]);
    await database.close();
  });

  it('uses the first matching rule after the user reorders rules', async () => {
    const { database, rules } = await createRules();
    const broad = await rules.create({ categoryId: 'general', descriptionContains: 'shop' });
    const specific = await rules.create({ categoryId: 'coffee', descriptionContains: 'coffee shop' });

    expect(await rules.match('Coffee shop')).toBe('general');
    await rules.reorder([specific.id, broad.id]);
    expect(await rules.match('Coffee shop')).toBe('coffee');
    await database.close();
  });

  it('uses a parser-scoped rule only for its selected parser', async () => {
    const { database, rules } = await createRules();
    await rules.create({ categoryId: 'coffee', descriptionContains: 'coffee', parserId: 'activobank' });
    await rules.create({ categoryId: 'general', descriptionContains: 'coffee' });

    expect(await rules.match('Coffee shop', 'activobank')).toBe('coffee');
    expect(await rules.match('Coffee shop', 'wizink')).toBe('general');
    await database.close();
  });

  it('validates matching text and keeps the category and text editable', async () => {
    const { database, rules } = await createRules();
    await expect(rules.create({ categoryId: 'groceries', descriptionContains: '   ' }))
      .rejects.toEqual(new CategorizationRuleError('INVALID_MATCH_TEXT'));
    await expect(rules.create({ categoryId: '  ', descriptionContains: 'market' }))
      .rejects.toEqual(new CategorizationRuleError('INVALID_CATEGORY'));

    const saved = await rules.create({ categoryId: 'groceries', descriptionContains: 'market' });
    await expect(rules.update(saved.id, { categoryId: 'home', descriptionContains: 'hardware' }))
      .resolves.toMatchObject({ categoryId: 'home', descriptionContains: 'hardware' });
    await expect(rules.match('Hardware Market')).resolves.toBe('home');
    await database.close();
  });

  it('applies saved rules while extracting a new direct upload', async () => {
    const { database, rules } = await createRules();
    await rules.create({ categoryId: 'coffee', descriptionContains: 'coffee' });
    const processor = new DirectUploadProcessor(
      database.db,
      [{ id: 'synthetic', name: 'Synthetic', parse: async () => [{ position: 0, date: '01-01-2026', description: 'Coffee shop', amountCents: -450 }] }],
      undefined,
      undefined,
      rules,
    );

    const uploaded = await processor.upload({ filename: 'synthetic.pdf', parserId: 'synthetic', pdf: Buffer.from('%PDF-synthetic') });
    await new Promise((resolve) => setImmediate(resolve));
    const transaction = await database.db.selectFrom('statement_transactions').select('actual_category_id')
      .where('statement_id', '=', uploaded.id).executeTakeFirstOrThrow();

    expect(transaction.actual_category_id).toBe('coffee');
    await database.close();
  });
});
