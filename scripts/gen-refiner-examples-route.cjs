#!/usr/bin/env node
// 🪄 Ürün Rötuşu örneklerinin SONRA'larını GERÇEK Refiner route'undan üretir (23 Eyl 2026)
//
// gen-refiner-examples.cjs'in ürettiği amatör ÖNCE fotoğraflarını, web /refiner ekranının gönderdiği isteğin
// aynısıyla /api/createRefiner/generate'e yollar (ürün türü tanıma → sergileme seçeneği → V1 rötuş, 9:16).
// Sunucu yerelde YALNIZ API modunda çalışmalı: DISABLE_BACKGROUND_WORKERS=1 PORT=3011 node src/app.js
// Kredi c56 test hesabından düşer (araç başına 10). Çıktı: web-dashboard/public/home_app/retouch/{id}-after.webp
// Çalıştır (server klasöründe): node scripts/gen-refiner-examples-route.cjs [id …]
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");

const API = process.env.REFINER_API || "http://localhost:3011";
const USER_ID = process.env.REFINER_USER_ID || "c56d28ea-b635-4efd-929f-70aa7f2d601b";
const DIR = path.resolve(__dirname, "../../web-dashboard/public/home_app/retouch");

// id → web ekranındaki seçim: kategori (web categoryOf), sergileme tarzı, zemin/gölge, renk dizisi
const JOBS = {
  ghost: { cat: "clothing", staging: 2 },
  flatlay: { cat: "clothing", staging: 1 },
  lineup: { cat: "clothing", staging: 3, lineupColors: ["Gri", "Lacivert", "Bej"], lineupArrangement: 2 },
  sneakers: { cat: "shoes", staging: 2, shadow: true },
  boot: { cat: "shoes", staging: 1, shadow: true },
  sunglasses: { cat: "eyewear", staging: 2 },
  ring: { cat: "rings", staging: 1, shadow: true },
  necklace: { cat: "necklaces", staging: 1 },
  earrings: { cat: "earrings", staging: 1, bg: "Bej", shadow: true },
  bag: { keepOriginal: true, bg: "Açık adaçayı yeşili", shadow: true },
};

async function post(pathname, body) {
  const res = await axios.post(`${API}${pathname}`, body, { headers: { "Content-Type": "application/json", "X-User-ID": USER_ID }, timeout: 600000, validateStatus: () => true, maxBodyLength: Infinity });
  if (res.status >= 400 || res.data?.success === false) throw new Error(`${pathname} ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
  return res.data;
}

async function waitResult(generationId) {
  for (let i = 0; i < 120; i++) {
    const res = await axios.get(`${API}/api/createRefiner/generation-status/${generationId}?userId=${encodeURIComponent(USER_ID)}`, { timeout: 30000, validateStatus: () => true });
    const s = res.data?.result || res.data;
    const status = s?.status;
    if (status === "completed" && s.resultImageUrl) return s.resultImageUrl;
    if (status === "failed") throw new Error(`üretim başarısız: ${JSON.stringify(s).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("zaman aşımı");
}

async function run(id) {
  const job = JOBS[id];
  const jpg = await sharp(path.join(DIR, `${id}-before.webp`)).jpeg({ quality: 92 }).toBuffer();
  const { width, height } = await sharp(jpg).metadata();
  const base64 = jpg.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  const type = await post("/api/product-type/classify", { imageBase64: dataUrl }).catch(() => ({}));
  const settings = {
    isRefinerMode: true, qualityVersion: "v1", productCategory: type.productType || "clothing", productSubtype: type.productSubtype || "",
    refinerSettings: { outputFormat: "jpg", pngType: "transparent", colorSpace: "rgb" },
    addShadow: Boolean(job.shadow), addReflection: false, backgroundColor: job.bg || "Beyaz", colorInputMode: "text",
  };
  const generationId = `${Date.now()}_${id}`;
  const body = {
    ratio: "9:16", promptText: "Refine this product photo into a clean professional e-commerce shot.",
    referenceImages: [{ uri: dataUrl, base64, width, height }], settings, userId: USER_ID,
    locationImage: null, poseImage: null, hairStyleImage: null, isMultipleImages: false, isMultipleProducts: false,
    ...(!job.keepOriginal ? { stagingStyle: job.staging, productCategory: job.cat, ...(job.lineupColors ? { lineupColors: job.lineupColors, lineupArrangement: job.lineupArrangement } : {}) } : {}),
    isMultipleAnglesMode: false, multipleAnglesCount: 0,
    generationId, totalGenerations: 1, enableAutomaticTrialVariation: false, isRefinerMode: true, isColorChange: false,
    styleReferenceImage: null, styleProfileId: null, upscaleMp: 4,
  };
  console.log(`[${id}] tür: ${type.productType || "?"}/${type.productSubtype || "?"} → refiner…`);
  const res = await post("/api/createRefiner/generate", body);
  const url = res.result?.resultImageUrl || (await waitResult(res.result?.generationId || generationId));
  const out = path.join(DIR, `${id}-after.webp`);
  const raw = Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 120000 })).data);
  await sharp(raw).resize(540, 960, { fit: "cover", position: "centre" }).webp({ quality: 80 }).toFile(out);
  console.log(`   ✓ ${id}-after.webp (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}

(async () => {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(JOBS);
  // aynı anda en fazla 3 istek (yerel sunucuyu boğmasın)
  let next = 0;
  const worker = async () => { while (next < ids.length) { const id = ids[next++]; try { await run(id); } catch (e) { console.log(`✗ ${id}: ${e.message}`); } } };
  await Promise.all([worker(), worker(), worker()]);
  console.log("\nBitti.");
})();
