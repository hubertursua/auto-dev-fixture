/**
 * The outcome of an operation that can fail in an expected way.
 *
 * Functions return a `Result` instead of throwing for failures a caller should
 * handle (bad input, missing funds, a disallowed status change). Throwing is
 * kept for programmer errors.
 */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Shape shared by every error the library returns. */
export interface LibraryError<C extends string = string> {
  readonly code: C;
  readonly message: string;
}

export interface InvalidAmountError extends LibraryError<'INVALID_AMOUNT'> {
  readonly amount: number;
}

export interface InsufficientFundsError extends LibraryError<'INSUFFICIENT_FUNDS'> {
  readonly available: number;
  readonly requested: number;
}

export interface WalletNotFoundError extends LibraryError<'WALLET_NOT_FOUND'> {
  readonly walletId: string;
}

export interface WalletExistsError extends LibraryError<'WALLET_EXISTS'> {
  readonly walletId: string;
}

export interface PayoutNotFoundError extends LibraryError<'PAYOUT_NOT_FOUND'> {
  readonly payoutId: string;
}

export interface BelowMinimumPayoutError extends LibraryError<'BELOW_MINIMUM_PAYOUT'> {
  readonly minimum: number;
  readonly requested: number;
}

export interface AboveMaximumPayoutError extends LibraryError<'ABOVE_MAXIMUM_PAYOUT'> {
  readonly maximum: number;
  readonly requested: number;
}

export interface InvalidTransitionError extends LibraryError<'INVALID_TRANSITION'> {
  readonly from: string;
  readonly to: string;
}

export type InvalidDateError = LibraryError<'INVALID_DATE'>;

export interface InvalidPageError extends LibraryError<'INVALID_PAGE'> {
  readonly page: number;
  readonly pageSize: number;
}
