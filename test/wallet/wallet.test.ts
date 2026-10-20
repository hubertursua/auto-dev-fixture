import { beforeEach, describe, expect, it } from 'vitest';
import { createWalletStore, type WalletStore } from '../../src/wallet/wallet.js';

describe('wallet store', () => {
  let wallets: WalletStore;

  beforeEach(() => {
    wallets = createWalletStore();
    wallets.open('w1');
  });

  it('opens a wallet with a zero balance', () => {
    expect(wallets.get('w1')).toEqual({ ok: true, value: { id: 'w1', balance: 0 } });
  });

  it('refuses to open the same wallet twice', () => {
    expect(wallets.open('w1')).toMatchObject({ ok: false, error: { code: 'WALLET_EXISTS' } });
  });

  it('reports a missing wallet', () => {
    expect(wallets.get('nope')).toMatchObject({
      ok: false,
      error: { code: 'WALLET_NOT_FOUND', walletId: 'nope' },
    });
  });

  describe('deposit', () => {
    it('adds to the balance', () => {
      wallets.deposit('w1', 500);
      expect(wallets.deposit('w1', 250)).toEqual({ ok: true, value: { id: 'w1', balance: 750 } });
    });

    it('rejects a non-positive amount and leaves the balance alone', () => {
      wallets.deposit('w1', 100);
      expect(wallets.deposit('w1', 0)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
      expect(wallets.get('w1')).toMatchObject({ value: { balance: 100 } });
    });

    it('rejects a deposit into a missing wallet', () => {
      expect(wallets.deposit('nope', 100)).toMatchObject({
        ok: false,
        error: { code: 'WALLET_NOT_FOUND' },
      });
    });
  });

  describe('withdraw', () => {
    beforeEach(() => {
      wallets.deposit('w1', 1_000);
    });

    it('takes from the balance', () => {
      expect(wallets.withdraw('w1', 400)).toEqual({ ok: true, value: { id: 'w1', balance: 600 } });
    });

    it('rejects an invalid amount or a missing wallet', () => {
      expect(wallets.withdraw('w1', 10.5)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
      expect(wallets.withdraw('nope', 10)).toMatchObject({
        ok: false,
        error: { code: 'WALLET_NOT_FOUND' },
      });
    });

    it('allows withdrawing the whole balance', () => {
      expect(wallets.withdraw('w1', 1_000)).toEqual({ ok: true, value: { id: 'w1', balance: 0 } });
    });

    it('returns INSUFFICIENT_FUNDS one unit over the balance', () => {
      expect(wallets.withdraw('w1', 1_001)).toEqual({
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: 'wallet w1 has 1000 available, 1001 requested',
          available: 1_000,
          requested: 1_001,
        },
      });
      expect(wallets.get('w1')).toMatchObject({ value: { balance: 1_000 } });
    });
  });
});
