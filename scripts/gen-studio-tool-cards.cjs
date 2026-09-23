#!/usr/bin/env node
// 🛍️ Yeni satıcı araçlarının anasayfa kart görselleri (23 Eyl 2026)
//
// ÖNCE: satıcının telefonla çektiği sıradan, aydınlık ürün fotoğrafı (fal nano-banana-pro t2i).
// SONRA: uygulamanın GERÇEK araç hattı — utils/studioTools.js'in istemi + GPT Image 2.5
//        Sunburst + utils/studioToolPost son işlemesi (ana görsel saf beyaz/%85, banner tam ölçü).
//        Kartta görünen sonuç, kullanıcının alacağının aynısı (dürüst görsel).
// Çıktı: client/assets/studio_tools/{id}-before.webp, {id}-after.webp — 9:16, 720×1280
//        (ToolIntroSheet 9:16 "cover" çiziyor; kare/geniş çıktılar beyaz/açık tuvale oturtulur).
// Çalıştır (server klasöründe): node scripts/gen-studio-tool-cards.cjs [aracId …]
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
const { getTool, validateOptions, resolveRatio, resolveImageSize, buildPrompt, MAIN_IMAGE_SPECS, EXACT_SIZES } = require("../src/utils/studioTools");
const { marketplaceMainImage, exactSize, standardOutput } = require("../src/utils/studioToolPost");
const { GPT25_EDIT_MODEL, buildEditInput } = require("../src/utils/gpt25Edit");

const OUT = path.resolve(__dirname, "../../client/assets/studio_tools");
const T2I_MODEL = "fal-ai/nano-banana-pro";
const W = 720;
const H = 1280;
const AMATEUR = "Casual but decent amateur smartphone photo taken by a small online seller at home, bright natural window daylight, well exposed, true colours, slightly casual handheld framing, real home surface (never a studio backdrop), a little ordinary background clutter, no people, no hands, no text, no logos, no watermark. Vertical 9:16 photo.";

// Araç → önce fotoğrafı tarifi + araç seçenekleri (+ ek referans)
const CARDS = {
  "marketplace-main-image": {
    before: `A matte sage-green ceramic coffee mug with a simple curved handle standing on a busy kitchen counter next to a kettle and a fruit bowl. ${AMATEUR}`,
    options: { platform: "amazon", angle: "three_quarter", shadow: "contact" },
  },
  "design-mockup": {
    before: "Flat digital artwork file on a pure white background: a minimalist two-colour line-art illustration of mountain peaks with a rising sun and three pine trees, forest green and burnt orange, bold clean strokes, centred, no text, no mockup, no product — just the flat print file. Vertical 9:16 canvas.",
    options: { product: "tshirt", color: "cream", placement: "center", presentation: "flat_lay", method: "screen" },
  },
  "personalization-preview": {
    before: `A plain light walnut wooden cutting board with rounded corners and a small hanging hole, completely blank with no engraving, lying on a kitchen table. ${AMATEUR}`,
    options: { text: "The Millers · 2025", technique: "engraving", font: "script", placement: "center", scene: "gift" },
  },
  "seasonal-campaign": {
    before: `A scented soy candle in a frosted amber glass jar with a plain kraft paper label, standing on a cluttered home-office desk next to a laptop. ${AMATEUR}`,
    options: { season: "christmas", intensity: "balanced", setting: "studio", copy_space: "none" },
  },
  "apparel-flat-lay": {
    before: `A chunky cream cable-knit wool sweater hanging on a plain hanger hooked over a bedroom door, slightly wrinkled. ${AMATEUR}`,
    options: { style: "spread", surface: "wood", accessories: "minimal", finish: "pressed" },
  },
  "store-banner": {
    before: `A frosted glass dropper bottle of facial serum with a minimalist white label, standing on a bathroom sink counter next to a toothbrush cup. ${AMATEUR}`,
    options: { format: "aplus_header", layout: "product_right", style: "natural" },
    extraFormats: ["etsy_banner", "aplus_wide"],
  },
  "handmade-process": {
    before: `A handmade speckled stoneware ceramic bowl with an uneven organic rim and a glossy oatmeal glaze, sitting on a living-room shelf. ${AMATEUR}`,
    options: { craft: "ceramics", moment: "finishing", mood: "warm" },
  },
};

const falHeaders = () => ({ Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" });
async function download(url) {
  const r = await axios.get(url, { responseType: "arraybuffer", timeout: 90000, maxContentLength: 80 * 1024 * 1024 });
  return Buffer.from(r.data);
}

async function textToImage(prompt) {
  const res = await axios.post(`https://fal.run/${T2I_MODEL}`, { prompt, aspect_ratio: "9:16", resolution: "1K", num_images: 1, output_format: "jpeg" }, { headers: falHeaders(), timeout: 300000 });
  const url = res.data?.images?.[0]?.url;
  if (!url) throw new Error("t2i görsel dönmedi");
  return url;
}

async function runTool(tool, options, imageUrl, overrides = {}) {
  const parsed = validateOptions(tool, { ...options, ...overrides });
  const ratio = resolveRatio(tool, "9:16", parsed.values);
  const prompt = buildPrompt(tool, { ...parsed, productCount: 1, refs: [], language: "en" });
  const input = buildEditInput(GPT25_EDIT_MODEL, { prompt, image_urls: [imageUrl], aspect_ratio: tool.lockRatio || tool.post ? ratio : "9:16", image_size: resolveImageSize(tool, parsed.values) || undefined, quality: "high", num_images: 1, output_format: "png" });
  const res = await axios.post(`https://fal.run/${GPT25_EDIT_MODEL}`, input, { headers: falHeaders(), timeout: 300000 });
  const url = res.data?.images?.[0]?.url;
  if (!url) throw new Error("GPT 2.5 görsel dönmedi");
  const raw = await download(url);
  if (tool.post?.type === "mainImage") return (await marketplaceMainImage(raw, MAIN_IMAGE_SPECS[parsed.values.platform])).buffer;
  if (tool.post?.type === "exact") return (await exactSize(raw, EXACT_SIZES[parsed.values[tool.post.from]])).buffer;
  return (await standardOutput(raw)).buffer;
}

/** Kare/geniş çıktıyı 9:16 tuvale oturtur (kırpmadan). */
async function onPortraitCanvas(buffer, background = "#ffffff", margin = 0) {
  const inner = await sharp(buffer).resize(W - margin * 2, H - margin * 2, { fit: "inside" }).toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background } }).composite([{ input: inner, gravity: "centre" }]).png().toBuffer();
}

/** Bannerları açık tuvalde alt alta dizer (yuvarlatılmış köşe + ince gölge). */
async function stackBanners(buffers) {
  const width = W - 64;
  const parts = [];
  for (const buffer of buffers) {
    const resized = await sharp(buffer).resize({ width }).png().toBuffer();
    const { height } = await sharp(resized).metadata();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="14" ry="14"/></svg>`);
    parts.push({ buffer: await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(), height });
  }
  const gap = 28;
  const total = parts.reduce((n, p) => n + p.height, 0) + gap * (parts.length - 1);
  let top = Math.round((H - total) / 2);
  const layers = [];
  for (const part of parts) {
    const shadow = await sharp({ create: { width: width + 24, height: part.height + 24, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width + 24}" height="${part.height + 24}"><rect x="12" y="16" width="${width}" height="${part.height}" rx="14" fill="black" fill-opacity="0.12"/></svg>`) }])
      .blur(6)
      .png()
      .toBuffer();
    layers.push({ input: shadow, left: 32 - 12, top: top - 12 }, { input: part.buffer, left: 32, top });
    top += part.height + gap;
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: "#F2F2F4" } }).composite(layers).png().toBuffer();
}

async function save(buffer, file) {
  await sharp(buffer).resize(W, H, { fit: "cover", position: "centre" }).webp({ quality: 80 }).toFile(file);
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`   ✓ ${path.relative(process.cwd(), file)} (${kb} KB)`);
}

async function makeCard(id) {
  const cfg = CARDS[id];
  const tool = getTool(id);
  if (!cfg || !tool) throw new Error(`bilinmeyen araç: ${id}`);
  console.log(`\n[${id}] önce fotoğrafı üretiliyor…`);
  const beforeUrl = await textToImage(cfg.before);
  await save(await download(beforeUrl), path.join(OUT, `${id}-before.webp`));
  console.log(`[${id}] araç hattı çalışıyor (GPT Image 2.5)…`);
  let after;
  if (cfg.extraFormats) {
    const banners = await Promise.all([cfg.options.format, ...cfg.extraFormats].map((format) => runTool(tool, cfg.options, beforeUrl, { format })));
    after = await stackBanners(banners);
  } else {
    after = await runTool(tool, cfg.options, beforeUrl);
    const { width, height } = await sharp(after).metadata();
    if (Math.abs(width / height - W / H) > 0.02) after = await onPortraitCanvas(after, "#ffffff");
  }
  await save(after, path.join(OUT, `${id}-after.webp`));
}

(async () => {
  if (!process.env.FAL_API_KEY) throw new Error("FAL_API_KEY yok (.env)");
  fs.mkdirSync(OUT, { recursive: true });
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CARDS);
  const results = await Promise.allSettled(ids.map((id) => makeCard(id)));
  results.forEach((r, i) => { if (r.status === "rejected") console.log(`✗ ${ids[i]}: ${r.reason?.response?.data ? JSON.stringify(r.reason.response.data).slice(0, 300) : r.reason?.message}`); });
  console.log("\nBitti. Beğenmediğin kart için tekrar: node scripts/gen-studio-tool-cards.cjs <aracId>");
})();
