import { describe, expect, it } from 'vitest';

import { parseWiZinkRows } from '../src/parsers/wizink-parser.js';

describe('WiZink parser layout profile', () => {
  it('parses dated card movements, preserving descriptions and directions', () => {
    const rows = [
      ['Data', 'Descrição', 'Montante'],
      ['01/08/2026', 'Coffee shop Lisbon', '4,50 EUR'],
      ['02-08-2026', 'Reembolso do comerciante', '12,34'],
      ['03/08/2026', 'Grocer', '1.234,56 D'],
      ['04/08/2026', 'Pagamento mensal', '100,00'],
    ];

    expect(parseWiZinkRows(rows)).toEqual([
      { position: 0, date: '01-08-2026', description: 'Coffee shop Lisbon', amountCents: -450 },
      { position: 1, date: '02-08-2026', description: 'Reembolso do comerciante', amountCents: 1234 },
      { position: 2, date: '03-08-2026', description: 'Grocer', amountCents: -123456 },
      { position: 3, date: '04-08-2026', description: 'Pagamento mensal', amountCents: 10000 },
    ]);
  });

  it('ignores headings and malformed amounts rather than guessing cents', () => {
    expect(parseWiZinkRows([
      ['Página 1 de 2'],
      ['05/08/2026', 'Malformed', '1,2'],
      ['06/08/2026', 'Valid', '10,00'],
    ])).toEqual([
      { position: 0, date: '06-08-2026', description: 'Valid', amountCents: -1000 },
    ]);
  });
});
