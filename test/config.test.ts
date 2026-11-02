import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config.js';

describe('config', () => {
  it('has defaults for every setting', () => {
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      maxPayoutAmount: 1_000_000,
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

  it('ships a maximum payout amount of one million minor units among the defaults', () => {
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      maxPayoutAmount: 1_000_000,
    });
  });

  it('overrides the maximum payout amount without changing the frozen defaults', () => {
    const config = withOverrides({ maxPayoutAmount: 2_000 });
    expect(config.maxPayoutAmount).toBe(2_000);
    expect(defaultConfig.maxPayoutAmount).toBe(1_000_000);
    expect(Object.isFrozen(defaultConfig)).toBe(true);
  });

  it('overrides the payout cap without disturbing the shared defaults', () => {
    expect(withOverrides({ maxPayoutAmount: 2_000 }).maxPayoutAmount).toBe(2_000);
    expect(defaultConfig.maxPayoutAmount).toBe(1_000_000);
    expect(Object.isFrozen(defaultConfig)).toBe(true);
  });

  it('keeps an unusable cap value unchanged instead of throwing', () => {
    const unusable = [Number(undefined), Number.POSITIVE_INFINITY, undefined as unknown as number];
    for (const cap of unusable) {
      expect(() => withOverrides({ maxPayoutAmount: cap })).not.toThrow();
      expect(withOverrides({ maxPayoutAmount: cap }).maxPayoutAmount).toBe(cap);
    }
    expect(defaultConfig.maxPayoutAmount).toBe(1_000_000);
  });
});
