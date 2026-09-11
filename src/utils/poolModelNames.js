/**
 * Model havuzu isimleri (10 Eyl 2026): her havuz modeline uygulamanın 70 dilinin
 * HER BİRİNDE o dile/kültüre ait, modern bir ilk isim (yerel alfabede). DeepSeek
 * tek istekte JSON döndürür; her dil için havuzdaki mevcut isimler dışlanır,
 * eksik/çakışan diller yeniden istenir. Sonuç: { tr: "Defne", en: "Ava", ja: "葵", … }
 */
const fs = require("fs");
const path = require("path");

let LOCALES = null;
function poolLocales() {
  if (LOCALES) return LOCALES;
  try {
    const dir = path.join(__dirname, "../../../client/locales");
    LOCALES = fs.readdirSync(dir).filter((f) => /^[a-z]{2,3}\.json$/.test(f) && f !== "web.json").map((f) => f.slice(0, -5)).sort();
  } catch (_) {
    LOCALES = ["en", "tr", "de", "fr", "es", "it", "pt", "ru", "ar", "ja", "ko", "zh"];
  }
  return LOCALES;
}

const norm = (v) => String(v || "").trim().toLowerCase();
const validName = (v) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 30 && !/[\d{}\[\]"<>]/.test(v);

/**
 * Latin alfabesi KULLANMAYAN diller: bu dillerde Latin harfli bir isim gelirse
 * (ör. ja → "Ella") reddedilip yeniden istenir. Daha önce tek bir Afrikaans/Amharca
 * ismin 70 dile kopyalanması bu yüzden olmuştu.
 */
const NON_LATIN = new Set(["am", "ar", "be", "bg", "bn", "el", "fa", "gu", "he", "hi", "hy", "ja", "ka", "kk", "km", "kn", "ko", "ky", "lo", "mk", "ml", "mn", "mr", "my", "ne", "pa", "ru", "si", "sr", "ta", "te", "th", "uk", "ur", "zh"]);
const hasLatin = (v) => /[A-Za-z]/.test(v);
const scriptOk = (lang, v) => !NON_LATIN.has(lang) || !hasLatin(v);

/** Öncelik: en, tr, sonra alfabetik; istek başına en fazla CHUNK dil (70 dil tek istekte bozuluyordu). */
const CHUNK = 12;
const orderLangs = (langs) => { const head = ["en", "tr"].filter((l) => langs.includes(l)); return [...head, ...langs.filter((l) => !head.includes(l))]; };
const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

function buildPrompt({ gender, age, langs, exclude }) {
  const excludeLines = langs
    .filter((l) => (exclude[l] || []).length)
    .map((l) => `${l}: ${exclude[l].slice(0, 40).join(", ")}`)
    .join("\n");
  return `Task: choose ONE modern, contemporary FIRST NAME for a fictional ${gender === "man" ? "male" : "female"} fashion model, about ${age || 24} years old, in EACH of the following languages/cultures. Use the native script of each language (Arabic script for ar/fa/ur, Cyrillic for ru/uk/bg/etc., Kanji/Kana for ja, Hangul for ko, Hanzi for zh, Devanagari for hi/mr/ne, etc.). Every name must be a real, currently popular given name in that culture (2020s), not archaic, not a celebrity. Names must differ across languages where the cultures differ; sharing between closely related cultures is fine.
Language codes (ISO 639-1/2): ${langs.join(", ")}
Do NOT use any of these names (already taken) for the given language:
${excludeLines || "(none)"}
Return ONLY a JSON object mapping every language code above to its name, e.g. {"en":"Ava","tr":"Defne"}. No markdown, no commentary.`;
}

const parseJson = (raw) => {
  try { return JSON.parse(String(raw).replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()); } catch (_) {}
  const m = String(raw).match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
};

async function generatePoolModelNames({ gender = "woman", age = "24", exclude = {}, callText, attempts = 3, langs = poolLocales(), chunkSize = CHUNK }) {
  if (typeof callText !== "function") throw new Error("callText required");
  const names = {};
  const ordered = orderLangs(langs);
  for (const group of chunk(ordered, chunkSize)) {
    let pending = [...group];
    for (let attempt = 0; attempt < attempts && pending.length; attempt++) {
      const prompt = buildPrompt({ gender, age, langs: pending, exclude });
      let raw;
      try { raw = await callText(prompt); } catch (_) { continue; }
      const parsed = parseJson(raw);
      if (!parsed || typeof parsed !== "object") continue;
      for (const lang of pending) {
        const v = parsed[lang];
        if (!validName(v) || !scriptOk(lang, v)) continue;
        const taken = new Set((exclude[lang] || []).map(norm));
        if (taken.has(norm(v))) continue;
        names[lang] = v.trim();
      }
      pending = group.filter((l) => !names[l]);
    }
  }
  // Son çare: yalnız İNGİLİZCE isim kopyalanır (Latin alfabeli diller için okunabilir).
  // Latin olmayan diller boş kalır → istemci/sunucu names.en'e düşer. Rastgele ilk
  // bulunan (af/am gibi) ismin 70 dile kopyalanması ARTIK YOK.
  if (names.en) for (const l of langs) if (!names[l] && !NON_LATIN.has(l)) names[l] = names.en;
  return names;
}

/**
 * İsim metni sağlayıcısı: önce Replicate/Gemini (google/gemini-3-flash), hata olursa
 * DeepSeek. Sistem talimatı: yalnız istenen şekilde JSON.
 */
const NAMES_SYSTEM = "Return only valid JSON exactly in the requested shape. No markdown, no commentary.";
async function callPoolNamesText(prompt) {
  const provider = require("./promptEnhanceProvider");
  const options = { systemInstruction: NAMES_SYSTEM, maxOutputTokens: 1024, temperature: 0.9, timeoutMs: 45000 };
  try { return await provider.callReplicateGeminiFlashRaw(prompt, [], 2, options); }
  catch (error) {
    console.warn("[Model pool] Gemini naming failed, DeepSeek fallback:", error.message);
    return provider.callDeepSeekFlashRaw(prompt, [], 1, NAMES_SYSTEM, options);
  }
}

module.exports = { generatePoolModelNames, poolLocales, buildPrompt, NON_LATIN, callPoolNamesText };
