import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import * as actual from '@actual-app/api';

import { type ApplicationConfiguration } from '../config.js';
import { type ActualBudgetPublisher, type ActualTransaction } from './statement-publisher.js';
import { type ActualCategorySource } from '../categories/category-catalog.js';

export interface ActualAccount {
  closed: boolean;
  id: string;
  name: string;
  offBudget: boolean;
}

export interface ActualAccountSource {
  getAccounts(): Promise<readonly ActualAccount[]>;
}

export class ActualBudgetClient implements ActualBudgetPublisher, ActualCategorySource, ActualAccountSource {
  private queue = Promise.resolve();

  constructor(private readonly configuration: ApplicationConfiguration) {}

  async importTransactions(accountId: string, transactions: Omit<ActualTransaction, 'id'>[]): Promise<void> {
    const imports = transactions.map(({ category, ...transaction }) => ({
      ...transaction,
      account: accountId,
      ...(category ? { category } : {}),
    }));
    await this.withBudget(() => actual.importTransactions(
      accountId,
      imports as Parameters<typeof actual.importTransactions>[1],
      {
      defaultCleared: true,
      reimportDeleted: false,
      },
    ).then((result) => {
      if (result.errors.length > 0) throw new Error('Actual Budget rejected the transaction import.');
    }));
  }

  async findTransactions(accountId: string, startDate: string, endDate: string): Promise<ActualTransaction[]> {
    return this.withBudget(() => actual.getTransactions(accountId, startDate, endDate) as Promise<ActualTransaction[]>);
  }

  async getAccounts(): Promise<readonly ActualAccount[]> {
    return this.withBudget(async () => (await actual.getAccounts()).map((account) => ({
      closed: account.closed ?? false,
      id: account.id,
      name: account.name,
      offBudget: account.offbudget ?? false,
    })));
  }

  async resolvePayee(name: string): Promise<string> {
    return this.withBudget(async () => {
      const existing = (await actual.getPayees()).find((payee) => !payee.transfer_acct && payee.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      return existing?.id ?? actual.createPayee({ name });
    });
  }

  async resolveTransferPayee(accountId: string, sourceAccountId: string): Promise<{ payeeId: string; categoryAllowed: boolean }> {
    return this.withBudget(async () => {
      const accounts = await actual.getAccounts();
      const target = accounts.find((account) => account.id === accountId);
      const source = accounts.find((account) => account.id === sourceAccountId);
      if (!source || !target || target.closed || accountId === sourceAccountId) {
        throw new Error('Select an active transfer account different from the statement account.');
      }
      const payee = (await actual.getPayees()).find((candidate) => candidate.transfer_acct === accountId);
      if (!payee) throw new Error('Actual Budget transfer payee is unavailable.');
      return { payeeId: payee.id, categoryAllowed: !source.offbudget && Boolean(source.offbudget) !== Boolean(target.offbudget) };
    });
  }

  async verifyTransfer(id: string, accountId: string, targetAccountId: string, values: Omit<ActualTransaction, 'id'>, transferCategoryId: string | null): Promise<void> {
    await this.withBudget(async () => {
      const source = await this.waitForTransaction(id, (item) => item.account === accountId
        && item.date === values.date && Boolean(item.transfer_id) && item.payee === values.payee
        && item.amount === values.amount && (item.category ?? null) === (values.category ?? null));
      // Actual propagates transfer amounts but does not propagate date changes.
      const accounts = await actual.getAccounts();
      const sourceAccount = accounts.find((account) => account.id === accountId);
      const targetAccount = accounts.find((account) => account.id === targetAccountId);
      const targetCategory = sourceAccount?.offbudget && !targetAccount?.offbudget ? transferCategoryId : null;
      await actual.updateTransaction(source.transfer_id!, { date: values.date, category: targetCategory } as never);
      await this.waitForTransaction(source.transfer_id!, (item) => item.account === targetAccountId
        && item.date === values.date && item.transfer_id === id && item.amount === -values.amount
        && (item.category ?? null) === targetCategory);
    });
  }

  async synchronize(): Promise<void> {
    await this.withBudget(() => actual.sync());
  }

  async getCategoriesGrouped(): Promise<readonly {
    id: string;
    name: string;
    categories: readonly { id: string; name: string; hidden?: boolean }[];
  }[]> {
    return this.withBudget(async () => {
      const groups = await actual.getCategoryGroups();
      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        categories: (group.categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
          ...(category.hidden === undefined ? {} : { hidden: category.hidden }),
        })),
      }));
    });
  }

  async createCategory(groupId: string, name: string): Promise<{ id: string; name: string }> {
    return this.withBudget(async () => {
      const id = await actual.createCategory({ group_id: groupId, name });
      return { id, name };
    });
  }

  async createCategoryGroup(name: string): Promise<{ id: string; name: string }> {
    return this.withBudget(async () => {
      const id = await actual.createCategoryGroup({ name, is_income: false, hidden: false });
      return { id, name };
    });
  }

  async updateCategory(id: string, name: string): Promise<{ id: string; name: string }> {
    await this.withBudget(() => actual.updateCategory(id, { name }));
    return { id, name };
  }

  async deleteCategory(id: string): Promise<void> {
    await this.withBudget(() => actual.deleteCategory(id));
  }

  async updateTransaction(id: string, transaction: Omit<ActualTransaction, 'id' | 'imported_id'>): Promise<void> {
    await this.withBudget(async () => {
      const transferPayee = (await actual.getPayees()).find((payee) => payee.id === transaction.payee && payee.transfer_acct);
      await actual.updateTransaction(id, transaction as never);
      const source = await this.waitForTransaction(id, (item) => item.date === transaction.date && item.amount === transaction.amount
        && item.payee === transaction.payee && (item.category ?? null) === (transaction.category ?? null)
        && item.cleared === transaction.cleared && Boolean(item.transfer_id) === Boolean(transferPayee));
      if (transferPayee) {
        await this.waitForTransaction(source.transfer_id!, (item) => item.account === transferPayee.transfer_acct
          && item.amount === -transaction.amount && item.transfer_id === id);
      }
    });
  }

  private async waitForTransaction(id: string, matches: (transaction: ActualTransaction & { account: string }) => boolean): Promise<ActualTransaction & { account: string }> {
    // Actual's update API can return before its transfer mutations have finished.
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await actual.aqlQuery(actual.q('transactions').filter({ id }).select('*')) as { data: (ActualTransaction & { account: string })[] };
      const transaction = result.data[0];
      if (transaction && matches(transaction)) return transaction;
      await delay(50);
    }
    throw new Error('Actual Budget did not preserve the reviewed transaction or linked transfer.');
  }

  private async withBudget<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const dataDirectory = join(this.configuration.dataDirectory, 'actual-cache');
      await mkdir(dataDirectory, { recursive: true });
      await actual.init({
        verbose: false,
        dataDir: dataDirectory,
        password: this.configuration.actualBudget.password,
        serverURL: this.configuration.actualBudget.serverUrl.toString(),
      });
      await actual.downloadBudget(this.configuration.actualBudget.budgetId, this.configuration.actualBudget.encryptionPassword
        ? { password: this.configuration.actualBudget.encryptionPassword }
        : undefined);
      return await operation();
    } finally {
      try {
        await actual.shutdown();
      } finally {
        release();
      }
    }
  }
}
