# New-install acquisition notifications

This replaces the retired non-Pro broadcast. It never targets lapsed, cancelled,
refunded or former trial users. No historical users are backfilled into the audience.

## Eligibility and delivery

- A new iOS/Android install receives an unguessable enrollment credential only
  when the updated client creates a new application user. Only its hash is stored.
- Onboarding must be complete, OS notifications allowed and the in-app reminder
  switch on. First message waits 24 hours; an app visit pauses sends for four hours.
- Seven weekday messages rotate weekly, in the app language (70 languages).
  Missing translations or timezones are skipped instead of guessed.
- Worker checks every minute and submits immediately at 20:00–20:14 **device local
  time**. IANA timezone rules handle DST and half-hour offsets. 20:00 is an initial
  product choice, not a claim of universally optimal engagement time.
- The unique user/local-date ledger, per-user transactional claim lock and 23-hour
  cap prevent repeats across replicas/restarts/timezone changes. All provider
  retries use the stored UUID as the OneSignal idempotency key.
- Notifications expire after 15 minutes. No all-day timezone queue or stale
  next-day messages. Delivery still depends on OS/network/Focus settings.
- Immediately before submission: database history, fresh RevenueCat history,
  current enrollment and actual OneSignal subscription/identity must all pass.
  A database/provider error always prevents sending.
- Purchase/trial flags, *any* purchase_history/user_purchase entry, account merges,
  shared devices, associated email/auth identities, team membership and owner
  accounts exclude the user. Database triggers keep permanent exclusions and
  identity tombstones. Expiry/refund/deletion does not make the user eligible again.
- Client RevenueCat purchase-history events can only suppress; they cannot grant
  eligibility. Store history protects the interval before a webhook arrives.
- After OneSignal has accepted a push, no system can reliably recall a notification
  already delivered to the OS. Purchase decisions are checked before submission;
  store/webhook propagation latency is not falsely described as an atomic guarantee.
- Tapping opens the existing plans flow only if still eligible. Existing/paid users
  open Home. Generation-ready Expo notifications are separate.

## Configuration

`ONESIGNAL_APP_ID` and the matching `ONESIGNAL_REST_API_KEY` identify the same
OneSignal app as the native build. The server key is never bundled into the app.
`REVENUECAT_SECRET_API_KEY` (preferred) or existing `REVENUECAT_API_KEY` is required
for the last-minute history check. Do not send X-Platform on informational reads.

Two independent gates are required to run: `ACQUISITION_PUSH_WORKER_ENABLED=true`
on the production worker and `acquisition_push_settings.enabled=true` in the DB.
The old `ONESIGNAL_CAMPAIGN_ENABLED` flag cannot activate the new worker.
Local development leaves the worker disabled. Apply both migrations before deploy.

`node scripts/acquisition-push.js dry-run` sends nothing.
`node scripts/acquisition-push.js inspect SUBSCRIPTION_ID` reads one device.
For an owner-authorized physical-device diagnostic, set
`ACQUISITION_PUSH_TEST_SUBSCRIPTION_ID` to that **verified** device, then run
`node scripts/acquisition-push.js test SUBSCRIPTION_ID tr`. Test notifications are
explicitly labelled, never enroll a paying account and never bypass production
eligibility. The most recent test's idempotency key is saved locally for diagnosis.

## Native release

Changing the OneSignal app ID requires a new native JS bundle/build. Existing App
Store installs do not adopt source changes until an actual compatible update.
Apple APNs (.p8, team/key IDs, bundle ID) and Android FCM v1 credentials must be
configured for the selected OneSignal app. OneSignal also supports iOS 16.2+
simulators for push testing; verify foreground, background and tap on a physical
iPhone before release. Android delivery needs a real Android/Play-enabled emulator.
See https://documentation.onesignal.com/docs/en/ios-sdk-setup.

## Verification

`node --test tests/acquisitionPush.test.js` covers local timing, localization,
opt-out, onboarding delay, recent activity, history exclusions, purchase races,
timeouts/idempotent retries and safe dry runs. The SQL transaction test additionally
checks real triggers, expired trial exclusion, same-device accounts and deletion.
All campaign tables have RLS, no client grants and only service-role access.
The client's `node --test tests/OneSignalService.test.cjs` covers both mobile
platforms, account changes, historical purchases, failed refreshes and notification
taps arriving during an in-flight purchase check. A failed check opens Home.

### Local verification, 2026-09-07

- Server suite: 154 passing tests. Native notification service: 9 passing tests.
- Correct OneSignal app: `07fe2ee9-1876-4804-9d0b-5c45546258f5`.
- Actual remote diagnostic sent from the local server to the iOS 26.4 iPhone
  simulator with the app terminated. OneSignal reported one successful APNs
  submission, zero failures; the simulator's notification service extension and
  notification-center logs recorded receipt. The owner confirmed seeing it.
- Diagnostic notification ID: `81a9143e-fc2f-4958-9068-a6534c00e941`.
- Stale Metro environment/cache initially used the previous OneSignal app ID.
  Restarting Metro with the correct environment and a cleared cache resolved it.
- Android 15 / API 35 Google Play emulator: a fresh isolated AVD
  (`Diress_Push_Test_API_35`) received the actual remote diagnostic while the app
  was in the background. The notification panel visibly showed the Turkish test
  message. Tapping opened the app, then `PaywallV3Screen` for the eligible new
  installation; OneSignal recorded one successful submission, zero failures and
  one click. Its `received` metric remained zero despite visual receipt, so that
  metric alone is not used as delivery evidence.
- Android subscription: `df72b4af-e9c3-45e7-87e0-229d73abf171`; diagnostic notification:
  `da9357ae-24c0-4799-b4e6-bd7dba3bfb27`. The actual Android permission dialog was
  accepted. Calling the app's reminder preference service with `false` changed
  the provider subscription to disabled; the preference was subsequently restored.
- Android used the existing 1.7.6 / build 104 development APK with current JS from
  local Metro, not a newly built store release. The earlier existing AVD accepted
  FCM submission but did not visibly receive it; its data was preserved and the
  successful test used a separate clean AVD. That earlier failure's cause is not
  established. A duplicate development-client deep link also caused an Expo
  launcher context error during setup; normal launch recovered, and notification
  tap was verified separately. Production release-build testing remains needed.
- Physical iPhone development app installed, but launch was blocked by its screen
  lock. Physical iPhone delivery/tap and physical Android testing remain to verify.
- No Railway deployment or campaign activation was performed. Both live-send
  gates remain off; the diagnostic targeted only the verified simulator.
