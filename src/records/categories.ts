export const RECORD_CONTEXTS = ['invoice', 'refund', 'adjustment'] as const;

export type RecordContext = (typeof RECORD_CONTEXTS)[number];

/** Categories a record may carry, per context. */
export const ALLOWED_CATEGORIES: Readonly<Record<RecordContext, readonly string[]>> = Object.freeze(
  {
    invoice: Object.freeze(['goods', 'services', 'subscription', 'shipping']),
    refund: Object.freeze(['duplicate', 'fraudulent', 'requested_by_customer', 'not_received']),
    adjustment: Object.freeze(['fee', 'correction', 'chargeback', 'write_off']),
  },
);

export function isRecordContext(value: string): value is RecordContext {
  return (RECORD_CONTEXTS as readonly string[]).includes(value);
}

/** The categories accepted for `context`, in display order. */
export function listAllowedCategories(context: RecordContext): readonly string[] {
  return ALLOWED_CATEGORIES[context];
}
