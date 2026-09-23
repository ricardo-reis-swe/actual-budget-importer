import { describe, expect, it } from 'vitest';

import { parsePosbText, posbDbsParser } from '../src/parsers/posb-dbs-parser.js';
import { posbAmbiguousPages, posbRegressionPages } from './fixtures/posb-dbs-layout.js';

describe('POSB/DBS parser', () => {
  it('is registered as a hidden-by-default Singapore parser', () => {
    expect(posbDbsParser).toMatchObject({
      countryCode: 'SG',
      countryName: 'Singapore',
      id: 'posb-dbs',
      name: 'POSB/DBS',
    });
    expect(posbDbsParser.enabledByDefault).toBeUndefined();
  });

  it('parses multipage withdrawals, deposits, and multiline descriptions', () => {
    expect(parsePosbText(posbRegressionPages)).toEqual([
      {
        amountCents: -450,
        date: '01-01-2026',
        description: 'Debit Card Transaction SYNTHETIC COFFEE SHOP REFERENCE-ONE',
        position: 0,
      },
      {
        amountCents: 234567,
        date: '01-01-2026',
        description: 'FAST Payment / Receipt Synthetic incoming payment',
        position: 1,
      },
      {
        amountCents: 5,
        date: '31-01-2026',
        description: 'Interest Earned',
        position: 2,
      },
    ]);
  });

  it('rejects transaction rows with ambiguous amount columns', () => {
    expect(() => parsePosbText(posbAmbiguousPages)).toThrow('could not be parsed unambiguously');
  });

  it('requires a readable statement year', () => {
    expect(() => parsePosbText([[]])).toThrow('statement date could not be read');
  });
});
