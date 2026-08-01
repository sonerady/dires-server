// 🛡️ BOŞ REFERANS GUARD'I
//
// Client, çoklu ürün/açı fotoğrafını gizli bir ViewShot çerçevesinde tek kolaja
// çeviriyor. Resimler çizilmeden capture alınırsa eline BEMBEYAZ bir kare
// geçiyor ve bu kare "ürün referansı" olarak üretime giriyordu. Model kıyafeti
// göremeyince uyduruyor, sonuç fotoğraf yerine 3D render gibi çıkıyordu
// (canlıda görüldü). Client tarafı onLoad beklemesi + boyut doğrulamasıyla
// düzeltildi; bu guard eski sürümdeki kullanıcılar ve beklenmedik durumlar için
// son savunma hattı.
//
// Üretim BAŞLAMADAN çalıştırılır: kredi düşmez, kayıt açılmaz.
const axios = require("axios");
const sharp = require("sharp");
const logger = require("./logger");

// Tamamen tek renk bir görüntüde tüm kanalların standart sapması ~0 olur.
// Eşik bilinçli olarak düşük: beyaz zeminli GERÇEK ürün fotoğraflarında bile
// gölge/kenar kontrastı stdev'i 5'in üstüne çıkarıyor (ölçüldü: 58.6).
// Bembeyaz kolajda ölçülen değer: 0.000.
const BLANK_STDEV_THRESHOLD = 2.5;

// Referans girdisinden (base64 veya URL) buffer üretir.
async function loadReferenceBuffer(entry, sanitizeImageUrl) {
  if (!entry) return null;

  if (typeof entry?.base64 === "string" && entry.base64.length > 0) {
    return Buffer.from(
      entry.base64.replace(/^data:image\/[a-z]+;base64,/i, ""),
      "base64",
    );
  }

  const rawUrl = entry?.uri || entry?.url || entry;
  const url =
    typeof sanitizeImageUrl === "function" ? sanitizeImageUrl(rawUrl) : rawUrl;
  if (typeof url !== "string" || !url.startsWith("http")) return null;

  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
  });
  return Buffer.from(resp.data);
}

// Görüntü neredeyse tek renk mi? Kontrol edilemezse null döner (üretim bloklanmaz).
async function isBlankImage(entry, sanitizeImageUrl, logTag = "BLANK GUARD") {
  try {
    const buffer = await loadReferenceBuffer(entry, sanitizeImageUrl);
    if (!buffer) return null;

    const stats = await sharp(buffer).stats();
    const maxChannelStdev = Math.max(...stats.channels.map((c) => c.stdev));

    if (maxChannelStdev < BLANK_STDEV_THRESHOLD) {
      logger.error(
        `🛡️ [${logTag}] Referans neredeyse tek renk (max stdev: ${maxChannelStdev.toFixed(2)}) — üretim reddediliyor`,
      );
      return true;
    }

    logger.log(
      `🛡️ [${logTag}] Referans sağlıklı (max stdev: ${maxChannelStdev.toFixed(1)})`,
    );
    return false;
  } catch (err) {
    // Kontrol edilemiyorsa üretimi bloklama — bu yalnızca bir güvenlik ağı
    logger.warn(
      `🛡️ [${logTag}] Kontrol yapılamadı, devam ediliyor:`,
      err?.message,
    );
    return null;
  }
}

// Route'larda kullanılan standart red gövdesi
const BLANK_REFERENCE_RESPONSE = {
  success: false,
  result: {
    errorCode: "BLANK_REFERENCE_GRID",
    message:
      "Your product photos could not be processed (the combined reference image is blank). Please try generating again.",
  },
};

module.exports = {
  BLANK_STDEV_THRESHOLD,
  BLANK_REFERENCE_RESPONSE,
  isBlankImage,
};
