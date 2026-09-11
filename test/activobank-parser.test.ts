import { describe, expect, it } from 'vitest';

import { parseActivoBankRows } from '../src/parsers/activobank-parser.js';

describe('ActivoBank parser layout profile', () => {
  it('merges descriptions and infers signs from consecutive balances', () => {
    const headers = Array.from({ length: 29 }, () => ['statement heading']);
    const rows = [
      ...headers,
      ['01/08/2026', '', 'Coffee', 'shop', '', '', '', '', '', '4,50', '995,50'],
      ['02-08-2026', '', 'Salary', '', '', '', '', '', '', '1.000,00', '1995,50'],
      ['03-08-2026', '', 'Banco ActivoBank', '', '', '', '', '', '', '0,00', '1995,50'],
    ];

    expect(parseActivoBankRows(rows)).toEqual([
      {
        position: 0,
        date: '01-08-2026',
        description: 'Coffee shop',
        amountCents: 450,
      },
      {
        position: 1,
        date: '02-08-2026',
        description: 'Salary',
        amountCents: 100000,
      },
    ]);
  });

  it('rejects rows whose monetary fields cannot be parsed exactly', () => {
    const headers = Array.from({ length: 29 }, () => ['statement heading']);
    const rows = [
      ...headers,
      ['01-08-2026', '', 'Invalid', '', '', '', '', '', '', '1,234', '10,00'],
    ];

    expect(parseActivoBankRows(rows)).toEqual([]);
  });
});
