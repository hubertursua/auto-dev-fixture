import {
  err,
  ok,
  type InsufficientFundsError,
  type InvalidAmountError,
  type Result,
  type WalletExistsError,
  type WalletNotFoundError,
} from '../errors.js';
import { validateAmount } from '../validation/amount.js';

export interface Wallet {
  readonly id: string;
  /** Available balance in minor units. Never negative. */
  readonly balance: number;
}

export interface WalletStore {
  open(walletId: string): Result<Wallet, WalletExistsError>;
  get(walletId: string): Result<Wallet, WalletNotFoundError>;
  deposit(
    walletId: string,
    amount: number,
  ): Result<Wallet, InvalidAmountError | WalletNotFoundError>;
  withdraw(
    walletId: string,
    amount: number,
  ): Result<Wallet, InvalidAmountError | WalletNotFoundError | InsufficientFundsError>;
}

function notFound(walletId: string): WalletNotFoundError {
  return { code: 'WALLET_NOT_FOUND', message: `wallet ${walletId} does not exist`, walletId };
}

export function createWalletStore(): WalletStore {
  const balances = new Map<string, number>();

  const snapshot = (id: string, balance: number): Wallet => Object.freeze({ id, balance });

  return {
    open(walletId) {
      if (balances.has(walletId)) {
        return err({
          code: 'WALLET_EXISTS',
          message: `wallet ${walletId} already exists`,
          walletId,
        });
      }
      balances.set(walletId, 0);
      return ok(snapshot(walletId, 0));
    },

    get(walletId) {
      const balance = balances.get(walletId);
      return balance === undefined ? err(notFound(walletId)) : ok(snapshot(walletId, balance));
    },

    deposit(walletId, amount) {
      const valid = validateAmount(amount);
      if (!valid.ok) {
        return valid;
      }
      const balance = balances.get(walletId);
      if (balance === undefined) {
        return err(notFound(walletId));
      }
      const updated = balance + valid.value;
      balances.set(walletId, updated);
      return ok(snapshot(walletId, updated));
    },

    withdraw(walletId, amount) {
      const valid = validateAmount(amount);
      if (!valid.ok) {
        return valid;
      }
      const balance = balances.get(walletId);
      if (balance === undefined) {
        return err(notFound(walletId));
      }
      if (valid.value > balance) {
        return err({
          code: 'INSUFFICIENT_FUNDS',
          message: `wallet ${walletId} has ${String(balance)} available, ${String(valid.value)} requested`,
          available: balance,
          requested: valid.value,
        });
      }
      const updated = balance - valid.value;
      balances.set(walletId, updated);
      return ok(snapshot(walletId, updated));
    },
  };
}
