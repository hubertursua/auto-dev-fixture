import { describe, expect, it } from 'vitest';
import { isExpired, validateExpiry } from '../../src/validation/expiry.js';

describe('validateExpiry', () => {
  it('parses ISO strings into a window', () => {
    const result = validateExpiry({
      issuedAt: '2025-01-01T00:00:00Z',
      expiresAt: '2025-02-01T00:00:00Z',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        issuedAt: new Date('2025-01-01T00:00:00Z'),
        expiresAt: new Date('2025-02-01T00:00:00Z'),
      },
    });
  });

  it('copies Date inputs rather than keeping references', () => {
    const issuedAt = new Date('2025-01-01T00:00:00Z');
    const result = validateExpiry({ issuedAt, expiresAt: new Date('2025-01-02T00:00:00Z') });
    issuedAt.setUTCFullYear(2030);
    expect(result.ok && result.value.issuedAt.getUTCFullYear()).toBe(2025);
  });

  it('rejects an unparseable date', () => {
    const result = validateExpiry({ issuedAt: '2025-01-01T00:00:00Z', expiresAt: 'next week' });
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_DATE', message: 'invalid date' } });
  });

  it('rejects a window that closes when it opens', () => {
    const at = '2025-01-01T00:00:00Z';
    const result = validateExpiry({ issuedAt: at, expiresAt: at });
    expect(result.ok).toBe(false);
  });

  it('accepts a window one millisecond long', () => {
    const result = validateExpiry({
      issuedAt: '2025-01-01T00:00:00.000Z',
      expiresAt: '2025-01-01T00:00:00.001Z',
    });
    expect(result.ok).toBe(true);
  });
});

describe('isExpired', () => {
  const window = {
    issuedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: new Date('2025-01-31T00:00:00Z'),
  };

  it('is false before the window closes', () => {
    expect(isExpired(window, new Date('2025-01-30T23:59:59.999Z'))).toBe(false);
  });

  it('is true from the moment the window closes', () => {
    expect(isExpired(window, new Date('2025-01-31T00:00:00Z'))).toBe(true);
  });
});
