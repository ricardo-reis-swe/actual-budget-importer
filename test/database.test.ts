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
});
