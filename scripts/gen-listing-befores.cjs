#!/usr/bin/env node
// 🛍️ Anasayfa Listing kartı — ÖNCE fotoğraflarını "profesyonel amatör" yap
// (16 Eyl 2026, kullanıcı isteği). Şu anki ÖNCE'ler beyaz zeminli katalog
// fotoğrafı; nano-banana-2 ile AYNI ürünün evde çekilmiş, aydınlık, çok karanlık
// olmayan telefon fotoğrafı üretilir (beyaz zemin DEĞİL: ahşap masa, mutfak
// tezgâhı, yatak, halı gibi gerçek bir yüzey; gün ışığı).
// Çıktı: client/assets/home_webp/listing_studio/{set}-before.webp (360×480, 3:4)
//        client/assets/listing_studio/{set}-before-amateur.webp (tam boy yedek)
// Çalıştır (server klasöründe): node scripts/gen-listing-befores.cjs [set …]
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const CLIENT = path.resolve(__dirname, "../../client/assets");
const SRC_DIR = path.join(CLIENT, "listing_studio");
const OUT_SMALL = path.join(CLIENT, "home_webp/listing_studio");
const FAL_MODEL = "fal-ai/nano-banana-2/edit";

// Set → kaynak (beyaz zeminli) fotoğraf + ürüne uygun ev yüzeyi ipucu
const SETS = {
  ostwint: { src: "ostwint-before.webp", scene: "on a bathroom shelf or a bedroom dresser next to a few everyday items" },
  dog1: { src: "dog1-before.webp", scene: "on a living-room rug or a wooden floor near a sofa" },
  dog2: { src: "dog2-before.webp", scene: "on a kitchen floor or a wooden table at home" },
  catcomb: { src: "catcomb-before.webp", scene: "on a sofa cushion or a wooden side table at home" },
  pot: { src: "pot-before.webp", scene: "on a home kitchen counter or stovetop with ordinary kitchen things around" },
  lamp: { src: "lamp-before.webp", scene: "on a bedroom nightstand or a living-room side table at home, lamp switched off" },
};

const PROMPT = (scene) => `Re-photograph the EXACT same product from this image as a casual but decent amateur smartphone photo taken at home, before any professional shoot. Place the product ${scene}. Bright natural daylight from a window, well exposed, NOT dark, NOT moody, colors true to life. Real home surface and background (never a white or plain studio backdrop), a little ordinary clutter is fine, slightly casual handheld framing, phone-camera look, no styling props arranged on purpose, no text, no added logos, no people, no hands. Keep the product identical in shape, color, material, label and proportions — unmistakably the same item, fully visible and in focus.`;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function uploadSrc(buffer, name) {
  const key = `listingShowcase/${name}`;
  const { error } = await supabase.storage.from("images").upload(key, buffer, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return supabase.storage.from("images").getPublicUrl(key).data.publicUrl;
}

async function amateur(srcUrl, scene) {
  const res = await axios.post(
    `https://fal.run/${FAL_MODEL}`,
    { prompt: PROMPT(scene), image_urls: [srcUrl], aspect_ratio: "3:4", resolution: "1K", num_images: 1, output_format: "jpeg" },
    { headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" }, timeout: 300000 },
  );
  const url = res?.data?.images?.[0]?.url;
  if (!url) throw new Error("fal: görsel dönmedi");
  const img = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  return Buffer.from(img.data);
}

(async () => {
  if (!process.env.FAL_API_KEY) throw new Error("FAL_API_KEY yok (.env)");
  fs.mkdirSync(OUT_SMALL, { recursive: true });
  const only = process.argv.slice(2);
  const names = only.length ? only : Object.keys(SETS);
  for (const name of names) {
    const cfg = SETS[name];
    if (!cfg) { console.log(`✗ bilinmeyen set: ${name}`); continue; }
    const srcPath = path.join(SRC_DIR, cfg.src);
    if (!fs.existsSync(srcPath)) { console.log(`✗ kaynak yok: ${srcPath}`); continue; }
    console.log(`\n[${name}] kaynak yükleniyor…`);
    const srcBuf = await sharp(fs.readFileSync(srcPath)).resize(1024, 1024, { fit: "inside", withoutEnlargement: false }).jpeg({ quality: 92 }).toBuffer();
    const srcUrl = await uploadSrc(srcBuf, `${name}-src.jpg`);
    console.log("   amatör fotoğraf üretiliyor…");
    const out = await amateur(srcUrl, cfg.scene);
    const full = path.join(SRC_DIR, `${name}-before-amateur.webp`);
    await sharp(out).resize(900, 1200, { fit: "cover", position: "centre" }).webp({ quality: 84 }).toFile(full);
    const small = path.join(OUT_SMALL, `${name}-before.webp`);
    await sharp(out).resize(360, 480, { fit: "cover", position: "centre" }).webp({ quality: 80 }).toFile(small);
    console.log("   ✓", path.relative(process.cwd(), full));
    console.log("   ✓", path.relative(process.cwd(), small), "(anasayfa)");
  }
  console.log("\nBitti. Beğenmediğin set için tekrar: node scripts/gen-listing-befores.cjs <set>");
})().catch((e) => {
  console.error("✗", e?.response?.data || e?.message || e);
  process.exit(1);
});
