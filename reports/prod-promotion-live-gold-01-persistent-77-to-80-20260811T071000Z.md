# PROD-PROMOTION-LIVE-GOLD-01 — Persistent 77 → 80

## Gate summary

- Owner authorization: explicit and narrow; target `darfus_erp`, start `77`, exact migrations `78,79,80`, final `80`.
- `AGENTS.md` scoped exception: not separately required; the task itself is the named, exact Owner-authorized exception permitted by the existing rule. No global protection was weakened.
- Persistent business writes outside the approved migration path: `0`.
- Acceptance business fixtures/configuration copied to Persistent: `0`.
- Live Provider activation, production policy, quote/settings rows, GoldAPI, Redis, server/deploy: all `0`/inactive.

## Migration review

| Migration | Effect | Production-safe additive |
|---|---|---|
| `20260810010000-gold-live-feed-foundation.js` | Creates `gold_market_quotes` and `gold_market_settings`, constraints and indexes; no data rows | YES |
| `20260810020000-gold-cgp-pricing-policies.js` | Creates `gold_pricing_policies`, constraints/indexes, inserts one deterministic permission definition with `ON CONFLICT DO NOTHING` | YES |
| `20260810030000-cgp-live-pricing-snapshot-lineage.js` | Adds nullable lineage columns/constraints/indexes to `cgp_pricing_snapshots`; no backfill | YES |

No destructive statements, fixture inserts, business-row updates/deletes, quote/settings/policy rows, or historical CGP repricing were present.

Migration SHA-256:

- 78: `0ED4616DF2B17AAA1CE0DF9510127731FFAB6998EB05116089F873FE59A6B469`
- 79: `028A505D36666FAF6696DF3BD226A5C231857D8B775154948C675D16C8A2A997`
- 80: `AC90CB8D386E0EC51C8772243E3C9E824A39AA96B2C5AF130E117DE09A74D6A0`

## Promotion guard

New dedicated files:

- `backend/scripts/persistent-live-gold-promotion-guard.js`
- `backend/scripts/persistent-live-gold-promotion-migrate.js`
- `backend/scripts/verify-persistent-live-gold-promotion-guard.js`

The guard resolves configuration once, proves `SELECT current_database()` on the same connection, requires migration `77`, zero active non-SELECT sessions, and the exact pending allowlist. It refuses wrong target, missing/unknown target, actual-target mismatch, missing/reordered/extra migration, `DATABASE_URL` ambiguity, and non-development execution. Default mode is dry-run; execution requires `--execute` and `--target persistent` or the exact rehearsal prefix.

`PROMOTION_GUARD_NEGATIVE_TESTS = PASS` (7/7 cases). No raw `npx sequelize-cli db:migrate` was used.

## Backup and rehearsal

Backup #1 (fresh Persistent source):

- Path: `backend/backups/darfus_erp_pre_live_gold_promotion_77_to_80_20260811T070347Z.dump`
- SHA-256: `073D661CBCB4A7DA5A557766695582D46403D0381FF33D844B7647F090DE8EBF`
- `pg_restore --list`: readable, 1143 entries.

Restored to disposable database:
`darfus_erp_live_gold_promotion_01_rehearsal_20260811T070347Z`

The restore matched Persistent before migration for Assets 53, Products 3, Customers 1, CGP documents 2, CGP items 4, Invoices 13, Journals 67, JournalLines 176, CashTransactions 50, and all deterministic row hashes. Exact guarded 77→80 rehearsal passed. After rehearsal:

- migrations `80`; migration 81 absent;
- `gold_market_quotes=0`, `gold_market_settings=0`, `gold_pricing_policies=0`;
- historical CGP/business hashes unchanged;
- duplicate/empty barcodes `0`, unbalanced journals `0`, orphan journal lines `0`, unlinked Treasury `0`;
- pricing-policy permission definition exactly once, roles `0`, users `0`.

The disposable database was dropped only after exact-name/prefix/session checks:
`PROMOTION_REHEARSAL_DB_DROPPED = YES`.

## Final pre-apply and Persistent apply

Immediately before apply, Persistent was rechecked through the same guard: database `darfus_erp`, migrations `77`, active non-SELECT writes `0`, exact pending set, and unchanged migration hashes.

Backup #2 (immediately pre-apply):

- Path: `backend/backups/darfus_erp_final_pre_live_gold_promotion_77_to_80_20260811T070718Z.dump`
- SHA-256: `1F114BBF1EE85A67BB33126C0EA50BAD995FFE542654EFE6EC57B0C480C86293`
- `pg_restore --list`: readable, 1143 entries.

The exact guarded command applied only 78, 79, and 80. No rollback or restore was attempted.

## Post-apply proof

- database `darfus_erp`, migrations `80`;
- 78/79/80 each present exactly once; 81 absent;
- Assets `53 → 53`, Products `3 → 3`, Customers `1 → 1`, CGPs `2 → 2`, Journals `67 → 67`, Treasury/CashTransactions `50 → 50`;
- all pre-existing deterministic hashes unchanged;
- unbalanced journals `0`, orphan journal lines `0`, unlinked Treasury `0`, duplicate barcodes `0`, empty barcodes `0`, orphan Assets `0`;
- `gold_market_quotes=0`, `gold_market_settings=0`, `gold_pricing_policies=0`, `cgp_pricing_snapshots=0`;
- `gold.manage_pricing_policy` definition exactly once, assigned roles `0`, assigned users `0`;
- `CURRENT_CGP_PRICE_AUTHORITY_DEFAULT = MANUAL_APPROVED` (service default); `LIVE_PROVIDER_ACTIVE_IN_PERSISTENT = NO`;
- no production pricing policy, no provider settings, no market quote, no refresh, no GoldAPI, no Redis mutation.

## Regressions and protection

- Live Gold foundation/policy/snapshot contract tests: PASS.
- CGP, accounting, inventory, settlement/reversal, D01/D11, making-charge, and legacy POS compatibility regressions: PASS.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS (inherited CRLF normalization warnings only).
- `next-env.d.ts`: unchanged inherited SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- Server/SSH/deploy/Next dev/commit/push/Redis/global dispatcher: untouched/off.

## Exit gate

`CODE_AND_SCHEMA_PERSISTENT_PROMOTION = PASS`

Live commercial activation remains a separate Owner decision. The production adjustment type/value and optional per-karat overrides were not invented.

`PROD_PROMOTION_LIVE_GOLD_01_GATE = PASS_CONFIRMED`

Next: `PRODUCTION-LIVE-GOLD-CONFIG-01` only after Owner chooses the commercial pricing policy and separately authorizes production runtime secret/configuration. No automatic start.
