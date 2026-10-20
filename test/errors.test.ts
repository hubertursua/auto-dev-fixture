import { describe, expect, it } from 'vitest';
import { err, ok } from '../src/errors.js';

describe('Result helpers', () => {
  it('wraps a value in a successful result', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('wraps an error in a failed result', () => {
    const error = { code: 'INVALID_AMOUNT', message: 'bad', amount: 0 };
    expect(err(error)).toEqual({ ok: false, error });
  });
});
