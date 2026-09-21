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
// Setler: her ürün için kaynak (amatör) + 5 listing karesi. Anasayfa kartı
// ürünler arasında karışık döner (krem → köpek tasması → mama kabı …).
const SETS = [
  {
    name: "ostwint", ratio: "3:4", src: `${BASE}/images/listingStudio/1789520167573_gk4k3c.jpg`,
    after: { hero: "1789520228888_listing_b1ef9a9a", lifestyle: "1789520233630_listing_8363ccb3", features: "1789520227660_listing_6e7109a1", model: "1789520234952_listing_84b946ec", comparison: "1789520232847_listing_1a47ff58" },
  },
  {
    name: "dog1", ratio: "9:16", src: `${BASE}/images/listingStudio/1789573628005_qpd8mj.jpg`,
    after: { hero: "1789573698734_listing_988aa6b6", lifestyle: "1789573699891_listing_d629ea59", features: "1789573710056_listing_75044e53", model: "1789573699358_listing_0a7b9619", comparison: "1789573701099_listing_2ae78444" },
  },
  {
    name: "dog2", ratio: "9:16", src: `${BASE}/images/listingStudio/1789573703978_d1ki5p.jpg`,
    after: { hero: "1789573776981_listing_47916fa3", lifestyle: "1789573775870_listing_eeaa672b", features: "1789573778106_listing_46e6fc2e", model: "1789573772139_listing_efb2992e", comparison: "1789573767631_listing_c1d2363d" },
  },
];
const FILES = [];
for (const set of SETS) {
  FILES.push([`${set.name}-before`, set.src]);
  for (const [type, id] of Object.entries(set.after)) FILES.push([`${set.name}-after-${type}`, `${BASE}/user_image_results/${USER}/${id}.png`]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url] of FILES) {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
    const target = path.join(OUT, `${name}.webp`);
    await sharp(Buffer.from(res.data))
      // Oran korunur (3:4 ya da 9:16), KIRPMA yok: en fazla 720×1280'e sığdır
      .resize(720, 1280, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(target);
    console.log("✓", path.relative(process.cwd(), target), `${Math.round(fs.statSync(target).size / 1024)} KB`);
  }
  console.log("Bitti →", OUT);
})().catch((e) => {
  console.error("✗", e?.message || e);
  process.exit(1);
});
