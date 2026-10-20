import { describe, expect, it } from 'vitest';
import {
  balanceOf,
  balancesByAccount,
  netTotal,
  signedAmount,
  type EntryDirection,
  type LedgerEntry,
} from '../../src/ledger/balance.js';

let sequence = 0;
function entry(account: string, direction: EntryDirection, amount: number): LedgerEntry {
  sequence += 1;
  return {
    id: `ent_${String(sequence)}`,
    sequence,
    account,
    direction,
    amount,
    description: '',
    postedAt: new Date('2025-01-01T00:00:00Z'),
  };
}

describe('ledger balances', () => {
  it('signs credits positive and debits negative', () => {
    expect(signedAmount({ direction: 'credit', amount: 70 })).toBe(70);
    expect(signedAmount({ direction: 'debit', amount: 70 })).toBe(-70);
  });

  it('computes credits minus debits for one account', () => {
    const entries = [
      entry('a', 'credit', 1_000),
      entry('a', 'debit', 300),
      entry('a', 'credit', 5),
    ];
    expect(balanceOf(entries, 'a')).toBe(705);
    expect(balanceOf([entry('a', 'credit', 10), entry('a', 'debit', 25)], 'a')).toBe(-15);
  });

  it('ignores other accounts', () => {
    const entries = [entry('a', 'credit', 100), entry('b', 'credit', 900), entry('b', 'debit', 50)];
    expect(balanceOf(entries, 'a')).toBe(100);
    expect(balanceOf(entries, 'b')).toBe(850);
  });

  it('gives 0 for an account with no entries', () => {
    expect(balanceOf([], 'a')).toBe(0);
    expect(balanceOf([entry('b', 'credit', 1)], 'a')).toBe(0);
  });

  it('groups balances by account', () => {
    const entries = [entry('a', 'credit', 100), entry('b', 'debit', 40), entry('a', 'debit', 30)];
    expect(balancesByAccount(entries)).toEqual(
      new Map([
        ['a', 70],
        ['b', -40],
      ]),
    );
  });

  it('nets a balanced transfer to zero', () => {
    const entries = [entry('cash', 'debit', 250), entry('revenue', 'credit', 250)];
    expect(netTotal(entries)).toBe(0);
    expect(netTotal([])).toBe(0);
  });
});
