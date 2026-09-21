import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { BankParser, ParsedTransaction } from './bank-parser.js';
import {
  extractGenericTable,
  type PositionedText,
} from './generic-table-extractor.js';

const transactionDate = /^(\d{2})[/-](\d{2})[/-](\d{2,4})$/;
const nonTransactionRow = /^(?:data|date|descri[cç][aã]o|montante|movimentos?|total|p[aá]gina)\b/i;

/** Parser for WiZink Portugal credit-card statement layouts. */
export const wizinkParser: BankParser = {
  id: 'wizink',
  name: 'WiZink',
  async parse(pdf: Uint8Array): Promise<readonly ParsedTransaction[]> {
    // pdfjs-dist rejects Node Buffers despite Buffer extending Uint8Array.
    const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
    try {
      const pages: PositionedText[][] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const chunks: PositionedText[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          chunks.push({ text: item.str, x: item.transform[4], y: item.transform[5] });
        }
        pages.push(chunks);
      }
      return parseWiZinkRows(extractGenericTable(pages).rows);
    } finally {
      await document.destroy();
    }
  },
};

/** Exported for synthetic layout regression tests. */
export function parseWiZinkRows(
  rows: readonly (readonly string[])[],
): readonly ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];

  for (const row of rows) {
    const cells = row.map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 3 || nonTransactionRow.test(cells.join(' '))) continue;

    const dateIndex = cells.findIndex((cell) => transactionDate.test(cell));
    if (dateIndex === -1) continue;
    const amountIndex = findAmountIndex(cells, dateIndex + 1);
    if (amountIndex === -1) continue;
    const rawDate = cells[dateIndex];
    const rawAmount = cells[amountIndex];
    if (!rawDate || !rawAmount) continue;

    const date = normalizeDate(rawDate);
    const amountCents = parseAmountCents(rawAmount);
    const description = cells
      .slice(dateIndex + 1, amountIndex)
      .filter((cell) => !transactionDate.test(cell))
      .join(' ')
      .trim();
    if (!date || !description || amountCents === undefined) continue;

    transactions.push({
      position: transactions.length,
      date,
      description,
      amountCents: -amountCents,
    });
  }

  return transactions;
}

function findAmountIndex(cells: readonly string[], start: number): number {
  for (let index = cells.length - 1; index >= start; index -= 1) {
    const cell = cells[index];
    if (cell && parseAmountCents(cell) !== undefined) return index;
  }
  return -1;
}

function normalizeDate(value: string): string | undefined {
  const match = value.match(transactionDate);
  if (!match) return undefined;
  const [, day, month, rawYear] = match;
  if (!day || !month || !rawYear) return undefined;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return rawYear.length === 4 ? `${day}-${month}-${year}` : `${year}-${month}-${day}`;
}

function parseAmountCents(value: string): number | undefined {
  const normalized = value
    .trim()
    .replace(/\s+/g, '')
    .replace(/(?:EUR|€|[DC])$/i, '')
    .trim();
  const match = normalized.match(/^(-)?(\d{1,3}(?:[.]\d{3})*|\d+),(\d{2})-?$/)
    ?? normalized.match(/^(-)?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})-?$/);
  if (!match) return undefined;
  const whole = match[2];
  const fraction = match[3];
  if (!whole || !fraction) return undefined;
  const cents = Number(whole.replace(/[.,]/g, '')) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents)) return undefined;
  return match[1] || normalized.endsWith('-') ? -cents : cents;
}
