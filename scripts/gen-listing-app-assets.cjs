#!/usr/bin/env node
// 📱 Listing setlerini uygulamanın (ve web mobilin) anasayfa Listing kartına hazırlar (23 Eyl 2026)
//
// Kaynak: gen-listing-cards.cjs'in 20 ürünü (server/tmp/listing-cards/<id>/ kareleri + ref.url).
// ÖNCE: ürünün referansından GPT Image 2.5 edit ile "evde telefonla çekilmiş" amatör fotoğraf (ürün birebir korunur).
// SONRA: yaşam tarzı hero + listing kareleri → kare (1:1) karolar; geniş paneller kırpılmaz, bulanık dolguyla ortalanır.
// Çıktı: client/assets/home_webp/listing_v2/{id}-before.webp (360×480) + {id}-after-{n}.webp (320×320)
//        ve aynıları web-dashboard/public/home_app/listing_v2/ + sets.json (web için)
// Çalıştır (server klasöründe): node scripts/gen-listing-app-assets.cjs
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
const { GPT25_EDIT_MODEL } = require("../src/utils/gpt25Edit");

const TMP = path.resolve(__dirname, "../tmp/listing-cards");
const CARDS = require(path.resolve(__dirname, "../../web-dashboard/public/home_app/listing_cards/cards.json"));
const OUT_APP = path.resolve(__dirname, "../../client/assets/home_webp/listing_v2");
const OUT_WEB = path.resolve(__dirname, "../../web-dashboard/public/home_app/listing_v2");
const ORDER = { A: ["hero", "main", "feature", "use", "detail", "size", "box"], B: ["hero", "aplus1", "aplus2", "aplus3", "aplus4", "aplus5", "aplus6"], C: ["hero", "main", "feature", "use", "detailw", "boxw"] };
const SQUARE = new Set(["main", "feature", "use", "detail", "size", "box"]);
const falHeaders = () => ({ Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" });

// her ürüne farklı bir ev ortamı (hepsi aynı tezgâhta durmasın)
const SPOTS = ["an unmade bed with a wrinkled duvet", "a cluttered wooden desk next to a laptop and papers", "a living room floor rug near a sofa leg", "a white bathroom sink counter", "an old kitchen table with crumbs and a mug", "a hallway shelf with keys and mail", "a garage workbench", "a balcony tile floor in daylight", "a dining chair seat", "a windowsill with dusty blinds"];
async function amateur(refUrl, i) {
  const prompt = `Turn this into a casual amateur smartphone photo of this EXACT same product (identical shape, colors, materials, logos) taken by a small online seller at home: product placed on ${SPOTS[i % SPOTS.length]}, everyday indoor light, slightly uneven exposure, a little background clutter, casual handheld framing, no text, no watermark. Vertical 3:4 photo.`;
  const r = await axios.post(`https://fal.run/${GPT25_EDIT_MODEL}`, { prompt, image_urls: [refUrl], image_size: { width: 768, height: 1024 }, quality: "high", num_images: 1, output_format: "png" }, { headers: falHeaders(), timeout: 400000 });
  const url = r.data?.images?.[0]?.url;
  if (!url) throw new Error("GPT 2.5 görsel dönmedi");
  return Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 180000 })).data);
}

/** kare karo: kare kaynak → doğrudan; fotoğraf hero → ortadan kare kırp; geniş infografik → bulanık dolgu + ortada tam */
async function tile(key, file) {
  const S = 320;
  if (SQUARE.has(key)) return sharp(file).resize(S, S, { fit: "cover" }).webp({ quality: 74 }).toBuffer();
  if (key === "hero") return sharp(file).resize(S, S, { fit: "cover", position: "centre" }).webp({ quality: 74 }).toBuffer();
  const bg = await sharp(file).resize(S, S, { fit: "cover" }).blur(18).modulate({ brightness: 0.92 }).toBuffer();
  const fg = await sharp(file).resize(S, S, { fit: "inside" }).toBuffer();
  return sharp(bg).composite([{ input: fg, gravity: "centre" }]).webp({ quality: 74 }).toBuffer();
}

(async () => {
  for (const d of [OUT_APP, OUT_WEB]) fs.mkdirSync(d, { recursive: true });
  const sets = [];
  let next = 0;
  const worker = async () => {
    while (next < CARDS.length) {
      const c = CARDS[next++];
      const dir = path.join(TMP, c.id);
      try {
        const beforeFile = path.join(dir, "amateur.png");
        if (!fs.existsSync(beforeFile)) { fs.writeFileSync(beforeFile, await amateur(fs.readFileSync(path.join(dir, "ref.url"), "utf8"), CARDS.indexOf(c))); console.log(`[${c.id}] amatör önce hazır`); }
        const before = await sharp(beforeFile).resize(360, 480, { fit: "cover" }).webp({ quality: 74 }).toBuffer();
        for (const d of [OUT_APP, OUT_WEB]) fs.writeFileSync(path.join(d, `${c.id}-before.webp`), before);
        const keys = ORDER[c.layout].filter((k) => fs.existsSync(path.join(dir, `${k}.png`)));
        const after = [];
        for (let i = 0; i < keys.length; i++) {
          const buf = await tile(keys[i], path.join(dir, `${keys[i]}.png`));
          for (const d of [OUT_APP, OUT_WEB]) fs.writeFileSync(path.join(d, `${c.id}-after-${i + 1}.webp`), buf);
          after.push(i + 1);
        }
        sets.push({ id: c.id, market: c.market, count: after.length });
      } catch (e) { console.log(`✗ ${c.id}: ${e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  const ordered = CARDS.map((c) => sets.find((s) => s.id === c.id)).filter(Boolean);
  fs.writeFileSync(path.join(OUT_WEB, "sets.json"), JSON.stringify(ordered, null, 1));
  const kb = (d) => Math.round(fs.readdirSync(d).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0) / 1024);
  console.log(`\nBitti: ${ordered.length} set · uygulama ${kb(OUT_APP)} KB`);
})();
