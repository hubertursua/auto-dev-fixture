import { sequentialIds, systemClock, type Clock } from '../clock.js';
import { ok, type InvalidAmountError, type Result } from '../errors.js';
import { validateAmount } from '../validation/amount.js';
import { balanceOf, type EntryDirection, type LedgerEntry } from './balance.js';

export interface EntryInput {
  readonly account: string;
  readonly direction: EntryDirection;
  readonly amount: number;
  readonly description: string;
}

export interface Ledger {
  /** Adds an entry to the end of the ledger. Entries are never changed or removed. */
  append(input: EntryInput): Result<LedgerEntry, InvalidAmountError>;
  /** All entries in posting order, or only those for `account`. */
  entries(account?: string): readonly LedgerEntry[];
  balance(account: string): number;
}

export interface LedgerOptions {
  readonly clock?: Clock;
}

export function createLedger(options: LedgerOptions = {}): Ledger {
  const clock = options.clock ?? systemClock;
  const nextId = sequentialIds('ent');
  const posted: LedgerEntry[] = [];

  return {
    append(input) {
      const amount = validateAmount(input.amount);
      if (!amount.ok) {
        return amount;
      }
      const entry: LedgerEntry = Object.freeze({
        id: nextId(),
        sequence: posted.length + 1,
        account: input.account,
        direction: input.direction,
        amount: amount.value,
        description: input.description,
        postedAt: clock(),
      });
      posted.push(entry);
      return ok(entry);
    },

    entries(account) {
      const selected =
        account === undefined ? posted : posted.filter((entry) => entry.account === account);
      return Object.freeze([...selected]);
    },

    balance(account) {
      return balanceOf(posted, account);
    },
  };
}
