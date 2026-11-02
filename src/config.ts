/** Library-wide settings. Every field has a default in {@link defaultConfig}. */
export interface Config {
  /** Page size used by list operations when the caller does not pass one. */
  readonly defaultPageSize: number;
  /** Largest page size a list operation accepts. */
  readonly maxPageSize: number;
  /** Smallest payout amount, in minor units, that can be requested. */
  readonly minPayoutAmount: number;
  /** Flat fee in minor units added to every payout. Non-negative safe integer; default 0. */
  readonly payoutFee: number;
}

export const defaultConfig: Config = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 100,
  minPayoutAmount: 100,
  payoutFee: 0,
});

/** Returns `value` if it is a usable payout fee; otherwise throws a RangeError that names `payoutFee`. */
export function assertPayoutFee(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `payoutFee must be a non-negative safe integer number of minor units, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Returns the defaults with `overrides` applied. Neither input is modified.
 * Throws a RangeError naming `payoutFee` when the merged fee is not a non-negative safe integer.
 */
export function withOverrides(overrides: Partial<Config> = {}): Config {
  const merged: Config = { ...defaultConfig, ...overrides };
  assertPayoutFee(merged.payoutFee);
  return Object.freeze(merged);
}
