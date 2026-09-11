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
import {
  CategoryCreation,
  CategoryCreationError,
} from './categories/category-creation.js';

export interface PaperlessStatementLifecycle {
  acceptPaperlessDocument(documentId: number): Promise<{ id: number; status: string }>;
}

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
  categoryCreation?: CategoryCreation;
  paperlessLifecycle?: PaperlessStatementLifecycle;
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

  if (options.categoryCreation) {
    const categoryCreation = options.categoryCreation;

    app.post<{ Body: unknown }>('/api/categories', async (request, reply) => {
      try {
        const category = await categoryCreation.create(validateCategoryCreation(request.body));
        return reply.code(201).send(category);
      } catch (error) {
        if (error instanceof CategoryCreationError) {
          const message = error.code === 'CATEGORY_CREATION_NOT_CONFIRMED'
            ? 'Category creation requires confirmation.'
            : error.code === 'INVALID_CATEGORY_GROUP'
              ? 'Select an existing category group.'
              : 'Provide a category name.';
          return reply.code(400).send({ message });
        }
        throw error;
      }
    });
  }

  if (options.paperlessLifecycle) {
    const paperlessLifecycle = options.paperlessLifecycle;

    app.post<{ Body: unknown }>('/api/webhooks/paperless', async (request, reply) => {
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return reply.code(415).send({ message: 'Use application/json for Paperless-ngx webhooks.' });
      }
      const documentId = documentIdFrom(request.body);
      if (!documentId) {
        return reply.code(400).send({ message: 'Provide a positive integer document_id.' });
      }
      const statement = await paperlessLifecycle.acceptPaperlessDocument(documentId);
      return reply.code(202).send({ statementId: statement.id, status: statement.status });
    });

    app.post<{ Body: unknown }>('/api/statements/paperless', async (request, reply) => {
      const documentId = documentIdFrom(request.body);
      if (!documentId) {
        return reply.code(400).send({ message: 'Provide a positive integer documentId.' });
      }
      const statement = await paperlessLifecycle.acceptPaperlessDocument(documentId);
      return reply.code(202).send({ statementId: statement.id, status: statement.status });
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
        return directUploadError(reply, error);
      }
    });

    app.post<{ Body: Buffer; Params: { statementId: string } }>('/api/statements/:statementId/retry', async (request, reply) => {
      const pdf = parseMultipartPdf(request.headers['content-type'], request.body);
      if (!pdf || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        return reply.code(400).send({ message: 'Select the original PDF to retry extraction.' });
      }
      try {
        const result = await options.directUploads!.retry(parseId(request.params.statementId), pdf);
        return reply.code(202).send({ statementId: result.id, status: result.status });
      } catch (error) {
        return directUploadError(reply, error);
      }
    });

    app.post<{ Body: Buffer; Params: { statementId: string } }>('/api/statements/:statementId/parser', async (request, reply) => {
      const change = parseMultipartParserChange(request.headers['content-type'], request.body);
      if (!change || !change.pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        return reply.code(400).send({ message: 'Provide a parser, confirmation, and the original PDF.' });
      }
      try {
        const result = await options.directUploads!.changeParser(parseId(request.params.statementId), change.parserId, change.pdf, change.confirmed);
        return reply.code(202).send({ statementId: result.id, status: result.status });
      } catch (error) {
        return directUploadError(reply, error);
      }
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error.statusCode === 415) {
      return reply.code(415).send({ message: 'Unsupported content type.' });
    }
    const failure = logFailure(logger, error, 'synchronization');
    return reply.code(500).send(toUserFailure(failure));
  });

  return app;
}

function parseMultipartUpload(contentType: string | undefined, body: Buffer): { filename: string; parserId: string; pdf: Buffer } | undefined {
  const parsed = parseMultipartForm(contentType, body);
  const parserId = parsed?.fields.get('parserId')?.trim();
  const file = parsed?.file;
  return file && parserId && file.filename ? { ...file, parserId } : undefined;
}

function parseMultipartPdf(contentType: string | undefined, body: Buffer): Buffer | undefined {
  return parseMultipartForm(contentType, body)?.file?.pdf;
}

function parseMultipartParserChange(contentType: string | undefined, body: Buffer): { confirmed: boolean; parserId: string; pdf: Buffer } | undefined {
  const parsed = parseMultipartForm(contentType, body);
  const parserId = parsed?.fields.get('parserId')?.trim();
  const confirmed = parsed?.fields.get('confirm') === 'true';
  return parsed?.file && parserId ? { confirmed, parserId, pdf: parsed.file.pdf } : undefined;
}

function parseMultipartForm(contentType: string | undefined, body: Buffer): { fields: Map<string, string>; file?: { filename: string; pdf: Buffer } } | undefined {
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
  return { fields, file };
}

function directUploadError(reply: { code(statusCode: number): { send(payload: { message: string }): unknown } }, error: unknown) {
  if (!(error instanceof DirectUploadError)) throw error;
  const message = error.code === 'INVALID_PARSER'
    ? 'Select an available parser.'
    : error.code === 'PDF_TOO_LARGE'
      ? 'The PDF exceeds the configured size limit.'
      : error.code === 'PDF_CONTENT_CHANGED'
        ? 'The selected PDF does not match this statement.'
        : error.code === 'PARSER_CHANGE_REQUIRES_CONFIRMATION'
          ? 'Changing the parser requires confirmation because review changes will be deleted.'
          : error.code === 'STATEMENT_READ_ONLY'
            ? 'Published statements cannot change parser.'
            : error.code === 'STATEMENT_NOT_FOUND'
              ? 'Statement not found.'
              : error.code === 'STATEMENT_NOT_RETRYABLE'
                ? 'Only statements with failed extraction can be retried.'
                : 'This operation is available only for direct uploads.';
  return reply.code(400).send({ message });
}

function parseId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
  }
  return parsed;
}

function documentIdFrom(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const documentId = value.document_id ?? value.documentId;
  return typeof documentId === 'number' && Number.isSafeInteger(documentId) && documentId > 0
    ? documentId
    : undefined;
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

function validateCategoryCreation(value: unknown): { confirmed: boolean; groupId: string; name: string } {
  if (!isRecord(value)
    || typeof value.confirmed !== 'boolean'
    || typeof value.groupId !== 'string'
    || typeof value.name !== 'string') {
    throw new CategoryCreationError('INVALID_CATEGORY_NAME');
  }
  return { confirmed: value.confirmed, groupId: value.groupId, name: value.name };
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
