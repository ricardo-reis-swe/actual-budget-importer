import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { BankParser, ParsedTransaction } from './bank-parser.js';
import type { PositionedText } from './generic-table-extractor.js';

const shortDatePattern = /^\d{2}[./]\d{2}$/;
const footerPattern = /Página \d+|millenniumbcp|Atendimento personalizado|Chamada para a rede|O custo das comunicações|Capital Social|Banco Comercial Português|Documento Processado/i;

export const millenniumMealCardParser: BankParser = {
  id: 'millennium-meal-card',
  name: 'Millennium Meal Card',
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
      return parseMillenniumMealCardPages(pages);
    } finally {
      await document.destroy();
    }
  },
};

export function parseMillenniumMealCardPages(
  pages: readonly (readonly PositionedText[])[],
): readonly ParsedTransaction[] {
  const pageRows = pages.map((page) => groupRows(page).map((row) => {
    const chunks = row.chunks.filter((chunk) => !footerPattern.test(chunk.text)).toSorted((a, b) => a.x - b.x);
    return { chunks, text: chunks.map((chunk) => chunk.text.trim()).join(' ') };
  }));
  const allRows = pageRows.flat();
  const period = allRows.map((row) => row.text)
    .map((text) => text.match(/Extrato de:?\s*(\d{4}\/\d{2}\/\d{2})\s+a\s+(\d{4}\/\d{2}\/\d{2})/i))
    .find((match) => match) ?? undefined;
  const summaryIndex = allRows.findIndex((row) => /Saldo mês anterior|Saldo à Data do Extrato Anterior/i.test(row.text));
  const summary = summaryIndex >= 0 ? allRows[summaryIndex + 1]?.chunks.map((chunk) => parseAmount(chunk.text)) : undefined;
  if (!summary || summary.length !== 4) throw new Error('Missing or invalid Millennium Meal Card statement summary.');

  const transactions: ParsedTransaction[] = [];
  let inSection = false;
  let columns: Partial<Record<'description' | 'descriptionEnd' | 'amount' | 'debit' | 'credit', number>> = {};

  for (const rows of pageRows) {
    let current: ParsedTransaction | undefined;
    for (const { chunks, text } of rows) {
      if (/^(?:MOVIMENTOS|Outros movimentos|DETALHE DOS MOVIMENTOS)$/i.test(text)) {
        inSection = true;
        columns = {};
        current = undefined;
        continue;
      }
      if (!inSection || !text) continue;
      if (/Total Cartão|Saldo dos movimentos/.test(text)) {
        current = undefined;
        continue;
      }
      const header = (label: string) => chunks.find((chunk) => chunk.text.trim() === label)?.x;
      const found = {
        description: header('Descritivo'),
        descriptionEnd: header('Tipo Transação') ?? header('Rede'),
        amount: header('Montante'),
        debit: header('Débito'),
        credit: header('Crédito'),
      };
      if (Object.values(found).some((x) => x !== undefined) || header('Movimento') !== undefined || header('Mov.') !== undefined) {
        for (const [key, x] of Object.entries(found)) if (x !== undefined) columns[key as keyof typeof found] = x;
        current = undefined;
        continue;
      }
      const { description, descriptionEnd, amount, debit, credit } = columns;
      const split = debit !== undefined && credit !== undefined;
      if (description === undefined || descriptionEnd === undefined || (amount === undefined && !split)) continue;
      const descriptionText = chunks.filter((chunk) => chunk.x >= description - 5 && chunk.x < descriptionEnd - 10)
        .map((chunk) => chunk.text.trim()).filter(Boolean).join(' ');
      const dates = chunks.filter((chunk) => chunk.x < description - 5)
        .flatMap((chunk) => chunk.text.trim().split(/\s+/)).filter(Boolean);
      if (dates.length > 0) {
        if (dates.length !== 2 || !dates.every((value) => shortDatePattern.test(value)) || !descriptionText) {
          throw new Error('Invalid Millennium Meal Card transaction row.');
        }
        const movementDate = resolveMovementDate(dates[0]!.replace('.', '/'), period);
        if (!normalizeDate(resolveValueDate(dates[1]!.replace('.', '/'), movementDate))) {
          throw new Error('Invalid Millennium Meal Card transaction row.');
        }
        const amounts = chunks.filter((chunk) => chunk.x >= (split ? debit : amount!) - 30);
        if (amounts.length !== 1) throw new Error('Invalid Millennium Meal Card transaction row.');
        let amountCents = parseAmount(amounts[0]!.text);
        if (split) {
          if (amountCents < 0) throw new Error('Invalid Millennium Meal Card transaction amount.');
          if (amounts[0]!.x < (debit + credit) / 2) amountCents = -amountCents;
        }
        current = { position: transactions.length, date: normalizeDate(movementDate)!, description: descriptionText, amountCents };
        transactions.push(current);
      } else if (current && descriptionText) {
        current = { ...current, description: `${current.description} ${descriptionText}` };
        transactions[current.position] = current;
      }
    }
  }

  const credits = transactions.reduce((sum, row) => sum + Math.max(row.amountCents, 0), 0);
  const debits = transactions.reduce((sum, row) => sum - Math.min(row.amountCents, 0), 0);
  if (credits !== summary[1] || debits !== Math.abs(summary[2]!)) {
    throw new Error('Millennium Meal Card transactions do not match the statement summary totals.');
  }
  return transactions;
}

function groupRows(page: readonly PositionedText[]): { y: number; chunks: PositionedText[] }[] {
  const rows: { y: number; chunks: PositionedText[] }[] = [];
  for (const chunk of page.toSorted((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - chunk.y) <= 3);
    if (row) row.chunks.push(chunk);
    else rows.push({ y: chunk.y, chunks: [chunk] });
  }
  return rows;
}

function resolveMovementDate(value: string, period: RegExpMatchArray | undefined): string {
  if (!period || !normalizeDate(period[1]!) || !normalizeDate(period[2]!) || period[1]! > period[2]!) {
    throw new Error('Missing or invalid Millennium Meal Card statement period for transaction dates.');
  }
  const earliest = Date.parse(period[1]!.replace(/\//g, '-')) - 62 * 86_400_000;
  const latest = Date.parse(period[2]!.replace(/\//g, '-'));
  const candidates: string[] = [];
  for (let year = Number(period[1]!.slice(0, 4)) - 1; year <= Number(period[2]!.slice(0, 4)); year += 1) {
    const candidate = `${year}/${value}`;
    const time = Date.parse(candidate.replace(/\//g, '-'));
    if (normalizeDate(candidate) && time >= earliest && time <= latest) candidates.push(candidate);
  }
  if (candidates.length !== 1) throw new Error('Invalid Millennium Meal Card transaction row.');
  return candidates[0]!;
}

function resolveValueDate(value: string, movementDate: string): string {
  let year = Number(movementDate.slice(0, 4));
  const monthDifference = Number(value.slice(0, 2)) - Number(movementDate.slice(5, 7));
  if (monthDifference < -6) year += 1;
  else if (monthDifference > 6) year -= 1;
  return `${year}/${value}`;
}

function normalizeDate(value: string): string | undefined {
  const [year, month, day] = value.split('/').map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
}

function parseAmount(value: string): number {
  const match = value.trim().match(/^(\d+|\d{1,3}(?: \d{3})+)\.(\d{2})(-?)$/);
  if (!match) throw new Error('Invalid Millennium Meal Card transaction amount.');
  const amount = Number(match[1]!.replace(/ /g, '')) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(amount)) throw new Error('Invalid Millennium Meal Card transaction amount.');
  return match[3] ? -amount : amount;
}
