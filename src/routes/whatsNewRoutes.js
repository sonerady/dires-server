const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { decideWhatsNew } = require("../utils/whatsNew");

/**
 * "Yenilikler" sayfa-modalı — app_config.whats_new_* ile uzaktan yönetilir.
 *
 * GET /api/whats-new/config
 *   client=ios|android|desktop|web  (desktop = Mac shell; app_config satırı olarak ios kullanılır)
 *   lang=tr                          (HTML dili; fallback: ana dil → default → en)
 *   appVersion=1.7.8                 (web'de yok)
 *   previousAppVersion=1.7.6         (istemcinin sakladığı bir önceki sürüm; audience=updated için)
 *   seenVersion=1.7.7                (istemcinin en son gördüğü whats_new_version)
 *
 * Yanıt: { success, show, reason, data: { version, audience, dismissible, title, html, lang, rtl } | null }
 * Sunucu 60 sn önbellekler; kolon değişince deploy gerekmez.
 */
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // platform → { at, row }

const CLIENT_TO_PLATFORM_ROW = { ios: "ios", android: "android", desktop: "ios", web: "ios" };
const WHATS_NEW_COLUMNS =
  "platform, whats_new_enabled, whats_new_version, whats_new_audience, whats_new_dismissible, whats_new_platforms, whats_new_title, whats_new_html";

async function loadRow(platformRow) {
  const hit = cache.get(platformRow);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  const { data, error } = await supabase
    .from("app_config")
    .select(WHATS_NEW_COLUMNS)
    .eq("platform", platformRow)
    .order("updated_at", { ascending: false, nullsLast: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  cache.set(platformRow, { at: Date.now(), row: data || null });
  return data || null;
}

router.get("/config", async (req, res) => {
  try {
    const client = String(req.query.client || req.query.platform || "ios").toLowerCase();
    const platformRow = CLIENT_TO_PLATFORM_ROW[client] || "ios";
    const row = await loadRow(platformRow);
    const decision = decideWhatsNew(row, {
      client,
      lang: req.query.lang,
      appVersion: req.query.appVersion,
      previousAppVersion: req.query.previousAppVersion,
      seenVersion: req.query.seenVersion,
    });
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, show: decision.show, reason: decision.reason, data: decision.show ? decision.payload : null });
  } catch (error) {
    console.error("🆕 [WHATS_NEW] config error:", error?.message || error);
    return res.status(500).json({ success: false, show: false, reason: "error", data: null });
  }
});

// Eski istemciler (yorumda kalmış App.js kodu) için geriye dönük uyumluluk: artık hiç göstermez.
router.get("/should-show", (req, res) => res.json({ success: true, showWhatsNew: false, reason: "deprecated_use_config" }));

module.exports = router;
