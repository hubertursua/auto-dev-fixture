import { describe, expect, it } from 'vitest';
import { createLedger } from '../../src/ledger/ledger.js';

const postedAt = new Date('2025-03-01T12:00:00Z');
const clock = () => postedAt;

describe('ledger', () => {
  it('appends entries with an id, sequence and posting time', () => {
    const ledger = createLedger({ clock });
    ledger.append({ account: 'a', direction: 'credit', amount: 100, description: 'top up' });
    const second = ledger.append({
      account: 'a',
      direction: 'debit',
      amount: 40,
      description: 'fee',
    });
    expect(second).toEqual({
      ok: true,
      value: {
        id: 'ent_2',
        sequence: 2,
        account: 'a',
        direction: 'debit',
        amount: 40,
        description: 'fee',
        postedAt,
      },
    });
  });

  it('rejects an invalid amount without appending', () => {
    const ledger = createLedger({ clock });
    const result = ledger.append({
      account: 'a',
      direction: 'credit',
      amount: -1,
      description: '',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(ledger.entries()).toHaveLength(0);
  });

  it('filters entries by account in posting order', () => {
    const ledger = createLedger({ clock });
    ledger.append({ account: 'a', direction: 'credit', amount: 1, description: 'first' });
    ledger.append({ account: 'b', direction: 'credit', amount: 2, description: 'other' });
    ledger.append({ account: 'a', direction: 'credit', amount: 3, description: 'second' });
    expect(ledger.entries('a').map((e) => e.description)).toEqual(['first', 'second']);
    expect(ledger.entries()).toHaveLength(3);
  });

  it('does not let callers change posted entries', () => {
    const ledger = createLedger({ clock });
    ledger.append({ account: 'a', direction: 'credit', amount: 10, description: '' });
    const entries = ledger.entries();
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(() => (entries as unknown[]).push({})).toThrow(TypeError);
    expect(ledger.entries()).toHaveLength(1);
  });

  it('reports the balance from its entries', () => {
    const ledger = createLedger({ clock });
    ledger.append({ account: 'a', direction: 'credit', amount: 500, description: '' });
    ledger.append({ account: 'a', direction: 'debit', amount: 120, description: '' });
    expect(ledger.balance('a')).toBe(380);
    expect(ledger.balance('b')).toBe(0);
  });
});
