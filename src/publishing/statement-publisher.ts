import { randomUUID } from 'node:crypto';

import { createSanitizedFailure, toUserFailure } from '../diagnostics/failure.js';
import { type DatabaseSchema } from '../storage/migrations.js';
import { type Kysely } from 'kysely';

export interface ActualTransaction {
  amount: number;
  category?: string | null;
  cleared?: boolean;
  date: string;
  id: string;
  imported_id?: string | null;
  imported_payee?: string;
  notes?: string;
  payee?: string | null;
  payee_name?: string;
}

export interface ActualBudgetPublisher {
  importTransactions(accountId: string, transactions: Omit<ActualTransaction, 'id'>[]): Promise<void>;
  findTransactions(accountId: string, startDate: string, endDate: string): Promise<ActualTransaction[]>;
  resolvePayee(name: string): Promise<string>;
  synchronize(): Promise<void>;
  updateTransaction(id: string, transaction: Omit<ActualTransaction, 'id' | 'imported_id'>): Promise<void>;
}

export class StatementPublicationError extends Error {
  constructor(readonly code: 'ACCOUNT_MISMATCH' | 'STATEMENT_BUSY' | 'STATEMENT_NOT_FOUND' | 'STATEMENT_NOT_READY') {
    super(code);
  }
}

export class StatementPublisher {
  private readonly publishing = new Set<number>();

  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly actualBudget: ActualBudgetPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(statementId: number, destinationAccount: { id: string; name: string }): Promise<void> {
    if (this.publishing.has(statementId)) throw new StatementPublicationError('STATEMENT_BUSY');
    this.publishing.add(statementId);
    let wasPublished = false;
    try {
      const claim = await this.claim(statementId, destinationAccount);
      const { accountId } = claim;
      wasPublished = claim.wasPublished;
      const transactions = await this.database
        .selectFrom('statement_transactions')
        .selectAll()
        .where('statement_id', '=', statementId)
        .where('excluded', '=', 0)
        .orderBy('position')
        .execute();
      const includedTransactions = transactions.filter((transaction) => transaction.excluded === 0);

      if (includedTransactions.length > 0) {
        const publicationRecords = await this.database
          .selectFrom('publication_records')
          .select(['statement_transaction_id', 'actual_transaction_id'])
          .where('statement_transaction_id', 'in', includedTransactions.map((transaction) => transaction.id))
          .execute();
        const recordsByTransactionId = new Map(publicationRecords.map((record) => [record.statement_transaction_id, record]));
        const pending = includedTransactions
          .filter((transaction) => !recordsByTransactionId.get(transaction.id)?.actual_transaction_id)
          .map((transaction) => ({
          amount: transaction.reviewed_amount_cents ?? transaction.amount_cents,
          category: transaction.actual_category_id,
          cleared: true,
          date: actualDate(transaction.reviewed_date ?? transaction.date),
          imported_id: transaction.stable_import_id,
          imported_payee: transaction.description,
          notes: '',
          payee_name: transaction.reviewed_description ?? transaction.description,
          }));
        if (pending.length > 0) await this.actualBudget.importTransactions(accountId, pending);

        const reviewedTransactions = includedTransactions.map((transaction) => ({
          transaction,
          amount: transaction.reviewed_amount_cents ?? transaction.amount_cents,
          category: transaction.actual_category_id,
          cleared: true,
          date: actualDate(transaction.reviewed_date ?? transaction.date),
          imported_payee: transaction.description,
          notes: '',
          payee_name: transaction.reviewed_description ?? transaction.description,
        }));
        const pendingImportIds = new Set(pending.map((transaction) => transaction.imported_id));
        const pendingReviewed = reviewedTransactions.filter(({ transaction }) => pendingImportIds.has(transaction.stable_import_id));
        const dates = pendingReviewed.map(({ date }) => date).sort();
        const actualTransactions = dates.length > 0
          ? await this.actualBudget.findTransactions(accountId, dates[0]!, dates[dates.length - 1]!)
          : [];
        const byImportId = new Map(actualTransactions
          .filter((transaction) => transaction.imported_id)
          .map((transaction) => [transaction.imported_id!, transaction]));

        for (const reviewed of reviewedTransactions) {
          const { transaction } = reviewed;
          const record = recordsByTransactionId.get(transaction.id);
          const actualTransactionId = record?.actual_transaction_id
            ?? byImportId.get(transaction.stable_import_id)?.id;
          if (!actualTransactionId) {
            throw new Error('Actual Budget did not reconcile an imported transaction.');
          }
          const payee = await this.actualBudget.resolvePayee(reviewed.payee_name);
          await this.actualBudget.updateTransaction(actualTransactionId, {
            amount: reviewed.amount,
            category: reviewed.category ?? null,
            cleared: true,
            date: reviewed.date,
            imported_payee: reviewed.imported_payee,
            notes: '',
            payee,
          });
          await this.database
            .insertInto('publication_records')
            .values({
              actual_transaction_id: actualTransactionId,
              published_at: this.now().toISOString(),
              statement_transaction_id: transaction.id,
            })
            .onConflict((conflict) => conflict.column('statement_transaction_id').doUpdateSet({
              actual_transaction_id: actualTransactionId,
              published_at: this.now().toISOString(),
            }))
            .execute();
        }
      }

      await this.actualBudget.synchronize();
      await this.database
        .updateTable('statements')
        .set({ diagnostic_id: null, error_message: null, status: 'published', updated_at: this.now().toISOString() })
        .where('id', '=', statementId)
        .execute();
    } catch (cause) {
      if (cause instanceof StatementPublicationError) throw cause;
      const failure = createSanitizedFailure(cause, 'publishing', randomUUID());
      await this.database
        .updateTable('statements')
        .set({
          diagnostic_id: failure.diagnosticId,
          error_message: toUserFailure(failure).message,
          status: wasPublished ? 'published' : 'publish failed',
          updated_at: this.now().toISOString(),
        })
        .where('id', '=', statementId)
        .execute();
      throw cause;
    } finally {
      this.publishing.delete(statementId);
    }
  }

  async recoverInterruptedPublishing(): Promise<void> {
    const interrupted = await this.database
      .selectFrom('statements')
      .select(['id', 'status'])
      .where('status', 'in', ['publishing', 'republishing'])
      .execute();
    for (const statement of interrupted) {
      const failure = createSanitizedFailure(undefined, 'publishing', randomUUID());
      await this.database
        .updateTable('statements')
        .set({
          diagnostic_id: failure.diagnosticId,
          error_message: toUserFailure(failure).message,
          status: statement.status === 'republishing' ? 'published' : 'publish failed',
          updated_at: this.now().toISOString(),
        })
        .where('id', '=', statement.id)
        .execute();
    }
  }

  private async claim(statementId: number, destinationAccount: { id: string; name: string }): Promise<{ accountId: string; wasPublished: boolean }> {
    const statement = await this.database
      .selectFrom('statements')
      .select(['actual_account_id', 'status'])
      .where('id', '=', statementId)
      .executeTakeFirst();
    if (!statement) throw new StatementPublicationError('STATEMENT_NOT_FOUND');
    if (statement.status === 'publishing' || statement.status === 'republishing') throw new StatementPublicationError('STATEMENT_BUSY');
    if (!['ready for review', 'publish failed', 'published'].includes(statement.status)) {
      throw new StatementPublicationError('STATEMENT_NOT_READY');
    }
    if (statement.actual_account_id !== null && statement.actual_account_id !== destinationAccount.id) {
      throw new StatementPublicationError('ACCOUNT_MISMATCH');
    }
    const accountId = statement.actual_account_id ?? destinationAccount.id;
    const wasPublished = statement.status === 'published';
    const updated = await this.database
      .updateTable('statements')
      .set({
        ...(statement.actual_account_id === null
          ? { actual_account_id: destinationAccount.id, actual_account_name: destinationAccount.name }
          : {}),
        status: wasPublished ? 'republishing' : 'publishing',
        updated_at: this.now().toISOString(),
      })
      .where('id', '=', statementId)
      .where('status', 'in', ['ready for review', 'publish failed', 'published'])
      .execute();
    if (Number(updated[0]?.numUpdatedRows ?? 0) !== 1) {
      throw new StatementPublicationError('STATEMENT_BUSY');
    }
    return { accountId, wasPublished };
  }
}

function actualDate(value: string): string {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDate) return value;

  const dayFirstDate = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!dayFirstDate) throw new Error('Invalid transaction date.');
  return `${dayFirstDate[3]}-${dayFirstDate[2]}-${dayFirstDate[1]}`;
}
