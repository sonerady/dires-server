/**
 * OneSignal ONE-SHOT TEST Scheduler
 *
 * Tek atışlık test cron'u. Belirlenen tarih/saatte (Türkiye saati) tetiklenir,
 * SADECE TEST_SUBSCRIPTION_ID'ye bugünün marketing kampanyasını anında atar,
 * sonra kendini durdurur.
 *
 * Asıl haftalık scheduler (oneSignalMarketingScheduler.js) bağımsız çalışır —
 * bu dosya onunla çakışmaz; sadece test amaçlı.
 *
 * Test bittiğinde app.js'ten satırı kaldır veya bu dosyayı sil.
 */

const cron = require("node-cron");
const {
  loadCampaigns,
  getCampaignForToday,
} = require("./oneSignalMarketingScheduler");

const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";

// === TEST KONFİG ===
const TEST_SUBSCRIPTION_ID = "39e27eb1-67a5-43c1-9bfc-da259e62e14e";
// Cron format: dakika saat gün ay haftaningünü
// "17 1 * * *" → her gün 01:17, timezone: "Europe/Istanbul"
// İlk tetiklemeden sonra task.stop() ile kapanır.
const CRON_EXPR = "17 1 * * *";
const CRON_TIMEZONE = "Europe/Istanbul";
// === / TEST KONFİG ===

let alreadyFired = false;
let task = null;

function buildHeadingsAndContents(translations) {
  const headings = {};
  const contents = {};
  for (const [lang, t] of Object.entries(translations || {})) {
    if (!t || typeof t !== "object") continue;
    if (typeof t.title === "string") headings[lang] = t.title;
    if (typeof t.body === "string") contents[lang] = t.body;
  }
  if (!headings.en) headings.en = "Diress test";
  if (!contents.en) contents.en = "Test from one-shot scheduler";
  return { headings, contents };
}

async function fireTest() {
  if (alreadyFired) return;
  alreadyFired = true;

  const startedAt = new Date().toISOString();
  console.log(
    `🔥 [OS-TEST] Test cron tetiklendi @ ${startedAt} → SubID: ${TEST_SUBSCRIPTION_ID}`,
  );

  if (task) {
    try {
      task.stop();
      console.log("🛑 [OS-TEST] Cron durduruldu (one-shot)");
    } catch (e) {
      console.warn("[OS-TEST] task.stop() error:", e.message);
    }
  }

  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    console.error("❌ [OS-TEST] ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY env'de yok");
    return;
  }

  const data = loadCampaigns();
  if (!data) {
    console.error("❌ [OS-TEST] Campaigns yüklenemedi");
    return;
  }
  const c = getCampaignForToday(data);
  if (!c) {
    console.error("❌ [OS-TEST] Bugün için kampanya bulunamadı");
    return;
  }

  const { headings, contents } = buildHeadingsAndContents(c.translations);

  const body = {
    app_id: appId,
    include_subscription_ids: [TEST_SUBSCRIPTION_ID],
    headings,
    contents,
    data: {
      type: "one_shot_test",
      campaign_id: c.id,
      fired_at: startedAt,
    },
    // ❗ delayed_option YOK → anında teslim (test için)
  };

  try {
    const r = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok || resp?.errors) {
      console.error(
        `❌ [OS-TEST] OneSignal HTTP ${r.status}:`,
        JSON.stringify(resp).slice(0, 500),
      );
      return;
    }
    console.log(
      `✅ [OS-TEST] Push sent → OneSignal id: ${resp?.id} | recipients: ${resp?.recipients} | campaign: ${c.id}`,
    );
  } catch (e) {
    console.error("❌ [OS-TEST] Fetch error:", e.message);
  }
}

function startOneSignalOneShotTestScheduler() {
  console.log(
    `⏰ [OS-TEST] One-shot test scheduler armed → "${CRON_EXPR}" (${CRON_TIMEZONE})`,
  );
  console.log(`⏰ [OS-TEST] Hedef: SubID ${TEST_SUBSCRIPTION_ID} — bugünün kampanyası`);

  // Server'ın o anki Türkiye saatini bilgi amaçlı log'la
  try {
    const trNow = new Date().toLocaleString("tr-TR", {
      timeZone: CRON_TIMEZONE,
      dateStyle: "short",
      timeStyle: "medium",
    });
    console.log(`⏰ [OS-TEST] Şu an (${CRON_TIMEZONE}): ${trNow}`);
  } catch {}

  task = cron.schedule(CRON_EXPR, fireTest, { timezone: CRON_TIMEZONE });
  return task;
}

module.exports = {
  startOneSignalOneShotTestScheduler,
  fireTest,
  TEST_SUBSCRIPTION_ID,
};
