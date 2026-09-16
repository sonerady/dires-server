#!/usr/bin/env node
// 🎬 Anasayfa "Fotoğraftan Video" kartı için örnek set (16 Eyl 2026).
// 7 Meitu video → her biri için: videodan kare al → nano-banana-2 ile aynı
// ürünün AMATÖR telefon fotoğrafını üret (kartın ÖNCE yarısı) → videoyu
// karta uygun ölçüde yeniden kodla (SONRA yarısı).
// Çıktı: client/assets/video_showcase/{n}-before.webp, {n}-after.mp4
// Çalıştır (server klasöründe): node scripts/fetch-video-showcase.cjs
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const axios = require("axios");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");
const { createClient } = require("@supabase/supabase-js");

const VIDEOS = [
  "https://xiuxiu-pro-new.meitudata.com/poster/26bb29f58ba6bcd288da0bcb5e19623d.mp4",
  "https://xiuxiu-pro-new.meitudata.com/poster/b902d316ec5df71369386f13f803c344.mp4",
  "https://xiuxiu-pro-new.meitudata.com/poster/17d22ac3f098ac711a13fe1d8a1a6f34.mp4",
  "https://xiuxiu-pro-new.meitudata.com/poster/2b73fd120d5eca74d692fe4b257e426f.mp4",
  "https://xiuxiu-pro-new.meitudata.com/poster/b5de54c670344c7ab0e13978958a6647.mp4",
  "https://xiuxiu-pro-new.meitudata.com/poster/5934c757531e1159d4d4fa6adf42344a.mp4",
  "https://xiuxiu-pro-new.meitudata.com/poster/0aa1729620b8655864ef0983a05fa396.mp4",
];

const OUT = path.resolve(__dirname, "../../client/assets/video_showcase");
const TMP = path.resolve(__dirname, "../temp/video_showcase");
const FAL_MODEL = "fal-ai/nano-banana-2/edit";

const AMATEUR_PROMPT = `Re-photograph the EXACT same product from this frame as a casual amateur smartphone snapshot taken at home before any professional shoot: the product simply placed on an ordinary cluttered surface (kitchen counter, bedroom desk or sofa), plain indoor lighting with a slight yellow tint and soft shadows, slightly tilted handheld framing, mild motion softness, no styling, no props arranged on purpose, no text, no logos added, no people. Keep the product identical in shape, color, material, label and proportions — it must be unmistakably the same item. Realistic phone-camera look, not a studio photo.`;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function download(url, target) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 120000, maxContentLength: 200 * 1024 * 1024 });
  fs.writeFileSync(target, Buffer.from(res.data));
}

function ffprobeDims(file) {
  // ffmpeg-static ile boyut: ffmpeg -i çıktısından "1080x1920" yakala
  try {
    execFileSync(ffmpeg, ["-i", file], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const m = String(e.stderr || "").match(/, (\d{3,4})x(\d{3,4})[,\s]/);
    if (m) return { w: Number(m[1]), h: Number(m[2]) };
  }
  return null;
}

async function uploadFrame(buffer, name) {
  const key = `videoShowcase/${name}`;
  const { error } = await supabase.storage.from("images").upload(key, buffer, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return supabase.storage.from("images").getPublicUrl(key).data.publicUrl;
}

async function amateurFromFrame(frameUrl) {
  const res = await axios.post(
    `https://fal.run/${FAL_MODEL}`,
    { prompt: AMATEUR_PROMPT, image_urls: [frameUrl], aspect_ratio: "3:4", resolution: "1K", num_images: 1, output_format: "jpeg" },
    { headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" }, timeout: 300000 },
  );
  const url = res?.data?.images?.[0]?.url;
  if (!url) throw new Error("fal: görsel dönmedi");
  const img = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  return Buffer.from(img.data);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  for (let i = 0; i < VIDEOS.length; i++) {
    const n = i + 1;
    const src = path.join(TMP, `${n}-src.mp4`);
    const frame = path.join(TMP, `${n}-frame.jpg`);
    const outVideo = path.join(OUT, `${n}-after.mp4`);
    const outBefore = path.join(OUT, `${n}-before.webp`);

    console.log(`\n[${n}/${VIDEOS.length}] indiriliyor…`);
    await download(VIDEOS[i], src);
    const dims = ffprobeDims(src);
    console.log("   boyut:", dims ? `${dims.w}x${dims.h}` : "?");

    // 1) Kare: 1.5 sn'den (ürün genelde ilk saniyelerde net görünür)
    execFileSync(ffmpeg, ["-y", "-ss", "1.5", "-i", src, "-frames:v", "1", "-q:v", "2", frame], { stdio: "ignore" });

    // 2) Amatör fotoğraf (fal nano-banana-2)
    // ⚠️ Her zaman yeniden üret: client'ta aynı adla yer tutucu dosyalar var,
    // "mevcutsa atla" onları gerçek sanıp geçiyordu (16 Eyl 2026).
    if (true) {
      const frameBuf = await sharp(fs.readFileSync(frame)).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer();
      const frameUrl = await uploadFrame(frameBuf, `${n}-frame.jpg`);
      console.log("   amatör fotoğraf üretiliyor…");
      const amateur = await amateurFromFrame(frameUrl);
      await sharp(amateur).resize(720, 960, { fit: "cover", position: "centre" }).webp({ quality: 82 }).toFile(outBefore);
      console.log("   ✓", path.relative(process.cwd(), outBefore));
    }

    // 3) Video: 3:4'e ortadan kırp, yükseklik 720, sessiz, h264 faststart
    execFileSync(
      ffmpeg,
      [
        "-y", "-i", src, "-an",
        "-vf", "crop='min(iw,ih*3/4)':'min(ih,iw*4/3)',scale=-2:720,fps=24",
        "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        outVideo,
      ],
      { stdio: "ignore" },
    );
    console.log("   ✓", path.relative(process.cwd(), outVideo), `${Math.round(fs.statSync(outVideo).size / 1024)} KB`);
  }
  console.log("\nBitti →", OUT);
})().catch((e) => {
  console.error("✗", e?.response?.data || e?.message || e);
  process.exit(1);
});
