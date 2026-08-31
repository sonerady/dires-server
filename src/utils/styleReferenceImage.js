// ───────────────────────────────────────────────────────────────────────────
// 🎬 Stil referansı görsel yardımcıları
//
// Hem model/moda üretimi (referenceBrowserRoutesV7) hem ürün/katalog refiner'ı
// (createRefiner) aynı iki adımı kullanır:
//   1) Profildeki fotoğrafları tek bir grid kolaja birleştir,
//   2) Kolajın (ya da tek referans fotoğrafın) altına "STYLE REFERENCE · CODE SR-1"
//      siyah kod plakası bas — model hangi ekin stil referansı olduğunu bu plakadan
//      ayırt eder. Plaka yalnızca GİRDİ işaretidir, çıktıda görünmemelidir.
// ───────────────────────────────────────────────────────────────────────────
const axios = require("axios");
const sharp = require("sharp");
const logger = require("./logger");

const STYLE_REFERENCE_PLATE_VARIANT = "compact-v2";

function isCurrentStyleReferencePlateUrl(url) {
  return (
    typeof url === "string" &&
    url.includes(`_${STYLE_REFERENCE_PLATE_VARIANT}_`)
  );
}

// Supabase render parametreleri / CDN sarmalayıcıları sinyal bozduğu için temizlenir.
function sanitizeImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return imageUrl;
  return imageUrl.split("?")[0];
}

/**
 * Görselin altına siyah kod plakası basar.
 * @param {Buffer} rawBuf kaynak görsel
 * @param {string} label plakaya yazılacak İNGİLİZCE metin. Varsayılan stil
 *   referansı etiketi; renk referansları "COLOR 1" gibi kendi etiketini verir
 *   (18 Ağu 2026 — kullanıcı renk görseli yükleyebiliyor).
 */
async function stampStyleReferencePlate(
  rawBuf,
  label = "STYLE REFERENCE · CODE SR-1",
) {
  const flattened = await sharp(rawBuf)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .toBuffer();

  const meta = await sharp(flattened).metadata();
  const SW = meta.width || 800;
  const SH = meta.height || 1200;

  // Plaka yalnızca input işaretidir; fotoğrafın/kolajın anlamlı bir bölümünü
  // kaplamasın. Eski %9 / 150px plaka özellikle yatay kolajlarda çok büyüktü.
  const PLATE_H = Math.min(72, Math.max(40, Math.round(SH * 0.045)));
  const withPlate = await sharp(flattened)
    .extend({ bottom: PLATE_H, background: { r: 10, g: 10, b: 12 } })
    .toBuffer();

  const plateFont = Math.max(
    16,
    Math.min(28, Math.round(PLATE_H * 0.4), Math.round(SW / 26)),
  );
  const horizontalPadding = Math.max(12, Math.round(SW * 0.025));
  const availableTextWidth = Math.max(1, SW - horizontalPadding * 2);
  // Metin genişliği etikete göre ölçeklenir; kısa etiketler ("COLOR 1")
  // sabit 18.5 katsayısıyla plakayı boydan boya gerip çirkinleşiyordu.
  const naturalTextWidth = Math.round(plateFont * (label.length * 0.62));
  const plateTextWidth = Math.min(availableTextWidth, naturalTextWidth);
  const plateTextY = SH + Math.round(PLATE_H / 2);
  const plateSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH + PLATE_H}">
  <text x="${Math.round(SW / 2)}" y="${plateTextY}"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-size="${plateFont}"
        font-weight="700"
        fill="#FFFFFF"
        letter-spacing="1"
        textLength="${plateTextWidth}"
        lengthAdjust="spacingAndGlyphs">${label}</text>
</svg>
`);

  return sharp(withPlate)
    .composite([{ input: plateSvg, blend: "over" }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// 🎬 Stil profili fotoğraflarını tek bir beyaz zeminli grid kolaja birleştirir.
// En fazla 6 kare kullanılır; { buffer, count } döner.
async function buildStyleProfileGrid(imageUrls) {
  // Stil profili en fazla 3 fotoğraf tutar (styleProfileRoutes.MAX_IMAGES) —
  // eski profillerde daha fazlası olabildiği için üst sınır burada da uygulanır.
  const MAX_FRAMES = 3;
  const CELL_W = 512;
  const CELL_H = 640;
  const GAP = 6;

  const cells = [];
  for (const url of (imageUrls || []).slice(0, MAX_FRAMES)) {
    try {
      const resp = await axios.get(sanitizeImageUrl(url), {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      const buf = await sharp(Buffer.from(resp.data))
        .rotate()
        .resize(CELL_W, CELL_H, { fit: "cover" })
        .jpeg({ quality: 88 })
        .toBuffer();
      cells.push(buf);
    } catch (cellErr) {
      logger.warn(
        "🎬 [STYLE_PROFILE] Grid karesi indirilemedi, atlanıyor:",
        cellErr?.message,
      );
    }
  }
  if (cells.length === 0) {
    throw new Error("No style profile images could be loaded");
  }

  const cols = cells.length <= 1 ? 1 : cells.length <= 4 ? 2 : 3;
  const rows = Math.ceil(cells.length / cols);
  const W = cols * CELL_W + (cols + 1) * GAP;
  const H = rows * CELL_H + (rows + 1) * GAP;

  const composites = cells.map((buf, i) => ({
    input: buf,
    left: GAP + (i % cols) * (CELL_W + GAP),
    top: GAP + Math.floor(i / cols) * (CELL_H + GAP),
  }));

  const grid = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: grid, count: cells.length };
}

module.exports = {
  STYLE_REFERENCE_PLATE_VARIANT,
  isCurrentStyleReferencePlateUrl,
  stampStyleReferencePlate,
  buildStyleProfileGrid,
  sanitizeImageUrl,
};
