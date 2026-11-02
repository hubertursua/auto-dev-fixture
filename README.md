# payments-core

A small, in-memory TypeScript library for payment primitives: payment records,
wallets, an append-only ledger and payouts. It has no runtime dependencies and
does no I/O; callers own persistence and transport.

## Domain

- **Amounts** are integers in minor units (cents, pence, …). Anything else is
  rejected with `INVALID_AMOUNT`.
- **Errors** are values, not exceptions. Operations return
  `Result<T, E>` (`{ ok: true, value }` or `{ ok: false, error }`), where each
  error has a `code` and a `message`. See `src/errors.ts`.
- **Records** are created in a context: `invoice`, `refund` or `adjustment`.
  Each context has its own set of allowed categories
  (`ALLOWED_CATEGORIES`, `listAllowedCategories(context)`).
  `createRecords` creates a batch all-or-nothing.
- **Wallets** hold an available balance. `withdraw` returns
  `INSUFFICIENT_FUNDS` rather than going negative.
- **Ledger** entries are append-only credits and debits; balances are derived
  from the entries.
- **Payouts** move money out of a wallet. Requesting one reserves the amount;
  cancelling returns it; paying records a debit in the ledger. A request must
  lie between `minPayoutAmount` and `maxPayoutAmount` inclusive (defaults 100
  and 1,000,000 minor units); amounts outside that range are refused with
  `BELOW_MINIMUM_PAYOUT` / `ABOVE_MAXIMUM_PAYOUT` before anything is reserved.
  `maxPayoutAmount` must be a whole number of minor units above zero; with any
  other value (NaN, Infinity, a string, …) every payout request that clears the
  amount and minimum checks is turned down with `ABOVE_MAXIMUM_PAYOUT`.

  | Status       | Can move to                    |
  | ------------ | ------------------------------ |
  | `pending`    | `approved`, `cancelled`        |
  | `approved`   | `processing`, `cancelled`      |
  | `processing` | `paid`, `failed`               |
  | `failed`     | `pending` (retry), `cancelled` |
  | `paid`       | —                              |
  | `cancelled`  | —                              |

  `paid` and `cancelled` are terminal: once a payout reaches either, its status
  never changes again. Disallowed moves return `INVALID_TRANSITION`.

- **Expiry windows** (`validateExpiry`) take an `issuedAt` and an `expiresAt`
  (a `Date` or an ISO 8601 string); `expiresAt` must be after `issuedAt`.
- **Configuration** lives in `src/config.ts`: `defaultConfig` plus
  `withOverrides(partial)`. Stores and services accept a `config` option.

Time and ids are injected (`clock` option, sequential ids), so behaviour is
deterministic in tests.

## Development

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci                # install
npm test              # run the test suite (vitest)
npm run lint          # eslint, zero warnings allowed
npm run typecheck     # tsc --noEmit
npm run format:check  # prettier --check
npm run format        # prettier --write
```

CI runs `lint`, `typecheck`, `format:check` and `test` on every pull request
and on pushes to `main` and `staging`.
