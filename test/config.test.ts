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

  it('keeps the 1,000,000 cap when only the page size is overridden', () => {
    const config = withOverrides({ defaultPageSize: 5 });
    expect(config.defaultPageSize).toBe(5);
    expect(config.maxPayoutAmount).toBe(1_000_000);
    expect(Object.isFrozen(defaultConfig)).toBe(true);
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      maxPayoutAmount: 1_000_000,
    });
  });

  it('overriding the cap yields a new config and leaves defaultConfig alone', () => {
    const config = withOverrides({ maxPayoutAmount: 5_000 });
    expect(config.maxPayoutAmount).toBe(5_000);
    expect(config).not.toBe(defaultConfig);
    expect(defaultConfig.maxPayoutAmount).toBe(1_000_000);
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
});
