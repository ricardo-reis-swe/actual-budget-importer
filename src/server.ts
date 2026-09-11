import Fastify, { type FastifyInstance } from 'fastify';

import {
  createSanitizedFailure,
  toUserFailure,
  type ProcessingStage,
  type SanitizedFailure,
} from './diagnostics/failure.js';
import {
  StatementManagement,
  StatementManagementError,
  type ReviewUpdate,
} from './statements/statement-management.js';
import {
  DirectUploadError,
  DirectUploadProcessor,
} from './processing/direct-upload.js';

export interface DatabaseHealth {
  checkHealth(): Promise<void> | void;
}

export interface ApplicationLogger {
  error(failure: SanitizedFailure): void;
}

export interface ServerOptions {
  database: DatabaseHealth;
  logger?: ApplicationLogger;
  directUploads?: DirectUploadProcessor;
  statements?: StatementManagement;
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

  app.addContentTypeParser(/^multipart\/form-data(?:;|$)/, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await options.database.checkHealth();
      return { status: 'ok' };
    } catch (cause) {
      logFailure(logger, cause, 'synchronization');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  if (options.statements) {
    const statements = options.statements;

    app.get('/api/statements', async () => ({ statements: await statements.list() }));

    app.get<{ Params: { statementId: string } }>('/api/statements/:statementId', async (request, reply) => {
      const statement = await statements.get(parseId(request.params.statementId));
      return statement ?? reply.code(404).send({ message: 'Statement not found.' });
    });

    app.patch<{ Body: unknown; Params: { statementId: string; transactionId: string } }>(
      '/api/statements/:statementId/transactions/:transactionId',
      async (request, reply) => {
        try {
          const update = validateReviewUpdate(request.body);
          const transaction = await statements.updateReview(
            parseId(request.params.statementId),
            parseId(request.params.transactionId),
            update,
          );
          return transaction ?? reply.code(404).send({ message: 'Statement transaction not found.' });
        } catch (error) {
          return statementManagementError(reply, error);
        }
      },
    );

    app.delete<{ Body: unknown; Params: { statementId: string } }>('/api/statements/:statementId', async (request, reply) => {
      if (!isRecord(request.body) || request.body.confirm !== true) {
        return reply.code(400).send({ message: 'Statement deletion requires confirmation.' });
      }
      try {
        const deleted = await statements.delete(parseId(request.params.statementId));
        return deleted ? reply.code(204).send() : reply.code(404).send({ message: 'Statement not found.' });
      } catch (error) {
        return statementManagementError(reply, error);
      }
    });
  }

  if (options.directUploads) {
    app.post<{ Body: Buffer }>('/api/statements/upload', async (request, reply) => {
      const upload = parseMultipartUpload(request.headers['content-type'], request.body);
      if (!upload) return reply.code(400).send({ message: 'Provide one PDF file and a parser ID.' });
      if (!upload.pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        return reply.code(400).send({ message: 'The uploaded file must be a PDF.' });
      }
      try {
        const result = await options.directUploads!.upload(upload);
        return reply.code(result.duplicate ? 200 : 202).send({ statementId: result.id, status: result.status });
      } catch (error) {
        if (error instanceof DirectUploadError) {
          return reply.code(400).send({ message: error.code === 'INVALID_PARSER'
            ? 'Select an available parser.'
            : 'The PDF exceeds the configured size limit.' });
        }
        throw error;
      }
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    const failure = logFailure(logger, error, 'synchronization');
    return reply.code(500).send(toUserFailure(failure));
  });

  return app;
}

function parseMultipartUpload(contentType: string | undefined, body: Buffer): { filename: string; parserId: string; pdf: Buffer } | undefined {
  const boundary = contentType?.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.[1]
    ?? contentType?.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.[2];
  if (!boundary) return undefined;
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  let file: { filename: string; pdf: Buffer } | undefined;
  let offset = body.indexOf(delimiter) + delimiter.length;
  while (offset >= delimiter.length) {
    if (body.subarray(offset, offset + 2).equals(Buffer.from('--'))) break;
    if (body.subarray(offset, offset + 2).equals(Buffer.from('\r\n'))) offset += 2;
    const next = body.indexOf(delimiter, offset);
    if (next === -1) return undefined;
    const part = body.subarray(offset, next - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) return undefined;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    const name = headers.match(/content-disposition:\s*form-data;[^\r\n]*\bname="([^"]+)"/i)?.[1];
    if (!name) return undefined;
    const value = part.subarray(headerEnd + 4);
    const filename = headers.match(/\bfilename="([^"]*)"/i)?.[1];
    if (filename !== undefined) {
      if (file) return undefined;
      file = { filename, pdf: value };
    } else {
      fields.set(name, value.toString('utf8'));
    }
    offset = next + delimiter.length;
  }
  const parserId = fields.get('parserId')?.trim();
  return file && parserId && file.filename ? { ...file, parserId } : undefined;
}

function parseId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateReviewUpdate(value: unknown): ReviewUpdate {
  if (!isRecord(value)) throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
  const update: ReviewUpdate = {};
  if ('actualCategoryId' in value) {
    if (value.actualCategoryId !== null && (typeof value.actualCategoryId !== 'string' || !value.actualCategoryId.trim())) {
      throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
    }
    update.actualCategoryId = value.actualCategoryId as string | null;
  }
  if ('excluded' in value) {
    if (typeof value.excluded !== 'boolean') throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
    update.excluded = value.excluded;
  }
  if ('reviewedAmountCents' in value) {
    if (!Number.isSafeInteger(value.reviewedAmountCents)) throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
    update.reviewedAmountCents = value.reviewedAmountCents as number;
  }
  if ('reviewedDate' in value) {
    if (typeof value.reviewedDate !== 'string' || !/^\d{2}-\d{2}-\d{4}$/.test(value.reviewedDate)) throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
    update.reviewedDate = value.reviewedDate;
  }
  if ('reviewedDescription' in value) {
    if (typeof value.reviewedDescription !== 'string' || !value.reviewedDescription.trim()) throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
    update.reviewedDescription = value.reviewedDescription.trim();
  }
  return update;
}

function statementManagementError(reply: { code(statusCode: number): { send(payload: { message: string }): unknown } }, error: unknown) {
  if (error instanceof StatementManagementError) {
    const message = error.code === 'STATEMENT_BUSY'
      ? 'The statement cannot be deleted while processing or publishing.'
      : error.code === 'STATEMENT_READ_ONLY'
        ? 'Published statements cannot be edited.'
        : 'The statement review update is invalid.';
    return reply.code(400).send({ message });
  }
  throw error;
}
