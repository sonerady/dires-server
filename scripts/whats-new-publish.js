#!/usr/bin/env node
/**
 * 🆕 "Yenilikler" içeriğini 70 uygulama diline çevirir ve app_config'e yazar.
 *
 * Kaynak: server/whats-new/<sürüm>.tr.html (Türkçe). Aynı klasörde
 * <sürüm>.<dil>.html varsa o dil çevrilmez, dosya olduğu gibi kullanılır
 * (elle düzeltme için). Çıktı: whats-new/<sürüm>.generated.json
 * ({"default": <en>, "tr": ..., "en": ..., ...}).
 *
 * Kullanım (server klasöründe, .env içinde OPENROUTER_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY):
 *   node scripts/whats-new-publish.js 1.7.8                 # sadece çevir + json üret
 *   node scripts/whats-new-publish.js 1.7.8 --languages en,de
 *   node scripts/whats-new-publish.js 1.7.8 --apply         # app_config'e yaz (ios + android satırları)
 *   node scripts/whats-new-publish.js 1.7.8 --apply --enable --audience updated --dismissible true --platforms ios,android,desktop,web
 *
 * --apply, whats_new_version/html/title'ı yazar; --enable verilmezse whats_new_enabled dokunulmaz
 * (önce içeriği yükleyip sonra Supabase'den enabled=true yapabilirsin).
 * Yarıda kesilirse checkpoint'ten devam eder (.whats-new-progress/<sürüm>.json).
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "whats-new");
const PROGRESS_DIR = path.join(ROOT, ".whats-new-progress");
const LOCALES_DIR = path.resolve(ROOT, "..", "client", "locales");
const DEFAULT_MODEL = process.env.OPENROUTER_TRANSLATION_MODEL || "openai/gpt-5.6-luna";
const TITLE_SOURCE = { tr: "Yenilikler" };

const LANGUAGE_NAMES = {
  af: "Afrikaans", am: "Amharic", ar: "Arabic", az: "Azerbaijani", be: "Belarusian", bg: "Bulgarian", bn: "Bengali", ca: "Catalan",
  cs: "Czech", da: "Danish", de: "German", el: "Greek", en: "English", es: "Spanish", et: "Estonian", eu: "Basque", fa: "Persian",
  fi: "Finnish", fil: "Filipino", fr: "French", gl: "Galician", gu: "Gujarati", he: "Hebrew", hi: "Hindi", hr: "Croatian", hu: "Hungarian",
  hy: "Armenian", id: "Indonesian", is: "Icelandic", it: "Italian", ja: "Japanese", ka: "Georgian", kk: "Kazakh", km: "Khmer", kn: "Kannada",
  ko: "Korean", ky: "Kyrgyz", lo: "Lao", lt: "Lithuanian", lv: "Latvian", mk: "Macedonian", ml: "Malayalam", mn: "Mongolian", mr: "Marathi",
  ms: "Malay", ne: "Nepali", nl: "Dutch", no: "Norwegian", pa: "Punjabi", pl: "Polish", pt: "Portuguese", rm: "Romansh", ro: "Romanian",
  ru: "Russian", si: "Sinhala", sk: "Slovak", sl: "Slovenian", sr: "Serbian", sv: "Swedish", sw: "Swahili", ta: "Tamil", te: "Telugu",
  th: "Thai", tr: "Turkish", uk: "Ukrainian", ur: "Urdu", uz: "Uzbek", vi: "Vietnamese", zh: "Chinese (Simplified)", zu: "Zulu",
};

function appLanguages() {
  return fs.readdirSync(LOCALES_DIR).filter((f) => /^[a-z]{2,3}\.json$/.test(f) && f !== "web.json").map((f) => f.replace(".json", "")).sort();
}

function parseArgs(argv) {
  const o = { version: null, apply: false, enable: null, audience: null, dismissible: null, platforms: null, languages: null, model: DEFAULT_MODEL, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--") && !o.version) o.version = a;
    else if (a === "--apply") o.apply = true;
    else if (a === "--enable") o.enable = true;
    else if (a === "--disable") o.enable = false;
    else if (a === "--force") o.force = true;
    else if (a === "--audience") o.audience = argv[++i];
    else if (a === "--dismissible") o.dismissible = String(argv[++i]).toLowerCase() === "true";
    else if (a === "--platforms") o.platforms = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--languages") o.languages = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--model") o.model = argv[++i];
  }
  if (!o.version) throw new Error("Sürüm ver: node scripts/whats-new-publish.js 1.7.8");
  return o;
}

async function translateHtml({ apiKey, model, lang, sourceHtml, sourceTitle }) {
  const name = LANGUAGE_NAMES[lang] || lang;
  const messages = [
    { role: "system", content: "You are a professional app-release-notes translator. Return ONLY a JSON object {\"title\": string, \"html\": string}. Preserve every HTML tag, attribute, class name and structure exactly; translate only human-readable text. Keep product names (Diress, GPT Image 2.5, Refiner) and emoji unchanged. Use natural, concise, friendly wording suited to a mobile app." },
    { role: "user", content: `Target language: ${name} (${lang}).\nSource language: Turkish.\n\nTITLE: ${sourceTitle}\n\nHTML:\n${sourceHtml}` },
  ];
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://diress.ai", "X-Title": "Diress What's New" },
        body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: "json_object" } }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${raw.slice(0, 300)}`);
      const content = JSON.parse(raw)?.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (typeof parsed.html !== "string" || !parsed.html.trim()) throw new Error("html yok");
      // Yapı koruması: etiket sayısı kaynağa eşit olmalı
      const count = (h) => (h.match(/<[a-z][^>]*>/gi) || []).length;
      if (count(parsed.html) !== count(sourceHtml)) throw new Error(`etiket sayısı uyuşmuyor (${count(parsed.html)} vs ${count(sourceHtml)})`);
      return { title: String(parsed.title || sourceTitle).trim(), html: parsed.html.trim() };
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠️ ${lang} deneme ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const srcPath = path.join(SRC_DIR, `${o.version}.tr.html`);
  if (!fs.existsSync(srcPath)) throw new Error(`Kaynak yok: ${srcPath}`);
  const sourceHtml = fs.readFileSync(srcPath, "utf8").trim();
  const langs = o.languages || appLanguages();
  fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  const progressPath = path.join(PROGRESS_DIR, `${o.version}.json`);
  const progress = !o.force && fs.existsSync(progressPath) ? JSON.parse(fs.readFileSync(progressPath, "utf8")) : { html: {}, title: {} };
  progress.html.tr = sourceHtml; progress.title.tr = TITLE_SOURCE.tr;

  const apiKey = process.env.OPENROUTER_API_KEY;
  for (const lang of langs) {
    if (lang === "tr") continue;
    const manual = path.join(SRC_DIR, `${o.version}.${lang}.html`);
    if (fs.existsSync(manual)) { progress.html[lang] = fs.readFileSync(manual, "utf8").trim(); progress.title[lang] = progress.title[lang] || TITLE_SOURCE.tr; console.log(`📄 ${lang}: elle yazılmış dosya kullanıldı`); continue; }
    if (progress.html[lang]) { console.log(`✅ ${lang}: checkpoint`); continue; }
    if (!apiKey) throw new Error("OPENROUTER_API_KEY yok (server/.env)");
    console.log(`🌐 ${lang} çevriliyor…`);
    const t = await translateHtml({ apiKey, model: o.model, lang, sourceHtml, sourceTitle: TITLE_SOURCE.tr });
    progress.html[lang] = t.html; progress.title[lang] = t.title;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  }
  const html = { default: progress.html.en || progress.html.tr, ...progress.html };
  const title = { default: progress.title.en || progress.title.tr, ...progress.title };
  const outPath = path.join(SRC_DIR, `${o.version}.generated.json`);
  fs.writeFileSync(outPath, JSON.stringify({ version: o.version, title, html }, null, 2));
  console.log(`\n📦 ${Object.keys(html).length - 1} dil → ${path.relative(ROOT, outPath)}`);

  if (!o.apply) { console.log("ℹ️ app_config'e yazmak için --apply ekle."); return; }
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY yok");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const updates = { whats_new_version: o.version, whats_new_html: html, whats_new_title: title, updated_at: new Date().toISOString() };
  if (o.enable != null) updates.whats_new_enabled = o.enable;
  if (o.audience) updates.whats_new_audience = o.audience;
  if (o.dismissible != null) updates.whats_new_dismissible = o.dismissible;
  if (o.platforms) updates.whats_new_platforms = o.platforms;
  const { data, error } = await db.from("app_config").update(updates).in("platform", ["ios", "android"]).select("platform, whats_new_enabled, whats_new_version");
  if (error) throw error;
  console.log("🚀 app_config güncellendi:", data);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
