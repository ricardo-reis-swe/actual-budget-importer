import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { BankParser, ParsedTransaction } from './bank-parser.js';
import {
  extractGenericTable,
  type PositionedText,
} from './generic-table-extractor.js';

const headerRowCount = 29;
const excludedRow = /Banco ActivoBank|Capital Social|A TRANSPORTAR/i;
const transactionDate = /^(\d{2})[/-](\d{2})[/-](\d{4})$/;

/**
 * Parser for the Portuguese ActivoBank account statement layout.
 *
 * The layout profile is ported from the supplied extraction script: its first
 * 29 rows are statement header material, descriptions span columns 2–8, and
 * the sign of each amount is inferred from the running balance.
 */
export const activoBankParser: BankParser = {
  id: 'activobank',
  name: 'ActivoBank',
  async parse(pdf: Uint8Array): Promise<readonly ParsedTransaction[]> {
    const document = await getDocument({ data: pdf }).promise;
    try {
      const pages: PositionedText[][] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const chunks: PositionedText[] = [];

        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) {
            continue;
          }
          chunks.push({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
          });
        }
        pages.push(chunks);
      }

      return parseActivoBankRows(extractGenericTable(pages).rows);
    } finally {
      await document.destroy();
    }
  },
};

/** Exported for synthetic layout regression tests. */
export function parseActivoBankRows(
  rows: readonly (readonly string[])[],
): readonly ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let previousBalance: number | undefined;

  for (const originalRow of rows.slice(headerRowCount)) {
    if (excludedRow.test(originalRow.filter(Boolean).join(' '))) {
      continue;
    }

    const row = mergeDescriptionColumns(originalRow);
    const date = normalizeDate(row[0]);
    const description = row[2]?.trim();
    const unsignedAmount = parseEuroCents(row[3]);
    const balance = parseEuroCents(row[4]);

    if (!date || !description || unsignedAmount === undefined || balance === undefined) {
      continue;
    }

    const amountCents = previousBalance === undefined
      ? Math.abs(unsignedAmount)
      : balance < previousBalance
        ? -Math.abs(unsignedAmount)
        : Math.abs(unsignedAmount);
    previousBalance = balance;

    transactions.push({
      position: transactions.length,
      date,
      description,
      amountCents,
    });
  }

  return transactions;
}

function mergeDescriptionColumns(row: readonly string[]): readonly string[] {
  return [
    row[0] ?? '',
    row[1] ?? '',
    row.slice(2, 9).filter(Boolean).join(' '),
    ...row.slice(9),
  ];
}

function normalizeDate(value: string | undefined): string | undefined {
  const match = value?.trim().match(transactionDate);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function parseEuroCents(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  let normalized = value.trim().replace(/[^\d,.-]/g, '');
  if (!normalized) {
    return undefined;
  }

  const negative = normalized.startsWith('-') || normalized.endsWith('-');
  normalized = normalized.replace(/-/g, '');
  const comma = normalized.lastIndexOf(',');
  const period = normalized.lastIndexOf('.');
  const decimalSeparator = comma > period ? ',' : period === -1 ? undefined : '.';
  if (decimalSeparator) {
    const [whole, fraction = ''] = normalized.split(decimalSeparator);
    if (!whole || !/^\d{1,2}$/.test(fraction)) {
      return undefined;
    }
    const cents = Number(whole.replace(/[.,]/g, '')) * 100 + Number(fraction.padEnd(2, '0'));
    return negative ? -cents : cents;
  }

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }
  const cents = Number(normalized) * 100;
  return negative ? -cents : cents;
}
