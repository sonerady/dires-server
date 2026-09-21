# Credit refund review

Implemented on the new-features client branch `expo54-liquid-glass`. The emergency Android release worktree is unchanged.

## Flow

- Initial review requires no reason or category; AI independently compares the original and result. Only after rejection can the user write an appeal.
- A verified Supabase session, existing anonymous-device identity, or enrolled device credential must match the account. An account UUID alone is insufficient. Legacy native device identifiers remain the app's existing identity mechanism; this feature does not implement a new device-attestation system.
- Fal `openrouter/router/vision` calls `google/gemini-3.8-flash` with original images first and generated result last. Reasoning must be enabled for this model. Inputs are data URIs, not newly public storage uploads.
- Severe corroborated failures can receive a full refund; uncertain/contradictory/provider-error cases go to manual review. Personal preference is insufficient. The model's verdict alone cannot issue credit.
- Automatic settlement trusts only `credit_refund_charges`: server-only snapshots of a successful debit, payer, amount and comparison images. Existing generations without this proof require manual approval for a refund, with explicit verification of the charged account.
- Claiming serializes per user to enforce the daily cap. Row/generation aliases resolve to one request. Refund decision and balance update commit in the same database transaction; repeated approvals do not add credits.
- Rejected requests may submit one 20–2000-character appeal. `/credit-refunds` in the admin dashboard exposes evidence, reasons, appeals, decisions and notification state.
- Manual approval queues a targeted OneSignal notification using the request UUID as the idempotency key. Delivery failures do not undo refunds; the worker retries with backoff (up to eight attempts), and admin can retry. The dashboard distinguishes provider acceptance from device delivery.
- Interrupted analyses older than three minutes recover into manual review. Requests are never deleted after an ambiguous credit-update failure.

## Time policy

New refund claims are accepted only within 24 hours of the protected charge timestamp (generation timestamp for legacy records). Older generations cannot start a claim. Timely claims retain review and appeal access after the deadline. Both API eligibility and the database enforce the 24-hour maximum; the daily limit remains 3 reviews per rolling 24 hours.

## Deployment

Database migrations `20260917080505` through `20260917084341` were applied. Backend, admin and client changes have NOT been pushed or deployed. Deploy the backend before shipping the updated client; new generations gain server-recorded charge evidence after backend deployment. No customer credit was changed during testing.

## Verification (2026-09-17)

- 20 Node tests passed: strict decisions/parsing, provider payload, account ownership, immutable debit evidence, notification targeting/idempotency/failure.
- PostgreSQL transactions, rolled back: duplicate claims, duplicate payouts, appeal persistence and single submission, manual approval, unknown payer guard, daily limit, client RPC/ledger grants, forged amount/image protection, notification outbox.
- Real Fal/Gemini calls with synthetic images: rejected the false replacement allegation; independently identified the genuinely different product. The latter returned confidence 0.82; automatic acceptance requires both shape/category evidence and a verified allegation at that confidence. Other severe failures retain the 0.85 gate.
- Admin TypeScript/Vite build passed. Large bundle warning predates this feature.
- Browser-isolated form/rejection/appeal/pending flow checked at desktop and 430px mobile widths; no production refund requests sent.
- RN phone/tablet/Mac and web JSX parsed. Simulator switched to the new-feature home screen, but native refund UI verification was blocked by the app's maintenance screen. Global maintenance settings were not changed.
- Security advisor: refund tables intentionally have RLS with no client policies and service-role-only permissions. Broader pre-existing public-table policies are outside this change.

## Repeatable local development review

RN `__DEV__` and Next development builds use `/api/credit-refund/dev/*`. The server requires both `NODE_ENV=development` and `CREDIT_REFUND_DEV_PREVIEW=1`; Railway/Vercel deployments are rejected. These settings are enabled only in the ignored local server `.env` and require a server restart. Identity checks and the request rate limiter still apply. Production never falls back to this route or vice versa.

Each opening starts fresh; each submission makes a real Fal/Gemini vision call (provider usage still applies). The preview ignores generation age, daily claim quota and previous claims to allow repeat testing. It reads the owned generation but cannot write credits, refund/appeal records or send notifications. Temporary appeal state expires after 30 minutes or server restart. Close and reopen the review sheet to restart, including after simulated approval or appeal. Release builds retain the real 24-hour policy, duplicate prevention and persisted appeals.
