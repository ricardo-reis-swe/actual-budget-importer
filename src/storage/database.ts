import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

interface DatabaseSchema {
  application_settings: {
    key: string;
    value: string;
  };
}

export class ApplicationDatabase {
  readonly db: Kysely<DatabaseSchema>;
  private readonly sqlite: Database.Database;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true });
    this.sqlite = new Database(join(dataDirectory, 'actual-budget-importer.sqlite'));
    this.sqlite.pragma('journal_mode = WAL');
    this.db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: this.sqlite }),
    });
  }

  async migrate(): Promise<void> {
    await this.db.schema
      .createTable('application_settings')
      .ifNotExists()
      .addColumn('key', 'text', (column) => column.primaryKey())
      .addColumn('value', 'text', (column) => column.notNull())
      .execute();
  }

  async checkHealth(): Promise<void> {
    await this.db.selectFrom('application_settings').select('key').limit(1).execute();
  }

  async close(): Promise<void> {
    await this.db.destroy();
    this.sqlite.close();
  }
}
