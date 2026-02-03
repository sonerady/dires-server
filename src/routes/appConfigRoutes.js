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
