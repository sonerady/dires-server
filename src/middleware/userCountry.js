// 🌍 Kullanıcı ülkesi (16 Eyl 2026) — admin "Kullanıcılar" tablosundaki bayrak.
//
// Her istekte userId (query/body) + istemci IP'sinden ülke kodu (ISO2) bulunur
// ve users.country'ye yazılır. Kaynak sırası:
//   1) Proxy başlıkları: cf-ipcountry (Cloudflare), x-vercel-ip-country,
//      cloudfront-viewer-country — ücretsiz ve anında.
//   2) Başlık yoksa ip-api.com (ücretsiz, 45 istek/dk) — IP başına önbellekli.
// Yazma sıklığı: kullanıcı başına 24 saatte bir (ya da ülke değişirse).
// Tamamen arka planda ve sessiz; istek akışını asla bekletmez/bozmaz.
const axios = require("axios");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_TTL_MS = 24 * 60 * 60 * 1000;
const IP_TTL_MS = 6 * 60 * 60 * 1000;
const userSeen = new Map(); // userId → { country, at }
const ipCache = new Map(); // ip → { country, at }
let lookupsThisMinute = 0;
let minuteStart = Date.now();

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = xf || req.headers["x-real-ip"] || req.ip || req.socket?.remoteAddress || "";
  return String(ip).replace(/^::ffff:/, "");
}
function isPrivateIp(ip) {
  return !ip || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|169\.254\.)/.test(ip);
}
function headerCountry(req) {
  const raw = req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["cloudfront-viewer-country"] || req.headers["x-country-code"];
  const c = String(raw || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}
async function lookupIp(ip) {
  const hit = ipCache.get(ip);
  if (hit && Date.now() - hit.at < IP_TTL_MS) return hit.country;
  if (Date.now() - minuteStart > 60000) { minuteStart = Date.now(); lookupsThisMinute = 0; }
  if (lookupsThisMinute >= 40) return null; // ip-api ücretsiz tavanı 45/dk
  lookupsThisMinute += 1;
  try {
    const r = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`, { timeout: 4000 });
    const c = r?.data?.status === "success" ? String(r.data.countryCode || "").toUpperCase() : null;
    const country = /^[A-Z]{2}$/.test(c || "") ? c : null;
    ipCache.set(ip, { country, at: Date.now() });
    return country;
  } catch (e) {
    ipCache.set(ip, { country: null, at: Date.now() });
    return null;
  }
}

function createUserCountryMiddleware(supabase, logger) {
  return function userCountry(req, _res, next) {
    next();
    try {
      const userId = req.query?.userId || req.body?.userId || null;
      if (!userId || !UUID_RE.test(String(userId))) return;
      const seen = userSeen.get(userId);
      if (seen && Date.now() - seen.at < USER_TTL_MS && seen.country) return;
      const ip = clientIp(req);
      const fromHeader = headerCountry(req);
      (async () => {
        const country = fromHeader || (isPrivateIp(ip) ? null : await lookupIp(ip));
        if (!country) return;
        if (seen && seen.country === country && Date.now() - seen.at < USER_TTL_MS) return;
        userSeen.set(userId, { country, at: Date.now() });
        const { error } = await supabase
          .from("users")
          .update({ country, country_updated_at: new Date().toISOString() })
          .eq("id", userId)
          .neq("country", country);
        if (error) logger?.warn?.("🌍 [COUNTRY] yazılamadı:", error.message);
      })().catch(() => {});
    } catch (e) {}
  };
}

module.exports = { createUserCountryMiddleware, headerCountry, clientIp };
