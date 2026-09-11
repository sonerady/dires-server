// "Yenilikler" sayfa-modalı karar mantığı (app_config.whats_new_*).
// Saf fonksiyonlar — route ve testler paylaşır.

const AUDIENCES = ["updated", "all"];
const PLATFORMS = ["ios", "android", "desktop", "web"];
const RTL_LANGS = new Set(["ar", "he", "fa", "ur"]);

/** "1.7.10" → [1,7,10]; geçersizse null */
function parseVersion(v) {
  if (v == null) return null;
  const m = String(v).trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

function normalizeLang(lang) {
  const s = String(lang || "").trim().toLowerCase().replace("_", "-");
  return s || "en";
}

/** Dil → içerik seçimi: tam kod → ana dil → default → en → ilk değer */
function pickLocalized(map, lang) {
  if (!map || typeof map !== "object") return { value: null, lang: null };
  const full = normalizeLang(lang);
  const base = full.split("-")[0];
  for (const key of [full, base, "default", "en"]) {
    if (typeof map[key] === "string" && map[key].trim()) return { value: map[key], lang: key };
  }
  const first = Object.entries(map).find(([, v]) => typeof v === "string" && v.trim());
  return first ? { value: first[1], lang: first[0] } : { value: null, lang: null };
}

function normalizePlatforms(v) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v.split(","); } })() : null;
  if (!Array.isArray(arr)) return PLATFORMS.slice();
  const out = arr.map((x) => String(x).trim().toLowerCase()).filter((x) => PLATFORMS.includes(x));
  return out.length ? out : PLATFORMS.slice();
}

/**
 * @param {object} row app_config satırı
 * @param {object} q { client: 'ios'|'android'|'desktop'|'web', lang, appVersion, previousAppVersion, seenVersion }
 * @returns {{show:boolean, reason:string, payload:object|null}}
 */
function decideWhatsNew(row, q = {}) {
  const client = String(q.client || "").toLowerCase();
  if (!row || row.whats_new_enabled !== true) return { show: false, reason: "disabled", payload: null };
  const version = String(row.whats_new_version || "").trim();
  if (!version) return { show: false, reason: "no_version", payload: null };
  if (!normalizePlatforms(row.whats_new_platforms).includes(client)) return { show: false, reason: "platform_excluded", payload: null };

  const { value: html, lang: htmlLang } = pickLocalized(row.whats_new_html, q.lang);
  if (!html) return { show: false, reason: "no_html", payload: null };
  const { value: title } = pickLocalized(row.whats_new_title, q.lang);

  const audience = AUDIENCES.includes(row.whats_new_audience) ? row.whats_new_audience : "updated";
  const payload = {
    version,
    audience,
    dismissible: row.whats_new_dismissible !== false,
    title: title || null,
    html,
    lang: htmlLang,
    rtl: RTL_LANGS.has(normalizeLang(q.lang).split("-")[0]),
  };

  // Bu sürüm zaten görüldü
  if (q.seenVersion && compareVersions(q.seenVersion, version) >= 0) return { show: false, reason: "already_seen", payload };

  // Web'de uygulama sürümü yok → yalnız görülmemişlik kontrolü
  if (client !== "web") {
    // Yüklü uygulama en az modalın sürümü olmalı (eski sürüm yeni içeriği görmesin)
    if (q.appVersion && compareVersions(q.appVersion, version) < 0) return { show: false, reason: "app_too_old", payload };
    if (audience === "updated") {
      // Güncelleme: önceki sürüm biliniyor ve mevcut sürümden küçük
      const cmp = compareVersions(q.previousAppVersion, q.appVersion);
      if (cmp == null || cmp >= 0) return { show: false, reason: "not_updated", payload };
    }
  }
  return { show: true, reason: "ok", payload };
}

module.exports = { AUDIENCES, PLATFORMS, RTL_LANGS, parseVersion, compareVersions, pickLocalized, normalizePlatforms, decideWhatsNew };
