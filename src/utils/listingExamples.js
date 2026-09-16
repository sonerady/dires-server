// 🖼️ Listing Stüdyosu — stil ÖRNEK referansları (16 Eyl 2026, kullanıcı kararı)
//
// Her üretimde ürün fotoğrafının ARDINDAN 4 örnek listing görseli de modele
// gider ki "listing image" ile tam olarak ne istediğimizi (düzen mantığı,
// tipografi, rozet dili, bilgi hiyerarşisi, foto/grafik dengesi) görsün.
// Örnekler yalnız MANTIK/TASARIM içindir: ürünleri, renkleri, yazıları
// kopyalanmaz. Bunu modele hem prompt'ta söylüyoruz hem de görselin altına
// siyah şerit basıyoruz (Location referansı ile aynı "etiketli referans"
// kalıbı — stampLocationReference): "STYLE EXAMPLE · DESIGN LOGIC ONLY".
//
// Kaynaklar sunucu tarafından bir kez indirilir, şeritlenir ve Supabase
// `images` bucket'ına yazılır; sonraki isteklerde bellek önbelleğinden
// (ve bucket'tan) okunur. Kaynağa erişilemezse eldeki kadarıyla devam eder.
const axios = require("axios");
const sharp = require("sharp");
const { renderReferenceLabel } = require("./referenceLabel");

const EXAMPLE_SOURCES = [
  "https://i.pinimg.com/736x/24/b2/dc/24b2dc762ca02ed3aaebdad58ee0e700.jpg",
  "https://i.pinimg.com/736x/77/1b/9c/771b9c29d97dc3c781bb1a46324a2b61.jpg",
  "https://i.pinimg.com/736x/ce/b6/79/ceb67934a29a0e27d5e6eeb4c0039531.jpg",
  "https://i.pinimg.com/736x/81/bd/27/81bd271bba1166e43bb6530516948311.jpg",
];
const BUCKET = "images";
const PREFIX = "listing-studio/examples";
const LABEL = "STYLE EXAMPLE · DESIGN LOGIC ONLY";
const VERSION = "v1"; // şerit/etiket değişirse artır → yeniden üretilir

let cachedUrls = null;
let inflight = null;

async function stampExample(buffer) {
  const image = await sharp(buffer, { limitInputPixels: 40000000 })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const { width, height } = await sharp(image).metadata();
  const band = Math.max(44, Math.round(width * 0.07));
  const label = renderReferenceLabel({ width, height: band, label: LABEL, fontSize: Math.round(band * 0.5), background: "#0A0A0C" });
  return sharp(image)
    .extend({ bottom: band, top: 0, left: 0, right: 0, background: "#0A0A0C" })
    .composite([{ input: label, top: height, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function ensureOne(supabase, index, logger) {
  const key = `${PREFIX}/${VERSION}-example-${index + 1}.jpg`;
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
  // Bucket'ta var mı? (HEAD yerine list — public URL cache'e takılmasın)
  try {
    const { data } = await supabase.storage.from(BUCKET).list(PREFIX, { search: `${VERSION}-example-${index + 1}.jpg`, limit: 1 });
    if (Array.isArray(data) && data.some((f) => f.name === `${VERSION}-example-${index + 1}.jpg`)) return publicUrl;
  } catch (e) {}
  const res = await axios.get(EXAMPLE_SOURCES[index], {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh) DiressServer/1.0", Accept: "image/*" },
  });
  const stamped = await stampExample(Buffer.from(res.data));
  const { error } = await supabase.storage.from(BUCKET).upload(key, stamped, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
  if (error) throw error;
  logger?.log?.(`🖼️ [LISTING EXAMPLES] örnek ${index + 1} şeritlendi ve yüklendi`);
  return publicUrl;
}

/** Şeritli 4 örneğin public URL listesi (erişilemeyenler atlanır). */
async function getListingExampleUrls(supabase, logger) {
  if (cachedUrls && cachedUrls.length === EXAMPLE_SOURCES.length) return cachedUrls;
  if (inflight) return inflight;
  inflight = (async () => {
    const urls = [];
    for (let i = 0; i < EXAMPLE_SOURCES.length; i++) {
      try {
        urls.push(await ensureOne(supabase, i, logger));
      } catch (e) {
        logger?.warn?.(`🖼️ [LISTING EXAMPLES] örnek ${i + 1} hazırlanamadı: ${e?.message}`);
      }
    }
    if (urls.length === EXAMPLE_SOURCES.length) cachedUrls = urls;
    inflight = null;
    return urls;
  })();
  return inflight;
}

module.exports = { getListingExampleUrls, EXAMPLE_SOURCES, LABEL, stampExample };
