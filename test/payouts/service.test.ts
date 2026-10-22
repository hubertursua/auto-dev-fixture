import { beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides, type Config } from '../../src/config.js';
import type { Result } from '../../src/errors.js';
import { createLedger, type Ledger } from '../../src/ledger/ledger.js';
import { createPayoutService, type PayoutService } from '../../src/payouts/service.js';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';

const requestedAt = new Date('2025-07-01T08:00:00Z');
const clock = () => requestedAt;

const failure = <E>(result: Result<unknown, E>): E => {
  if (result.ok) throw new Error('expected a failed result');
  return result.error;
};

describe('payout service', () => {
  let wallets: WalletStore;
  let ledger: Ledger;
  let payouts: PayoutService;

  const balance = (): number => {
    const wallet = wallets.get('w1');
    if (!wallet.ok) throw new Error(wallet.error.message);
    return wallet.value.balance;
  };

  const requested = (amount: number): string => {
    const result = payouts.request('w1', amount);
    if (!result.ok) throw new Error(result.error.message);
    return result.value.id;
  };

  beforeEach(() => {
    wallets = createWalletStore();
    wallets.open('w1');
    wallets.deposit('w1', 10_000);
    ledger = createLedger({ clock });
    payouts = createPayoutService({ wallets, ledger, clock });
  });

  it('reserves the amount from the wallet when requested', () => {
    expect(payouts.request('w1', 4_000)).toEqual({
      ok: true,
      value: {
        id: 'po_1',
        walletId: 'w1',
        amount: 4_000,
        status: 'pending',
        requestedAt,
        updatedAt: requestedAt,
      },
    });
    expect(balance()).toBe(6_000);
  });

  it('accepts the minimum amount and rejects one unit less', () => {
    expect(payouts.request('w1', 100).ok).toBe(true);
    expect(payouts.request('w1', 99)).toMatchObject({
      ok: false,
      error: { code: 'BELOW_MINIMUM_PAYOUT', minimum: 100, requested: 99 },
    });
  });

  it('uses the configured minimum', () => {
    const strict = createPayoutService({
      wallets,
      ledger,
      clock,
      config: withOverrides({ minPayoutAmount: 1_000 }),
    });
    expect(strict.request('w1', 999)).toMatchObject({
      ok: false,
      error: { code: 'BELOW_MINIMUM_PAYOUT', minimum: 1_000 },
    });
    expect(strict.request('w1', 1_000).ok).toBe(true);
  });

  it('passes wallet errors through without creating a payout', () => {
    expect(payouts.request('w1', 10_001)).toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS' },
    });
    expect(payouts.request('missing', 500)).toMatchObject({
      ok: false,
      error: { code: 'WALLET_NOT_FOUND' },
    });
    expect(payouts.listOpen()).toEqual([]);
    expect(balance()).toBe(10_000);
  });

  it('records a debit in the ledger once paid', () => {
    const id = requested(2_500);
    payouts.approve(id);
    payouts.startProcessing(id);
    expect(ledger.entries()).toHaveLength(0);
    expect(payouts.markPaid(id)).toMatchObject({ ok: true, value: { status: 'paid' } });
    expect(ledger.entries('w1')).toMatchObject([
      { direction: 'debit', amount: 2_500, description: `payout ${id}` },
    ]);
    expect(balance()).toBe(7_500);
  });

  it('returns the reserved funds when cancelled', () => {
    const id = requested(3_000);
    payouts.approve(id);
    expect(payouts.cancel(id)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    expect(balance()).toBe(10_000);
    expect(ledger.entries()).toHaveLength(0);
  });

  it('keeps funds reserved through a failure and retry', () => {
    const id = requested(1_000);
    payouts.approve(id);
    payouts.startProcessing(id);
    expect(payouts.markFailed(id)).toMatchObject({ ok: true, value: { status: 'failed' } });
    expect(payouts.retry(id)).toMatchObject({ ok: true, value: { status: 'pending' } });
    expect(balance()).toBe(9_000);
  });

  it('rejects a disallowed move and leaves the payout as it was', () => {
    const id = requested(1_000);
    expect(payouts.markPaid(id)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TRANSITION', from: 'pending', to: 'paid' },
    });
    expect(payouts.get(id)?.status).toBe('pending');
    expect(ledger.entries()).toHaveLength(0);
  });

  it('reports an unknown payout', () => {
    expect(payouts.approve('po_404')).toMatchObject({
      ok: false,
      error: { code: 'PAYOUT_NOT_FOUND', payoutId: 'po_404' },
    });
  });

  it('lists only payouts that are still open', () => {
    const paid = requested(500);
    const cancelled = requested(500);
    const open = requested(500);
    payouts.approve(paid);
    payouts.startProcessing(paid);
    payouts.markPaid(paid);
    payouts.cancel(cancelled);
    expect(payouts.listOpen().map((p) => p.id)).toEqual([open]);
  });

  describe('upper payout limit', () => {
    const topUp = (target: number): void => {
      const deposited = wallets.deposit('w1', target - balance());
      if (!deposited.ok) throw new Error(deposited.error.message);
    };

    it('refuses one unit over the default cap and reports cap and amount', () => {
      topUp(2_000_000);
      const error = failure(payouts.request('w1', 1_000_001));
      expect(error).toMatchObject({
        code: 'ABOVE_MAXIMUM_PAYOUT',
        maximum: 1_000_000,
        requested: 1_000_001,
      });
      expect(error.message.trim()).not.toBe('');
    });

    it('accepts exactly the default cap and debits it', () => {
      topUp(2_000_000);
      expect(payouts.request('w1', 1_000_000)).toMatchObject({
        ok: true,
        value: { amount: 1_000_000, status: 'pending' },
      });
      expect(balance()).toBe(1_000_000);
      expect(failure(payouts.request('w1', 1_000_001)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
    });

    it('leaves balance and open payouts untouched after an over-cap refusal', () => {
      topUp(2_000_000);
      failure(payouts.request('w1', 1_000_001));
      expect(balance()).toBe(2_000_000);
      expect(payouts.listOpen()).toEqual([]);
      expect(ledger.entries()).toEqual([]);
    });

    it('does not consume a payout id when refusing', () => {
      topUp(2_000_000);
      failure(payouts.request('w1', 1_000_001));
      expect(payouts.request('w1', 500)).toMatchObject({ ok: true, value: { id: 'po_1' } });
      expect(balance()).toBe(1_999_500);
    });

    it('answers with the cap error for an unknown wallet', () => {
      expect(failure(payouts.request('missing', 1_000_001)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
    });

    it('answers with the cap error for an under-funded wallet', () => {
      expect(failure(payouts.request('w1', 1_000_001)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
      expect(balance()).toBe(10_000);
    });

    it('honours a cap of 5,000 supplied via withOverrides', () => {
      const capped = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: 5_000 }),
      });
      expect(failure(capped.request('w1', 5_001))).toMatchObject({
        code: 'ABOVE_MAXIMUM_PAYOUT',
        maximum: 5_000,
        requested: 5_001,
      });
      expect(capped.request('w1', 5_000)).toMatchObject({
        ok: true,
        value: { amount: 5_000, status: 'pending' },
      });
    });

    it('honours a cap of 2,000,000 raised above the default via withOverrides', () => {
      const raised = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: 2_000_000 }),
      });
      topUp(4_000_000);
      expect(raised.request('w1', 1_500_000)).toMatchObject({
        ok: true,
        value: { amount: 1_500_000, status: 'pending' },
      });
      expect(balance()).toBe(2_500_000);
      expect(failure(raised.request('w1', 2_000_001))).toMatchObject({
        code: 'ABOVE_MAXIMUM_PAYOUT',
        maximum: 2_000_000,
        requested: 2_000_001,
      });
    });

    it('a service without config still allows 1,000,000 after a custom cap is built', () => {
      createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: 5_000 }),
      });
      expect(defaultConfig.maxPayoutAmount).toBe(1_000_000);
      topUp(1_000_000);
      expect(payouts.request('w1', 1_000_000)).toMatchObject({
        ok: true,
        value: { amount: 1_000_000, status: 'pending' },
      });
    });

    it('in-range requests behave as before under the default cap', () => {
      expect(failure(payouts.request('w1', 99)).code).toBe('BELOW_MINIMUM_PAYOUT');
      expect(failure(payouts.request('w1', 10_001)).code).toBe('INSUFFICIENT_FUNDS');
      expect(payouts.request('w1', 4_000)).toMatchObject({
        ok: true,
        value: { amount: 4_000, status: 'pending' },
      });
    });

    it('malformed oversized amounts report INVALID_AMOUNT and move nothing', () => {
      for (const amount of [Infinity, NaN, 1_000_000.5, 2 ** 53]) {
        expect(failure(payouts.request('w1', amount)).code).toBe('INVALID_AMOUNT');
      }
      expect(balance()).toBe(10_000);
      expect(payouts.listOpen()).toEqual([]);
    });

    it('minimum wins when it is configured above the cap', () => {
      const inverted = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ minPayoutAmount: 1_000, maxPayoutAmount: 500 }),
      });
      expect(failure(inverted.request('w1', 600))).toMatchObject({
        code: 'BELOW_MINIMUM_PAYOUT',
        minimum: 1_000,
        requested: 600,
      });
    });

    it('refuses a 5,000,000 request from a 5,000,000 wallet without throwing or reserving', () => {
      topUp(5_000_000);
      expect(() => payouts.request('w1', 5_000_000)).not.toThrow();
      expect(payouts.request('w1', 5_000_000)).toMatchObject({
        ok: false,
        error: { code: 'ABOVE_MAXIMUM_PAYOUT' },
      });
      expect(balance()).toBe(5_000_000);
      expect(payouts.listOpen()).toEqual([]);
    });

    it('fails closed when the configured cap is NaN', () => {
      const broken = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: Number.NaN }),
      });
      expect(failure(broken.request('w1', 4_000)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
      expect(balance()).toBe(10_000);
      expect(broken.listOpen()).toEqual([]);
    });

    it('fails closed when the configured cap is undefined', () => {
      const missingCap = {
        ...defaultConfig,
        maxPayoutAmount: undefined,
      } as unknown as Config;
      const broken = createPayoutService({ wallets, ledger, clock, config: missingCap });
      expect(failure(broken.request('w1', 4_000)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
      expect(balance()).toBe(10_000);
      expect(broken.listOpen()).toEqual([]);
    });

    it('cap error is identical for known and unknown wallets and holds only four keys', () => {
      const known = failure(payouts.request('w1', 1_000_001));
      const unknown = failure(payouts.request('missing', 1_000_001));
      expect(known).toEqual(unknown);
      expect(Object.keys(known).sort()).toEqual(['code', 'maximum', 'message', 'requested']);
      expect(known.message).not.toContain('w1');
      expect(known.message).not.toContain('missing');
    });
  });
});
