// 👧 Çocuk model güvenliği (7 Eki 2026, destek talebi #768696a9 — Çin, çocuk giyim satıcısı).
//
// Yaş 13'ün altında seçildiğinde final prompt modeli yetişkin gibi tarif ediyordu:
//   "Create a brand-new, 5-year-old woman AI-generated fashion model"
//   "PRIMARY/HERO MODEL GENDER PRESENTATION: woman"
//   "…adapting its worn geometry to the model's bust, waist, hips, shoulders and limbs…"
// Görsel modeli "kadın" + "göğüs/kalça" ifadelerini izleyip 6 yaşındaki kıza yetişkin vücut hatları
// çizebiliyordu; bazen de kız seçilmişken erkek çocuk üretiyordu. Bu yardımcı finalizeGenerationPrompt'un
// sonunda çalışır: woman/man → girl/boy, bust/hips cümlesi → çocuk vücudu, sona çocuk oranları kilidi.
// Yetişkin (13+) ya da yaşsız isteklerde prompt'a DOKUNMAZ.

const MINOR_MAX_AGE = 12;

/** settings.age → çocuk yaşı (0–12) ya da null. "5", 5, "18 months", "0-3 ay" (bebek) gibi değerleri okur. */
function minorAgeOf(settings) {
  const raw = settings?.age;
  if (raw === undefined || raw === null || raw === "" || raw === "auto") return null;
  const text = String(raw).trim().toLowerCase();
  if (/\b(month|months|ay|aylık|bebek|baby|infant|newborn)\b/.test(text)) return 0;
  const match = text.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const age = Number(match[0].replace(",", "."));
  if (!Number.isFinite(age)) return null;
  return age <= MINOR_MAX_AGE ? Math.floor(age) : null;
}

/** Cinsiyet etiketi → çocuk karşılığı ("girl" / "boy" / null). */
function childGenderTerm(gender) {
  const g = String(gender || "").trim().toLowerCase();
  if (!g || g === "auto") return null;
  if (/^(woman|women|female|girl|kadın|kadin|kız|kiz|女)/.test(g)) return "girl";
  if (/^(man|men|male|boy|erkek|男)/.test(g)) return "boy";
  return null;
}

function childDirective(age, term) {
  const who = term ? `${age}-year-old ${term}` : `${age}-year-old child`;
  const lines = [
    `👧 CHILD MODEL — HIGHEST PRIORITY, NON-NEGOTIABLE: The PRIMARY/HERO model is a ${who}, a real young child — never an adult, teenager or adult-styled model.`,
    // ⚠️ Anatomi kelimesi yok (breast/bust/chest/hips/cleavage): "çocuk" ile birlikte görsel sağlayıcının içerik
    // filtresini (422) tetikleyebilir. Çocuk oranları silüet ve katalog diliyle tarif edilir.
    `Render true-to-age childlike proportions exactly like real children's catalog photography: the larger head-to-height ratio, shorter limbs, a soft, straight and flat childlike silhouette with no grown-up or womanly figure, and a child's face with soft round features.`,
    `Fit the garment to the child's own small frame exactly as children's clothing sits in real kids' catalog photos — never shaped to an adult figure.`,
    `Styling stays age-appropriate: no makeup glamour, no lipstick, no fashion-model or sultry posing, no adult expressions; natural, playful, innocent child energy.`,
  ];
  if (term === "girl") {
    lines.push(`The child is clearly a GIRL (the user selected girl); keep a recognisably girlish hairstyle and appearance — never render a boy.`);
  } else if (term === "boy") {
    lines.push(`The child is clearly a BOY (the user selected boy); keep a recognisably boyish hairstyle and appearance — never render a girl.`);
  }
  return lines.join(" ");
}

/**
 * Final prompt'u çocuk modele göre düzeltir. Yaş ≤ 12 değilse girdiyi olduğu gibi döndürür.
 * @param {string} prompt
 * @param {object} settings istek ayarları (age, gender)
 */
function applyMinorModelSafety(prompt, settings) {
  const age = minorAgeOf(settings);
  const text = String(prompt || "");
  if (age === null || !text) return text;
  if (text.includes("👧 CHILD MODEL — HIGHEST PRIORITY")) return text;
  const term = childGenderTerm(settings?.gender);

  let out = text
    // "5-year-old woman" / "5-year-old man" → çocuk karşılığı
    .replace(/\b(\d{1,2})-year-old\s+(women|woman|female)\b/gi, "$1-year-old girl")
    .replace(/\b(\d{1,2})-year-old\s+(men|man|male)\b/gi, "$1-year-old boy")
    // "GENDER PRESENTATION: woman." → "GENDER PRESENTATION: girl (child)."
    .replace(/(GENDER PRESENTATION:\s*)(woman|women|female)\b/gi, `$1girl (a ${age}-year-old child)`)
    .replace(/(GENDER PRESENTATION:\s*)(man|men|male)\b/gi, `$1boy (a ${age}-year-old child)`)
    // giysiyi yetişkin hatlarına oturtan sabit cümle
    .replace(/the model's bust, waist, hips, shoulders and limbs/gi, "the child's small natural frame, shoulders and arms");

  out = `${out}\n\n${childDirective(age, term)}`;
  return out;
}

module.exports = { applyMinorModelSafety, minorAgeOf, childGenderTerm, MINOR_MAX_AGE };
