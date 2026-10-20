import { err, ok, type InvalidDateError, type Result } from '../errors.js';

export interface ExpiryInput {
  readonly issuedAt: Date | string;
  readonly expiresAt: Date | string;
}

export interface ExpiryWindow {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

function toDate(value: Date | string): Date | undefined {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function invalidDate(): InvalidDateError {
  return { code: 'INVALID_DATE', message: 'invalid date' };
}

/**
 * Parses both ends of a validity window and checks that it closes after it
 * opens. Strings must be ISO 8601.
 */
export function validateExpiry(input: ExpiryInput): Result<ExpiryWindow, InvalidDateError> {
  const issuedAt = toDate(input.issuedAt);
  if (issuedAt === undefined) {
    return err(invalidDate());
  }
  const expiresAt = toDate(input.expiresAt);
  if (expiresAt === undefined) {
    return err(invalidDate());
  }
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    return err(invalidDate());
  }
  return ok({ issuedAt, expiresAt });
}

/** True once `at` reaches the end of the window. */
export function isExpired(window: ExpiryWindow, at: Date): boolean {
  return at.getTime() >= window.expiresAt.getTime();
}
