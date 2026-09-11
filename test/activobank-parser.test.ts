import { describe, expect, it } from 'vitest';

import { parseActivoBankRows } from '../src/parsers/activobank-parser.js';
import {
  activoBankMalformedAmountRows,
  activoBankRegressionRows,
} from './fixtures/activobank-layout.js';

describe('ActivoBank parser layout profile', () => {
  it('merges descriptions and infers signs from consecutive balances', () => {
    expect(parseActivoBankRows(activoBankRegressionRows)).toEqual([
      {
        position: 0,
        date: '30-07-2026',
        description: 'Opening balance',
        amountCents: 0,
      },
      {
        position: 1,
        date: '01-08-2026',
        description: 'Coffee shop',
        amountCents: -450,
      },
      {
        position: 2,
        date: '02-08-2026',
        description: 'Salary August',
        amountCents: 100000,
      },
      {
        position: 3,
        date: '03-08-2026',
        description: 'Refund',
        amountCents: 1234,
      },
    ]);
  });

  it('rejects rows whose monetary fields cannot be parsed exactly', () => {
    expect(parseActivoBankRows(activoBankMalformedAmountRows)).toEqual([]);
  });
});
