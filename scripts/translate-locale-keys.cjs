#!/usr/bin/env node
// 🌍 Seçili i18n anahtarlarını 68 dile çevirir (23 Eyl 2026).
//
// Kaynak metin Türkçe (+ İngilizce referans): önce client/locales, anahtar orada yoksa
// web-dashboard/public/locales. Hedef: istemci ve/veya web sözlükleri (70 dil, aynı kodlar).
// Var olan çeviriye dokunmaz (--force hariç); {{yer_tutucu}}'lar korunmazsa çeviri reddedilir.
//
// Kullanım (--batch N: istek başına en çok N metin, varsayılan 60; --workers N: aynı anda çevrilen dil, varsayılan 8):
//   node scripts/translate-locale-keys.cjs --keys videoSkills.addLink,videoSkills.linkNote --targets client,web
//   node scripts/translate-locale-keys.cjs --prefix studioToolsUi --targets client,web
//   node scripts/translate-locale-keys.cjs --prefix studioToolsUi --check   (yalnız eksikleri say)
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.resolve(__dirname, "../..");
const DIRS = {
  client: path.join(ROOT, "client/locales"),
  web: path.join(ROOT, "web-dashboard/public/locales"),
};
// Sağlayıcı: DeepSeek (sunucunun kullandığı, thinking kapalı) varsayılan; --provider openrouter ile değişir.
const PROVIDERS = {
  deepseek: { url: "https://api.deepseek.com/chat/completions", key: () => process.env.DEEPSEEK_API_KEY, model: "deepseek-v4-flash", extra: { thinking: { type: "disabled" } } },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", key: () => process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_TRANSLATION_MODEL || "openai/gpt-5.6-luna", extra: {} },
};
let PROVIDER = PROVIDERS.deepseek;
const NAMES = {
  af: "Afrikaans", am: "Amharic", ar: "Arabic", az: "Azerbaijani", be: "Belarusian", bg: "Bulgarian",
  bn: "Bengali", ca: "Catalan", cs: "Czech", da: "Danish", de: "German", el: "Greek", es: "Spanish",
  et: "Estonian", eu: "Basque", fa: "Persian", fi: "Finnish", fil: "Filipino", fr: "French", gl: "Galician",
  gu: "Gujarati", he: "Hebrew", hi: "Hindi", hr: "Croatian", hu: "Hungarian", hy: "Armenian",
  id: "Indonesian", is: "Icelandic", it: "Italian", ja: "Japanese", ka: "Georgian", kk: "Kazakh",
  km: "Khmer", kn: "Kannada", ko: "Korean", ky: "Kyrgyz", lo: "Lao", lt: "Lithuanian", lv: "Latvian",
  mk: "Macedonian", ml: "Malayalam", mn: "Mongolian", mr: "Marathi", ms: "Malay", ne: "Nepali",
  nl: "Dutch", no: "Norwegian Bokmål", pa: "Punjabi", pl: "Polish", pt: "Portuguese (Brazil)",
  rm: "Romansh", ro: "Romanian", ru: "Russian", si: "Sinhala", sk: "Slovak", sl: "Slovenian",
  sr: "Serbian (Cyrillic)", sv: "Swedish", sw: "Swahili", ta: "Tamil", te: "Telugu", th: "Thai",
  uk: "Ukrainian", ur: "Urdu", uz: "Uzbek (Latin)", vi: "Vietnamese", zh: "Chinese (Simplified)", zu: "Zulu",
};

function args(argv) {
  const out = { keys: [], prefix: null, targets: ["client", "web"], force: false, check: false, languages: null, batch: 60, workers: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keys") out.keys = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--prefix") out.prefix = argv[++i];
    else if (a === "--targets") out.targets = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--languages") out.languages = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--force") out.force = true;
    else if (a === "--check") out.check = true;
    else if (a === "--batch") out.batch = Math.max(5, Number(argv[++i]) || 60);
    else if (a === "--workers") out.workers = Math.min(24, Math.max(1, Number(argv[++i]) || 8));
    else if (a === "--provider") PROVIDER = PROVIDERS[argv[++i]] || PROVIDER;
  }
  return out;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const get = (obj, key) => key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj);
const slots = (text) => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
const leaves = (obj, prefix) => {
  const node = get(obj, prefix);
  const out = [];
  const walk = (value, at) => {
    if (typeof value === "string") out.push(at);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`);
  };
  walk(node, prefix);
  return out;
};

/**
 * JSON metnindeki nesnelerin ve metin değerlerinin konumları (dizelere duyarlı küçük ayrıştırıcı).
 * Dosyayı baştan yazmak yerine yalnız eksik anahtarı eklemek için: dosyanın geri kalanı
 * (başka araçların tek satırlık blokları dahil) bayt bayt aynı kalır.
 */
function indexJson(text) {
  const objects = new Map();
  const strings = new Map();
  const values = new Map(); // yol → { start, end } (metin, dizi, nesne, sayı… her değer)
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const str = () => {
    let j = i + 1;
    while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
    const raw = text.slice(i, j + 1);
    const start = i;
    i = j + 1;
    return { value: JSON.parse(raw), start, end: i };
  };
  const value = (at) => {
    ws();
    const start = i;
    if (text[i] === "{") obj(at);
    else if (text[i] === "[") arr(at);
    else if (text[i] === '"') { const s = str(); strings.set(at.join("."), s); }
    else while (i < text.length && /[^,}\]\s]/.test(text[i])) i++;
    values.set(at.join("."), { start, end: i });
  };
  const obj = (at) => {
    const open = i++;
    ws();
    if (text[i] !== "}") {
      for (;;) {
        ws();
        const key = str().value;
        ws();
        i++; // ':'
        value([...at, key]);
        ws();
        if (text[i] === ",") { i++; continue; }
        break;
      }
    }
    objects.set(at.join("."), { open, close: i });
    i++; // '}'
  };
  const arr = (at) => {
    i++;
    ws();
    if (text[i] === "]") { i++; return; }
    for (;;) { value(at); ws(); if (text[i] === ",") { i++; continue; } i++; break; }
  };
  value([]);
  return { objects, strings, values };
}

/** Her türlü JSON değerini (dizi dahil) yola yazar: varsa aralığını değiştirir, yoksa ata nesneye üye olarak ekler. */
function upsertJson(text, key, jsonValue) {
  if (typeof jsonValue === "string") return upsertText(text, key, jsonValue);
  const { objects, values } = indexJson(text);
  const hit = values.get(key);
  const lineStartOf = (pos) => text.lastIndexOf("\n", pos) + 1;
  if (hit) {
    const indent = (text.slice(lineStartOf(hit.start), hit.start).match(/^\s*/) || [""])[0];
    const rendered = JSON.stringify(jsonValue, null, 2).replace(/\n/g, `\n${indent}`);
    return text.slice(0, hit.start) + rendered + text.slice(hit.end);
  }
  const parts = key.split(".");
  let depth = parts.length - 1;
  while (depth > 0 && !objects.has(parts.slice(0, depth).join("."))) depth--;
  const parent = objects.get(parts.slice(0, depth).join("."));
  const rest = parts.slice(depth);
  let nested = jsonValue;
  for (let k = rest.length - 1; k >= 1; k--) nested = { [rest[k]]: nested };
  const closeIndent = /^\s*$/.test(text.slice(lineStartOf(parent.close), parent.close)) ? text.slice(lineStartOf(parent.close), parent.close) : "";
  const indent = `${closeIndent}  `;
  const member = `"${rest[0]}": ${JSON.stringify(nested, null, 2).replace(/\n/g, `\n${indent}`)}`;
  let last = parent.close - 1;
  while (/\s/.test(text[last])) last--;
  if (text[last] === "{") return `${text.slice(0, last + 1)}\n${indent}${member}\n${closeIndent}${text.slice(parent.close)}`;
  return `${text.slice(0, last + 1)},\n${indent}${member}${text.slice(last + 1)}`;
}

/** Anahtarı metne yazar: varsa değeri değiştirir, yoksa en derin var olan ata nesnenin sonuna ekler. */
function upsertText(text, key, valueText) {
  const { objects, strings } = indexJson(text);
  const hit = strings.get(key);
  if (hit) return text.slice(0, hit.start) + JSON.stringify(valueText) + text.slice(hit.end);
  const parts = key.split(".");
  let depth = parts.length - 1;
  while (depth > 0 && !objects.has(parts.slice(0, depth).join("."))) depth--;
  const parent = objects.get(parts.slice(0, depth).join("."));
  const rest = parts.slice(depth);
  let nested = valueText;
  for (let k = rest.length - 1; k >= 1; k--) nested = { [rest[k]]: nested };
  const lineStart = text.lastIndexOf("\n", parent.close) + 1;
  const singleLine = !text.slice(parent.open, parent.close).includes("\n");
  if (singleLine) {
    const member = `"${rest[0]}": ${JSON.stringify(nested)}`;
    const before = text.slice(parent.open + 1, parent.close).trim();
    return `${text.slice(0, parent.close).replace(/\s*$/, "")}${before ? ", " : " "}${member} ${text.slice(parent.close)}`;
  }
  const closeIndent = /^\s*$/.test(text.slice(lineStart, parent.close)) ? text.slice(lineStart, parent.close) : "";
  const indent = `${closeIndent}  `;
  const member = `"${rest[0]}": ${JSON.stringify(nested, null, 2).replace(/\n/g, `\n${indent}`)}`;
  let last = parent.close - 1;
  while (/\s/.test(text[last])) last--;
  if (text[last] === "{") return `${text.slice(0, last + 1)}\n${indent}${member}\n${closeIndent}${text.slice(parent.close)}`;
  return `${text.slice(0, last + 1)},\n${indent}${member}${text.slice(last + 1)}`;
}

async function translate(language, items) {
  const payload = items.map((item, id) => ({ id: String(id), key: item.key, tr: item.tr, en: item.en }));
  const body = {
    model: PROVIDER.model,
    ...PROVIDER.extra,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are the senior ${NAMES[language]} UX writer for Diress, an AI product-photo and video app for e-commerce sellers (Amazon, Etsy, Shopify). Translate short UI strings into natural, polished ${NAMES[language]}.
Rules:
- Translate the meaning (Turkish source "tr"; English "en" is a reference), never word-for-word. Sound like a native product copywriter.
- Keep it as compact as the source; buttons stay short.
- Preserve every {{placeholder}} exactly. Keep brand names (Diress, Amazon, Etsy, TikTok, Instagram) untranslated.
- Return valid JSON only: {"translations":[{"id":"0","text":"..."}]} with every id exactly once.`,
      },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(PROVIDER.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PROVIDER.key()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://diress.ai",
          "X-Title": "Diress Locale Keys",
        },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`${PROVIDER.model} ${response.status}: ${raw.slice(0, 300)}`);
      const content = JSON.parse(raw)?.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
      const byId = new Map((parsed.translations || []).map((t) => [String(t.id), t.text]));
      return items.map((item, id) => {
        const text = byId.get(String(id));
        if (typeof text !== "string" || !text.trim()) throw new Error(`${language}: ${item.key} eksik`);
        if (slots(text) !== slots(item.en)) throw new Error(`${language}: ${item.key} yer tutucu bozuldu`);
        return text.trim();
      });
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 1200 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function main() {
  const opt = args(process.argv.slice(2));
  const sources = {
    client: { tr: readJson(path.join(DIRS.client, "tr.json")), en: readJson(path.join(DIRS.client, "en.json")) },
    web: { tr: readJson(path.join(DIRS.web, "tr.json")), en: readJson(path.join(DIRS.web, "en.json")) },
  };
  let keys = [...opt.keys];
  if (opt.prefix) keys.push(...new Set([...leaves(sources.client.en, opt.prefix), ...leaves(sources.web.en, opt.prefix)]));
  keys = [...new Set(keys)];
  const source = (key) => {
    for (const where of ["client", "web"]) {
      const tr = get(sources[where].tr, key);
      const en = get(sources[where].en, key);
      if (typeof tr === "string" && typeof en === "string") {
        const parentKey = key.split(".").slice(0, -1).join(".");
        const parentArray = get(sources[where].en, parentKey);
        return { key, tr, en, parentArray: Array.isArray(parentArray) ? parentArray : null };
      }
    }
    return null;
  };
  const items = keys.map(source);
  const missingSource = keys.filter((_, i) => !items[i]);
  if (missingSource.length) throw new Error(`Kaynak (tr+en) yok: ${missingSource.join(", ")}`);

  const languages = (opt.languages || Object.keys(NAMES)).filter((l) => l !== "en" && l !== "tr");

  let total = 0;
  const failed = [];
  const queue = [...languages];
  const worker = async () => {
    while (queue.length) {
      const language = queue.shift();
      const docs = Object.fromEntries(opt.targets.map((target) => [target, readJson(path.join(DIRS[target], `${language}.json`))]));
      const todo = items.filter((item) => opt.force || opt.targets.some((target) => typeof get(docs[target], item.key) !== "string" || !get(docs[target], item.key).trim()));
      if (!todo.length) continue;
      total += todo.length;
      if (opt.check) { console.log(`${language}: ${todo.length} eksik`); continue; }
      // Büyük ad alanlarında model çıktısı taşmasın: parça parça çevir, dosyaya dil başına bir kez yaz
      const texts = [];
      try {
        for (let start = 0; start < todo.length; start += opt.batch) texts.push(...(await translate(language, todo.slice(start, start + opt.batch))));
      } catch (error) {
        // Tek dilin ağ/model hatası tüm işi durdurmasın: dil atlanır, betik yeniden çalıştırılınca yalnız eksikler çevrilir
        failed.push(language);
        console.log(`✗ ${language}: ${error.message}`);
        continue;
      }
      for (const target of opt.targets) {
        const file = path.join(DIRS[target], `${language}.json`);
        let text = fs.readFileSync(file, "utf8"); // yazmadan hemen önce taze oku (başka oturumların eklemeleri kaybolmasın)
        const arrays = new Map(); // dizi yolu → { eleman indeksi → çeviri }
        todo.forEach((item, i) => {
          const parts = item.key.split(".");
          const parentKey = parts.slice(0, -1).join(".");
          if (/^\d+$/.test(parts[parts.length - 1]) && Array.isArray(item.parentArray)) {
            if (!arrays.has(parentKey)) arrays.set(parentKey, { source: item.parentArray, items: {} });
            arrays.get(parentKey).items[Number(parts[parts.length - 1])] = texts[i];
            return;
          }
          const current = get(JSON.parse(text), item.key);
          if (opt.force || typeof current !== "string" || !current.trim()) text = upsertText(text, item.key, texts[i]);
        });
        // Diziler (ör. listingStudio.detailsExamples) tek parça yazılır — anahtarlı nesneye dönüşmez
        for (const [arrayKey, { source, items }] of arrays) {
          const current = get(JSON.parse(text), arrayKey);
          const merged = source.map((fallback, index) => items[index] ?? (Array.isArray(current) ? current[index] : undefined) ?? fallback);
          text = upsertJson(text, arrayKey, merged);
        }
        JSON.parse(text); // bozuk dosya yazma
        fs.writeFileSync(file, text);
      }
      console.log(`✓ ${language}: ${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: opt.workers }, worker));
  console.log(`${opt.check ? "Eksik" : "Çevrildi"}: ${total} metin · ${keys.length} anahtar · ${languages.length} dil · hedef ${opt.targets.join("+")}`);
  if (failed.length) { console.log(`⚠️ Yarım kalan diller (yeniden çalıştır): ${failed.join(", ")}`); process.exitCode = 1; }
}

if (require.main === module) main().catch((error) => { console.error("❌", error.message); process.exit(1); });

module.exports = { indexJson, upsertText, upsertJson };
