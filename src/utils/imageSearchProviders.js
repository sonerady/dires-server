// 🔎 Görsel arama sağlayıcıları — stil önerileri için.
//
// Kullanım: searchStyleImages(query, { limit }) → normalize edilmiş sonuç dizisi.
//
// Sağlayıcı sırası (ilki yeterli sonuç verirse diğerlerine gidilmez):
//   1) Pinterest  — moda editoryal içeriği en zengin kaynak
//   2) Pexels     — resmi API, ücretsiz, ticari kullanıma açık
//   3) Unsplash   — resmi API, ücretsiz, ticari kullanıma açık
//
// ⚠️ PINTEREST HAKKINDA: Pinterest'in herkese açık bir arama API'si yok; burada
// web arayüzünün kullandığı iç JSON uç noktası çağrılıyor. Bu, Pinterest'in
// kullanım şartlarına aykırı olabilir, uç nokta habersiz değişebilir ve IP
// bazlı engelle karşılaşılabilir. Bu yüzden:
//   • hata/boş sonuçta sessizce lisanslı sağlayıcılara düşülür,
//   • STYLE_SEARCH_PROVIDERS ortam değişkeniyle tamamen kapatılabilir
//     (ör. STYLE_SEARCH_PROVIDERS=pexels,unsplash),
//   • sonuçlar önbelleğe alınır (aynı sorgu tekrar tekrar istenmez).

const axios = require("axios");
const logger = require("./logger");

const DEFAULT_LIMIT = 10;
// "daha fazla yükle" / "yenile" tek aramadan dilimlenir. Havuz büyüdükçe
// sağlayıcının cevap süresi de uzuyor (Apify'da sayfalama gerekiyor), bu yüzden
// ortamdan ayarlanabilir: STYLE_POOL_SIZE=25 gibi.
const POOL_SIZE = Math.min(
  Math.max(parseInt(process.env.STYLE_POOL_SIZE, 10) || 50, 10),
  100,
);
// Önbellek ömrü ortamdan ayarlanır. STYLE_CACHE_TTL_MS=0 → önbellek TAMAMEN
// kapalı: her istek sağlayıcıya gider (okuma da yazma da yapılmaz).
const CACHE_TTL_MS = (() => {
  const raw = process.env.STYLE_CACHE_TTL_MS;
  if (raw === undefined || raw === "") return 6 * 60 * 60 * 1000; // varsayılan 6 saat
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 6 * 60 * 60 * 1000;
})();
const CACHE_ENABLED = CACHE_TTL_MS > 0;
// ⚠️ BOŞ sonuçlar ayrı ve çok kısa TTL ile tutulur. Aksi halde tek bir geçici
// hata (429, ağ kesintisi, aktör çökmesi) o sorguyu saatlerce ölü bırakıyor:
// limit dakikalar içinde sıfırlansa bile önbellekten boş sonuç dönüyordu.
const EMPTY_CACHE_TTL_MS = 3 * 60 * 1000; // 3 dakika
const cache = new Map(); // query|limit → { at, results, provider }

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function providerOrder() {
  // apify başta: APIFY_TOKEN tanımlıysa devreye girer, tanımlı değilse
  // searchApify boş döner ve zincir sessizce doğrudan çağrıya geçer.
  const raw = (
    process.env.STYLE_SEARCH_PROVIDERS || "apify,pinterest,pexels,unsplash"
  )
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return raw.length > 0 ? raw : ["apify", "pinterest", "pexels", "unsplash"];
}

/**
 * Pinterest pin nesnesinden en iyi görseli seçer.
 * Hem doğrudan kazımada hem Apify çıktısında aynı şekil geliyor:
 *   images: { "orig": {url,width,height}, "736x": {...}, "564x": {...}, "236x": {...} }
 */
function pinToItem(pin, source) {
  const images = pin?.images || {};
  const best = images.orig || images["736x"] || images["564x"] || images["474x"];
  const small = images["236x"] || images["474x"] || best;
  if (!best?.url) return null;
  return normalise({
    url: best.url,
    thumb: small?.url,
    width: best.width,
    height: best.height,
    source,
    sourceUrl: pin?.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
    title: pin?.grid_title || pin?.title || pin?.closeup_unified_description || null,
  });
}

/** Sonuçları tek biçime indirger. */
function normalise({ url, thumb, width, height, source, sourceUrl, title }) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return {
    url,
    thumb: thumb || url,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    source, // "pinterest" | "pexels" | "unsplash"
    sourceUrl: sourceUrl || null, // içeriğin kendi sayfası (atıf için)
    title: title || null,
  };
}

// ─────────────────────────────────────────────────────────────
// Pinterest (resmi olmayan)
// ─────────────────────────────────────────────────────────────
async function searchPinterest(query, limit) {
  const data = {
    options: {
      query,
      scope: "pins",
      auto_correction_disabled: false,
      bookmarks: [""],
      page_size: Math.max(limit, 25),
    },
    context: {},
  };

  const url =
    "https://www.pinterest.com/resource/BaseSearchResource/get/" +
    `?source_url=${encodeURIComponent(`/search/pins/?q=${query}`)}` +
    `&data=${encodeURIComponent(JSON.stringify(data))}`;

  const resp = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      "X-Pinterest-AppState": "active",
      "X-Pinterest-PWS-Handler": "www/search/[scope].js",
      Referer: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
    },
  });

  const results =
    resp?.data?.resource_response?.data?.results ||
    resp?.data?.resource_response?.data ||
    [];
  if (!Array.isArray(results)) return [];

  const out = [];
  for (const pin of results) {
    const item = pinToItem(pin, "pinterest");
    if (item) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Apify — Pinterest arama aktörleri
//
// Pinterest'i doğrudan kazımak yerine Apify'ın aktörünü kullanır: proxy havuzunu,
// blok yönetimini ve uç nokta değişikliklerini onlar üstlenir.
//
// ⚠️ SÜRE — ÖLÇÜLDÜ (fetch_cat, ücretsiz plan):
//    • 10 sonuç, sıcak konteyner : ~4,5 sn  → canlı hat için kabul edilebilir
//    • ilk/soğuk çalıştırma      : ~42 sn   → APIFY_TIMEOUT_MS bunu keser
//    Soğuk çalıştırma zaman aşımına uğrarsa zincir bir sonraki sağlayıcıya geçer,
//    kullanıcı boş ekran görmez.
//
// Desteklenen iki çıktı şekli otomatik ayırt edilir:
//   • fetch_cat  → düz alanlar:  imageUrl, thumbnailUrl, pinUrl, title
//   • epctex     → ham Pinterest nesnesi: images.orig / 736x / 236x, id, grid_title
//
// Ortam değişkenleri:
//   APIFY_TOKEN            (zorunlu)
//   APIFY_PINTEREST_ACTOR  (varsayılan: fetch_cat~pinterest-search-scraper)
//   APIFY_PROXY_GROUPS     (yalnızca epctex için; varsayılan yok = datacenter)
//   APIFY_TIMEOUT_MS       (varsayılan: 20000 — canlı hat için sıkı tavan)
//   APIFY_MAX_CONCURRENCY  (opsiyonel — verilmezse gönderilmez)
//   APIFY_RUN_BUDGET_SECONDS (opsiyonel — verilmezse gönderilmez)
// ─────────────────────────────────────────────────────────────
/** Aktöre göre girdi gövdesi — şemaları birbirinden farklı. */
function buildApifyInput(actor, query, limit) {
  if (actor.includes("epctex")) {
    const groups = (process.env.APIFY_PROXY_GROUPS || "")
      .split(",")
      .map((g) => g.trim().toUpperCase())
      .filter(Boolean);
    return {
      search: query,
      maxItems: limit,
      endPage: Math.min(Math.max(Math.ceil(limit / 25), 1), 4),
      includeComments: false,
      proxy: groups.length
        ? { useApifyProxy: true, apifyProxyGroups: groups }
        : { useApifyProxy: true },
    };
  }
  // fetch_cat ve benzeri arama aktörleri.
  //
  // ⚠️ GÖVDEYİ SADE TUT. maxConcurrency / runBudgetSeconds eklendiğinde aktör
  // isteği 400 ile reddetti (girdi doğrulaması). Bu yüzden yalnızca ortamda
  // AÇIKÇA verilirlerse gönderiliyorlar — varsayılan gövde, elle test edilmiş
  // ve çalıştığı doğrulanmış üç alandan ibaret.
  const input = {
    queries: [query],
    maxResultsPerQuery: limit,
    includePinDetails: false, // detay çekimi süreyi katlıyor
  };

  const concurrency = parseInt(process.env.APIFY_MAX_CONCURRENCY, 10);
  if (Number.isFinite(concurrency) && concurrency > 0) {
    input.maxConcurrency = concurrency;
  }
  const budget = parseInt(process.env.APIFY_RUN_BUDGET_SECONDS, 10);
  if (Number.isFinite(budget) && budget > 0) {
    input.runBudgetSeconds = budget;
  }

  return input;
}

/** İki farklı çıktı şeklini tek biçime indirger. */
function apifyItemToResult(raw) {
  // fetch_cat: düz alanlar
  if (raw?.imageUrl || raw?.thumbnailUrl) {
    if (raw.isVideo) return null; // video pin'leri stil referansı olamaz
    return normalise({
      url: raw.imageUrl || raw.thumbnailUrl,
      thumb: raw.thumbnailUrl || raw.imageUrl,
      // fetch_cat boyut döndürmüyor; normalise null'ı tolere ediyor
      width: raw.width,
      height: raw.height,
      source: "pinterest",
      sourceUrl:
        raw.pinUrl ||
        (raw.pinId ? `https://www.pinterest.com/pin/${raw.pinId}/` : null),
      title: raw.title || raw.description || null,
    });
  }
  // epctex: ham Pinterest pin nesnesi
  return pinToItem(raw, "pinterest");
}

async function searchApify(query, limit) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return [];

  const actor =
    process.env.APIFY_PINTEREST_ACTOR || "fetch_cat~pinterest-search-scraper";
  // Ölçüm: 10 sonuç ≈ 4,5 sn (sıcak). İlk/soğuk çalıştırma 40 sn'yi bulabiliyor,
  // bu yüzden kullanıcıyı bekletmemek için sıkı bir tavan koyuyoruz — aşılırsa
  // hata fırlatılır ve sağlayıcı zinciri bir sonrakine geçer.
  const timeout = parseInt(process.env.APIFY_TIMEOUT_MS, 10) || 20000;

  const started = Date.now();
  let resp;
  try {
    resp = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`,
      buildApifyInput(actor, query, limit),
      {
        timeout,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    // Süreyi hatanın içine gömüyoruz: "tavana takıldı" ile "gerçekten çok yavaş"
    // ayrımını log'dan yapabilmek için.
    const secs = Math.round((Date.now() - started) / 1000);
    // Apify 4xx'lerde sebebi gövdede söylüyor; onu yutmayalım
    const detail =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      "";
    err.message = `${err.message}${detail ? ` — ${detail}` : ""} [aktör=${actor}, ${secs} sn sonra, limit=${limit}, tavan=${Math.round(timeout / 1000)} sn]`;
    throw err;
  }

  const items = Array.isArray(resp?.data) ? resp.data : [];
  logger.log(
    `🔎 [STYLE_SEARCH] apify(${actor}) "${query}" → ${items.length} kayıt, ${Math.round((Date.now() - started) / 1000)} sn`,
  );

  const out = [];
  for (const raw of items) {
    const item = apifyItemToResult(raw);
    if (item) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Pexels (resmi API)
// ─────────────────────────────────────────────────────────────
async function searchPexels(query, limit) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const resp = await axios.get("https://api.pexels.com/v1/search", {
    timeout: 15000,
    headers: { Authorization: key },
    params: { query, per_page: limit, orientation: "portrait" },
  });
  const photos = resp?.data?.photos || [];
  return photos
    .map((p) =>
      normalise({
        url: p?.src?.large2x || p?.src?.large || p?.src?.original,
        thumb: p?.src?.medium || p?.src?.small,
        width: p?.width,
        height: p?.height,
        source: "pexels",
        sourceUrl: p?.url,
        title: p?.alt,
      }),
    )
    .filter(Boolean)
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────
// Unsplash (resmi API)
// ─────────────────────────────────────────────────────────────
async function searchUnsplash(query, limit) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const resp = await axios.get("https://api.unsplash.com/search/photos", {
    timeout: 15000,
    headers: { Authorization: `Client-ID ${key}` },
    params: { query, per_page: limit, orientation: "portrait" },
  });
  const photos = resp?.data?.results || [];
  return photos
    .map((p) =>
      normalise({
        url: p?.urls?.regular || p?.urls?.full,
        thumb: p?.urls?.small || p?.urls?.thumb,
        width: p?.width,
        height: p?.height,
        source: "unsplash",
        sourceUrl: p?.links?.html,
        title: p?.alt_description,
      }),
    )
    .filter(Boolean)
    .slice(0, limit);
}

const PROVIDERS = {
  pinterest: searchPinterest,
  apify: searchApify,
  pexels: searchPexels,
  unsplash: searchUnsplash,
};

/**
 * Sorguyu sağlayıcı sırasına göre dener, ilk yeterli sonucu döndürür.
 * @returns {Promise<{ results: object[], provider: string|null }>}
 */
async function searchStyleImages(query, { limit = DEFAULT_LIMIT } = {}) {
  const clean = String(query || "").trim();
  if (!clean) return { results: [], provider: null };

  const cacheKey = `${clean.toLowerCase()}|${limit}`;
  const hit = CACHE_ENABLED ? cache.get(cacheKey) : null;
  if (hit) {
    // Dolu sonuçlar 6 saat, boş sonuçlar yalnızca 3 dakika yaşar
    const ttl = hit.results.length > 0 ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS;
    if (Date.now() - hit.at < ttl) {
      return { results: hit.results, provider: hit.provider, cached: true };
    }
    cache.delete(cacheKey);
  }

  for (const name of providerOrder()) {
    const fn = PROVIDERS[name];
    if (!fn) continue;
    try {
      const results = await fn(clean, limit);
      if (results.length > 0) {
        // Yarıdan az sonuç geldiyse bile kabul et; sıradaki sağlayıcı da
        // boş dönebilir ve kullanıcı hiç öneri görmemektense az görsün.
        if (CACHE_ENABLED) {
          cache.set(cacheKey, { at: Date.now(), results, provider: name });
        }
        logger.log(
          `🔎 [STYLE_SEARCH] "${clean}" → ${results.length} sonuç (${name})`,
        );
        return { results, provider: name };
      }
      logger.warn(`🔎 [STYLE_SEARCH] ${name} boş döndü, sıradakine geçiliyor`);
    } catch (err) {
      const status = err?.response?.status;
      // Apify'da en sık karşılaşılacak iki hatayı açıkça isimlendir
      if (name === "apify" && (status === 402 || status === 403)) {
        logger.warn(
          "🔎 [STYLE_SEARCH] apify: aktör kiralanmamış veya plan yetersiz (402/403). " +
            "Apify Console'da aktörü kirala ve ücretli plana geç.",
        );
      } else if (status === 429) {
        logger.warn(`🔎 [STYLE_SEARCH] ${name}: oran sınırı (429), sıradakine geçiliyor`);
      } else {
        logger.warn(
          `🔎 [STYLE_SEARCH] ${name} hata verdi (${status || ""} ${err?.message}), sıradakine geçiliyor`,
        );
      }
    }
  }

  // Boş sonuç da yazılır ama KISA ömürlü — geçici hata kalıcı boşluğa dönüşmesin
  if (CACHE_ENABLED) {
    cache.set(cacheKey, { at: Date.now(), results: [], provider: null });
  }
  return { results: [], provider: null };
}

// Açılışta aktif yapılandırmayı yazdır.
// .env değişiklikleri nodemon'u tetiklemiyor (sadece .js izleniyor), bu yüzden
// süreç eski ayarlarla çalışmaya devam edebiliyor. Bu satır, sunucunun GERÇEKTE
// hangi ayarlarla çalıştığını tek bakışta gösterir.
logger.log(
  "🔎 [STYLE_SEARCH] yapılandırma → " +
    [
      `sağlayıcılar=${providerOrder().join(",")}`,
      `aktör=${process.env.APIFY_PINTEREST_ACTOR || "fetch_cat~pinterest-search-scraper"}`,
      `token=${process.env.APIFY_TOKEN ? "var" : "YOK"}`,
      `tavan=${Math.round((parseInt(process.env.APIFY_TIMEOUT_MS, 10) || 20000) / 1000)}sn`,
      `önbellek=${CACHE_ENABLED ? Math.round(CACHE_TTL_MS / 60000) + "dk" : "kapalı"}`,
    ].join(" | "),
);

module.exports = { searchStyleImages, DEFAULT_LIMIT, POOL_SIZE };
