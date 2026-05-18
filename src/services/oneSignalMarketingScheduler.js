/**
 * OneSignal Marketing Campaign Scheduler
 *
 * Her gün 08:00 UTC'de o günün marketing campaign'ini (Mon/Tue/.../Sun)
 * OneSignal'a gönderir. OneSignal her kullanıcıya:
 *   - Kendi diline göre (`language` tag — OneSignalService.syncTags ile App.js'te set ediliyor)
 *   - Kendi yerel saat 20:00'sında (`delayed_option: "timezone"` + `delivery_time_of_day: "8:00PM"`)
 *   - Sadece Non-Pro Users segmentine (is_pro != "true")
 *
 * Veri kaynağı: client/marketing/push-campaigns.json (7 gün × 11 dil)
 *
 * Cron neden 08:00 UTC?
 *   OneSignal "deliver at user local 20:00" derken: cron tetiklendikten sonra
 *   her user için bir sonraki yerel 20:00'ı hesaplar. 08:00 UTC en geniş user
 *   penceresinde "bugün" sayılır (Tokyo 17:00 → Monday 20:00; NYC 03:00 →
 *   Monday 20:00; Istanbul 11:00 → Monday 20:00). Yalnızca aşırı doğu
 *   (Sydney UTC+11 19:00) ya da aşırı batı (Hawaii UTC-10) bazen 1 gün
 *   kayabilir — 7 günlük rotasyon kendini düzeltir.
 *
 * Çevre değişkenleri (server/.env):
 *   ONESIGNAL_APP_ID         (OneSignal Dashboard → Settings → Keys & IDs)
 *   ONESIGNAL_REST_API_KEY   (aynı sayfada)
 *   ONESIGNAL_CAMPAIGN_ENABLED  (opsiyonel, "true" değilse cron tetiklense de
 *                                gerçek isteği atmaz — staging/test için)
 *
 * Manuel test:
 *   node -e "require('./src/services/oneSignalMarketingScheduler').runOnce()"
 */

const cron = require("node-cron");
const path = require("path");
const fs = require("fs");

const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";

// server/marketing/push-campaigns.json — server-içi, Railway deploy'a dahil
const CAMPAIGNS_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "marketing",
  "push-campaigns.json",
);

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function loadCampaigns() {
  try {
    const raw = fs.readFileSync(CAMPAIGNS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.campaigns || !Array.isArray(parsed.campaigns)) {
      throw new Error("Invalid campaigns file structure (campaigns array missing)");
    }
    return parsed;
  } catch (e) {
    console.error(`❌ [OS-MKT] Campaigns yüklenemedi (${CAMPAIGNS_PATH}):`, e.message);
    return null;
  }
}

function getCampaignForToday(parsed, dayOverride) {
  const dayIdx = dayOverride != null ? dayOverride : new Date().getUTCDay();
  const name = WEEKDAY_NAMES[dayIdx];
  return parsed.campaigns.find((c) => c.weekday === name);
}

function buildHeadingsAndContents(translations) {
  const headings = {};
  const contents = {};
  for (const [lang, t] of Object.entries(translations || {})) {
    if (!t || typeof t !== "object") continue;
    if (typeof t.title === "string") headings[lang] = t.title;
    if (typeof t.body === "string") contents[lang] = t.body;
  }
  if (!headings.en || !contents.en) {
    throw new Error("Campaign translations missing 'en' (OneSignal default language)");
  }
  return { headings, contents };
}

async function sendCampaign(campaign) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    console.error(
      "❌ [OS-MKT] ONESIGNAL_APP_ID veya ONESIGNAL_REST_API_KEY env'de yok — istek atılmadı",
    );
    return { skipped: "missing_credentials" };
  }

  const enabled = (process.env.ONESIGNAL_CAMPAIGN_ENABLED || "true").toLowerCase();
  if (enabled !== "true") {
    console.log(
      `🟡 [OS-MKT] ONESIGNAL_CAMPAIGN_ENABLED != true (currently "${enabled}") — dry-run, OneSignal'a gönderilmedi`,
    );
    return { skipped: "disabled" };
  }

  const { headings, contents } = buildHeadingsAndContents(campaign.translations);

  // Filter-based targeting: dashboard segment'ine bağımlı olmayız, tüm hedefleme
  // burada explicit. Marketing push'lar şu kitleye gider:
  //   - is_pro != "true"       → aktif PRO değil
  //   - is_in_trial != "true"  → şu an trial dönemindeki kullanıcı değil
  // (Trial başlatıp iptal etmiş veya eski PRO olan kullanıcılar dahil — onlara
  //  da retention amaçlı push gitsin.)
  // Bu iki tag SERVER tarafından (RC webhook + nightly cron) güncellenir,
  // see services/oneSignalTagSync.js.
  const body = {
    app_id: appId,
    filters: [
      { field: "tag", key: "is_pro", relation: "!=", value: "true" },
      { operator: "AND" },
      { field: "tag", key: "is_in_trial", relation: "!=", value: "true" },
    ],
    headings,
    contents,
    delayed_option: "timezone",
    delivery_time_of_day: "8:00PM", // her user'ın local 20:00
    data: { campaign_id: campaign.id, type: "marketing_weekly" },
  };

  try {
    const res = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.errors) {
      console.error(
        `❌ [OS-MKT] OneSignal HTTP ${res.status}:`,
        JSON.stringify(data).slice(0, 600),
      );
      return { ok: false, status: res.status, data };
    }

    console.log(
      `✅ [OS-MKT] Sent: ${campaign.id} | OneSignal id: ${data?.id} | recipients: ${data?.recipients ?? "?"} | langs: ${Object.keys(headings).join(",")}`,
    );
    return { ok: true, oneSignalId: data?.id, recipients: data?.recipients };
  } catch (e) {
    console.error("❌ [OS-MKT] Fetch error:", e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Cron'u başlat. Mevcut process boyunca her gün 08:00 UTC'de tetiklenir.
 */
function startOneSignalMarketingScheduler() {
  console.log("⏰ [OS-MKT] OneSignal marketing scheduler başlatıldı (her gün 08:00 UTC)");

  // Pre-flight: kampanyalar yüklenebiliyor mu?
  const parsed = loadCampaigns();
  if (!parsed) {
    console.error("❌ [OS-MKT] Kampanyalar yüklenemedi — scheduler başlamadı");
    return null;
  }
  console.log(`📚 [OS-MKT] ${parsed.campaigns.length} campaign yüklendi`);

  // Pre-flight: env değişkenleri var mı?
  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
    console.warn(
      "⚠️ [OS-MKT] ONESIGNAL_APP_ID veya ONESIGNAL_REST_API_KEY .env'de yok — cron çalışacak ama istekler atılamayacak",
    );
  }

  const task = cron.schedule(
    "0 8 * * *",
    async () => {
      console.log("⏰ [OS-MKT] Tetiklendi");
      const campaigns = loadCampaigns();
      if (!campaigns) return;
      const today = getCampaignForToday(campaigns);
      if (!today) {
        console.warn(
          `⚠️ [OS-MKT] Bugün (${WEEKDAY_NAMES[new Date().getUTCDay()]}) için kampanya yok`,
        );
        return;
      }
      await sendCampaign(today);
    },
    { timezone: "UTC" },
  );

  return task;
}

/**
 * Manuel test fonksiyonu — cron'u beklemeden bir kez tetikler.
 * `dayIndex` 0=Sunday … 6=Saturday. Verilmezse bugün.
 */
async function runOnce(dayIndex) {
  console.log("🔧 [OS-MKT] runOnce çağrıldı");
  const campaigns = loadCampaigns();
  if (!campaigns) return { ok: false, error: "campaigns_load_failed" };
  const c = getCampaignForToday(campaigns, dayIndex);
  if (!c) {
    return {
      ok: false,
      error: `no_campaign_for_${WEEKDAY_NAMES[dayIndex ?? new Date().getUTCDay()]}`,
    };
  }
  return await sendCampaign(c);
}

module.exports = {
  startOneSignalMarketingScheduler,
  runOnce,
  loadCampaigns,
  getCampaignForToday,
  sendCampaign,
};
