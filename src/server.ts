import Fastify, { type FastifyInstance } from 'fastify';

import {
  createSanitizedFailure,
  toUserFailure,
  type ProcessingStage,
  type SanitizedFailure,
} from './diagnostics/failure.js';

export interface DatabaseHealth {
  checkHealth(): Promise<void> | void;
}

export interface ApplicationLogger {
  error(failure: SanitizedFailure): void;
}

export interface ServerOptions {
  database: DatabaseHealth;
  logger?: ApplicationLogger;
}

const consoleLogger: ApplicationLogger = {
  error(failure) {
    console.error(JSON.stringify(failure));
  },
};

function logFailure(
  logger: ApplicationLogger,
  cause: unknown,
  stage: ProcessingStage,
): SanitizedFailure {
  const failure = createSanitizedFailure(cause, stage);
  logger.error(failure);
  return failure;
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const logger = options.logger ?? consoleLogger;

  app.get('/api/health', async (_request, reply) => {
    try {
      await options.database.checkHealth();
      return { status: 'ok' };
    } catch (cause) {
      logFailure(logger, cause, 'synchronization');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const failure = logFailure(logger, error, 'synchronization');
    return reply.code(500).send(toUserFailure(failure));
  });

  return app;
}
