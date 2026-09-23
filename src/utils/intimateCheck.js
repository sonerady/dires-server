// 🩱 İç giyim / mayo-bikini / erotik giyim tespiti — prompt + karar mantığı (23 Eyl 2026).
// Kullanıcı kararı (23 Eyl): bikini ve mayo da KİLİTLENİR (category "swimwear").
// Uç: POST /api/product-type/intimate-check (routes/productTypeRoutes.js).
// Olumlu karar Model Oluştur'da gerçek model fotoğrafı seçimini kilitler
// (yalnız "Yapay Zekaya Bırak"); yanlış pozitif kullanıcıyı haksız kısıtlar,
// bu yüzden düşük güvenli ya da bozuk cevaplar ASLA kilitlemez.
const INTIMATE_PROMPT = `Look at the product(s) in the image(s) an online seller wants to show on a model.
Answer whether ANY item is INTIMATE or BODY-REVEALING apparel:
- lingerie / underwear: bras, bralettes, panties, briefs, boxers, underwear sets, corsets/bustiers worn as lingerie, garter belts, stockings sold as lingerie, babydolls, chemises, teddies, sheer/see-through nightwear, pasties, harness lingerie
- swimwear: bikinis (tops or bottoms), swimsuits, monokinis, trikinis, swim trunks/briefs, bathing suits of any cut
- erotic: fetish or erotic/sexy costume wear
NOT intimate: sportswear, crop tops, pajamas that are ordinary sleepwear, dresses (incl. beach cover-up dresses), kaftans/pareos, regular tops, socks, shapewear worn as outerwear.
Return ONLY JSON: {"intimate": true|false, "category": "lingerie"|"underwear"|"swimwear"|"erotic"|"none", "confidence": 0-1}`;

function parseIntimate(raw) {
  try {
    const text = String(raw || "");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const category = ["lingerie", "underwear", "swimwear", "erotic"].includes(json.category) ? json.category : "none";
    const confidence = Math.max(0, Math.min(1, Number(json.confidence) || 0));
    // Düşük güvenli "evet"ler kilitlemez — yanlış pozitif kullanıcının model seçimini haksız yere kapatır
    const intimate = json.intimate === true && category !== "none" && confidence >= 0.55;
    return { intimate, category: intimate ? category : "none", confidence };
  } catch {
    return { intimate: false, category: "none", confidence: 0 };
  }
}

module.exports = { INTIMATE_PROMPT, parseIntimate };
