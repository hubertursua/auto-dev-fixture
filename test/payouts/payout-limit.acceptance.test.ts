import { describe, expect, it } from 'vitest';
import {
  createLedger,
  createPayoutService,
  createWalletStore,
  defaultConfig,
  withOverrides,
  type Config,
  type Payout,
  type RequestPayoutError,
  type Result,
} from '../../src/index.js';

const requestedAt = new Date('2025-07-01T08:00:00Z');
const clock = () => requestedAt;

/** A wallet store with wallet w1 holding `holding`, and a payout service over it. */
const setup = (holding: number, config?: Config) => {
  const wallets = createWalletStore();
  wallets.open('w1');
  wallets.deposit('w1', holding);
  const ledger = createLedger({ clock });
  const payouts = createPayoutService(
    config === undefined ? { wallets, ledger, clock } : { wallets, ledger, clock, config },
  );
  const balance = (): number => {
    const wallet = wallets.get('w1');
    if (!wallet.ok) throw new Error(wallet.error.message);
    return wallet.value.balance;
  };
  return { wallets, ledger, payouts, balance };
};

const failure = (result: Result<Payout, RequestPayoutError>): RequestPayoutError => {
  if (result.ok) throw new Error('expected the payout request to be refused, but it succeeded');
  return result.error;
};

describe('maximum payout amount (acceptance)', () => {
  it('a payout service built with an overridden maximum of 5,000 refuses 5,001 and accepts 5,000', () => {
    const { payouts } = setup(10_000, withOverrides({ maxPayoutAmount: 5_000 }));
    expect(payouts.request('w1', 5_001)).toMatchObject({
      ok: false,
      error: { code: 'ABOVE_MAXIMUM_PAYOUT', maximum: 5_000, requested: 5_001 },
    });
    expect(payouts.request('w1', 5_000)).toMatchObject({
      ok: true,
      value: { walletId: 'w1', amount: 5_000, status: 'pending' },
    });
  });

  it('overriding the maximum leaves the shared defaults at 1,000,000 and a service without config still accepts 1,000,000', () => {
    const custom = withOverrides({ maxPayoutAmount: 5_000 });
    setup(10_000, custom);
    expect(custom.maxPayoutAmount).toBe(5_000);
    expect(defaultConfig.maxPayoutAmount).toBe(1_000_000);

    const { payouts, balance } = setup(2_000_000);
    expect(payouts.request('w1', 1_000_000)).toMatchObject({
      ok: true,
      value: { amount: 1_000_000, status: 'pending' },
    });
    expect(balance()).toBe(1_000_000);
  });

  it('requesting one unit above the default maximum is refused with ABOVE_MAXIMUM_PAYOUT reporting the maximum, the requested amount and a message', () => {
    const { payouts } = setup(2_000_000);
    const result = payouts.request('w1', 1_000_001);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ABOVE_MAXIMUM_PAYOUT', maximum: 1_000_000, requested: 1_000_001 },
    });
    const error = failure(result);
    expect(typeof error.message).toBe('string');
    expect(error.message.trim()).not.toBe('');
  });

  it('an amount exactly equal to the default maximum is allowed and one unit over is refused', () => {
    const { payouts, balance } = setup(2_000_000);
    expect(failure(payouts.request('w1', 1_000_001)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
    expect(payouts.request('w1', 1_000_000)).toMatchObject({
      ok: true,
      value: { walletId: 'w1', amount: 1_000_000, status: 'pending' },
    });
    expect(balance()).toBe(1_000_000);
  });

  it('a refused above-maximum request reserves no funds and creates no payout', () => {
    const { payouts, balance } = setup(2_000_000);
    expect(payouts.request('w1', 1_000_001).ok).toBe(false);
    expect(balance()).toBe(2_000_000);
    expect(payouts.listOpen()).toEqual([]);
  });

  it('a valid request after an above-maximum refusal gets the first payout id and debits normally', () => {
    const { payouts, balance } = setup(2_000_000);
    expect(payouts.request('w1', 1_000_001).ok).toBe(false);
    expect(payouts.request('w1', 500)).toMatchObject({
      ok: true,
      value: { id: 'po_1', walletId: 'w1', amount: 500, status: 'pending' },
    });
    expect(balance()).toBe(1_999_500);
  });

  it('an above-maximum request for a wallet that does not exist is refused with ABOVE_MAXIMUM_PAYOUT, not WALLET_NOT_FOUND', () => {
    const { payouts } = setup(10_000);
    expect(failure(payouts.request('missing', 1_000_001)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
  });

  it('an above-maximum request for an under-funded wallet is refused with ABOVE_MAXIMUM_PAYOUT, not INSUFFICIENT_FUNDS, and moves nothing', () => {
    const { payouts, balance } = setup(10_000);
    expect(failure(payouts.request('w1', 1_000_001)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
    expect(balance()).toBe(10_000);
  });

  it('in-range requests keep their existing outcomes: below minimum, insufficient funds and success', () => {
    const { payouts, balance } = setup(10_000);
    expect(failure(payouts.request('w1', 99)).code).toBe('BELOW_MINIMUM_PAYOUT');
    expect(failure(payouts.request('w1', 10_001)).code).toBe('INSUFFICIENT_FUNDS');
    expect(payouts.request('w1', 4_000)).toMatchObject({
      ok: true,
      value: { walletId: 'w1', amount: 4_000, status: 'pending' },
    });
    expect(balance()).toBe(6_000);
  });

  it('amounts above the maximum that are not valid amounts still report INVALID_AMOUNT', () => {
    const { payouts } = setup(10_000);
    expect(failure(payouts.request('w1', 1_000_000.5)).code).toBe('INVALID_AMOUNT');
    expect(failure(payouts.request('w1', Infinity)).code).toBe('INVALID_AMOUNT');
  });

  it('when the minimum is configured above the maximum, an amount between them reports BELOW_MINIMUM_PAYOUT', () => {
    const { payouts } = setup(
      10_000,
      withOverrides({ minPayoutAmount: 1_000, maxPayoutAmount: 500 }),
    );
    expect(failure(payouts.request('w1', 600)).code).toBe('BELOW_MINIMUM_PAYOUT');
  });

  it('a 5,000,000 request against a wallet holding 5,000,000 is returned as an ABOVE_MAXIMUM_PAYOUT error value without throwing, reserving or creating a payout', () => {
    const { payouts, balance } = setup(5_000_000);
    let result: Result<Payout, RequestPayoutError> | undefined;
    expect(() => {
      result = payouts.request('w1', 5_000_000);
    }).not.toThrow();
    expect(result).toMatchObject({ ok: false, error: { code: 'ABOVE_MAXIMUM_PAYOUT' } });
    expect(balance()).toBe(5_000_000);
    expect(payouts.listOpen()).toEqual([]);
  });

  it('malformed amounts (Infinity, NaN, fractional, 2^53) are refused as INVALID_AMOUNT and move nothing', () => {
    const { payouts, balance } = setup(10_000);
    for (const amount of [Infinity, NaN, 1_000_000.5, 2 ** 53]) {
      expect(failure(payouts.request('w1', amount)).code).toBe('INVALID_AMOUNT');
    }
    expect(balance()).toBe(10_000);
    expect(payouts.listOpen()).toEqual([]);
  });

  it('the above-maximum error is identical for an existing and a missing wallet and carries only code, message, maximum and requested', () => {
    const { payouts } = setup(10_000);
    const known = failure(payouts.request('w1', 1_000_001));
    const unknown = failure(payouts.request('missing', 1_000_001));
    expect(known.code).toBe('ABOVE_MAXIMUM_PAYOUT');
    expect(known).toEqual(unknown);
    expect(Object.keys(known).sort()).toEqual(['code', 'maximum', 'message', 'requested']);
    expect(known).toMatchObject({ maximum: 1_000_000, requested: 1_000_001 });
    expect(known.message).not.toContain('w1');
    expect(unknown.message).not.toContain('missing');
  });
});
