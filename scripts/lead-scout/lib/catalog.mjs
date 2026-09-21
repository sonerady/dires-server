// 📚 Tek kapı: hangi platform olursa olsun mağazanın kataloğunu getirir,
// profilini çıkarır ve ana sayfada gösterilecek kapak görsellerini seçer.

import { fetchCatalog, slimProducts } from "./shopify.mjs";
import { detectPlatform, sampleCatalog } from "./universal.mjs";

const APPAREL_RE = /(giyim|elbise|gömlek|gomlek|pantolon|t-?shirt|tişört|tisort|sweat|hoodie|ceket|mont|etek|bluz|kazak|takım|takim|şal|sal|eşarp|esarp|fular|tesettür|tesettur|abiye|jean|denim|şort|sort|tunik|yelek|kaban|pijama|çorap|corap|bone|clothing|apparel|dress|shirt|jacket|skirt|knit|scarf|shawl|fashion)/i;

export async function loadStore(domain) {
  const det = await detectPlatform(domain);
  if (!det) return null;

  // Shopify ise tam katalog; değilse sitemap + JSON-LD örneklemi.
  if (det.platform === "shopify") {
    const raw = await fetchCatalog(domain);
    if (raw) return { platform: "shopify", origin: det.origin, sampled: false, totalKnown: raw.length, products: slimProducts(det.origin, raw) };
  }
  const s = await sampleCatalog(det.origin, { sample: 60 });
  if (!s || !s.products.length) return null;
  return { platform: det.platform, origin: det.origin, sampled: true, totalKnown: s.totalUrls, products: s.products };
}

export function profileStore(domain, store) {
  const ps = store.products;
  const n = ps.length;
  const images = ps.reduce((a, p) => a + p.nImages, 0);
  const oneImage = ps.filter((p) => p.nImages <= 1).length;
  const fourPlus = ps.filter((p) => p.nImages >= 4).length;
  // Ölçüm güvenilirliği: örneklemdeki HER ürün aynı sayıda görsel veriyorsa
  // (çoğunlukla hepsi 1), bu mağazanın gerçeği değil, bizim o temadan görsel
  // çıkaramadığımızdır. Sapma sıfırsa sayıya güvenmiyoruz.
  const counts = ps.map((p) => p.nImages);
  const mean = counts.reduce((a, c) => a + c, 0) / (n || 1);
  const imageSpread = Number(Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / (n || 1)).toFixed(2));

  const apparelHits = ps.filter((p) => APPAREL_RE.test(`${p.type} ${p.title} ${(p.tags || []).join(" ")}`)).length;

  const types = new Map();
  for (const p of ps) {
    const t = (p.type || "").trim();
    if (t) types.set(t, (types.get(t) || 0) + 1);
  }

  return {
    domain,
    platform: store.platform,
    sampled: store.sampled,
    sampleSize: store.sampled ? n : null,
    // Örneklemde toplam ürün sayısı sitemap'teki URL sayısıdır (yaklaşık).
    products: store.sampled ? store.totalKnown : n,
    images: store.sampled ? Math.round((images / n) * store.totalKnown) : images,
    imagesPerProduct: n ? Number((images / n).toFixed(2)) : 0,
    pctOneImage: n ? Math.round((oneImage / n) * 100) : 0,
    pctFourPlus: n ? Math.round((fourPlus / n) * 100) : 0,
    imageSpread,
    apparelRatio: n ? Number((apparelHits / n).toFixed(2)) : 0,
    topTypes: [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, c]) => `${t} (${c})`),
    sampleTitles: ps.slice(0, 5).map((p) => p.title),
  };
}

// 🖼️ Ana sayfadaki şerit: markanın farklı kategorilerinden birer görsel.
// Kategori bilgisi yoksa (çoğu Ticimax/T-Soft mağazasında yok) katalogda
// eşit aralıklı ürünler seçiliyor — amaç çeşitliliği göstermek.
export function pickCovers(store, count = 8) {
  const withImg = store.products.filter((p) => p.images?.[0]);
  if (!withImg.length) return [];

  const byCat = new Map();
  for (const p of withImg) {
    const c = (p.type || "").split(">")[0].trim();
    if (!c) continue;
    if (!byCat.has(c)) byCat.set(c, p);
  }

  const picks = [...byCat.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "tr"))
    .slice(0, count)
    .map(([label, p]) => ({ label, image: p.images[0], title: p.title, url: p.url }));

  if (picks.length >= Math.min(count, 4)) return picks;

  // Kategori yoksa katalog boyunca eşit aralıklı örnekle.
  const step = Math.max(1, Math.floor(withImg.length / count));
  return withImg.filter((_, i) => i % step === 0).slice(0, count)
    .map((p) => ({ label: (p.type || "").split(">")[0].trim() || "", image: p.images[0], title: p.title, url: p.url }));
}
