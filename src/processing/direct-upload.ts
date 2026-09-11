import { createHash, randomUUID } from 'node:crypto';

import { type Kysely } from 'kysely';

import { createSanitizedFailure, toUserFailure } from '../diagnostics/failure.js';
import { type BankParser } from '../parsers/bank-parser.js';
import { type DatabaseSchema } from '../storage/migrations.js';

export const defaultMaximumPdfSizeBytes = 100 * 1024 * 1024;

export class DirectUploadError extends Error {
  constructor(readonly code: 'INVALID_PARSER' | 'PDF_TOO_LARGE') {
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
  ) {
    this.parsers = new Map(parsers.map((parser) => [parser.id, parser]));
  }

  async upload(upload: DirectUpload): Promise<DirectUploadResult> {
    const parser = this.parsers.get(upload.parserId);
    if (!parser) throw new DirectUploadError('INVALID_PARSER');
    if (upload.pdf.byteLength > this.maximumPdfSizeBytes) throw new DirectUploadError('PDF_TOO_LARGE');

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

  private async extract(statementId: number, parser: BankParser, pdf: Uint8Array): Promise<void> {
    try {
      const claimed = await this.database
        .updateTable('statements')
        .set({ status: 'processing', updated_at: this.now().toISOString() })
        .where('id', '=', statementId)
        .where('status', '=', 'queued')
        .executeTakeFirst();
      if (Number(claimed.numUpdatedRows) !== 1) return;

      const transactions = await parser.parse(pdf);
      await this.database.transaction().execute(async (transaction) => {
        if (transactions.length > 0) {
          await transaction.insertInto('statement_transactions').values(transactions.map((row) => ({
            statement_id: statementId,
            position: row.position,
            date: row.date,
            description: row.description,
            amount_cents: row.amountCents,
            excluded: 0,
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
      }).where('id', '=', statementId).execute();
    }
  }
}
