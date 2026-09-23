#!/usr/bin/env node
// 🎬 Anasayfa "Fotoğraftan Video" kartının SAĞ yarısı (22 Eyl 2026).
// Soldaki amatör ürün fotoğrafları (assets/video_showcase/{n}-before.webp)
// Seedance 2.5 reference-to-video'ya ürün referansı olarak verilir; Meitu
// referans videolarındaki çok çekimli UGC reklam diliyle (kişi ürünü kullanır →
// yakın plan → makro detay) yeni video üretilir. Meitu videoları artık yok.
// Çıktı: client/assets/video_showcase/{n}-after.mp4 (720p kaynak) +
//        client/assets/home_webp/video_showcase/{n}-after.mp4 (192×256, 8 sn) + {n}-poster.webp +
//        reference/video-intro/… (Supabase, 720×960; tanıtım sheet'i)
// Çalıştır (server klasöründe): node scripts/gen-video-showcase-seedance.cjs [n ...]
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const axios = require("axios");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");
const { createClient } = require("@supabase/supabase-js");

const MODEL = "bytedance/seedance-2.5/reference-to-video";
const SRC_DIR = path.resolve(__dirname, "../../client/assets/video_showcase");
const HOME_DIR = path.resolve(__dirname, "../../client/assets/home_webp/video_showcase");
const TMP = path.resolve(__dirname, "../temp/video_showcase_seedance");
// Sheet videoları: https://api.diress.ai/storage/v1/object/public/reference/<INTRO_PREFIX>/{n}.mp4
const INTRO_PREFIX = "video-intro/20260922-720p";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const HEADERS = { Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" };

// Ortak kurallar: ürün birebir aynı, dağınık amatör ortam videoya taşınmaz
const BASE = `The product is the exact item shown in @Image1 — keep its shape, color, material, cap, label and proportions identical. Ignore the messy background of @Image1; it is only a product reference. Premium social-media product ad, photorealistic, natural skin, smooth handheld camera, 3 to 4 cinematic cuts. No on-screen text, no subtitles, no added logos or brand names.`;

const SHOTS = {
  1: `Cream hoodie from @Image1. Shot 1: a young woman in a bright airy apartment with large windows holds the hoodie up by the shoulders toward the camera and smiles. Shot 2: she is wearing it, turning in front of a tall black-framed floor mirror, soft daylight. Shot 3: close-up of her hand gliding over the soft cotton fabric and the drawstrings.`,
  2: `Stainless steel range-hood grease filter from @Image1. Shot 1: in a bright modern white kitchen a woman wearing yellow rubber gloves sprays degreaser onto the filter held over the sink. Shot 2: she wipes it with a cloth, grime lifting away. Shot 3: close-up of the now spotless filter slats catching the light, then she clicks it back into the range hood.`,
  3: `Matte grey insulated water bottle from @Image1. Shot 1: a woman on a sunny terrace with palm trees in the background picks the bottle up from a glass table, surprised and pleased. Shot 2: she twists the cap open and takes a sip. Shot 3: close-up of her hand holding the bottle, tiny condensation drops on the matte surface, sea bokeh behind.`,
  4: `Clear glass perfume bottle with gold cap from @Image1. Shot 1: the bottle stands on a glossy black reflective surface, warm amber backlight glowing behind it in darkness, slow push-in. Shot 2: macro of the glass shoulders and the liquid, the dip tube catching orange light. Shot 3: a hand lifts the bottle and sprays a fine golden mist into the dark.`,
  5: `Tall black matte rectangular bottle from @Image1 — a plain smooth box shape with flat sides and sharp edges, no facets, no engraving, exactly as in @Image1. Shot 1: moody dark bathroom vanity, a man in a white shirt picks up the bottle, soft side light. Shot 2: he sprays it on his neck, fine mist visible in a beam of light. Shot 3: he sets the same plain black box-shaped bottle back down on a dark stone counter, slow push-in, soft rim light on its flat edges.`,
  6: `Ribbed clear drinking glass from @Image1. Shot 1: sunny minimal kitchen, a woman drops ice cubes into the glass. Shot 2: she pours sparkling lemon water, bubbles rising, slow motion. Shot 3: close-up of her hand lifting the glass toward the window light, the vertical ribs refracting sunlight.`,
  // 8-12 (22 Eyl 2026): yeni ürünler, önce fotoğrafı metinden üretildi (gen-video-showcase-befores.cjs)
  8: `White leather low-top sneakers from @Image1. Shot 1: close-up of hands tying the white laces on a sunny city sidewalk. Shot 2: low tracking shot following the sneakers as the person walks across a bright crosswalk in soft overcast daylight. Shot 3: macro of the smooth leather, stitching and gum sole as one sneaker slowly rotates on warm concrete.`,
  9: `Sand-beige over-ear wireless headphones from @Image1. Shot 1: a young man on a crowded bright city train puts the headphones on, the crowd blurs and he relaxes with a small smile. Shot 2: close-up of his finger touching the ear cup. Shot 3: slow orbit around the headphones resting on a minimal wooden desk in soft daylight.`,
  10: `Amber glass serum dropper bottle from @Image1. Shot 1: in a bright bathroom with morning light a woman squeezes the dropper and a single golden drop falls. Shot 2: macro of the glistening drop on her fingertip. Shot 3: she gently pats it onto her cheek, dewy glowing skin, then the bottle stands on wet white stone with soft water ripples around it.`,
  11: `Tan leather top-handle handbag from @Image1. Shot 1: a stylish woman walks out of a bright café onto a sunny city street carrying the bag. Shot 2: close-up of her hand turning the gold clasp and opening the bag. Shot 3: the bag set on a marble café table, slow push-in on the leather grain and the gold hardware.`,
  12: `Speckled cream ceramic mug from @Image1. Shot 1: in a sunny kitchen fresh pour-over coffee streams into the mug, steam rising. Shot 2: a woman wraps both hands around the mug and sips by the window, calm morning mood. Shot 3: macro of the speckled glaze and unglazed rim with soft steam curling in the window light.`,
  7: `Pink perfume bottle with black cap from @Image1. Shot 1: a woman at a bright vanity table by a window in soft morning light picks up the bottle and smiles. Shot 2: she sprays her wrist, fine mist in the sunlight. Shot 3: macro of the pink liquid and gold label as the bottle slowly rotates on a marble tray with soft flowers blurred behind.`,
};

async function toDataUri(file) {
  const buf = await sharp(file).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function generate(n) {
  const image = await toDataUri(path.join(SRC_DIR, `${n}-before.webp`));
  const input = {
    prompt: `${SHOTS[n]} ${BASE}`,
    image_urls: [image],
    aspect_ratio: "3:4",
    resolution: "720p", // 22 Eyl 2026: 480p kartta/sheet'te bulanık görünüyordu
    duration: "10",
    generate_audio: false,
  };
  const { data: q } = await axios.post(`https://queue.fal.run/${MODEL}`, input, { headers: HEADERS, timeout: 120000 });
  console.log(`[${n}] kuyrukta`, q.request_id);
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const { data: st } = await axios.get(q.status_url, { headers: HEADERS });
    if (st.status === "COMPLETED") break;
    if (st.status !== "IN_QUEUE" && st.status !== "IN_PROGRESS") throw new Error(`[${n}] ${JSON.stringify(st)}`);
  }
  const { data: res } = await axios.get(q.response_url, { headers: HEADERS });
  const url = res?.video?.url;
  if (!url) throw new Error(`[${n}] video dönmedi: ${JSON.stringify(res)}`);
  const raw = path.join(TMP, `${n}-raw.mp4`);
  const vid = await axios.get(url, { responseType: "arraybuffer", timeout: 180000 });
  fs.writeFileSync(raw, Buffer.from(vid.data));

  // Kaynak kopya (diğer ekranlar için) — sessiz, faststart
  const full = path.join(SRC_DIR, `${n}-after.mp4`);
  execFileSync(ffmpeg, ["-y", "-i", raw, "-an", "-c:v", "libx264", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", full], { stdio: "ignore" });
  // Anasayfa kopyası: kartla aynı ölçü (192×256, 15 fps, ilk 8 sn, crf 28)
  const small = path.join(HOME_DIR, `${n}-after.mp4`);
  execFileSync(ffmpeg, ["-y", "-i", raw, "-an", "-t", "8", "-vf", "scale=192:256:force_original_aspect_ratio=increase,crop=192:256,fps=15", "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", small], { stdio: "ignore" });
  // Tanıtım sheet'i (commerce/VideoIntroSheet): tam kalite, sunucudan akar → pakete girmez
  const intro = path.join(TMP, `${n}-intro.mp4`);
  execFileSync(ffmpeg, ["-y", "-i", raw, "-an", "-vf", "scale=720:960:force_original_aspect_ratio=increase,crop=720:960", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", intro], { stdio: "ignore" });
  const { error } = await supabase.storage.from("reference").upload(`${INTRO_PREFIX}/${n}.mp4`, fs.readFileSync(intro), { contentType: "video/mp4", upsert: true });
  if (error) throw error;
  // #5: ilk karede şişe çok küçük → posteri ürünün net göründüğü kareden al
  const frame = path.join(TMP, `${n}-frame.png`);
  execFileSync(ffmpeg, ["-y", "-ss", n === 5 ? "9.3" : "0.3", "-i", raw, "-frames:v", "1", frame], { stdio: "ignore" });
  await sharp(frame).resize(480, 640, { fit: "cover" }).webp({ quality: 86 }).toFile(path.join(HOME_DIR, `${n}-poster.webp`));
  console.log(`[${n}] ✓ ${Math.round(fs.statSync(small).size / 1024)} KB`);
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const ids = process.argv.slice(2).map(Number).filter((n) => SHOTS[n]);
  const list = ids.length ? ids : Object.keys(SHOTS).map(Number);
  const results = await Promise.allSettled(list.map(generate));
  results.forEach((r, i) => r.status === "rejected" && console.error(`✗ [${list[i]}]`, r.reason?.response?.data || r.reason?.message));
})();
