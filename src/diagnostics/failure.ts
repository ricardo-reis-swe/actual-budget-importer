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
 * Produces the failure payload stored on statements. The cause's message,
 * stack, and metadata are never retained because they may contain financial
 * data or credentials; only its class name (or the `type` of an object thrown
 * by Actual Budget's API) and a machine-readable reason code are kept when
 * they are short identifiers.
 */
export function createSanitizedFailure(
  cause: unknown,
  stage: ProcessingStage,
  diagnosticId: string = randomUUID(),
): SanitizedFailure {
  const errorName = cause instanceof Error ? cause.constructor.name
    : typeof cause === 'object' && cause !== null && typeof (cause as { type?: unknown }).type === 'string'
      ? (cause as { type: string }).type
      : undefined;
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

export interface FailureLogEntry extends SanitizedFailure {
  readonly errorMessage?: string;
  readonly errorStack?: readonly string[];
  readonly causeMessage?: string;
  readonly causeStack?: readonly string[];
}

export class DiagnosedFailure extends Error {
  constructor(readonly failure: SanitizedFailure, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Processing failed.', { cause });
    this.name = 'DiagnosedFailure';
  }
}

const maximumMessageLength = 300;
const maximumStackFrames = 15;

/**
 * Adds the cause's scrubbed message and stack frames to a sanitized failure
 * for application logs only. Quoted text, numbers, key=value values, and the
 * given secrets are redacted because Actual Budget and SQLite messages can
 * embed identifiers, payees, or amounts. Stack frames carry only code
 * locations. Plain objects thrown by Actual Budget's API (`{ type, message }`)
 * are described as well as Error instances.
 */
export function createFailureLogEntry(
  failure: SanitizedFailure,
  cause: unknown,
  secrets: readonly string[] = [],
): FailureLogEntry {
  const described = describeCause(cause, secrets);
  const nested = cause instanceof Error && cause.cause !== undefined && !(cause instanceof DiagnosedFailure)
    ? describeCause(cause.cause, secrets)
    : {};
  return {
    ...failure,
    ...(described.message ? { errorMessage: described.message } : {}),
    ...(described.stack ? { errorStack: described.stack } : {}),
    ...(nested.message ? { causeMessage: nested.message } : {}),
    ...(nested.stack ? { causeStack: nested.stack } : {}),
  };
}

function describeCause(cause: unknown, secrets: readonly string[]): { message?: string; stack?: string[] } {
  const message = cause instanceof Error || isRecord(cause)
    ? (cause as { message?: unknown }).message
    : typeof cause === 'string' ? cause : undefined;
  const stack = cause instanceof Error && typeof cause.stack === 'string'
    ? cause.stack.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('at '))
      .slice(0, maximumStackFrames).map((line) => scrub(line, secrets, false))
    : [];
  return {
    ...(typeof message === 'string' && message ? { message: scrub(message, secrets, true).slice(0, maximumMessageLength) } : {}),
    ...(stack.length > 0 ? { stack } : {}),
  };
}

function scrub(text: string, secrets: readonly string[], redactValues: boolean): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  result = result.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//[redacted]@');
  if (!redactValues) return result;
  return result
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"[redacted]"')
    .replace(/\b([A-Za-z_][\w-]*)=[^\s,;)]+/g, '$1=[redacted]')
    .replace(/[-+]?\d[\d.,]*/g, '#');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
