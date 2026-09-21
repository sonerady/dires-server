// 🛍️ Shopify tespiti + katalog profili
//
// Tek bir HTTP çağrısı hem "bu site Shopify mi" sorusunu cevaplıyor hem de
// tüm kataloğu veriyor: /products.json. Ayrı bir fingerprint adımına gerek yok.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function get(url, { json = false, timeout = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return json ? res.json() : res.text();
}

export function normalizeDomain(raw) {
  let d = String(raw || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return d;
}

// Shopify mi? Öyleyse tüm ürünleri çek. Değilse null.
export async function fetchCatalog(domain, { maxPages = 40 } = {}) {
  const origin = `https://www.${domain}`;
  const products = [];
  for (let page = 1; page <= maxPages; page++) {
    let json;
    try {
      json = await get(`${origin}/products.json?limit=250&page=${page}`, { json: true });
    } catch {
      if (page === 1) {
        // www olmadan bir kez daha dene
        try {
          json = await get(`https://${domain}/products.json?limit=250&page=1`, { json: true });
        } catch {
          return null;
        }
      } else break;
    }
    const batch = json?.products;
    if (!Array.isArray(batch)) return page === 1 ? null : null;
    if (!batch.length) break;
    products.push(...batch);
    if (batch.length < 250) break;
    await sleep(300);
  }
  return products.length ? products : null;
}

// Giyim mi? Ürün tipi/etiket metninden kaba ön eleme (Jev'e gitmeden).
const APPAREL_RE = /(giyim|elbise|gömlek|gomlek|pantolon|t-?shirt|tişört|tisort|sweat|hoodie|ceket|mont|etek|bluz|kazak|takım|takim|şal|sal|eşarp|esarp|tesettür|tesettur|abiye|jean|denim|şort|sort|body|tunik|yelek|trençkot|trenckot|kaban|pijama|iç giyim|ic giyim|çorap|corap|clothing|apparel|dress|shirt|pants|jacket|skirt|knit|outerwear|fashion)/i;

export function profile(domain, products) {
  const n = products.length;
  let images = 0;
  let oneImage = 0;
  let fourPlus = 0;
  let apparelHits = 0;
  const types = new Map();

  for (const p of products) {
    const c = (p.images || []).length;
    images += c;
    if (c <= 1) oneImage++;
    if (c >= 4) fourPlus++;
    const t = (p.product_type || "").trim();
    if (t) types.set(t, (types.get(t) || 0) + 1);
    const hay = `${t} ${p.title || ""} ${(p.tags || []).join(" ")}`;
    if (APPAREL_RE.test(hay)) apparelHits++;
  }

  const topTypes = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, c]) => `${t} (${c})`);

  return {
    domain,
    products: n,
    images,
    imagesPerProduct: n ? Number((images / n).toFixed(2)) : 0,
    pctOneImage: n ? Math.round((oneImage / n) * 100) : 0,
    pctFourPlus: n ? Math.round((fourPlus / n) * 100) : 0,
    apparelRatio: n ? Number((apparelHits / n).toFixed(2)) : 0,
    topTypes,
    sampleTitles: products.slice(0, 5).map((p) => p.title),
  };
}

// Diress açısından fırsat: kategori medyanına göre eksik fotoğraf sayısı.
export function opportunity(prof, categoryMedian = 4) {
  const missing = Math.max(0, Math.round((categoryMedian - prof.imagesPerProduct) * prof.products));
  return { categoryMedian, missingPhotos: missing };
}

// 🔎 Detay görünümü için ürün kayıtları — panelde mağazaya tıklayınca
// listelenecek. Alanlar bilinçli olarak kırpılıyor (açıklama 280 karakter,
// en fazla 6 görsel URL'i) yoksa 10.000 ürünlü katalogda dosya şişiyor.
export function slimProducts(origin, products, { maxDesc = 280, maxImgs = 12 } = {}) {
  const strip = (html) =>
    String(html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

  return products.map((p) => {
    const imgs = (p.images || []).map((im) => String(im.src || "").split("?")[0]);
    const prices = (p.variants || []).map((v) => Number(v.price)).filter((x) => Number.isFinite(x));
    const desc = strip(p.body_html);
    return {
      handle: p.handle,
      title: p.title,
      url: `${origin}/products/${p.handle}`,
      type: p.product_type || "",
      tags: (p.tags || []).slice(0, 8),
      nImages: imgs.length,
      images: imgs.slice(0, maxImgs),
      price: prices.length ? Math.min(...prices) : null,
      hasDesc: desc.length > 0,
      descLen: desc.length,
      desc: desc.slice(0, maxDesc),
      createdAt: p.created_at || null,
    };
  });
}

// Kategori kırılımı — product_type alanı "ŞAL > DESENLİ ŞAL > ..." gibi
// hiyerarşik gelebiliyor; hem tam hem de kök seviyeyi sayıyoruz.
export function categoryBreakdown(slim) {
  const full = new Map();
  const root = new Map();
  for (const p of slim) {
    const t = p.type || "(kategorisiz)";
    full.set(t, (full.get(t) || 0) + 1);
    const r = t.split(">")[0].trim() || "(kategorisiz)";
    root.set(r, (root.get(r) || 0) + 1);
  }
  const toArr = (m) => [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { full: toArr(full), root: toArr(root) };
}
