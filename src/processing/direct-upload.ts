import { createHash, randomUUID } from 'node:crypto';

import { type Kysely } from 'kysely';

import { createSanitizedFailure, toUserFailure } from '../diagnostics/failure.js';
import { type BankParser } from '../parsers/bank-parser.js';
import { type CategorizationRuleMatcher } from '../rules/categorization-rules.js';
import { type DatabaseSchema } from '../storage/migrations.js';

export const defaultMaximumPdfSizeBytes = 100 * 1024 * 1024;

export class DirectUploadError extends Error {
  constructor(readonly code:
    | 'INVALID_PARSER'
    | 'PDF_CONTENT_CHANGED'
    | 'PDF_TOO_LARGE'
    | 'PARSER_CHANGE_REQUIRES_CONFIRMATION'
    | 'STATEMENT_NOT_DIRECT_UPLOAD'
    | 'STATEMENT_NOT_FOUND'
    | 'STATEMENT_NOT_RETRYABLE'
    | 'STATEMENT_READ_ONLY') {
    super(code);
  }
}

export interface DirectUpload {
  filename: string;
  parserId: string;
  pdf: Uint8Array;
}

export interface DirectUploadResult {
  id: number;
  status: string;
  duplicate: boolean;
}

/** Stores direct-upload metadata, retaining PDF bytes only while extracting. */
export class DirectUploadProcessor {
  private readonly parsers: ReadonlyMap<string, BankParser>;

  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    parsers: readonly BankParser[],
    private readonly maximumPdfSizeBytes = defaultMaximumPdfSizeBytes,
    private readonly now: () => Date = () => new Date(),
    private readonly categorizationRules?: CategorizationRuleMatcher,
    private readonly extractionTimeoutMs = 5 * 60 * 1000,
  ) {
    this.parsers = new Map(parsers.map((parser) => [parser.id, parser]));
  }

  async upload(upload: DirectUpload): Promise<DirectUploadResult> {
    const parser = this.requireParser(upload.parserId);
    this.validatePdfSize(upload.pdf);

    const contentHash = createHash('sha256').update(upload.pdf).digest('hex');
    const existing = await this.database
      .selectFrom('statements')
      .select(['id', 'status'])
      .where('content_hash', '=', contentHash)
      .executeTakeFirst();
    if (existing) return { id: existing.id, status: existing.status, duplicate: true };

    const timestamp = this.now().toISOString();
    const statement = await this.database
      .insertInto('statements')
      .values({
        content_hash: contentHash,
        original_filename: upload.filename,
        parser_id: parser.id,
        status: 'queued',
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();

    queueMicrotask(() => { void this.extract(statement.id, parser, upload.pdf); });
    return { id: statement.id, status: statement.status, duplicate: false };
  }

  async retry(statementId: number, pdf: Uint8Array): Promise<DirectUploadResult> {
    this.validatePdfSize(pdf);
    const statement = await this.requireDirectUpload(statementId);
    if (statement.status !== 'extraction failed') throw new DirectUploadError('STATEMENT_NOT_RETRYABLE');
    this.requireMatchingPdf(statement.content_hash, pdf);
    const parser = this.requireParser(statement.parser_id);
    await this.database.updateTable('statements').set({
      diagnostic_id: null,
      error_message: null,
      status: 'queued',
      updated_at: this.now().toISOString(),
    }).where('id', '=', statement.id).execute();
    queueMicrotask(() => { void this.extract(statement.id, parser, pdf); });
    return { id: statement.id, status: 'queued', duplicate: false };
  }

  async changeParser(statementId: number, parserId: string, pdf: Uint8Array, confirmed: boolean): Promise<DirectUploadResult> {
    if (!confirmed) throw new DirectUploadError('PARSER_CHANGE_REQUIRES_CONFIRMATION');
    this.validatePdfSize(pdf);
    const statement = await this.requireDirectUpload(statementId);
    if (statement.status === 'published') throw new DirectUploadError('STATEMENT_READ_ONLY');
    this.requireMatchingPdf(statement.content_hash, pdf);
    const parser = this.requireParser(parserId);
    await this.database.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('statement_transactions').where('statement_id', '=', statement.id).execute();
      await transaction.updateTable('statements').set({
        diagnostic_id: null,
        error_message: null,
        parser_id: parser.id,
        status: 'queued',
        updated_at: this.now().toISOString(),
      }).where('id', '=', statement.id).execute();
    });
    queueMicrotask(() => { void this.extract(statement.id, parser, pdf); });
    return { id: statement.id, status: 'queued', duplicate: false };
  }

  private requireParser(parserId: string): BankParser {
    const parser = this.parsers.get(parserId);
    if (!parser) throw new DirectUploadError('INVALID_PARSER');
    return parser;
  }

  private validatePdfSize(pdf: Uint8Array): void {
    if (pdf.byteLength > this.maximumPdfSizeBytes) throw new DirectUploadError('PDF_TOO_LARGE');
  }

  private requireMatchingPdf(contentHash: string | null, pdf: Uint8Array): void {
    const uploadedHash = createHash('sha256').update(pdf).digest('hex');
    if (contentHash !== uploadedHash) throw new DirectUploadError('PDF_CONTENT_CHANGED');
  }

  private async requireDirectUpload(statementId: number) {
    const statement = await this.database.selectFrom('statements').select([
      'content_hash', 'id', 'paperless_document_id', 'parser_id', 'status',
    ]).where('id', '=', statementId).executeTakeFirst();
    if (!statement) throw new DirectUploadError('STATEMENT_NOT_FOUND');
    if (statement.paperless_document_id !== null || statement.content_hash === null || statement.parser_id === null) {
      throw new DirectUploadError('STATEMENT_NOT_DIRECT_UPLOAD');
    }
    return { ...statement, content_hash: statement.content_hash, parser_id: statement.parser_id };
  }

  private async extract(statementId: number, parser: BankParser, pdf: Uint8Array): Promise<void> {
    try {
      const claimed = await this.database
        .updateTable('statements')
        .set({ status: 'processing', updated_at: this.now().toISOString() })
        .where('id', '=', statementId)
        .where('parser_id', '=', parser.id)
        .where('status', '=', 'queued')
        .executeTakeFirst();
      if (Number(claimed.numUpdatedRows) !== 1) return;

      const transactions = await Promise.race([
        parser.parse(pdf),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PDF extraction timed out.')), this.extractionTimeoutMs)),
      ]);
      const categorizedTransactions = await Promise.all(transactions.map(async (row) => {
        const rule = await this.categorizationRules?.match(row.description, parser.id);
        return { ...row, categoryId: rule?.categoryId ?? null, excluded: rule?.excluded ?? false };
      }));
      await this.database.transaction().execute(async (transaction) => {
        const current = await transaction.selectFrom('statements').select(['parser_id', 'status'])
          .where('id', '=', statementId).executeTakeFirst();
        if (current?.status !== 'processing' || current.parser_id !== parser.id) return;
        if (categorizedTransactions.length > 0) {
          await transaction.insertInto('statement_transactions').values(categorizedTransactions.map((row) => ({
            actual_category_id: row.categoryId,
            statement_id: statementId,
            position: row.position,
            date: row.date,
            description: row.description,
            amount_cents: row.amountCents,
            excluded: row.excluded ? 1 : 0,
            stable_import_id: randomUUID(),
          }))).execute();
        }
        await transaction.updateTable('statements')
          .set({ status: 'ready for review', updated_at: this.now().toISOString() })
          .where('id', '=', statementId)
          .execute();
      });
    } catch (cause) {
      const failure = createSanitizedFailure(cause, 'extraction', randomUUID());
      await this.database.updateTable('statements').set({
        status: 'extraction failed',
        error_message: toUserFailure(failure).message,
        diagnostic_id: failure.diagnosticId,
        updated_at: this.now().toISOString(),
      }).where('id', '=', statementId).where('parser_id', '=', parser.id).where('status', '=', 'processing').execute();
    }
  }
}
