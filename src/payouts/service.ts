import { sequentialIds, systemClock, type Clock } from '../clock.js';
import { assertPayoutFee, defaultConfig, type Config } from '../config.js';
import {
  err,
  ok,
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
  InvalidAmountError | BelowMinimumPayoutError | WalletNotFoundError | InsufficientFundsError;

export type UpdatePayoutError = PayoutNotFoundError | InvalidTransitionError;

export interface PayoutService {
  /**
   * Holds `amount` plus the configured `payoutFee` from the wallet in one withdrawal and
   * creates a pending payout.
   */
  request(walletId: string, amount: number): Result<Payout, RequestPayoutError>;
  approve(payoutId: string): Result<Payout, UpdatePayoutError>;
  startProcessing(payoutId: string): Result<Payout, UpdatePayoutError>;
  /**
   * Marks the payout as sent and records the amount debit in the ledger, plus a separate
   * fee debit when the payout's fee is above 0.
   */
  markPaid(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Marks a processing payout as failed. The reserved funds stay held until it is retried or cancelled. */
  markFailed(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Puts a failed payout back to pending. */
  retry(payoutId: string): Result<Payout, UpdatePayoutError>;
  /**
   * Cancels the payout and deposits its stored amount plus its stored fee back into its wallet
   * in a single call. No ledger entry is made.
   */
  cancel(payoutId: string): Result<Payout, UpdatePayoutError>;
  get(payoutId: string): Payout | undefined;
  /** Payouts that have not reached a terminal status, oldest first. */
  listOpen(): readonly Payout[];
}

export interface PayoutServiceDeps {
  readonly wallets: WalletStore;
  readonly ledger: Ledger;
  /**
   * Settings; defaults to `defaultConfig`. Construction throws a RangeError when its
   * `payoutFee` is not a non-negative safe integer.
   */
  readonly config?: Config;
  readonly clock?: Clock;
}

export function createPayoutService(deps: PayoutServiceDeps): PayoutService {
  const { wallets, ledger } = deps;
  const config = deps.config ?? defaultConfig;
  const payoutFee = assertPayoutFee(config.payoutFee);
  const clock = deps.clock ?? systemClock;
  const nextId = sequentialIds('po');
  const payouts = new Map<string, Payout>();

  const settle = (payout: Payout, to: PayoutStatus): void => {
    if (to === 'cancelled') {
      const refund = wallets.deposit(payout.walletId, payout.amount + payout.fee);
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
      if (payout.fee > 0) {
        const feeEntry = ledger.append({
          account: payout.walletId,
          direction: 'debit',
          amount: payout.fee,
          description: `payout ${payout.id} fee`,
        });
        if (!feeEntry.ok) {
          throw new Error(`could not record payout ${payout.id} fee: ${feeEntry.error.message}`);
        }
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
      const total = valid.value + payoutFee;
      if (!Number.isSafeInteger(total)) {
        return err({
          code: 'INVALID_AMOUNT',
          message: `amount ${String(valid.value)} plus payout fee ${String(payoutFee)} is not a safe integer number of minor units`,
          amount: valid.value,
        });
      }
      const reserved = wallets.withdraw(walletId, total);
      if (!reserved.ok) {
        return reserved;
      }
      const now = clock();
      const payout: Payout = Object.freeze({
        id: nextId(),
        walletId,
        amount: valid.value,
        fee: payoutFee,
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
