import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLedger,
  createPayoutService,
  createWalletStore,
  defaultConfig,
  withOverrides,
} from '../../src/index.js';
import type { Ledger, PayoutService, WalletStore } from '../../src/index.js';

const requestedAt = new Date('2025-07-01T08:00:00Z');
const clock = () => requestedAt;

describe('payout fee', () => {
  let wallets: WalletStore;
  let ledger: Ledger;

  const openWallet = (walletId: string, amount: number): void => {
    wallets.open(walletId);
    wallets.deposit(walletId, amount);
  };

  const balance = (walletId = 'w1'): number => {
    const wallet = wallets.get(walletId);
    if (!wallet.ok) throw new Error(wallet.error.message);
    return wallet.value.balance;
  };

  const serviceWithFee = (fee: number): PayoutService =>
    createPayoutService({ wallets, ledger, clock, config: withOverrides({ payoutFee: fee }) });

  const requested = (service: PayoutService, amount: number, walletId = 'w1'): string => {
    const result = service.request(walletId, amount);
    if (!result.ok) throw new Error(result.error.message);
    return result.value.id;
  };

  beforeEach(() => {
    wallets = createWalletStore();
    ledger = createLedger({ clock });
  });

  describe('settings', () => {
    it('refuses to create a payout service from hand-built settings with a payout fee of -1', () => {
      openWallet('w1', 10_000);
      expect(() =>
        createPayoutService({
          wallets,
          ledger,
          clock,
          config: { ...defaultConfig, payoutFee: -1 },
        }),
      ).toThrow();
    });

    it('a payout fee of -500 can be neither applied as an override nor used to create a payout service', () => {
      openWallet('w1', 10_000);
      expect(() => withOverrides({ payoutFee: -500 })).toThrow();
      expect(() =>
        createPayoutService({
          wallets,
          ledger,
          clock,
          config: { ...defaultConfig, payoutFee: -500 },
        }),
      ).toThrow();
    });
  });

  describe('requesting', () => {
    it('requesting 4,000 with a fee of 250 reserves 4,250 and shows the fee on the payout', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
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

    it('the fee of 250 stays on the payout through every later read and status change', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 1_000);
      expect(payouts.get(id)).toMatchObject({ amount: 1_000, fee: 250 });
      expect(payouts.listOpen()).toMatchObject([{ id, amount: 1_000, fee: 250 }]);
      for (const step of [
        () => payouts.approve(id),
        () => payouts.startProcessing(id),
        () => payouts.markFailed(id),
        () => payouts.retry(id),
        () => payouts.approve(id),
        () => payouts.startProcessing(id),
        () => payouts.markPaid(id),
      ]) {
        expect(step()).toMatchObject({ ok: true, value: { amount: 1_000, fee: 250 } });
      }
      expect(payouts.get(id)).toMatchObject({ status: 'paid', amount: 1_000, fee: 250 });

      const other = requested(payouts, 1_000);
      expect(payouts.cancel(other)).toMatchObject({
        ok: true,
        value: { status: 'cancelled', amount: 1_000, fee: 250 },
      });
    });

    it('a wallet holding exactly 4,250 can pay out 4,000 with a fee of 250 and is left at 0', () => {
      openWallet('w1', 4_250);
      const payouts = serviceWithFee(250);
      expect(payouts.request('w1', 4_000)).toMatchObject({
        ok: true,
        value: { amount: 4_000, fee: 250 },
      });
      expect(balance()).toBe(0);
    });

    it('a wallet holding 4,249 is refused a 4,000 payout with a fee of 250, reporting 4,250 requested', () => {
      openWallet('w1', 4_249);
      const payouts = serviceWithFee(250);
      expect(payouts.request('w1', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', available: 4_249, requested: 4_250 },
      });
      expect(balance()).toBe(4_249);
      expect(payouts.listOpen()).toEqual([]);
    });

    it('a wallet that covers the amount but not the fee is refused and no payout is created for the amount alone', () => {
      openWallet('w1', 4_000);
      const payouts = serviceWithFee(250);
      expect(payouts.request('w1', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', available: 4_000, requested: 4_250 },
      });
      expect(balance()).toBe(4_000);
      expect(payouts.listOpen()).toEqual([]);
    });

    it('a refused payout leaves the wallet fully untouched and creates no payout', () => {
      openWallet('w1', 4_000);
      const payouts = serviceWithFee(250);
      const result = payouts.request('w1', 4_000);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', requested: 4_250 },
      });
      expect(balance()).toBe(4_000);
      expect(payouts.get('po_1')).toBeUndefined();
      expect(payouts.listOpen()).toEqual([]);
    });

    it('the minimum payout check compares the 99 requested, not 99 plus the fee', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      expect(payouts.request('w1', 99)).toMatchObject({
        ok: false,
        error: { code: 'BELOW_MINIMUM_PAYOUT', minimum: 100, requested: 99 },
      });
      expect(balance()).toBe(10_000);
    });

    it('a payout of exactly the 100 minimum with a fee of 250 succeeds and reserves 350', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      expect(payouts.request('w1', 100)).toMatchObject({
        ok: true,
        value: { amount: 100, fee: 250 },
      });
      expect(balance()).toBe(9_650);
    });
  });

  describe('paying', () => {
    it('paying a payout with a fee posts the payout debit and then a separate fee debit', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 2_500);
      expect(id).toBe('po_1');
      payouts.approve(id);
      payouts.startProcessing(id);
      expect(payouts.markPaid(id)).toMatchObject({ ok: true, value: { status: 'paid' } });
      const entries = ledger.entries('w1');
      expect(entries).toHaveLength(2);
      expect(entries).toMatchObject([
        { direction: 'debit', amount: 2_500, description: 'payout po_1' },
        { direction: 'debit', amount: 250, description: 'payout fee po_1' },
      ]);
      expect(ledger.balance('w1')).toBe(-2_750);
      expect(balance()).toBe(7_250);
    });

    it('nothing reaches the ledger for a payout with a fee until it is paid', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 2_500);
      expect(ledger.entries()).toHaveLength(0);
      payouts.approve(id);
      expect(ledger.entries()).toHaveLength(0);
      payouts.startProcessing(id);
      expect(ledger.entries()).toHaveLength(0);
      payouts.markFailed(id);
      expect(ledger.entries()).toHaveLength(0);
      payouts.retry(id);
      payouts.approve(id);
      payouts.startProcessing(id);
      expect(ledger.entries()).toHaveLength(0);
      expect(payouts.markPaid(id)).toMatchObject({ ok: true, value: { status: 'paid' } });
      expect(ledger.entries()).toHaveLength(2);
    });

    it('paying a payout with a fee of 0 posts only the payout debit', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(0);
      const id = requested(payouts, 2_500);
      payouts.approve(id);
      payouts.startProcessing(id);
      expect(payouts.markPaid(id)).toMatchObject({ ok: true, value: { status: 'paid' } });
      const entries = ledger.entries();
      expect(entries).toHaveLength(1);
      expect(entries).toMatchObject([
        { account: 'w1', direction: 'debit', amount: 2_500, description: `payout ${id}` },
      ]);
    });

    it('the fee is its own ledger entry and is never merged into the payout debit', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 2_500);
      payouts.approve(id);
      payouts.startProcessing(id);
      payouts.markPaid(id);
      const entries = ledger.entries();
      expect(entries.map((entry) => entry.amount)).toEqual([2_500, 250]);
      expect(entries.some((entry) => entry.amount === 2_750)).toBe(false);
      expect(entries).toMatchObject([
        { account: 'w1', direction: 'debit', description: `payout ${id}` },
        { account: 'w1', direction: 'debit', description: `payout fee ${id}` },
      ]);
    });
  });

  describe('cancelling and failing', () => {
    it('cancelling an approved payout returns the 3,000 plus its 250 fee and posts nothing', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 3_000);
      expect(balance()).toBe(6_750);
      payouts.approve(id);
      expect(payouts.cancel(id)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(10_000);
      expect(ledger.entries()).toHaveLength(0);
    });

    it('cancelling a pending payout returns the amount plus its fee', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 3_000);
      expect(balance()).toBe(6_750);
      expect(payouts.cancel(id)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(10_000);
      expect(ledger.entries()).toHaveLength(0);
    });

    it('cancelling a failed payout returns the amount plus its fee once and a second cancel is refused', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 3_000);
      payouts.approve(id);
      payouts.startProcessing(id);
      expect(payouts.markFailed(id)).toMatchObject({ ok: true, value: { status: 'failed' } });
      expect(balance()).toBe(6_750);
      expect(payouts.cancel(id)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
      expect(balance()).toBe(10_000);
      expect(payouts.cancel(id)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(balance()).toBe(10_000);
      expect(ledger.entries()).toHaveLength(0);
    });

    it('a cancelled payout is refunded exactly what was reserved and never refunded twice', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 3_000);
      payouts.approve(id);
      const reserved = 10_000 - balance();
      expect(reserved).toBe(3_250);
      payouts.cancel(id);
      expect(balance()).toBe(10_000);
      expect(payouts.cancel(id)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(balance()).toBe(10_000);
    });

    it('failure and retry keep the amount plus the fee held', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      const id = requested(payouts, 1_000);
      payouts.approve(id);
      payouts.startProcessing(id);
      payouts.markFailed(id);
      expect(payouts.retry(id)).toMatchObject({ ok: true, value: { status: 'pending' } });
      expect(balance()).toBe(8_750);
    });
  });

  describe('default settings', () => {
    it('with default settings a payout shows a fee of 0, reserves only the amount and is paid with one ledger debit', () => {
      openWallet('w1', 10_000);
      const payouts = createPayoutService({ wallets, ledger, clock });
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
      payouts.approve('po_1');
      payouts.startProcessing('po_1');
      expect(payouts.markPaid('po_1')).toMatchObject({ ok: true, value: { status: 'paid' } });
      const entries = ledger.entries();
      expect(entries).toHaveLength(1);
      expect(entries).toMatchObject([
        { account: 'w1', direction: 'debit', amount: 4_000, description: 'payout po_1' },
      ]);
    });

    it('with default settings an over-balance request reports only the amount as requested', () => {
      openWallet('w1', 10_000);
      const payouts = createPayoutService({ wallets, ledger, clock });
      expect(payouts.request('w1', 10_001)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', available: 10_000, requested: 10_001 },
      });
      expect(balance()).toBe(10_000);
      expect(payouts.listOpen()).toEqual([]);
    });
  });

  describe('very large amounts', () => {
    it('a payout whose amount plus fee is too large to represent safely is refused as an invalid amount', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      expect(payouts.request('w1', Number.MAX_SAFE_INTEGER)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: Number.MAX_SAFE_INTEGER },
      });
      expect(payouts.listOpen()).toEqual([]);
      expect(balance()).toBe(10_000);
    });

    it('a payout whose amount plus fee is exactly the largest safe integer reaches the funds check', () => {
      openWallet('w1', 10_000);
      const payouts = serviceWithFee(250);
      expect(payouts.request('w1', Number.MAX_SAFE_INTEGER - 250)).toMatchObject({
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          available: 10_000,
          requested: Number.MAX_SAFE_INTEGER,
        },
      });
      expect(balance()).toBe(10_000);
    });

    it('an unsafe amount plus fee is reported as an invalid amount before an unknown wallet', () => {
      const payouts = serviceWithFee(250);
      expect(payouts.request('missing', Number.MAX_SAFE_INTEGER)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: Number.MAX_SAFE_INTEGER },
      });
    });
  });
});
