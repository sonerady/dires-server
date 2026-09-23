#!/usr/bin/env node
// 🎬 Anasayfa "Fotoğraftan Video" kartı — ÖNCE fotoğrafları (22 Eyl 2026,
// kullanıcı isteği). Eski önceler gece/sarı ışıklı, dağınık, ürün küçüktü;
// artık Ürün Stüdyosu kartının önceleriyle (gen-listing-befores.cjs) aynı dil:
// gün ışığı, ürün net ve büyük, gerçek ev yüzeyi. Referans kare Seedance
// videosundan (gen-video-showcase-seedance.cjs) alınır → önce/sonra ürünü aynı.
// Çıktı: client/assets/video_showcase/{n}-before.webp (720×960) +
//        client/assets/home_webp/video_showcase/{n}-before.webp (480×640)
// Çalıştır (server klasöründe): node scripts/gen-video-showcase-befores.cjs [n ...]
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const axios = require("axios");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");

const FAL_MODEL = "fal-ai/nano-banana-2/edit";
const CLIENT = path.resolve(__dirname, "../../client/assets");
const TMP = path.resolve(__dirname, "../temp/video_showcase_seedance");

// n → ürünün en net göründüğü saniye (videoda) + ürüne uygun ev yüzeyi
const SETS = {
  1: { t: 0.5, product: "the cream hoodie", scene: "laid flat on a made bed or folded over a chair in a bedroom" },
  2: { t: 0.5, product: "the stainless steel range-hood grease filter (a bit greasy)", scene: "lying on a home kitchen counter next to the sink" },
  3: { t: 9.5, product: "the matte grey insulated water bottle", scene: "on a wooden desk or a kitchen counter at home" },
  4: { t: 1.0, product: "the clear glass perfume bottle with gold cap", scene: "on a bedroom dresser next to a few everyday items" },
  5: { t: 9.5, product: "the black matte bottle", scene: "on a bathroom shelf or a bedroom dresser next to a few everyday items" },
  6: { t: 1.0, product: "the ribbed clear drinking glass (empty)", scene: "on a home kitchen counter with ordinary kitchen things around" },
  7: { t: 9.0, product: "the pink perfume bottle with black cap", scene: "on a bedroom dresser or bathroom shelf next to a few everyday items" },
  // 8-12 (22 Eyl 2026): videodan ÖNCE üretilir (referans yok → metinden görsel);
  // Seedance bu fotoğrafı ürün referansı olarak alır, önce/sonra yine birebir eşleşir
  8: { t2i: "a pair of clean white leather low-top sneakers with white laces and a gum rubber sole", product: "the white leather sneakers", scene: "on a light wooden hallway floor next to the front door" },
  9: { t2i: "matte sand-beige over-ear wireless headphones with soft cushioned ear cups and a brushed metal headband slider", product: "the sand-beige over-ear headphones", scene: "on a wooden home desk next to a laptop and a notebook" },
  10: { t2i: "a 30 ml amber glass serum bottle with a black rubber dropper cap and a plain cream paper label", product: "the amber glass serum dropper bottle", scene: "on a white bathroom shelf next to a folded towel and a plain unlabeled soap dish" },
  11: { t2i: "a structured tan leather top-handle handbag with a gold turn-lock clasp and a detachable shoulder strap", product: "the tan leather handbag", scene: "on a made bed or an armchair in a bedroom" },
  12: { t2i: "a handmade speckled cream ceramic coffee mug with an unglazed rim and a round handle, empty", product: "the speckled ceramic mug", scene: "on a home kitchen counter with ordinary kitchen things around" },
};

// gen-listing-befores.cjs'teki PROMPT ile aynı dil
const PROMPT = (product, scene) => `Re-photograph the EXACT same product from this image — ${product} — as a casual but decent amateur smartphone photo taken at home, before any professional shoot. Place the product ${scene}. Bright natural daylight from a window, well exposed, NOT dark, NOT moody, colors true to life. Real home surface and background (never a white or plain studio backdrop), a little ordinary clutter is fine, slightly casual handheld framing, phone-camera look, no styling props arranged on purpose, no text, no added logos, no people, no hands. The product is the clear subject: large in the frame, centered, fully visible and in focus. Keep the product identical in shape, color, material, label and proportions — unmistakably the same item.`;

const T2I_MODEL = "fal-ai/nano-banana-2";
// Referans karesi olmayan setler: ürün doğrudan listing önce dilinde metinden üretilir
const T2I_PROMPT = (desc, scene) => `A casual but decent amateur smartphone photo taken at home, before any professional shoot, of ${desc}, placed ${scene}. Bright natural daylight from a window, well exposed, NOT dark, NOT moody, colors true to life. Real home surface and background (never a white or plain studio backdrop), a little ordinary clutter is fine, slightly casual handheld framing, phone-camera look, no text, no logos, no brand names, no branded products or packaging anywhere in the background, no people, no hands. The product is the clear subject: large in the frame, centered, fully visible and in focus.`;

async function generate(n) {
  const cfg = SETS[n];
  if (cfg.t2i) {
    const res = await axios.post(
      `https://fal.run/${T2I_MODEL}`,
      { prompt: T2I_PROMPT(cfg.t2i, cfg.scene), aspect_ratio: "3:4", resolution: "1K", num_images: 1, output_format: "jpeg" },
      { headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" }, timeout: 300000 },
    );
    const url = res?.data?.images?.[0]?.url;
    if (!url) throw new Error(`[${n}] fal: görsel dönmedi`);
    return save(n, Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 60000 })).data));
  }
  const frame = path.join(TMP, `${n}-ref.jpg`);
  execFileSync(ffmpeg, ["-y", "-ss", String(cfg.t), "-i", path.join(TMP, `${n}-raw.mp4`), "-frames:v", "1", "-q:v", "2", frame], { stdio: "ignore" });
  const uri = `data:image/jpeg;base64,${fs.readFileSync(frame).toString("base64")}`;
  const res = await axios.post(
    `https://fal.run/${FAL_MODEL}`,
    { prompt: PROMPT(cfg.product, cfg.scene), image_urls: [uri], aspect_ratio: "3:4", resolution: "1K", num_images: 1, output_format: "jpeg" },
    { headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" }, timeout: 300000 },
  );
  const url = res?.data?.images?.[0]?.url;
  if (!url) throw new Error(`[${n}] fal: görsel dönmedi`);
  await save(n, Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 60000 })).data));
}

async function save(n, img) {
  await sharp(img).resize(720, 960, { fit: "cover" }).webp({ quality: 84 }).toFile(path.join(CLIENT, `video_showcase/${n}-before.webp`));
  // Anasayfa/sheet kopyası 480×640 (22 Eyl 2026: 360×480 bulanık görünüyordu)
  await sharp(img).resize(480, 640, { fit: "cover" }).webp({ quality: 86 }).toFile(path.join(CLIENT, `home_webp/video_showcase/${n}-before.webp`));
  console.log(`[${n}] ✓`);
}

(async () => {
  const ids = process.argv.slice(2).map(Number).filter((n) => SETS[n]);
  const list = ids.length ? ids : Object.keys(SETS).map(Number);
  const results = await Promise.allSettled(list.map(generate));
  results.forEach((r, i) => r.status === "rejected" && console.error(`✗ [${list[i]}]`, r.reason?.response?.data || r.reason?.message));
})();
