// 🏪 İşletme profili — GET/PUT /api/business-profile (30 Eyl 2026, YALNIZ EKLENDİ; eski uçlar değişmedi)
//
// Kolaj ve PDF Katalog ekranlarında satıcının girdiği mağaza bilgileri (web sitesi, telefon…) hesapta
// saklanır (users.business_profile jsonb) ve ekranlar her açılışta bunlarla dolar.
//
//   GET  /api/business-profile?userId=…            → { success:true, profile }
//   PUT  /api/business-profile?userId=…  { profile:{…kısmi} }
//        kayıtlı profile BİRLEŞTİRİR; boş metin o anahtarı SİLER → { success:true, profile }
//
// • Alanlar (hepsi isteğe bağlı metin, kırpılır, ≤200 karakter): storeName, website, phone, email,
//   social, address, whatsapp. Bilinmeyen anahtar / metin dışı değer / uzun değer → 400 (sıkı doğrulama).
//   Biçim (e-posta, URL) denetlenmez: istemci yazarken 800 ms'de bir kaydeder, yarım "ali@" reddedilmemeli.
// • Kimlik: refundIdentity (oturum ya da cihaz kimliği; e-posta şartı yok — anonim cihaz hesapları da çalışır).
// • Hız sınırı: kullanıcı başına GET 60/dk, PUT 40/dk (bellek içi).
// • Sütun henüz yoksa (göç uygulanmadı) 200 + { success:false, reason:"not_ready" } — asla 500 değil;
//   istemci yalnız yerel önbelleği kullanır.
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const FIELDS = ["storeName", "website", "phone", "email", "social", "address", "whatsapp"];
const MAX_LEN = 200;
// C0/C1 denetim karakterleri (sekme/satır sonu dahil — tek satırlık alanlar) + görünmez yön/biçim işaretleri
const CONTROL = /[\u0000-\u001F\u007F-\u009F​‎‏‪-‮⁦-⁩﻿]/g;

function cleanValue(value) {
  return String(value).replace(CONTROL, " ").replace(/\s{2,}/g, " ").trim();
}

/** Kayıtlı (DB'den gelen) değeri güvenli profile çevirir: yalnız bilinen alanlar, yalnız dolu metinler. */
function normalizeStored(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of FIELDS) {
    if (typeof raw[key] !== "string") continue;
    const v = cleanValue(raw[key]).slice(0, MAX_LEN);
    if (v) out[key] = v;
  }
  return out;
}

/**
 * PUT gövdesindeki kısmi profili doğrular.
 * @returns {{ ok:true, patch:Record<string,string> } | { ok:false, reason:string, field?:string }}
 *   patch değeri "" = o anahtarı sil.
 */
function validatePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_body" };
  const profile = body.profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return { ok: false, reason: "invalid_profile" };
  const keys = Object.keys(profile);
  if (!keys.length) return { ok: false, reason: "empty_profile" };
  const patch = {};
  for (const key of keys) {
    if (!FIELDS.includes(key)) return { ok: false, reason: "unknown_field", field: key };
    const value = profile[key];
    if (value === null) { patch[key] = ""; continue; }
    if (typeof value !== "string") return { ok: false, reason: "invalid_value", field: key };
    if (value.length > MAX_LEN * 4) return { ok: false, reason: "too_long", field: key };
    const v = cleanValue(value);
    if (v.length > MAX_LEN) return { ok: false, reason: "too_long", field: key };
    patch[key] = v;
  }
  return { ok: true, patch };
}

function mergeProfile(current, patch) {
  const next = { ...normalizeStored(current) };
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value;
    else delete next[key];
  }
  return next;
}

/** Sütun yok (göç uygulanmadı): Postgres 42703 ya da PostgREST şema önbelleği PGRST204. */
function isMissingColumn(error) {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /business_profile/i.test(String(error.message || "")) && /does not exist|schema cache|could not find/i.test(String(error.message || ""));
}

function createBusinessProfileRouter({ db, identity = null, limits = { getPerMinute: 60, putPerMinute: 40 } } = {}) {
  const router = express.Router();
  router.use((req, res, next) => (db ? next() : res.status(503).json({ success: false, reason: "unavailable" })));
  router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  const identityMiddleware = identity || ((req, res, next) => require("../middleware/refundIdentity").refundIdentity(db)(req, res, next));
  const limiter = (limit, tag) => rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.refundUserId ? `bp:${tag}:${req.refundUserId}` : `bp:${tag}:${ipKeyGenerator(req.ip || "")}`),
    handler: (req, res) => res.status(429).json({ success: false, reason: "rate_limited" }),
  });
  const notReady = (res) => res.json({ success: false, reason: "not_ready" });

  async function load(userId) {
    const { data, error } = await db.from("users").select("business_profile").eq("id", userId).maybeSingle();
    return { data, error };
  }

  router.get("/", identityMiddleware, limiter(limits.getPerMinute, "get"), async (req, res) => {
    try {
      const { data, error } = await load(req.refundUserId);
      if (isMissingColumn(error)) return notReady(res);
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, reason: "user_not_found" });
      return res.json({ success: true, profile: normalizeStored(data.business_profile) });
    } catch (error) {
      console.warn("🏪 [BUSINESS_PROFILE] okuma hatası:", error?.message);
      return res.status(500).json({ success: false, reason: "request_failed" });
    }
  });

  router.put("/", identityMiddleware, limiter(limits.putPerMinute, "put"), async (req, res) => {
    const checked = validatePatch(req.body);
    if (!checked.ok) return res.status(400).json({ success: false, reason: checked.reason, ...(checked.field ? { field: checked.field } : {}) });
    try {
      const { data, error } = await load(req.refundUserId);
      if (isMissingColumn(error)) return notReady(res);
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, reason: "user_not_found" });
      const profile = mergeProfile(data.business_profile, checked.patch);
      const { error: writeError } = await db.from("users").update({ business_profile: profile }).eq("id", req.refundUserId);
      if (isMissingColumn(writeError)) return notReady(res);
      if (writeError) throw writeError;
      return res.json({ success: true, profile });
    } catch (error) {
      console.warn("🏪 [BUSINESS_PROFILE] yazma hatası:", error?.message);
      return res.status(500).json({ success: false, reason: "request_failed" });
    }
  });
  return router;
}

const clients = require("../supabaseClient");
module.exports = createBusinessProfileRouter({ db: clients.supabaseAdmin || clients.supabase });
module.exports.createBusinessProfileRouter = createBusinessProfileRouter;
module.exports.core = { FIELDS, MAX_LEN, validatePatch, mergeProfile, normalizeStored, isMissingColumn };
