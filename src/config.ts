/** Library-wide settings. Every field has a default in {@link defaultConfig}. */
export interface Config {
  /** Page size used by list operations when the caller does not pass one. */
  readonly defaultPageSize: number;
  /** Largest page size a list operation accepts. */
  readonly maxPageSize: number;
  /** Smallest payout amount, in minor units, that can be requested. */
  readonly minPayoutAmount: number;
}

export const defaultConfig: Config = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 100,
  minPayoutAmount: 100,
});

/** Returns the defaults with `overrides` applied. Neither input is modified. */
export function withOverrides(overrides: Partial<Config> = {}): Config {
  return Object.freeze({ ...defaultConfig, ...overrides });
}
