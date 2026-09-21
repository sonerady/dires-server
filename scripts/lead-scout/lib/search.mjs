// 🔍 Mağazalar arası ürün arama.
//
// İki mod:
//   yerel — out/stores/*.json içindeki ~110.000 ürün kaydı bellekte taranır.
//           Anında (ms), ağ yok, örneklem alınan mağazalar da dahil.
//   canlı — Shopify mağazalarının /search/suggest.json uç noktası paralel
//           sorgulanır. Güncel ve tam katalog, ama sadece Shopify'da ve ~2 sn.

import fs from "node:fs";
import path from "node:path";

// Türkçe arama: "şal" yazan "sal" da bulsun, "İ" sorun çıkarmasın.
const FOLD = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "â": "a", "î": "i", "û": "u" };
export const fold = (s) => String(s || "").replace(/[ıİşŞğĞüÜöÖçÇâîû]/g, (c) => FOLD[c] || c).toLowerCase();

let INDEX = null;

export function buildIndex(dir) {
  if (INDEX) return INDEX;
  const rows = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    for (const p of s.products || []) {
      if (!p.images?.[0]) continue;   // görselsiz kayıt arama sonucunda işe yaramaz
      rows.push({
        d: s.domain,
        t: p.title,
        y: p.type || "",
        n: p.nImages,
        i: p.images[0],
        im: p.images,
        u: p.url,
        pr: p.price,
        k: fold(`${p.title} ${p.type} ${(p.tags || []).join(" ")}`),
      });
    }
  }
  INDEX = rows;
  return INDEX;
}

export function indexSize() { return INDEX ? INDEX.length : 0; }

export function searchLocal(q, { domains = null, limit = 120, perStore = 12 } = {}) {
  if (!INDEX) return { results: [], matched: 0 };
  // Kelime başı eşleşmesi: "red" araması "shirred"i getirmesin diye düz
  // substring yerine sınırdan başlayan eşleşme kullanıyoruz.
  const terms = fold(q).split(/\s+/).filter(Boolean)
    .map((t) => new RegExp("(^|[^a-z0-9])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  if (!terms.length) return { results: [], matched: 0 };

  const allow = domains ? new Set(domains) : null;
  const hits = [];
  for (const r of INDEX) {
    if (allow && !allow.has(r.d)) continue;
    let ok = true;
    for (const t of terms) if (!t.test(r.k)) { ok = false; break; }
    if (ok) hits.push(r);
  }

  // Tek mağaza sonuçları doldurmasın — mağaza başına tavan koyup karıştırıyoruz.
  const byStore = new Map();
  for (const h of hits) {
    const list = byStore.get(h.d) || [];
    if (list.length < perStore) { list.push(h); byStore.set(h.d, list); }
  }
  const lists = [...byStore.values()];
  const mixed = [];
  for (let i = 0; mixed.length < limit; i++) {
    let added = false;
    for (const l of lists) if (l[i]) { mixed.push(l[i]); added = true; if (mixed.length >= limit) break; }
    if (!added) break;
  }
  return { results: mixed, matched: hits.length, stores: byStore.size };
}

// 🐢 Nezaket katmanı. 54 mağazayı her tuş vuruşunda sorgulamak Shopify'da
// hızla 429/blok getiriyor — bugün bizzat yaşadık. Üç önlem:
//   1) sorgu sonuçları 5 dakika önbellekte tutulur,
//   2) partiler arasında bekleme var,
//   3) hata veren alan adı bir süre atlanır (backoff).
const QCACHE = new Map();      // "domain|q" -> { at, data }
const COOLDOWN = new Map();    // domain -> ne zamana kadar atlanacak
const CACHE_MS = 5 * 60 * 1000;
const COOL_MS = 10 * 60 * 1000;
const BATCH_GAP_MS = 350;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

async function suggestOne(domain, q, limit) {
  const key = `${domain}|${q}`;
  const hit = QCACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  if ((COOLDOWN.get(domain) || 0) > Date.now()) return [];

  const url = `https://www.${domain}/search/suggest.json?q=${encodeURIComponent(q)}` +
    `&resources%5Btype%5D=product&resources%5Blimit%5D=${limit}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) { COOLDOWN.set(domain, Date.now() + COOL_MS); return []; }
    const j = await res.json();
    const out = (j?.resources?.results?.products || []).map((p) => ({
      d: domain,
      t: p.title,
      y: p.product_type || "",
      n: null,
      i: p.featured_image?.url || p.image || "",
      im: [p.featured_image?.url || p.image || ""].filter(Boolean),
      u: p.url?.startsWith("http") ? p.url : `https://www.${domain}${p.url || ""}`,
      pr: p.price ? Number(String(p.price).replace(/[^\d.]/g, "")) : null,
    })).filter((r) => r.i);
    QCACHE.set(key, { at: Date.now(), data: out });
    return out;
  } catch {
    COOLDOWN.set(domain, Date.now() + COOL_MS);
    return [];
  }
}

// Akıtmalı canlı arama: her parti bitince sonucu hemen geri veriyor ki
// kullanıcı 50 mağazanın tamamını beklemeden ilk sonuçları görsün.
export async function searchLiveStream(q, domains, onBatch, { perStore = 8, batch = 12, signal } = {}) {
  let done = 0;
  for (let i = 0; i < domains.length; i += batch) {
    if (signal?.aborted) return;
    const chunk = domains.slice(i, i + batch);
    const res = (await Promise.all(chunk.map((d) => suggestOne(d, q, perStore)))).flat();
    done += chunk.length;
    await onBatch(res, done, domains.length);
    if (i + batch < domains.length) await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
  }
}

export async function searchLive(q, shopifyDomains, { perStore = 8 } = {}) {
  const batches = [];
  for (let i = 0; i < shopifyDomains.length; i += 10) {
    batches.push(await Promise.all(shopifyDomains.slice(i, i + 10).map((d) => suggestOne(d, q, perStore))));
  }
  const flat = batches.flat().flat();
  // Mağazaları karıştır ki tek marka listeyi doldurmasın.
  const byStore = new Map();
  for (const r of flat) { const l = byStore.get(r.d) || []; l.push(r); byStore.set(r.d, l); }
  const lists = [...byStore.values()];
  const mixed = [];
  for (let i = 0; ; i++) {
    let added = false;
    for (const l of lists) if (l[i]) { mixed.push(l[i]); added = true; }
    if (!added) break;
  }
  return { results: mixed, matched: flat.length, stores: byStore.size };
}
