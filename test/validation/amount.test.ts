import { describe, expect, it } from 'vitest';
import { validateAmount } from '../../src/validation/amount.js';

describe('validateAmount', () => {
  it('accepts positive safe integers up to the largest one', () => {
    expect(validateAmount(1)).toEqual({ ok: true, value: 1 });
    expect(validateAmount(Number.MAX_SAFE_INTEGER)).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
  });

  it('rejects zero, negatives, fractions and unsafe integers', () => {
    for (const amount of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateAmount(amount)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT', amount },
      });
    }
  });
});
