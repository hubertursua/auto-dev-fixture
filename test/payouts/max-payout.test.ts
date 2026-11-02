import { beforeEach, describe, expect, it } from 'vitest';
import { withOverrides, type Config } from '../../src/config.js';
import { createLedger, type Ledger } from '../../src/ledger/ledger.js';
import { createPayoutService, type PayoutService } from '../../src/payouts/service.js';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';

const requestedAt = new Date('2025-07-01T08:00:00Z');
const clock = () => requestedAt;

describe('payout maximum that is not a usable limit', () => {
  let wallets: WalletStore;
  let ledger: Ledger;

  const unusableMaximums: readonly (readonly [string, number])[] = [
    ['NaN from an unset setting', Number(undefined)],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined as unknown as number],
  ];

  const otherUnusableMaximums: readonly (readonly [string, number])[] = [
    ['a numeric string', '5000' as unknown as number],
    ['zero', 0],
    ['a negative number', -5_000],
    ['a fraction', 5_000.5],
  ];

  const serviceWith = (config: Config): PayoutService =>
    createPayoutService({ wallets, ledger, clock, config });

  const balanceOf = (walletId: string): number => {
    const wallet = wallets.get(walletId);
    if (!wallet.ok) throw new Error(wallet.error.message);
    return wallet.value.balance;
  };

  const expectRefusedOverMaximum = (service: PayoutService, label: string, amount: number) => {
    const result = service.request('w1', amount);
    if (result.ok) {
      throw new Error(`maximum ${label}: a request for ${String(amount)} was accepted`);
    }
    expect(result.error.code, `maximum ${label}, request ${String(amount)}`).toBe(
      'ABOVE_MAXIMUM_PAYOUT',
    );
  };

  beforeEach(() => {
    wallets = createWalletStore();
    wallets.open('w1');
    wallets.deposit('w1', 50_000_000);
    ledger = createLedger({ clock });
  });

  it('refuses large and minimum-sized payouts when the maximum is NaN, Infinity or undefined', () => {
    for (const [label, maximum] of unusableMaximums) {
      const service = serviceWith(withOverrides({ maxPayoutAmount: maximum }));
      expectRefusedOverMaximum(service, label, 40_000_000);
      expectRefusedOverMaximum(service, label, 100);
      expect(balanceOf('w1'), `maximum ${label}`).toBe(50_000_000);
      expect(service.listOpen(), `maximum ${label}`).toEqual([]);
      expect(service.get('po_1'), `maximum ${label}`).toBeUndefined();
    }
  });

  it('refuses payouts when the maximum is a string, zero, negative or a fraction', () => {
    for (const [label, maximum] of otherUnusableMaximums) {
      const service = serviceWith(withOverrides({ maxPayoutAmount: maximum }));
      expectRefusedOverMaximum(service, label, 40_000_000);
      expectRefusedOverMaximum(service, label, 100);
      expect(balanceOf('w1'), `maximum ${label}`).toBe(50_000_000);
      expect(service.listOpen(), `maximum ${label}`).toEqual([]);
      expect(service.get('po_1'), `maximum ${label}`).toBeUndefined();
    }
  });

  it('builds a config holding an unusable maximum without throwing', () => {
    for (const [label, maximum] of unusableMaximums) {
      expect(() => withOverrides({ maxPayoutAmount: maximum }), `maximum ${label}`).not.toThrow();
      expect(withOverrides({ maxPayoutAmount: maximum }).maxPayoutAmount, `maximum ${label}`).toBe(
        maximum,
      );
    }
  });

  it('still reports invalid and below-minimum amounts first when the maximum is unusable', () => {
    for (const [label, maximum] of unusableMaximums) {
      const service = serviceWith(withOverrides({ maxPayoutAmount: maximum }));
      expect(service.request('w1', 9_000.5), `maximum ${label}`).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
      expect(service.request('w1', 99), `maximum ${label}`).toMatchObject({
        ok: false,
        error: { code: 'BELOW_MINIMUM_PAYOUT' },
      });
      expect(balanceOf('w1'), `maximum ${label}`).toBe(50_000_000);
    }
  });
});
