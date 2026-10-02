// 🌐 Banner şablonlarının eksik dil kayıtlarını DeepSeek ile toplu yazar (30 Eyl 2026, kullanıcı isteği:
// "tüm dilleri localize yap, DeepSeek kullan"). Codex'in kurduğu authored/<lang>.json biçimine BİREBİR yazar
// (author.js write ile aynı doğrulama: dizi uzunluğu = kaynak metin sayısı, ilk değer şablon adı, null = korunur).
// Yalnız eksik ya da kaynağı değişmiş (source_hash) şablonlar çevrilir; elle yazılmış kayıtlara dokunulmaz.
//
//   node scripts/banner-templates/deepseek-translate.js [lang,lang,...|all] [--concurrency 8] [--limit N]
//
// Bağlam için modele İngilizce kaynağın yanında Türkçe (elle yazılmış, 610/610) karşılığı da verilir — ayrı ayrı
// biçimlenmiş parçaların hangi cümleye ait olduğunu anlaması için.
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const { TEMPLATES } = require("../../src/data/bannerTemplates");
const { sourceFor } = require("../../src/data/bannerTemplates/localize");

const ROOT = path.resolve(__dirname, "../../src/data/bannerTemplates/authored");
const MODEL = process.env.BANNER_TRANSLATE_MODEL || "deepseek-v4-flash";
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const CONCURRENCY = Number(opt("--concurrency", 8));
const LIMIT = Number(opt("--limit", 0));
const MAX_STRINGS_PER_CALL = 90;

const LANGUAGE_NAMES = { "zh-Hant": "Traditional Chinese (Taiwan)", zh: "Simplified Chinese", no: "Norwegian Bokmål", fil: "Filipino", rm: "Romansh", pt: "Brazilian Portuguese", es: "Spanish", sr: "Serbian (Cyrillic)", mn: "Mongolian (Cyrillic)" };
const languageName = (code) => {
  if (LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code; } catch (e) { return code; }
};

// sayılar, yüzde, para simgesi ve [token]'lar görüntülenirken Intl ile biçimlenir → null (author.js kuralı)
const FIXED = (text) => /^\[[a-z]+:[^\]]+\]$/.test(text) || /^\d[\d.,:\s]*$/.test(text) || text === "%" || /^[$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨]$/u.test(text)
  || /^[$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨]\s*\d[\d,]*(\.\d{1,2})?$/u.test(text) || /^\d[\d,]*(\.\d{1,2})?\s*[$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨]$/u.test(text)
  || /^[→←›‹↗↘✦✶★☆•·—–\-+×/|]+$/.test(text);

const SYSTEM = `You are a senior native-speaker copywriter who localizes fashion and e-commerce banner templates. You receive banners as JSON: each has "id", "name" and "strings" (the English source fragments in reading order; strings[0] is the banner's display name) and, when available, "tr" (a reviewed Turkish translation of the same array, for meaning only).
Return ONLY JSON: {"<id>": [ ...translated array... ], ...} — one array per banner, SAME length and order as its "strings".
Rules:
- Write natural, idiomatic marketing copy a native speaker would print on a real shop banner (not word-for-word). Keep each fragment roughly as long as the source (±40%) — the design has fixed room; shorter is better than longer.
- Fragments are separately styled pieces of the same sentence/phrase. Translate them so that, read in order, they form a correct phrase in the target language (you may move meaning between neighbouring fragments), but never merge or drop array items.
- Return null (JSON null) for: promo/discount codes (e.g. FLASH50, WINTER30), brand and shop names (invented brands like "Maison Lune", "Atelier Nord", "Studio Oro"), people's names, website/@handles/hashtags, SKU/model/serial codes, and fragments that are only numbers, prices, currency signs, "%" or symbols/arrows — these are kept or locale-formatted automatically.
- Keep arrows and symbols that sit inside a translated fragment (e.g. "Shop now →" → keep the arrow at the end; for right-to-left languages use "←").
- Translate dates, weekday/month names and time words into the target language's own format.
- Put the percent sign where the language requires when a fragment contains it in text (e.g. Turkish "%40").
- If a fragment has no counterpart in the target language (e.g. a lone "of"/"the" whose meaning moved into a neighbour), return "" (empty string) for it — never skip it: the array MUST keep exactly the same number of items.
- Keep uppercase kickers short. Never add quotes, explanations or extra keys.`;

async function callDeepSeek(batch, lang, attempt = 1) {
  const user = `Target language: ${languageName(lang)} (${lang}).\n\n${JSON.stringify(batch)}`;
  try {
    const resp = await axios.post("https://api.deepseek.com/chat/completions", {
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      temperature: 0.3,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: 8000,
    }, { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, timeout: 180000 });
    const usage = resp.data.usage || {};
    const text = resp.data.choices?.[0]?.message?.content || "";
    return { json: JSON.parse(text.replace(/^```json\s*|```$/g, "")), usage };
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return callDeepSeek(batch, lang, attempt + 1);
  }
}

function validate(entry, source, values) {
  if (!Array.isArray(values) || values.length !== source.strings.length) return `length ${values?.length} ≠ ${source.strings.length}`;
  if (typeof values[0] !== "string" || !values[0].trim()) return "name missing";
  for (const v of values) if (v !== null && (typeof v !== "string" || !v.trim())) return "empty value";
  return null;
}

async function runLanguage(lang, tr, totals) {
  const file = path.join(ROOT, `${lang}.json`);
  const catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const pending = TEMPLATES.filter((entry) => {
    const source = sourceFor(entry), row = catalog[entry.id];
    return !(row?.source_hash === source.sourceHash && source.strings.every((s) => Object.hasOwn(row.translations, s)));
  }).slice(0, LIMIT || undefined);
  if (!pending.length) { console.log(`${lang}: nothing pending`); return; }
  // şablonları ~90 metinlik paketlere böl
  const batches = [];
  for (const entry of pending) {
    const source = sourceFor(entry);
    const item = { id: entry.id, name: entry.name, strings: source.strings };
    const trRow = tr[entry.id];
    if (trRow?.source_hash === source.sourceHash) item.tr = source.strings.map((s) => (s === source.strings[0] ? trRow.name : trRow.translations[s] ?? s));
    const last = batches[batches.length - 1];
    if (!last || last.count + source.strings.length > MAX_STRINGS_PER_CALL) batches.push({ items: [item], count: source.strings.length });
    else { last.items.push(item); last.count += source.strings.length; }
  }
  let done = 0, failed = [];
  const save = () => fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
  const work = async (batch) => {
    let result;
    try { result = await callDeepSeek(batch.items, lang); } catch (e) { failed.push(...batch.items.map((i) => i.id)); return; }
    totals.in += result.usage.prompt_tokens || 0; totals.out += result.usage.completion_tokens || 0;
    for (const item of batch.items) {
      const entry = TEMPLATES.find((t) => t.id === item.id), source = sourceFor(entry);
      let values = result.json[item.id];
      // "" = parça bu dilde boş kalır (görünmez boşluk: author.js'in boş değer yasağına takılmaz, ekranda yer tutmaz)
      if (Array.isArray(values)) values = values.map((v, i) => (i > 0 && FIXED(source.strings[i]) ? null : i > 0 && v === "" ? "\u200b" : v));
      const problem = validate(entry, source, values);
      if (problem) { failed.push(item.id); continue; }
      catalog[item.id] = { name: values[0], source_hash: source.sourceHash, translations: Object.fromEntries(source.strings.map((s, i) => [s, i === 0 ? values[0] : values[i]])) };
      done++;
    }
    save();
  };
  const queue = batches.slice();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await work(queue.shift()); }));
  // başarısız olanları tek tek bir kez daha dene; yine olmazsa basit {"t":[...]} biçimiyle 4 deneme
  const single = async (id) => {
    const entry = TEMPLATES.find((t) => t.id === id), source = sourceFor(entry);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const resp = await axios.post("https://api.deepseek.com/chat/completions", {
          model: MODEL, temperature: 0.2 + attempt * 0.15, response_format: { type: "json_object" }, thinking: { type: "disabled" },
          messages: [{ role: "system", content: `${SYSTEM}\nFor this request return {"t": [...]} — exactly ${source.strings.length} items.` },
            { role: "user", content: `Target language: ${languageName(lang)} (${lang}).\n${JSON.stringify(source.strings)}` }],
        }, { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, timeout: 120000 });
        let values = JSON.parse(resp.data.choices[0].message.content).t;
        if (Array.isArray(values)) values = values.map((v, i) => (i > 0 && FIXED(source.strings[i]) ? null : i > 0 && v === "" ? "\u200b" : v));
        if (validate(entry, source, values)) continue;
        catalog[id] = { name: values[0], source_hash: source.sourceHash, translations: Object.fromEntries(source.strings.map((str, i) => [str, values[i]])) };
        done++; save(); return true;
      } catch (e) { /* tekrar dene */ }
    }
    return false;
  };
  const retry = failed.splice(0);
  for (const id of retry) {
    if (await single(id)) continue;
    const entry = TEMPLATES.find((t) => t.id === id), source = sourceFor(entry);
    const trRow = tr[id];
    await work({ items: [{ id, name: entry.name, strings: source.strings, ...(trRow?.source_hash === source.sourceHash ? { tr: source.strings.map((s) => (s === source.strings[0] ? trRow.name : trRow.translations[s] ?? s)) } : {}) }], count: source.strings.length });
  }
  console.log(`${lang}: +${done} (${Object.keys(catalog).length}/${TEMPLATES.length})${failed.length ? ` · failed: ${failed.join(",")}` : ""}`);
}

(async () => {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing");
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, "tr.json")));
  const all = fs.readdirSync(ROOT).filter((f) => f.endsWith(".json") && !["coverage.json", "names.json"].includes(f)).map((f) => f.slice(0, -5)).filter((l) => !["en", "tr", "ar"].includes(l));
  const langs = !args[0] || args[0] === "all" || args[0].startsWith("--") ? all : args[0].split(",");
  const totals = { in: 0, out: 0 };
  for (const lang of langs) await runLanguage(lang, tr, totals);
  console.log(`tokens in ${totals.in} out ${totals.out}`);
})().catch((e) => { console.error(e.response?.data || e.message); process.exit(1); });
