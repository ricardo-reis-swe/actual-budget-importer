import type { Kysely } from 'kysely';

import type { DatabaseSchema } from '../storage/migrations.js';

const CATEGORY_PANEL_KEY = 'category_panel';

export class DisplaySettings {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async isCategoryPanelEnabled(): Promise<boolean> {
    const setting = await this.database
      .selectFrom('application_settings')
      .select('value')
      .where('key', '=', CATEGORY_PANEL_KEY)
      .executeTakeFirst();
    return setting?.value === 'true';
  }

  async setCategoryPanel(enabled: boolean): Promise<void> {
    const value = enabled ? 'true' : 'false';
    await this.database
      .insertInto('application_settings')
      .values({ key: CATEGORY_PANEL_KEY, value })
      .onConflict((conflict) => conflict.column('key').doUpdateSet({ value }))
      .execute();
  }
}
