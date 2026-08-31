// 🎨 Refiner arka plan renginin HEX karşılığı (28 Ağu 2026, kullanıcı isteği)
//
// Sorun: kullanıcı Refiner'da arka plan rengini KENDİ DİLİNDE serbest metin
// olarak yazıyor ("Beyaz", "Branco", "sage green"…) ve kayda o metin gidiyor.
// İstemci sonucu SimpleImageModal'da açtığında zemini o renge boyamak istiyor
// ama elinde bir hex yok. Burası o metni bir kez hex'e çevirir ve sonuç
// generation kaydına yazılır — modal artık tahmin etmez, okur.
//
// Maliyet düzeni: önce ücretsiz yollar (zaten hex mi / bilinen renk adı mı),
// yalnız ikisi de tutmazsa Gemini'ye TEK ve çok kısa bir soru gider.
const { callGeminiFlash } = require("./promptEnhanceProvider");

/** "#fff" / "fff" / "#FFFFFF" → "#FFFFFF"; değilse null. */
function normalizeHex(raw) {
  const s = String(raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toUpperCase()}`;
  // 8 haneli (alfa'lı) girdide alfayı düşürüp RGB'yi koruyoruz
  if (/^[0-9a-fA-F]{8}$/.test(s)) return `#${s.slice(0, 6).toUpperCase()}`;
  return null;
}

// Ücretsiz hızlı yol. Uygulamanın en çok kullanılan dilleri + İngilizce.
// Buradaki her giriş Gemini'ye gitmeyen bir istek demek; listeyi genişletmek
// serbest ama HEX'ler nötr/katalog tonları olmalı (parlak "saf" renkler ürün
// fotoğrafında zemin olarak kullanılmıyor).
const KNOWN_COLORS = {
  // İngilizce
  white: "#FFFFFF", black: "#000000", gray: "#9CA3AF", grey: "#9CA3AF",
  red: "#DC2626", blue: "#2563EB", green: "#16A34A", yellow: "#FACC15",
  orange: "#EA580C", purple: "#7C3AED", pink: "#EC4899", brown: "#8B5E3C",
  beige: "#E8DCC8", cream: "#F5EFE0", navy: "#1E3A5F", "navy blue": "#1E3A5F",
  ivory: "#FFFFF0", sand: "#E3D5B8", taupe: "#B8A99A", charcoal: "#36393D",
  // Türkçe
  beyaz: "#FFFFFF", siyah: "#000000", gri: "#9CA3AF", kırmızı: "#DC2626",
  kirmizi: "#DC2626", mavi: "#2563EB", yeşil: "#16A34A", yesil: "#16A34A",
  sarı: "#FACC15", sari: "#FACC15", turuncu: "#EA580C", mor: "#7C3AED",
  pembe: "#EC4899", kahverengi: "#8B5E3C", bej: "#E8DCC8", krem: "#F5EFE0",
  lacivert: "#1E3A5F", ekru: "#F0EAD6",
  // Portekizce / İspanyolca
  branco: "#FFFFFF", preto: "#000000", cinza: "#9CA3AF", bege: "#E8DCC8",
  blanco: "#FFFFFF", negro: "#000000", gris: "#9CA3AF", beige_es: "#E8DCC8",
  // Almanca / Fransızca / Felemenkçe / İtalyanca
  weiss: "#FFFFFF", weiß: "#FFFFFF", schwarz: "#000000", grau: "#9CA3AF",
  blanc: "#FFFFFF", noir: "#000000", gris_fr: "#9CA3AF",
  wit: "#FFFFFF", zwart: "#000000", grijs: "#9CA3AF",
  bianco: "#FFFFFF", nero: "#000000", grigio: "#9CA3AF",
  // Latin dışı yazılar — canlı veride sık görülenler (28 Ağu 2026 sayımı:
  // "白色" 13, "Белый" 4). Haritada olmayan her renk Gemini'ye gidiyor;
  // buraya eklemek hem parayı hem ~5-14 sn gecikmeyi ortadan kaldırıyor.
  白色: "#FFFFFF", 黑色: "#000000", 灰色: "#9CA3AF",
  белый: "#FFFFFF", черный: "#000000", чёрный: "#000000", серый: "#9CA3AF",
  白: "#FFFFFF", 黒: "#000000", 흰색: "#FFFFFF", 검정: "#000000",
  أبيض: "#FFFFFF", أسود: "#000000",
  branco_pt: "#FFFFFF",
  // Canlı veri taraması (28 Ağu 2026, 169 farklı renk metni): aşağıdakiler
  // yüzlerce kez geçiyordu ama haritada olmadıkları için Gemini'ye gidiyorlardı.
  trắng: "#FFFFFF", trang: "#FFFFFF", đen: "#000000",     // Vietnamca
  білий: "#FFFFFF", чорний: "#000000",                     // Ukraynaca
  hvid: "#FFFFFF", hvit: "#FFFFFF", sort: "#000000",       // Danca/Norveççe
  vit: "#FFFFFF", svart: "#000000",                        // İsveççe
  biały: "#FFFFFF", czarny: "#000000",                     // Lehçe
  fehér: "#FFFFFF", fekete: "#000000",                     // Macarca
  alb: "#FFFFFF", negru: "#000000",                        // Romence
  bílá: "#FFFFFF", černá: "#000000",                       // Çekçe
  putih: "#FFFFFF", hitam: "#000000",                      // Endonezce/Malayca
  λευκό: "#FFFFFF", μαύρο: "#000000",                      // Yunanca
  सफेद: "#FFFFFF", काला: "#000000",                          // Hintçe
  ขาว: "#FFFFFF", ดำ: "#000000",                            // Tayca
  לבן: "#FFFFFF", שחור: "#000000",                          // İbranice
  سفید: "#FFFFFF", سیاه: "#000000",                         // Farsça
};

// ⏱️ Bu çözümleme ÜRETİM İSTEĞİNİN İÇİNDE çalışıyor: sağlayıcı yavaşlarsa ya da
// kotası biterse kullanıcının üretimi bekler. Ölçüldü (28 Ağu 2026): normalde
// 5-14 sn, ama sağlayıcı hatasında fallback zinciri 60 sn'ye kadar gidebiliyor.
// Zemin rengi kozmetik bir ayrıntı — üretimi geciktirmesine izin verilmez.
const GEMINI_HEX_TIMEOUT_MS = 9000;

/** Gemini'ye tek satırlık hex sorusu. Başarısızsa null döner (akış durmaz). */
async function askGeminiForHex(colorText) {
  const prompt =
    `You are a colour reference. A seller described a product-photo background colour ` +
    `in their own language: "${String(colorText).slice(0, 120)}".\n` +
    `Return the single closest sRGB hex code for that colour as it would be used as a ` +
    `flat studio background. If the description is vague, choose the most typical ` +
    `catalog interpretation. If it is not a colour at all, return #FFFFFF.\n` +
    `Answer with ONLY the hex code, nothing else. Example: #F2E8DC`;
  try {
    const raw = await Promise.race([
      callGeminiFlash(prompt, [], 1),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`hex sorusu ${GEMINI_HEX_TIMEOUT_MS}ms içinde yanıtlanmadı`)),
          GEMINI_HEX_TIMEOUT_MS,
        ),
      ),
    ]);
    const match = String(raw || "").match(/#?[0-9a-fA-F]{6}\b/);
    return match ? normalizeHex(match[0]) : null;
  } catch (err) {
    console.warn("⚠️ [BG_HEX] Gemini hex sorusu başarısız:", err?.message || err);
    return null;
  }
}

/**
 * Serbest metin rengi hex'e çevirir.
 * @param {string} colorText Kullanıcının yazdığı renk ("Beyaz", "#F5F5F5", "sage green")
 * @param {string} colorInputMode "hex" ise metin zaten hex kabul edilir
 * @returns {Promise<string|null>} "#RRGGBB" ya da çözülemezse null
 */
async function resolveBackgroundHex(colorText, colorInputMode = "text") {
  const text = String(colorText || "").trim();
  if (!text) return null;

  // 1) Zaten hex mi? (mod "hex" olmasa bile kullanıcı hex yazmış olabilir)
  const direct = normalizeHex(text);
  if (direct) return direct;
  // Mod "hex" ama değer geçersizse tahmine gitmiyoruz — veri hatalı demektir.
  if (String(colorInputMode).toLowerCase() === "hex") return null;

  // 2) Bilinen renk adı mı?
  const known = KNOWN_COLORS[text.toLowerCase()];
  if (known) return known;

  // 3) Son çare: Gemini
  return askGeminiForHex(text);
}

/**
 * 🖌️ Prompt metinlerinde kullanılacak zemin tarifi — SENKRON (Gemini yok).
 *
 * Sahneleme (staging) promptları model çağrısından çok önce kuruluyor ve orada
 * async beklemek istemiyoruz; bu yüzden yalnız ücretsiz yollar kullanılır.
 * Renk çözülemezse kullanıcının yazdığı metin olduğu gibi verilir — model
 * "sage green" gibi ifadeleri zaten yorumlayabiliyor.
 *
 * @returns {{isWhite: boolean, hex: string|null, label: string}}
 */
function describeBackgroundForPrompt(settings = {}) {
  const raw = String(settings?.backgroundColor || "").trim();
  // Renk hiç seçilmemişse bugünkü davranış: saf beyaz.
  if (!raw) return { isWhite: true, hex: "#FFFFFF", label: "pure-white" };

  const hex = normalizeHex(raw) || KNOWN_COLORS[raw.toLowerCase()] || null;
  if (!hex) {
    // Çözülemeyen serbest metin: modele kullanıcının kendi ifadesi gider.
    return { isWhite: false, hex: null, label: raw };
  }
  const isWhite = hex === "#FFFFFF";
  return { isWhite, hex, label: isWhite ? "pure-white" : hex };
}

module.exports = {
  resolveBackgroundHex,
  normalizeHex,
  KNOWN_COLORS,
  describeBackgroundForPrompt,
};
