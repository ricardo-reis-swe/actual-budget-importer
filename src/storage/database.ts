import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { type DatabaseSchema, runMigrations } from './migrations.js';

export class ApplicationDatabase {
  readonly db: Kysely<DatabaseSchema>;
  private readonly sqlite: Database.Database;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true });
    this.sqlite = new Database(join(dataDirectory, 'actual-budget-importer.sqlite'));
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('journal_mode = WAL');
    this.db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: this.sqlite }),
    });
  }

  async migrate(legacyActualAccountId?: string): Promise<void> {
    await runMigrations(this.db);
    if (legacyActualAccountId) {
      await this.db
        .updateTable('statements')
        .set({ actual_account_id: legacyActualAccountId })
        .where('actual_account_id', 'is', null)
        .where('status', 'in', ['published', 'publishing', 'republishing', 'publish failed'])
        .execute();
    }
  }

  async checkHealth(): Promise<void> {
    await this.db.selectFrom('application_settings').select('key').limit(1).execute();
  }

  async close(): Promise<void> {
    await this.db.destroy();
    this.sqlite.close();
  }
}
