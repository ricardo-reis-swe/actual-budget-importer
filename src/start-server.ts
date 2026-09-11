import { existsSync } from 'node:fs';

import { loadConfiguration } from './config.js';
import { buildServer } from './server.js';
import { StatementManagement } from './statements/statement-management.js';
import { ApplicationDatabase } from './storage/database.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const configuration = loadConfiguration();
const database = new ApplicationDatabase(configuration.dataDirectory);
await database.migrate();

const app = buildServer({
  database,
  statements: new StatementManagement(database.db),
});
await app.listen({ host: '0.0.0.0', port: configuration.port });

async function close(): Promise<void> {
  await app.close();
  await database.close();
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
