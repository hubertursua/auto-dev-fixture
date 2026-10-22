/** Library-wide settings. Every field has a default in {@link defaultConfig}. */
export interface Config {
  /** Page size used by list operations when the caller does not pass one. */
  readonly defaultPageSize: number;
  /** Largest page size a list operation accepts. */
  readonly maxPageSize: number;
  /** Smallest payout amount, in minor units, that can be requested. */
  readonly minPayoutAmount: number;
  /** Flat fee in minor units added to every payout's charge. 0 = no fee. */
  readonly payoutFee: number;
}

export const defaultConfig: Config = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 100,
  minPayoutAmount: 100,
  payoutFee: 0,
});

/** Throws when `fee` is not an integer in [0, Number.MAX_SAFE_INTEGER]. Bad config is a programmer error. */
export function assertValidPayoutFee(fee: number): void {
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error(
      `payoutFee must be an integer from 0 to ${String(Number.MAX_SAFE_INTEGER)} minor units, got ${String(fee)}`,
    );
  }
}

/**
 * Returns the defaults with `overrides` applied. Neither input is modified.
 * Throws when the resulting `payoutFee` is not a valid fee (see {@link assertValidPayoutFee}).
 */
export function withOverrides(overrides: Partial<Config> = {}): Config {
  const config: Config = { ...defaultConfig, ...overrides };
  assertValidPayoutFee(config.payoutFee);
  return Object.freeze(config);
}
