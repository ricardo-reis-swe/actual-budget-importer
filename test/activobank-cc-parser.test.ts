import { describe, expect, it } from 'vitest';

import { activoBankCcParser, parseActivoBankCcPages } from '../src/parsers/activobank-cc-parser.js';
import { ccHeaders, ccPages, text } from './fixtures/activobank-cc-layout.js';

const expected = [
  { position: 0, date: '02-01-2025', description: 'COMPRA Loja Exemplo', amountCents: -450 },
  { position: 1, date: '04-01-2025', description: 'COMPRA Loja com descrição longa continuação da descrição', amountCents: -123456 },
  { position: 2, date: '01-01-2025', description: '>PAGAMENTO CARTAO DE CREDITO', amountCents: 5000 },
  { position: 3, date: '06-01-2025', description: 'Reembolso Loja', amountCents: 1234 },
];

describe('ActivoBank CC parser', () => {
  it('parses only movements, using movement dates and debit/credit columns in statement order', () => {
    expect(parseActivoBankCcPages(ccPages)).toEqual(expected);
    expect(activoBankCcParser).toMatchObject({ id: 'activobank-cc', name: 'ActivoBank CC', countryCode: 'PT', countryName: 'Portugal' });
  });

  it('continues movements on a later page without a repeated heading', () => {
    expect(parseActivoBankCcPages([ccPages[1]!, [
      text('2025/01/06 2025/01/07', 55, 700), text('Reembolso Loja', 163, 700), text('12.34', 540, 700),
    ]])).toEqual(expected);
  });

  it('does not parse dated rows without the movements heading', () => {
    expect(parseActivoBankCcPages([ccPages[0]!])).toEqual([]);
  });

  it.each(['1.234', '1,23', '-1.23', 'unknown', '900719925474099.99'])('fails rather than silently losing an invalid amount: %s', (amount) => {
    expect(() => parseActivoBankCcPages([[...ccHeaders,
      text('2025/01/02 2025/01/03', 55, 350), text('Synthetic purchase', 163, 350), text(amount, 465, 350),
    ]])).toThrow('Invalid ActivoBank CC transaction amount');
  });

  it.each(['2025/02/30', '2025/13/01'])('rejects invalid transaction dates: %s', (date) => {
    expect(() => parseActivoBankCcPages([[...ccHeaders,
      text(`${date} 2025/01/03`, 55, 350), text('Synthetic purchase', 163, 350), text('1.23', 465, 350),
    ]])).toThrow('Invalid ActivoBank CC transaction row');
  });

  it('rejects missing or ambiguous debit/credit amounts', () => {
    const row = [text('2025/01/02 2025/01/03', 55, 350), text('Synthetic purchase', 163, 350)];
    expect(() => parseActivoBankCcPages([[...ccHeaders, ...row]])).toThrow();
    expect(() => parseActivoBankCcPages([[...ccHeaders, ...row, text('1.23', 465, 350), text('2.34', 545, 350)]])).toThrow();
  });

  it('extracts the synthetic layout from actual PDF bytes, including Node Buffers', async () => {
    expect(await activoBankCcParser.parse(syntheticPdf())).toEqual(expected);
  });
});

function syntheticPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${ccPages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${ccPages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  for (const [index, page] of ccPages.entries()) {
    const stream = page.map(({ text, x, y }) => `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`).join('\n');
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
