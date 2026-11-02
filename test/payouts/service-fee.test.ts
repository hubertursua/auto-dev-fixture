import { describe, expect, it } from 'vitest';
import { withOverrides, type Config } from '../../src/config.js';
import { createLedger } from '../../src/ledger/ledger.js';
import { createPayoutService } from '../../src/payouts/service.js';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';

const requestedAt = new Date('2025-07-01T08:00:00Z');
const clock = () => requestedAt;

const balanceOf = (wallets: WalletStore): number => {
  const wallet = wallets.get('w1');
  if (!wallet.ok) throw new Error(wallet.error.message);
  return wallet.value.balance;
};

const setup = ({ balance = 10_000, payoutFee = 250, minPayoutAmount = 100 } = {}) => {
  const wallets = createWalletStore();
  wallets.open('w1');
  if (balance > 0) {
    wallets.deposit('w1', balance);
  }
  const ledger = createLedger({ clock });
  const payouts = createPayoutService({
    wallets,
    ledger,
    clock,
    config: withOverrides({ payoutFee, minPayoutAmount }),
  });
  return { wallets, ledger, payouts, balance: () => balanceOf(wallets) };
};

const fundedWallets = (): WalletStore => {
  const wallets = createWalletStore();
  wallets.open('w1');
  wallets.deposit('w1', 10_000);
  return wallets;
};

const feeDebits = [
  { direction: 'debit', amount: 4_000, description: 'payout po_1' },
  { direction: 'debit', amount: 250, description: 'payout po_1 fee' },
];

describe('payout service with a flat fee', () => {
  describe('construction', () => {
    it.each([-500, 2.5])(
      'refuses to construct with a hand-built config holding a bad fee (%s)',
      (payoutFee) => {
        const wallets = fundedWallets();
        const config: Config = {
          defaultPageSize: 20,
          maxPageSize: 100,
          minPayoutAmount: 100,
          payoutFee,
        };
        expect(() =>
          createPayoutService({ wallets, ledger: createLedger({ clock }), clock, config }),
        ).toThrow(RangeError);
        expect(() =>
          createPayoutService({ wallets, ledger: createLedger({ clock }), clock, config }),
        ).toThrow(/payoutFee/);
        expect(balanceOf(wallets)).toBe(10_000);
      },
    );

    it('refuses to construct when the hand-built config lacks a fee', () => {
      const wallets = fundedWallets();
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
        expect(() =>
          createPayoutService({ wallets, ledger: createLedger({ clock }), clock, config }),
        ).toThrow(RangeError);
        expect(() =>
          createPayoutService({ wallets, ledger: createLedger({ clock }), clock, config }),
        ).toThrow(/payoutFee/);
      }
      expect(balanceOf(wallets)).toBe(10_000);
    });
  });

  describe('request', () => {
    it('charges the fee read at construction even if the config object is later edited', () => {
      const wallets = fundedWallets();
      const config = {
        defaultPageSize: 20,
        maxPageSize: 100,
        minPayoutAmount: 100,
        payoutFee: 250,
      };
      const payouts = createPayoutService({
        wallets,
        ledger: createLedger({ clock }),
        clock,
        config,
      });
      config.payoutFee = -500;
      expect(payouts.request('w1', 4_000)).toMatchObject({ ok: true, value: { fee: 250 } });
      expect(balanceOf(wallets)).toBe(5_750);
    });

    it('holds amount and fee together and lists them apart', () => {
      const { payouts, balance } = setup();
      expect(payouts.request('w1', 4_000)).toMatchObject({
        ok: true,
        value: { id: 'po_1', walletId: 'w1', amount: 4_000, fee: 250, status: 'pending' },
      });
      expect(balance()).toBe(5_750);
    });

    it('drains the wallet to zero when the balance matches the sum', () => {
      const { payouts, balance } = setup({ balance: 4_250 });
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      expect(balance()).toBe(0);
    });

    it('rejects one unit short and leaves no payout', () => {
      const { payouts, balance } = setup({ balance: 4_249 });
      expect(payouts.request('w1', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', available: 4_249, requested: 4_250 },
      });
      expect(payouts.listOpen()).toEqual([]);
      expect(balance()).toBe(4_249);
    });

    it('does not hold the bare amount when only the fee is uncovered', () => {
      const { payouts, balance } = setup({ balance: 4_000 });
      expect(payouts.request('w1', 4_000)).toMatchObject({
        ok: false,
        error: { code: 'INSUFFICIENT_FUNDS', requested: 4_250 },
      });
      expect(balance()).toBe(4_000);
      expect(payouts.listOpen()).toEqual([]);
    });

    it('rejects an amount whose sum with the fee is not a safe integer', () => {
      const { payouts, balance } = setup();
      expect(payouts.request('w1', Number.MAX_SAFE_INTEGER)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: Number.MAX_SAFE_INTEGER },
      });
      expect(payouts.listOpen()).toEqual([]);
      expect(balance()).toBe(10_000);
    });

    it('accepts an amount whose sum with the fee is exactly the largest safe integer', () => {
      const { payouts, balance } = setup({ balance: Number.MAX_SAFE_INTEGER });
      expect(payouts.request('w1', Number.MAX_SAFE_INTEGER - 250)).toMatchObject({
        ok: true,
        value: { amount: 9_007_199_254_740_741, fee: 250 },
      });
      expect(balance()).toBe(0);
    });

    it('rejects an amount one unit past the largest safe sum and reserves nothing', () => {
      const { payouts, balance } = setup();
      expect(payouts.request('w1', Number.MAX_SAFE_INTEGER - 249)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: 9_007_199_254_740_742 },
      });
      expect(payouts.listOpen()).toEqual([]);
      expect(balance()).toBe(10_000);
    });

    it('explains an unsafe sum with the amount and the fee in its message', () => {
      const { payouts } = setup();
      const result = payouts.request('w1', Number.MAX_SAFE_INTEGER);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_AMOUNT');
      expect(result.error.message).toBe(
        'amount 9007199254740991 plus payout fee 250 is not a safe integer number of minor units',
      );
    });

    it('runs the minimum check, then the sum check, then the wallet', () => {
      const { payouts } = setup({ payoutFee: Number.MAX_SAFE_INTEGER });
      expect(payouts.request('w1', 50)).toMatchObject({
        ok: false,
        error: { code: 'BELOW_MINIMUM_PAYOUT' },
      });
      expect(payouts.request('w1', 100)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount: 100 },
      });
      expect(payouts.request('missing', 100)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
    });

    it('judges the minimum on the amount only', () => {
      const { payouts, balance } = setup();
      expect(payouts.request('w1', 99)).toMatchObject({
        ok: false,
        error: { code: 'BELOW_MINIMUM_PAYOUT', minimum: 100, requested: 99 },
      });
      expect(balance()).toBe(10_000);
      expect(payouts.request('w1', 100)).toMatchObject({
        ok: true,
        value: { amount: 100, fee: 250 },
      });
      expect(balance()).toBe(9_650);
    });

    it('leaves the wallet intact after repeated short requests', () => {
      const { payouts, balance } = setup({ balance: 4_100 });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(payouts.request('w1', 4_000)).toMatchObject({
          ok: false,
          error: { code: 'INSUFFICIENT_FUNDS', requested: 4_250 },
        });
      }
      expect(balance()).toBe(4_100);
      expect(payouts.listOpen()).toEqual([]);
    });
  });

  describe('lifecycle', () => {
    it('keeps amount and fee through approve, processing, failure, retry and re-approval', () => {
      const { payouts } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      const expected = { ok: true, value: { amount: 4_000, fee: 250 } };
      expect(payouts.approve('po_1')).toMatchObject(expected);
      expect(payouts.startProcessing('po_1')).toMatchObject(expected);
      expect(payouts.markFailed('po_1')).toMatchObject(expected);
      expect(payouts.retry('po_1')).toMatchObject(expected);
      expect(payouts.approve('po_1')).toMatchObject(expected);
      expect(payouts.get('po_1')).toMatchObject({ amount: 4_000, fee: 250 });
    });

    it('keeps the fee after a refused move', () => {
      const { payouts } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      expect(payouts.markPaid('po_1')).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(payouts.get('po_1')).toMatchObject({ status: 'pending', fee: 250 });
    });
  });

  describe('paid', () => {
    it('posts nothing until paid, then the amount debit followed by the fee debit', () => {
      const { payouts, ledger, balance } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      payouts.approve('po_1');
      payouts.startProcessing('po_1');
      expect(ledger.entries()).toEqual([]);
      expect(payouts.markPaid('po_1')).toMatchObject({
        ok: true,
        value: { status: 'paid', fee: 250 },
      });
      const entries = ledger.entries('w1');
      expect(entries).toHaveLength(2);
      expect(entries).toMatchObject(feeDebits);
      expect(ledger.balance('w1')).toBe(-4_250);
      expect(balance()).toBe(5_750);
    });

    it('posts both debits exactly once after a failure and retry', () => {
      const { payouts, ledger } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      payouts.approve('po_1');
      expect(ledger.entries()).toEqual([]);
      payouts.startProcessing('po_1');
      expect(ledger.entries()).toEqual([]);
      payouts.markFailed('po_1');
      expect(ledger.entries()).toEqual([]);
      payouts.retry('po_1');
      expect(ledger.entries()).toEqual([]);
      payouts.approve('po_1');
      payouts.startProcessing('po_1');
      expect(payouts.markPaid('po_1').ok).toBe(true);
      expect(ledger.entries()).toHaveLength(2);
      expect(ledger.entries()).toMatchObject(feeDebits);
    });

    it('refuses a second mark-paid without new postings', () => {
      const { payouts, ledger } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      payouts.approve('po_1');
      payouts.startProcessing('po_1');
      expect(payouts.markPaid('po_1').ok).toBe(true);
      expect(payouts.markPaid('po_1')).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      const entries = ledger.entries();
      expect(entries).toHaveLength(2);
      expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(4_250);
    });
  });

  describe('cancel', () => {
    it('gives back amount and fee on cancel and leaves the ledger empty', () => {
      const { payouts, ledger, balance } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      expect(balance()).toBe(5_750);
      payouts.approve('po_1');
      expect(payouts.cancel('po_1')).toMatchObject({
        ok: true,
        value: { status: 'cancelled', fee: 250 },
      });
      expect(balance()).toBe(10_000);
      expect(ledger.entries()).toEqual([]);
    });

    it('gives back the whole sum when a failed payout is cancelled', () => {
      const { payouts, balance } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      payouts.approve('po_1');
      payouts.startProcessing('po_1');
      payouts.markFailed('po_1');
      expect(payouts.cancel('po_1').ok).toBe(true);
      expect(balance()).toBe(10_000);
    });

    it('refuses a second cancel and refunds once', () => {
      const { payouts, balance } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      expect(payouts.cancel('po_1').ok).toBe(true);
      expect(payouts.cancel('po_1')).toMatchObject({
        ok: false,
        error: { code: 'INVALID_TRANSITION' },
      });
      expect(balance()).toBe(10_000);
    });

    it('returns the whole sum on the retained paid-to-cancelled move with debits left in place', () => {
      const { payouts, ledger, balance } = setup();
      expect(payouts.request('w1', 4_000).ok).toBe(true);
      payouts.approve('po_1');
      payouts.startProcessing('po_1');
      expect(payouts.markPaid('po_1').ok).toBe(true);
      expect(balance()).toBe(5_750);
      expect(payouts.cancel('po_1').ok).toBe(true);
      expect(balance()).toBe(10_000);
      const entries = ledger.entries('w1');
      expect(entries).toHaveLength(2);
      expect(entries).toMatchObject(feeDebits);
    });
  });
});
