import { describe, expect, it } from 'vitest';

import { extractGenericTable } from '../src/parsers/generic-table-extractor.js';

describe('generic table extractor', () => {
  it('reconstructs ordered rows and shared columns across pages', () => {
    const table = extractGenericTable([
      [
        { text: 'Date', x: 10, y: 700 },
        { text: 'Description', x: 100, y: 700 },
        { text: 'Amount', x: 300, y: 700 },
        { text: '01-02-2026', x: 10, y: 680 },
        { text: 'Coffee', x: 100, y: 680 },
        { text: 'shop', x: 138, y: 681 },
        { text: '-3.50', x: 300, y: 680 },
      ],
      [
        { text: '02-02-2026', x: 11, y: 700 },
        { text: 'Salary', x: 101, y: 700 },
        { text: '2500.00', x: 301, y: 700 },
      ],
    ]);

    expect(table.columnAnchors).toEqual([10, 100, 300]);
    expect(table.rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['01-02-2026', 'Coffee shop', '-3.50'],
      ['02-02-2026', 'Salary', '2500.00'],
    ]);
  });

  it('ignores blank chunks and falls back to detected starts for short tables', () => {
    const table = extractGenericTable([
      [
        { text: '   ', x: 5, y: 100 },
        { text: 'Only', x: 20, y: 90 },
        { text: 'row', x: 80, y: 90 },
      ],
    ]);

    expect(table).toEqual({
      columnAnchors: [20, 80],
      rows: [['Only', 'row']],
    });
  });

  it('rejects invalid layout options', () => {
    expect(() => extractGenericTable([], { columnGap: 0 })).toThrow('columnGap');
    expect(() => extractGenericTable([], { rowTolerance: -1 })).toThrow('rowTolerance');
    expect(() => extractGenericTable([], { minimumColumnFraction: 2 })).toThrow(
      'minimumColumnFraction',
    );
  });
});
