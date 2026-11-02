import { beforeEach, describe, expect, it } from 'vitest';
import { withOverrides } from '../../src/config.js';
import type { Result } from '../../src/errors.js';
import type { AboveMaximumPayoutError } from '../../src/index.js';
import { createLedger, type Ledger } from '../../src/ledger/ledger.js';
import { createPayoutService, type PayoutService } from '../../src/payouts/service.js';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';
import type { AboveMaximumPayoutError as OverMaximumPayoutError } from '../../src/index.js';

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

  const cappedAt = (maxPayoutAmount: number): PayoutService =>
    createPayoutService({ wallets, ledger, clock, config: withOverrides({ maxPayoutAmount }) });

  const balanceOfWallet = (walletId: string): number => {
    const wallet = wallets.get(walletId);
    if (!wallet.ok) throw new Error(wallet.error.message);
    return wallet.value.balance;
  };

  const refusalOf = (result: ReturnType<PayoutService['request']>) => {
    if (result.ok) throw new Error('expected the payout request to be refused');
    return result.error;
  };

  it('refuses a payout one unit above the configured maximum and names both amounts', () => {
    const error = refusalOf(cappedAt(5_000).request('w1', 5_001));
    expect(error).toMatchObject({ code: 'ABOVE_MAXIMUM_PAYOUT', maximum: 5_000, requested: 5_001 });
    expect(Object.keys(error).sort()).toEqual(['code', 'maximum', 'message', 'requested']);
    expect(error.message).toContain('5000');
    expect(error.message).toContain('5001');
  });

  it('accepts a payout of exactly the configured maximum', () => {
    expect(cappedAt(5_000).request('w1', 5_000)).toMatchObject({
      ok: true,
      value: { walletId: 'w1', amount: 5_000, status: 'pending' },
    });
    expect(balanceOfWallet('w1')).toBe(5_000);
  });

  it('leaves no reservation, open payout or used payout id behind after an over-maximum refusal', () => {
    const service = cappedAt(5_000);
    expect(service.request('w1', 6_000)).toMatchObject({
      ok: false,
      error: { code: 'ABOVE_MAXIMUM_PAYOUT' },
    });
    expect(service.request('w1', 1_000)).toMatchObject({
      ok: true,
      value: { id: 'po_1', amount: 1_000 },
    });
    expect(balanceOfWallet('w1')).toBe(9_000);
    expect(service.listOpen().map((p) => p.id)).toEqual(['po_1']);
  });

  it('refuses an over-maximum payout the wallet could afford and reserves nothing', () => {
    const service = cappedAt(5_000);
    expect(service.request('w1', 6_000)).toMatchObject({
      ok: false,
      error: { code: 'ABOVE_MAXIMUM_PAYOUT', maximum: 5_000, requested: 6_000 },
    });
    expect(balanceOfWallet('w1')).toBe(10_000);
    expect(service.listOpen()).toEqual([]);
  });

  it('reports the maximum before looking up a wallet that does not exist', () => {
    expect(cappedAt(5_000).request('missing', 5_001)).toMatchObject({
      ok: false,
      error: { code: 'ABOVE_MAXIMUM_PAYOUT' },
    });
  });

  it('reports the maximum rather than insufficient funds for a wallet that cannot cover the amount', () => {
    wallets.withdraw('w1', 7_000);
    expect(balanceOfWallet('w1')).toBe(3_000);
    expect(cappedAt(5_000).request('w1', 6_000)).toMatchObject({
      ok: false,
      error: { code: 'ABOVE_MAXIMUM_PAYOUT' },
    });
    expect(balanceOfWallet('w1')).toBe(3_000);
  });

  it('still looks up the wallet for a request of exactly the maximum', () => {
    expect(cappedAt(5_000).request('missing', 5_000)).toMatchObject({
      ok: false,
      error: { code: 'WALLET_NOT_FOUND' },
    });
  });

  it('reports a fractional amount above the maximum as an invalid amount', () => {
    expect(cappedAt(5_000).request('w1', 9_000.5)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_AMOUNT' },
    });
  });

  it('reports an unsafe integer above the maximum as an invalid amount', () => {
    expect(cappedAt(5_000).request('w1', Number.MAX_SAFE_INTEGER + 1)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_AMOUNT' },
    });
  });

  it('caps payouts at one million minor units when no config is given', () => {
    wallets.deposit('w1', 1_990_000);
    expect(balanceOfWallet('w1')).toBe(2_000_000);
    expect(payouts.request('w1', 1_000_001)).toMatchObject({
      ok: false,
      error: { code: 'ABOVE_MAXIMUM_PAYOUT', maximum: 1_000_000, requested: 1_000_001 },
    });
    expect(payouts.request('w1', 1_000_000)).toMatchObject({
      ok: true,
      value: { amount: 1_000_000, status: 'pending' },
    });
  });

  it('keeps in-range, below-minimum and insufficient-funds outcomes unchanged under the default config', () => {
    expect(payouts.request('w1', 4_000)).toMatchObject({
      ok: true,
      value: { id: 'po_1', walletId: 'w1', amount: 4_000, status: 'pending' },
    });
    expect(balanceOfWallet('w1')).toBe(6_000);
    expect(payouts.request('w1', 10_001)).toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS' },
    });
    expect(payouts.request('w1', 99)).toMatchObject({
      ok: false,
      error: { code: 'BELOW_MINIMUM_PAYOUT' },
    });
  });

  it('applies the minimum before the maximum when the maximum is configured below it', () => {
    const misconfigured = createPayoutService({
      wallets,
      ledger,
      clock,
      config: withOverrides({ minPayoutAmount: 1_000, maxPayoutAmount: 500 }),
    });
    expect(misconfigured.request('w1', 600)).toMatchObject({
      ok: false,
      error: { code: 'BELOW_MINIMUM_PAYOUT' },
    });
  });

  it('lets callers name the over-maximum error type from the package entry point', () => {
    const result = cappedAt(5_000).request('w1', 5_001);
    if (result.ok || result.error.code !== 'ABOVE_MAXIMUM_PAYOUT') {
      throw new Error('expected an ABOVE_MAXIMUM_PAYOUT refusal');
    }
    const error: OverMaximumPayoutError = result.error;
    const figures: [number, number] = [error.maximum, error.requested];
    expect(figures).toEqual([5_000, 5_001]);
  });

  it('refuses every over-maximum amount even when the wallet holds enough to pay it', () => {
    wallets.deposit('w1', 990_000);
    expect(balanceOfWallet('w1')).toBe(1_000_000);
    const service = cappedAt(5_000);
    for (const amount of [5_001, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(service.request('w1', amount)).toMatchObject({
        ok: false,
        error: { code: 'ABOVE_MAXIMUM_PAYOUT' },
      });
    }
    expect(balanceOfWallet('w1')).toBe(1_000_000);
    expect(service.listOpen()).toEqual([]);
    expect(service.get('po_1')).toBeUndefined();
  });

  it('gives the same over-maximum error whether or not the wallet exists, without throwing', () => {
    const service = cappedAt(5_000);
    let missing: ReturnType<PayoutService['request']> | undefined;
    let present: ReturnType<PayoutService['request']> | undefined;
    expect(() => {
      missing = service.request('missing', 9_999);
    }).not.toThrow();
    expect(() => {
      present = service.request('w1', 9_999);
    }).not.toThrow();
    if (missing === undefined || present === undefined) throw new Error('expected both results');
    const missingError = refusalOf(missing);
    expect(missingError).toMatchObject({
      code: 'ABOVE_MAXIMUM_PAYOUT',
      maximum: 5_000,
      requested: 9_999,
    });
    const presentError = refusalOf(present);
    expect(missingError).toEqual(presentError);
    expect(missingError).not.toHaveProperty('available');
    expect(missingError).not.toHaveProperty('walletId');
    expect(presentError).not.toHaveProperty('available');
    expect(presentError).not.toHaveProperty('walletId');
  });

  describe('per-request payout cap', () => {
    let capped: PayoutService;

    const fundsIn = (walletId: string): number => {
      const wallet = wallets.get(walletId);
      if (!wallet.ok) throw new Error(wallet.error.message);
      return wallet.value.balance;
    };

    const refusal = <E>(result: Result<unknown, E>): E => {
      if (result.ok) throw new Error('expected a refusal');
      return result.error;
    };

    beforeEach(() => {
      capped = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: 5_000 }),
      });
    });

    it('refuses one unit over the cap and reports both figures', () => {
      const error = refusal(capped.request('w1', 5_001));
      expect(error).toMatchObject({
        code: 'ABOVE_MAXIMUM_PAYOUT',
        maximum: 5_000,
        requested: 5_001,
      });
      expect(Object.keys(error).sort()).toEqual(['code', 'maximum', 'message', 'requested']);
      expect(error.message).toContain('5000');
      expect(error.message).toContain('5001');
    });

    it('lets a request equal to the cap through', () => {
      expect(capped.request('w1', 5_000)).toMatchObject({
        ok: true,
        value: { amount: 5_000, status: 'pending' },
      });
      expect(fundsIn('w1')).toBe(5_000);
    });

    it('applies the cap ahead of any wallet lookup', () => {
      expect(refusal(capped.request('missing', 5_001)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
      wallets.open('small');
      wallets.deposit('small', 3_000);
      expect(refusal(capped.request('small', 6_000)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
      expect(fundsIn('small')).toBe(3_000);
    });

    it('still sends an at-cap request on to the wallet', () => {
      expect(refusal(capped.request('missing', 5_000)).code).toBe('WALLET_NOT_FOUND');
    });

    it('reports malformed amounts as invalid even above the cap', () => {
      expect(refusal(capped.request('w1', 9_000.5)).code).toBe('INVALID_AMOUNT');
      expect(refusal(capped.request('w1', Number.MAX_SAFE_INTEGER + 1)).code).toBe(
        'INVALID_AMOUNT',
      );
      expect(fundsIn('w1')).toBe(10_000);
    });

    it('applies the minimum before the cap when the cap is set below it', () => {
      const inverted = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ minPayoutAmount: 1_000, maxPayoutAmount: 500 }),
      });
      expect(refusal(inverted.request('w1', 600)).code).toBe('BELOW_MINIMUM_PAYOUT');
    });

    it('leaves no reservation, open payout or used id behind after an over-cap refusal', () => {
      expect(refusal(capped.request('w1', 6_000)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
      expect(fundsIn('w1')).toBe(10_000);
      expect(capped.listOpen()).toEqual([]);
      expect(capped.request('w1', 1_000)).toMatchObject({ ok: true, value: { id: 'po_1' } });
      expect(fundsIn('w1')).toBe(9_000);
      expect(capped.listOpen().map((p) => p.id)).toEqual(['po_1']);
    });

    it('refuses every over-cap size even when the wallet could pay it', () => {
      wallets.open('rich');
      wallets.deposit('rich', 1_000_000);
      for (const amount of [5_001, 1_000_000, Number.MAX_SAFE_INTEGER]) {
        expect(refusal(capped.request('rich', amount)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
      }
      expect(fundsIn('rich')).toBe(1_000_000);
      expect(capped.listOpen()).toEqual([]);
      expect(capped.get('po_1')).toBeUndefined();
    });

    it('gives an identical over-cap error whether or not the wallet exists', () => {
      expect(() => capped.request('missing', 9_999)).not.toThrow();
      const unknown = refusal(capped.request('missing', 9_999));
      const known = refusal(capped.request('w1', 9_999));
      expect(unknown).toEqual(known);
      expect(unknown.code).toBe('ABOVE_MAXIMUM_PAYOUT');
      for (const error of [unknown, known]) {
        expect(error).not.toHaveProperty('available');
        expect(error).not.toHaveProperty('walletId');
      }
    });

    it('caps requests at one million minor units when no config is given', () => {
      wallets.open('big');
      wallets.deposit('big', 2_000_000);
      expect(refusal(payouts.request('big', 1_000_001))).toMatchObject({
        code: 'ABOVE_MAXIMUM_PAYOUT',
        maximum: 1_000_000,
      });
      expect(payouts.request('big', 1_000_000).ok).toBe(true);
    });

    it('names the default cap and the requested amount in the default-config refusal message', () => {
      wallets.open('big');
      wallets.deposit('big', 2_000_000);
      const error = refusal(payouts.request('big', 1_000_001));
      expect(error.code).toBe('ABOVE_MAXIMUM_PAYOUT');
      expect(error.message).toContain('1000000');
      expect(error.message).toContain('1000001');
      expect(fundsIn('big')).toBe(2_000_000);
    });

    it('accepts and reserves a request under a raised cap that the default would refuse', () => {
      const raised = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: 2_000_000 }),
      });
      wallets.open('big');
      wallets.deposit('big', 3_000_000);
      expect(raised.request('big', 1_500_000)).toMatchObject({
        ok: true,
        value: { amount: 1_500_000, status: 'pending', walletId: 'big' },
      });
      expect(fundsIn('big')).toBe(1_500_000);
    });

    it('refuses one unit over a raised cap, naming both figures and reserving nothing', () => {
      const raised = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: 2_000_000 }),
      });
      wallets.open('big');
      wallets.deposit('big', 3_000_000);
      const error = refusal(raised.request('big', 2_000_001));
      expect(error).toMatchObject({
        code: 'ABOVE_MAXIMUM_PAYOUT',
        maximum: 2_000_000,
        requested: 2_000_001,
      });
      expect(error.message).toContain('2000000');
      expect(error.message).toContain('2000001');
      expect(fundsIn('big')).toBe(3_000_000);
      expect(raised.listOpen()).toEqual([]);
    });

    it('lets callers name the over-cap error from the package entry point', () => {
      const result = capped.request('w1', 5_001);
      if (result.ok || result.error.code !== 'ABOVE_MAXIMUM_PAYOUT') {
        throw new Error('expected an over-cap refusal');
      }
      const error: AboveMaximumPayoutError = result.error;
      const figures: [number, number] = [error.maximum, error.requested];
      expect(figures).toEqual([5_000, 5_001]);
    });

    it('accepts and reserves a request under the largest safe-integer cap', () => {
      const widest = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ maxPayoutAmount: Number.MAX_SAFE_INTEGER }),
      });
      wallets.open('deep');
      wallets.deposit('deep', 50_000_000);
      expect(widest.request('deep', 40_000_000)).toMatchObject({
        ok: true,
        value: { amount: 40_000_000, status: 'pending', walletId: 'deep' },
      });
      expect(fundsIn('deep')).toBe(10_000_000);
    });

    it('lets a single unit through and refuses two when minimum and cap are both one', () => {
      const tight = createPayoutService({
        wallets,
        ledger,
        clock,
        config: withOverrides({ minPayoutAmount: 1, maxPayoutAmount: 1 }),
      });
      expect(tight.request('w1', 1)).toMatchObject({
        ok: true,
        value: { amount: 1, status: 'pending', walletId: 'w1' },
      });
      expect(fundsIn('w1')).toBe(9_999);
      expect(refusal(tight.request('w1', 2))).toMatchObject({
        code: 'ABOVE_MAXIMUM_PAYOUT',
        maximum: 1,
        requested: 2,
      });
      expect(fundsIn('w1')).toBe(9_999);
    });

    describe('cap setting that cannot be trusted', () => {
      const unusableCaps: [label: string, cap: number][] = [
        ['NaN', Number(undefined)],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['undefined', undefined as unknown as number],
        ['a numeric string', '5000' as unknown as number],
        ['zero', 0],
        ['negative', -5_000],
        ['fractional', 5_000.5],
        ['one past the safe integer range (2 ** 53)', 2 ** 53],
        ['far past the safe integer range (1e18)', 1e18],
      ];

      beforeEach(() => {
        wallets.open('vault');
        wallets.deposit('vault', 50_000_000);
      });

      it.each(unusableCaps)(
        'refuses large and minimum-sized requests alike when the cap setting is %s',
        (_label, cap) => {
          const service = createPayoutService({
            wallets,
            ledger,
            clock,
            config: withOverrides({ maxPayoutAmount: cap }),
          });
          for (const amount of [40_000_000, 100]) {
            expect(() => service.request('vault', amount)).not.toThrow();
            const error = refusal(service.request('vault', amount));
            if (error.code !== 'ABOVE_MAXIMUM_PAYOUT') {
              throw new Error(`expected an over-cap refusal, got ${error.code}`);
            }
            expect(error.requested).toBe(amount);
            expect(error.maximum).toBe(cap);
          }
          expect(refusal(service.request('missing', 100)).code).toBe('ABOVE_MAXIMUM_PAYOUT');
          expect(fundsIn('vault')).toBe(50_000_000);
          expect(service.listOpen()).toEqual([]);
          expect(service.get('po_1')).toBeUndefined();
        },
      );

      it.each(unusableCaps)(
        'still answers bad and below-minimum amounts first when the cap setting is %s',
        (_label, cap) => {
          const service = createPayoutService({
            wallets,
            ledger,
            clock,
            config: withOverrides({ maxPayoutAmount: cap }),
          });
          expect(refusal(service.request('vault', 9_000.5)).code).toBe('INVALID_AMOUNT');
          expect(refusal(service.request('vault', 99)).code).toBe('BELOW_MINIMUM_PAYOUT');
          expect(fundsIn('vault')).toBe(50_000_000);
        },
      );
    });
  });
});
