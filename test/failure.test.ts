import { describe, expect, it } from 'vitest';

import {
  createSanitizedFailure,
  toUserFailure,
} from '../src/diagnostics/failure.js';

describe('failure handling', () => {
  it('creates a diagnostic record without retaining sensitive cause data', () => {
    const sensitiveCause = new Error(
      'token=top-secret description=Private purchase amount=12.34 category=Household',
    );

    const failure = createSanitizedFailure(sensitiveCause, 'extraction', 'diag-123');

    expect(failure).toEqual({
      diagnosticId: 'diag-123',
      stage: 'extraction',
      status: 'failed',
      errorCode: 'PROCESSING_FAILED',
    });
    expect(JSON.stringify(failure)).not.toContain('top-secret');
    expect(JSON.stringify(failure)).not.toContain('Private purchase');
    expect(JSON.stringify(failure)).not.toContain('12.34');
    expect(JSON.stringify(failure)).not.toContain('Household');
  });

  it('gives the user an actionable message without exposing the cause', () => {
    const failure = createSanitizedFailure(
      new Error('password=do-not-disclose'),
      'publishing',
      'diag-456',
    );

    expect(toUserFailure(failure)).toEqual({
      diagnosticId: 'diag-456',
      message:
        'The statement publishing failed. Try again or contact support with reference diag-456.',
    });
  });
});
