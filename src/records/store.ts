import { sequentialIds, systemClock, type Clock } from '../clock.js';
import { defaultConfig, type Config } from '../config.js';
import { err, ok, type InvalidPageError, type Result } from '../errors.js';
import { isRecordContext, type RecordContext } from './categories.js';

export interface RecordInput {
  readonly context: RecordContext;
  readonly category: string;
  /** Amount in minor units. */
  readonly amount: number;
  /** Caller's reference, such as an invoice number. */
  readonly reference: string;
}

export interface PaymentRecord extends RecordInput {
  readonly id: string;
  readonly createdAt: Date;
}

export interface PageOptions {
  /** 1-based page number. Defaults to 1. */
  readonly page?: number;
  /** Defaults to the configured `defaultPageSize`. */
  readonly pageSize?: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface RecordStore {
  createRecord(input: RecordInput): PaymentRecord;
  /** Creates every record or, if any input is invalid, none of them. */
  createRecords(inputs: readonly RecordInput[]): readonly PaymentRecord[];
  get(id: string): PaymentRecord | undefined;
  list(
    context: RecordContext,
    options?: PageOptions,
  ): Result<Page<PaymentRecord>, InvalidPageError>;
}

export interface RecordStoreOptions {
  readonly config?: Config;
  readonly clock?: Clock;
}

function assertComplete(input: RecordInput): void {
  if (typeof input.context !== 'string' || !isRecordContext(input.context)) {
    throw new Error('context is required');
  }
  if (typeof input.category !== 'string' || input.category.trim() === '') {
    throw new Error('category is required');
  }
  if (typeof input.reference !== 'string' || input.reference.trim() === '') {
    throw new Error('reference is required');
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('amount must be a positive integer');
  }
}

export function createRecordStore(options: RecordStoreOptions = {}): RecordStore {
  const config = options.config ?? defaultConfig;
  const clock = options.clock ?? systemClock;
  const nextId = sequentialIds('rec');
  const records = new Map<string, PaymentRecord>();

  const insert = (input: RecordInput): PaymentRecord => {
    const record: PaymentRecord = Object.freeze({
      id: nextId(),
      context: input.context,
      category: input.category,
      amount: input.amount,
      reference: input.reference,
      createdAt: clock(),
    });
    records.set(record.id, record);
    return record;
  };

  return {
    createRecord(input) {
      assertComplete(input);
      return insert(input);
    },

    createRecords(inputs) {
      inputs.forEach(assertComplete);
      return inputs.map(insert);
    },

    get(id) {
      return records.get(id);
    },

    list(context, { page = 1, pageSize = config.defaultPageSize } = {}) {
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > config.maxPageSize
      ) {
        return err({
          code: 'INVALID_PAGE',
          message: `page must be at least 1 and pageSize between 1 and ${String(config.maxPageSize)}`,
          page,
          pageSize,
        });
      }
      const matching = [...records.values()].filter((record) => record.context === context);
      const start = (page - 1) * pageSize;
      return ok({
        items: matching.slice(start, start + pageSize),
        page,
        pageSize,
        total: matching.length,
      });
    },
  };
}
