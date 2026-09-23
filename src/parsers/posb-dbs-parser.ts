import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { BankParser, ParsedTransaction } from './bank-parser.js';

export interface PosbTextChunk {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

const transactionDate = /^(\d{1,2})\s+([A-Za-z]{3})$/;
const statementDate = /\bAs at \d{1,2}\s+[A-Za-z]{3}\s+(\d{4})\b/i;
const controlRow = /^(?:balance (?:brought|carried) forward|total|date\b|details of your posb|message for you)/i;
const months = new Map([
  ['jan', '01'], ['feb', '02'], ['mar', '03'], ['apr', '04'],
  ['may', '05'], ['jun', '06'], ['jul', '07'], ['aug', '08'],
  ['sep', '09'], ['oct', '10'], ['nov', '11'], ['dec', '12'],
]);

interface PosbTextRow {
  readonly chunks: readonly PosbTextChunk[];
  readonly y: number;
}

interface PendingTransaction {
  readonly amountCents: number;
  readonly date: string;
  readonly description: string[];
}

export const posbDbsParser: BankParser = {
  countryCode: 'SG',
  countryName: 'Singapore',
  id: 'posb-dbs',
  name: 'POSB/DBS',
  async parse(pdf: Uint8Array): Promise<readonly ParsedTransaction[]> {
    const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
    try {
      const pages: PosbTextChunk[][] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const chunks: PosbTextChunk[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          chunks.push({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] });
        }
        pages.push(chunks);
      }
      return parsePosbText(pages);
    } finally {
      await document.destroy();
    }
  },
};

export function parsePosbText(
  pages: readonly (readonly PosbTextChunk[])[],
): readonly ParsedTransaction[] {
  const rowsByPage = pages.map(groupRows);
  const year = findStatementYear(rowsByPage);
  if (year === undefined) throw new Error('The POSB statement date could not be read.');

  const transactions: ParsedTransaction[] = [];
  let pending: PendingTransaction | undefined;

  const finishPending = () => {
    if (!pending) return;
    const description = pending.description.join(' ').replace(/\s+/g, ' ').trim();
    if (!description) throw new Error('A POSB transaction description could not be read.');
    transactions.push({
      amountCents: pending.amountCents,
      date: pending.date,
      description,
      position: transactions.length,
    });
    pending = undefined;
  };

  for (const rows of rowsByPage) {
    for (const row of rows) {
      const text = row.chunks.map((chunk) => chunk.text).join(' ').trim();
      const dateChunk = row.chunks.find((chunk) => chunk.x < 80 && transactionDate.test(chunk.text));
      if (dateChunk) {
        finishPending();
        const date = normalizeDate(dateChunk.text, year);
        const description = columnText(row, 80, 300);
        const withdrawal = parseAmount(columnText(row, 300, 400));
        const deposit = parseAmount(columnText(row, 400, 475));
        if (!date || !description || (withdrawal === undefined) === (deposit === undefined)) {
          throw new Error('A POSB transaction row could not be parsed unambiguously.');
        }
        pending = {
          amountCents: deposit ?? -withdrawal!,
          date,
          description: [description],
        };
        continue;
      }

      if (controlRow.test(text)) {
        finishPending();
        continue;
      }

      if (pending) {
        const continuation = columnText(row, 80, 300);
        if (continuation) pending.description.push(continuation);
      }
    }
    finishPending();
  }

  return transactions;
}

function groupRows(chunks: readonly PosbTextChunk[]): readonly PosbTextRow[] {
  const rows: { chunks: PosbTextChunk[]; y: number }[] = [];
  for (const chunk of chunks.toSorted((left, right) => right.y - left.y || left.x - right.x)) {
    const existing = rows.find((row) => Math.abs(row.y - chunk.y) <= 1.5);
    if (existing) existing.chunks.push(chunk);
    else rows.push({ chunks: [chunk], y: chunk.y });
  }
  return rows.map((row) => ({
    chunks: row.chunks.toSorted((left, right) => left.x - right.x),
    y: row.y,
  }));
}

function findStatementYear(pages: readonly (readonly PosbTextRow[])[]): number | undefined {
  for (const rows of pages) {
    for (const row of rows) {
      const match = row.chunks.map((chunk) => chunk.text).join(' ').match(statementDate);
      if (match?.[1]) return Number(match[1]);
    }
  }
  return undefined;
}

function columnText(row: PosbTextRow, start: number, end: number): string {
  return row.chunks
    .filter((chunk) => chunk.x >= start && chunk.x < end)
    .map((chunk) => chunk.text)
    .join(' ')
    .trim();
}

function normalizeDate(value: string, year: number): string | undefined {
  const match = value.match(transactionDate);
  if (!match?.[1] || !match[2]) return undefined;
  const month = months.get(match[2].toLowerCase());
  if (!month) return undefined;
  const day = Number(match[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  return `${String(day).padStart(2, '0')}-${month}-${year}`;
}

function parseAmount(value: string): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/\s+/g, '').match(/^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (!match?.[1] || !match[2]) return undefined;
  const amount = Number(match[1].replace(/,/g, '')) * 100 + Number(match[2]);
  return Number.isSafeInteger(amount) ? amount : undefined;
}
