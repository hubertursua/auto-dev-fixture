import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides } from '../src/index.js';

describe('maximum payout setting (acceptance)', () => {
  it('library defaults are page size 20, max page size 100, minimum payout 100 and maximum payout 1,000,000', () => {
    expect(defaultConfig).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      maxPayoutAmount: 1_000_000,
    });
  });

  it('overriding only the default page size keeps the 1,000,000 maximum payout and leaves the shared defaults frozen and unchanged', () => {
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
});
