// 🖼️ "Ürünün farklı açıları" rehberi için 6 ÖRNEK FOTOĞRAF üretir.
//
// Amaç (24 Ağu 2026, kullanıcı isteği): kullanıcıya "aynı ürünün 6 farklı
// fotoğrafı böyle olur" diye göstermek. Fotoğraflar bilerek AMATÖR: elde
// askıda tutulan desenli bir tişört, ev duvarı, pencere ışığı — satıcının
// telefonuyla çekebileceği türden. Stüdyo karesi gösterirsek kullanıcı
// "benim öyle imkânım yok" deyip özelliği hiç denemez.
//
// ⚠️ TUTARLILIK: 1. kare düz üretimle, kalan 5'i o karenin ÜSTÜNE /edit ile
// yapılıyor. Aksi halde her karede farklı bir tişört çıkıyor ve "aynı ürün"
// mesajı çöküyor.
//
// Kullanım: node scripts/assets/gen_angles_guide.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const OUT_DIR = path.join(__dirname, "../../../client/assets/angles-guide");

// ⚠️ "askıda" demek yetmedi: ilk denemede tişört askının ÜSTÜNE KATLANMIŞ
// çıktı, giysi gibi durmadı. Asılma biçimini açıkça tarif etmek şart.
const BASE_LOOK =
  "a short-sleeve cotton t-shirt with a bold repeating geometric pattern in " +
  "terracotta and off-white, hanging properly on a plain wooden hanger with " +
  "the shoulders sitting on the hanger, both short sleeves clearly visible " +
  "and spread out, the body of the shirt hanging straight down, the whole " +
  "garment in frame";

const SHOT_STYLE =
  "Amateur smartphone snapshot taken by a small online seller at home. " +
  "Plain light grey wall, soft daylight from a window on the left, slight " +
  "hand-held tilt, natural imperfect framing, no studio lighting, no props, " +
  "no text, no watermark, realistic phone-camera look.";

const SHOTS = [
  { file: "angle-1-front.jpg", prompt: `A hand holding the hanger hook, ${BASE_LOOK}, held up against the wall. FRONT of the garment facing the camera, straight on. ${SHOT_STYLE}` },
  { file: "angle-2-back.jpg", prompt: `The SAME t-shirt on the same hanger, turned around so the BACK of the garment faces the camera. ${SHOT_STYLE}` },
  { file: "angle-3-side.jpg", prompt: `The SAME t-shirt on the same hanger seen from a 45-degree ANGLE, showing the side seam and how the fabric falls. ${SHOT_STYLE}` },
  { file: "angle-4-fabric.jpg", prompt: `CLOSE-UP of the SAME t-shirt fabric filling the frame, the pattern and the weave clearly visible, hand holding the cloth slightly stretched. ${SHOT_STYLE}` },
  { file: "angle-5-collar.jpg", prompt: `CLOSE-UP of the SAME t-shirt collar and neckline with the inner care label visible, garment still on the hanger. ${SHOT_STYLE}` },
  { file: "angle-6-sleeve.jpg", prompt: `CLOSE-UP of the SAME t-shirt sleeve cuff and bottom hem stitching, hand holding the sleeve up. ${SHOT_STYLE}` },
];

async function callFal({ prompt, imageUrls = null }) {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY yok");
  const edit = Array.isArray(imageUrls) && imageUrls.length > 0;
  const models = [
    `https://fal.run/fal-ai/nano-banana-pro${edit ? "/edit" : ""}`,
    `https://fal.run/fal-ai/nano-banana-2${edit ? "/edit" : ""}`,
  ];
  for (const url of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const body = {
          prompt,
          aspect_ratio: "1:1",
          resolution: "1K",
          output_format: "jpeg",
          num_images: 1,
        };
        if (edit) body.image_urls = imageUrls;
        const r = await axios.post(url, body, {
          headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
          timeout: 300000,
        });
        if (r.data.images?.[0]?.url) return r.data.images[0].url;
        throw new Error("cevapta görsel yok");
      } catch (e) {
        const msg = e.response?.data?.detail || e.message;
        console.error(`   ↳ hata (${url.split("/").slice(-2).join("/")}):`, String(msg).slice(0, 120));
        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw new Error("tüm modeller başarısız");
}

async function download(url, file) {
  const r = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
  fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(r.data));
  const kb = Math.round(fs.statSync(path.join(OUT_DIR, file)).size / 1024);
  console.log(`   ✔ ${file} (${kb} KB)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`🖼️  6 örnek kare üretiliyor → ${OUT_DIR}`);

  console.log(`1/6 ${SHOTS[0].file} (referans kare)`);
  const firstUrl = await callFal({ prompt: SHOTS[0].prompt });
  await download(firstUrl, SHOTS[0].file);

  for (let i = 1; i < SHOTS.length; i++) {
    console.log(`${i + 1}/6 ${SHOTS[i].file}`);
    const url = await callFal({ prompt: SHOTS[i].prompt, imageUrls: [firstUrl] });
    await download(url, SHOTS[i].file);
  }
  console.log("✅ Bitti.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
