import { describe, expect, it } from 'vitest';

import {
  createSanitizedFailure,
  currentFailureMessage,
  toUserFailure,
} from '../src/diagnostics/failure.js';

describe('failure handling', () => {
  it('updates previously stored support messages while preserving other errors and null', () => {
    expect(currentFailureMessage('The statement publishing failed. Try again or contact support with reference diag-old.'))
      .toBe('The statement publishing failed. Try again. If it keeps failing, check the application logs for reference diag-old.');
    expect(currentFailureMessage('Select the original PDF again.')).toBe('Select the original PDF again.');
    expect(currentFailureMessage(null)).toBeNull();
  });
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

  it('keeps only identifier-like error class and reason codes from the cause', () => {
    class PostError extends Error {
      readonly reason = 'network-failure';
      readonly meta = { token: 'top-secret' };
    }
    const actualSyncError = Object.assign(new Error('Synthetic amount=12.34'), { code: 'out-of-sync' });
    const unsafeReason = Object.assign(new Error('Synthetic'), { code: 'description=Private purchase' });

    expect(createSanitizedFailure(new PostError('token=top-secret'), 'publishing', 'diag-1')).toMatchObject({
      errorName: 'PostError',
      errorReason: 'network-failure',
    });
    expect(createSanitizedFailure(actualSyncError, 'publishing', 'diag-2')).toEqual({
      diagnosticId: 'diag-2',
      stage: 'publishing',
      status: 'failed',
      errorCode: 'PROCESSING_FAILED',
      errorReason: 'out-of-sync',
    });
    const unsafe = createSanitizedFailure(unsafeReason, 'publishing', 'diag-3');
    expect(unsafe).not.toHaveProperty('errorReason');
    expect(JSON.stringify(createSanitizedFailure(new PostError('token=top-secret'), 'publishing'))).not.toContain('top-secret');
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
        'The statement publishing failed. Try again. If it keeps failing, check the application logs for reference diag-456.',
    });
  });
});
