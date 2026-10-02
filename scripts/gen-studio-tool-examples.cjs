#!/usr/bin/env node
// 🖼️ Ürün stüdyosu + pazaryeri araçları için EK örnek sonuçlar (23 Eyl 2026)
//
// Web masaüstü anasayfasında her aracın rafında solda ÖNCE, sağda adım adım kayan SONRA kareleri var; tek
// sonuç yetmediği için her araca 3 ek sonuç üretilir. Hat, kullanıcının alacağıyla aynı: utils/studioTools.js
// istemi + GPT Image 2.5 edit + studioToolPost son işlemesi. Her ek sonuç aracın bir seçim kontrolünün FARKLI
// seçeneğiyle üretilir (ör. mekân: mutfak / banyo / ofis), böylece örnekler birbirini tekrar etmez.
// ÖNCE görseli: katalogdaki beforeUrl (web lib/toolDiscovery.json) ya da satıcı araçlarının yerel kartı.
// Çıktı: web-dashboard/public/studio_tools/examples/{id}-{1..3}.webp (540×960) + manifest.json
// Çalıştır (server klasöründe): node scripts/gen-studio-tool-examples.cjs [aracId …]   (var olan dosya atlanır)
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
const { getTool, validateOptions, resolveRatio, resolveImageSize, buildPrompt, MAIN_IMAGE_SPECS, EXACT_SIZES } = require("../src/utils/studioTools");
const { marketplaceMainImage, exactSize, standardOutput } = require("../src/utils/studioToolPost");
const { GPT25_EDIT_MODEL, buildEditInput } = require("../src/utils/gpt25Edit");

const WEB = path.resolve(__dirname, "../../web-dashboard");
const OUT = path.join(WEB, "public/studio_tools/examples");
const SELECTION = require(path.join(WEB, "lib/homeToolSelection.json"));
const GROUPS = require(path.join(WEB, "lib/toolDiscovery.json"));
const SELLER = ["marketplace-main-image", "design-mockup", "personalization-preview", "store-banner", "apparel-flat-lay", "seasonal-campaign", "handmade-process"];
const PER_TOOL = 3;
// Zorunlu alanı olan araçların sabit seçenekleri (kart betiğindekiyle aynı)
const BASE_OPTIONS = { "personalization-preview": { text: "The Millers · 2025" } };
// Serbest metin alanı zorunlu araçlarda çeşitleme metinle yapılır
const VARIATIONS = {
  "fill-style": [
    { contents: "fresh white hydrangeas and purple alliums", level: "full" },
    { contents: "dried pampas grass and eucalyptus stems", level: "overflow" },
    { contents: "a few long-stem yellow tulips", level: "half" },
  ],
};
// Geniş banner çıktıları dikey kartta boş beyaz tuval gibi duruyor → rafa konmaz (tek kartı yığılmış bannerlar)
const SKIP = new Set(["store-banner"]);
const CONCURRENCY = 4;
const W = 720;
const H = 1280;

const falHeaders = () => ({ Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" });
async function download(url) {
  const r = await axios.get(url, { responseType: "arraybuffer", timeout: 90000, maxContentLength: 80 * 1024 * 1024 });
  return Buffer.from(r.data);
}

/** Aracın ÖNCE görseli: katalog URL'si ya da yerel satıcı kartı (data URI) */
async function beforeSource(id) {
  const item = GROUPS.flatMap((g) => g.items).find((i) => i.id === id);
  if (item?.beforeUrl) return item.beforeUrl;
  const local = path.resolve(__dirname, `../../client/assets/studio_tools/${id}-before.webp`);
  if (!fs.existsSync(local)) throw new Error("önce görseli yok");
  const jpg = await sharp(local).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

/** Çeşitlendirilecek kontrol: en çok seçeneği olan "choice" kontrolü; varsayılan dışındaki seçenekler */
function variations(tool) {
  if (VARIATIONS[tool.id]) return VARIATIONS[tool.id];
  const choices = (tool.controls || []).filter((c) => c.type === "choice" && (c.options || []).length > 1);
  if (!choices.length) return Array.from({ length: PER_TOOL }, () => ({}));
  const control = choices.reduce((a, b) => (b.options.length > a.options.length ? b : a));
  const picks = control.options.map((o) => o.id).filter((v) => v !== control.default);
  return Array.from({ length: PER_TOOL }, (_, i) => ({ [control.id]: picks[i % picks.length] }));
}

async function runTool(tool, overrides, imageUrl) {
  const parsed = validateOptions(tool, { ...(BASE_OPTIONS[tool.id] || {}), ...overrides });
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

/** 9:16 değilse kırpmadan beyaz 9:16 tuvale oturt, sonra 720×1280 WebP */
async function save(buffer, file) {
  const { width, height } = await sharp(buffer).metadata();
  let out = buffer;
  if (Math.abs(width / height - W / H) > 0.02) {
    const inner = await sharp(buffer).resize(W, H, { fit: "inside" }).toBuffer();
    out = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite([{ input: inner, gravity: "centre" }]).png().toBuffer();
  }
  await sharp(out).resize(540, 960, { fit: "cover" }).webp({ quality: 76 }).toFile(file); // web kartı 205 px → 2x yeter
  console.log(`   ✓ ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

async function main() {
  if (!process.env.FAL_API_KEY) throw new Error("FAL_API_KEY yok (.env)");
  fs.mkdirSync(OUT, { recursive: true });
  const all = [...SELLER, ...SELECTION].filter((id) => getTool(id) && !SKIP.has(id));
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;
  const jobs = [];
  for (const id of ids) {
    const tool = getTool(id);
    if (!tool) { console.log(`- ${id}: kayıt defterinde yok, atlandı`); continue; }
    variations(tool).forEach((overrides, i) => jobs.push({ id, tool, overrides, file: path.join(OUT, `${id}-${i + 1}.webp`) }));
  }
  const sources = new Map();
  let next = 0, ok = 0, failed = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (fs.existsSync(job.file)) { ok++; continue; }
      try {
        if (!sources.has(job.id)) sources.set(job.id, beforeSource(job.id));
        const src = await sources.get(job.id);
        console.log(`[${job.id}] ${JSON.stringify(job.overrides)} …`);
        await save(await runTool(job.tool, job.overrides, src), job.file);
        ok++;
      } catch (e) {
        failed++;
        console.log(`✗ ${job.id} ${JSON.stringify(job.overrides)}: ${e?.response?.data ? JSON.stringify(e.response.data).slice(0, 240) : e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // manifest: araç → var olan ek örnekler (web bunu okur)
  const manifest = {};
  for (const id of all) {
    const files = [1, 2, 3].map((n) => `${id}-${n}.webp`).filter((f) => fs.existsSync(path.join(OUT, f)));
    if (files.length) manifest[id] = files.map((f) => `/studio_tools/examples/${f}`);
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`\nBitti: ${ok} hazır, ${failed} hata. Manifest: ${Object.keys(manifest).length} araç.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
