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
});
