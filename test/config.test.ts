import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config.js';
import type { Config } from '../src/config.js';

describe('config', () => {
  it('has defaults for every setting', () => {
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      payoutFee: 0,
    });
  });

  it('applies overrides on top of the defaults', () => {
    const config = withOverrides({ defaultPageSize: 5 });
    expect(config.defaultPageSize).toBe(5);
    expect(config.maxPageSize).toBe(defaultConfig.maxPageSize);
  });

  it('leaves the defaults untouched', () => {
    withOverrides({ maxPageSize: 1 });
    expect(defaultConfig.maxPageSize).toBe(100);
    expect(Object.isFrozen(defaultConfig)).toBe(true);
  });

  it('defaults the payout fee to zero and lets overrides set it without changing the defaults', () => {
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      payoutFee: 0,
    });
    const config = withOverrides({ payoutFee: 250 });
    expect(config).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      payoutFee: 250,
    });
    expect(defaultConfig).toMatchObject({ payoutFee: 0 });
  });

  it('rejects a negative, fractional or NaN payout fee with a RangeError naming payoutFee', () => {
    for (const payoutFee of [-1, 1.5, Number.NaN]) {
      expect(() => withOverrides({ payoutFee })).toThrow(RangeError);
      expect(() => withOverrides({ payoutFee })).toThrow(/payoutFee/);
    }
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      payoutFee: 0,
    });
  });

  it('accepts a payout fee of zero', () => {
    expect(withOverrides({ payoutFee: 0 })).toMatchObject({ payoutFee: 0 });
  });

  it('rejects an undefined payout fee instead of reading it as zero', () => {
    const overrides = { payoutFee: undefined } as unknown as Partial<Config>;
    expect(() => withOverrides(overrides)).toThrow(RangeError);
    expect(() => withOverrides(overrides)).toThrow(/payoutFee/);
  });

  it('sets a custom fee while the shared defaults stay at zero', () => {
    const config = withOverrides({ payoutFee: 250 });
    expect(config.payoutFee).toBe(250);
    expect(config.defaultPageSize).toBe(defaultConfig.defaultPageSize);
    expect(config.maxPageSize).toBe(defaultConfig.maxPageSize);
    expect(config.minPayoutAmount).toBe(defaultConfig.minPayoutAmount);
    expect(defaultConfig.payoutFee).toBe(0);
  });

  it('allows a zero or maximal safe fee override', () => {
    expect(withOverrides({ payoutFee: 0 }).payoutFee).toBe(0);
    expect(withOverrides({ payoutFee: Number.MAX_SAFE_INTEGER }).payoutFee).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([-1, -500, 1.5, NaN, Infinity, 2 ** 53])(
    'throws a RangeError for unusable fee values (%s)',
    (payoutFee) => {
      expect(() => withOverrides({ payoutFee })).toThrow(RangeError);
      expect(() => withOverrides({ payoutFee })).toThrow(/payoutFee/);
      expect(defaultConfig).toEqual({
        defaultPageSize: 20,
        maxPageSize: 100,
        minPayoutAmount: 100,
        payoutFee: 0,
      });
      expect(Object.isFrozen(defaultConfig)).toBe(true);
    },
  );

  it('throws when the fee key is present but undefined', () => {
    const overrides = { payoutFee: undefined } as unknown as Partial<Config>;
    expect(() => withOverrides(overrides)).toThrow(RangeError);
    expect(() => withOverrides(overrides)).toThrow(/payoutFee/);
  });
});
