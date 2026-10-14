import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.js';
import { DisplaySettings } from '../src/settings/display-settings.js';
import { ApplicationDatabase } from '../src/storage/database.js';

async function createSettingsServer() {
  const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
  await database.migrate();
  const app = buildServer({ database, displaySettings: new DisplaySettings(database.db) });
  return { app, database };
}

describe('settings API', () => {
  it('defaults the category panel off and persists changes', async () => {
    const { app, database } = await createSettingsServer();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/settings' });
      expect(initial.statusCode).toBe(200);
      expect(initial.json()).toEqual({ categoryPanel: false });

      const update = await app.inject({ method: 'PUT', url: '/api/settings/category-panel', payload: { enabled: true } });
      expect(update.statusCode).toBe(204);

      const after = await app.inject({ method: 'GET', url: '/api/settings' });
      expect(after.json()).toEqual({ categoryPanel: true });
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('rejects an invalid category panel body', async () => {
    const { app, database } = await createSettingsServer();
    try {
      const response = await app.inject({ method: 'PUT', url: '/api/settings/category-panel', payload: { enabled: 'yes' } });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
