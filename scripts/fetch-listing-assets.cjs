#!/usr/bin/env node
// 🛍️ Anasayfa "Listing Görsel Stüdyosu" kartı için örnek set (16 Eyl 2026).
// Kullanıcı 38ce6442'nin son üretim seti (job lst_1789520167994_6bbf51db):
// kaynak (amatör) fotoğraf + seçilen listing kareleri → client/assets/listing_studio/
// oran korunur (3:4, kırpma yok), en fazla 720×960 WebP. Çalıştır: `node scripts/fetch-listing-assets.cjs` (server klasöründe).
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");

const BASE = "https://api.diress.ai/storage/v1/object/public";
const USER = "38ce6442-3e6c-4cc5-b8c0-bbe1b1b20a23";
const OUT = path.resolve(__dirname, "../../client/assets/listing_studio");
const FILES = [
  ["before", `${BASE}/images/listingStudio/1789520167573_gk4k3c.jpg`],
  ["after-hero", `${BASE}/user_image_results/${USER}/1789520228888_listing_b1ef9a9a.png`],
  ["after-lifestyle", `${BASE}/user_image_results/${USER}/1789520233630_listing_8363ccb3.png`],
  ["after-features", `${BASE}/user_image_results/${USER}/1789520227660_listing_6e7109a1.png`],
  ["after-model", `${BASE}/user_image_results/${USER}/1789520234952_listing_84b946ec.png`],
  ["after-comparison", `${BASE}/user_image_results/${USER}/1789520232847_listing_1a47ff58.png`],
  ["after-package", `${BASE}/user_image_results/${USER}/1789520229606_listing_74237792.png`],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url] of FILES) {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
    const target = path.join(OUT, `ostwint-${name}.webp`);
    await sharp(Buffer.from(res.data))
      // Set 3:4 üretildi (job ratio=3:4) → KIRPMA yok: en fazla 720×960'a sığdır
      .resize(720, 960, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(target);
    console.log("✓", path.relative(process.cwd(), target), `${Math.round(fs.statSync(target).size / 1024)} KB`);
  }
  console.log("Bitti →", OUT);
})().catch((e) => {
  console.error("✗", e?.message || e);
  process.exit(1);
});
