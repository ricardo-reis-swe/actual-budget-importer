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
  readonly errorName?: string;
  readonly errorReason?: string;
}

export interface UserFailure {
  readonly diagnosticId: string;
  readonly message: string;
}

const safeErrorName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const safeErrorReason = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Produces the only failure payload suitable for application logs. The cause's
 * message, stack, and metadata are never retained because they may contain
 * financial data or credentials; only its class name and a machine-readable
 * reason code (such as Actual Budget's sync reasons) are kept when they are
 * short identifiers.
 */
export function createSanitizedFailure(
  cause: unknown,
  stage: ProcessingStage,
  diagnosticId: string = randomUUID(),
): SanitizedFailure {
  const errorName = cause instanceof Error ? cause.constructor.name : undefined;
  const reason = cause instanceof Error ? (cause as { code?: unknown; reason?: unknown }) : undefined;
  const errorReason = [reason?.code, reason?.reason].find((value) => typeof value === 'string');
  return {
    diagnosticId,
    stage,
    status: 'failed',
    errorCode: 'PROCESSING_FAILED',
    ...(errorName && errorName !== 'Error' && safeErrorName.test(errorName) ? { errorName } : {}),
    ...(typeof errorReason === 'string' && safeErrorReason.test(errorReason) ? { errorReason } : {}),
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
