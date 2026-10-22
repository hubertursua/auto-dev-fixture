import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config.js';

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

  it('stores an overridden payoutFee and keeps defaultConfig at 0', () => {
    const config = withOverrides({ payoutFee: 250 });
    expect(config.payoutFee).toBe(250);
    expect(defaultConfig.payoutFee).toBe(0);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(defaultConfig)).toBe(true);
  });

  it('takes 0 as a valid payoutFee override', () => {
    expect(() => withOverrides({ payoutFee: 0 })).not.toThrow();
    expect(withOverrides({ payoutFee: 0 }).payoutFee).toBe(0);
  });

  it.each([-1, 1.5, NaN, Infinity, 2 ** 53, undefined, -500])(
    'throws on payoutFee %s',
    (bad: number | undefined) => {
      expect(() => withOverrides({ payoutFee: bad as number })).toThrow(/payoutFee/);
    },
  );
});
