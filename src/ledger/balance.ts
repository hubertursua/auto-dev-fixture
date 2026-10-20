export type EntryDirection = 'credit' | 'debit';

export interface LedgerEntry {
  readonly id: string;
  /** Position in the ledger, starting at 1. */
  readonly sequence: number;
  readonly account: string;
  readonly direction: EntryDirection;
  /** Always positive; `direction` gives the sign. */
  readonly amount: number;
  readonly description: string;
  readonly postedAt: Date;
}

/** Signed effect of one entry on its account's balance. */
export function signedAmount(entry: Pick<LedgerEntry, 'direction' | 'amount'>): number {
  return entry.direction === 'credit' ? entry.amount : -entry.amount;
}

/** Credits minus debits for `account`. Accounts with no entries have a balance of 0. */
export function balanceOf(entries: readonly LedgerEntry[], account: string): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.account === account) {
      total += signedAmount(entry);
    }
  }
  return total;
}

/** Balance of every account that appears in `entries`. */
export function balancesByAccount(entries: readonly LedgerEntry[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const entry of entries) {
    balances.set(entry.account, (balances.get(entry.account) ?? 0) + signedAmount(entry));
  }
  return balances;
}

/** Sum of all signed entries. A balanced set of postings totals 0. */
export function netTotal(entries: readonly LedgerEntry[]): number {
  return entries.reduce((total, entry) => total + signedAmount(entry), 0);
}
