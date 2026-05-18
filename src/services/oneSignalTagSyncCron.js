/**
 * Nightly OneSignal tag full-resync cron.
 *
 * Webhook-driven syncs (see oneSignalTagSync.js + revenuecatWebhookv2/v3.js)
 * cover the real-time path. This cron is a safety net: it iterates every
 * row in `users` once a day and pushes is_pro / is_in_trial to OneSignal,
 * so any user whose webhook was missed (provider outage, deploy gap, etc.)
 * gets corrected within 24h.
 *
 * Schedule: 04:00 UTC daily (low-traffic window across all timezones).
 *
 * Env: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY required for actual sends.
 *      ONESIGNAL_TAG_SYNC_ENABLED ("true"/"false", default "true") gates the run.
 */

const cron = require("node-cron");
const { syncAllUsersToOneSignal } = require("./oneSignalTagSync");

function startOneSignalTagSyncCron() {
  console.log("⏰ [OS-SYNC-CRON] Daily tag-sync scheduler started (04:00 UTC)");

  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
    console.warn(
      "⚠️ [OS-SYNC-CRON] ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY missing — cron will run but skip sends",
    );
  }

  return cron.schedule(
    "0 4 * * *",
    async () => {
      const enabled = (process.env.ONESIGNAL_TAG_SYNC_ENABLED || "true").toLowerCase();
      if (enabled !== "true") {
        console.log(
          `🟡 [OS-SYNC-CRON] ONESIGNAL_TAG_SYNC_ENABLED != true (currently "${enabled}") — dry-run`,
        );
        return;
      }
      console.log("⏰ [OS-SYNC-CRON] Tetiklendi — full DB → OneSignal sync başlıyor");
      try {
        await syncAllUsersToOneSignal();
      } catch (e) {
        console.error("❌ [OS-SYNC-CRON] Top-level error:", e?.message || e);
      }
    },
    { timezone: "UTC" },
  );
}

// Manual trigger helper for ad-hoc testing:
//   node -e "require('./src/services/oneSignalTagSyncCron').runOnce()"
async function runOnce() {
  console.log("🔥 [OS-SYNC-CRON] Manual runOnce()");
  return await syncAllUsersToOneSignal();
}

module.exports = {
  startOneSignalTagSyncCron,
  runOnce,
};
