import { beforeEach, describe, expect, it } from 'vitest';
import { withOverrides } from '../../src/config.js';
import { createLedger, type Ledger } from '../../src/ledger/ledger.js';
import { createPayoutService, type PayoutService } from '../../src/payouts/service.js';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';
import { vi } from 'vitest';
import type { Config } from '../../src/config.js';

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
        fee: 0,
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

  it('with no fee configured, a paid payout reserves only its amount and posts a single debit', () => {
    expect(payouts.request('w1', 2_500)).toMatchObject({
      ok: true,
      value: { id: 'po_1', amount: 2_500, fee: 0, status: 'pending' },
    });
    expect(balance()).toBe(7_500);
    payouts.approve('po_1');
    payouts.startProcessing('po_1');
    expect(payouts.markPaid('po_1')).toMatchObject({
      ok: true,
      value: { status: 'paid', fee: 0 },
    });
    expect(ledger.entries('w1')).toHaveLength(1);
    expect(ledger.entries('w1')).toMatchObject([
      { direction: 'debit', amount: 2_500, description: 'payout po_1' },
    ]);
    expect(balance()).toBe(7_500);
  });

  it('with no fee configured, a shortfall reports the bare amount as requested', () => {
    expect(payouts.request('w1', 10_001)).toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS', available: 10_000, requested: 10_001 },
    });
    expect(balance()).toBe(10_000);
  });

  it('with no fee configured, cancelling restores the exact balance with no zero-amount movement', () => {
    const withdraw = vi.spyOn(wallets, 'withdraw');
    const deposit = vi.spyOn(wallets, 'deposit');
    const id = requested(3_000);
    expect(payouts.cancel(id)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    expect(balance()).toBe(10_000);
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveBeenCalledWith('w1', 3_000);
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(deposit).toHaveBeenCalledWith('w1', 3_000);
    expect(ledger.entries()).toHaveLength(0);
  });

  it('refuses to create a payout service from a hand-built config with a negative or fractional fee', () => {
    for (const payoutFee of [-500, 2.5]) {
      const config = { defaultPageSize: 20, maxPageSize: 100, minPayoutAmount: 100, payoutFee };
      expect(() => createPayoutService({ wallets, ledger, clock, config })).toThrow(RangeError);
      expect(() => createPayoutService({ wallets, ledger, clock, config })).toThrow(/payoutFee/);
    }
    expect(balance()).toBe(10_000);
  });

  it('refuses to create a payout service from a hand-built config whose fee is missing or undefined', () => {
    const missing = {
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
    } as unknown as Config;
    const undefinedFee = {
      defaultPageSize: 20,
      maxPageSize: 100,
      minPayoutAmount: 100,
      payoutFee: undefined,
    } as unknown as Config;
    for (const config of [missing, undefinedFee]) {
      expect(() => createPayoutService({ wallets, ledger, clock, config })).toThrow(RangeError);
      expect(() => createPayoutService({ wallets, ledger, clock, config })).toThrow(/payoutFee/);
    }
    expect(balance()).toBe(10_000);
  });

  it('refuses a negative payout fee before any payout service can use it', () => {
    expect(() => withOverrides({ payoutFee: -500 })).toThrow(RangeError);
    expect(balance()).toBe(10_000);
  });

  it('keeps charging the fee it was created with when the hand-built config is edited later', () => {
    const config = { defaultPageSize: 20, maxPageSize: 100, minPayoutAmount: 100, payoutFee: 250 };
    const service = createPayoutService({ wallets, ledger, clock, config });
    config.payoutFee = -500;
    expect(service.request('w1', 4_000)).toMatchObject({
      ok: true,
      value: { amount: 4_000, fee: 250 },
    });
    expect(balance()).toBe(5_750);
  });

  describe('with a payout fee', () => {
    let feePayouts: PayoutService;

    const withFee = (payoutFee: number): PayoutService =>
      createPayoutService({ wallets, ledger, clock, config: withOverrides({ payoutFee }) });

    const setBalance = (target: number): void => {
      const excess = 10_000 - target;
      if (excess > 0) {
        const taken = wallets.withdraw('w1', excess);
        if (!taken.ok) throw new Error(taken.error.message);
      }
    };

    beforeEach(() => {
      feePayouts = withFee(250);
    });

    it('takes the amount plus the fee from the wallet and shows them separately', () => {
      expect(feePayouts.request('w1', 4_000)).toMatchObject({
        ok: true,
        value: { id: 'po_1', walletId: 'w1', amount: 4_000, fee: 250, status: 'pending' },
      });
      expect(balance()).toBe(5_750);
    });

    it('empties the wallet when its balance exactly covers the amount plus the fee', () => {
      setBalance(4_250);
      expect(feePayouts.request('w1', 4_000)).toMatchObject({
        ok: true,
        value: { amount: 4_000, fee: 250 },
      });
      expect(balance()).toBe(0);
    });

    it('fails with insufficient funds for the amount plus the fee and reserves nothing', () => {
      setBalance(4_249);
      expect(feePayouts.request('w1', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', available: 4_249, requested: 4_250 },
      });
      expect(feePayouts.listOpen()).toEqual([]);
      expect(balance()).toBe(4_249);
    });

    it('does not reserve the amount alone when the balance covers the amount but not the fee', () => {
      setBalance(4_000);
      expect(feePayouts.request('w1', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', requested: 4_250 },
      });
      expect(feePayouts.listOpen()).toEqual([]);
      expect(balance()).toBe(4_000);
    });

    it('rejects an amount whose sum with the fee is not a safe integer and reserves nothing', () => {
      expect(feePayouts.request('w1', 9_007_199_254_740_991)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: 9_007_199_254_740_991 },
      });
      expect(feePayouts.listOpen()).toEqual([]);
      expect(balance()).toBe(10_000);
    });

    it('checks the minimum first, then whether amount plus fee is safe, then the wallet', () => {
      const huge = withFee(9_007_199_254_740_991);
      expect(huge.request('w1', 50)).toMatchObject({
        ok: false,
        error: { code: 'BELOW_MINIMUM_PAYOUT' },
      });
      expect(huge.request('w1', 100)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: 100 },
      });
      expect(huge.request('missing', 100)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
      expect(huge.listOpen()).toEqual([]);
      expect(balance()).toBe(10_000);
    });

    it('accepts a minimum-sized amount and charges the fee on top of it', () => {
      expect(feePayouts.request('w1', 100)).toMatchObject({
        ok: true,
        value: { amount: 100, fee: 250 },
      });
      expect(balance()).toBe(9_650);
    });

    it('judges the minimum on the amount alone, not the amount plus the fee', () => {
      expect(feePayouts.request('w1', 99)).toMatchObject({
        ok: false,
        error: { code: 'BELOW_MINIMUM_PAYOUT', minimum: 100, requested: 99 },
      });
      expect(balance()).toBe(10_000);
    });

    it('keeps the amount and the fee through approval, processing, failure, retry and re-approval', () => {
      feePayouts.request('w1', 4_000);
      const kept = { amount: 4_000, fee: 250 };
      expect(feePayouts.approve('po_1')).toMatchObject({ ok: true, value: kept });
      expect(feePayouts.startProcessing('po_1')).toMatchObject({ ok: true, value: kept });
      expect(feePayouts.markFailed('po_1')).toMatchObject({ ok: true, value: kept });
      expect(feePayouts.retry('po_1')).toMatchObject({ ok: true, value: kept });
      expect(feePayouts.approve('po_1')).toMatchObject({ ok: true, value: kept });
      expect(feePayouts.get('po_1')).toMatchObject(kept);
    });

    it('keeps the fee on a payout after a disallowed move', () => {
      feePayouts.request('w1', 4_000);
      expect(feePayouts.markPaid('po_1')).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(feePayouts.get('po_1')).toMatchObject({ status: 'pending', fee: 250 });
    });

    it('posts nothing until paid, then debits the amount and the fee separately', () => {
      feePayouts.request('w1', 4_000);
      feePayouts.approve('po_1');
      feePayouts.startProcessing('po_1');
      expect(ledger.entries()).toHaveLength(0);
      expect(feePayouts.markPaid('po_1')).toMatchObject({
        ok: true,
        value: { status: 'paid', fee: 250 },
      });
      expect(ledger.entries('w1')).toHaveLength(2);
      expect(ledger.entries('w1')).toMatchObject([
        { direction: 'debit', amount: 4_000, description: 'payout po_1' },
        { direction: 'debit', amount: 250, description: 'payout po_1 fee' },
      ]);
      expect(ledger.balance('w1')).toBe(-4_250);
      expect(balance()).toBe(5_750);
    });

    it('posts nothing through a failure and retry, then both debits exactly once when paid', () => {
      feePayouts.request('w1', 4_000);
      feePayouts.approve('po_1');
      feePayouts.startProcessing('po_1');
      feePayouts.markFailed('po_1');
      expect(ledger.entries()).toHaveLength(0);
      feePayouts.retry('po_1');
      expect(ledger.entries()).toHaveLength(0);
      feePayouts.approve('po_1');
      feePayouts.startProcessing('po_1');
      expect(ledger.entries()).toHaveLength(0);
      expect(feePayouts.markPaid('po_1')).toMatchObject({ ok: true, value: { status: 'paid' } });
      expect(ledger.entries('w1')).toHaveLength(2);
      expect(ledger.entries('w1')).toMatchObject([
        { direction: 'debit', amount: 4_000, description: 'payout po_1' },
        { direction: 'debit', amount: 250, description: 'payout po_1 fee' },
      ]);
    });

    it('returns the amount plus the fee when an approved payout is cancelled and posts nothing', () => {
      feePayouts.request('w1', 4_000);
      expect(balance()).toBe(5_750);
      feePayouts.approve('po_1');
      expect(feePayouts.cancel('po_1')).toMatchObject({
        ok: true,
        value: { status: 'cancelled', fee: 250 },
      });
      expect(balance()).toBe(10_000);
      expect(ledger.entries()).toHaveLength(0);
    });

    it('returns the amount plus the fee when a failed payout is cancelled, and only once', () => {
      feePayouts.request('w1', 4_000);
      expect(balance()).toBe(5_750);
      feePayouts.approve('po_1');
      feePayouts.startProcessing('po_1');
      feePayouts.markFailed('po_1');
      expect(feePayouts.cancel('po_1')).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(10_000);
      expect(feePayouts.cancel('po_1')).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(balance()).toBe(10_000);
      expect(ledger.entries()).toHaveLength(0);
    });

    it('returns the amount plus the fee when a paid payout is cancelled and keeps its two debits', () => {
      feePayouts.request('w1', 4_000);
      feePayouts.approve('po_1');
      feePayouts.startProcessing('po_1');
      feePayouts.markPaid('po_1');
      expect(balance()).toBe(5_750);
      expect(feePayouts.cancel('po_1')).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(10_000);
      expect(ledger.entries('w1')).toHaveLength(2);
      expect(ledger.entries('w1')).toMatchObject([
        { direction: 'debit', amount: 4_000, description: 'payout po_1' },
        { direction: 'debit', amount: 250, description: 'payout po_1 fee' },
      ]);
    });

    it('leaves the wallet untouched and creates no payout after repeated short requests', () => {
      setBalance(4_100);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(feePayouts.request('w1', 4_000)).toMatchObject({
          ok: false,
          error: { code: 'INSUFFICIENT_FUNDS', requested: 4_250 },
        });
      }
      expect(balance()).toBe(4_100);
      expect(feePayouts.listOpen()).toEqual([]);
    });

    it('refuses a second mark-paid without posting the debits again', () => {
      feePayouts.request('w1', 4_000);
      feePayouts.approve('po_1');
      feePayouts.startProcessing('po_1');
      feePayouts.markPaid('po_1');
      expect(feePayouts.markPaid('po_1')).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(ledger.entries('w1')).toHaveLength(2);
      expect(ledger.entries('w1')).toMatchObject([{ amount: 4_000 }, { amount: 250 }]);
      expect(ledger.balance('w1')).toBe(-4_250);
    });

    it('refuses to cancel a cancelled payout without refunding it again', () => {
      feePayouts.request('w1', 4_000);
      expect(balance()).toBe(5_750);
      feePayouts.cancel('po_1');
      expect(balance()).toBe(10_000);
      expect(feePayouts.cancel('po_1')).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(balance()).toBe(10_000);
    });
  });

  it('zero fee: full lifecycle posts a single amount debit', () => {
    expect(payouts.request('w1', 2_500)).toMatchObject({ ok: true, value: { fee: 0 } });
    expect(balance()).toBe(7_500);
    payouts.approve('po_1');
    payouts.startProcessing('po_1');
    expect(payouts.markPaid('po_1').ok).toBe(true);
    const entries = ledger.entries('w1');
    expect(entries).toHaveLength(1);
    expect(entries).toMatchObject([
      { direction: 'debit', amount: 2_500, description: 'payout po_1' },
    ]);
  });

  it('zero fee: shortfall reports the bare amount', () => {
    expect(payouts.request('w1', 10_001)).toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS', available: 10_000, requested: 10_001 },
    });
  });

  it('zero fee: cancel restores the balance with no zero-sized movement', () => {
    const withdraw = vi.spyOn(wallets, 'withdraw');
    const deposit = vi.spyOn(wallets, 'deposit');
    const id = requested(3_000);
    expect(payouts.cancel(id).ok).toBe(true);
    expect(balance()).toBe(10_000);
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveBeenCalledWith('w1', 3_000);
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(deposit).toHaveBeenCalledWith('w1', 3_000);
    expect(ledger.entries()).toHaveLength(0);
  });
});
