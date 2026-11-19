import { describe, expect, it } from 'vitest';

import { millenniumMealCardParser, parseMillenniumMealCardPages } from '../src/parsers/millennium-meal-card-parser.js';
import type { PositionedText } from '../src/parsers/generic-table-extractor.js';

const text = (value: string, x: number, y: number): PositionedText => ({ text: value, x, y });

const summary = (previous: string, credits: string, debits: string, balance: string, period = '2025/03/01 a 2025/03/31') => [
  text('Extrato M REFEICAO', 57, 567),
  text('RESUMO DA CONTA', 60, 539),
  text('Extrato de:', 74, 517), text(period, 195, 517),
  text('RESUMO DE MOVIMENTOS', 60, 471),
  text('Saldo mês anterior', 127, 446), text('Créditos', 234, 446), text('Débitos', 308, 446), text('Saldo', 471, 446),
  text(previous, 186, 436), text(credits, 253, 436), text(debits, 324, 436), text(balance, 477, 436),
];

const headers = (top: number) => [
  text('Data', 60, top), text('Data', 102, top), text('Montante', 536, top),
  text('Descritivo', 130, top - 4), text('Tipo Transação', 293, top - 4), text('Rede', 351, top - 4),
  text('Movimento', 60, top - 10), text('Valor', 102, top - 10), text('(EUR)', 547, top - 10),
];

const purchase = (dates: [string, string], description: string, amount: string, y: number) => [
  text(dates[0], 60, y), text(dates[1], 99, y), text(description, 128, y),
  text('COMPRAS', 286, y), text('MB', 351, y), text(amount, 539, y),
];

const footer = (page: string) => [
  text('Banco Comercial Português, S.A., Sede: Exemplo', 13, 144),
  text('(Documento Processado por Computador)', 57, 76), text(`Página ${page}`, 539, 76),
  text('Capital Social: 1,00 Euros', 19, 74),
  text('www.millenniumbcp.pt', 57, 31),
];

const pages = [
  [...summary('10.00', '150.00', '23.70', '136.30'),
    text('MOVIMENTOS', 60, 411),
    text('Cartão XXXX XXXX XXXX 0000 - TITULAR EXEMPLO', 74, 388),
    ...headers(371),
    ...purchase(['03.02', '03.04'], 'COMPRA 0000 SUPERMERCADO', '3.20-', 349),
    text('EXEMPLO CONT', 128, 339),
    ...purchase(['03.15', '03.15'], 'COMPRA 0000 PADARIA', '20.50-', 327),
    text('EXEMPLO', 128, 140),
    text('Total Cartão XXXX XXXX XXXX 0000', 344, 124), text('23.70-', 536, 124),
    ...footer('1 / 2')],
  [text('Outros movimentos', 74, 745),
    ...headers(728),
    text('03.20', 60, 707), text('03.20', 99, 707), text('TRF DE PAG.ENT:00000', 128, 707),
    text('CARREGAME', 286, 707), text('150.00', 537, 707),
    text('REF:000000000', 128, 696), text('NTO', 286, 696),
    text('126.30', 546, 673), text('Saldo dos movimentos no periodo', 328, 672),
    ...footer('2 / 2')],
];

const expected = [
  { position: 0, date: '02-03-2025', description: 'COMPRA 0000 SUPERMERCADO EXEMPLO CONT', amountCents: -320 },
  { position: 1, date: '15-03-2025', description: 'COMPRA 0000 PADARIA EXEMPLO', amountCents: -2050 },
  { position: 2, date: '20-03-2025', description: 'TRF DE PAG.ENT:00000 REF:000000000', amountCents: 15000 },
];

describe('Millennium Meal Card parser', () => {
  it('parses card purchases and other movements in statement order', () => {
    expect(parseMillenniumMealCardPages(pages)).toEqual(expected);
    expect(millenniumMealCardParser).toMatchObject({
      id: 'millennium-meal-card', name: 'Millennium Meal Card', countryCode: 'PT', countryName: 'Portugal',
    });
    expect(millenniumMealCardParser.enabledByDefault).toBeUndefined();
  });

  it('extracts the synthetic layout from actual PDF bytes', async () => {
    expect(await millenniumMealCardParser.parse(syntheticPdf(pages))).toEqual(expected);
  });

  it('fails when the rows do not add up to the summary totals', () => {
    expect(() => parseMillenniumMealCardPages([[...summary('10.00', '150.00', '23.71', '136.29'), ...pages[0]!.slice(13)], pages[1]!]))
      .toThrow('do not match the statement summary totals');
    expect(() => parseMillenniumMealCardPages([pages[0]!]))
      .toThrow('do not match the statement summary totals');
  });

  it('fails without a statement summary', () => {
    expect(() => parseMillenniumMealCardPages([pages[0]!.slice(13), pages[1]!])).toThrow('statement summary');
  });

  it('resolves years across December and January', () => {
    expect(parseMillenniumMealCardPages([[...summary('0.00', '0.00', '3.00', '3.00-', '2024/12/15 a 2025/01/14'),
      text('MOVIMENTOS', 60, 411), ...headers(371),
      ...purchase(['12.31', '01.02'], 'Year-end purchase', '1.00-', 349),
      ...purchase(['01.03', '01.03'], 'New-year purchase', '2.00-', 327),
    ]])).toEqual([
      { position: 0, date: '31-12-2024', description: 'Year-end purchase', amountCents: -100 },
      { position: 1, date: '03-01-2025', description: 'New-year purchase', amountCents: -200 },
    ]);
  });

  it.each(['1,23-', '1.234', '-1.23', 'unknown'])('fails rather than silently losing an invalid amount: %s', (amount) => {
    expect(() => parseMillenniumMealCardPages([[...summary('0.00', '0.00', '1.23', '0.00'),
      text('MOVIMENTOS', 60, 411), ...headers(371), ...purchase(['03.02', '03.02'], 'Synthetic purchase', amount, 349),
    ]])).toThrow('Invalid Millennium Meal Card transaction amount');
  });

  it.each([['02.30', '03.01'], ['04.02', '04.02'], ['03.02', '13.01']])('rejects invalid or out-of-period dates: %s %s', (movement, value) => {
    expect(() => parseMillenniumMealCardPages([[...summary('0.00', '0.00', '1.23', '0.00'),
      text('MOVIMENTOS', 60, 411), ...headers(371), ...purchase([movement, value], 'Synthetic purchase', '1.23-', 349),
    ]])).toThrow('Invalid Millennium Meal Card transaction row');
  });

  it('rejects rows with a missing or ambiguous amount', () => {
    const row = [text('03.02', 60, 349), text('03.02', 99, 349), text('Synthetic purchase', 128, 349)];
    const start = [...summary('0.00', '0.00', '1.23', '0.00'), text('MOVIMENTOS', 60, 411), ...headers(371)];
    expect(() => parseMillenniumMealCardPages([[...start, ...row]])).toThrow('Invalid Millennium Meal Card transaction row');
    expect(() => parseMillenniumMealCardPages([[...start, ...row, text('1.23-', 520, 349), text('2.00-', 545, 349)]]))
      .toThrow('Invalid Millennium Meal Card transaction row');
  });

  it('ignores dated rows outside the movement sections', () => {
    expect(parseMillenniumMealCardPages([[...summary('0.00', '0.00', '0.00', '0.00'), ...headers(371),
      ...purchase(['03.02', '03.02'], 'Outside table', '1.23-', 349),
    ]])).toEqual([]);
  });
});

function syntheticPdf(pdfPages: readonly (readonly PositionedText[])[]): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pdfPages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pdfPages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  for (const [index, page] of pdfPages.entries()) {
    const stream = page.map(({ text: value, x, y }) => `BT /F1 7 Tf 1 0 0 1 ${x} ${y} Tm (${value.replace(/[\\()]/g, '\\$&')}) Tj ET`).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
