#!/usr/bin/env node
/**
 * 🎞️ EDITORIAL MODE — stil referans kolajlarını üretir.
 *
 * Ne yapar:
 *   1. client/assets/styles-images/ altındaki tüm görselleri okur
 *   2. Bunları 2 adet kolaj görselinde birleştirir (sharp)
 *   3. Her kolajın altına kendi kod plakasını basar ("EDITORIAL REFERENCE · CODE ER-1"),
 *      böylece prompt kolajlara konumla değil İSİMLE atıfta bulunabilir
 *   4. Supabase `reference` bucket'ına SABİT isimlerle yükler (upsert + sürüm parametresi)
 *   5. Her kolajı Gemini ile analiz eder (stil profillerindeki analizle aynı mantık)
 *   6. Sonucu server/src/config/editorialStyle.json dosyasına yazar
 *
 * Kullanım (proje kökünde — bağımlılıklar server/node_modules'ten çözülür):
 *   node server/scripts/build_editorial_style.js
 *   node server/scripts/build_editorial_style.js --skip-analysis
 *   node server/scripts/build_editorial_style.js --collages 3
 *
 * Gerekli env (server/.env okunur): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Analiz için ayrıca Gemini anahtarı (promptEnhanceProvider hangi anahtarı
 * kullanıyorsa o) gerekir; yoksa --skip-analysis ile çalıştırılabilir.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..", "..");
const SERVER_DIR = path.join(ROOT, "server");
require("dotenv").config({ path: path.join(SERVER_DIR, ".env") });

const SOURCE_DIR = path.join(ROOT, "client", "assets", "styles-images");
const OUT_DIR = path.join(SERVER_DIR, "src", "config");
const OUT_FILE = path.join(OUT_DIR, "editorialStyle.json");
const LOCAL_PREVIEW_DIR = path.join(ROOT, "outputs", "editorial-style");

const BUCKET = "reference";
const STORAGE_PREFIX = "editorial";

// Kolaj hücre ölçüleri — stil profili gridiyle aynı oranlar (4:5)
const CELL_W = 512;
const CELL_H = 640;
const GAP = 6;

const args = process.argv.slice(2);
const SKIP_ANALYSIS = args.includes("--skip-analysis");
const COLLAGE_COUNT = (() => {
  const i = args.indexOf("--collages");
  if (i === -1) return 2;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
})();

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|heic|heif)$/i;

// ─────────────────────────────────────────────────────────────
// Gemini analiz promptu — stil profilindeki STYLE_ANALYSIS_PROMPT'un
// editorial preset havuzuna uyarlanmış hâli. Buradaki en kritik fark:
// kolajda ONLARCA farklı çekim var; tek bir "marka stili" değil, bir
// TEKNİK REPERTUAR çıkarılmasını istiyoruz.
// ─────────────────────────────────────────────────────────────
const EDITORIAL_ANALYSIS_PROMPT = `You are a senior fashion-editorial art director and director of photography. The attached image is a COLLAGE of many separate professional fashion photographs. They are ONLY EXAMPLES of high-end editorial craft — a technique library, not blueprints, and they do NOT share one single brand look.

Write a compact but TECHNICALLY PRECISE "editorial technique repertoire" that an AI image model can draw from to make BRAND-NEW photographs look professionally art-directed. Describe the RANGE present in the collage, not one averaged style.

Cover, in confident cinematographer language with concrete estimates:
1. CAMERA TECHNIQUES — the range of focal lengths in mm and what each is used for (e.g. "35mm environmental full-body", "85mm compressed waist-up"), aperture/depth-of-field behaviours, camera heights and angles, lens character.
2. FRAMING & COMPOSITION — the recurring crop strategies (full-body, three-quarter, waist-up, tight editorial crop), negative space habits, centered vs rule-of-thirds, how the subject is placed in the frame.
3. LIGHTING RECIPES — the distinct lighting setups visible across the frames (hard direct sun, soft overcast, window light, single-source studio with deep falloff, rim/backlight, bounce fill…), how shadows behave on subject and background.
4. COLOR GRADE / PRESET CHARACTER — the grading families present: palettes, saturation, contrast curves, white-balance bias, film-stock-like character, grain/texture treatment.
5. SET & ENVIRONMENT FAMILIES — describe ONLY broad categories (urban street, seamless studio, interior, natural landscape…). NEVER name or describe a specific pictured street, building, shopfront, room or backdrop.
6. POSING & DIRECTION — the range of body language, weight distribution, gesture, gaze and movement-vs-stillness the photographer directs.
7. RETOUCH & FINISH — skin rendering, micro-contrast, sharpening character, highlight roll-off.

STRICT RULES:
- These are EXAMPLES ONLY. Locations, backgrounds and props are illustrative, never mandatory.
- NEVER mention one-off incidental objects from individual frames (motorcycle, scooter, parked car, bicycle, signage, specific chair, plant, graffiti, storefront details, etc.). They are coincidences of that shoot, NOT part of the craft.
- NEVER describe or reference any person's face, identity, ethnicity, body or recognizable features. The people in the collage are irrelevant and must never be reproduced.
- NEVER describe specific garments, products or accessories — only photographic craft.
- Write it as a REPERTOIRE to choose from ("the library includes…", "options range from…"), so a model can pick a different combination each time instead of averaging everything into one look.
- Prefer concrete numeric estimates over vague adjectives.
- Output PLAIN TEXT only, 220-340 words, numbered sections as above, no markdown.`;

// ─────────────────────────────────────────────────────────────

function listSourceImages() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Kaynak klasör yok: ${SOURCE_DIR}`);
  }
  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => IMAGE_EXT.test(f) && !f.startsWith("."))
    .sort();
  if (files.length === 0) {
    throw new Error(`Kaynak klasörde görsel bulunamadı: ${SOURCE_DIR}`);
  }
  return files.map((f) => path.join(SOURCE_DIR, f));
}

/** Görselleri sıra dışı bir düzende dağıtır ki her kolaj çeşitli olsun. */
function splitIntoGroups(items, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  items.forEach((item, i) => groups[i % groupCount].push(item));
  return groups.filter((g) => g.length > 0);
}

async function buildCollage(filePaths) {
  const cells = [];
  for (const p of filePaths) {
    try {
      const buf = await sharp(p)
        .rotate()
        .resize(CELL_W, CELL_H, { fit: "cover" })
        .jpeg({ quality: 88 })
        .toBuffer();
      cells.push(buf);
    } catch (err) {
      console.warn(`  ⚠️  atlandı: ${path.basename(p)} — ${err.message}`);
    }
  }
  if (cells.length === 0) throw new Error("Hiçbir kare işlenemedi");

  // Kareler kabaca kare bir düzene otursun
  const cols = Math.ceil(Math.sqrt(cells.length));
  const rows = Math.ceil(cells.length / cols);
  const W = cols * CELL_W + (cols + 1) * GAP;
  const H = rows * CELL_H + (rows + 1) * GAP;

  const composites = cells.map((input, i) => ({
    input,
    left: GAP + (i % cols) * (CELL_W + GAP),
    top: GAP + Math.floor(i / cols) * (CELL_H + GAP),
  }));

  const grid = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: grid, count: cells.length, cols, rows };
}


/**
 * Kolajın altına kod plakası basar — stil profilindeki plakayla AYNI görsel format
 * (koyu zemin + ortalanmış beyaz yazı), farklı kod. Prompt bu koda atıf yapıyor.
 *
 * Aynı format önemli: sunucudaki stripLeakedStylePlate, sonuca sızan plakayı bu
 * imzadan (koyu bant + içinde beyaz yazı) tanıyor.
 */
async function stampEditorialPlate(rawBuf, code) {
  const flattened = await sharp(rawBuf)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .toBuffer();

  const meta = await sharp(flattened).metadata();
  const SW = meta.width || 800;
  const SH = meta.height || 1200;

  const PLATE_H = Math.min(150, Math.max(80, Math.round(SH * 0.09)));
  const withPlate = await sharp(flattened)
    .extend({ bottom: PLATE_H, background: { r: 10, g: 10, b: 12 } })
    .toBuffer();

  const plateFont = Math.min(58, Math.max(30, Math.round(SW / 22)));
  const plateTextY = SH + Math.round(PLATE_H / 2) + Math.round(plateFont / 3);
  const plateSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH + PLATE_H}">
  <text x="${Math.round(SW / 2)}" y="${plateTextY}"
        text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-size="${plateFont}"
        font-weight="700"
        fill="#FFFFFF"
        letter-spacing="3">EDITORIAL REFERENCE · CODE ${code}</text>
</svg>
`);

  return sharp(withPlate)
    .composite([{ input: plateSvg, blend: "over" }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function uploadCollage(supabase, buffer, index) {
  const filePath = `${STORAGE_PREFIX}/editorial_style_grid_${index + 1}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(filePath, buffer, {
    contentType: "image/jpeg",
    upsert: true, // sabit isim — script tekrar çalıştırıldığında üzerine yazar
  });
  if (error) throw new Error(`Supabase upload hatası: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error("Public URL alınamadı");
  // Sabit dosya adı + CDN cache → yeniden üretimde eski görsel servis edilebilir.
  // Sürüm parametresi ile her build'de taze URL üretiyoruz.
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function analyzeCollage(publicUrl) {
  // Sunucudaki mevcut Gemini sağlayıcısını kullan — ayrı bir istemci kurmuyoruz.
  const { callGeminiFlash } = require(
    path.join(SERVER_DIR, "src", "utils", "promptEnhanceProvider.js"),
  );
  const text = await callGeminiFlash(EDITORIAL_ANALYSIS_PROMPT, [publicUrl], 3);
  return (text || "").trim();
}

async function main() {
  console.log("🎞️  EDITORIAL MODE — stil kolajları üretiliyor\n");

  const files = listSourceImages();
  console.log(`📁 Kaynak: ${SOURCE_DIR}`);
  console.log(`🖼️  ${files.length} görsel bulundu, ${COLLAGE_COUNT} kolaja bölünecek\n`);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (server/.env içinde aranır)",
    );
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  fs.mkdirSync(LOCAL_PREVIEW_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const groups = splitIntoGroups(files, COLLAGE_COUNT);
  const collages = [];

  for (let i = 0; i < groups.length; i++) {
    console.log(`\n── Kolaj ${i + 1}/${groups.length} (${groups[i].length} kare)`);
    const { buffer, count, cols, rows } = await buildCollage(groups[i]);
    console.log(`  ✓ grid ${cols}x${rows}, ${count} kare`);

    const code = `ER-${i + 1}`;
    const stamped = await stampEditorialPlate(buffer, code);
    console.log(`  ✓ kod plakası basıldı: ${code}`);

    const previewPath = path.join(LOCAL_PREVIEW_DIR, `editorial_style_grid_${i + 1}.jpg`);
    fs.writeFileSync(previewPath, stamped);
    console.log(`  ✓ yerel önizleme: ${path.relative(ROOT, previewPath)}`);

    const url = await uploadCollage(supabase, stamped, i);
    console.log(`  ✓ yüklendi: ${url}`);

    let analysis = "";
    if (!SKIP_ANALYSIS) {
      process.stdout.write("  … Gemini analizi");
      try {
        analysis = await analyzeCollage(url);
        console.log(` ✓ (${analysis.length} karakter)`);
      } catch (err) {
        console.log(` ✗ ${err.message}`);
        console.log("    (analiz olmadan devam ediliyor — sonra tekrar çalıştırabilirsin)");
      }
    }

    collages.push({ index: i + 1, code, url, frameCount: count, analysis });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceCount: files.length,
    collages,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(`\n✅ Tamam — ${path.relative(ROOT, OUT_FILE)} yazıldı`);
  console.log("   Sunucuyu yeniden başlatınca editorial mod bu kolajları kullanır.\n");
}

main().catch((err) => {
  console.error("\n❌ Hata:", err.message);
  process.exit(1);
});
