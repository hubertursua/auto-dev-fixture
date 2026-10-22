import { describe, expect, it } from 'vitest';
import {
  PAYOUT_STATUSES,
  canTransition,
  isTerminal,
  transition,
  type Payout,
  type PayoutStatus,
} from '../../src/payouts/status.js';

const at = new Date('2025-06-01T00:00:00Z');
const payout = (status: PayoutStatus): Payout => ({
  id: 'po_1',
  walletId: 'w1',
  amount: 5_000,
  fee: 0,
  status,
  requestedAt: at,
  updatedAt: at,
});

describe('payout status', () => {
  it('follows the happy path to paid', () => {
    let current = payout('pending');
    for (const next of ['approved', 'processing', 'paid'] as const) {
      const result = transition(current, next);
      expect(result.ok).toBe(true);
      if (result.ok) current = result.value;
    }
    expect(current.status).toBe('paid');
  });

  it('lets a failed payout be retried or cancelled', () => {
    expect(canTransition('processing', 'failed')).toBe(true);
    expect(canTransition('failed', 'pending')).toBe(true);
    expect(canTransition('failed', 'cancelled')).toBe(true);
  });

  it('allows cancelling before processing starts', () => {
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('approved', 'cancelled')).toBe(true);
    expect(canTransition('processing', 'cancelled')).toBe(false);
  });

  it('returns INVALID_TRANSITION when skipping a step', () => {
    expect(transition(payout('pending'), 'paid')).toEqual({
      ok: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: 'cannot move payout po_1 from pending to paid',
        from: 'pending',
        to: 'paid',
      },
    });
  });

  it('does not move a cancelled payout anywhere', () => {
    for (const to of PAYOUT_STATUSES) {
      expect(transition(payout('cancelled'), to).ok).toBe(false);
    }
  });

  it('does not reopen a paid payout', () => {
    expect(canTransition('paid', 'pending')).toBe(false);
    expect(canTransition('paid', 'processing')).toBe(false);
  });

  it('treats paid and cancelled as terminal', () => {
    expect(PAYOUT_STATUSES.filter(isTerminal)).toEqual(['paid', 'cancelled']);
  });

  it('does not modify the payout it is given', () => {
    const original = payout('pending');
    transition(original, 'approved');
    expect(original.status).toBe('pending');
  });

  it('copies the fee onto the moved payout', () => {
    expect(transition({ ...payout('pending'), fee: 75 }, 'approved')).toMatchObject({
      ok: true,
      value: { fee: 75, status: 'approved' },
    });
  });
});
