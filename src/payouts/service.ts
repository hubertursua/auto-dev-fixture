import { sequentialIds, systemClock, type Clock } from '../clock.js';
import { defaultConfig, type Config } from '../config.js';
import {
  err,
  ok,
  type AboveMaximumPayoutError,
  type BelowMinimumPayoutError,
  type InsufficientFundsError,
  type InvalidAmountError,
  type InvalidTransitionError,
  type PayoutNotFoundError,
  type Result,
  type WalletNotFoundError,
} from '../errors.js';
import type { Ledger } from '../ledger/ledger.js';
import { validateAmount } from '../validation/amount.js';
import type { WalletStore } from '../wallet/wallet.js';
import { isTerminal, transition, type Payout, type PayoutStatus } from './status.js';

export type RequestPayoutError =
  | InvalidAmountError
  | BelowMinimumPayoutError
  | AboveMaximumPayoutError
  | WalletNotFoundError
  | InsufficientFundsError;

export type UpdatePayoutError = PayoutNotFoundError | InvalidTransitionError;

export interface PayoutService {
  /** Reserves `amount` from the wallet and creates a pending payout. */
  request(walletId: string, amount: number): Result<Payout, RequestPayoutError>;
  approve(payoutId: string): Result<Payout, UpdatePayoutError>;
  startProcessing(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Marks the payout as sent and records it in the ledger. */
  markPaid(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Marks a processing payout as failed. The reserved funds stay held until it is retried or cancelled. */
  markFailed(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Puts a failed payout back to pending. */
  retry(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Cancels the payout and returns the reserved funds to the wallet. */
  cancel(payoutId: string): Result<Payout, UpdatePayoutError>;
  get(payoutId: string): Payout | undefined;
  /** Payouts that have not reached a terminal status, oldest first. */
  listOpen(): readonly Payout[];
}

export interface PayoutServiceDeps {
  readonly wallets: WalletStore;
  readonly ledger: Ledger;
  readonly config?: Config;
  readonly clock?: Clock;
}

export function createPayoutService(deps: PayoutServiceDeps): PayoutService {
  const { wallets, ledger } = deps;
  const config = deps.config ?? defaultConfig;
  const clock = deps.clock ?? systemClock;
  const nextId = sequentialIds('po');
  const payouts = new Map<string, Payout>();

  const settle = (payout: Payout, to: PayoutStatus): void => {
    if (to === 'cancelled') {
      const refund = wallets.deposit(payout.walletId, payout.amount);
      if (!refund.ok) {
        throw new Error(`could not refund payout ${payout.id}: ${refund.error.message}`);
      }
    }
    if (to === 'paid') {
      const entry = ledger.append({
        account: payout.walletId,
        direction: 'debit',
        amount: payout.amount,
        description: `payout ${payout.id}`,
      });
      if (!entry.ok) {
        throw new Error(`could not record payout ${payout.id}: ${entry.error.message}`);
      }
    }
  };

  const move = (payoutId: string, to: PayoutStatus): Result<Payout, UpdatePayoutError> => {
    const current = payouts.get(payoutId);
    if (current === undefined) {
      return err({
        code: 'PAYOUT_NOT_FOUND',
        message: `payout ${payoutId} does not exist`,
        payoutId,
      });
    }
    const next = transition(current, to);
    if (!next.ok) {
      return next;
    }
    settle(current, to);
    const updated: Payout = Object.freeze({ ...next.value, updatedAt: clock() });
    payouts.set(payoutId, updated);
    return ok(updated);
  };

  return {
    request(walletId, amount) {
      const valid = validateAmount(amount);
      if (!valid.ok) {
        return valid;
      }
      if (valid.value < config.minPayoutAmount) {
        return err({
          code: 'BELOW_MINIMUM_PAYOUT',
          message: `payouts must be at least ${String(config.minPayoutAmount)}, got ${String(valid.value)}`,
          minimum: config.minPayoutAmount,
          requested: valid.value,
        });
      }
      // Fail closed: a NaN or missing maximum refuses every request instead of disabling the cap.
      if (!(valid.value <= config.maxPayoutAmount)) {
        return err({
          code: 'ABOVE_MAXIMUM_PAYOUT',
          message: `payouts must be at most ${String(config.maxPayoutAmount)}, got ${String(valid.value)}`,
          maximum: config.maxPayoutAmount,
          requested: valid.value,
        });
      }
      const reserved = wallets.withdraw(walletId, valid.value);
      if (!reserved.ok) {
        return reserved;
      }
      const now = clock();
      const payout: Payout = Object.freeze({
        id: nextId(),
        walletId,
        amount: valid.value,
        status: 'pending',
        requestedAt: now,
        updatedAt: now,
      });
      payouts.set(payout.id, payout);
      return ok(payout);
    },

    approve: (payoutId) => move(payoutId, 'approved'),
    startProcessing: (payoutId) => move(payoutId, 'processing'),
    markPaid: (payoutId) => move(payoutId, 'paid'),
    markFailed: (payoutId) => move(payoutId, 'failed'),
    retry: (payoutId) => move(payoutId, 'pending'),
    cancel: (payoutId) => move(payoutId, 'cancelled'),

    get(payoutId) {
      return payouts.get(payoutId);
    },

    listOpen() {
      return [...payouts.values()].filter((payout) => !isTerminal(payout.status));
    },
  };
}
