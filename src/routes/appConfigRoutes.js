const express = require("express");
const { supabase } = require("../supabaseClient");

const router = express.Router();

const SUPPORTED_PLATFORMS = new Set(["ios", "android"]);

const normalisePlatform = (platform = "") => {
  const value = platform.toLowerCase();
  if (SUPPORTED_PLATFORMS.has(value)) {
    return value;
  }
  return "ios";
};

const normaliseLanguage = (lang = "") => {
  if (!lang) return "en";
  return lang.toLowerCase();
};

// Video üretim kredi maliyetleri — app_config.metadata.video_credits ile
// uzaktan yönetilir. Anahtarlar: süre saniyeleri ("5"/"8"/"10") + 1080p ek
// ücreti ("hd_surcharge"). Eksik/bozuk değerlerde bu defaultlar geçerli.
const DEFAULT_VIDEO_CREDITS = { 5: 300, 8: 340, 10: 375, hd_surcharge: 60 };

const normaliseVideoCredits = (metadata) => {
  const raw =
    metadata && typeof metadata === "object" ? metadata.video_credits : null;
  const out = { ...DEFAULT_VIDEO_CREDITS };
  if (raw && typeof raw === "object") {
    for (const key of ["5", "8", "10", "hd_surcharge"]) {
      const value = Number(raw[key]);
      if (Number.isFinite(value) && value >= 0) out[key] = value;
    }
  }
  return out;
};

const resolveMessage = (record, lang) => {
  if (!record) return null;

  const fallbackLanguages = [lang, lang.split("-")[0], "en"];

  for (const currentLang of fallbackLanguages) {
    if (!currentLang) continue;
    const key = `message_${currentLang.replace(/-/g, "_")}`;
    if (record[key]) {
      return record[key];
    }
  }

  return record.message || null;
};

const normaliseStoreUrl = (baseUrl, lang) => {
  if (!baseUrl) return null;

  const safeLang = lang || "en";

  // App Store URL'lerinde country kodu ikinci segmentte olur (ör: /tr/)
  try {
    const url = new URL(baseUrl);
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments.length >= 2) {
      segments[1] = safeLang;
      url.pathname = `/${segments.join("/")}`;
      return url.toString();
    }

    return baseUrl;
  } catch (error) {
    const match = baseUrl.match(
      /^(https?:\/\/[^\/]+\/(?:apps\.apple\.com\/)[a-z]{2})(\/.*)$/i
    );
    if (match) {
      const [, prefix, rest] = match;
      return `${prefix.replace(/\/[a-z]{2}$/i, `/${safeLang}`)}${rest}`;
    }
    return baseUrl;
  }
};

router.get("/app-config/version", async (req, res) => {
  try {
    const platform = normalisePlatform(req.query.platform || req.query.os);
    const lang = normaliseLanguage(req.query.lang);
    // Apple login canlıya açılmadan önce yalnız test kullanıcılarında görünsün
    // (app_config.apple_login_enabled global bayrağını ezmeden kullanıcı bazlı istisna)
    const APPLE_LOGIN_TEST_USERS = new Set([
      "38ce6442-3e6c-4cc5-b8c0-bbe1b1b20a23",
      "84536d5e-5f8d-4d0e-aab8-2c14c7956ef1",
    ]);
    const isAppleTestUser = APPLE_LOGIN_TEST_USERS.has(String(req.query.userId || ""));

    const { data, error } = await supabase
      .from("app_config")
      .select("*")
      .eq("platform", platform)
      .order("updated_at", { ascending: false, nullsLast: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("❌ [APP_CONFIG] Query failed:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load app configuration",
      });
    }

    if (!data) {
      // Config bulunamazsa default değerlerle devam et (404 yerine 200)
      console.log(`⚠️ [APP_CONFIG] No config found for platform: ${platform}, using defaults`);
      const defaultPayload = {
        platform,
        minVersion: null,
        latestVersion: null,
        forceUpdate: false,
        updateUrl: platform === "ios"
          ? "https://apps.apple.com/app/id6738030797"
          : "https://play.google.com/store/apps/details?id=com.monalisa.diress.app",
        changelogUrl: null,
        message: null,
        metadata: null,
        googleLoginEnabled: true,
        appleLoginEnabled: true,
        trialEnabled: false,
        trialCredits: 150,
        trialDurationDays: 3,
        paywallPricingVersion: "v1",
        // 🎞️ Editorial mod — config satırı yoksa özellik açık kabul edilir
        editorialModeVisible: true,
        editorialModeDefault: true,
        // Stil önerileri şeridi — varsayılan KAPALI
        styleSuggestionsVisible: false,
        videoCredits: { ...DEFAULT_VIDEO_CREDITS },
        lang,
        fetchedAt: new Date().toISOString(),
      };
      return res.json({ success: true, data: defaultPayload });
    }

    const responsePayload = {
      platform,
      minVersion: data.min_version || null,
      latestVersion: data.latest_version || null,
      forceUpdate: data.force_update === true,
      updateUrl: "https://apps.apple.com/app/id6738030797",
      changelogUrl: data.changelog_url || null,
      message: resolveMessage(data, lang),
      metadata: data.metadata || null,
      websiteOpen: data.website_open || false,
      websiteLaunchDate: data.website_launch_date || null,
      googleLoginEnabled: data.google_login_enabled !== false,
      appleLoginEnabled: isAppleTestUser || data.apple_login_enabled !== false,
      trialEnabled: data.trial_enabled === true,
      trialCredits: Number.isFinite(data.trial_credits) ? data.trial_credits : 150,
      trialDurationDays: Number.isFinite(data.trial_duration_days) ? data.trial_duration_days : 3,
      paywallPricingVersion: data.paywall_pricing_version === "v2" ? "v2" : "v1",
      // 🎞️ Editorial mod — kolon henüz eklenmemişse (undefined) açık kabul et
      editorialModeVisible: data.editorial_mode_visible !== false,
      editorialModeDefault: data.editorial_mode_default !== false,
      // Varsayılan KAPALI: sütun yoksa ya da false ise özellik gizli
      styleSuggestionsVisible: data.style_suggestions_visible === true,
      videoCredits: normaliseVideoCredits(data.metadata),
      lang,
      fetchedAt: new Date().toISOString(),
    };

    return res.json({ success: true, data: responsePayload });
  } catch (error) {
    console.error("❌ [APP_CONFIG] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
