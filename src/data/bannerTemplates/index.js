// 🧩 Banner şablon galerisi (25 Eyl 2026, kullanıcı isteği)
//
// Elle tasarlanmış HTML bannerlar. ORAN-DUYARLI: banner çerçevesi ürün fotoğrafının oranını alır
// (Film Lab kartları gibi) ve her şablon CSS aspect-ratio sorgularıyla uzun / kare / geniş
// fotoğrafa göre yerleşimini değiştirir; tüm ölçüler vmin.
//
// Uygulama yerelleştirilmiş HTML'leri sunucudan alıp WebView'de canlı çizer;
// build.js `client` yalnız derin bağlantı için şablon kimliklerini üretir.
// "Ürünüme uyarla" / "Metni değiştir" dendiğinde sunucu şablonu buradan okur
// (POST /api/banner-studio/template-adapt).
//
// Ürün görseli `{{PRODUCT_IMAGE}}` yer tutucusu ile gelir. Varsayılan örnek fotoğraf Film Lab'ınki
// (client/assets/film_lab_sample.jpg) → Supabase images/bannerStudio/templates/samples/default.jpg
// ⚠️ id'ler istemci ile sözleşme — silme/yeniden adlandırma yapma.
// Araçlar: server/scripts/banner-templates/build.js
const fs = require("fs");
const path = require("path");

const PLACEHOLDER = "{{PRODUCT_IMAGE}}";
const SAMPLE_OBJECT = "bannerStudio/templates/samples/default.jpg";
const SAMPLE_ASPECT = 768 / 1376; // film_lab_sample.jpg

// manifest.json = the list (id, file, English / Turkish display names, category); build.js `client` emits only IDs for deep links
const TEMPLATES = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));

const cache = new Map();

function sampleImageUrl() {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/images/${SAMPLE_OBJECT}`;
}

function readRaw(entry) {
  if (!cache.has(entry.id)) {
    cache.set(entry.id, fs.readFileSync(path.join(__dirname, entry.file), "utf8"));
  }
  return cache.get(entry.id);
}

// 25 Eyl 2026 (kullanıcı isteği): her şablonun kısa loop animasyonlu sürümü animated/<aynı dosya> altında
// (yalnız CSS @keyframes + <meta name="loop-duration">; t=0 karesi statik tasarımın aynısı). Olmayan için null.
const animCache = new Map();
function readAnimated(entry) {
  if (!animCache.has(entry.id)) {
    const file = path.join(__dirname, "animated", entry.file);
    animCache.set(entry.id, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
  }
  return animCache.get(entry.id);
}

/** Şablon + verilen ürün görseli (yoksa varsayılan örnek fotoğraf) ile hazır HTML */
function getBannerTemplate(id, imageUrl, { animated = false } = {}) {
  const entry = TEMPLATES.find((t) => t.id === id);
  if (!entry) return null;
  const photo = imageUrl || sampleImageUrl();
  const raw = (animated && readAnimated(entry)) || readRaw(entry);
  return {
    id: entry.id,
    sampleImageUrl: sampleImageUrl(),
    imageUrl: photo,
    animated: animated && !!readAnimated(entry),
    html: raw.split(PLACEHOLDER).join(photo),
  };
}

module.exports = { TEMPLATES, PLACEHOLDER, SAMPLE_OBJECT, SAMPLE_ASPECT, getBannerTemplate, sampleImageUrl, readRaw, readAnimated };
