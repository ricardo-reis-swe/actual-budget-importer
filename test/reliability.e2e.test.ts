import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildServer } from '../src/server.js';
import { DirectUploadProcessor } from '../src/processing/direct-upload.js';
import { StatementManagement } from '../src/statements/statement-management.js';
import { StatementPublisher, type ActualBudgetPublisher, type ActualTransaction } from '../src/publishing/statement-publisher.js';
import { ApplicationDatabase } from '../src/storage/database.js';
import type { BankParser } from '../src/parsers/bank-parser.js';

function upload(parserId: string, pdf: Buffer, filename = 'synthetic.pdf') {
  const boundary = 'reliability-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parserId"\r\n\r\n${parserId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
    pdf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function setup() {
  const database = new ApplicationDatabase(mkdtempSync(join(tmpdir(), 'actual-budget-importer-e2e-')));
  await database.migrate();
  const parser: BankParser = {
    id: 'synthetic',
    name: 'Synthetic parser',
    parse: vi.fn().mockResolvedValue([{ position: 0, date: '02-01-2026', description: 'Synthetic coffee', amountCents: -345 }]),
  };
  const actual = new MockActualBudget();
  const app = buildServer({
    database,
    directUploads: new DirectUploadProcessor(database.db, [parser]),
    publisher: new StatementPublisher(database.db, actual),
    statements: new StatementManagement(database.db),
  });
  return { app, database, parser, actual };
}

class MockActualBudget implements ActualBudgetPublisher {
  readonly imported = new Map<string, ActualTransaction>();
  importCalls = 0;
  failNextImport = false;

  async importTransactions(transactions: Omit<ActualTransaction, 'id'>[]) {
    this.importCalls += 1;
    for (const transaction of transactions) {
      if (!this.imported.has(transaction.imported_id!)) {
        this.imported.set(transaction.imported_id!, { ...transaction, id: `actual-${this.imported.size + 1}` });
      }
    }
    if (this.failNextImport) {
      this.failNextImport = false;
      throw new Error('synthetic Actual Budget outage');
    }
  }

  async findTransactions() { return [...this.imported.values()]; }
  async resolvePayee(name: string) { return `payee-${name}`; }
  async synchronize() {}
  async updateTransaction(id: string, transaction: Omit<ActualTransaction, 'id' | 'imported_id'>) {
    const existing = [...this.imported.values()].find((value) => value.id === id);
    if (existing) Object.assign(existing, transaction);
  }
}

describe('mocked end-to-end reliability', () => {
  it('preserves review changes when the same PDF is uploaded again', async () => {
    const { app, database, parser } = await setup();
    const request = upload('synthetic', Buffer.from('%PDF-synthetic'));
    const first = await app.inject({ method: 'POST', url: '/api/statements/upload', headers: { 'content-type': request.contentType }, payload: request.payload });
    expect(first.statusCode).toBe(202);
    const statementId = first.json().statementId;
    await new Promise((resolve) => setImmediate(resolve));
    const detail = await app.inject({ method: 'GET', url: `/api/statements/${statementId}` });
    const transactionId = detail.json().transactions[0].id;
    const review = await app.inject({ method: 'PATCH', url: `/api/statements/${statementId}/transactions/${transactionId}`, payload: { reviewedDescription: 'Reviewed coffee', reviewedAmountCents: -400 } });
    expect(review.statusCode).toBe(200);

    const duplicate = await app.inject({ method: 'POST', url: '/api/statements/upload', headers: { 'content-type': request.contentType }, payload: request.payload });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ statementId });
    expect((await app.inject({ method: 'GET', url: `/api/statements/${statementId}` })).json().transactions[0]).toMatchObject({ reviewedDescription: 'Reviewed coffee', reviewedAmountCents: -400 });
    expect(parser.parse).toHaveBeenCalledOnce();
    await app.close();
    await database.close();
  });

  it('retries a failed publish without creating a duplicate Actual transaction', async () => {
    const { app, database, actual } = await setup();
    const request = upload('synthetic', Buffer.from('%PDF-publish-retry'));
    const uploaded = await app.inject({ method: 'POST', url: '/api/statements/upload', headers: { 'content-type': request.contentType }, payload: request.payload });
    const statementId = uploaded.json().statementId;
    await new Promise((resolve) => setImmediate(resolve));
    actual.failNextImport = true;
    expect((await app.inject({ method: 'POST', url: `/api/statements/${statementId}/publish` })).statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: `/api/statements/${statementId}` })).json().status).toBe('publish failed');
    expect((await app.inject({ method: 'POST', url: `/api/statements/${statementId}/publish` })).statusCode).toBe(204);
    expect(actual.imported.size).toBe(1);
    expect(actual.importCalls).toBe(2);
    expect((await app.inject({ method: 'GET', url: `/api/statements/${statementId}` })).json().status).toBe('published');
    await app.close();
    await database.close();
  });
});
