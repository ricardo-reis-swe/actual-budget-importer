import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DisplaySettings } from '../src/settings/display-settings.js';
import { ApplicationDatabase } from '../src/storage/database.js';

describe('display settings', () => {
  it('defaults the category panel off and persists changes', async () => {
    const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-')));
    await database.migrate();
    const settings = new DisplaySettings(database.db);

    expect(await settings.isCategoryPanelEnabled()).toBe(false);
    await settings.setCategoryPanel(true);
    expect(await settings.isCategoryPanelEnabled()).toBe(true);
    expect(await new DisplaySettings(database.db).isCategoryPanelEnabled()).toBe(true);

    await settings.setCategoryPanel(false);
    expect(await settings.isCategoryPanelEnabled()).toBe(false);
    await database.close();
  });
});
