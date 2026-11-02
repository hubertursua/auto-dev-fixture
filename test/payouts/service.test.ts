import { beforeEach, describe, expect, it } from 'vitest';
import { withOverrides } from '../../src/config.js';
import { createLedger, type Ledger } from '../../src/ledger/ledger.js';
import { createPayoutService, type PayoutService } from '../../src/payouts/service.js';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';

const requestedAt = new Date('2025-07-01T08:00:00Z');
const clock = () => requestedAt;

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
      error: {
        code: 'BELOW_MINIMUM_PAYOUT',
        message: 'payouts must be at least 100, got 99',
        minimum: 100,
        requested: 99,
      },
    });
  });

  it('checks the payout floor before the wallet balance', () => {
    wallets.open('low');
    wallets.deposit('low', 30);
    expect(payouts.request('low', 60)).toMatchObject({
      ok: false,
      error: {
        code: 'BELOW_MINIMUM_PAYOUT',
        message: 'payouts must be at least 100, got 60',
        minimum: 100,
        requested: 60,
      },
    });
    expect(payouts.listOpen()).toEqual([]);
    expect(wallets.get('low')).toMatchObject({ value: { balance: 30 } });
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

  it('hands back the full wallet error for a payout above the balance', () => {
    expect(payouts.request('w1', 12_345)).toStrictEqual({
      ok: false,
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'wallet w1 cannot cover 12345: only 10000 available',
        available: 10_000,
        requested: 12_345,
      },
    });
    expect(payouts.listOpen()).toEqual([]);
    expect(balance()).toBe(10_000);
  });

  it('reports the balance left after earlier reservations', () => {
    requested(2_500);
    expect(payouts.request('w1', 7_501)).toStrictEqual({
      ok: false,
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'wallet w1 cannot cover 7501: only 7500 available',
        available: 7_500,
        requested: 7_501,
      },
    });
    const open = payouts.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ walletId: 'w1', amount: 2_500, status: 'pending' });
    expect(balance()).toBe(7_500);
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

  it('returns the cannot-cover insufficient-funds error for a payout above the balance', () => {
    expect(payouts.request('w1', 10_001)).toStrictEqual({
      ok: false,
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'wallet w1 cannot cover 10001: only 10000 available',
        available: 10_000,
        requested: 10_001,
      },
    });
    expect(payouts.listOpen()).toEqual([]);
    expect(balance()).toBe(10_000);
  });

  it('reports what is left after a pending payout in the cannot-cover message', () => {
    requested(4_000);
    const result = payouts.request('w1', 6_001);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      message: 'wallet w1 cannot cover 6001: only 6000 available',
      available: 6_000,
      requested: 6_001,
    });
  });

  it('still rejects a payout below the minimum with its existing message', () => {
    expect(payouts.request('w1', 99)).toMatchObject({
      ok: false,
      error: { code: 'BELOW_MINIMUM_PAYOUT', message: 'payouts must be at least 100, got 99' },
    });
  });

  it('reports a payout both below the minimum and over the balance as below the minimum', () => {
    wallets.open('low');
    wallets.deposit('low', 50);
    expect(payouts.request('low', 99)).toMatchObject({
      ok: false,
      error: { code: 'BELOW_MINIMUM_PAYOUT' },
    });
  });
});
