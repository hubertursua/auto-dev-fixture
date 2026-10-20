export { ok, err } from './errors.js';
export type {
  Result,
  LibraryError,
  InvalidAmountError,
  InsufficientFundsError,
  WalletNotFoundError,
  WalletExistsError,
  PayoutNotFoundError,
  BelowMinimumPayoutError,
  InvalidTransitionError,
  InvalidDateError,
  InvalidPageError,
} from './errors.js';

export { defaultConfig, withOverrides } from './config.js';
export type { Config } from './config.js';

export { systemClock, sequentialIds } from './clock.js';
export type { Clock } from './clock.js';

export {
  ALLOWED_CATEGORIES,
  RECORD_CONTEXTS,
  isRecordContext,
  listAllowedCategories,
} from './records/categories.js';
export type { RecordContext } from './records/categories.js';
export { createRecordStore } from './records/store.js';
export type {
  Page,
  PageOptions,
  PaymentRecord,
  RecordInput,
  RecordStore,
  RecordStoreOptions,
} from './records/store.js';

export { PAYOUT_STATUSES, canTransition, isTerminal, transition } from './payouts/status.js';
export type { Payout, PayoutStatus } from './payouts/status.js';
export { createPayoutService } from './payouts/service.js';
export type {
  PayoutService,
  PayoutServiceDeps,
  RequestPayoutError,
  UpdatePayoutError,
} from './payouts/service.js';

export { validateAmount } from './validation/amount.js';
export { isExpired, validateExpiry } from './validation/expiry.js';
export type { ExpiryInput, ExpiryWindow } from './validation/expiry.js';

export { createWalletStore } from './wallet/wallet.js';
export type { Wallet, WalletStore } from './wallet/wallet.js';

export { balanceOf, balancesByAccount, netTotal, signedAmount } from './ledger/balance.js';
export type { EntryDirection, LedgerEntry } from './ledger/balance.js';
export { createLedger } from './ledger/ledger.js';
export type { EntryInput, Ledger, LedgerOptions } from './ledger/ledger.js';
