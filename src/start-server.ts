import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfiguration } from './config.js';
import { buildServer } from './server.js';
import { StatementManagement } from './statements/statement-management.js';
import { ApplicationDatabase } from './storage/database.js';
import { ActualBudgetClient } from './publishing/actual-budget-client.js';
import { StatementPublisher } from './publishing/statement-publisher.js';
import { CategoryCatalog } from './categories/category-catalog.js';
import { CategoryCreation } from './categories/category-creation.js';
import { CategorizationRules } from './rules/categorization-rules.js';
import { DirectUploadProcessor } from './processing/direct-upload.js';
import { PaperlessClient } from './paperless/paperless-client.js';
import { PaperlessStatementProcessor } from './processing/paperless-statement-processor.js';
import { StatementLifecycle } from './processing/statement-lifecycle.js';
import { activoBankParser } from './parsers/activobank-parser.js';
import { wizinkParser } from './parsers/wizink-parser.js';
import { ParserSettings } from './parsers/parser-settings.js';
import { posbEsavingsParser } from './parsers/posb-esavings-parser.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const configuration = loadConfiguration();
const database = new ApplicationDatabase(configuration.dataDirectory);
await database.migrate(configuration.actualBudget.legacyAccountId);
const parsers = [activoBankParser, wizinkParser, posbEsavingsParser] as const;
const paperlessClient = configuration.paperless ? new PaperlessClient(configuration.paperless) : undefined;
const parserSettings = new ParserSettings(database.db, parsers, paperlessClient);
const categorizationRules = new CategorizationRules(database.db);
const directUploads = new DirectUploadProcessor(database.db, parsers, configuration.maximumPdfSizeBytes, undefined, categorizationRules, configuration.extractionTimeoutMs);
const paperlessProcessor = configuration.paperless
  ? new PaperlessStatementProcessor(database.db, paperlessClient!, parsers, undefined, categorizationRules)
  : undefined;
const paperlessLifecycle = configuration.paperless
  ? new StatementLifecycle(
    database.db,
    paperlessProcessor!,
  )
  : undefined;
if (paperlessLifecycle) await paperlessLifecycle.recoverAfterRestart();
const actualBudget = new ActualBudgetClient(configuration);
const categoryCatalog = new CategoryCatalog(database.db);
const publisher = new StatementPublisher(database.db, actualBudget);
await publisher.recoverInterruptedPublishing();

const app = buildServer({
  database,
  frontendDirectory: resolve('dist'),
  directUploads,
  ...(paperlessLifecycle ? { paperlessLifecycle } : {}),
  ...(paperlessProcessor ? { paperlessControls: paperlessProcessor } : {}),
  categoryCatalog,
  categoryCreation: new CategoryCreation(actualBudget),
  categorizationRules,
  categorySource: actualBudget,
  accountSource: actualBudget,
  parsers,
  parserSettings,
  publisher,
  statements: new StatementManagement(database.db, undefined, paperlessClient, categorizationRules),
});
await categoryCatalog.refresh(actualBudget).catch(() => undefined);
await app.listen({ host: '0.0.0.0', port: configuration.port });

async function close(): Promise<void> {
  await app.close();
  await database.close();
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
