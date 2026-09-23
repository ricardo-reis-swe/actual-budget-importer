import type { PosbTextChunk } from '../../src/parsers/posb-esavings-parser.js';

function chunk(text: string, x: number, y: number): PosbTextChunk {
  return { text, x, y };
}

export const posbRegressionPages = [
  [
    chunk('As at 31 Jan 2026', 445, 566),
    chunk('DATE', 37, 524),
    chunk('DETAILS OF TRANSACTIONS', 97, 524),
    chunk('WITHDRAWAL($)', 313, 524),
    chunk('DEPOSIT($)', 408, 524),
    chunk('BALANCE($)', 485, 524),
    chunk('Balance Brought Forward', 127, 493),
    chunk('1,000.00', 486, 493),
    chunk('01 Jan', 37, 477),
    chunk('Debit Card Transaction', 97, 477),
    chunk('4.50', 345, 477),
    chunk('SYNTHETIC COFFEE SHOP', 102, 469),
    chunk('REFERENCE-ONE', 102, 461),
    chunk('01 Jan', 37, 445),
    chunk('FAST Payment / Receipt', 97, 445),
    chunk('2,345.67', 414, 445),
    chunk('Synthetic incoming payment', 102, 437),
    chunk('Balance Carried Forward', 97, 421),
    chunk('3,341.17', 486, 421),
  ],
  [
    chunk('Details of Your POSB eSavings Account', 37, 680),
    chunk('DATE', 37, 661),
    chunk('DETAILS OF TRANSACTIONS', 97, 661),
    chunk('31 Jan', 37, 614),
    chunk('Interest Earned', 97, 614),
    chunk('0.05', 424, 614),
    chunk('3,341.22', 486, 614),
    chunk('Total', 97, 598),
    chunk('4.50', 327, 598),
    chunk('2,345.72', 407, 598),
  ],
] as const;

export const posbAmbiguousPages = [[
  chunk('As at 31 Jan 2026', 445, 566),
  chunk('01 Jan', 37, 477),
  chunk('Ambiguous transfer', 97, 477),
  chunk('10.00', 345, 477),
  chunk('10.00', 419, 477),
]] as const;
