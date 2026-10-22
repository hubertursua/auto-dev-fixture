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

describe('package barrel', () => {
  it('exposes the cap error type through the package barrel', () => {
    const wallets = createWalletStore();
    wallets.open('w1');
    wallets.deposit('w1', 2_000_000);
    const payouts = createPayoutService({ wallets, ledger: createLedger() });

    const result = payouts.request('w1', 1_000_001);
    if (result.ok) throw new Error('expected the request to be refused');
    if (result.error.code !== 'ABOVE_MAXIMUM_PAYOUT') {
      throw new Error(`expected the cap error, got ${result.error.code}`);
    }
    const capError: AboveMaximumPayoutError = result.error;

    expect(capError.maximum).toBe(1_000_000);
    expect(capError.requested).toBe(1_000_001);
    expect(limitOf(result.error)).toBe(1_000_000);
  });
});
