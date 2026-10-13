import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { BankParser, ParsedTransaction } from './bank-parser.js';
import type { PositionedText } from './generic-table-extractor.js';

const dayMonthDate = /^(\d{2})\/(\d{2})$/;
const statementPeriod = /\bde\s+(\d{2})\/(\d{2})\/(\d{4})\s+a\s+(\d{2})\/(\d{2})\/(\d{4})\b/i;
const rowTolerance = 2;

interface TextRow {
  y: number;
  chunks: PositionedText[];
}

interface StatementPeriod {
  readonly start: { readonly day: number; readonly month: number; readonly year: number };
  readonly end: { readonly day: number; readonly month: number; readonly year: number };
}

export const wizinkOldFormatParser: BankParser = {
  countryCode: 'PT',
  countryName: 'Portugal',
  id: 'wizink-old-format',
  name: 'WiZink (older format)',
  async parse(pdf: Uint8Array): Promise<readonly ParsedTransaction[]> {
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

      const period = findStatementPeriod(pages);
      if (!period) throw new Error('Could not identify the statement period in this WiZink PDF.');
      return parseWiZinkOldFormatRows(pages, period);
    } finally {
      await document.destroy();
    }
  },
};

function parseWiZinkOldFormatRows(
  pages: readonly (readonly PositionedText[])[],
  period: StatementPeriod,
): readonly ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];

  for (const page of pages) {
    for (const row of groupRows(page)) {
      const dates = row.chunks
        .filter((chunk) => chunk.x < 120 && dayMonthDate.test(chunk.text.trim()))
        .sort((left, right) => left.x - right.x);
      if (dates.length < 2) continue;

      const amount = findAmount(row.chunks);
      const firstDate = dates[0];
      const secondDate = dates[1];
      if (!firstDate || !secondDate || !amount) continue;

      const description = row.chunks
        .filter((chunk) => chunk.x > secondDate.x && chunk.x < amount.x)
        .map((chunk) => chunk.text.trim())
        .filter((text) => text.length > 0 && text !== 'P')
        .join(' ')
        .trim();
      const parsedDate = normalizeTransactionDate(firstDate.text, secondDate.text, period);
      if (!description || !parsedDate) continue;

      transactions.push({
        position: transactions.length,
        date: parsedDate,
        description,
        amountCents: -amount.cents,
      });
    }
  }

  return transactions;
}

function groupRows(chunks: readonly PositionedText[]): TextRow[] {
  const rows: TextRow[] = [];
  for (const chunk of chunks
    .filter((item) => item.text.trim().length > 0)
    .toSorted((left, right) => right.y - left.y || left.x - right.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - chunk.y) <= rowTolerance);
    if (row) row.chunks.push(chunk);
    else rows.push({ y: chunk.y, chunks: [chunk] });
  }
  return rows.map((row) => ({
    ...row,
    chunks: row.chunks.toSorted((left, right) => left.x - right.x),
  }));
}

function findStatementPeriod(pages: readonly (readonly PositionedText[])[]): StatementPeriod | undefined {
  const pageText = pages
    .flatMap((page) => groupRows(page).map((row) => row.chunks.map((chunk) => chunk.text).join(' ')))
    .join(' ')
    .replace(/\s+/g, ' ');
  const match = pageText.match(statementPeriod);
  if (!match) return undefined;

  const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = match;
  if (!startDay || !startMonth || !startYear || !endDay || !endMonth || !endYear) return undefined;
  const start = { day: Number(startDay), month: Number(startMonth), year: Number(startYear) };
  const end = { day: Number(endDay), month: Number(endMonth), year: Number(endYear) };
  if (!isValidDate(start) || !isValidDate(end)) return undefined;
  if (Date.UTC(start.year, start.month - 1, start.day) > Date.UTC(end.year, end.month - 1, end.day)) {
    return undefined;
  }
  return { start, end };
}

function findAmount(chunks: readonly PositionedText[]): { readonly cents: number; readonly x: number } | undefined {
  const candidates = chunks
    .filter((chunk) => chunk.x >= 450)
    .toSorted((left, right) => left.x - right.x);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates.slice(index).map((chunk) => chunk.text).join('');
    const cents = parseAmountCents(candidate);
    if (cents !== undefined) {
      const chunk = candidates[index];
      if (chunk) return { cents, x: chunk.x };
    }
  }
  return undefined;
}

function normalizeTransactionDate(
  operationDate: string,
  postingDate: string,
  period: StatementPeriod,
): string | undefined {
  const operation = operationDate.match(dayMonthDate);
  const posting = postingDate.match(dayMonthDate);
  if (!operation || !posting) return undefined;
  const [, operationDayText, operationMonthText] = operation;
  const [, postingDayText, postingMonthText] = posting;
  if (!operationDayText || !operationMonthText || !postingDayText || !postingMonthText) return undefined;

  const operationDay = Number(operationDayText);
  const operationMonth = Number(operationMonthText);
  const postingDay = Number(postingDayText);
  const postingMonth = Number(postingMonthText);
  const postingYear = findPostingYear(postingDay, postingMonth, period);
  const operationIsBeforePostingAcrossYear = operationMonth > postingMonth
    || (operationMonth === postingMonth && operationDay > postingDay);
  const operationYear = postingYear - Number(operationIsBeforePostingAcrossYear);
  const date = { day: operationDay, month: operationMonth, year: operationYear };
  if (!isValidDate(date)) return undefined;

  return `${String(date.day).padStart(2, '0')}-${String(date.month).padStart(2, '0')}-${date.year}`;
}

function findPostingYear(day: number, month: number, period: StatementPeriod): number {
  const startTimestamp = Date.UTC(period.start.year, period.start.month - 1, period.start.day);
  const endTimestamp = Date.UTC(period.end.year, period.end.month - 1, period.end.day);
  for (const year of [period.end.year - 1, period.end.year]) {
    const postingTimestamp = Date.UTC(year, month - 1, day);
    if (postingTimestamp >= startTimestamp && postingTimestamp <= endTimestamp) return year;
  }
  return period.end.year;
}

function isValidDate(value: { readonly day: number; readonly month: number; readonly year: number }): boolean {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  return date.getUTCFullYear() === value.year
    && date.getUTCMonth() === value.month - 1
    && date.getUTCDate() === value.day;
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
