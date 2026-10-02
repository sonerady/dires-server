// 🌐 lint-locales.js raporundaki taşan çevirileri DeepSeek ile kısaltır (30 Eyl 2026).
//   node scripts/banner-templates/deepseek-shorten.js report.json
// Rapordaki her (dil, şablon) için taşan yazının çeviri parçaları bulunur; model aynı anlamı İngilizce kaynaktan
// uzun olmayacak şekilde yeniden yazar. Sonuç authored/<lang>.json'a yazılır; sonra lint yeniden çalıştırılır.
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const { TEMPLATES } = require("../../src/data/bannerTemplates");

const ROOT = path.resolve(__dirname, "../../src/data/bannerTemplates/authored");
const MODEL = process.env.BANNER_TRANSLATE_MODEL || "deepseek-v4-flash";
const report = JSON.parse(fs.readFileSync(process.argv[2]));
const languageName = (code) => ({ "zh-Hant": "Traditional Chinese (Taiwan)", no: "Norwegian Bokmål", pt: "Brazilian Portuguese" }[code] || new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code);

async function ask(lang, items) {
  const resp = await axios.post("https://api.deepseek.com/chat/completions", {
    model: MODEL,
    messages: [
      { role: "system", content: `You shorten ${languageName(lang)} banner copy that overflows its fixed box. For each item you get the English source and the current translation. Return ONLY JSON {"<key>": "<shorter translation>"} for every key. The new text must keep the meaning, sound natural on a shop banner, keep any arrow/symbol it had, and be AT MOST as long as the English source (fewer characters is better; abbreviations only if natural).` },
      { role: "user", content: JSON.stringify(items) },
    ],
    temperature: 0.2, response_format: { type: "json_object" }, thinking: { type: "disabled" }, max_tokens: 4000,
  }, { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, timeout: 120000 });
  return JSON.parse(resp.data.choices[0].message.content);
}

(async () => {
  let changed = 0;
  for (const [lang, rows] of Object.entries(report)) {
    if (!rows.length) continue;
    const file = path.join(ROOT, `${lang}.json`);
    const catalog = JSON.parse(fs.readFileSync(file));
    const items = {};
    for (const row of rows) {
      const rec = catalog[row.id];
      if (!rec) continue;
      const labels = [...row.out, ...row.cut];
      for (const [src, tr] of Object.entries(rec.translations)) {
        if (typeof tr !== "string") continue;
        // raporun etiketi yazının ilk 30 karakteri; eşleşen ya da onu içeren parça
        if (labels.some((l) => tr.startsWith(l.slice(0, 20)) || l.startsWith(tr.slice(0, 20)))) items[`${row.id}|${src}`] = { en: src, current: tr };
      }
    }
    const keys = Object.keys(items);
    for (let i = 0; i < keys.length; i += 40) {
      const chunk = Object.fromEntries(keys.slice(i, i + 40).map((k) => [k, items[k]]));
      let out;
      try { out = await ask(lang, chunk); } catch (e) { console.warn(lang, "shorten failed", e.message); continue; }
      for (const [k, v] of Object.entries(out)) {
        const [id, src] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
        if (typeof v === "string" && v.trim() && catalog[id]?.translations[src] !== undefined && v.length < catalog[id].translations[src].length) {
          catalog[id].translations[src] = v.trim(); changed++;
        }
      }
    }
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
    console.log(`${lang}: ${keys.length} fragment(s) reviewed`);
  }
  console.log(`shortened ${changed}`);
})().catch((e) => { console.error(e.response?.data || e.message); process.exit(1); });
