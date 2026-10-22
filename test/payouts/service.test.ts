import { beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides, type Config } from '../../src/config.js';
import { createLedger, type Ledger } from '../../src/ledger/ledger.js';
import { createPayoutService, type PayoutService } from '../../src/payouts/service.js';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';

const requestedAt = new Date('2025-07-01T08:00:00Z');
const clock = () => requestedAt;

describe('payout service', () => {
  let wallets: WalletStore;
  let ledger: Ledger;
  let payouts: PayoutService;

  const balance = (walletId = 'w1'): number => {
    const wallet = wallets.get(walletId);
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
        fee: 0,
        status: 'pending',
        requestedAt,
        updatedAt: requestedAt,
      },
    });
    expect(balance()).toBe(6_000);
  });

  it('refuses to construct with a hand-built config whose payoutFee is bad', () => {
    expect(() =>
      createPayoutService({ wallets, ledger, clock, config: { ...defaultConfig, payoutFee: -1 } }),
    ).toThrow(/payoutFee/);
    expect(() =>
      createPayoutService({
        wallets,
        ledger,
        clock,
        config: { ...defaultConfig, payoutFee: -500 },
      }),
    ).toThrow(/payoutFee/);
    const keyless = {
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
    } as unknown as Config;
    expect(() => createPayoutService({ wallets, ledger, clock, config: keyless })).toThrow(
      /payoutFee/,
    );
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
      error: { code: 'INSUFFICIENT_FUNDS', available: 10_000, requested: 10_001 },
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

  it('posts a single ledger line when no fee is configured', () => {
    const id = requested(4_000);
    payouts.approve(id);
    payouts.startProcessing(id);
    payouts.markPaid(id);
    expect(ledger.entries()).toHaveLength(1);
    expect(ledger.entries()).toMatchObject([
      { direction: 'debit', amount: 4_000, description: `payout ${id}` },
    ]);
  });

  describe('with a payout fee of 250', () => {
    beforeEach(() => {
      payouts = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ payoutFee: 250 }),
      });
    });

    const funded = (walletId: string, amount: number): void => {
      wallets.open(walletId);
      wallets.deposit(walletId, amount);
    };

    it('withdraws 4,250 for a 4,000 request and stamps fee 250', () => {
      expect(payouts.request('w1', 4_000)).toEqual({
        ok: true,
        value: {
          id: 'po_1',
          walletId: 'w1',
          amount: 4_000,
          fee: 250,
          status: 'pending',
          requestedAt,
          updatedAt: requestedAt,
        },
      });
      expect(balance()).toBe(5_750);
    });

    it('keeps fee 250 on get, listOpen and every later status result', () => {
      const id = requested(1_000);
      expect(payouts.get(id)?.fee).toBe(250);
      expect(payouts.listOpen()[0]?.fee).toBe(250);
      const steps = [
        payouts.approve(id),
        payouts.startProcessing(id),
        payouts.markFailed(id),
        payouts.retry(id),
        payouts.approve(id),
        payouts.startProcessing(id),
        payouts.markPaid(id),
      ];
      for (const step of steps) {
        expect(step).toMatchObject({ ok: true, value: { fee: 250 } });
      }
      const other = requested(1_000);
      expect(payouts.cancel(other)).toMatchObject({
        ok: true,
        value: { fee: 250, status: 'cancelled' },
      });
    });

    it('drains a wallet holding exactly 4,250 to zero', () => {
      funded('w2', 4_250);
      expect(payouts.request('w2', 4_000).ok).toBe(true);
      expect(balance('w2')).toBe(0);
    });

    it('is 1 short at 4,249 and reports 4,250 requested', () => {
      funded('w2', 4_249);
      expect(payouts.request('w2', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', available: 4_249, requested: 4_250 },
      });
      expect(balance('w2')).toBe(4_249);
      expect(payouts.listOpen()).toEqual([]);
    });

    it('refuses when only the fee is uncovered', () => {
      funded('w2', 4_000);
      expect(payouts.request('w2', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', available: 4_000, requested: 4_250 },
      });
      expect(balance('w2')).toBe(4_000);
      expect(payouts.listOpen()).toEqual([]);
    });

    it('appends the fee as its own debit right after the payout debit', () => {
      const id = requested(2_500);
      payouts.approve(id);
      payouts.startProcessing(id);
      expect(payouts.markPaid(id)).toMatchObject({ ok: true, value: { status: 'paid' } });
      expect(ledger.entries('w1')).toMatchObject([
        { direction: 'debit', amount: 2_500, description: `payout ${id}` },
        { direction: 'debit', amount: 250, description: `payout fee ${id}` },
      ]);
      expect(ledger.balance('w1')).toBe(-2_750);
      expect(balance()).toBe(7_250);
    });

    it('writes nothing to the ledger before paid', () => {
      const id = requested(1_000);
      expect(ledger.entries()).toHaveLength(0);
      const beforePaid = [
        () => payouts.approve(id),
        () => payouts.startProcessing(id),
        () => payouts.markFailed(id),
        () => payouts.retry(id),
        () => payouts.approve(id),
        () => payouts.startProcessing(id),
      ];
      for (const step of beforePaid) {
        expect(step().ok).toBe(true);
        expect(ledger.entries()).toHaveLength(0);
      }
      expect(payouts.markPaid(id).ok).toBe(true);
      expect(ledger.entries()).toHaveLength(2);
    });

    it('gives 3,250 back per cancel from pending, approved and failed', () => {
      const a = requested(3_000);
      const b = requested(3_000);
      const c = requested(3_000);
      payouts.approve(b);
      payouts.approve(c);
      payouts.startProcessing(c);
      payouts.markFailed(c);
      expect(balance()).toBe(250);
      expect(payouts.cancel(a)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(3_500);
      expect(payouts.cancel(b)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(6_750);
      expect(payouts.cancel(c)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(10_000);
      expect(ledger.entries()).toHaveLength(0);
    });

    it('does not deposit again on a repeat cancel', () => {
      const id = requested(3_000);
      payouts.approve(id);
      payouts.cancel(id);
      expect(balance()).toBe(10_000);
      expect(payouts.cancel(id)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION', from: 'cancelled' },
      });
      expect(balance()).toBe(10_000);
    });

    it('still holds 1,250 after fail then retry', () => {
      const id = requested(1_000);
      payouts.approve(id);
      payouts.startProcessing(id);
      payouts.markFailed(id);
      expect(payouts.retry(id)).toMatchObject({ ok: true, value: { status: 'pending' } });
      expect(balance()).toBe(8_750);
    });

    it('rejects a MAX_SAFE_INTEGER request whose charge overflows', () => {
      expect(payouts.request('w1', Number.MAX_SAFE_INTEGER)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: Number.MAX_SAFE_INTEGER },
      });
      expect(payouts.listOpen()).toEqual([]);
      expect(balance()).toBe(10_000);
    });

    it('lets a charge equal to MAX_SAFE_INTEGER reach the funds check', () => {
      expect(payouts.request('w1', Number.MAX_SAFE_INTEGER - 250)).toMatchObject({
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          available: 10_000,
          requested: Number.MAX_SAFE_INTEGER,
        },
      });
    });

    it('reports the overflow before looking up an unknown wallet', () => {
      expect(payouts.request('missing', Number.MAX_SAFE_INTEGER)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: Number.MAX_SAFE_INTEGER },
      });
    });

    it('compares only the 99 against the 100 minimum', () => {
      expect(payouts.request('w1', 99)).toMatchObject({
        ok: false,
        error: { code: 'BELOW_MINIMUM_PAYOUT', minimum: 100, requested: 99 },
      });
      expect(balance()).toBe(10_000);
    });

    it('holds 350 for a request of exactly the minimum', () => {
      expect(payouts.request('w1', 100).ok).toBe(true);
      expect(balance()).toBe(9_650);
    });
  });
});
