// Geçici: onboarding listing kartları — 24 dil dışındaki 46 uygulama dili (CDN'e konacak), GPT 2.5 edit
require("dotenv").config({ path: __dirname + "/../.env" });
const fs = require("fs");
const { fal } = require("@fal-ai/client");
const { gpt25ImageSize } = require("../src/utils/gpt25Edit");
fal.config({ credentials: process.env.FAL_API_KEY });
const S = process.argv[2];
const LANGS = { af: "Afrikaans", am: "Amharic", az: "Azerbaijani", be: "Belarusian", bg: "Bulgarian", bn: "Bengali", ca: "Catalan", da: "Danish", et: "Estonian", eu: "Basque", fa: "Persian (Farsi)", fi: "Finnish", fil: "Filipino (Tagalog)", gl: "Galician", gu: "Gujarati", hr: "Croatian", hu: "Hungarian", hy: "Armenian", is: "Icelandic", ka: "Georgian", kk: "Kazakh", km: "Khmer", kn: "Kannada", ky: "Kyrgyz", lo: "Lao", lt: "Lithuanian", lv: "Latvian", mk: "Macedonian", ml: "Malayalam", mn: "Mongolian (Cyrillic)", mr: "Marathi", ms: "Malay", ne: "Nepali", no: "Norwegian (Bokmål)", pa: "Punjabi (Gurmukhi)", rm: "Romansh", si: "Sinhala", sk: "Slovak", sl: "Slovenian", sr: "Serbian (Cyrillic)", sw: "Swahili", ta: "Tamil", te: "Telugu", ur: "Urdu", uz: "Uzbek (Latin)", zu: "Zulu" };
const RTL = ["fa", "ur"];
const KINDS = ["compare", "lifestyle", "detail", "dimensions", "stove", "usage", "size"];
(async () => {
  const urls = {};
  for (const k of KINDS) urls[k] = await fal.storage.upload(new Blob([fs.readFileSync(`${S}/src/${k}.png`)], { type: "image/png" }));
  const only = process.argv[3];
  const jobs = [];
  for (const [code, name] of Object.entries(LANGS)) if (!only || only === code) for (const k of KINDS) jobs.push({ code, name, k });
  let i = 0, ok = 0, fail = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { code, name, k } = jobs[i++];
      const out = `${S}/out/${k}.${code}.png`;
      if (fs.existsSync(out)) { ok++; continue; }
      const prompt = `Translate EVERY piece of text in this e-commerce product listing image into ${name}. Keep the image otherwise IDENTICAL: same layout, same text positions and sizes, same typographic style and weight, same colors, same icons, same photo and the same blue cast-iron pot. Change only the language of the words. Keep the brand name "DIRESS" exactly as it is and keep numbers and units (cm, L) unchanged. Use natural, correctly spelled ${name} marketing copy for an online store; ${RTL.includes(code) ? "write the text right-to-left as is natural for this language, " : ""}no extra or missing text, no English left, never repeat a word.`;
      for (let a = 1; a <= 2; a++) {
        try {
          const r = await fal.subscribe("openai/gpt-image-2.5/sunburst/edit", { input: { prompt, image_urls: [urls[k]], image_size: gpt25ImageSize("3:4"), quality: "high", num_images: 1, output_format: "png" } });
          const u = r?.data?.images?.[0]?.url; if (!u) throw new Error("görsel yok");
          fs.writeFileSync(out, Buffer.from(await (await fetch(u)).arrayBuffer())); ok++; console.log("ok", k, code); break;
        } catch (e) { if (a === 2) { fail++; console.log("HATA", k, code, e?.message); } }
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`bitti ok=${ok} fail=${fail}`);
})().catch((e) => { console.error("HATA", e?.message || e); process.exit(1); });
