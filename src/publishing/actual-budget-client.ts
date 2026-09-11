import * as actual from '@actual-app/api';

import { type ApplicationConfiguration } from '../config.js';
import { type ActualBudgetPublisher, type ActualTransaction } from './statement-publisher.js';
import { type ActualCategorySource } from '../categories/category-catalog.js';

export class ActualBudgetClient implements ActualBudgetPublisher, ActualCategorySource {
  private queue = Promise.resolve();

  constructor(private readonly configuration: ApplicationConfiguration) {}

  async importTransactions(transactions: Omit<ActualTransaction, 'id'>[]): Promise<void> {
    const imports = transactions.map(({ category, ...transaction }) => ({
      ...transaction,
      account: this.configuration.actualBudget.accountId,
      ...(category ? { category } : {}),
    }));
    await this.withBudget(() => actual.importTransactions(
      this.configuration.actualBudget.accountId,
      imports as Parameters<typeof actual.importTransactions>[1],
      {
      defaultCleared: true,
      reimportDeleted: false,
      },
    ).then((result) => {
      if (result.errors.length > 0) throw new Error('Actual Budget rejected the transaction import.');
    }));
  }

  async findTransactions(startDate: string, endDate: string): Promise<ActualTransaction[]> {
    return this.withBudget(() => actual.getTransactions(this.configuration.actualBudget.accountId, startDate, endDate) as Promise<ActualTransaction[]>);
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
      const api = actual as unknown as { getCategoriesGrouped: () => Promise<unknown> };
      const groups = await api.getCategoriesGrouped();
      if (!Array.isArray(groups)) throw new Error('Actual Budget returned an invalid category list.');
      return groups as {
        id: string;
        name: string;
        categories: readonly { id: string; name: string; hidden?: boolean }[];
      }[];
    });
  }

  async createCategory(groupId: string, name: string): Promise<{ id: string; name: string }> {
    return this.withBudget(async () => {
      const api = actual as unknown as { createCategory: (category: { cat_group: string; name: string }) => Promise<{ id: string; name: string }> };
      return api.createCategory({ cat_group: groupId, name });
    });
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
      await actual.init({
        dataDir: `${this.configuration.dataDirectory}/actual-cache`,
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
