#!/usr/bin/env node
// 🪄 Ürün Rötuşu (Refiner, "Amatörden Profesyonele") örnek çiftleri — web masaüstü anasayfa rafı (23 Eyl 2026)
//
// Refiner ne yapar: satıcının amatör ürün fotoğrafını temiz, pazaryerine hazır e-ticaret karesine çevirir.
// Kategoriye göre sergileme: giyim → hayalet manken / flat lay / renk dizisi; ayakkabı → tekli profil /
// çapraz çift; gözlük → önden; takı → yüzük açılı hero, kolye simetrik önden, küpe ikisi önden; zemin rengi +
// yumuşak temas gölgesi seçenekleri. Buradaki 10 örnek bu yelpazeyi kapsar.
// ÖNCE: fal nano-banana-pro t2i ile gerçekçi amatör telefon fotoğrafı (9:16).
// SONRA: Refiner'ın kullandığı model (GPT Image 2.5 edit) + createRefiner.js'teki sergileme direktiflerinin özü.
// Çıktı: web-dashboard/public/home_app/retouch/{id}-before.webp, {id}-after.webp (540×960, 9:16)
// Çalıştır (server klasöründe): node scripts/gen-refiner-examples.cjs [id …]   (var olan çift atlanır)
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
const { GPT25_EDIT_MODEL, buildEditInput } = require("../src/utils/gpt25Edit");

const OUT = path.resolve(__dirname, "../../web-dashboard/public/home_app/retouch");
const T2I_MODEL = "fal-ai/nano-banana-pro";
const W = 540;
const H = 960;
const AMATEUR = "Casual amateur smartphone photo taken by a small online seller at home, ordinary indoor light, slightly uneven exposure, casual handheld framing, real home surface with a little background clutter, no people, no text, no watermark. Vertical 9:16 photo.";
const BASE = "Refine this amateur product photo into a clean, professional e-commerce studio shot for a marketplace listing. Keep the product EXACTLY as it is — same shape, proportions, materials, colors, stitching, hardware, prints, labels and branding; never redesign, restyle or recolor it unless told. Remove all background clutter, hands and props. Even, soft, high-end studio lighting, crisp true-to-life detail, accurate color. No added text, no watermark. Vertical 9:16 frame, product centred with generous even margins.";
const WHITE = "Pure clean white seamless background.";
const SHADOW = "Ground it with a soft, barely-there contact shadow.";

const PAIRS = [
  { id: "ghost", before: `A navy blue cotton overshirt with chest pockets lying crumpled on an unmade bed. ${AMATEUR}`,
    after: `${BASE} STAGING — GHOST MANNEQUIN: the garment is filled by an invisible body and holds its full three-dimensional form — shoulders shaped, chest with real depth, collar standing open with visible interior, sleeves with hollow tubular volume and a soft bend at the elbow, hem falling naturally. Nothing lies flat. ${WHITE}` },
  { id: "flatlay", before: `A mustard yellow crewneck t-shirt with a small embroidered logo tossed on a wooden floor next to slippers. ${AMATEUR}`,
    after: `${BASE} Remove the slippers and every other object — ONLY the t-shirt remains in the frame. STAGING — FLAT LAY: the garment laid completely flat, seen straight from directly above at a perfect 90° top-down angle, neatly and symmetrically arranged — shoulders squared, sleeves laid smoothly, body panel flat and wrinkle-free, hem straight; fabric texture fully legible. Light it evenly, faint contact shadow at the fabric edges. Light warm-grey studio surface.` },
  { id: "lineup", before: `A sage green zip-up hoodie hanging on a door hook in a hallway. ${AMATEUR}`,
    after: `${BASE} STAGING — COLOR LINEUP: a marketplace-style colorway lineup of this exact same hoodie — four ghost-mannequin copies side by side in sage green, heather grey, navy and cream, identical cut, seams, zipper and proportions, each looking genuinely dyed (folds keep their tonal depth, fabric texture visible). Same frontal angle and lighting for every copy; the lineup spans the full width with slim equal margins. ${WHITE} No text or color names.` },
  { id: "sneakers", before: `A pair of white leather low-top sneakers with a green heel tab standing on a cluttered shoe rack near the front door. ${AMATEUR}`,
    after: `${BASE} STAGING — PAIR HERO: a true left and right of the same pair, one shoe in three-quarter front view slightly overlapping the other shown in side profile, both upright on an invisible floor — never a mirrored duplicate. No feet or legs. ${WHITE} ${SHADOW}` },
  { id: "boot", before: `A brown suede chelsea boot lying on its side on a bathroom tile floor. ${AMATEUR}`,
    after: `${BASE} STAGING — SINGLE SHOE, SIDE PROFILE: exactly ONE boot, direct technical side-profile view of the outer side, upright and stable as if standing on an invisible floor, centred. Suede nap and elastic side panel sharply visible. ${WHITE} ${SHADOW}` },
  { id: "sunglasses", before: `Black acetate cat-eye sunglasses lying folded on a messy desk beside a coffee mug. ${AMATEUR}`,
    after: `${BASE} STAGING — FRONT VIEW: the sunglasses unfolded, straight frontal view, temples open, perfectly level and symmetric, lenses with natural subtle reflections. No face or mannequin. ${WHITE} ${SHADOW}` },
  { id: "ring", before: `A gold ring with a small oval emerald held between fingertips over a kitchen counter. ${AMATEUR}`,
    after: `${BASE} STAGING — RING, ANGLED HERO: the ring alone standing upright at a gentle three-quarter angle so the emerald faces the camera, metal with clean polished reflections, stone clear and vivid. No hands or fingers. ${WHITE} ${SHADOW}` },
  { id: "necklace", before: `A delicate silver necklace with a small pearl pendant tangled on a wooden dresser top. ${AMATEUR}`,
    after: `${BASE} STAGING — NECKLACE, SYMMETRIC FRONT: the chain laid in a smooth symmetric U/V drape seen from the front, pendant centred at the bottom, chain untangled and even. ${WHITE} Absolutely no shadow.` },
  { id: "earrings", before: `A pair of gold hoop earrings with tiny crystals lying on a bathroom sink edge. ${AMATEUR}`,
    after: `${BASE} STAGING — EARRINGS, BOTH FRONT: both earrings side by side facing the camera, identical scale and orientation, evenly spaced and centred. Soft solid warm beige studio background (#E9DFD3). ${SHADOW}` },
  { id: "bag", before: `A tan leather crossbody bag with a gold buckle slumped on a sofa cushion. ${AMATEUR}`,
    after: `${BASE} STAGING — PACKSHOT: the bag standing upright, front facing the camera with a slight three-quarter turn, strap arranged neatly, leather grain and stitching crisp, hardware with clean reflections. Soft solid light sage studio background (#DDE3D6). ${SHADOW}` },
];

const falHeaders = () => ({ Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" });
const download = async (url) => Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 120000 })).data);

async function textToImage(prompt) {
  const res = await axios.post(`https://fal.run/${T2I_MODEL}`, { prompt, aspect_ratio: "9:16", resolution: "1K", num_images: 1, output_format: "jpeg" }, { headers: falHeaders(), timeout: 300000 });
  const url = res.data?.images?.[0]?.url;
  if (!url) throw new Error("t2i görsel dönmedi");
  return url;
}

async function refine(prompt, imageUrl) {
  const input = buildEditInput(GPT25_EDIT_MODEL, { prompt, image_urls: [imageUrl], aspect_ratio: "9:16", quality: "high", num_images: 1, output_format: "png" });
  const res = await axios.post(`https://fal.run/${GPT25_EDIT_MODEL}`, input, { headers: falHeaders(), timeout: 300000 });
  const url = res.data?.images?.[0]?.url;
  if (!url) throw new Error("GPT 2.5 görsel dönmedi");
  return download(url);
}

async function save(buffer, file) {
  await sharp(buffer).resize(W, H, { fit: "cover", position: "centre" }).webp({ quality: 78 }).toFile(file);
  console.log(`   ✓ ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

async function make(pair) {
  const beforeFile = path.join(OUT, `${pair.id}-before.webp`);
  const afterFile = path.join(OUT, `${pair.id}-after.webp`);
  if (fs.existsSync(beforeFile) && fs.existsSync(afterFile)) return;
  console.log(`[${pair.id}] önce üretiliyor…`);
  const beforeUrl = await textToImage(pair.before);
  await save(await download(beforeUrl), beforeFile);
  console.log(`[${pair.id}] rötuş (GPT Image 2.5)…`);
  await save(await refine(pair.after, beforeUrl), afterFile);
}

(async () => {
  if (!process.env.FAL_API_KEY) throw new Error("FAL_API_KEY yok (.env)");
  fs.mkdirSync(OUT, { recursive: true });
  const ids = process.argv.slice(2);
  const list = ids.length ? PAIRS.filter((p) => ids.includes(p.id)) : PAIRS;
  const results = await Promise.allSettled(list.map(make));
  results.forEach((r, i) => { if (r.status === "rejected") console.log(`✗ ${list[i].id}: ${r.reason?.response?.data ? JSON.stringify(r.reason.response.data).slice(0, 240) : r.reason?.message}`); });
  console.log("\nBitti.");
})();
