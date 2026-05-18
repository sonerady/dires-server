/**
 * Server-side OneSignal tag sync.
 *
 * Reads canonical subscription state from `users` table (which RevenueCat
 * webhooks keep up-to-date) and pushes it to OneSignal as user-level tags.
 * Replaces the old client-side `OneSignalService.syncTags(...)` flow which
 * required users to open the app for tags to refresh.
 *
 * Marketing campaigns target users via these tags (see
 * oneSignalMarketingScheduler.js). The tags we sync:
 *   - is_pro       "true" / "false"
 *   - is_in_trial  "true" / "false"
 *
 * The user's `language` tag is still set client-side (the only useful
 * source of locale is the device).
 *
 * Endpoint reference (OneSignal User Model v2):
 *   PATCH https://api.onesignal.com/apps/{app_id}/users/by/external_id/{external_id}
 *   body: { properties: { tags: { ... } } }
 *
 * Required env: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY
 */

const { supabaseAdmin, supabase } = require("../supabaseClient");
const db = supabaseAdmin || supabase;

const ONESIGNAL_API_BASE = "https://api.onesignal.com";

function getCreds() {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return null;
  return { appId, apiKey };
}

/**
 * Push tags for a single user to OneSignal.
 * Reads the user's current state from `users` table first.
 * Fire-and-forget safe: errors are logged but never thrown.
 */
async function syncOneSignalTagsFromDb(userId) {
  if (!userId) return { ok: false, reason: "missing_user_id" };
  const creds = getCreds();
  if (!creds) return { ok: false, reason: "missing_credentials" };

  const { data: user, error } = await db
    .from("users")
    .select("id, is_pro, is_in_trial")
    .eq("id", userId)
    .single();
  if (error || !user) {
    console.warn(
      `[OS-SYNC] User lookup failed for ${userId}: ${error?.message || "not found"}`,
    );
    return { ok: false, reason: "user_not_found" };
  }

  return await pushTagsToOneSignal(creds, user.id, {
    is_pro: user.is_pro === true ? "true" : "false",
    is_in_trial: user.is_in_trial === true ? "true" : "false",
  });
}

/**
 * Low-level: send a PATCH to OneSignal User Model with the given tag map.
 * Idempotent — OneSignal merges tag updates server-side.
 */
async function pushTagsToOneSignal(creds, externalId, tags) {
  const url = `${ONESIGNAL_API_BASE}/apps/${creds.appId}/users/by/external_id/${encodeURIComponent(externalId)}`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${creds.apiKey}`,
      },
      body: JSON.stringify({ properties: { tags } }),
      // Don't hang forever if OneSignal stalls — abort after 15s
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      // 404 = user never registered with OneSignal yet (app not opened / push denied).
      // That's expected and safe to ignore.
      if (res.status === 404) {
        return { ok: false, reason: "user_not_in_onesignal", status: 404 };
      }
      const text = await res.text().catch(() => "");
      console.warn(
        `[OS-SYNC] OneSignal PATCH ${res.status} for ${externalId}: ${text.slice(0, 200)}`,
      );
      return { ok: false, status: res.status, error: text.slice(0, 300) };
    }
    return { ok: true };
  } catch (e) {
    console.warn(`[OS-SYNC] fetch error for ${externalId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Bulk sync: iterate all users with non-null subscription state, push tags to
 * OneSignal in batches. Designed for the nightly safety-net cron.
 *
 * Uses a small concurrency window (8) to stay below OneSignal rate limits
 * (~1200 req/min for org-level keys).
 */
async function syncAllUsersToOneSignal({ batchSize = 1000, concurrency = 8 } = {}) {
  const creds = getCreds();
  if (!creds) {
    console.warn("[OS-SYNC-CRON] Missing ONESIGNAL_* env — skipped");
    return { ok: false, reason: "missing_credentials" };
  }

  let processed = 0;
  let updated = 0;
  let missing = 0;
  let failed = 0;
  let cursor = null;
  let batchNum = 0;
  const startedAt = Date.now();

  // First: count total to give meaningful progress percentages
  const { count: totalUsers } = await db
    .from("users")
    .select("id", { count: "estimated", head: true });
  console.log(
    `[OS-SYNC-CRON] Starting — ~${totalUsers ?? "?"} users, batch=${batchSize}, concurrency=${concurrency}`,
  );

  while (true) {
    batchNum++;
    const batchStart = Date.now();

    let query = db
      .from("users")
      .select("id, is_pro, is_in_trial")
      .order("id", { ascending: true })
      .limit(batchSize);
    if (cursor) query = query.gt("id", cursor);

    const { data, error } = await query;
    if (error) {
      console.error(`[OS-SYNC-CRON] DB error: ${JSON.stringify(error)}`);
      break;
    }
    if (!data || data.length === 0) break;

    // Run with concurrency
    let idx = 0;
    async function runner() {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= data.length) return;
        const u = data[myIdx];
        const result = await pushTagsToOneSignal(creds, u.id, {
          is_pro: u.is_pro === true ? "true" : "false",
          is_in_trial: u.is_in_trial === true ? "true" : "false",
        });
        if (result.ok) updated++;
        else if (result.status === 404) missing++;
        else failed++;
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, data.length) }, () => runner()),
    );
    processed += data.length;
    cursor = data[data.length - 1].id;

    const batchSec = ((Date.now() - batchStart) / 1000).toFixed(1);
    const pct = totalUsers ? ((processed / totalUsers) * 100).toFixed(1) : "?";
    console.log(
      `[OS-SYNC-CRON] Batch ${batchNum}: +${data.length} (${batchSec}s) — total processed=${processed} (~${pct}%) | updated=${updated} no-os=${missing} failed=${failed}`,
    );

    if (data.length < batchSize) break;
  }

  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[OS-SYNC-CRON] ✅ Done in ${durationSec}s — processed ${processed}, updated ${updated}, no-onesignal ${missing}, failed ${failed}`,
  );
  return { ok: true, processed, updated, missing, failed, durationSec };
}

module.exports = {
  syncOneSignalTagsFromDb,
  syncAllUsersToOneSignal,
};
