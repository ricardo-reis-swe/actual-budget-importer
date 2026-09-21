import { describe, expect, it } from 'vitest';

import { parseWiZinkRows } from '../src/parsers/wizink-parser.js';
import {
  wizinkMalformedAmountRows,
  wizinkRegressionRows,
} from './fixtures/wizink-layout.js';

describe('WiZink parser layout profile', () => {
  it('parses dated card movements, preserving descriptions and directions', () => {
    expect(parseWiZinkRows(wizinkRegressionRows)).toEqual([
      { position: 0, date: '01-08-2026', description: 'Coffee shop Lisbon', amountCents: -450 },
      { position: 1, date: '02-08-2026', description: 'Reembolso do comerciante', amountCents: -1234 },
      { position: 2, date: '03-08-2026', description: 'Grocer', amountCents: -123456 },
      { position: 3, date: '04-08-2026', description: 'Pagamento mensal', amountCents: -10000 },
      { position: 4, date: '05-08-2026', description: 'Synthetic card payment', amountCents: 25000 },
    ]);
  });

  it('ignores headings and malformed amounts rather than guessing cents', () => {
    expect(parseWiZinkRows(wizinkMalformedAmountRows)).toEqual([
      { position: 0, date: '06-08-2026', description: 'Valid', amountCents: -1000 },
    ]);
  });
});
