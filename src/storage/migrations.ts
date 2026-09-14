import { type Generated, Kysely } from 'kysely';

export interface DatabaseSchema {
  actual_category_groups: {
    id: string;
    name: string;
    deleted: number;
    position: Generated<number>;
  };
  actual_categories: {
    id: string;
    group_id: string;
    name: string;
    hidden: number;
    deleted: number;
    position: Generated<number>;
  };
  application_settings: {
    key: string;
    value: string;
  };
  categorization_rules: {
    category_id: string;
    category_enabled: number;
    created_at: string;
    description_contains: string;
    id: Generated<number>;
    inclusion_action: string | null;
    parser_id: string | null;
    position: number;
  };
  paperless_parser_mappings: {
    correspondent_id: number;
    parser_id: string;
  };
  parser_settings: {
    enabled: number;
    parser_id: string;
  };
  publication_records: {
    actual_transaction_id: string | null;
    published_at: string | null;
    statement_transaction_id: number;
  };
  schema_migrations: {
    name: string;
  };
  statement_transactions: {
    actual_category_id: string | null;
    amount_cents: number;
    date: string;
    description: string;
    excluded: number;
    id: Generated<number>;
    reviewed_amount_cents: number | null;
    reviewed_date: string | null;
    reviewed_description: string | null;
    stable_import_id: string;
    statement_id: number;
    position: number;
  };
  statements: {
    actual_account_id: string | null;
    actual_account_name: string | null;
    content_hash: string | null;
    created_at: string;
    diagnostic_id: string | null;
    error_message: string | null;
    id: Generated<number>;
    original_filename: string | null;
    paperless_correspondent_id: number | null;
    paperless_correspondent_name: string | null;
    paperless_document_date: string | null;
    paperless_document_id: number | null;
    paperless_document_title: string | null;
    parser_id: string | null;
    status: string;
    updated_at: string;
  };
}

interface Migration {
  name: string;
  up(database: Kysely<DatabaseSchema>): Promise<void>;
}

const migrations: Migration[] = [
  {
    name: '001_initial_statement_storage',
    async up(database) {
      await database.schema
        .createTable('application_settings')
        .ifNotExists()
        .addColumn('key', 'text', (column) => column.primaryKey())
        .addColumn('value', 'text', (column) => column.notNull())
        .execute();

      await database.schema
        .createTable('statements')
        .ifNotExists()
        .addColumn('id', 'integer', (column) => column.primaryKey().autoIncrement())
        .addColumn('content_hash', 'text', (column) => column.unique())
        .addColumn('paperless_document_id', 'integer', (column) => column.unique())
        .addColumn('original_filename', 'text')
        .addColumn('paperless_document_title', 'text')
        .addColumn('paperless_correspondent_id', 'integer')
        .addColumn('paperless_correspondent_name', 'text')
        .addColumn('paperless_document_date', 'text')
        .addColumn('parser_id', 'text')
        .addColumn('status', 'text', (column) => column.notNull())
        .addColumn('error_message', 'text')
        .addColumn('diagnostic_id', 'text')
        .addColumn('created_at', 'text', (column) => column.notNull())
        .addColumn('updated_at', 'text', (column) => column.notNull())
        .execute();

      await database.schema
        .createTable('statement_transactions')
        .ifNotExists()
        .addColumn('id', 'integer', (column) => column.primaryKey().autoIncrement())
        .addColumn('statement_id', 'integer', (column) =>
          column.notNull().references('statements.id').onDelete('cascade'))
        .addColumn('position', 'integer', (column) => column.notNull())
        .addColumn('date', 'text', (column) => column.notNull())
        .addColumn('description', 'text', (column) => column.notNull())
        .addColumn('amount_cents', 'integer', (column) => column.notNull())
        .addColumn('reviewed_date', 'text')
        .addColumn('reviewed_description', 'text')
        .addColumn('reviewed_amount_cents', 'integer')
        .addColumn('actual_category_id', 'text')
        .addColumn('excluded', 'integer', (column) => column.notNull().defaultTo(0))
        .addColumn('stable_import_id', 'text', (column) => column.notNull().unique())
        .addUniqueConstraint('statement_transactions_statement_position', ['statement_id', 'position'])
        .execute();

      await database.schema
        .createTable('categorization_rules')
        .ifNotExists()
        .addColumn('id', 'integer', (column) => column.primaryKey().autoIncrement())
        .addColumn('description_contains', 'text', (column) => column.notNull())
        .addColumn('category_id', 'text', (column) => column.notNull())
        .addColumn('created_at', 'text', (column) => column.notNull())
        .execute();

      await database.schema
        .createTable('paperless_parser_mappings')
        .ifNotExists()
        .addColumn('correspondent_id', 'integer', (column) => column.primaryKey())
        .addColumn('parser_id', 'text', (column) => column.notNull())
        .execute();

      await database.schema
        .createTable('publication_records')
        .ifNotExists()
        .addColumn('statement_transaction_id', 'integer', (column) =>
          column.primaryKey().references('statement_transactions.id').onDelete('cascade'))
        .addColumn('actual_transaction_id', 'text')
        .addColumn('published_at', 'text')
        .execute();
    },
  },
  {
    name: '002_categorization_rule_order',
    async up(database) {
      await database.schema
        .alterTable('categorization_rules')
        .addColumn('position', 'integer', (column) => column.notNull().defaultTo(0))
        .execute();
    },
  },
  {
    name: '003_actual_category_cache',
    async up(database) {
      await database.schema
        .createTable('actual_category_groups')
        .ifNotExists()
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('deleted', 'integer', (column) => column.notNull().defaultTo(0))
        .execute();

      await database.schema
        .createTable('actual_categories')
        .ifNotExists()
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('group_id', 'text', (column) => column.notNull().references('actual_category_groups.id'))
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('hidden', 'integer', (column) => column.notNull().defaultTo(0))
        .addColumn('deleted', 'integer', (column) => column.notNull().defaultTo(0))
        .execute();
    },
  },
  {
    name: '004_categorization_rule_parser_scope',
    async up(database) {
      await database.schema
        .alterTable('categorization_rules')
        .addColumn('parser_id', 'text')
        .execute();
    },
  },
  {
    name: '005_parser_settings',
    async up(database) {
      await database.schema
        .createTable('parser_settings')
        .ifNotExists()
        .addColumn('parser_id', 'text', (column) => column.primaryKey())
        .addColumn('enabled', 'integer', (column) => column.notNull().defaultTo(1))
        .execute();
    },
  },
  {
    name: '006_rule_inclusion_action',
    async up(database) {
      await database.schema
        .alterTable('categorization_rules')
        .addColumn('category_enabled', 'integer', (column) => column.notNull().defaultTo(1))
        .execute();
      await database.schema
        .alterTable('categorization_rules')
        .addColumn('inclusion_action', 'text')
        .execute();
    },
  },
  {
    name: '007_statement_actual_account',
    async up(database) {
      await database.schema
        .alterTable('statements')
        .addColumn('actual_account_id', 'text')
        .execute();
      await database.schema
        .alterTable('statements')
        .addColumn('actual_account_name', 'text')
        .execute();
    },
  },
  {
    name: '008_actual_category_order',
    async up(database) {
      await database.schema
        .alterTable('actual_category_groups')
        .addColumn('position', 'integer', (column) => column.notNull().defaultTo(0))
        .execute();
      await database.schema
        .alterTable('actual_categories')
        .addColumn('position', 'integer', (column) => column.notNull().defaultTo(0))
        .execute();
    },
  },
];

export async function runMigrations(database: Kysely<DatabaseSchema>): Promise<void> {
  await database.schema
    .createTable('schema_migrations')
    .ifNotExists()
    .addColumn('name', 'text', (column) => column.primaryKey())
    .execute();

  for (const migration of migrations) {
    const applied = await database
      .selectFrom('schema_migrations')
      .select('name')
      .where('name', '=', migration.name)
      .executeTakeFirst();

    if (!applied) {
      await migration.up(database);
      await database.insertInto('schema_migrations').values({ name: migration.name }).execute();
    }
  }
}
