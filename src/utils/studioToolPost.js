// 🧰 Ürün Stüdyosu son işleme (23 Eyl 2026)
//
// Görüntü modeli "saf beyaz arka plan, ürün karenin %85'i" talimatına çoğu
// zaman yaklaşır ama pazaryeri denetimi piksel sayar: Amazon ana görselde
// arka plan RGB 255 olmalı ve ürün kareyi ~%85 doldurmalı, yoksa ürün
// bastırılır. Bu yüzden ana görselde son söz sunucuda:
//   1) açık-nötr kenar zemini saf beyaza çekilir (gerekirse kenardan taşma dolgusu),
//   2) ürünün sınır kutusu bulunur ve hedef doluluğa ölçeklenir,
//   3) tam piksel ölçüsündeki beyaz tuvale ortalanır (sRGB JPEG).
// Bannerlar platformun istediği tam piksel ölçüsüne kırpılır.
const sharp = require("sharp");

const WORK_MAX = 2048; // analiz çözünürlüğü (hız)

/** Açık ve nötr piksel mi? (arka plan adayı) */
function isLightNeutral(r, g, b, min) {
  return r >= min && g >= min && b >= min && Math.max(r, g, b) - Math.min(r, g, b) <= 14;
}

/**
 * Kenardan başlayan taşma dolgusu: kenara bağlı açık-nötr pikselleri saf beyaz yapar.
 * Ürünün içindeki beyaz alanlara dokunmaz (kenara bağlı değillerse).
 */
function floodWhiten(data, width, height, channels, min) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const push = (x, y) => {
    const p = y * width + x;
    if (visited[p]) return;
    const i = p * channels;
    if (!isLightNeutral(data[i], data[i + 1], data[i + 2], min)) return;
    visited[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  let changed = 0;
  while (head < tail) {
    const p = queue[head++];
    const i = p * channels;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
    changed++;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return changed;
}

/** Neredeyse beyaz (≥ min, nötr) pikselleri saf beyaza iter — 246→255 adımı gözle seçilmez. */
function snapNearWhite(data, channels, min = 246) {
  for (let i = 0; i < data.length; i += channels) {
    if (isLightNeutral(data[i], data[i + 1], data[i + 2], min)) {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
    }
  }
}

/** Kenar şeridinin (%2) ne kadarı saf beyaz? 0–1 */
function borderWhiteRatio(data, width, height, channels) {
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  let white = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const i = (y * width + x) * channels;
      total++;
      if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) white++;
    }
  }
  return total ? white / total : 0;
}

/** Saf beyaz olmayan piksellerin sınır kutusu. */
function contentBox(data, width, height, channels) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Pazaryeri ana görseli.
 * @param {Buffer} input
 * @param {{width:number,height:number,fill:number,white:boolean}} spec
 * @returns {Promise<{buffer:Buffer, meta:object}>}
 */
async function marketplaceMainImage(input, spec) {
  const base = sharp(input, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: "#ffffff" }).toColorspace("srgb");
  if (!spec.white) {
    // Etsy: arka plan serbest; tam ölçü (4:3), merkez kırpma
    const buffer = await base
      .resize(spec.width, spec.height, { fit: "cover", position: "centre", kernel: "lanczos3" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toBuffer();
    return { buffer, meta: { width: spec.width, height: spec.height, whiteBackground: false, format: "jpeg" } };
  }

  const { data, info } = await base
    .resize({ width: WORK_MAX, height: WORK_MAX, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  snapNearWhite(data, channels, 246);
  let flooded = false;
  if (borderWhiteRatio(data, width, height, channels) < 0.92) {
    // Model açık gri / gradyan zemin verdi → kenara bağlı açık-nötr alanlar beyaza
    floodWhiten(data, width, height, channels, 228);
    flooded = true;
  }
  const box = contentBox(data, width, height, channels);
  if (!box) throw new Error("empty_main_image");

  // Ürün kutusu, sınır pikselleri kaybolmasın diye 1 px pay ile kesilir
  const pad = 1;
  const crop = {
    left: Math.max(0, box.left - pad),
    top: Math.max(0, box.top - pad),
    width: Math.min(width - Math.max(0, box.left - pad), box.width + pad * 2),
    height: Math.min(height - Math.max(0, box.top - pad), box.height + pad * 2),
  };
  const cleaned = sharp(data, { raw: { width, height, channels } });
  const targetW = Math.round(spec.width * spec.fill);
  const targetH = Math.round(spec.height * spec.fill);
  const product = await cleaned
    .extract(crop)
    .resize(targetW, targetH, { fit: "inside", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Ölçekleme kenarlarda 250–254 ara tonları üretir → yeniden saf beyaza it
  snapNearWhite(product.data, product.info.channels, 246);
  const productPng = await sharp(product.data, { raw: product.info }).png().toBuffer();
  const left = Math.round((spec.width - product.info.width) / 2);
  const top = Math.round((spec.height - product.info.height) / 2);
  const buffer = await sharp({ create: { width: spec.width, height: spec.height, channels: 3, background: "#ffffff" } })
    .composite([{ input: productPng, left, top }])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const fill = Math.max(product.info.width / spec.width, product.info.height / spec.height);
  return {
    buffer,
    meta: {
      width: spec.width,
      height: spec.height,
      fillPercent: Math.round(fill * 100),
      whiteBackground: true,
      backgroundRepaired: flooded,
      format: "jpeg",
    },
  };
}

/**
 * Kesim çizgisinin maliyeti: çizgi boyunca ona dik kenar enerjisi.
 * Yükseklik kırpılırken kesim yataydır; satır boyunca yatay türev toplanır. Düz duvar ya da
 * zemin ~0 verir; ürünün (ya da bir nesnenin) içinden geçen satırda siluet kenarları ve doku
 * yüksek enerji üretir. 8 birimin altındaki farklar (gren, yumuşak gölge) sayılmaz.
 */
function cutLineEnergies(data, width, height, channels, horizontal) {
  const luma = (i) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  const lines = horizontal ? height : width;
  const out = new Float64Array(lines);
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    const steps = horizontal ? width - 1 : height - 1;
    for (let k = 0; k < steps; k++) {
      const a = horizontal ? (line * width + k) * channels : (k * width + line) * channels;
      const b = horizontal ? a + channels : a + width * channels;
      const d = Math.abs(luma(a) - luma(b)) - 8;
      if (d > 0) sum += d;
    }
    out[line] = sum / steps;
  }
  return out;
}

/**
 * Taşan eksende pencere ofseti: iki kesim çizgisi de mümkün olduğunca sakin bölgeden geçsin
 * (ürünün kapağını/tabanını kesmesin); eşitlikte merkeze yakın olan seçilir.
 */
function calmCropOffset(energies, windowSize) {
  const total = energies.length;
  const maxOffset = total - windowSize;
  if (maxOffset <= 0) return 0;
  const band = (pos) => {
    let sum = 0;
    let n = 0;
    for (let p = Math.max(0, pos - 2); p <= Math.min(total - 1, pos + 2); p++) { sum += energies[p]; n++; }
    return sum / n;
  };
  let mean = 0;
  for (let i = 0; i < total; i++) mean += energies[i];
  mean /= total;
  const mid = maxOffset / 2;
  let best = Math.round(mid);
  let bestScore = Infinity;
  for (let offset = 0; offset <= maxOffset; offset++) {
    const score = band(offset) + band(offset + windowSize - 1) + 0.35 * mean * (Math.abs(offset - mid) / Math.max(1, mid));
    if (score < bestScore) { bestScore = score; best = offset; }
  }
  return best;
}

/** Banner tam ölçü. 3:1 üretimden 4:1 / 5:1'e inerken yüksekliğin %25–40'ı atılır; merkez ya da
 *  "attention" kırpma ürün yüksek/büyük durduğunda kapağı kesiyordu. Pencere, kesim çizgileri
 *  nesnelerin içinden değil sakin duvar/zeminden geçecek şekilde seçilir. */
async function exactSize(input, spec) {
  const src = await sharp(input, { limitInputPixels: 80_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColorspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scale = Math.max(spec.width / src.info.width, spec.height / src.info.height);
  const coverW = Math.max(spec.width, Math.round(src.info.width * scale));
  const coverH = Math.max(spec.height, Math.round(src.info.height * scale));
  const { data, info } = await sharp(src.data, { raw: src.info })
    .resize(coverW, coverH, { kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = 0;
  let top = 0;
  if (info.height > spec.height) {
    top = calmCropOffset(cutLineEnergies(data, info.width, info.height, info.channels, true), spec.height);
  } else if (info.width > spec.width) {
    left = calmCropOffset(cutLineEnergies(data, info.width, info.height, info.channels, false), spec.width);
  }
  const buffer = await sharp(data, { raw: info })
    .extract({ left, top, width: spec.width, height: spec.height })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { buffer, meta: { width: spec.width, height: spec.height, format: "jpeg" } };
}

/** Son işlemesiz araçlar: yön düzeltme + sRGB JPEG (mobilde hızlı açılır). */
async function standardOutput(input) {
  const image = sharp(input, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: "#ffffff" }).toColorspace("srgb");
  const { width, height } = await image.metadata();
  const buffer = await image.jpeg({ quality: 93, chromaSubsampling: "4:4:4" }).toBuffer();
  return { buffer, meta: { width, height, format: "jpeg" } };
}

module.exports = { marketplaceMainImage, exactSize, standardOutput, floodWhiten, snapNearWhite, contentBox, borderWhiteRatio, calmCropOffset };
