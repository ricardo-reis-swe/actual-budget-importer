import { randomUUID } from 'node:crypto';

export type ProcessingStage =
  | 'upload'
  | 'retrieval'
  | 'extraction'
  | 'publishing'
  | 'synchronization';

export interface SanitizedFailure {
  readonly diagnosticId: string;
  readonly stage: ProcessingStage;
  readonly status: 'failed';
  readonly errorCode: 'PROCESSING_FAILED';
}

export interface UserFailure {
  readonly diagnosticId: string;
  readonly message: string;
}

/**
 * Produces the only failure payload suitable for application logs. The cause
 * is deliberately not inspected or retained because it may contain financial
 * data, credentials, or a stack trace.
 */
export function createSanitizedFailure(
  _cause: unknown,
  stage: ProcessingStage,
  diagnosticId: string = randomUUID(),
): SanitizedFailure {
  return {
    diagnosticId,
    stage,
    status: 'failed',
    errorCode: 'PROCESSING_FAILED',
  };
}

export function toUserFailure(failure: SanitizedFailure): UserFailure {
  return {
    diagnosticId: failure.diagnosticId,
    message: `The statement ${failure.stage} failed. Try again. If it keeps failing, check the application logs for reference ${failure.diagnosticId}.`,
  };
}

export function currentFailureMessage(message: string | null): string | null {
  return message?.replace(
    /Try again or contact support with reference ([\w-]+)\.$/,
    'Try again. If it keeps failing, check the application logs for reference $1.',
  ) ?? null;
}
