// ───────────────────────────────────────────────────────────────────────────
// 🍽️ Menü stilleri — Auto Styles'ın menü karşılığı.
//
// Operatör beğendiği bir menü tasarımının fotoğrafını yükler; DB'de menü
// görselinin LİNKİ durur ve menü stüdyosunda referans olarak seçilebilir.
//
// Auto Styles'tan bilinçli FARKLAR:
//   • çok dilli çeviri YOK — isim düz metin, tek dil
//   • kategori ağacı / yaklaşım kartı / grid damgası YOK
//   • AI analizi ZORUNLU DEĞİL — kayıt anında hiçbir model çağrılmaz.
//     Operatör isterse "stil promptu üret" ile sonradan tetikler.
//
// Mount: app.js → app.use("/api/admin-dashboard", requireAdmin, adminMenuStyleRoutes)
// ───────────────────────────────────────────────────────────────────────────

const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const { supabaseAdmin } = require("../supabaseClient");
const { askAstra, stripCitations } = require("../utils/menuStudioAstra");

const router = express.Router();
const db = supabaseAdmin;

const TABLE = "menu_styles";
const STORAGE_BUCKET = "reference";
const STORAGE_PREFIX = "menu-styles/";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIN_IMAGE_BYTES = 1024;
const MAX_IMAGES = 8;

// Menü türleri. Serbest metin değil sınırlı küme — yazım farkları havuzu
// ikiye bölerdi ("tatlı" / "tatli" / "dessert"). DB'de de CHECK var.
const CATEGORIES = ["food", "dessert", "drink", "breakfast", "wine", "other"];
const DEFAULT_CATEGORY = "food";
const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

/* ───────────────────── küçük yardımcılar ───────────────────── */

const text = (v, max = 500) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const cleanTags = (v) =>
  Array.isArray(v)
    ? [...new Set(v.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20)
    : [];

const cleanCategory = (v, fallback = DEFAULT_CATEGORY) => {
  const c = String(v || "").trim().toLowerCase();
  return CATEGORIES.includes(c) ? c : fallback;
};

const urls = (row) => (Array.isArray(row?.image_urls) ? row.image_urls.filter(Boolean) : []);

const fail = (res, code, message) => res.status(code).json({ success: false, error: message });

/* ───────────────────── görsel depolama ───────────────────── */

/**
 * Buffer'ı depoya koyar, kalıcı herkese açık URL döndürür.
 * Menü tasarımları metin taşıdığı için 1800px'te tutuluyor — daha küçüğünde
 * yazılar okunmaz hale geliyor ve referans değerini kaybediyor.
 */
async function storeImage(buffer, contentType, tag) {
  let out = buffer;
  let type = contentType && /^image\//i.test(contentType) ? contentType : "image/jpeg";
  let ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";

  try {
    const sharp = require("sharp");
    out = await sharp(buffer)
      .rotate()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    type = "image/jpeg";
    ext = "jpg";
  } catch (err) {
    console.warn("🍽️ [MENU_STYLE] sharp atlandı, ham görsel yükleniyor:", err.message);
  }

  const fileName = `${STORAGE_PREFIX}${tag || "style"}_${Date.now()}_${uuidv4().slice(0, 8)}.${ext}`;
  const { error } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, out, { contentType: type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`Depolama hatası: ${error.message}`);
  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

/** data URI / base64 görseli depoya al. */
async function storeBase64Image(base64, tag) {
  const raw = String(base64 || "");
  const match = raw.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  const body = match ? match[2] : raw.replace(/^data:[^,]+,/, "");
  const buffer = Buffer.from(body, "base64");
  if (buffer.length < MIN_IMAGE_BYTES) throw new Error("Görsel okunamadı");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Görsel çok büyük (en fazla 15 MB)");
  return storeImage(buffer, match ? match[1] : "image/jpeg", tag);
}

/**
 * Dışarıdan verilen URL'yi DOĞRULA ve KENDİ DEPOMUZA AL.
 * Hotlink kırılmasın, kaynak silinince stil bozulmasın diye verilen adrese
 * asla doğrudan güvenilmiyor (menü stüdyosundaki aynı kural).
 */
async function rehost(url, tag) {
  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 25000,
    maxContentLength: MAX_IMAGE_BYTES,
    maxRedirects: 3,
    headers: { "User-Agent": FETCH_UA, Accept: "image/avif,image/webp,image/jpeg,image/png,*/*" },
    validateStatus: (s) => s === 200,
  });
  const contentType = String(resp.headers["content-type"] || "").split(";")[0].trim();
  if (!/^image\/(jpeg|jpg|png|webp|avif)$/i.test(contentType)) {
    throw new Error(`Desteklenmeyen görsel türü: ${contentType || "bilinmiyor"}`);
  }
  const buffer = Buffer.from(resp.data);
  if (buffer.length < MIN_IMAGE_BYTES) throw new Error("Görsel çok küçük");
  return storeImage(buffer, contentType, tag);
}

/** İstekteki görselleri (base64 ya da url) kalıcı linklere çevirir. */
async function ingestImages(images, tag) {
  const list = Array.isArray(images) ? images.slice(0, MAX_IMAGES) : [];
  const out = [];
  for (const item of list) {
    const base64 = item?.base64 || (typeof item === "string" && item.startsWith("data:") ? item : null);
    const src = item?.url || (typeof item === "string" && /^https?:\/\//.test(item) ? item : null);
    try {
      if (base64) out.push(await storeBase64Image(base64, tag));
      else if (src) out.push(await rehost(src, tag));
    } catch (err) {
      console.warn("🍽️ [MENU_STYLE] görsel alınamadı:", err.message);
    }
  }
  return out;
}

/* ───────────────────── opsiyonel stil promptu ───────────────────── */

// Menü tasarımı için sanat yönetmeni brief'i. Auto Styles'taki moda analizinin
// menü karşılığı; ama burada ZORUNLU DEĞİL — operatör isterse çalıştırır.
const MENU_STYLE_PROMPT = `You are a senior graphic designer and art director specialising in printed restaurant menus. The attached images are EXAMPLES of a menu design language the operator likes. Analyse them together and write a compact, technically precise STYLE BRIEF so a design model can produce a BRAND-NEW menu in the same visual language, for a DIFFERENT restaurant with DIFFERENT dishes.

Cover, in concrete designer language:
1. LAYOUT SYSTEM — page shape and orientation, column structure, margin and gutter rhythm, how categories are separated, where prices sit relative to names, density (airy vs packed).
2. TYPOGRAPHY — for headings, category labels, dish names, descriptions and prices: serif/sans/script/display classification, weight, case, letter-spacing, approximate size relationships, and the closest well-known typeface family ("closest to ..."). Say whether a single family carries everything or there is a display/text pairing.
3. COLOUR — background, ink, accent. Give approximate hex values and say how the accent is used (rules, category bars, price highlights, illustration fills).
4. DECORATION & TEXTURE — borders, rules, ornaments, illustration style, paper texture, grain, patterns. Say whether decoration is structural or incidental.
5. FOOD PHOTOGRAPHY TREATMENT — are dish photos present at all? If yes: cut-out with no background vs full-frame, shooting angle, shadow treatment, how they sit relative to panels and type. If no photos, say so explicitly and describe what fills that space instead.
6. OVERALL CHARACTER — the impression in a few words (e.g. "warm trattoria letterpress", "cold minimal bistro", "playful street-food poster").

STRICT RULES:
- The dishes, prices and restaurant name in the samples are NOT part of the style. Never copy them, never mention them. Someone else's menu content will be poured into this template.
- Do not describe any logo, brand mark or restaurant name from the samples.
- Prefer concrete estimates (hex, ratios, typeface families) over vague adjectives.
- Plain text only, 180-300 words, numbered labels, no markdown.`;

const CATEGORY_HINT = {
  food: "a main food menu",
  dessert: "a dessert menu",
  drink: "a drinks menu",
  breakfast: "a breakfast menu",
  wine: "a wine list",
  other: "a menu",
};

async function analyzeMenuStyle(imageUrls, category = DEFAULT_CATEGORY) {
  const raw = await askAstra({
    prompt: `These images are ${CATEGORY_HINT[category] || CATEGORY_HINT.other}. Analyse the attached menu designs and write the style brief.`,
    systemPrompt: MENU_STYLE_PROMPT,
    imageUrls,
    maxTokens: 4000,
    tag: "MENU_STYLE",
  });
  return stripCitations(String(raw || "").trim());
}

/* ───────────────────── uçlar ───────────────────── */

/** Liste. ?active=1 ile yalnız havuzdakiler. */
router.get("/menu-styles", async (req, res) => {
  try {
    let q = db.from(TABLE).select("*").order("created_at", { ascending: false });
    if (req.query.active === "1") q = q.eq("active", true);
    if (req.query.category && CATEGORIES.includes(String(req.query.category))) {
      q = q.eq("category", String(req.query.category));
    }
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, styles: data || [], categories: CATEGORIES });
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] liste hatası:", err.message);
    fail(res, 500, err.message);
  }
});

/**
 * Yeni stil. Sadece kaydeder — model çağrısı YOK.
 * body: { name, images: [{base64}|{url}], tags?, notes? }
 */
router.post("/menu-styles", async (req, res) => {
  try {
    const name = text(req.body?.name, 120);
    if (!name) return fail(res, 400, "İsim gerekli");

    const imageUrls = await ingestImages(req.body?.images, "menu");
    if (!imageUrls.length) return fail(res, 400, "En az bir menü görseli gerekli");

    const { data, error } = await db
      .from(TABLE)
      .insert({
        name,
        notes: text(req.body?.notes, 2000),
        image_urls: imageUrls,
        category: cleanCategory(req.body?.category),
        tags: cleanTags(req.body?.tags),
        created_by: text(req.body?.createdBy, 120),
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, style: data });
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] oluşturma hatası:", err.message);
    fail(res, 500, err.message);
  }
});

/** Alan güncelle: name / notes / tags / active. Gönderilmeyen alana dokunulmaz. */
router.patch("/menu-styles/:id", async (req, res) => {
  try {
    const patch = {};
    if ("name" in req.body) {
      const n = text(req.body.name, 120);
      if (!n) return fail(res, 400, "İsim boş olamaz");
      patch.name = n;
    }
    if ("notes" in req.body) patch.notes = text(req.body.notes, 2000);
    if ("tags" in req.body) patch.tags = cleanTags(req.body.tags);
    if ("category" in req.body) patch.category = cleanCategory(req.body.category);
    if ("active" in req.body) patch.active = Boolean(req.body.active);
    if (!Object.keys(patch).length) return fail(res, 400, "Güncellenecek alan yok");

    const { data, error } = await db.from(TABLE).update(patch).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, style: data });
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] güncelleme hatası:", err.message);
    fail(res, 500, err.message);
  }
});

/** Görsel ekle. */
router.post("/menu-styles/:id/images", async (req, res) => {
  try {
    const { data: row, error: readErr } = await db.from(TABLE).select("*").eq("id", req.params.id).single();
    if (readErr) throw readErr;

    const added = await ingestImages(req.body?.images, "menu");
    if (!added.length) return fail(res, 400, "Görsel eklenemedi");

    const next = [...urls(row), ...added].slice(0, MAX_IMAGES);
    const { data, error } = await db.from(TABLE).update({ image_urls: next }).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, style: data });
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] görsel ekleme hatası:", err.message);
    fail(res, 500, err.message);
  }
});

/** Görsel çıkar. Son görsel silinemez — görselsiz stilin anlamı yok. */
router.delete("/menu-styles/:id/images", async (req, res) => {
  try {
    const target = text(req.body?.imageUrl, 1000);
    if (!target) return fail(res, 400, "imageUrl gerekli");

    const { data: row, error: readErr } = await db.from(TABLE).select("*").eq("id", req.params.id).single();
    if (readErr) throw readErr;

    const next = urls(row).filter((u) => u !== target);
    if (!next.length) return fail(res, 400, "Son görsel silinemez");

    const { data, error } = await db.from(TABLE).update({ image_urls: next }).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, style: data });
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] görsel silme hatası:", err.message);
    fail(res, 500, err.message);
  }
});

/**
 * OPSİYONEL stil promptu üretimi. Kayıt akışının parçası değildir;
 * yalnız operatör açıkça isterse çalışır.
 */
router.post("/menu-styles/:id/analyze", async (req, res) => {
  try {
    const { data: row, error: readErr } = await db.from(TABLE).select("*").eq("id", req.params.id).single();
    if (readErr) throw readErr;

    const imageUrls = urls(row);
    if (!imageUrls.length) return fail(res, 400, "Analiz için görsel yok");

    await db.from(TABLE).update({ status: "analyzing", analysis_error: null }).eq("id", row.id);

    try {
      const prompt = await analyzeMenuStyle(imageUrls, row.category);
      const { data, error } = await db
        .from(TABLE)
        .update({ style_prompt: prompt, status: "ready", analysis_error: null })
        .eq("id", row.id)
        .select()
        .single();
      if (error) throw error;
      res.json({ success: true, style: data });
    } catch (err) {
      await db.from(TABLE).update({ status: "failed", analysis_error: err.message.slice(0, 500) }).eq("id", row.id);
      throw err;
    }
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] analiz hatası:", err.message);
    fail(res, 500, err.message);
  }
});

/** Sil. Depodaki dosyalar bırakılır — başka kayıt aynı linki kullanıyor olabilir. */
router.delete("/menu-styles/:id", async (req, res) => {
  try {
    const { error } = await db.from(TABLE).delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] silme hatası:", err.message);
    fail(res, 500, err.message);
  }
});


/* ───────────────────── token'sız eklenti ucu ───────────────────── */
//
// Chrome eklentisi admin token taşımıyor (kullanıcı isteği, 18 Eyl 2026), bu
// yüzden clip ucu ayrı bir router'da ve requireAdmin ALTINDA DEĞİL.
// Banner Stüdyosu'nun /api/banner-studio/styles ucuyla aynı model.
//
// ⚠️ Açık uç olduğu için iki ucuz koruma var: yalnız görsel kabul edilir
// (tür + boyut doğrulanır, kendi depomuza yazılır) ve dakikalık bir tavan
// konur. Yazma dışında hiçbir veri dönmez.
const clipRouter = express.Router();

const CLIP_WINDOW_MS = 60 * 1000;
const CLIP_MAX_PER_WINDOW = 60;
let clipWindowStart = 0;
let clipCount = 0;

function clipRateLimited() {
  const now = Date.now();
  if (now - clipWindowStart > CLIP_WINDOW_MS) {
    clipWindowStart = now;
    clipCount = 0;
  }
  clipCount += 1;
  return clipCount > CLIP_MAX_PER_WINDOW;
}

/** Eklentinin "Bağlantıyı test et" düğmesi için — yalnız sayı döner. */
clipRouter.get("/count", async (_req, res) => {
  try {
    const { count, error } = await db.from(TABLE).select("id", { count: "exact", head: true });
    if (error) throw error;
    res.json({ success: true, count: count ?? 0 });
  } catch (err) {
    fail(res, 500, err.message);
  }
});

/**
 * 📎 Chrome eklentisi ucu — tek görsel, tek istek.
 *
 * auto-style-clipper'daki "+" butonu buraya düşer. Panel akışından farkı:
 * isim zorunlu değil (kategori + tarihten türetilir) ve görsel tekil gelir.
 * Eklenti base64 gönderemezse (CORS) URL gönderir, indirmeyi sunucu yapar —
 * her iki durumda da görsel KENDİ depomuza yazılır, hotlink kalmaz.
 *
 * body: { imageBase64? , imageUrl?, category?, tags?, name? }
 */
clipRouter.post("/clip", async (req, res) => {
  try {
    if (clipRateLimited()) return fail(res, 429, "Çok fazla istek — bir dakika bekleyin");

    const category = cleanCategory(req.body?.category);
    const image = req.body?.imageBase64
      ? { base64: req.body.imageBase64 }
      : req.body?.imageUrl
        ? { url: req.body.imageUrl }
        : null;
    if (!image) return fail(res, 400, "imageBase64 veya imageUrl gerekli");

    const imageUrls = await ingestImages([image], "clip");
    if (!imageUrls.length) return fail(res, 400, "Görsel alınamadı");

    // İsim verilmediyse kategori + zamandan türet; operatör panelden düzeltir.
    // ⚠️ SANİYE dahil: eklentiyle arka arkaya eklenen kayıtlar aynı dakikaya
    // düştüğünde isimleri birbirinin aynısı oluyordu ve listede ayırt
    // edilemiyorlardı (18 Eyl 2026, dört kayıt da "… 18/09 23:46" çıktı).
    const label = { food: "Yemek", dessert: "Tatlı", drink: "İçecek", breakfast: "Kahvaltı", wine: "Şarap", other: "Menü" }[category];
    const stamp = new Date().toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const name = text(req.body?.name, 120) || `${label} menüsü — ${stamp}`;

    const { data, error } = await db
      .from(TABLE)
      .insert({
        name,
        image_urls: imageUrls,
        category,
        tags: cleanTags(req.body?.tags),
        created_by: "clipper",
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, style: data });
  } catch (err) {
    console.error("🍽️ [MENU_STYLE] clip hatası:", err.message);
    fail(res, 500, err.message);
  }
});


module.exports = router;
module.exports.clipRouter = clipRouter;
module.exports._test = { storeBase64Image, rehost, ingestImages, analyzeMenuStyle, cleanCategory, CATEGORIES, MENU_STYLE_PROMPT };
