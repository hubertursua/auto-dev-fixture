import { err, ok, type InvalidAmountError, type Result } from '../errors.js';

/** Accepts a positive, safe integer amount in minor units. */
export function validateAmount(amount: number): Result<number, InvalidAmountError> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return err({
      code: 'INVALID_AMOUNT',
      message: `amount must be a positive integer number of minor units, got ${String(amount)}`,
      amount,
    });
  }
  return ok(amount);
}
