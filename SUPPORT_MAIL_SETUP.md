# Diress support mail

## Flow

- Web `/contact` and RN `FeedbackModal` submit to `POST /api/support/send`.
- Forms send only to the configured owner inbox, with a private `agent+<token>@diress.ai` reply address.
- Resend delivers inbound events to `POST https://api.diress.ai/api/support/inbound`.
- Direct mail to `support@diress.ai` opens a conversation and reaches the owner inbox.
- Owner replies must come from the configured owner address, carry a valid aligned DKIM signature covering the full body and From/To/Subject, and address the private conversation token.
- Customer replies are sent as `Diress Support <support@diress.ai>` with a separate `reply+<token>@diress.ai` return address. Only the conversation's customer can use that route.
- Automatic replies and mailing-list messages are ignored. Unknown recipients never become an open relay.

## Provisioned resources

- Resend domain: `diress.ai` (`457da7ea-9dd8-4957-8baa-d1f85ac610c0`). Sending is verified; receiving was enabled during setup.
- Receiving MX: host `@`, priority `10`, target `inbound-smtp.us-east-1.amazonaws.com`, TTL Auto, in Cloudflare DNS.
- Resend webhook: `818ae1e1-0c6a-4aea-a1e2-b58cc2f5235a`, event `email.received`.
- Supabase migration: `supabase/migrations/20260906231957_support_mail_relay.sql`.
- Tables have RLS enabled and access revoked from `anon` and `authenticated`. Only `service_role` can read or write. No client-facing RLS policy is intentional.

DNS receiving must verify before switching users to the new support address. GoDaddy is the registrar; the authoritative nameservers are Cloudflare.

## Server configuration

Existing `RESEND_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are used. The Resend key must have access to received emails and webhooks.

Optional overrides:

- `SUPPORT_OWNER_EMAIL`: owner's personal mailbox (defaults to the previously configured support recipient).
- `RESEND_SUPPORT_WEBHOOK_SECRET`: pin the Resend signing secret. When omitted, the server retrieves the secret for the exact fixed webhook URL using its server-only Resend API key, and caches it for five minutes.
- `SUPPORT_WEBHOOK_URL`: defaults to `https://api.diress.ai/api/support/inbound`.

Do not put secrets in client environment variables, source control, or browser storage.

## Verification

```sh
npm test
node scripts/verify-support-store.js
```

The integration script creates and removes synthetic private rows and does not send email. It checks anonymous access denial and concurrent/repeated event deduplication.

Once DNS and deployment are ready, submit a support request from a controlled customer address, reply from the owner inbox, and reply again from the customer. Check the corporate From address, absence of the private owner address, attachments and threading. This manual test sends real mail and is separate from the automated suite.

## Delivery handling

Resend webhook retries receive HTTP 503 on transient storage/provider failures. The database claims one delivery at a time and persists the exact outbound payload for deterministic retries. Sent payloads are cleared; routing metadata remains private.

Resend's idempotency window is 24 hours. Ambiguous deliveries older than 23 hours move to `review` rather than risking a second email. Investigate those rows and the Resend send log before retrying manually. Inbox messages are plain text with a corporate footer; original private headers and quoted owner addresses are not forwarded. Attachments are supported up to 10 MB total, with a 25 MB raw-message limit. Larger messages remain in Resend for manual handling.
