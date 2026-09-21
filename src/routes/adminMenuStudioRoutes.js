// 🍽️ Menü stüdyosu API'si — restoranlara baskıya hazır yemek menüsü.
// Tablolar: admin_menu_projects / admin_menu_items / admin_menu_revisions
// (migrations/admin_menu_studio.sql). Tüm uçlar app.js'te requireAdmin arkasında.
//
// İki uzun iş ARKA PLANDA çalışır (HTTP isteği beklemez, istemci durum sorgular):
//   • /research — fotoğrafı eksik yemekler için Astra + web araması
//   • /generate — menü tasarımının HTML olarak üretilmesi
// Durum admin_menu_projects.status alanında: draft → researching/generating → ready|error
const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const { supabaseAdmin, supabase: supabaseAnon } = require("../supabaseClient");
const {
  researchDishes,
  designMenu,
  planDesignAssets,
  analyzePhotoStyle,
  analyzeReferenceDesign,
  verifyDishPhotos,
  PAGE_SPECS,
  getMenuModel,
} = require("../utils/menuStudioAstra");
const { generateDishImage, generateDesignAsset, restyleDishImage } = require("../utils/menuDishImage");

const db = supabaseAdmin || supabaseAnon;

const STORAGE_BUCKET = "reference";
const STORAGE_PREFIX = "menu-studio/";
const POSITION_STEP = 1000;
// Wikimedia vb. kaynaklar kimliksiz isteklere 403/429 döndürüyor; iletişim
// bilgisi içeren açıklayıcı UA onların politikasının istediği biçim.
const FETCH_UA = "DiressMenuStudio/1.0 (+https://diress.ai; info@monailisa.com)";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIN_IMAGE_BYTES = 6 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);
const fail = (res, status, error) => res.status(status).json({ success: false, error });

const text = (v, max = 500) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/* ───────────────────── Görsel yardımcıları ───────────────────── */

/** Buffer'ı depoya koy, herkese açık URL döndür. */
async function storeImage(buffer, contentType, tag, { keepAlpha = false } = {}) {
  let out = buffer;
  let type = contentType && /^image\//i.test(contentType) ? contentType : "image/jpeg";
  let ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";

  // Baskı için 1800px yeterli; sharp yoksa (ör. bazı ortamlar) ham buffer kullanılır.
  // ⚠️ keepAlpha: saydam tasarım öğeleri JPEG'e çevrilirse şeffaflık gider → PNG kalır.
  try {
    const sharp = require("sharp");
    const pipeline = sharp(buffer)
      .rotate()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true });
    if (keepAlpha) {
      out = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      type = "image/png";
      ext = "png";
    } else {
      out = await pipeline.jpeg({ quality: 86 }).toBuffer();
      type = "image/jpeg";
      ext = "jpg";
    }
  } catch (err) {
    console.warn("🍽️ [MENU] sharp atlandı, ham görsel yükleniyor:", err.message);
  }

  const fileName = `${STORAGE_PREFIX}${tag || "item"}_${Date.now()}_${uuidv4().slice(0, 8)}.${ext}`;
  const { error } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, out, { contentType: type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`Depolama hatası: ${error.message}`);
  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

/** data URI / base64 görseli depoya koy. */
async function storeBase64Image(base64, tag) {
  const raw = String(base64 || "");
  const match = raw.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  const body = match ? match[2] : raw.replace(/^data:[^,]+,/, "");
  const buffer = Buffer.from(body, "base64");
  if (buffer.length < 100) throw new Error("Görsel okunamadı");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Görsel çok büyük (en fazla 15 MB)");
  return storeImage(buffer, match ? match[1] : "image/jpeg", tag);
}

/**
 * İnternetten bulunan aday görseli DOĞRULA ve KENDİ DEPOMUZA AL.
 * Hotlink kırılmasın, kaynak sonradan silinince menü bozulmasın diye
 * bulunan URL'ye asla doğrudan güvenilmez.
 * @returns {Promise<string|null>} kalıcı URL ya da null (aday geçersiz)
 */
async function rehostCandidate(url, tag, { keepAlpha = false } = {}) {
  try {
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
      console.warn(`🍽️ [MENU] aday reddedildi (tür ${contentType || "?"}): ${url}`);
      return null;
    }
    const buffer = Buffer.from(resp.data);
    if (buffer.length < MIN_IMAGE_BYTES) {
      console.warn(`🍽️ [MENU] aday reddedildi (çok küçük ${buffer.length}b): ${url}`);
      return null;
    }
    return await storeImage(buffer, contentType, tag, { keepAlpha });
  } catch (err) {
    console.warn(`🍽️ [MENU] aday indirilemedi: ${url} — ${err.message}`);
    return null;
  }
}

/* ───────────────────── Ortak sorgular ───────────────────── */

async function loadProject(id) {
  const { data, error } = await db.from("admin_menu_projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data?.menu_style_id) {
    // Hazır stilin tarifi ve adı projede saklanmıyor; okurken iliştiriyoruz.
    const { data: style } = await db
      .from("menu_styles")
      .select("id, name, category, style_prompt")
      .eq("id", data.menu_style_id)
      .maybeSingle();
    if (style) {
      data.style_prompt = style.style_prompt || null;
      data.menu_style = { id: style.id, name: style.name, category: style.category };
    }
  }
  return data;
}

/**
 * Seçilen hazır menü stilini projeye uygula: stilin TÜM sayfaları referans olur.
 * Yeni bir örnek yüklenmiş gibi davranır — türetilmiş her şey geçersizleşir.
 */
async function applyMenuStyle(styleId) {
  const { data: style, error } = await db
    .from("menu_styles")
    .select("id, name, image_urls, style_prompt, active")
    .eq("id", styleId)
    .maybeSingle();
  if (error) throw error;
  if (!style) return null;
  const images = (Array.isArray(style.image_urls) ? style.image_urls : []).filter(Boolean);
  if (!images.length) return null;
  return {
    menu_style_id: style.id,
    reference_image_url: images[0],
    reference_image_urls: images.slice(1, 6),
  };
}

async function loadItems(projectId) {
  const { data, error } = await db
    .from("admin_menu_items")
    .select("*")
    .eq("project_id", projectId)
    .eq("archived", false)
    .order("position", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function setStatus(id, status, errorMessage = null) {
  await db.from("admin_menu_projects").update({ status, error_message: errorMessage }).eq("id", id);
}

/** Üretilen her HTML bir sürüm bırakır (en fazla 20 tutulur). */
async function pushRevision(projectId, html, label) {
  if (!html) return;
  await db.from("admin_menu_revisions").insert({ project_id: projectId, html, label: text(label, 120) });
  const { data } = await db
    .from("admin_menu_revisions")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .range(20, 99);
  const stale = (data || []).map((r) => r.id);
  if (stale.length) await db.from("admin_menu_revisions").delete().in("id", stale);
}

/* ───────────────────── Projeler ───────────────────── */

router.get("/menu-studio/projects", async (req, res) => {
  try {
    const { data, error } = await db
      .from("admin_menu_projects")
      .select("*")
      .order("archived", { ascending: true })
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const ids = (data || []).map((p) => p.id);
    const counts = {};
    if (ids.length) {
      const { data: items } = await db
        .from("admin_menu_items")
        .select("project_id, image_url")
        .in("project_id", ids)
        .eq("archived", false);
      for (const it of items || []) {
        const c = (counts[it.project_id] = counts[it.project_id] || { items: 0, withImage: 0 });
        c.items += 1;
        if (it.image_url) c.withImage += 1;
      }
    }
    res.json({
      success: true,
      projects: (data || []).map((p) => ({ ...p, counts: counts[p.id] || { items: 0, withImage: 0 } })),
      pageSizes: Object.entries(PAGE_SPECS).map(([key, v]) => ({ key, label: v.label })),
    });
  } catch (err) {
    console.error("🍽️ [MENU] proje listesi hatası:", err.message);
    fail(res, 500, "Projeler yüklenemedi");
  }
});

router.get("/menu-studio/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    const [items, revisions, assets] = await Promise.all([
      loadItems(id),
      db
        .from("admin_menu_revisions")
        .select("id, label, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("admin_menu_assets").select("*").eq("project_id", id).order("position", { ascending: true }),
    ]);
    res.json({
      success: true,
      project,
      items,
      revisions: revisions.data || [],
      assets: assets.data || [],
    });
  } catch (err) {
    console.error("🍽️ [MENU] proje detay hatası:", err.message);
    fail(res, 500, "Proje yüklenemedi");
  }
});

router.post("/menu-studio/projects", async (req, res) => {
  try {
    const restaurant = text(req.body?.restaurant_name, 160);
    if (!restaurant) return fail(res, 400, "Restoran adı gerekli");
    const payload = {
      restaurant_name: restaurant,
      subtitle: text(req.body?.subtitle, 200),
      cuisine: text(req.body?.cuisine, 160),
      language: text(req.body?.language, 8) || "tr",
      currency: text(req.body?.currency, 8) || "₺",
      page_size: PAGE_SPECS[req.body?.page_size] ? req.body.page_size : "A4",
      notes: text(req.body?.notes, 2000),
    };
    // Proje açılırken hazır bir menü stili seçilebilir
    if (isUuid(req.body?.menu_style_id)) {
      const applied = await applyMenuStyle(req.body.menu_style_id);
      if (applied) Object.assign(payload, applied);
    }
    const { data, error } = await db.from("admin_menu_projects").insert(payload).select().single();
    if (error) throw error;
    res.json({ success: true, project: data });
  } catch (err) {
    console.error("🍽️ [MENU] proje oluşturma hatası:", err.message);
    fail(res, 500, "Proje oluşturulamadı");
  }
});

router.patch("/menu-studio/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
    const b = req.body || {};
    const patch = {};
    if ("restaurant_name" in b) {
      const v = text(b.restaurant_name, 160);
      if (!v) return fail(res, 400, "Restoran adı boş olamaz");
      patch.restaurant_name = v;
    }
    for (const [key, max] of [["subtitle", 200], ["cuisine", 160], ["notes", 2000]]) {
      if (key in b) patch[key] = text(b[key], max);
    }
    if ("language" in b) patch.language = text(b.language, 8) || "tr";
    if ("currency" in b) patch.currency = text(b.currency, 8) || "₺";
    if ("page_size" in b && PAGE_SPECS[b.page_size]) patch.page_size = b.page_size;
    if ("archived" in b) patch.archived = !!b.archived;

    // Tasarım seçenekleri (18 Eyl 2026)
    if ("show_prices" in b) patch.show_prices = !!b.show_prices;
    if ("show_descriptions" in b) patch.show_descriptions = !!b.show_descriptions;
    if ("category_mode" in b && ["auto", "grouped", "flat"].includes(b.category_mode)) patch.category_mode = b.category_mode;
    if ("photo_mode" in b && ["auto", "rich", "sparse", "none"].includes(b.photo_mode)) patch.photo_mode = b.photo_mode;
    if ("design_direction" in b && ["free", "modern", "bold", "minimal", "dark", "warm", "playful"].includes(b.design_direction)) {
      patch.design_direction = b.design_direction;
    }
    if ("density" in b && ["airy", "balanced", "dense"].includes(b.density)) patch.density = b.density;
    if ("page_continuity" in b) patch.page_continuity = !!b.page_continuity;
    if ("auto_photo_style" in b) patch.auto_photo_style = !!b.auto_photo_style;
    if ("page_target" in b && ["auto", "single", "spread", "booklet"].includes(b.page_target)) {
      patch.page_target = b.page_target;
    }
    if ("accent_color" in b) patch.accent_color = text(b.accent_color, 40);
    if ("reference_note" in b) patch.reference_note = text(b.reference_note, 500);
    if ("reference_strength" in b && ["loose", "close", "strict"].includes(b.reference_strength)) {
      patch.reference_strength = b.reference_strength;
    }

    if ("photo_refresh_mode" in b && ["restyle", "regenerate", "keep"].includes(b.photo_refresh_mode)) {
      patch.photo_refresh_mode = b.photo_refresh_mode;
    }

    // 🎨 Hazır menü stili seçimi — "Menü stilleri" sayfasındaki havuzdan.
    // Stilin bütün sayfaları referans olur; elle yükleme ile aynı yola girer.
    if ("menu_style_id" in b) {
      if (b.menu_style_id === null) {
        patch.menu_style_id = null;
        patch.reference_image_url = null;
        patch.reference_image_urls = [];
      } else if (isUuid(b.menu_style_id)) {
        const applied = await applyMenuStyle(b.menu_style_id);
        if (!applied) return fail(res, 400, "Bu stilde kullanılabilir görsel yok");
        Object.assign(patch, applied);
      }
    }

    // Örnek tasarım görseli: yükleme ya da kaldırma (elle)
    if (b.reference_image_base64) {
      patch.reference_image_url = await storeBase64Image(b.reference_image_base64, "reference");
      patch.reference_image_urls = [];
      patch.menu_style_id = null;
    } else if (b.reference_image_url === null) {
      patch.reference_image_url = null;
      patch.reference_image_urls = [];
      patch.menu_style_id = null;
    }

    // ⚠️ ÖRNEK DEĞİŞTİYSE türetilmiş her şey geçersiz: fotoğraf stili, kesme
    // kararı ve katman künyesi yeni referansa göre baştan çıkarılmalı; stil
    // sürümü artınca mevcut fotoğraflar "yeniden uyarlanmalı" durumuna düşer.
    // (18 Eyl 2026: yeni tasarıma geçilince eski yan açılı fotoğraflar kalıyordu.)
    if ("reference_image_url" in patch) {
      const current = await loadProject(id);
      if (current && current.reference_image_url !== patch.reference_image_url) {
        patch.photo_style = null;
        patch.photo_cutout = false;
        patch.design_spec = null;
        patch.style_version = (Number(current.style_version) || 1) + 1;
        patch.redesign_pending = true;
      }
    }

    // 🎨 Yapısal ayarlar değişirse tasarımın baştan çizilmesi gerekir; içerik
    // anahtarları (fiyat/açıklama/fotoğraf) mevcut belge üzerinde revize edilir.
    // Böylece küçük bir düzenleme her seferinde tasarımı kaydırmıyor.
    const STRUCTURAL = [
      "page_size",
      "design_direction",
      "density",
      "category_mode",
      "page_target",
      "page_continuity",
      "accent_color",
      "reference_strength",
      "reference_note",
    ];
    if (!patch.redesign_pending && STRUCTURAL.some((k) => k in patch)) {
      const before = await loadProject(id);
      if (before && STRUCTURAL.some((k) => k in patch && before[k] !== patch[k])) {
        patch.redesign_pending = true;
      }
    }
    // Operatörün baskı önizlemesinde düzenlediği HTML
    if ("html" in b) {
      patch.html = typeof b.html === "string" && b.html.trim() ? b.html : null;
      if (patch.html) patch.status = "ready";
    }
    if (!Object.keys(patch).length) return fail(res, 400, "Güncellenecek alan yok");

    if ("html" in b && b.save_revision) {
      const current = await loadProject(id);
      if (current?.html) await pushRevision(id, current.html, "Düzenleme öncesi");
    }

    const { error } = await db.from("admin_menu_projects").update(patch).eq("id", id);
    if (error) throw error;
    // loadProject seçilen hazır stilin adını/tarifini de iliştirir
    res.json({ success: true, project: await loadProject(id) });
  } catch (err) {
    console.error("🍽️ [MENU] proje güncelleme hatası:", err.message);
    fail(res, 500, "Proje güncellenemedi");
  }
});

router.delete("/menu-studio/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
    const { error } = await db.from("admin_menu_projects").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("🍽️ [MENU] proje silme hatası:", err.message);
    fail(res, 500, "Proje silinemedi");
  }
});

/* ───────────────────── Yemekler ───────────────────── */

router.post("/menu-studio/projects/:id/items", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");

    // Toplu ekleme: satır satır yapıştırılan liste
    const bulk = typeof req.body?.bulk === "string" ? req.body.bulk : null;
    const rows = [];
    if (bulk) {
      const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 200);
      for (const line of lines) {
        // "Ad - açıklama - 120" / "Ad 120" gibi serbest biçimleri ayıkla
        const priceMatch = line.match(/(?:^|[\s\-–—|:])(\d{1,6}(?:[.,]\d{1,2})?)\s*$/);
        const price = priceMatch ? priceMatch[1] : null;
        const rest = priceMatch ? line.slice(0, priceMatch.index).trim() : line;
        const parts = rest.split(/\s+[-–—|]\s+/);
        rows.push({
          name: text(parts[0], 160) || text(rest, 160),
          description: parts.length > 1 ? text(parts.slice(1).join(" – "), 400) : null,
          price,
        });
      }
    } else {
      const name = text(req.body?.name, 160);
      if (!name) return fail(res, 400, "Yemek adı gerekli");
      rows.push({
        name,
        description: text(req.body?.description, 400),
        price: text(req.body?.price, 40),
        category: text(req.body?.category, 80),
      });
    }
    if (!rows.length) return fail(res, 400, "Eklenecek satır yok");

    const { data: last } = await db
      .from("admin_menu_items")
      .select("position")
      .eq("project_id", id)
      .order("position", { ascending: false })
      .limit(1);
    let position = (last && last[0] ? Number(last[0].position) : 0) || 0;

    // Tek kayıtta görsel de gelebilir (base64)
    let imageUrl = null;
    let imageSource = null;
    if (!bulk && req.body?.image_base64) {
      imageUrl = await storeBase64Image(req.body.image_base64, "upload");
      imageSource = "upload";
    }

    const payload = rows.map((r, i) => ({
      project_id: id,
      name: r.name,
      description: r.description || null,
      price: r.price || null,
      category: r.category || text(req.body?.category, 80) || null,
      position: (position += POSITION_STEP),
      ...(i === 0 && imageUrl ? { image_url: imageUrl, image_source: imageSource } : {}),
    }));

    const { data, error } = await db.from("admin_menu_items").insert(payload).select();
    if (error) throw error;
    res.json({ success: true, items: data });
  } catch (err) {
    console.error("🍽️ [MENU] yemek ekleme hatası:", err.message);
    fail(res, 500, err.message || "Yemek eklenemedi");
  }
});

router.patch("/menu-studio/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz yemek kimliği");
    const b = req.body || {};
    const patch = {};
    if ("name" in b) {
      const v = text(b.name, 160);
      if (!v) return fail(res, 400, "Yemek adı boş olamaz");
      patch.name = v;
    }
    if ("description" in b) patch.description = text(b.description, 400);
    if ("price" in b) patch.price = text(b.price, 40);
    if ("category" in b) patch.category = text(b.category, 80);
    if ("research_note" in b) patch.research_note = text(b.research_note, 300);
    if ("archived" in b) patch.archived = !!b.archived;
    if ("position" in b && Number.isFinite(Number(b.position))) patch.position = Number(b.position);

    // Görsel: yeni yükleme, kaldırma ya da dışarıdan URL
    if (b.image_base64) {
      patch.image_url = await storeBase64Image(b.image_base64, "upload");
      patch.image_source = "upload";
      patch.image_credit = null;
    } else if (b.image_url === null) {
      patch.image_url = null;
      patch.image_source = null;
      patch.image_credit = null;
    } else if (typeof b.image_url === "string" && /^https?:\/\//i.test(b.image_url)) {
      const stored = await rehostCandidate(b.image_url, "manual");
      if (!stored) return fail(res, 400, "Görsel indirilemedi — bağlantıyı kontrol edin");
      patch.image_url = stored;
      patch.image_source = "web";
      patch.image_credit = text(b.image_credit, 200);
    }

    if (!Object.keys(patch).length) return fail(res, 400, "Güncellenecek alan yok");
    const { data, error } = await db.from("admin_menu_items").update(patch).eq("id", id).select().single();
    if (error) throw error;
    res.json({ success: true, item: data });
  } catch (err) {
    console.error("🍽️ [MENU] yemek güncelleme hatası:", err.message);
    fail(res, 500, err.message || "Yemek güncellenemedi");
  }
});

router.delete("/menu-studio/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz yemek kimliği");
    const { error } = await db.from("admin_menu_items").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("🍽️ [MENU] yemek silme hatası:", err.message);
    fail(res, 500, "Yemek silinemedi");
  }
});

// Sıralama: istemci yeni position'ı (komşuların ortası) gönderir
router.post("/menu-studio/items/:id/move", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz yemek kimliği");
    const position = Number(req.body?.position);
    if (!Number.isFinite(position)) return fail(res, 400, "Geçersiz konum");
    const { data, error } = await db
      .from("admin_menu_items")
      .update({ position })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, item: data });
  } catch (err) {
    console.error("🍽️ [MENU] sıralama hatası:", err.message);
    fail(res, 500, "Sıra değiştirilemedi");
  }
});

/* ───────────── AI ile yemek fotoğrafı (GPT Image 2.5 medium) ───────────── */

/** Tek yemeğe fotoğraf üret ve kendi depomuza al. */
async function generateImageForItem(item, project, { stamp = true } = {}) {
  const cutout = !!project?.photo_cutout;
  const falUrl = await generateDishImage({
    name: item.name,
    description: item.description,
    cuisine: project?.cuisine,
    // Referanstan çıkarılmış fotoğraf stili varsa tüm kareler ona uyar
    style: project?.photo_style || undefined,
    cutout,
  });
  // Kesme görselde saydamlık korunmalı → PNG olarak saklanır
  const stored = await rehostCandidate(falUrl, "ai", { keepAlpha: cutout });
  if (!stored) throw new Error("Üretilen görsel kaydedilemedi");
  await db
    .from("admin_menu_items")
    .update({
      image_url: stored,
      image_source: "ai",
      image_credit: null,
      ...(stamp ? { styled_version: Number(project?.style_version) || 1 } : {}),
    })
    .eq("id", item.id);
  return stored;
}

// Tek yemek — senkron (≈20 sn), istemci düğmede bekler
router.post("/menu-studio/items/:id/generate-image", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz yemek kimliği");
    const { data: item } = await db.from("admin_menu_items").select("*").eq("id", id).maybeSingle();
    if (!item) return fail(res, 404, "Yemek bulunamadı");
    const project = await loadProject(item.project_id);
    const url = await generateImageForItem(item, project);
    const { data } = await db.from("admin_menu_items").select("*").eq("id", id).maybeSingle();
    res.json({ success: true, image_url: url, item: data });
  } catch (err) {
    console.error("🍳 [MENU] görsel üretim hatası:", err.message);
    fail(res, 500, err.message || "Görsel üretilemedi");
  }
});

// Fotoğrafı olmayan tüm yemekler — arka planda
router.post("/menu-studio/projects/:id/generate-images", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
  try {
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    if (project.status === "researching" || project.status === "generating") {
      return fail(res, 409, "Bu proje için bir işlem zaten sürüyor");
    }
    const items = await loadItems(id);
    const targets = items.filter((i) => !i.image_url);
    if (!targets.length) return fail(res, 400, "Fotoğrafı eksik yemek yok");

    await setStatus(id, "researching");
    res.json({ success: true, status: "researching", count: targets.length });

    const previous = project.html ? "ready" : "draft";
    (async () => {
      let done = 0;
      for (const item of targets) {
        try {
          await generateImageForItem(item, project);
          done += 1;
        } catch (err) {
          console.warn(`🍳 [MENU] ${item.name} için görsel üretilemedi: ${err.message}`);
        }
      }
      console.log(`🍳 [MENU] toplu görsel üretimi bitti: ${done}/${targets.length}`);
      await setStatus(id, previous);
    })().catch(async (err) => {
      await setStatus(id, "error", err.message?.slice(0, 500) || "Görsel üretimi başarısız");
    });
  } catch (err) {
    console.error("🍳 [MENU] toplu görsel üretimi başlatılamadı:", err.message);
    if (!res.headersSent) fail(res, 500, "Görsel üretimi başlatılamadı");
  }
});

/* ───────── Fotoğraf stili: örnekten çıkar + mevcutları uyarla ───────── */

/**
 * Bir yemeğin fotoğrafını projenin GÜNCEL tasarımına uyarla.
 * mode:
 *   restyle    → mevcut fotoğraftan yola çık (yemek birebir korunur, stil değişir)
 *   regenerate → bu menü için sıfırdan yeni fotoğraf üret
 *   keep       → dokunma
 * Her iki üretimde de kalem `styled_version` ile damgalanır; referans değişip
 * sürüm artınca kalem yeniden yenilenmesi gerektiği anlaşılır.
 */
async function refreshItemPhoto(item, project, modeOverride) {
  const mode = modeOverride || project?.photo_refresh_mode || "restyle";
  if (mode === "keep") return null;

  const version = Number(project?.style_version) || 1;
  const canRestyle = mode === "restyle" && item.image_url && project?.photo_style;
  const url = canRestyle ? await restyleItem(item, project, { stamp: false }) : null;

  if (url) {
    await db.from("admin_menu_items").update({ styled_version: version }).eq("id", item.id);
    return url;
  }
  // regenerate — ya da uyarlanacak fotoğraf yok
  const fresh = await generateImageForItem(item, project, { stamp: false });
  await db
    .from("admin_menu_items")
    .update({
      styled: !!project?.photo_style,
      styled_version: version,
      original_image_url: item.original_image_url || item.image_url || null,
    })
    .eq("id", item.id);
  return fresh;
}

// Referanstaki yemek fotoğraflarının stilini çözümle (senkron, ~15 sn)
router.post("/menu-studio/projects/:id/photo-style", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    if (!project.reference_image_url) return fail(res, 400, "Önce örnek tasarım yükleyin");

    const result = await analyzePhotoStyle({ project });
    if (!result) {
      await db.from("admin_menu_projects").update({ photo_style: null }).eq("id", id);
      return res.json({ success: true, photo_style: null, message: "Örnekte yemek fotoğrafı yok" });
    }
    const { data } = await db
      .from("admin_menu_projects")
      .update({ photo_style: result.style, photo_cutout: result.cutout })
      .eq("id", id)
      .select()
      .single();
    res.json({ success: true, photo_style: result.style, cutout: result.cutout, project: data });
  } catch (err) {
    console.error("📷 [MENU] fotoğraf stili hatası:", err.message);
    fail(res, 500, err.message || "Fotoğraf stili çıkarılamadı");
  }
});

/** Tek yemeğin fotoğrafını projenin stiline getir (yemek korunur, stil değişir). */
async function restyleItem(item, project, { stamp = true } = {}) {
  if (!item.image_url) throw new Error("Bu yemeğin fotoğrafı yok");
  if (!project?.photo_style) throw new Error("Önce örnekten fotoğraf stilini çıkarın");
  const cutout = !!project.photo_cutout;
  const falUrl = await restyleDishImage({
    imageUrl: item.image_url,
    name: item.name,
    style: project.photo_style,
    cutout,
  });
  const stored = await rehostCandidate(falUrl, "styled", { keepAlpha: cutout });
  if (!stored) throw new Error("Stillendirilen görsel kaydedilemedi");
  await db
    .from("admin_menu_items")
    .update({
      image_url: stored,
      styled: true,
      ...(stamp ? { styled_version: Number(project.style_version) || 1 } : {}),
      // İlk stillendirmede özgün hâli sakla — geri alınabilsin
      original_image_url: item.original_image_url || item.image_url,
    })
    .eq("id", item.id);
  return stored;
}

router.post("/menu-studio/items/:id/restyle-image", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz yemek kimliği");
    const { data: item } = await db.from("admin_menu_items").select("*").eq("id", id).maybeSingle();
    if (!item) return fail(res, 404, "Yemek bulunamadı");
    const project = await loadProject(item.project_id);
    const mode = ["restyle", "regenerate"].includes(req.body?.mode) ? req.body.mode : undefined;
    await refreshItemPhoto(item, project, mode);
    const { data } = await db.from("admin_menu_items").select("*").eq("id", id).maybeSingle();
    res.json({ success: true, item: data });
  } catch (err) {
    console.error("📷 [MENU] stillendirme hatası:", err.message);
    fail(res, 500, err.message || "Fotoğraf stile uyarlanamadı");
  }
});

// Özgün fotoğrafa dön
router.post("/menu-studio/items/:id/revert-image", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz yemek kimliği");
    const { data: item } = await db.from("admin_menu_items").select("*").eq("id", id).maybeSingle();
    if (!item?.original_image_url) return fail(res, 400, "Geri dönülecek özgün fotoğraf yok");
    const { data } = await db
      .from("admin_menu_items")
      .update({ image_url: item.original_image_url, styled: false, original_image_url: null })
      .eq("id", id)
      .select()
      .single();
    res.json({ success: true, item: data });
  } catch (err) {
    console.error("📷 [MENU] geri alma hatası:", err.message);
    fail(res, 500, "Geri alınamadı");
  }
});

// Tüm fotoğrafları stile getir — arka planda
router.post("/menu-studio/projects/:id/restyle-images", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
  try {
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    if (!project.photo_style) return fail(res, 400, "Önce örnekten fotoğraf stilini çıkarın");
    if (project.status === "researching" || project.status === "generating") {
      return fail(res, 409, "Bu proje için bir işlem zaten sürüyor");
    }
    const version = Number(project.style_version) || 1;
    const mode = ["restyle", "regenerate"].includes(req.body?.mode)
      ? req.body.mode
      : project.photo_refresh_mode === "keep"
        ? "restyle"
        : project.photo_refresh_mode || "restyle";
    const items = await loadItems(id);
    const targets = items.filter(
      (i) => (i.image_url || mode === "regenerate") && (req.body?.force || i.styled_version !== version),
    );
    if (!targets.length) return fail(res, 400, "Uyarlanacak fotoğraf yok");

    await setStatus(id, "researching");
    res.json({ success: true, status: "researching", count: targets.length });

    const previous = project.html ? "ready" : "draft";
    (async () => {
      let done = 0;
      for (const item of targets) {
        try {
          await refreshItemPhoto(item, project, mode);
          done += 1;
        } catch (err) {
          console.warn(`📷 [MENU] ${item.name} stile uyarlanamadı: ${err.message}`);
        }
      }
      console.log(`📷 [MENU] stillendirme bitti (${mode}): ${done}/${targets.length}`);
      await setStatus(id, previous);
    })().catch(async (err) => {
      await setStatus(id, "error", err.message?.slice(0, 500) || "Stillendirme başarısız");
    });
  } catch (err) {
    console.error("📷 [MENU] stillendirme başlatılamadı:", err.message);
    if (!res.headersSent) fail(res, 500, "Stillendirme başlatılamadı");
  }
});

/* ───────── Tasarım öğeleri (arka plan / doku / süsleme) ───────── */

async function loadAssets(projectId) {
  const { data } = await db
    .from("admin_menu_assets")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  return data || [];
}

/** Astra öğeleri planlar → her biri GPT Image 2.5 ile üretilir → depoya alınır. */
async function buildDesignAssets(projectId, { replace = true } = {}) {
  const project = await loadProject(projectId);
  if (!project) throw new Error("Proje bulunamadı");
  const items = await loadItems(projectId);

  const specs = await planDesignAssets({ project, items });
  if (!specs.length) {
    console.log("🎨 [MENU] Astra tasarım öğesi gerekmediğini bildirdi");
    return { planned: 0, created: 0 };
  }
  if (replace) await db.from("admin_menu_assets").delete().eq("project_id", projectId);

  let created = 0;
  let position = 0;
  for (const spec of specs) {
    try {
      const falUrl = await generateDesignAsset({
        prompt: spec.prompt,
        transparent: spec.transparent,
        aspect: spec.aspect,
      });
      const stored = await rehostCandidate(falUrl, "asset", { keepAlpha: spec.transparent });
      if (!stored) throw new Error("öğe kaydedilemedi");
      await db.from("admin_menu_assets").insert({
        project_id: projectId,
        role: spec.role,
        label: spec.label,
        prompt: spec.prompt,
        usage_note: spec.usage,
        image_url: stored,
        transparent: spec.transparent,
        aspect: spec.aspect,
        position: (position += 1000),
      });
      created += 1;
    } catch (err) {
      console.warn(`🎨 [MENU] "${spec.label}" öğesi üretilemedi: ${err.message}`);
    }
  }
  console.log(`🎨 [MENU] tasarım öğeleri: ${created}/${specs.length} üretildi`);
  return { planned: specs.length, created };
}

router.post("/menu-studio/projects/:id/design-assets", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
  try {
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    if (project.status === "researching" || project.status === "generating") {
      return fail(res, 409, "Bu proje için bir işlem zaten sürüyor");
    }
    await setStatus(id, "researching");
    res.json({ success: true, status: "researching" });

    const previous = project.html ? "ready" : "draft";
    buildDesignAssets(id, { replace: req.body?.replace !== false })
      .then(() => setStatus(id, previous))
      .catch(async (err) => {
        console.error("🎨 [MENU] tasarım öğesi hatası:", err.message);
        await setStatus(id, "error", err.message?.slice(0, 500) || "Tasarım öğeleri üretilemedi");
      });
  } catch (err) {
    console.error("🎨 [MENU] tasarım öğesi başlatılamadı:", err.message);
    if (!res.headersSent) fail(res, 500, "Tasarım öğeleri başlatılamadı");
  }
});

router.delete("/menu-studio/assets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz öğe kimliği");
    const { error } = await db.from("admin_menu_assets").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("🎨 [MENU] öğe silme hatası:", err.message);
    fail(res, 500, "Öğe silinemedi");
  }
});

/* ───────────────── Araştırma (Astra + web araması) ───────────────── */

async function runResearch(projectId, { onlyMissing = true, itemIds = null } = {}) {
  const project = await loadProject(projectId);
  if (!project) throw new Error("Proje bulunamadı");
  const items = await loadItems(projectId);

  const targets = items.filter((it) => {
    if (itemIds && itemIds.length) return itemIds.includes(it.id);
    if (!onlyMissing) return true;
    return !it.image_url || !it.description;
  });
  if (!targets.length) return { updated: 0, skipped: 0 };

  const rows = await researchDishes({
    dishes: targets.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      category: it.category,
      needsImage: !it.image_url,
    })),
    restaurantName: project.restaurant_name,
    cuisine: project.cuisine,
    language: project.language,
  });

  let updated = 0;
  let imagesFound = 0;
  for (const row of rows) {
    const item = targets.find((t) => t.id === row.id);
    if (!item) continue;
    const patch = {};

    // İsim düzeltmesi yalnız gerçekten farklıysa yazılır
    if (row.suggested_name && row.suggested_name !== item.name) patch.name = row.suggested_name;
    if (row.description && !item.description) patch.description = row.description;
    if (row.note) patch.research_note = row.note;

    if (!item.image_url && row.image_candidates.length) {
      for (const cand of row.image_candidates) {
        const stored = await rehostCandidate(cand.url, "web");
        if (stored) {
          patch.image_url = stored;
          patch.image_source = "web";
          patch.image_credit = cand.credit || cand.source_page || null;
          imagesFound += 1;
          break;
        }
      }
    }

    if (Object.keys(patch).length) {
      await db.from("admin_menu_items").update(patch).eq("id", item.id);
      updated += 1;
    }
  }
  console.log(`🍽️ [MENU] araştırma bitti: ${updated}/${targets.length} güncellendi, ${imagesFound} görsel bulundu`);
  return { updated, imagesFound, targets: targets.length };
}

router.post("/menu-studio/projects/:id/research", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
  try {
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    if (project.status === "researching" || project.status === "generating") {
      return fail(res, 409, "Bu proje için bir işlem zaten sürüyor");
    }
    await setStatus(id, "researching");
    res.json({ success: true, status: "researching" });

    // Arka plan: HTTP isteği beklemez, durum tablodan sorgulanır
    const previous = project.html ? "ready" : "draft";
    const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids.filter(isUuid) : null;
    runResearch(id, { onlyMissing: req.body?.only_missing !== false, itemIds })
      .then(() => setStatus(id, previous))
      .catch(async (err) => {
        console.error("🍽️ [MENU] araştırma hatası:", err.message);
        await setStatus(id, "error", err.message?.slice(0, 500) || "Araştırma başarısız");
      });
  } catch (err) {
    console.error("🍽️ [MENU] araştırma başlatılamadı:", err.message);
    if (!res.headersSent) fail(res, 500, "Araştırma başlatılamadı");
  }
});

/* ───────────────── Menü tasarımı (Astra) ───────────────── */

router.post("/menu-studio/projects/:id/generate", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
  try {
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    if (project.status === "researching" || project.status === "generating") {
      return fail(res, 409, "Bu proje için bir işlem zaten sürüyor");
    }
    const items = await loadItems(id);
    if (!items.length) return fail(res, 400, "Önce en az bir yemek ekleyin");

    const feedback = text(req.body?.feedback, 1200);
    // Operatör "tasarımı da baştan çiz" dediyse ya da yapısal bir ayar değiştiyse
    // tam tasarım; aksi hâlde mevcut belge revize edilir.
    const forceRedesign = req.body?.redesign === true || !!project.redesign_pending || !project.html;

    // 🧠 İstek geçmişi. fal'ın router ucu DURUMSUZ — konuşma/hafıza parametresi
    // yok — bu yüzden "içindekiler de yazılsın" gibi eski istekleri biz taşıyoruz.
    // (18 Eyl 2026: her yeni düzenlemede önceki düzenlemeler siliniyordu.)
    const priorLog = Array.isArray(project.feedback_log) ? project.feedback_log : [];
    const standing = priorLog.map((e) => (typeof e === "string" ? e : e?.text)).filter(Boolean);
    if (feedback) {
      await db
        .from("admin_menu_projects")
        .update({ feedback_log: [...priorLog, { text: feedback, at: new Date().toISOString() }].slice(-25) })
        .eq("id", id);
    }

    await setStatus(id, "generating");
    res.json({ success: true, status: "generating" });

    (async () => {
      try {
        // Yeni tasarımdan önce mevcut hâli sürüm olarak sakla
        if (project.html) await pushRevision(id, project.html, "Önceki tasarım");

        // 📐 Örnek tasarım varsa: önce katman künyesi, sonra fotoğraf stili,
        // sonra fotoğrafların güncel tasarıma uyarlanması, sonra doğrulama.
        // Operatör ayrı ayrı düğmelere basmasın diye hepsi burada zincirleniyor.
        let current = project;
        if (current.reference_image_url && current.auto_photo_style !== false) {
          // 1) Katman düzeyi künye — tasarım adımına kontrol listesi olarak gider
          if (!current.design_spec) {
            const spec = await analyzeReferenceDesign({ project: current });
            if (spec) {
              const { data: up } = await db
                .from("admin_menu_projects")
                .update({ design_spec: spec })
                .eq("id", id)
                .select()
                .single();
              if (up) current = up;
              console.log("📐 [MENU] referans katman künyesi çıkarıldı");
            }
          }

          // 2) Fotoğraf stili (açı, kesme olup olmadığı, ışık, renk)
          if (!current.photo_style) {
            const analysed = await analyzePhotoStyle({ project: current });
            if (analysed) {
              const { data: up } = await db
                .from("admin_menu_projects")
                .update({ photo_style: analysed.style, photo_cutout: analysed.cutout })
                .eq("id", id)
                .select()
                .single();
              if (up) current = up;
              console.log(`📷 [MENU] fotoğraf stili çıkarıldı (kesme: ${analysed.cutout}, açı: ${analysed.angle || "?"})`);
            }
          }

          // 3) Bu stil sürümü için henüz yenilenmemiş fotoğrafları yenile
          const mode = current.photo_refresh_mode || "restyle";
          if (mode !== "keep" && current.photo_style) {
            const version = Number(current.style_version) || 1;
            const fresh = await loadItems(id);
            const pending = fresh.filter((i) => (i.image_url || mode === "regenerate") && i.styled_version !== version);
            for (const item of pending) {
              try {
                await refreshItemPhoto(item, current);
              } catch (err) {
                console.warn(`📷 [MENU] ${item.name} yenilenemedi: ${err.message}`);
              }
            }
            if (pending.length) {
              console.log(`📷 [MENU] ${pending.length} fotoğraf "${mode}" kipiyle v${version} tasarımına uyarlandı`);
            }

            // 4) Doğrulama: GPT'den gelen kareler körü körüne kabul edilmez —
            // Astra referansla karşılaştırır, uymayanlar bir kez yeniden üretilir.
            const afterRefresh = await loadItems(id);
            const withPhotos = afterRefresh.filter((i) => i.image_url).slice(0, 8);
            if (withPhotos.length) {
              try {
                const verdicts = await verifyDishPhotos({
                  project: current,
                  photos: withPhotos.map((i) => ({ itemId: i.id, url: i.image_url })),
                });
                const failed = verdicts.filter((v) => !v.ok);
                for (const v of failed) {
                  const item = afterRefresh.find((i) => i.id === v.itemId);
                  if (!item) continue;
                  console.log(`🔁 [MENU] ${item.name} referansa uymadı (${v.reason}) — yeniden üretiliyor`);
                  await db.from("admin_menu_items").update({ style_check: v.reason }).eq("id", item.id);
                  try {
                    // Uyarlama tutmadıysa sıfırdan üretmek daha güvenilir
                    await refreshItemPhoto(item, current, "regenerate");
                  } catch (err) {
                    console.warn(`🔁 [MENU] ${item.name} yeniden üretilemedi: ${err.message}`);
                  }
                }
                for (const v of verdicts.filter((x) => x.ok)) {
                  await db.from("admin_menu_items").update({ style_check: null }).eq("id", v.itemId);
                }
                console.log(`✅ [MENU] fotoğraf denetimi: ${verdicts.length - failed.length}/${verdicts.length} uygun`);
              } catch (err) {
                console.warn("🔁 [MENU] fotoğraf denetimi atlandı:", err.message);
              }
            }
          }
        }

        const freshItems = await loadItems(id);
        const assets = await loadAssets(id);
        const html = await designMenu({
          project: current,
          items: freshItems,
          assets,
          feedback,
          standing,
          // Revize kipi: onaylanmış tasarım korunur, yalnızca istenen değişiklik uygulanır
          baseHtml: forceRedesign ? null : current.html || null,
        });
        console.log(`🎨 [MENU] ${forceRedesign ? "tam tasarım" : "revize"} — ${standing.length} birikmiş istek`);
        const model = await getMenuModel();
        await db
          .from("admin_menu_projects")
          .update({
            html,
            html_generated_at: new Date().toISOString(),
            model,
            status: "ready",
            error_message: null,
            redesign_pending: false,
          })
          .eq("id", id);
        console.log(`🍽️ [MENU] tasarım hazır (${html.length} karakter) — ${project.restaurant_name}`);
      } catch (err) {
        console.error("🍽️ [MENU] tasarım hatası:", err.message);
        await setStatus(id, "error", err.message?.slice(0, 500) || "Tasarım üretilemedi");
      }
    })();
  } catch (err) {
    console.error("🍽️ [MENU] üretim başlatılamadı:", err.message);
    if (!res.headersSent) fail(res, 500, "Üretim başlatılamadı");
  }
});

/* ─────────────── Düzenleme geçmişi (birikimli istekler) ─────────────── */

/**
 * Birikmiş istekleri yönet. Model durumsuz çalıştığı için bu liste her üretimde
 * yeniden gönderilir; operatör artık geçerli olmayan bir isteği buradan siler.
 * Gövde: { remove: <index> } veya { clear: true }
 */
router.post("/menu-studio/projects/:id/feedback", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return fail(res, 400, "Geçersiz proje kimliği");
  try {
    const project = await loadProject(id);
    if (!project) return fail(res, 404, "Proje bulunamadı");
    const log = Array.isArray(project.feedback_log) ? project.feedback_log : [];

    let next;
    if (req.body?.clear) {
      next = [];
    } else if (Number.isInteger(req.body?.remove)) {
      const i = req.body.remove;
      if (i < 0 || i >= log.length) return fail(res, 400, "Geçersiz sıra numarası");
      next = log.filter((_, idx) => idx !== i);
    } else {
      return fail(res, 400, "remove ya da clear gerekli");
    }

    const { data, error } = await db
      .from("admin_menu_projects")
      .update({ feedback_log: next })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, project: data });
  } catch (err) {
    console.error("🍽️ [MENU] istek listesi güncellenemedi:", err.message);
    fail(res, 500, "İstek listesi güncellenemedi");
  }
});

/* ───────────────────── Sürümler ───────────────────── */

router.get("/menu-studio/revisions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz sürüm kimliği");
    const { data, error } = await db.from("admin_menu_revisions").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, "Sürüm bulunamadı");
    res.json({ success: true, revision: data });
  } catch (err) {
    console.error("🍽️ [MENU] sürüm okuma hatası:", err.message);
    fail(res, 500, "Sürüm yüklenemedi");
  }
});

router.post("/menu-studio/revisions/:id/restore", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return fail(res, 400, "Geçersiz sürüm kimliği");
    const { data: rev, error } = await db.from("admin_menu_revisions").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!rev) return fail(res, 404, "Sürüm bulunamadı");

    const project = await loadProject(rev.project_id);
    if (project?.html) await pushRevision(rev.project_id, project.html, "Geri yükleme öncesi");

    const { data, error: upErr } = await db
      .from("admin_menu_projects")
      .update({ html: rev.html, status: "ready", error_message: null })
      .eq("id", rev.project_id)
      .select()
      .single();
    if (upErr) throw upErr;
    res.json({ success: true, project: data });
  } catch (err) {
    console.error("🍽️ [MENU] sürüm geri yükleme hatası:", err.message);
    fail(res, 500, "Sürüm geri yüklenemedi");
  }
});

module.exports = router;
module.exports._test = { rehostCandidate, runResearch, storeBase64Image, generateImageForItem, buildDesignAssets, loadAssets, restyleItem, refreshItemPhoto };
