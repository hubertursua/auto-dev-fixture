import { err, ok, type InvalidTransitionError, type Result } from '../errors.js';

export const PAYOUT_STATUSES = [
  'pending',
  'approved',
  'processing',
  'paid',
  'failed',
  'cancelled',
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export interface Payout {
  readonly id: string;
  readonly walletId: string;
  /** Amount in minor units. */
  readonly amount: number;
  readonly status: PayoutStatus;
  readonly requestedAt: Date;
  readonly updatedAt: Date;
}

/** For each status, the statuses a payout may move to next. */
const NEXT_STATUSES: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
  pending: ['approved', 'cancelled'],
  approved: ['processing', 'cancelled'],
  processing: ['paid', 'failed'],
  paid: ['cancelled'],
  failed: ['pending', 'cancelled'],
  cancelled: [],
};

const TERMINAL_STATUSES: readonly PayoutStatus[] = ['paid', 'cancelled'];

export function isTerminal(status: PayoutStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: PayoutStatus, to: PayoutStatus): boolean {
  return NEXT_STATUSES[from].includes(to);
}

/** Returns a copy of `payout` in status `to`, or an error if the move is not allowed. */
export function transition(
  payout: Payout,
  to: PayoutStatus,
): Result<Payout, InvalidTransitionError> {
  if (!canTransition(payout.status, to)) {
    return err({
      code: 'INVALID_TRANSITION',
      message: `cannot move payout ${payout.id} from ${payout.status} to ${to}`,
      from: payout.status,
      to,
    });
  }
  return ok({ ...payout, status: to });
}
