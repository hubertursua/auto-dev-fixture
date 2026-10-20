import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/config.js';

describe('config', () => {
  it('has defaults for every setting', () => {
    expect(defaultConfig).toEqual({ defaultPageSize: 20, maxPageSize: 100, minPayoutAmount: 100 });
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
