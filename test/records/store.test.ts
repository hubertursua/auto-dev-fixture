import { describe, expect, it } from 'vitest';
import { withOverrides } from '../../src/config.js';
import {
  ALLOWED_CATEGORIES,
  RECORD_CONTEXTS,
  isRecordContext,
  listAllowedCategories,
} from '../../src/records/categories.js';
import { createRecordStore, type RecordInput } from '../../src/records/store.js';

const createdAt = new Date('2025-05-01T09:30:00Z');
const clock = () => createdAt;

const invoice: RecordInput = {
  context: 'invoice',
  category: 'services',
  amount: 12_500,
  reference: 'INV-1001',
};

describe('record categories', () => {
  it('lists the categories for each context', () => {
    expect(listAllowedCategories('invoice')).toEqual([
      'goods',
      'services',
      'subscription',
      'shipping',
    ]);
    expect(listAllowedCategories('refund')).toContain('duplicate');
    expect(listAllowedCategories('adjustment')).toContain('write_off');
  });

  it('declares categories for every context', () => {
    for (const context of RECORD_CONTEXTS) {
      expect(ALLOWED_CATEGORIES[context].length).toBeGreaterThan(0);
    }
  });

  it('recognises known contexts only', () => {
    expect(isRecordContext('refund')).toBe(true);
    expect(isRecordContext('Refund')).toBe(false);
    expect(isRecordContext('payout')).toBe(false);
  });
});

describe('createRecord', () => {
  it('stores the record with an id and creation time', () => {
    const store = createRecordStore({ clock });
    const record = store.createRecord(invoice);
    expect(record).toEqual({ ...invoice, id: 'rec_1', createdAt });
    expect(store.get('rec_1')).toBe(record);
    expect(store.createRecord(invoice).id).toBe('rec_2');
  });

  it.each([
    ['category', { category: '' }, 'category is required'],
    ['reference', { reference: '  ' }, 'reference is required'],
    ['amount', { amount: 0 }, 'amount must be a positive integer'],
  ])('throws when %s is missing or invalid', (_field, change, message) => {
    const store = createRecordStore({ clock });
    expect(() => store.createRecord({ ...invoice, ...change })).toThrow(message);
    expect(store.get('rec_1')).toBeUndefined();
  });

  it('throws for an unknown context', () => {
    const store = createRecordStore({ clock });
    const input = { ...invoice, context: 'payout' } as unknown as RecordInput;
    expect(() => store.createRecord(input)).toThrow('context is required');
  });
});

describe('createRecords', () => {
  it('creates every record in order', () => {
    const store = createRecordStore({ clock });
    const refund: RecordInput = {
      context: 'refund',
      category: 'duplicate',
      amount: 900,
      reference: 'RF-7',
    };
    const records = store.createRecords([invoice, refund]);
    expect(records.map((r) => [r.id, r.reference])).toEqual([
      ['rec_1', 'INV-1001'],
      ['rec_2', 'RF-7'],
    ]);
  });

  it('creates nothing when one input is incomplete', () => {
    const store = createRecordStore({ clock });
    expect(() => store.createRecords([invoice, { ...invoice, reference: '' }])).toThrow();
    expect(store.list('invoice')).toMatchObject({ ok: true, value: { total: 0 } });
  });
});

describe('list', () => {
  const seeded = (count: number, config = withOverrides()) => {
    const store = createRecordStore({ clock, config });
    store.createRecords(
      Array.from({ length: count }, (_, i) => ({ ...invoice, reference: `INV-${String(i + 1)}` })),
    );
    store.createRecord({ context: 'adjustment', category: 'fee', amount: 50, reference: 'ADJ-1' });
    return store;
  };

  it('uses the configured default page size', () => {
    const store = seeded(7, withOverrides({ defaultPageSize: 3 }));
    const result = store.list('invoice');
    expect(result).toMatchObject({ ok: true, value: { page: 1, pageSize: 3, total: 7 } });
    expect(result.ok && result.value.items.map((r) => r.reference)).toEqual([
      'INV-1',
      'INV-2',
      'INV-3',
    ]);
  });

  it('returns a partial last page', () => {
    const store = seeded(7);
    const result = store.list('invoice', { page: 3, pageSize: 3 });
    expect(result.ok && result.value.items.map((r) => r.reference)).toEqual(['INV-7']);
  });

  it('only lists records from the requested context', () => {
    const store = seeded(2);
    expect(store.list('adjustment')).toMatchObject({ ok: true, value: { total: 1 } });
  });

  it('accepts the maximum page size and rejects one more or page 0', () => {
    const store = seeded(1, withOverrides({ maxPageSize: 10 }));
    expect(store.list('invoice', { pageSize: 10 }).ok).toBe(true);
    expect(store.list('invoice', { pageSize: 11 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAGE', pageSize: 11 },
    });
    expect(store.list('invoice', { page: 0 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAGE', page: 0 },
    });
  });
});
