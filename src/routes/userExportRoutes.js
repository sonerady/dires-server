// 📤 Kullanıcı çıktıları (1 Eki 2026, YALNIZ EKLENDİ; hiçbir eski uç değişmedi)
// Kullanıcı isteği: "kullanıcının indirdiği PDF'ler, kolajlar, film efektleri, banner'lar — admin panelinden görebileyim".
// Kolaj, PDF Katalog ve Film Lab CİHAZDA üretilir; sunucu çıktıyı hiç görmüyordu. Uygulama başarılı bir
// kaydet/indir sonrasında arka planda (sessiz, kullanıcıyı bekletmeden) buraya bildirir.
//
// Kullanıcı uçları (kimlik: refundIdentity — oturum ya da cihaz kimliği; anonim cihaz hesapları da çalışır):
//   POST /api/exports/record   { userId, tool, meta }                    → { success, id, upload }
//        upload = sunucu bu araç için dosya kopyası istiyor mu (USER_EXPORT_FILE_TOOLS; varsayılan hepsi)
//   POST /api/exports/record   { userId, tool, id, fileUrl?, thumbUrl? } → kayda dosya adreslerini ekler (bir kez)
//        (tek adımda { tool, meta, fileUrl, thumbUrl } de kabul edilir)
//   POST /api/exports/upload?userId=…&tool=catalog_pdf   multipart "file" (yalnız PDF, ≤ 40 MB)
//        → { success, url }  (görseller mevcut /api/uploadImage/upload-to-storage ile yüklenir)
//   Adresler YALNIZ bizim depolamamız: https + izinli sunucu + /storage/v1/object/public/images/userExports/<tool>/…
//   Tablo yoksa (göç uygulanmadı) 200 + { success:false, reason:"not_ready" } — asla 500 değil.
//
// Admin uçları (requireAdmin — ADMIN_AUTH_TOKEN):
//   GET /api/admin-dashboard/user-exports?tool=&from=YYYY-MM-DD&to=YYYY-MM-DD&search=&page=&limit=
//   GET /api/admin-dashboard/user-exports/stats?from=&to=   → araç başına günlük sayılar (İstanbul günü)
//   Banner: uygulama banner indirmelerini zaten banner_gallery_downloads'a yazıyor (dosyasıyla) → admin
//   listesi o tabloyu da okur (çift kayıt/yükleme yok).
//
// Bu yönlendirici /api altına bağlanır: router.use YOK (diğer /api isteklerine dokunmasın), her uç kendi
// ara katmanını taşır.
const express = require("express");
const crypto = require("node:crypto");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { ADMIN_OWNER_FIELDS, adminGenerationOwner } = require("../utils/adminGenerationOwner");

const TOOLS = ["catalog_pdf", "collage", "film_lab", "banner"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TZ_OFFSET = "+03:00"; // Europe/Istanbul (2016'dan beri sabit UTC+3, yaz saati yok)
const TZ_MS = 3 * 3600 * 1000;
const MAX_URL = 600;
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const STORAGE_PREFIX = "/storage/v1/object/public/images/";
const DEFAULT_HOSTS = ["api.diress.ai", "egpfenrpripkjpemjxtg.supabase.co"];

// meta: yalnız bilinen anahtarlar saklanır; tür/uzunluk sıkı. Bilinmeyen anahtar sessizce düşer
// (yeni uygulama sürümü eski sunucuda kaydı kaybetmesin), yanlış tür → 400.
const META_FIELDS = {
  template: "text", template_name: "text", ratio: "text", style: "text", background: "text",
  film: "text", film_name: "text", format: "text", quality: "text", language: "text", action: "text",
  photo_count: "int", page_count: "int", product_count: "int", width: "int", height: "int", bytes: "int",
  batch: "bool", is_pad: "bool", has_logo: "bool", has_caption: "bool",
  app_version: "text", platform: "text", os_version: "text",
};
const META_TEXT_MAX = 80;
const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

function allowedHosts(extra) {
  const hosts = new Set(DEFAULT_HOSTS);
  try { if (process.env.SUPABASE_URL) hosts.add(new URL(process.env.SUPABASE_URL).host.toLowerCase()); } catch {}
  String(process.env.USER_EXPORT_STORAGE_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).forEach((h) => hosts.add(h));
  (extra || []).forEach((h) => hosts.add(String(h).toLowerCase()));
  return hosts;
}

/** USER_EXPORT_FILE_TOOLS: "all" (varsayılan) | "none" | "catalog_pdf,collage,…" — dosya kopyası istenen araçlar. */
function fileTools(value = process.env.USER_EXPORT_FILE_TOOLS) {
  const raw = String(value ?? "all").trim().toLowerCase();
  if (!raw || raw === "all") return new Set(TOOLS);
  if (raw === "none" || raw === "off" || raw === "0") return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter((s) => TOOLS.includes(s)));
}

function validateMeta(raw) {
  if (raw === undefined || raw === null) return { ok: true, meta: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_meta" };
  const meta = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(raw)) {
    const type = META_FIELDS[key];
    if (!type) { dropped += 1; continue; }
    if (value === null || value === undefined || value === "") continue;
    if (type === "text") {
      if (typeof value !== "string" && typeof value !== "number") return { ok: false, reason: "invalid_meta", field: key };
      const v = String(value).replace(CONTROL, " ").replace(/\s{2,}/g, " ").trim();
      if (v.length > META_TEXT_MAX) return { ok: false, reason: "invalid_meta", field: key };
      if (v) meta[key] = v;
    } else if (type === "int") {
      const n = typeof value === "number" ? value : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 1e9) return { ok: false, reason: "invalid_meta", field: key };
      meta[key] = n;
    } else if (type === "bool") {
      if (typeof value !== "boolean") return { ok: false, reason: "invalid_meta", field: key };
      meta[key] = value;
    }
  }
  if (Object.keys(raw).length > 40) return { ok: false, reason: "invalid_meta" };
  return { ok: true, meta, dropped };
}

/**
 * Dosya adresi: yalnız bizim depolamamız. https, izinli sunucu, port/kimlik/sorgu/parça yok,
 * yol = /storage/v1/object/public/images/userExports/<tool>/… (banner için bannerStudio/ da), doğru uzantı.
 */
function validateStorageUrl(value, { tool, kind, hosts }) {
  if (value === undefined || value === null || value === "") return { ok: true, url: null };
  if (typeof value !== "string" || value.length > MAX_URL) return { ok: false };
  let u;
  try { u = new URL(value); } catch { return { ok: false }; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return { ok: false };
  if (!hosts.has(u.host.toLowerCase())) return { ok: false };
  const path = u.pathname;
  if (path.includes("..") || path.includes("//") || /%2e|%2f|%5c/i.test(path)) return { ok: false };
  const prefixes = [`${STORAGE_PREFIX}userExports/${tool}/`];
  if (tool === "banner") prefixes.push(`${STORAGE_PREFIX}bannerStudio/`);
  if (!prefixes.some((p) => path.startsWith(p) && path.length > p.length)) return { ok: false };
  if (!/^[A-Za-z0-9/_.-]+$/.test(path)) return { ok: false };
  const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  const allowed = kind === "thumb" ? ["jpg", "jpeg", "png", "webp"]
    : tool === "catalog_pdf" ? ["pdf"]
    : tool === "banner" ? ["jpg", "jpeg", "png", "mp4"]
    : ["jpg", "jpeg", "png"];
  if (!allowed.includes(ext)) return { ok: false };
  return { ok: true, url: `https://${u.host.toLowerCase()}${path}` };
}

/** Tablo yok (göç uygulanmadı): Postgres 42P01 ya da PostgREST şema önbelleği PGRST205/PGRST204. */
function isMissingTable(error, table = "user_exports") {
  if (!error) return false;
  if (["42P01", "PGRST205", "PGRST204", "42703"].includes(error.code)) return true;
  const m = String(error.message || "");
  return m.includes(table) && /does not exist|schema cache|could not find/i.test(m);
}

/** "YYYY-MM-DD" (İstanbul) aralığı → ISO sınırları [from, to). Geçersiz/eksik → son `days` gün. */
function dayRange(query, { defaultDays = 14, maxDays = 92 } = {}) {
  const today = new Date(Date.now() + TZ_MS).toISOString().slice(0, 10);
  let to = DAY.test(query.to || "") ? query.to : today;
  let from = DAY.test(query.from || "") ? query.from : null;
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(toMs)) to = today;
  if (!from || !Number.isFinite(Date.parse(`${from}T00:00:00Z`))) from = shiftDay(to, -(defaultDays - 1));
  if (from > to) [from, to] = [to, from];
  if (diffDays(from, to) + 1 > maxDays) from = shiftDay(to, -(maxDays - 1));
  return { from, to, fromIso: new Date(`${from}T00:00:00${TZ_OFFSET}`).toISOString(), toIso: new Date(`${shiftDay(to, 1)}T00:00:00${TZ_OFFSET}`).toISOString() };
}
function shiftDay(day, n) { return new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10); }
function diffDays(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5); }
function localDay(iso) { return new Date(Date.parse(iso) + TZ_MS).toISOString().slice(0, 10); }

function bannerRow(r, results) {
  const res = r.result_id ? results.get(r.result_id) : null;
  const video = r.format === "video";
  const file = r.file_url || (res ? res.image_url || res.preview_url : null);
  return {
    id: r.id,
    user_id: r.user_id,
    tool: "banner",
    source: "banner_gallery",
    file_url: file || null,
    thumb_url: video ? (res?.preview_url || null) : (res?.preview_url || file || null),
    meta: {
      template: r.template_id, template_name: r.template_name || undefined, category: r.category || undefined,
      format: video ? "mp4" : "jpg", action: r.action || undefined, mode: r.mode || undefined,
      ratio: r.ratio_value || undefined, language: r.language || undefined,
      is_sample_photo: r.is_sample_photo || undefined, ai_content: !!r.result_id || undefined,
    },
    created_at: r.created_at,
  };
}

function createUserExportRouter({ db, identity = null, requireAdmin, limits = {}, hosts = null, fileToolsValue } = {}) {
  if (typeof requireAdmin !== "function") throw new Error("requireAdmin is required");
  const router = express.Router();
  const lim = { recordPerTenMin: 80, uploadPerTenMin: 12, ipPerMinute: 60, ...limits };
  const storageHosts = hosts ? new Set(hosts.map((h) => h.toLowerCase())) : allowedHosts();
  const filesFor = () => fileTools(fileToolsValue !== undefined ? fileToolsValue : process.env.USER_EXPORT_FILE_TOOLS);

  const ready = (req, res, next) => (db ? next() : res.status(503).json({ success: false, reason: "unavailable" }));
  const noStore = (req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); };
  const identityMiddleware = identity || ((req, res, next) => require("../middleware/refundIdentity").refundIdentity(db)(req, res, next));
  const limited = (req, res) => res.status(429).json({ success: false, reason: "rate_limited" });
  const ipLimiter = rateLimit({ windowMs: 60000, limit: lim.ipPerMinute, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ux:ip:${ipKeyGenerator(req.ip || "")}`, handler: limited });
  const userLimiter = (limit, tag) => rateLimit({ windowMs: 10 * 60000, limit, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `ux:${tag}:${req.refundUserId}`, handler: limited });
  const notReady = (res) => res.json({ success: false, reason: "not_ready" });

  // ─── Kullanıcı: kayıt / dosya ekleme ──────────────────────────────
  router.post("/exports/record", ready, noStore, ipLimiter, identityMiddleware, userLimiter(lim.recordPerTenMin, "rec"), async (req, res) => {
    const b = req.body || {};
    const tool = TOOLS.includes(b.tool) ? b.tool : null;
    if (!tool) return res.status(400).json({ success: false, reason: "invalid_tool" });
    const file = validateStorageUrl(b.fileUrl, { tool, kind: "file", hosts: storageHosts });
    const thumb = validateStorageUrl(b.thumbUrl, { tool, kind: "thumb", hosts: storageHosts });
    if (!file.ok || !thumb.ok) return res.status(400).json({ success: false, reason: "invalid_url" });
    const userId = req.refundUserId;
    try {
      if (b.id !== undefined) {
        // 2. adım: yüklenen dosyaların adresi kayda eklenir (yalnız kendi kaydı, yalnız bir kez)
        if (!UUID.test(String(b.id))) return res.status(400).json({ success: false, reason: "invalid_id" });
        if (!file.url && !thumb.url) return res.status(400).json({ success: false, reason: "invalid_url" });
        const patch = {};
        if (file.url) patch.file_url = file.url;
        if (thumb.url) patch.thumb_url = thumb.url;
        const { data, error } = await db.from("user_exports").update(patch)
          .eq("id", b.id).eq("user_id", userId).eq("tool", tool).is("file_url", null).select("id");
        if (isMissingTable(error)) return notReady(res);
        if (error) throw error;
        if (!data || !data.length) return res.status(404).json({ success: false, reason: "not_found" });
        return res.json({ success: true, id: b.id });
      }
      const checked = validateMeta(b.meta);
      if (!checked.ok) return res.status(400).json({ success: false, reason: checked.reason, ...(checked.field ? { field: checked.field } : {}) });
      const id = crypto.randomUUID();
      const { error } = await db.from("user_exports").insert({ id, user_id: userId, tool, file_url: file.url, thumb_url: thumb.url, meta: checked.meta });
      if (isMissingTable(error)) return notReady(res);
      if (error) throw error;
      return res.json({ success: true, id, upload: filesFor().has(tool) && !file.url });
    } catch (error) {
      console.warn("📤 [USER_EXPORTS] record failed:", String(error?.message || error).slice(0, 200));
      return res.status(500).json({ success: false, reason: "request_failed" });
    }
  });

  // PDF yükleme (görseller mevcut upload-to-storage ile; o uç içerik türünü image/jpeg'e sabitliyor).
  // Kimlik ÖNCE: doğrulanmamış istekler gövde tamponlanmadan reddedilir.
  let multer = null;
  const pdfUpload = (req, res, next) => {
    if (!multer) multer = require("multer")({ storage: require("multer").memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 4 } });
    multer.single("file")(req, res, (err) => {
      if (err) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ success: false, reason: err.code === "LIMIT_FILE_SIZE" ? "too_large" : "invalid_upload" });
      next();
    });
  };
  router.post("/exports/upload", ready, noStore, ipLimiter, identityMiddleware, userLimiter(lim.uploadPerTenMin, "up"), (req, res, next) => {
    const tool = req.query.tool;
    if (tool !== "catalog_pdf") return res.status(400).json({ success: false, reason: "invalid_tool" });
    if (!filesFor().has(tool)) return res.json({ success: false, reason: "disabled" });
    next();
  }, pdfUpload, async (req, res) => {
    const buf = req.file?.buffer;
    if (!buf || buf.length < 64 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ success: false, reason: "invalid_file" });
    try {
      const path = `userExports/catalog_pdf/${crypto.randomUUID()}.pdf`;
      const { error } = await db.storage.from("images").upload(path, buf, { contentType: "application/pdf", upsert: false, cacheControl: "31536000" });
      if (error) throw error;
      const url = db.storage.from("images").getPublicUrl(path).data?.publicUrl;
      if (!url) throw new Error("no_public_url");
      return res.json({ success: true, url });
    } catch (error) {
      console.warn("📤 [USER_EXPORTS] pdf upload failed:", String(error?.message || error).slice(0, 200));
      return res.status(500).json({ success: false, reason: "upload_failed" });
    }
  });

  // ─── Admin ────────────────────────────────────────────────────────
  async function ownerFilter(search) {
    if (!search) return null;
    if (UUID.test(search)) return [search];
    const pattern = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    const { data, error } = await db.from("users").select("id").ilike("email", pattern).limit(200);
    if (error) throw error;
    return (data || []).map((u) => u.id);
  }
  async function withOwners(rows) {
    const ids = [...new Set(rows.map((r) => r.user_id).filter((id) => UUID.test(String(id || ""))))];
    const owners = new Map();
    if (ids.length) {
      const { data, error } = await db.from("users").select(ADMIN_OWNER_FIELDS).in("id", ids);
      if (error) throw error;
      (data || []).forEach((u) => owners.set(u.id, u));
    }
    return rows.map((r) => ({ ...r, ...adminGenerationOwner(owners.get(r.user_id)) }));
  }
  async function bannerResults(rows) {
    const ids = [...new Set(rows.filter((r) => r.result_id && !r.file_url).map((r) => r.result_id))];
    const map = new Map();
    if (!ids.length) return map;
    const { data, error } = await db.from("banner_studio_results").select("id,image_url,preview_url").in("id", ids);
    if (!error) (data || []).forEach((r) => map.set(r.id, r));
    return map;
  }

  /** Bir kaynaktan ilk `take` satır (yeniden eskiye) + toplam. Tablo yoksa boş + notReady. */
  async function fetchSource(source, { tool, ownerIds, range, take }) {
    if (source === "user_exports") {
      let q = db.from("user_exports").select("id,user_id,tool,file_url,thumb_url,meta,created_at", { count: "exact" })
        .gte("created_at", range.fromIso).lt("created_at", range.toIso)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(take.from, take.to);
      if (tool) q = q.eq("tool", tool);
      if (ownerIds) q = q.in("user_id", ownerIds);
      const { data, count, error } = await q;
      if (isMissingTable(error)) return { rows: [], total: 0, missing: true };
      if (error) throw error;
      return { rows: (data || []).map((r) => ({ ...r, source: "user_exports", meta: r.meta || {} })), total: count || 0 };
    }
    let q = db.from("banner_gallery_downloads")
      .select("id,user_id,template_id,template_name,category,format,action,mode,result_id,file_url,ratio_value,language,is_sample_photo,created_at", { count: "exact" })
      .gte("created_at", range.fromIso).lt("created_at", range.toIso)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(take.from, take.to);
    if (ownerIds) q = q.in("user_id", ownerIds);
    const { data, count, error } = await q;
    if (isMissingTable(error, "banner_gallery_downloads")) return { rows: [], total: 0, missing: true };
    if (error) throw error;
    const results = await bannerResults(data || []);
    return { rows: (data || []).map((r) => bannerRow(r, results)), total: count || 0 };
  }

  router.get("/admin-dashboard/user-exports", requireAdmin, ready, noStore, async (req, res) => {
    try {
      const page = Math.max(1, Math.min(100, parseInt(req.query.page, 10) || 1));
      const limit = Math.max(1, Math.min(60, parseInt(req.query.limit, 10) || 30));
      const tool = TOOLS.includes(req.query.tool) ? req.query.tool : null;
      const range = dayRange(req.query, { defaultDays: 30, maxDays: 400 });
      const search = String(req.query.search || "").trim().slice(0, 254);
      const ownerIds = await ownerFilter(search);
      const empty = { success: true, data: [], total: 0, page, totalPages: 1, range: { from: range.from, to: range.to } };
      if (ownerIds && !ownerIds.length) return res.json(empty);
      const notReady = [];
      let rows;
      let total;
      if (tool && tool !== "banner") {
        // tek kaynak: doğrudan sayfalama
        const out = await fetchSource("user_exports", { tool, ownerIds, range, take: { from: (page - 1) * limit, to: page * limit - 1 } });
        if (out.missing) notReady.push("user_exports");
        rows = out.rows;
        total = out.total;
      } else {
        // banner / tümü: iki kaynak birleşir (her birinden ilk page*limit satır, tarihe göre sıralanıp dilimlenir)
        const take = { from: 0, to: page * limit - 1 };
        const [a, b] = await Promise.all([
          fetchSource("user_exports", { tool, ownerIds, range, take }),
          fetchSource("banner_gallery_downloads", { tool: null, ownerIds, range, take }),
        ]);
        if (a.missing) notReady.push("user_exports");
        if (b.missing) notReady.push("banner_gallery_downloads");
        rows = [...a.rows, ...b.rows]
          .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : String(y.id).localeCompare(String(x.id))))
          .slice((page - 1) * limit, page * limit);
        total = a.total + b.total;
      }
      return res.json({ ...empty, data: await withOwners(rows), total, totalPages: Math.max(1, Math.ceil(total / limit)), notReady });
    } catch (error) {
      console.error("[Admin/UserExports] list", error?.message);
      return res.status(500).json({ success: false, error: "Failed to load user exports" });
    }
  });

  /** Aralıktaki tüm satırlar 1000'lik sayfalarla (PostgREST üst sınırı), en fazla `cap` satır. */
  async function scan(table, columns, range, cap = 20000) {
    const out = [];
    for (let from = 0; from < cap; from += 1000) {
      const { data, error } = await db.from(table).select(columns)
        .gte("created_at", range.fromIso).lt("created_at", range.toIso)
        .order("created_at", { ascending: false }).range(from, from + 999);
      if (error) return { rows: out, error };
      out.push(...(data || []));
      if (!data || data.length < 1000) return { rows: out, truncated: false };
    }
    return { rows: out, truncated: true };
  }

  router.get("/admin-dashboard/user-exports/stats", requireAdmin, ready, noStore, async (req, res) => {
    try {
      const range = dayRange(req.query, { defaultDays: 14, maxDays: 92 });
      const [ux, bg] = await Promise.all([
        scan("user_exports", "tool,user_id,created_at", range),
        scan("banner_gallery_downloads", "user_id,created_at", range),
      ]);
      const notReady = [];
      if (ux.error) { if (isMissingTable(ux.error)) notReady.push("user_exports"); else throw ux.error; }
      if (bg.error) { if (isMissingTable(bg.error, "banner_gallery_downloads")) notReady.push("banner_gallery_downloads"); else throw bg.error; }
      const days = [];
      const index = new Map();
      for (let d = range.from; d <= range.to; d = shiftDay(d, 1)) {
        const row = { date: d, catalog_pdf: 0, collage: 0, film_lab: 0, banner: 0, total: 0 };
        index.set(d, row);
        days.push(row);
      }
      const totals = { catalog_pdf: 0, collage: 0, film_lab: 0, banner: 0, total: 0 };
      const users = Object.fromEntries(TOOLS.map((t) => [t, new Set()]));
      const add = (tool, userId, createdAt) => {
        const row = index.get(localDay(createdAt));
        if (!row || !TOOLS.includes(tool)) return;
        row[tool] += 1; row.total += 1; totals[tool] += 1; totals.total += 1;
        users[tool].add(userId);
      };
      (ux.error ? [] : ux.rows).forEach((r) => add(r.tool, r.user_id, r.created_at));
      (bg.error ? [] : bg.rows).forEach((r) => add("banner", r.user_id, r.created_at));
      const today = days[days.length - 1] || null;
      return res.json({
        success: true,
        range: { from: range.from, to: range.to },
        days,
        totals,
        today,
        users: Object.fromEntries(TOOLS.map((t) => [t, users[t].size])),
        truncated: !!(ux.truncated || bg.truncated),
        notReady,
      });
    } catch (error) {
      console.error("[Admin/UserExports] stats", error?.message);
      return res.status(500).json({ success: false, error: "Failed to load export stats" });
    }
  });

  return router;
}

module.exports = (() => {
  const clients = require("../supabaseClient");
  const { requireAdmin } = require("../middleware/requireAdmin");
  return createUserExportRouter({ db: clients.supabaseAdmin || clients.supabase, requireAdmin });
})();
module.exports.createUserExportRouter = createUserExportRouter;
module.exports.core = { TOOLS, META_FIELDS, validateMeta, validateStorageUrl, isMissingTable, dayRange, fileTools, allowedHosts, bannerRow, localDay };
