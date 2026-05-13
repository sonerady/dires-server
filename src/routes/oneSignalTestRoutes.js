/**
 * OneSignal Test Routes
 *
 * Test panelinden (onesignal-test.html) çağrılır.
 * - POST /api/onesignal/test-push   → spesifik subscription / external user'a tek push
 * - GET  /api/onesignal/campaigns   → push-campaigns.json içeriği
 * - POST /api/onesignal/run-campaign → cron'u beklemeden bir günün kampanyasını
 *                                       Non-Pro segmentine gönderir (canlı yayın!)
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const {
  runOnce,
  loadCampaigns,
} = require("../services/oneSignalMarketingScheduler");

const router = express.Router();

const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";
// server/marketing/push-campaigns.json — server-içi, Railway deploy'a dahil
const CAMPAIGNS_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "marketing",
  "push-campaigns.json",
);

function getCampaigns() {
  try {
    return JSON.parse(fs.readFileSync(CAMPAIGNS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function findCampaign(campaignId) {
  const data = getCampaigns();
  if (!data?.campaigns) return null;
  return data.campaigns.find((c) => c.id === campaignId) || null;
}

function buildHeadingsAndContents(translations) {
  const headings = {};
  const contents = {};
  for (const [lang, t] of Object.entries(translations || {})) {
    if (!t || typeof t !== "object") continue;
    if (typeof t.title === "string") headings[lang] = t.title;
    if (typeof t.body === "string") contents[lang] = t.body;
  }
  return { headings, contents };
}

/** GET /api/onesignal/campaigns — push-campaigns.json'u döner */
router.get("/campaigns", (_req, res) => {
  const data = getCampaigns();
  if (!data) {
    return res.status(500).json({ error: "Kampanya dosyası okunamadı" });
  }
  res.json(data);
});

/**
 * POST /api/onesignal/test-push
 * Body:
 *   {
 *     subscriptionIds?: string[],         // OneSignal subscription ID listesi
 *     externalIds?:     string[],         // OneSignalService.login() ile set edilen userId'ler
 *     campaignId?:      string,           // push-campaigns.json'daki id ("push_monday_...")
 *     customTitle?:     string,           // campaignId verilmediyse veya override
 *     customBody?:      string,           // ditto
 *     language?:        string,           // tek dil override ("tr" gibi); yoksa OneSignal user'ın language tag'ine bakar
 *     immediate?:       boolean,          // default true → şimdi at
 *     deliveryTimeOfDay?: string,         // "8:00PM" gibi (immediate=false ise)
 *   }
 */
router.post("/test-push", async (req, res) => {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return res.status(500).json({
      error:
        "ONESIGNAL_APP_ID veya ONESIGNAL_REST_API_KEY env'de yok — .env'i kontrol et",
    });
  }

  const {
    subscriptionIds,
    externalIds,
    campaignId,
    customTitle,
    customBody,
    language,
    immediate = true,
    deliveryTimeOfDay,
    // Opsiyonel filter desteği — true ise marketing scheduler ile aynı 3 katmanlı filter
    // uygulanır (is_pro != "true" AND is_in_trial != "true" AND has_ever_subscribed != "true").
    // Bu sayede test-push üzerinden filter mantığının çalışıp çalışmadığını verify edebilirsin:
    //   - Hedef cihaz PRO/trial/eski subscriber ise → push GİTMEZ (filter dışlar)
    //   - Hedef cihaz hiç abone olmamışsa → push gider
    // Default false → eski davranış korunur (direct targeting, filter yok).
    applyMarketingFilters = false,
  } = req.body || {};

  const subs = Array.isArray(subscriptionIds)
    ? subscriptionIds.filter((s) => typeof s === "string" && s.trim())
    : [];
  const exts = Array.isArray(externalIds)
    ? externalIds.filter((s) => typeof s === "string" && s.trim())
    : [];

  if (subs.length === 0 && exts.length === 0) {
    return res
      .status(400)
      .json({ error: "subscriptionIds veya externalIds gerekli (en az 1)" });
  }

  let headings = {};
  let contents = {};

  if (campaignId) {
    const c = findCampaign(campaignId);
    if (!c) {
      return res.status(404).json({ error: `Campaign bulunamadı: ${campaignId}` });
    }
    const built = buildHeadingsAndContents(c.translations);
    headings = built.headings;
    contents = built.contents;
  }

  // Custom override / standalone
  if (customTitle) {
    const lang = (language || "en").toLowerCase();
    headings[lang] = customTitle;
  }
  if (customBody) {
    const lang = (language || "en").toLowerCase();
    contents[lang] = customBody;
  }

  if (!headings.en) headings.en = customTitle || "Diress test";
  if (!contents.en) contents.en = customBody || "Test push from admin panel";

  const body = {
    app_id: appId,
    headings,
    contents,
    data: { type: "admin_test_push", campaign_id: campaignId || null },
  };

  if (subs.length) body.include_subscription_ids = subs;
  if (exts.length) body.include_aliases = { external_id: exts };
  if (exts.length) body.target_channel = "push";

  // Marketing filter desteği — verify mode. Hedeflenen cihazın tag'leri
  // (is_pro, is_in_trial, has_ever_subscribed) marketing kampanya kurallarını
  // sağlamıyorsa OneSignal push'u atmaz. Recipients=0 dönerse "filter doğru
  // çalışıyor, bu cihaz dışlandı" demektir.
  if (applyMarketingFilters) {
    body.filters = [
      { field: "tag", key: "is_pro", relation: "!=", value: "true" },
      { operator: "AND" },
      { field: "tag", key: "is_in_trial", relation: "!=", value: "true" },
      { operator: "AND" },
      { field: "tag", key: "has_ever_subscribed", relation: "!=", value: "true" },
    ];
  }

  if (!immediate) {
    body.delayed_option = "timezone";
    body.delivery_time_of_day = deliveryTimeOfDay || "8:00PM";
  }

  try {
    const r = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.errors) {
      return res.status(r.status || 502).json({
        ok: false,
        status: r.status,
        oneSignalResponse: data,
        request: { include_subscription_ids: subs, include_aliases: exts, headings, contents },
      });
    }
    res.json({
      ok: true,
      oneSignalId: data?.id,
      recipients: data?.recipients,
      external_id: data?.external_id,
      oneSignalResponse: data,
      request: { include_subscription_ids: subs, include_aliases: exts, headings, contents },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/onesignal/run-campaign
 * Body: { dayIndex?: 0..6 } — 0=Sunday … 6=Saturday. Belirsizse bugün.
 *
 * CANLI gönderim — Non-Pro Users segmentinin TAMAMINA gider!
 * Test için subscriptionId'li /test-push tercih edilmeli.
 */
router.post("/run-campaign", async (req, res) => {
  const { dayIndex } = req.body || {};
  const idx =
    typeof dayIndex === "number" && dayIndex >= 0 && dayIndex <= 6
      ? dayIndex
      : undefined;
  try {
    const result = await runOnce(idx);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GET /api/onesignal/health */
router.get("/health", (_req, res) => {
  res.json({
    hasAppId: !!process.env.ONESIGNAL_APP_ID,
    hasApiKey: !!process.env.ONESIGNAL_REST_API_KEY,
    campaignsLoaded: !!loadCampaigns(),
  });
});

module.exports = router;
