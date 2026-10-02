#!/usr/bin/env node
// 🛍️ Web anasayfa "Listing Görsel Stüdyosu" rafı — designkit.cn dilinde 20 listing seti kartı (23 Eyl 2026)
//
// Kart (3:4, 640×853): üst ~%48 ürünün canlı yaşam tarzı görseli; altında farklı boyut/oranlarda listing
// kareleri (A: 3×2 kare · B: A+ tarzı 2×3 geniş panel · C: 3 kare + 2 geniş); sol üstte beyaz pazaryeri logosu +
// küçük "Image" yazısı. Tüm metinler İngilizce.
// Hat: ürün referansı (fal nano-banana-pro t2i, beyaz stüdyo) → her kare GPT Image 2.5 edit (referansla, "high").
// Ara kareler scratchpad dışında server/tmp/listing-cards/<id>/ altında tutulur (yeniden birleştirme için).
// Çıktı: web-dashboard/public/home_app/listing_cards/<id>.webp + cards.json (başlıklar en/tr)
// Çalıştır (server klasöründe): node scripts/gen-listing-cards.cjs [id …]   (hazır kareler atlanır)
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");
const { GPT25_EDIT_MODEL } = require("../src/utils/gpt25Edit");

const WEB = path.resolve(__dirname, "../../web-dashboard/public");
const OUT = path.join(WEB, "home_app/listing_cards");
const TMP = path.resolve(__dirname, "../tmp/listing-cards");
const T2I = "fal-ai/nano-banana-pro";
const CONCURRENCY = 6;
const SIZE = { "1:1": { width: 1024, height: 1024 }, "3:2": { width: 1536, height: 1024 }, "16:9": { width: 1536, height: 864 } };

const TEXT_RULES = "All text in the image is in ENGLISH, short, correctly spelled, crisp modern sans-serif typography, professional marketplace design, vivid true-to-life color, premium commercial photography quality. Keep the product exactly as in the reference image (same shape, colors, materials, logo placement).";

// A = 6 kare (1:1) · B = A+ 6 geniş panel (16:9) · C = 3 kare + 2 geniş (3:2)
const P = [
  { id: "bottle", market: "amazon", layout: "A", en: "Insulated bottle Amazon set", tr: "Termos şişe Amazon seti",
    product: "a matte turquoise 32oz stainless steel insulated water bottle with a black carry loop lid",
    hero: "on a sunlit granite rock beside a turquoise alpine lake, pine forest and snowy peaks, hiking backpack nearby, bright summer morning",
    features: ["Keeps Cold 24H · Hot 12H", "Leak-Proof Lid", "BPA-Free 18/8 Steel", "Fits Car Cup Holders"], use: "held by a hiker's hand on a mountain trail" },
  { id: "mixer", market: "walmart", layout: "C", en: "Stand mixer Walmart set", tr: "Mikser Walmart seti",
    product: "a glossy pastel mint tilt-head stand mixer with a polished steel bowl",
    hero: "on a bright pastel kitchen counter with fresh strawberries, a cake in progress, flour dust, morning sunlight",
    features: ["10 Speeds", "5.5 Qt Steel Bowl", "Tilt-Head Design", "3 Attachments Included"], use: "whipping cream with berries around" },
  { id: "planter", market: "etsy", layout: "A", en: "Ceramic planter Etsy set", tr: "Seramik saksı Etsy seti",
    product: "a handmade speckled terracotta ceramic planter with a wavy rim and a matching saucer",
    hero: "holding a lush monstera on a sunny windowsill in a boho living room with rattan chair and linen curtains",
    features: ["Handmade & Glazed", "Drainage Hole + Saucer", "3 Sizes", "Gift Ready"], use: "on a wooden shelf with trailing pothos" },
  { id: "serum", market: "shopify", layout: "B", en: "Vitamin C serum A+ content", tr: "C vitamini serum A+ içerik",
    product: "a frosted amber glass dropper bottle of vitamin C face serum with a minimal white label reading 'GLOW C'",
    hero: "on wet white marble with sliced oranges, water droplets and soft golden light, splash of serum texture",
    features: ["15% Vitamin C", "Brightens in 14 Days", "Vegan & Cruelty-Free", "Dermatologist Tested"], use: "applied on glowing skin, woman smiling" },
  { id: "kettle", market: "ozon", layout: "A", en: "Glass kettle OZON set", tr: "Cam kettle OZON seti",
    product: "a borosilicate glass electric kettle with a brushed steel base and a soft blue LED ring",
    hero: "on a cozy winter kitchen table with steaming tea cups, cinnamon, snow falling outside the window, warm light",
    features: ["1.7L Capacity", "Boils in 3 Minutes", "Auto Shut-Off", "Blue LED Glow"], use: "pouring hot water into a teapot" },
  { id: "blender", market: "temu", layout: "C", en: "Portable blender Temu set", tr: "Taşınabilir blender Temu seti",
    product: "a coral pink portable USB-C personal blender bottle with a carry strap",
    hero: "on a beach towel under bright sun with tropical fruits, a smoothie inside, turquoise sea behind",
    features: ["USB-C Rechargeable", "6 Steel Blades", "20oz Bottle", "Blend Anywhere"], use: "in a gym bag next to sneakers" },
  { id: "sandals", market: "trendyol", layout: "A", en: "Espadrille sandals Trendyol set", tr: "Espadril sandalet Trendyol seti",
    product: "a pair of women's cream canvas espadrille wedge sandals with ankle ties",
    hero: "on a whitewashed Mediterranean terrace with bougainvillea, blue sea and a straw hat, bright summer sun",
    features: ["Jute Wedge 7cm", "Soft Cushion Insole", "Ankle Tie Closure", "Sizes 36–41"], use: "worn by a woman walking on a seaside promenade" },
  { id: "headphones", market: "ebay", layout: "B", en: "Wireless headphones A+ content", tr: "Kablosuz kulaklık A+ içerik",
    product: "sage green over-ear wireless noise-cancelling headphones with tan leather cushions",
    hero: "on a café table by a big window with city street bokeh, latte art and a notebook, soft afternoon light",
    features: ["40H Battery", "Active Noise Cancelling", "Memory Foam Cushions", "Bluetooth 5.3"], use: "worn by a young man commuting on a train" },
  { id: "vacuum", market: "hepsiburada", layout: "C", en: "Robot vacuum Hepsiburada set", tr: "Robot süpürge Hepsiburada seti",
    product: "a white round robot vacuum cleaner with a lidar dome and a self-empty dock",
    hero: "cleaning a sunny modern living room with oak floor, a golden retriever on the rug, big windows",
    features: ["4000Pa Suction", "LiDAR Smart Mapping", "Self-Emptying 60 Days", "App & Voice Control"], use: "going under a sofa, pet hair being picked up" },
  { id: "scooter", market: "taobao", layout: "A", en: "Kids scooter Taobao set", tr: "Çocuk scooter Taobao seti",
    product: "a sky blue three-wheel kids' kick scooter with light-up wheels",
    hero: "in a sunny park path with cherry blossoms, a smiling child riding, soft bokeh",
    features: ["LED Light-Up Wheels", "Adjustable Height", "Lean-to-Steer", "Ages 3–8"], use: "folded next to a child's backpack" },
  { id: "lamp", market: "amazon", layout: "B", en: "Floor lamp A+ content", tr: "Lambader A+ içerik",
    product: "a modern arc floor lamp with a brass arm and a white linen drum shade",
    hero: "in a cozy Scandinavian living room at dusk with a boucle sofa, throw blanket and warm glow",
    features: ["Dimmable 3 Color Temps", "Brass Arc Design", "Foot Switch", "Easy Assembly"], use: "lighting a reading nook with a person reading" },
  { id: "backpack", market: "shein", layout: "C", en: "Travel backpack SHEIN set", tr: "Seyahat sırt çantası SHEIN seti",
    product: "a lilac water-resistant nylon travel backpack with a laptop compartment and USB port",
    hero: "at a bright airport gate with a window view of a plane, suitcase and coffee, morning light",
    features: ["Fits 15.6\" Laptop", "USB Charging Port", "Water-Resistant", "Anti-Theft Pocket"], use: "packed open showing organized compartments" },
  { id: "sneakers", market: "zalando", layout: "A", en: "Running shoes Zalando set", tr: "Koşu ayakkabısı Zalando seti",
    product: "a pair of white and neon orange lightweight running shoes with a thick foam sole",
    hero: "on a wet city running track at sunrise with golden light and splashing water droplets",
    features: ["Responsive Foam", "Breathable Knit", "Only 220g", "Grip Outsole"], use: "worn mid-stride by a runner" },
  { id: "cookware", market: "wayfair", layout: "C", en: "Cookware set Wayfair set", tr: "Tencere seti Wayfair seti",
    product: "a set of cream enameled cast iron pots with gold knobs",
    hero: "on a rustic farmhouse stove with a simmering stew, herbs and warm evening light",
    features: ["Enameled Cast Iron", "Oven Safe 260°C", "Gold Knobs", "5-Piece Set"], use: "serving pasta at a family dinner table" },
  { id: "perfume", market: "noon", layout: "B", en: "Oud perfume A+ content", tr: "Ud parfüm A+ içerik",
    product: "a faceted emerald green glass perfume bottle with a gold cap labelled 'OUD NOIR'",
    hero: "on golden desert sand dunes at sunset with silk fabric and warm glow",
    features: ["Long-Lasting 12H", "Oud & Amber Notes", "100ml Eau de Parfum", "Luxury Gift Box"], use: "held elegantly by a hand with gold jewelry" },
  { id: "speaker", market: "mercadolibre", layout: "A", en: "Bluetooth speaker Mercado Libre set", tr: "Bluetooth hoparlör Mercado Libre seti",
    product: "a cylindrical orange waterproof Bluetooth speaker with a rope strap",
    hero: "at a lively poolside party with splashing water, palm trees and colorful floats",
    features: ["IPX7 Waterproof", "24H Playtime", "360° Sound", "Floats on Water"], use: "hanging from a backpack on a camping trip" },
  { id: "watch", market: "flipkart", layout: "C", en: "Smartwatch Flipkart set", tr: "Akıllı saat Flipkart seti",
    product: "a rose gold smartwatch with a square AMOLED screen and a blush pink silicone strap",
    hero: "on a yoga mat in a bright studio with a water bottle and plants, morning light",
    features: ["AMOLED Display", "Heart Rate & SpO2", "10-Day Battery", "100+ Sport Modes"], use: "on a wrist during a run" },
  { id: "tent", market: "amazon", layout: "A", en: "Camping tent Amazon set", tr: "Kamp çadırı Amazon seti",
    product: "a sage green 4-person dome camping tent with an orange rainfly trim",
    hero: "pitched by a lake at golden-blue twilight with string lights, campfire and mountains",
    features: ["Sets Up in 5 Min", "Waterproof 3000mm", "Sleeps 4", "Mesh Skylight"], use: "family sitting at the entrance roasting marshmallows" },
  { id: "chair", market: "aliexpress", layout: "B", en: "Ergonomic chair A+ content", tr: "Ergonomik sandalye A+ içerik",
    product: "a black mesh ergonomic office chair with an adjustable headrest and lumbar support",
    hero: "in a bright home office with a wooden desk, monitor, plants and city view",
    features: ["Adaptive Lumbar Support", "4D Armrests", "Breathable Mesh", "135° Recline"], use: "a person working comfortably at a desk" },
  { id: "teaset", market: "amazon", layout: "C", en: "Matcha tea set Amazon set", tr: "Matcha çay seti Amazon seti",
    product: "a handmade matcha tea set: green ceramic bowl, bamboo whisk, scoop and a tin of matcha",
    hero: "on a light wood table in a serene Japanese room with shoji screens and morning sun",
    features: ["Ceremonial Grade Matcha", "Handmade Bamboo Whisk", "4-Piece Gift Set", "Rich Umami Taste"], use: "whisking frothy matcha with hands" },
];

const falHeaders = () => ({ Authorization: `Key ${process.env.FAL_API_KEY}`, "Content-Type": "application/json" });
const download = async (url) => Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 180000 })).data);

async function t2i(prompt) {
  const r = await axios.post(`https://fal.run/${T2I}`, { prompt, aspect_ratio: "1:1", resolution: "1K", num_images: 1, output_format: "png" }, { headers: falHeaders(), timeout: 300000 });
  const url = r.data?.images?.[0]?.url;
  if (!url) throw new Error("t2i görsel dönmedi");
  return url;
}
async function gpt(prompt, refUrl, ratio) {
  const r = await axios.post(`https://fal.run/${GPT25_EDIT_MODEL}`, { prompt, image_urls: [refUrl], image_size: SIZE[ratio], quality: "high", num_images: 1, output_format: "png" }, { headers: falHeaders(), timeout: 400000 });
  const url = r.data?.images?.[0]?.url;
  if (!url) throw new Error("GPT 2.5 görsel dönmedi");
  return download(url);
}

/** Kare listesi: layout'a göre (tür, oran, istem) */
function frames(p) {
  const [f1, f2, f3, f4] = p.features;
  const square = [
    ["main", `Marketplace MAIN IMAGE: ${p.product} alone on a pure white background, centred, filling 85% of the frame, soft natural shadow, no text, no props.`],
    ["feature", `Infographic listing image: ${p.product} shown large on the right; on the left a bold headline "${f1}" and three small icon callouts with short labels "${f2}", "${f3}", "${f4}". Clean pastel background matching the product colors.`],
    ["use", `Lifestyle listing image: ${p.product} ${p.use}; a short bold headline "${f2}" at the top in a rounded banner.`],
    ["detail", `Close-up detail listing image: macro shot of the most important detail of ${p.product}, two thin callout lines with labels "${f3}" and "${f4}", headline "Premium Details".`],
    ["size", `Size & specs listing image: ${p.product} on a light background with thin measurement lines and realistic dimension numbers in cm and inches, headline "Size & Specs".`],
    ["box", `"What's in the Box" listing image: ${p.product} and its included accessories neatly arranged flat lay on a soft colored background, each item with a small English label, headline "What's in the Box".`],
  ];
  const wide = [
    ["aplus1", `Amazon A+ premium module banner: wide cinematic lifestyle photo of ${p.product} ${p.hero.split(",")[0]}, elegant headline "${f1}" with a one-line subline on the left, generous negative space.`],
    ["aplus2", `Amazon A+ premium module: ${p.product} ${p.use}, headline "${f2}" and a short subline, warm natural light.`],
    ["aplus3", `Amazon A+ premium module: split layout, left a close-up of ${p.product}'s key detail, right three icon rows "${f1}", "${f3}", "${f4}" with tiny descriptions.`],
    ["aplus4", `Amazon A+ premium module: ${p.product} in a different beautiful setting than before, headline "${f3}", soft cinematic light.`],
    ["aplus5", `Amazon A+ premium comparison module: a clean comparison chart "Why Choose Us" with our ${p.product} vs "Others", checkmarks and crosses, 4 short rows.`],
    ["aplus6", `Amazon A+ premium module: happy customer lifestyle moment with ${p.product}, headline "${f4}", 5 gold stars and "Loved by 10,000+ customers".`],
  ];
  if (p.layout === "A") return square.map(([k, s]) => ({ k, ratio: "1:1", prompt: s }));
  if (p.layout === "B") return wide.map(([k, s]) => ({ k, ratio: "16:9", prompt: s }));
  return [...square.slice(0, 3).map(([k, s]) => ({ k, ratio: "1:1", prompt: s })), ...[square[3], square[5]].map(([k, s]) => ({ k: `${k}w`, ratio: "3:2", prompt: s }))];
}

// ─── birleştirme (1280×1706 = 2× 640×853) ───
const CW = 1280, CH = 1706, HERO_H = 820, G = 8;
async function avgColor(buf) {
  const s = await sharp(buf).resize(40, 40, { fit: "cover", position: "bottom" }).stats();
  return s.channels.slice(0, 3).map((c) => Math.round(c.mean * 0.82));
}
async function wordmark(p) {
  const text = p.layout === "B" ? "A+ Premium" : null;
  const layers = [];
  let w = 0;
  if (text) {
    w = 360;
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="90"><text x="0" y="70" font-family="Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="66" fill="#fff">${text}</text></svg>`), left: 0, top: 30 });
  } else {
    const logo = await sharp(path.join(WEB, `home_app/logos/${p.market}-dark.webp`)).resize({ height: 70 }).png().toBuffer();
    w = (await sharp(logo).metadata()).width;
    layers.push({ input: logo, left: 0, top: 34 });
  }
  // designkit: küçük "Image" üst simge gibi logonun sağ üst köşesinin hemen üstünde
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="34"><text x="0" y="24" font-family="Helvetica Neue, Arial, sans-serif" font-weight="600" font-size="24" fill="#fff">Image</text></svg>`), left: Math.max(0, w - 64), top: 0 });
  const mark = await sharp({ create: { width: w + 70, height: 112, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
  const shadow = await sharp(mark).ensureAlpha().linear([0, 0, 0, 0.6], [0, 0, 0, 0]).blur(8).png().toBuffer();
  return { mark, shadow };
}
async function compose(p, dir) {
  const read = (k) => fs.readFileSync(path.join(dir, `${k}.png`));
  const hero = read("hero");
  const [r, g, b] = await avgColor(hero);
  const layers = [{ input: await sharp(hero).resize(CW, HERO_H, { fit: "cover" }).toBuffer(), left: 0, top: 0 }];
  const fr = frames(p);
  const top0 = HERO_H + G;
  const bottomH = CH - top0 - G;
  const place = async (k, x, y, w, h) => layers.push({ input: await sharp(read(k)).resize(w, h, { fit: "cover" }).toBuffer(), left: x, top: y });
  if (p.layout === "A") {
    const w = Math.floor((CW - 4 * G) / 3), h = Math.floor((bottomH - G) / 2);
    for (let i = 0; i < 6; i++) await place(fr[i].k, G + (i % 3) * (w + G), top0 + Math.floor(i / 3) * (h + G), w, h);
  } else if (p.layout === "B") {
    const w = Math.floor((CW - 3 * G) / 2), h = Math.floor((bottomH - 2 * G) / 3);
    for (let i = 0; i < 6; i++) await place(fr[i].k, G + (i % 2) * (w + G), top0 + Math.floor(i / 2) * (h + G), w, h);
  } else {
    const w3 = Math.floor((CW - 4 * G) / 3), w2 = Math.floor((CW - 3 * G) / 2);
    const h1 = w3, h2 = bottomH - h1 - G;
    for (let i = 0; i < 3; i++) await place(fr[i].k, G + i * (w3 + G), top0, w3, h1);
    for (let i = 0; i < 2; i++) await place(fr[3 + i].k, G + i * (w2 + G), top0 + h1 + G, w2, h2);
  }
  const { mark, shadow } = await wordmark(p);
  // açık zeminli görsellerde beyaz logo okunsun: sol üstte yumuşak radyal karartma + belirgin gölge
  const vignette = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="360"><defs><radialGradient id="v" cx="0" cy="0" r="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#000" stop-opacity="0.34"/><stop offset="0.55" stop-color="#000" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs><rect width="760" height="360" fill="url(#v)"/></svg>`);
  layers.push({ input: vignette, left: 0, top: 0 }, { input: shadow, left: 38, top: 34 }, { input: shadow, left: 36, top: 32 }, { input: mark, left: 36, top: 30 });
  const out = path.join(OUT, `${p.id}.webp`);
  // sharp'ta resize composite'ten önce uygulanır → önce tam boy birleştir, sonra küçült
  const full = await sharp({ create: { width: CW, height: CH, channels: 3, background: { r, g, b } } }).composite(layers).png().toBuffer();
  await sharp(full).resize(640, 853).webp({ quality: 82 }).toFile(out);
  console.log(`   ✓ ${p.id}.webp (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}

async function main() {
  if (!process.env.FAL_API_KEY) throw new Error("FAL_API_KEY yok (.env)");
  fs.mkdirSync(OUT, { recursive: true });
  const ids = process.argv.slice(2);
  const list = ids.length ? P.filter((p) => ids.includes(p.id)) : P;
  // 1) referanslar (sırayla değil, paralel)
  const refs = {};
  await Promise.all(list.map(async (p) => {
    const dir = path.join(TMP, p.id); fs.mkdirSync(dir, { recursive: true });
    const refFile = path.join(dir, "ref.url");
    if (fs.existsSync(refFile)) { refs[p.id] = fs.readFileSync(refFile, "utf8"); return; }
    refs[p.id] = await t2i(`Professional e-commerce studio packshot of ${p.product}, pure white background, centred, soft shadow, ultra sharp, true colors, no text.`);
    fs.writeFileSync(refFile, refs[p.id]);
    console.log(`[${p.id}] referans hazır`);
  }));
  // 2) kareler (hero + listing) — iş kuyruğu
  const jobs = [];
  for (const p of list) {
    jobs.push({ p, k: "hero", ratio: "3:2", prompt: `Hero lifestyle photograph for a marketplace listing: ${p.product} ${p.hero}. Vivid, bright, magazine-quality, the product is the clear hero in the lower-middle of the frame, upper area calm for a logo. No text.` });
    for (const f of frames(p)) jobs.push({ p, ...f, prompt: `${f.prompt} ${TEXT_RULES}` });
  }
  let next = 0, done = 0, failed = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const file = path.join(TMP, j.p.id, `${j.k}.png`);
      if (fs.existsSync(file)) { done++; continue; }
      try { fs.writeFileSync(file, await gpt(j.prompt, refs[j.p.id], j.ratio)); done++; console.log(`   · ${j.p.id}/${j.k} (${done}/${jobs.length})`); }
      catch (e) { failed++; console.log(`✗ ${j.p.id}/${j.k}: ${e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // 3) birleştir
  const cards = [];
  for (const p of list) {
    const dir = path.join(TMP, p.id);
    const need = ["hero", ...frames(p).map((f) => f.k)];
    if (need.every((k) => fs.existsSync(path.join(dir, `${k}.png`)))) { await compose(p, dir); cards.push({ id: p.id, market: p.market, layout: p.layout, en: p.en, tr: p.tr }); }
    else console.log(`- ${p.id}: eksik kare, birleştirilmedi`);
  }
  const manifestFile = path.join(OUT, "cards.json");
  const prev = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : [];
  const merged = P.map((p) => cards.find((c) => c.id === p.id) || prev.find((c) => c.id === p.id)).filter(Boolean);
  fs.writeFileSync(manifestFile, JSON.stringify(merged, null, 1));
  console.log(`\nBitti: ${done} kare, ${failed} hata, ${cards.length} kart.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
