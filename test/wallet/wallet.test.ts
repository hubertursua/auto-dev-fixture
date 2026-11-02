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
        error: {
          code: 'INVALID_AMOUNT',
          message: 'amount must be a positive integer number of minor units, got 10.5',
        },
      });
      expect(wallets.withdraw('nope', 10)).toMatchObject({
        ok: false,
        error: {
          code: 'WALLET_NOT_FOUND',
          message: 'wallet nope does not exist',
          walletId: 'nope',
        },
      });
    });

    it('reports a non-integer amount above the balance as an invalid amount', () => {
      expect(wallets.withdraw('w1', 1_500.5)).toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_AMOUNT',
          message: 'amount must be a positive integer number of minor units, got 1500.5',
        },
      });
      expect(wallets.get('w1')).toMatchObject({ value: { balance: 1_000 } });
    });

    it('allows withdrawing the whole balance', () => {
      expect(wallets.withdraw('w1', 1_000)).toEqual({ ok: true, value: { id: 'w1', balance: 0 } });
    });

    it('returns INSUFFICIENT_FUNDS one unit over the balance', () => {
      expect(wallets.withdraw('w1', 1_001)).toStrictEqual({
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: 'wallet w1 cannot cover 1001: only 1000 available',
          available: 1_000,
          requested: 1_001,
        },
      });
      expect(wallets.get('w1')).toMatchObject({ value: { balance: 1_000 } });
    });

    it('says the wallet cannot cover the requested amount when withdrawing more than the balance', () => {
      const result = wallets.withdraw('w1', 1_001);
      if (result.ok) throw new Error('expected a failure');
      expect(result.error.message).toBe('wallet w1 cannot cover 1001: only 1000 available');
    });

    it('prints a zero balance as 0 in the cannot-cover message', () => {
      expect(wallets.withdraw('w1', 1_000).ok).toBe(true);
      const result = wallets.withdraw('w1', 5);
      if (result.ok) throw new Error('expected a failure');
      expect(result.error.message).toBe('wallet w1 cannot cover 5: only 0 available');
    });

    it('prints large amounts without separators in the cannot-cover message', () => {
      expect(wallets.deposit('w1', 999_000).ok).toBe(true);
      const result = wallets.withdraw('w1', 1_000_001);
      if (result.ok) throw new Error('expected a failure');
      expect(result.error.message).toBe('wallet w1 cannot cover 1000001: only 1000000 available');
    });

    it('returns exactly the insufficient-funds code, new message, available and requested', () => {
      expect(wallets.withdraw('w1', 1_001)).toStrictEqual({
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: 'wallet w1 cannot cover 1001: only 1000 available',
          available: 1_000,
          requested: 1_001,
        },
      });
    });

    it('keeps the insufficient-funds error to code, message, available and requested only', () => {
      const result = wallets.withdraw('w1', 1_001);
      if (result.ok) throw new Error('expected a failure');
      expect(Object.keys(result.error).sort()).toEqual([
        'available',
        'code',
        'message',
        'requested',
      ]);
      expect(result.error).toMatchObject({
        code: 'INSUFFICIENT_FUNDS',
        available: 1_000,
        requested: 1_001,
      });
    });

    it('lets a withdrawal of exactly the balance succeed and leave zero', () => {
      expect(wallets.withdraw('w1', 1_000)).toEqual({ ok: true, value: { id: 'w1', balance: 0 } });
      expect(wallets.get('w1')).toMatchObject({ value: { balance: 0 } });
    });

    it('still reports a missing wallet as not existing when withdrawing', () => {
      expect(wallets.withdraw('nope', 10)).toMatchObject({
        ok: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'wallet nope does not exist' },
      });
    });

    it('still reports a fractional withdrawal amount as invalid', () => {
      expect(wallets.withdraw('w1', 10.5)).toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_AMOUNT',
          message: 'amount must be a positive integer number of minor units, got 10.5',
        },
      });
    });

    it('reports an amount that is both fractional and over the balance as invalid, not insufficient funds', () => {
      expect(wallets.withdraw('w1', 1_000.5)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
    });

    it('prints a zero balance as 0 and uses the given wallet id', () => {
      wallets.open('empty');
      expect(wallets.withdraw('empty', 5)).toStrictEqual({
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: 'wallet empty cannot cover 5: only 0 available',
          available: 0,
          requested: 5,
        },
      });
    });

    it('prints large amounts as bare digits without swapping them', () => {
      wallets.open('big');
      wallets.deposit('big', 1_000_000);
      expect(wallets.withdraw('big', 1_000_001)).toStrictEqual({
        ok: false,
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: 'wallet big cannot cover 1000001: only 1000000 available',
          available: 1_000_000,
          requested: 1_000_001,
        },
      });
      expect(wallets.get('big')).toMatchObject({ value: { balance: 1_000_000 } });
    });

    it('keeps the INSUFFICIENT_FUNDS error to exactly its four keys', () => {
      const result = wallets.withdraw('w1', 1_001);
      if (result.ok) throw new Error('expected a failure');
      expect(Object.keys(result.error).sort()).toEqual([
        'available',
        'code',
        'message',
        'requested',
      ]);
      expect(result.error.code).toBe('INSUFFICIENT_FUNDS');
    });
  });
});
