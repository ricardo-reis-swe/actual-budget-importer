import { type Kysely } from 'kysely';

import { type DatabaseSchema } from '../storage/migrations.js';
import { type CategorizationRuleMatcher, type RuleMatch } from '../rules/categorization-rules.js';

export interface StatementSummary {
  createdAt: string;
  dateRange: { end: string; start: string } | null;
  id: number;
  originalFilename: string | null;
  parserId: string | null;
  paperlessCorrespondentName: string | null;
  paperlessDocumentDate: string | null;
  paperlessDocumentTitle: string | null;
  status: string;
  transactionCount: number;
  updatedAt: string;
}

export interface StatementDetail extends Omit<StatementSummary,
  'dateRange' | 'paperlessCorrespondentName' | 'paperlessDocumentDate' | 'paperlessDocumentTitle' | 'transactionCount'> {
  diagnosticId: string | null;
  errorMessage: string | null;
  actualAccount: { id: string; name: string | null } | null;
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
  matchingRule: RuleMatch | null;
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
    private readonly paperless?: { getCorrespondentName(correspondentId: number): Promise<string> },
    private readonly categorizationRules?: CategorizationRuleMatcher,
  ) {}

  async list(): Promise<StatementSummary[]> {
    const statements = await this.database.selectFrom('statements').selectAll().orderBy('created_at', 'desc').execute();
    const correspondentNames = new Map<number, string>();
    for (const statement of statements) {
      if (statement.paperless_correspondent_id !== null && statement.paperless_correspondent_name !== null) {
        correspondentNames.set(statement.paperless_correspondent_id, statement.paperless_correspondent_name);
      }
    }
    if (this.paperless) {
      const missingIds = [...new Set(statements
        .filter((statement) => statement.paperless_correspondent_id !== null && statement.paperless_correspondent_name === null)
        .map((statement) => statement.paperless_correspondent_id!))];
      await Promise.all(missingIds.map(async (correspondentId) => {
        try {
          const name = await this.paperless!.getCorrespondentName(correspondentId);
          correspondentNames.set(correspondentId, name);
          await this.database.updateTable('statements')
            .set({ paperless_correspondent_name: name })
            .where('paperless_correspondent_id', '=', correspondentId)
            .execute();
        } catch {
          // Keep the dashboard available when Paperless is temporarily unavailable.
        }
      }));
    }
    const transactionCounts = await this.database
      .selectFrom('statement_transactions')
      .select(({ fn }) => [fn.count<number>('id').as('count'), 'statement_id'])
      .groupBy('statement_id')
      .execute();
    const counts = new Map(transactionCounts.map((row) => [row.statement_id, Number(row.count)]));
    const transactionDates = await this.database
      .selectFrom('statement_transactions')
      .select(['statement_id', 'date'])
      .execute();
    const dateRanges = new Map<number, { end: string; start: string }>();
    for (const transaction of transactionDates) {
      const current = dateRanges.get(transaction.statement_id);
      if (!current) {
        dateRanges.set(transaction.statement_id, { start: transaction.date, end: transaction.date });
        continue;
      }
      if (sortableDate(transaction.date) < sortableDate(current.start)) current.start = transaction.date;
      if (sortableDate(transaction.date) > sortableDate(current.end)) current.end = transaction.date;
    }

    return statements.map((statement) => ({
      createdAt: statement.created_at,
      dateRange: dateRanges.get(statement.id) ?? null,
      id: statement.id,
      originalFilename: statement.original_filename,
      parserId: statement.parser_id,
      paperlessCorrespondentName: statement.paperless_correspondent_name
        ?? (statement.paperless_correspondent_id === null ? null : correspondentNames.get(statement.paperless_correspondent_id) ?? null),
      paperlessDocumentDate: statement.paperless_document_date,
      paperlessDocumentTitle: statement.paperless_document_title,
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
    const matchingRules = this.categorizationRules?.matchMany
      ? await this.categorizationRules.matchMany(transactions.map((transaction) => ({
        description: transaction.reviewed_description ?? transaction.description,
        parserId: statement.parser_id,
      })))
      : await Promise.all(transactions.map((transaction) => this.categorizationRules?.match(
        transaction.reviewed_description ?? transaction.description,
        statement.parser_id,
      ) ?? null));

    return {
      actualAccount: statement.actual_account_id === null
        ? null
        : { id: statement.actual_account_id, name: statement.actual_account_name },
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
      transactions: transactions.map((transaction, index) => ({
        actualCategoryId: transaction.actual_category_id,
        amountCents: transaction.amount_cents,
        date: transaction.date,
        description: transaction.description,
        excluded: transaction.excluded === 1,
        id: transaction.id,
        matchingRule: matchingRules[index] ?? null,
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
      .select(['parser_id', 'status'])
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
      matchingRule: await this.categorizationRules?.match(
        updated.reviewed_description ?? updated.description,
        statement.parser_id,
      ) ?? null,
      position: updated.position,
      reviewedAmountCents: updated.reviewed_amount_cents,
      reviewedDate: updated.reviewed_date,
      reviewedDescription: updated.reviewed_description,
    };
  }

  async applyRules(statementId: number, rules: CategorizationRuleMatcher): Promise<{ appliedCount: number; statement: StatementDetail } | undefined> {
    const statement = await this.database
      .selectFrom('statements')
      .select(['parser_id', 'status'])
      .where('id', '=', statementId)
      .executeTakeFirst();
    if (!statement) return undefined;
    if (statement.status === 'published' || statement.status === 'publishing') {
      throw new StatementManagementError('STATEMENT_READ_ONLY');
    }

    const transactions = await this.database
      .selectFrom('statement_transactions')
      .select(['actual_category_id', 'description', 'excluded', 'id', 'reviewed_description'])
      .where('statement_id', '=', statementId)
      .execute();
    const matches = await Promise.all(transactions.map(async (item) => ({
      currentCategoryId: item.actual_category_id,
      currentExcluded: item.excluded === 1,
      id: item.id,
      rule: await rules.match(item.reviewed_description ?? item.description, statement.parser_id),
    })));
    const matchedTransactions = matches.map((item) => ({
      ...item,
      categoryId: item.currentCategoryId === null ? item.rule?.categoryId ?? null : item.currentCategoryId,
      excluded: item.rule?.excluded ?? item.currentExcluded,
    })).filter((item) => item.rule !== null
      && (item.categoryId !== item.currentCategoryId || item.excluded !== item.currentExcluded));
    let applied = false;
    await this.database.transaction().execute(async (transaction) => {
      for (const item of matchedTransactions) {
        await transaction.updateTable('statement_transactions')
          .set({ actual_category_id: item.categoryId, excluded: item.excluded ? 1 : 0 })
          .where('id', '=', item.id)
          .execute();
        applied = true;
      }
      if (applied) {
        await transaction.updateTable('statements')
          .set({ updated_at: this.now().toISOString() })
          .where('id', '=', statementId)
          .execute();
      }
    });
    const updatedStatement = await this.get(statementId);
    return updatedStatement ? { appliedCount: matchedTransactions.length, statement: updatedStatement } : undefined;
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

function sortableDate(date: string): string {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (isoDate) return `${isoDate[1]}${isoDate[2]}${isoDate[3]}`;

  const dayFirstDate = /^(\d{2})-(\d{2})-(\d{4})$/.exec(date);
  return dayFirstDate ? `${dayFirstDate[3]}${dayFirstDate[2]}${dayFirstDate[1]}` : date;
}

export class StatementManagementError extends Error {
  constructor(readonly code: 'EMPTY_REVIEW_UPDATE' | 'STATEMENT_BUSY' | 'STATEMENT_READ_ONLY') {
    super(code);
  }
}
