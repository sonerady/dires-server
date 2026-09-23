#!/usr/bin/env node
// 🎬 Video stüdyosu kart videoları (23 Eyl 2026, kullanıcı isteği) — Designkit kapaklarının
// yerine KENDİ örneklerimiz. Her kartta 3 alternatif (kart bitince sıradakine geçer).
// Seedance 2.5 reference-to-video, kart oranı 3:4, 5 sn, 720p kaynak → kartta düşük kalite
// döngü kopyası (270×360, crf 30) + poster + "önce" küçüğü.
// Ürünler anasayfa örneklerinin amatör fotoğrafları (client/assets/video_showcase/{n}-before.webp).
// 🔁 Remix: önce "beğenilen viral video" (başka ürün/kişi) text-to-video ile üretilir, sonra
// ürünümüz bu videoya @Video1 olarak remix edilir — kartta ürün + "+" + referans → sonuç.
// Çıktı: client/assets/video_skills/{id}-{k}.mp4 · -poster.webp · -before.webp · (remix) -ref.mp4
// Çalıştır (server klasöründe): node scripts/gen-video-skill-cards.cjs [id-k ...]  (örn. remix-2)
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const axios = require("axios");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");
const { createClient } = require("@supabase/supabase-js");

const REF_MODEL = "bytedance/seedance-2.5/reference-to-video";
const T2V_MODEL = "bytedance/seedance-2.5/text-to-video";
const SRC = path.resolve(__dirname, "../../client/assets/video_showcase");
const OUT = path.resolve(__dirname, "../../client/assets/video_skills");
const TMP = path.resolve(__dirname, "../temp/video_skill_cards");
const HEADERS = { Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" };
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const RULES = "The product is the exact item shown in @Image1 — keep its shape, color, material, logo, label and proportions identical. Ignore the background of @Image1; it is only a product reference. No on-screen text, no subtitles, no added logos or brand names.";
const UGC = "Handheld with natural micro-shake and slightly imperfect framing, phone auto-exposure, realistic skin texture with no retouching, ordinary lived-in background, no cinematic color grading, no studio lighting — it must feel like a real TikTok creator clip, not an ad.";

const CARDS = {
  sales: [
    { n: 8, prompt: "Scroll-stopping social sales ad for the white leather sneakers from @Image1, 5 seconds, fast rhythmic cuts: 1) a sneaker drops into frame and lands on a sunlit concrete step with a satisfying bounce, 2) quick low tracking shot of the sneakers striding across a bright city crosswalk, 3) snap close-up of the clean leather and gum sole, 4) hero shot of the pair on a pastel plinth in soft daylight. Energetic, premium, modern." },
    { n: 3, prompt: "Punchy performance ad for the matte grey insulated water bottle from @Image1, 5 seconds, fast cuts: a runner grabs the bottle from a gym bag, ice-cold condensation beads on the matte surface, a quick sip after a morning run in bright cool daylight, snap cut to the bottle standing on a clean white bench in crisp open shade. Energetic, fresh, benefit-first. No golden hour, no sunset or sunrise glow." },
    { n: 2, prompt: "Problem-to-solution sales ad for the stainless steel range-hood grease filter from @Image1, 5 seconds: a quick shot of a greasy old filter, whip cut to the shiny clean filter from @Image1 sliding into a bright modern range hood with a satisfying click, close-up of the spotless slats catching the light, ending on a clean sunny kitchen. Clear, satisfying, convincing." },
  ],
  remix: [
    // ⚠️ Seedance 2.5 ref2v, gerçekçi insan içeren referans videoyu reddediyor ("likenesses of real
    // people") → kullanıcı kararı (23 Eyl): remix örnekleri CANLI Remix kartıyla aynı model olan
    // seedance-2.0/enterprise ile üretilir; referanslar yine 2.5 text-to-video.
    { n: 11, model: "bytedance/seedance-2.0/enterprise/reference-to-video",
      ref: "Viral TikTok transition video, 5 seconds, vertical: a young woman with dark hair in a bright living room swings her hand over the phone lens, whip-pan transition, and she is now walking down a sunny city street carrying a black canvas tote bag, then a snappy close-up of the tote's strap as she lifts it toward the camera. Trendy, rhythmic, creator style.",
      prompt: "Remix of the reference video @Video1: recreate its exact structure, shot order, pacing, hand-over-lens whip transition and camera moves, but with a different stylish woman and the tan leather handbag from @Image1 instead of the tote — the street walk, then a snappy close-up of the gold clasp. Never copy the person or the tote from @Video1." },
    { n: 1, model: "bytedance/seedance-2.0/enterprise/reference-to-video",
      ref: "Viral TikTok outfit-change video, 5 seconds, vertical: a young man stands in a hallway in plain pajamas, jumps up, and on landing a jump-cut reveals him in a stylish charcoal crewneck sweatshirt; he strikes a confident pose and adjusts the sleeve. Fun, rhythmic, creator style.",
      prompt: "Remix of the reference video @Video1: recreate its exact jump-cut outfit-change format, pacing and camera framing, but with a different young woman who reveals the cream hoodie from @Image1 on landing, then pulls the drawstrings and poses. Never copy the person or the sweatshirt from @Video1." },
    { n: 4, ref: "Viral ASMR perfume spray video, 5 seconds, vertical: a hand sprays a generic cobalt-blue cologne bottle toward the camera, fine mist fills the frame, cut to the bottle standing on white marble with water droplets, slow elegant rotation, moody soft light.",
      prompt: "Remix of the reference video @Video1: recreate its exact spray-toward-camera mist moment, the cut to marble with water droplets and the slow rotation, but with the clear glass perfume bottle with gold cap from @Image1 instead of the blue bottle, warm amber light. Never copy the blue bottle from @Video1." },
  ],
  ugc: [
    { n: 10, prompt: `Authentic UGC selfie video, 5 seconds, looks genuinely filmed on a phone front camera by a real person: a woman in her late twenties in her own small bathroom in natural window daylight holds the amber serum dropper bottle from @Image1 next to her face, talks casually to the camera, squeezes the dropper and dabs a drop on her cheek, then smiles and holds the bottle closer to the lens. ${UGC}` },
    { n: 9, prompt: `Authentic UGC selfie video, 5 seconds, looks genuinely filmed on a phone front camera by a real person: a young man sitting on a commuter train holds the sand-beige over-ear headphones from @Image1, talks to the camera excitedly, puts them on, closes his eyes and nods with a relieved smile as the noise disappears. ${UGC}` },
    // (siyah kolonya şişesi telif reddi aldı → kapüşonlu ayna denemesi)
    { n: 1, prompt: `Authentic UGC mirror-selfie video, 5 seconds, looks genuinely filmed on a phone by a real person: a young woman in her bedroom holds her phone up to a full-length mirror wearing the cream hoodie from @Image1, turns side to side, pulls the hood up and laughs, then shows the soft fabric close to the phone. ${UGC}` },
  ],
  closeup: [
    { n: 7, prompt: "Luxurious macro close-up video of the pink perfume bottle from @Image1, 5 seconds: extreme macro of the gradient pink liquid with light refracting through the glass, a slow slide across the gold label, a soft light sweep over the black cap, shallow depth of field, gentle floating dust in the light, soft blush and cream tones. Elegant, tactile, high-end." },
    { n: 6, prompt: "Crystal-clear macro video of the ribbed drinking glass from @Image1, 5 seconds: extreme close-up of sunlight refracting through the vertical ribs, a slow rack focus along the rim, ice cubes gently clinking inside, sparkling caustic light patterns dancing on a white marble surface. Fresh, tactile, premium." },
    { n: 12, prompt: "Tactile macro video of the handmade speckled ceramic mug from @Image1, 5 seconds: extreme close-up gliding across the speckled cream glaze, the raw unglazed rim, a fingertip tracing the handle, soft warm window light raking across the texture, shallow depth of field. Crafted, warm, artisanal." },
  ],
  spin360: [
    { n: 9, prompt: "Clean 360-degree product turntable video of the sand-beige over-ear headphones from @Image1, 5 seconds: the headphones rotate smoothly one full turn on an invisible turntable against a seamless pure white studio backdrop, soft even studio lighting with a subtle floor shadow, every side clearly visible, stable centered framing, marketplace-ready." },
    { n: 8, prompt: "Clean 360-degree product turntable video of the single white leather sneaker from @Image1, 5 seconds: the sneaker rotates smoothly one full turn on a round white pedestal against a soft light-grey gradient studio backdrop, soft even lighting, every side, the gum sole and laces clearly visible, stable centered framing." },
    { n: 5, prompt: "Clean 360-degree product turntable video of the black matte bottle from @Image1, 5 seconds: the bottle rotates smoothly one full turn on a glossy dark stone plinth against a seamless deep charcoal backdrop, crisp rim light tracing its edges, every side clearly visible, stable centered framing, premium." },
  ],
  commercial: [
    { n: 12, prompt: "Cinematic brand commercial for the handmade speckled ceramic mug from @Image1, 5 seconds: morning light streams into a calm Scandinavian kitchen, freshly brewed coffee pours into the mug in slow motion with rising steam, cut to hands wrapping around the mug by the window, ending on a hero shot of the mug on a linen cloth with soft steam curling. Warm, serene, premium brand film look." },
    { n: 10, prompt: "Cinematic skincare brand commercial for the amber serum dropper bottle from @Image1, 5 seconds: the bottle stands in a shallow pool of water on pale travertine, a single golden drop falls from the dropper in slow motion creating a ripple, soft botanical shadows drift across, ending on a serene hero shot with warm morning light. Luxurious, calm, premium." },
    { n: 11, prompt: "Cinematic fashion brand commercial for the tan leather handbag from @Image1, 5 seconds: golden-free soft daylight in an elegant Parisian apartment, a woman's hand lifts the bag from a marble console, cut to her walking through tall sunlit doors with the bag, ending on a hero shot of the gold clasp. Refined, aspirational brand film." },
  ],
};

async function falQueue(model, input) {
  const { data: q } = await axios.post(`https://queue.fal.run/${model}`, input, { headers: HEADERS, timeout: 120000 });
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const { data: st } = await axios.get(q.status_url, { headers: HEADERS });
    if (st.status === "COMPLETED") break;
    if (!["IN_QUEUE", "IN_PROGRESS"].includes(st.status)) throw new Error(JSON.stringify(st));
  }
  const { data: res } = await axios.get(q.response_url, { headers: HEADERS });
  return res.video.url;
}
const download = async (url, file) => fs.writeFileSync(file, Buffer.from((await axios.get(url, { responseType: "arraybuffer" })).data));
const smallClip = (src, dst, w, h, crf = 30) => execFileSync(ffmpeg, ["-y", "-i", src, "-an", "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=24`, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], { stdio: "ignore" });

async function one(id, k) {
  const c = CARDS[id][k - 1];
  const tag = `${id}-${k}`;
  const before = path.join(SRC, `${c.n}-before.webp`);
  const img = `data:image/jpeg;base64,${(await sharp(before).jpeg({ quality: 92 }).toBuffer()).toString("base64")}`;
  const raw = path.join(TMP, `${tag}-raw.mp4`);
  // k=1 (remix hariç) önceki turda üretildi: yeniden üretme, yalnız çıktıları yeni adlarla yaz
  const legacy = path.join(TMP, `${id}-raw.mp4`);
  if (k === 1 && id !== "remix" && fs.existsSync(legacy) && !fs.existsSync(raw)) fs.copyFileSync(legacy, raw);
  const extra = {};
  if (c.ref) {
    const refRaw = path.join(TMP, `${tag}-refraw.mp4`);
    if (!fs.existsSync(refRaw)) {
      console.log(`[${tag}] referans (viral) video üretiliyor…`);
      await download(await falQueue(T2V_MODEL, { prompt: c.ref, aspect_ratio: "3:4", resolution: "480p", duration: "5", generate_audio: false }), refRaw);
    }
    const key = `skill-cards/${tag}-ref.mp4`;
    const { error } = await supabase.storage.from("user_videos").upload(key, fs.readFileSync(refRaw), { contentType: "video/mp4", upsert: true });
    if (error) throw error;
    extra.video_urls = [supabase.storage.from("user_videos").getPublicUrl(key).data.publicUrl];
    smallClip(refRaw, path.join(OUT, `${tag}-ref.mp4`), 150, 200, 32);
  }
  if (!fs.existsSync(raw)) {
    console.log(`[${tag}] üretiliyor…`);
    await download(await falQueue(c.model || REF_MODEL, { prompt: `${c.prompt} ${RULES}`, image_urls: [img], aspect_ratio: "3:4", resolution: "720p", duration: "5", generate_audio: false, end_user_id: "video-skill-cards", ...extra }), raw);
  }
  smallClip(raw, path.join(OUT, `${tag}.mp4`), 270, 360);
  const frame = path.join(TMP, `${tag}-frame.png`);
  execFileSync(ffmpeg, ["-y", "-ss", "0.1", "-i", raw, "-frames:v", "1", frame], { stdio: "ignore" });
  await sharp(frame).resize(360, 480, { fit: "cover" }).webp({ quality: 80 }).toFile(path.join(OUT, `${tag}-poster.webp`));
  await sharp(before).resize(150, 200, { fit: "cover" }).webp({ quality: 82 }).toFile(path.join(OUT, `${tag}-before.webp`));
  console.log(`[${tag}] ✓ ${Math.round(fs.statSync(path.join(OUT, `${tag}.mp4`)).size / 1024)} KB`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
  const all = Object.entries(CARDS).flatMap(([id, list]) => list.map((_, i) => `${id}-${i + 1}`));
  const wanted = process.argv.slice(2).filter((x) => all.includes(x));
  const list = wanted.length ? wanted : all;
  const r = await Promise.allSettled(list.map((t) => { const i = t.lastIndexOf("-"); return one(t.slice(0, i), Number(t.slice(i + 1))); }));
  r.forEach((x, i) => x.status === "rejected" && console.error(`✗ [${list[i]}]`, x.reason?.response?.data || x.reason?.message));
})();
