import { describe, expectTypeOf, it } from 'vitest';

import type { BankParser, ParsedTransaction } from '../src/parsers/bank-parser.js';

describe('bank parser contract', () => {
  it('accepts in-memory PDF bytes and returns ordered transaction rows', () => {
    expectTypeOf<BankParser['parse']>().toEqualTypeOf<
      (pdf: Uint8Array) => Promise<readonly ParsedTransaction[]>
    >();
  });

  it('models values required by the statement workflow', () => {
    expectTypeOf<ParsedTransaction>().toMatchTypeOf<{
      readonly position: number;
      readonly date: string;
      readonly description: string;
      readonly amountCents: number;
    }>();
  });
});
