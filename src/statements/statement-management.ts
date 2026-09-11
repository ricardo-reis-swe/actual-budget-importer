import { type Kysely } from 'kysely';

import { type DatabaseSchema } from '../storage/migrations.js';

export interface StatementSummary {
  createdAt: string;
  id: number;
  originalFilename: string | null;
  parserId: string | null;
  status: string;
  transactionCount: number;
  updatedAt: string;
}

export interface StatementDetail extends Omit<StatementSummary, 'transactionCount'> {
  diagnosticId: string | null;
  errorMessage: string | null;
  paperless: {
    correspondentId: number | null;
    correspondentName: string | null;
    documentDate: string | null;
    documentId: number | null;
    documentTitle: string | null;
  };
  transactions: StatementTransaction[];
}

export interface StatementTransaction {
  actualCategoryId: string | null;
  amountCents: number;
  date: string;
  description: string;
  excluded: boolean;
  id: number;
  position: number;
  reviewedAmountCents: number | null;
  reviewedDate: string | null;
  reviewedDescription: string | null;
}

export interface ReviewUpdate {
  actualCategoryId?: string | null;
  excluded?: boolean;
  reviewedAmountCents?: number;
  reviewedDate?: string;
  reviewedDescription?: string;
}

export class StatementManagement {
  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<StatementSummary[]> {
    const statements = await this.database.selectFrom('statements').selectAll().orderBy('created_at', 'desc').execute();
    const transactionCounts = await this.database
      .selectFrom('statement_transactions')
      .select(({ fn }) => [fn.count<number>('id').as('count'), 'statement_id'])
      .groupBy('statement_id')
      .execute();
    const counts = new Map(transactionCounts.map((row) => [row.statement_id, Number(row.count)]));

    return statements.map((statement) => ({
      createdAt: statement.created_at,
      id: statement.id,
      originalFilename: statement.original_filename,
      parserId: statement.parser_id,
      status: statement.status,
      transactionCount: counts.get(statement.id) ?? 0,
      updatedAt: statement.updated_at,
    }));
  }

  async get(statementId: number): Promise<StatementDetail | undefined> {
    const statement = await this.database
      .selectFrom('statements')
      .selectAll()
      .where('id', '=', statementId)
      .executeTakeFirst();
    if (!statement) {
      return undefined;
    }

    const transactions = await this.database
      .selectFrom('statement_transactions')
      .selectAll()
      .where('statement_id', '=', statementId)
      .orderBy('position')
      .execute();

    return {
      createdAt: statement.created_at,
      diagnosticId: statement.diagnostic_id,
      errorMessage: statement.error_message,
      id: statement.id,
      originalFilename: statement.original_filename,
      paperless: {
        correspondentId: statement.paperless_correspondent_id,
        correspondentName: statement.paperless_correspondent_name,
        documentDate: statement.paperless_document_date,
        documentId: statement.paperless_document_id,
        documentTitle: statement.paperless_document_title,
      },
      parserId: statement.parser_id,
      status: statement.status,
      transactions: transactions.map((transaction) => ({
        actualCategoryId: transaction.actual_category_id,
        amountCents: transaction.amount_cents,
        date: transaction.date,
        description: transaction.description,
        excluded: transaction.excluded === 1,
        id: transaction.id,
        position: transaction.position,
        reviewedAmountCents: transaction.reviewed_amount_cents,
        reviewedDate: transaction.reviewed_date,
        reviewedDescription: transaction.reviewed_description,
      })),
      updatedAt: statement.updated_at,
    };
  }

  async updateReview(statementId: number, transactionId: number, update: ReviewUpdate): Promise<StatementTransaction | undefined> {
    const statement = await this.database
      .selectFrom('statements')
      .select('status')
      .where('id', '=', statementId)
      .executeTakeFirst();
    if (!statement) {
      return undefined;
    }
    if (statement.status === 'published' || statement.status === 'publishing') {
      throw new StatementManagementError('STATEMENT_READ_ONLY');
    }

    const values: Record<string, string | number | null> = {};
    if (update.actualCategoryId !== undefined) values.actual_category_id = update.actualCategoryId;
    if (update.excluded !== undefined) values.excluded = update.excluded ? 1 : 0;
    if (update.reviewedAmountCents !== undefined) values.reviewed_amount_cents = update.reviewedAmountCents;
    if (update.reviewedDate !== undefined) values.reviewed_date = update.reviewedDate;
    if (update.reviewedDescription !== undefined) values.reviewed_description = update.reviewedDescription;
    if (Object.keys(values).length === 0) {
      throw new StatementManagementError('EMPTY_REVIEW_UPDATE');
    }

    const updated = await this.database
      .updateTable('statement_transactions')
      .set(values)
      .where('id', '=', transactionId)
      .where('statement_id', '=', statementId)
      .returningAll()
      .executeTakeFirst();
    if (!updated) {
      return undefined;
    }
    await this.database
      .updateTable('statements')
      .set({ updated_at: this.now().toISOString() })
      .where('id', '=', statementId)
      .execute();

    return {
      actualCategoryId: updated.actual_category_id,
      amountCents: updated.amount_cents,
      date: updated.date,
      description: updated.description,
      excluded: updated.excluded === 1,
      id: updated.id,
      position: updated.position,
      reviewedAmountCents: updated.reviewed_amount_cents,
      reviewedDate: updated.reviewed_date,
      reviewedDescription: updated.reviewed_description,
    };
  }

  async delete(statementId: number): Promise<boolean> {
    const statement = await this.database
      .selectFrom('statements')
      .select('status')
      .where('id', '=', statementId)
      .executeTakeFirst();
    if (!statement) {
      return false;
    }
    if (statement.status === 'processing' || statement.status === 'publishing') {
      throw new StatementManagementError('STATEMENT_BUSY');
    }
    await this.database.deleteFrom('statements').where('id', '=', statementId).execute();
    return true;
  }
}

export class StatementManagementError extends Error {
  constructor(readonly code: 'EMPTY_REVIEW_UPDATE' | 'STATEMENT_BUSY' | 'STATEMENT_READ_ONLY') {
    super(code);
  }
}
