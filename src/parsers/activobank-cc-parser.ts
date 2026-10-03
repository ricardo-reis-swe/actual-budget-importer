import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { BankParser, ParsedTransaction } from './bank-parser.js';
import type { PositionedText } from './generic-table-extractor.js';

const datePattern = /^\d{4}\/\d{2}\/\d{2}$/;

export const activoBankCcParser: BankParser = {
  id: 'activobank-cc',
  name: 'ActivoBank CC',
  countryCode: 'PT',
  countryName: 'Portugal',
  async parse(pdf: Uint8Array): Promise<readonly ParsedTransaction[]> {
    const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
    try {
      const pages: PositionedText[][] = [];
      for (let number = 1; number <= document.numPages; number += 1) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        pages.push(content.items.flatMap((item) => 'str' in item && item.str.trim()
          ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }]
          : []));
      }
      return parseActivoBankCcPages(pages);
    } finally {
      await document.destroy();
    }
  },
};

export function parseActivoBankCcPages(
  pages: readonly (readonly PositionedText[])[],
): readonly ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  let inMovements = false;
  let columns: { description: number; network: number; debit: number; credit: number } | undefined;

  for (const page of pages) {
    const rows: { y: number; chunks: PositionedText[] }[] = [];
    for (const chunk of page.toSorted((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find((candidate) => Math.abs(candidate.y - chunk.y) <= 3);
      if (row) row.chunks.push(chunk);
      else rows.push({ y: chunk.y, chunks: [chunk] });
    }
    let current: ParsedTransaction | undefined;
    for (const row of rows) {
      const chunks = row.chunks.toSorted((a, b) => a.x - b.x);
      const text = chunks.map((chunk) => chunk.text.trim()).join(' ');
      if (text.includes('DETALHE DOS MOVIMENTOS')) {
        inMovements = true;
        current = undefined;
        continue;
      }
      if (!inMovements) continue;
      const descriptionHeader = chunks.find((chunk) => chunk.text.trim() === 'Descritivo');
      if (descriptionHeader) {
        const network = chunks.find((chunk) => chunk.text.trim() === 'Rede');
        const debit = chunks.find((chunk) => chunk.text.trim() === 'Débito');
        const credit = chunks.find((chunk) => chunk.text.trim() === 'Crédito');
        if (!network || !debit || !credit) throw new Error('Invalid ActivoBank CC table headers.');
        columns = { description: descriptionHeader.x, network: network.x, debit: debit.x, credit: credit.x };
        current = undefined;
        continue;
      }
      if (/Pág\.|www\.activobank|Atendimento personalizado|Chamada para a rede|O custo das comunicações/i.test(text)) {
        current = undefined;
        continue;
      }
      if (/^(?:RESUMO|DETALHE DE|INFORMAÇÃO|IMPUTAÇÃO|MENSAGENS)\b/.test(text)) {
        inMovements = false;
        current = undefined;
        continue;
      }
      if (!columns) continue;
      const layout = columns;
      const dates = chunks.filter((chunk) => chunk.x < layout.description)
        .flatMap((chunk) => chunk.text.trim().split(/\s+/)).filter((value) => datePattern.test(value));
      if (dates.length > 0) {
        const date = normalizeDate(dates[0]!);
        const description = chunks.filter((chunk) => chunk.x >= layout.description - 3 && chunk.x < layout.debit - 25)
          .map((chunk) => chunk.text.trim()).join(' ').trim();
        const amounts = chunks.filter((chunk) => chunk.x >= layout.debit - 25);
        if (dates.length !== 2 || !date || !normalizeDate(dates[1]!) || !description || amounts.length !== 1) {
          throw new Error('Invalid ActivoBank CC transaction row.');
        }
        const amount = parseAmount(amounts[0]!.text);
        const credit = amounts[0]!.x >= (layout.debit + layout.credit) / 2;
        current = { position: transactions.length, date, description, amountCents: credit ? amount : -amount };
        transactions.push(current);
      } else if (current) {
        const continuation = chunks.filter((chunk) => chunk.x >= layout.description - 3 && chunk.x < layout.network - 3)
          .map((chunk) => chunk.text.trim()).filter(Boolean).join(' ');
        if (continuation) {
          current = { ...current, description: `${current.description} ${continuation}` };
          transactions[current.position] = current;
        }
      }
    }
  }
  return transactions;
}

function normalizeDate(value: string): string | undefined {
  const [year, month, day] = value.split('/').map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
}

function parseAmount(value: string): number {
  const match = value.trim().match(/^(\d+|\d{1,3}(?: \d{3})+)\.(\d{2})$/);
  if (!match) throw new Error('Invalid ActivoBank CC transaction amount.');
  const amount = Number(match[1]!.replace(/ /g, '')) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(amount)) throw new Error('Invalid ActivoBank CC transaction amount.');
  return amount;
}
