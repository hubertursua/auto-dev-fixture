import { describe, expect, it } from 'vitest';
import {
  createLedger,
  createPayoutService,
  createWalletStore,
  type AboveMaximumPayoutError,
  type RequestPayoutError,
} from '../src/index.js';

const limitOf = (error: RequestPayoutError): number | undefined => {
  switch (error.code) {
    case 'BELOW_MINIMUM_PAYOUT':
      return error.minimum;
    case 'ABOVE_MAXIMUM_PAYOUT':
      return error.maximum;
    default:
      return undefined;
  }
};

describe('public package entry (acceptance)', () => {
  it('a caller importing only the package entry can narrow a refused payout request on ABOVE_MAXIMUM_PAYOUT and read its maximum and requested amounts', () => {
    const wallets = createWalletStore();
    wallets.open('w1');
    wallets.deposit('w1', 2_000_000);
    const payouts = createPayoutService({ wallets, ledger: createLedger() });

    const result = payouts.request('w1', 1_000_001);
    if (result.ok) {
      throw new Error('expected the above-maximum payout request to be refused, but it succeeded');
    }
    if (result.error.code !== 'ABOVE_MAXIMUM_PAYOUT') {
      throw new Error(`expected ABOVE_MAXIMUM_PAYOUT, got ${result.error.code}`);
    }
    const capError: AboveMaximumPayoutError = result.error;
    const maximum: number = capError.maximum;
    const requested: number = capError.requested;
    const narrowedMaximum: number = result.error.maximum;
    const narrowedRequested: number = result.error.requested;
    expect(typeof maximum).toBe('number');
    expect(typeof requested).toBe('number');
    expect(maximum).toBe(1_000_000);
    expect(requested).toBe(1_000_001);
    expect(narrowedMaximum).toBe(1_000_000);
    expect(narrowedRequested).toBe(1_000_001);
    expect(limitOf(result.error)).toBe(1_000_000);
  });
});
