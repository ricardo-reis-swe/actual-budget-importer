import { randomUUID } from 'node:crypto';

import { createSanitizedFailure, toUserFailure } from '../diagnostics/failure.js';
import { type DatabaseSchema } from '../storage/migrations.js';
import { type Kysely } from 'kysely';

export type StatementStatus =
  | 'queued'
  | 'processing'
  | 'awaiting parser selection'
  | 'ready for review'
  | 'extraction failed'
  | 'publishing'
  | 'publish failed'
  | 'published';

export interface PaperlessStatementProcessor {
  process(statementId: number): Promise<void>;
}

export class StatementLifecycle {
  private readonly processing = new Set<number>();

  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly paperlessProcessor: PaperlessStatementProcessor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acceptPaperlessDocument(documentId: number): Promise<{ id: number; status: StatementStatus }> {
    const existing = await this.database
      .selectFrom('statements')
      .select(['id', 'status'])
      .where('paperless_document_id', '=', documentId)
      .executeTakeFirst();

    if (existing) {
      return { id: existing.id, status: existing.status as StatementStatus };
    }

    const timestamp = this.now().toISOString();
    const statement = await this.database
      .insertInto('statements')
      .values({
        paperless_document_id: documentId,
        status: 'queued',
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();

    this.schedulePaperlessProcessing(statement.id);
    return { id: statement.id, status: statement.status as StatementStatus };
  }

  async retryPaperlessStatement(statementId: number): Promise<void> {
    const timestamp = this.now().toISOString();
    const updated = await this.database
      .updateTable('statements')
      .set({ status: 'queued', error_message: null, diagnostic_id: null, updated_at: timestamp })
      .where('id', '=', statementId)
      .where('paperless_document_id', 'is not', null)
      .where('status', '=', 'extraction failed')
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) === 1) {
      this.schedulePaperlessProcessing(statementId);
    }
  }

  async recoverAfterRestart(): Promise<void> {
    const interruptedDirectUploads = await this.database
      .selectFrom('statements')
      .select('id')
      .where('paperless_document_id', 'is', null)
      .where('status', 'in', ['queued', 'processing'])
      .execute();

    for (const statement of interruptedDirectUploads) {
      await this.recordExtractionFailure(statement.id);
    }

    const pendingPaperlessStatements = await this.database
      .selectFrom('statements')
      .select('id')
      .where('paperless_document_id', 'is not', null)
      .where('status', 'in', ['queued', 'processing'])
      .execute();

    for (const statement of pendingPaperlessStatements) {
      this.schedulePaperlessProcessing(statement.id);
    }
  }

  private schedulePaperlessProcessing(statementId: number): void {
    queueMicrotask(() => {
      void this.processPaperlessStatement(statementId);
    });
  }

  private async processPaperlessStatement(statementId: number): Promise<void> {
    if (this.processing.has(statementId)) {
      return;
    }

    this.processing.add(statementId);
    try {
      const claim = await this.database
        .updateTable('statements')
        .set({ status: 'processing', updated_at: this.now().toISOString() })
        .where('id', '=', statementId)
        .where('paperless_document_id', 'is not', null)
        .where('status', 'in', ['queued', 'processing'])
        .execute();
      if (Number(claim[0]?.numUpdatedRows ?? 0) !== 1) {
        return;
      }
      await this.paperlessProcessor.process(statementId);
    } catch (cause) {
      await this.recordExtractionFailure(statementId, cause);
    } finally {
      this.processing.delete(statementId);
    }
  }

  private async recordExtractionFailure(statementId: number, cause: unknown = undefined): Promise<void> {
    const failure = createSanitizedFailure(cause, 'extraction', randomUUID());
    await this.database
      .updateTable('statements')
      .set({
        status: 'extraction failed',
        error_message: toUserFailure(failure).message,
        diagnostic_id: failure.diagnosticId,
        updated_at: this.now().toISOString(),
      })
      .where('id', '=', statementId)
      .execute();
  }
}
