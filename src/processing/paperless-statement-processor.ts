import { createHash, randomUUID } from 'node:crypto';

import { type Kysely } from 'kysely';

import { createSanitizedFailure, toUserFailure } from '../diagnostics/failure.js';
import { type PaperlessClient, type PaperlessDocument } from '../paperless/paperless-client.js';
import { type BankParser } from '../parsers/bank-parser.js';
import { type DatabaseSchema } from '../storage/migrations.js';

export class PaperlessStatementError extends Error {
  constructor(readonly code: 'INVALID_PARSER' | 'STATEMENT_NOT_FOUND' | 'STATEMENT_NOT_PAPERLESS' | 'STATEMENT_NOT_RETRYABLE' | 'STATEMENT_READ_ONLY') {
    super(code);
  }
}

export class PaperlessStatementProcessor {
  private readonly parsers: ReadonlyMap<string, BankParser>;

  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly paperless: PaperlessClient,
    parsers: readonly BankParser[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.parsers = new Map(parsers.map((parser) => [parser.id, parser]));
  }

  async process(statementId: number): Promise<void> {
    const statement = await this.requirePaperless(statementId);
    const document = await this.paperless.getDocument(statement.paperless_document_id);
    await this.saveMetadata(statementId, document);
    const mapping = document.correspondentId === null ? undefined : await this.database
      .selectFrom('paperless_parser_mappings').select('parser_id')
      .where('correspondent_id', '=', document.correspondentId).executeTakeFirst();
    if (!mapping) {
      await this.database.updateTable('statements').set({
        status: 'awaiting parser selection', updated_at: this.now().toISOString(),
      }).where('id', '=', statementId).where('status', '=', 'processing').execute();
      return;
    }
    await this.extract(statementId, this.requireParser(mapping.parser_id), document.id);
  }

  async selectParser(statementId: number, parserId: string): Promise<void> {
    const statement = await this.requirePaperless(statementId);
    if (statement.status === 'published') throw new PaperlessStatementError('STATEMENT_READ_ONLY');
    const parser = this.requireParser(parserId);
    await this.database.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('statement_transactions').where('statement_id', '=', statementId).execute();
      await transaction.updateTable('statements').set({
        parser_id: parser.id, status: 'processing', error_message: null, diagnostic_id: null,
        updated_at: this.now().toISOString(),
      }).where('id', '=', statementId).execute();
    });
    await this.extract(statementId, parser, statement.paperless_document_id);
  }

  async retry(statementId: number): Promise<void> {
    const statement = await this.requirePaperless(statementId);
    if (statement.status !== 'extraction failed') throw new PaperlessStatementError('STATEMENT_NOT_RETRYABLE');
    await this.database.updateTable('statements').set({
      status: 'queued', error_message: null, diagnostic_id: null, updated_at: this.now().toISOString(),
    }).where('id', '=', statementId).execute();
    await this.processQueued(statementId);
  }

  async synchronize(statementId: number): Promise<void> {
    const statement = await this.requirePaperless(statementId);
    try {
      await this.saveMetadata(statementId, await this.paperless.getDocument(statement.paperless_document_id));
    } catch (cause) {
      const failure = createSanitizedFailure(cause, 'synchronization', randomUUID());
      throw new PaperlessSynchronizationError(toUserFailure(failure).message);
    }
  }

  async setMapping(correspondentId: number, parserId: string): Promise<void> {
    if (!Number.isSafeInteger(correspondentId) || correspondentId < 1) throw new PaperlessStatementError('INVALID_PARSER');
    this.requireParser(parserId);
    await this.database.insertInto('paperless_parser_mappings').values({ correspondent_id: correspondentId, parser_id: parserId })
      .onConflict((conflict) => conflict.column('correspondent_id').doUpdateSet({ parser_id: parserId })).execute();
  }

  async mappings(): Promise<{ correspondentId: number; parserId: string }[]> {
    return (await this.database.selectFrom('paperless_parser_mappings').selectAll().orderBy('correspondent_id').execute())
      .map((mapping) => ({ correspondentId: mapping.correspondent_id, parserId: mapping.parser_id }));
  }

  private async processQueued(statementId: number): Promise<void> {
    const claimed = await this.database.updateTable('statements').set({ status: 'processing', updated_at: this.now().toISOString() })
      .where('id', '=', statementId).where('status', '=', 'queued').executeTakeFirst();
    if (Number(claimed.numUpdatedRows) !== 1) return;
    try { await this.process(statementId); } catch (cause) { await this.recordFailure(statementId, cause); }
  }

  private async extract(statementId: number, parser: BankParser, documentId: number): Promise<void> {
    try {
      const pdf = await this.paperless.getOriginalPdf(documentId);
      const rows = await parser.parse(pdf);
      if (rows.length === 0) throw new Error('No transactions extracted.');
      const contentHash = createHash('sha256').update(pdf).digest('hex');
      await this.database.transaction().execute(async (transaction) => {
        await transaction.deleteFrom('statement_transactions').where('statement_id', '=', statementId).execute();
        await transaction.insertInto('statement_transactions').values(rows.map((row) => ({
          statement_id: statementId, position: row.position, date: row.date, description: row.description,
          amount_cents: row.amountCents, excluded: 0, stable_import_id: randomUUID(),
        }))).execute();
        await transaction.updateTable('statements').set({ content_hash: contentHash, parser_id: parser.id,
          status: 'ready for review', error_message: null, diagnostic_id: null, updated_at: this.now().toISOString() })
          .where('id', '=', statementId).execute();
      });
    } catch (cause) { await this.recordFailure(statementId, cause); }
  }

  private async saveMetadata(statementId: number, document: PaperlessDocument): Promise<void> {
    await this.database.updateTable('statements').set({ original_filename: document.originalFilename,
      paperless_document_title: document.title, paperless_correspondent_id: document.correspondentId,
      paperless_correspondent_name: document.correspondentName, paperless_document_date: document.documentDate,
      updated_at: this.now().toISOString() }).where('id', '=', statementId).execute();
  }

  private async recordFailure(statementId: number, cause: unknown): Promise<void> {
    const failure = createSanitizedFailure(cause, 'extraction', randomUUID());
    await this.database.updateTable('statements').set({ status: 'extraction failed', error_message: toUserFailure(failure).message,
      diagnostic_id: failure.diagnosticId, updated_at: this.now().toISOString() }).where('id', '=', statementId).execute();
  }

  private requireParser(parserId: string): BankParser {
    const parser = this.parsers.get(parserId);
    if (!parser) throw new PaperlessStatementError('INVALID_PARSER');
    return parser;
  }

  private async requirePaperless(statementId: number) {
    const statement = await this.database.selectFrom('statements').select(['id', 'paperless_document_id', 'status'])
      .where('id', '=', statementId).executeTakeFirst();
    if (!statement) throw new PaperlessStatementError('STATEMENT_NOT_FOUND');
    if (statement.paperless_document_id === null) throw new PaperlessStatementError('STATEMENT_NOT_PAPERLESS');
    return { ...statement, id: statement.id, paperless_document_id: statement.paperless_document_id };
  }
}

export class PaperlessSynchronizationError extends Error {}
