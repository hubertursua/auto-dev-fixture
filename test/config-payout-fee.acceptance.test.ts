import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/index.js';
import type { Config } from '../src/index.js';

/** Calls `withOverrides` the way an untyped (plain JavaScript) caller could. */
const overrideFeeUntyped = (fee: unknown): Config =>
  withOverrides({ payoutFee: fee } as unknown as Partial<Config>);

describe('payout fee setting', () => {
  it('lists a payout fee of 0 among the default settings', () => {
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      payoutFee: 0,
    });
  });

  it('overriding the payout fee to 250 leaves the frozen defaults at 0', () => {
    const config = withOverrides({ payoutFee: 250 });
    expect(config).toMatchObject({ payoutFee: 250 });
    expect(defaultConfig).toMatchObject({ payoutFee: 0 });
    expect(Object.isFrozen(defaultConfig)).toBe(true);
  });

  it('accepts a payout fee override of 0', () => {
    let config: Config | undefined;
    expect(() => {
      config = withOverrides({ payoutFee: 0 });
    }).not.toThrow();
    expect(config).toMatchObject({ payoutFee: 0 });
  });

  it('throws an error naming payoutFee for a payout fee override of -1', () => {
    expect(() => withOverrides({ payoutFee: -1 })).toThrow(/payoutFee/);
  });

  it.each([
    ['1.5', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-1', -1],
    ['2 ** 53', 2 ** 53],
    ['undefined', undefined],
  ])('refuses a payout fee override of %s with an error naming payoutFee', (_label, fee) => {
    expect(() => overrideFeeUntyped(fee)).toThrow(/payoutFee/);
  });
});
