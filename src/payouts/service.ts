import { sequentialIds, systemClock, type Clock } from '../clock.js';
import { assertValidPayoutFee, defaultConfig, type Config } from '../config.js';
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
   * Reserves `amount + config.payoutFee` from the wallet and creates a pending payout with the
   * fee stamped on it. The minimum is checked against `amount` alone.
   */
  request(walletId: string, amount: number): Result<Payout, RequestPayoutError>;
  approve(payoutId: string): Result<Payout, UpdatePayoutError>;
  startProcessing(payoutId: string): Result<Payout, UpdatePayoutError>;
  /**
   * Marks the payout as sent and records it in the ledger: a `payout <id>` debit for the amount
   * and, when the payout's fee is non-zero, a separate `payout fee <id>` debit for the fee.
   */
  markPaid(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Marks a processing payout as failed. The reserved funds stay held until it is retried or cancelled. */
  markFailed(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Puts a failed payout back to pending. */
  retry(payoutId: string): Result<Payout, UpdatePayoutError>;
  /** Cancels the payout and returns the reserved `amount + fee` to the wallet. */
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
  assertValidPayoutFee(config.payoutFee);
  const fee = config.payoutFee;
  const clock = deps.clock ?? systemClock;
  const nextId = sequentialIds('po');
  const payouts = new Map<string, Payout>();

  const debit = (payout: Payout, amount: number, description: string): void => {
    const entry = ledger.append({
      account: payout.walletId,
      direction: 'debit',
      amount,
      description,
    });
    if (!entry.ok) {
      throw new Error(`could not record payout ${payout.id}: ${entry.error.message}`);
    }
  };

  const settle = (payout: Payout, to: PayoutStatus): void => {
    if (to === 'cancelled') {
      const refund = wallets.deposit(payout.walletId, payout.amount + payout.fee);
      if (!refund.ok) {
        throw new Error(`could not refund payout ${payout.id}: ${refund.error.message}`);
      }
    }
    if (to === 'paid') {
      debit(payout, payout.amount, `payout ${payout.id}`);
      if (payout.fee > 0) {
        debit(payout, payout.fee, `payout fee ${payout.id}`);
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
      const charge = valid.value + fee;
      if (!Number.isSafeInteger(charge)) {
        return err({
          code: 'INVALID_AMOUNT',
          message: `amount ${String(valid.value)} plus payout fee ${String(fee)} exceeds ${String(Number.MAX_SAFE_INTEGER)}`,
          amount: valid.value,
        });
      }
      const reserved = wallets.withdraw(walletId, charge);
      if (!reserved.ok) {
        return reserved;
      }
      const now = clock();
      const payout: Payout = Object.freeze({
        id: nextId(),
        walletId,
        amount: valid.value,
        fee,
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
