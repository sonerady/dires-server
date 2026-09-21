// 🌍 Platformdan bağımsız katalog okuyucu.
//
// Shopify'ın /products.json'u bir lüks — Türkiye'de mağazaların çoğu Ticimax,
// T-Soft veya İdeaSoft üzerinde ve böyle bir uç nokta yok. Ama hepsinin ortak
// iki şeyi var: sitemap.xml ve ürün sayfalarında Google için konulmuş
// JSON-LD `Product` verisi. Evrensel yol bu.
//
// Shopify'da TÜM katalog okunur; diğerlerinde ÖRNEKLEM alınır (varsayılan 60
// ürün). Ürün başına görsel ortalaması için örneklem fazlasıyla yeterli —
// tam sayıma gerek yok, zaten her ürün sayfasını tek tek açmak gerekirdi.

import { get, sleep } from "./shopify.mjs";

const FINGERPRINTS = [
  [/ticimax/i, "ticimax"],
  [/ideasoft|idea-?soft/i, "ideasoft"],
  [/tsoft|t-soft/i, "tsoft"],
  [/cdn\.shopify\.com|shopify/i, "shopify"],
  [/woocommerce|wp-content/i, "woocommerce"],
  [/magento|mage-/i, "magento"],
  [/platform\.ikas|ikas\.com/i, "ikas"],
  [/wix\.com|wixstatic/i, "wix"],
];

export async function detectPlatform(domain) {
  for (const origin of [`https://www.${domain}`, `https://${domain}`]) {
    try {
      const html = await get(origin, { timeout: 18000 });
      for (const [re, name] of FINGERPRINTS) if (re.test(html)) return { platform: name, origin, html };
      return { platform: "other", origin, html };
    } catch { /* diğer varyantı dene */ }
  }
  return null;
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

// Sitemap indeksinden ürün sitemap'lerini bulup ürün URL'lerini toplar.
export async function productUrls(origin, { max = 30000 } = {}) {
  const roots = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap/sitemap.xml", "/xml/sitemap.xml"];
  let index = null;
  for (const r of roots) {
    try { index = await get(origin + r, { timeout: 18000 }); break; } catch { /* sıradaki */ }
  }
  if (!index) return [];

  const children = locs(index).filter((u) => /\.xml/i.test(u));
  // Ürün sitemap'lerini öne al; yoksa hepsini dene.
  const productish = children.filter((u) => /product|urun|ürün/i.test(u));
  const targets = (productish.length ? productish : children).slice(0, 40);

  const out = [];
  if (!targets.length) return locs(index).filter((u) => !/\.xml/i.test(u)).slice(0, max);

  for (const t of targets) {
    if (out.length >= max) break;
    try {
      const xml = await get(t, { timeout: 18000 });
      out.push(...locs(xml).filter((u) => !/\.xml/i.test(u)));
    } catch { /* atla */ }
    await sleep(200);
  }
  return out.slice(0, max);
}

const CDN_NOISE = /\/cdn-cgi\/image\/[^/]+\//i;
const clean = (u) => String(u || "").split("?")[0].replace(CDN_NOISE, "/");
// Aynı görselin farklı boyutları tek sayılsın diye dosya adına indirger.
const imgKey = (u) => clean(u).split("/").pop().replace(/[-_](buyuk|kucuk|orta|small|large|thumb|\d{2,4}x\d{2,4})\b/gi, "");

function fromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    let j;
    try { j = JSON.parse(b.trim()); } catch { continue; }
    const arr = Array.isArray(j) ? j : (Array.isArray(j["@graph"]) ? j["@graph"] : [j]);
    for (const o of arr) {
      if (!o || !String(o["@type"] || "").toLowerCase().includes("product")) continue;
      const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers;
      return {
        title: String(o.name || "").trim(),
        images: (Array.isArray(o.image) ? o.image : o.image ? [o.image] : []).map(clean),
        price: offers?.price != null ? Number(offers.price) : null,
        desc: String(o.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        category: String(o.category || "").trim(),
      };
    }
  }
  return null;
}

export async function scrapeProduct(url) {
  let html;
  try { html = await get(url, { timeout: 20000 }); } catch { return null; }

  const ld = fromJsonLd(html) || {};

  // ⚠️ Sayfadaki HER görseli saymak işe yaramıyor: ürün sayfalarında "benzer
  // ürünler" bloğu var ve hepsinde 12 görsel çıkıyor. Ürünün KENDİ görselleri,
  // dosya adında ürünün slug'ını taşır (ör. armine-ipek-sal-0011-1-d367.jpg).
  // Bu yüzden slug eşleşmesi şart; eşleşme yoksa JSON-LD'nin verdiğiyle
  // yetiniyoruz — az ama doğru sayı, çok ama yanlış sayıdan iyidir.
  const slug = decodeURIComponent(url.split("?")[0].split("/").filter(Boolean).pop() || "")
    .toLowerCase().replace(/\.(html?|aspx?|php)$/, "").replace(/-\d+$/, "");
  const core = slug.split("-").filter((w) => w.length > 2).slice(0, 4).join("-");

  const raw = [...html.matchAll(/https?:\/\/[^"'\s)]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]);
  const own = raw.filter((u) => {
    const f = clean(u).split("/").pop().toLowerCase();
    if (/logo|banner|icon|sprite|favicon|placeholder|kargo|odeme/.test(f)) return false;
    return core.length > 4 && f.includes(core.split("-").slice(0, 2).join("-"));
  });

  const seen = new Map();
  for (const u of [...(ld.images || []), ...own]) {
    const k = imgKey(u);
    if (k && !seen.has(k)) seen.set(k, clean(u));
  }
  const images = [...seen.values()].slice(0, 12);

  const ogTitle = html.match(/property="og:title"[^>]*content="([^"]*)"/i)?.[1];
  const title = ld.title || ogTitle || "";
  if (!title && !images.length) return null;

  return {
    handle: url.split("/").filter(Boolean).pop(),
    title, url,
    type: ld.category || "",
    tags: [],
    nImages: images.length,
    images,
    price: ld.price ?? null,
    hasDesc: Boolean(ld.desc),
    descLen: (ld.desc || "").length,
    desc: (ld.desc || "").slice(0, 280),
    createdAt: null,
  };
}

// Shopify dışı mağazalar için örneklem katalog.
export async function sampleCatalog(origin, { sample = 60, concurrency = 6 } = {}) {
  // Önce TÜM ürün URL'leri sayılır (katalog büyüklüğü için), sonra içinden
  // örneklem çekilir. Sitemap XML'leri ucuz; ürün sayfaları pahalı.
  const urls = await productUrls(origin);
  if (!urls.length) return null;

  // Katalog geneline yayılsın diye eşit aralıklı seçim (ilk 60 ürün hep aynı
  // kategoriden gelirdi).
  const stepN = Math.max(1, Math.floor(urls.length / sample));
  const picked = urls.filter((_, i) => i % stepN === 0).slice(0, sample);

  const out = [];
  for (let i = 0; i < picked.length; i += concurrency) {
    const batch = await Promise.all(picked.slice(i, i + concurrency).map(scrapeProduct));
    out.push(...batch.filter(Boolean));
    await sleep(250);
  }
  return { products: out, totalUrls: urls.length };
}
