import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
      const existing = (await actual.getPayees()).find((payee) => payee.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      return existing?.id ?? actual.createPayee({ name });
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
    await this.withBudget(() => actual.updateTransaction(id, transaction as never));
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
