// 🧩 Banner şablon galerisi — araçlar (şablonların tek kaynağı: server/src/data/bannerTemplates/*.html)
//
//   node scripts/banner-templates/build.js preview [--photo a.jpg,b.webp] [--files x.html,y.html] [id...]
//        → her şablonu her fotoğrafla, FOTOĞRAFIN ORANINDA render eder ($OUT, varsayılan /tmp/banner-templates)
//          (şablonlar oran-duyarlı: uzun / kare / geniş fotoğrafa göre yerleşim değişir)
//   node scripts/banner-templates/build.js upload   → varsayılan örnek fotoğrafı Supabase'e yükler
//   node scripts/banner-templates/build.js client   → yalnız şablon kimliklerini istemciye yazar;
//          banner HTML'i ve yerelleştirilmiş adlar daima sunucudan gelir
//   node scripts/banner-templates/build.js lint [--files x.html,y.html] [id...]
//        → 4 oranda (9:16, 3:4, 1:1, 3:2) taşan / kesilen yazıları ve çakışan yazı kutularını raporlar
//   node scripts/banner-templates/build.js video [--photo a.jpg] --files animated/x.html
//        → animasyonlu (loop) şablonu Banner Stüdyosu'nun video hattıyla MP4'e çevirir ($OUT/<id>_<n>.mp4)
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { renderBannerScreenshot, renderBannerVideo } = require("../../src/utils/bannerVideoRenderer");
const { TEMPLATES, PLACEHOLDER, readRaw, sampleImageUrl, SAMPLE_OBJECT } = require("../../src/data/bannerTemplates");

const ROOT = path.join(__dirname, "../../..");
// Film Lab'ın örnek fotoğrafı (kullanıcı isteği, 25 Eyl 2026: "filtre ekranındaki ürün resmi olsun")
const DEFAULT_PHOTO = path.join(ROOT, "client/assets/film_lab_sample.jpg");
const OUT = process.env.OUT || "/tmp/banner-templates";

const toJpeg = (file) => sharp(file).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift() || "preview";

  if (mode === "client") {
    // Only metadata is bundled for deep links. All visible HTML/copy comes from the server.
    const BUNDLED = TEMPLATES;
    const lines = [
      "// ⚠️ ÜRETİLMİŞ DOSYA — elle düzenleme. Kaynak: server/src/data/bannerTemplates/manifest.json",
      "// Yeniden üret: cd server && node scripts/banner-templates/build.js client",
      `export const BANNER_TEMPLATE_LIST = ${JSON.stringify(BUNDLED.map((t) => ({ id: t.id })))};`,
      "",
    ];
    const target = path.join(ROOT, "client/bannerGallery/bannerTemplateManifest.js");
    fs.writeFileSync(target, lines.join("\n"));
    console.log(`✓ ${path.relative(ROOT, target)} (${BUNDLED.length} kimlik)`);
    return;
  }

  if (mode === "upload") {
    const { createClient } = require("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.storage.from("images").upload(SAMPLE_OBJECT, await toJpeg(DEFAULT_PHOTO), { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
    console.log(error ? `✗ ${error.message}` : `✓ ${sampleImageUrl()}`);
    return;
  }

  // --files: templates that are not in the manifest yet (a new batch being designed)
  let list = null;
  const fi = args.indexOf("--files");
  if (fi >= 0) {
    list = args[fi + 1].split(",").map((f) => {
      const file = path.resolve(process.cwd(), f);
      return { id: path.basename(file, ".html"), raw: fs.readFileSync(file, "utf8") };
    });
    args.splice(fi, 2);
  }
  const rawOf = (t) => t.raw || readRaw(t);

  if (mode === "lint") {
    const targets = list || TEMPLATES.filter((t) => !args.length || args.includes(t.id));
    const puppeteer = require("puppeteer-core");
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars"] });
    const photo = `data:image/jpeg;base64,${(await toJpeg(DEFAULT_PHOTO)).toString("base64")}`;
    let problems = 0;
    for (const t of targets) {
      for (const ar of [9 / 16, 3 / 4, 1, 3 / 2]) {
        const page = await browser.newPage();
        const w = ar >= 1 ? 1080 : Math.round(1080 * ar);
        const h = ar >= 1 ? Math.round(1080 / ar) : 1080;
        await page.setViewport({ width: w, height: h });
        await page.setContent(rawOf(t).split(PLACEHOLDER).join(photo), { waitUntil: "networkidle0", timeout: 60000 });
        // animated templates: measure the rest pose (t = 0), not wherever the loop happened to be
        await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = 0; } catch (e) {} }));
        const issues = await page.evaluate(() => {
          const W = innerWidth, H = innerHeight, out = [];
          const texts = [...document.querySelectorAll("body *")].filter((el) => {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
            return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          });
          // clipped by an ancestor that hides overflow on purpose (e.g. a ticker) → not a problem
          const clippedOnPurpose = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (p.classList.contains("banner")) return false; if (getComputedStyle(p).overflow === "hidden") return true; } return false; };
          const boxes = texts.map((el) => ({ el, r: el.getBoundingClientRect(), label: (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '"' }));
          for (const b of boxes) {
            if (clippedOnPurpose(b.el)) continue;
            if (b.r.left < -2 || b.r.top < -2 || b.r.right > W + 2 || b.r.bottom > H + 2) out.push("OUT " + b.label);
          }
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (ix > 4 && iy > 4) {
              const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height) || 1;
              if ((ix * iy) / small > 0.15) out.push("HIT " + a.label + " × " + b.label);
            }
          }
          return out;
        });
        await page.close();
        if (issues.length) { problems += issues.length; console.log(`✗ ${t.id} @${ar.toFixed(2)}\n   ` + issues.slice(0, 8).join("\n   ")); }
      }
      console.log(`· ${t.id} checked`);
    }
    await browser.close();
    console.log(problems ? `${problems} sorun` : "✓ temiz");
    return;
  }

  let photos = [DEFAULT_PHOTO];
  const pi = args.indexOf("--photo");
  if (pi >= 0) {
    photos = args[pi + 1].split(",").map((p) => path.resolve(ROOT, p));
    args.splice(pi, 2);
  }
  if (!list) list = TEMPLATES.filter((t) => !args.length || args.includes(t.id));
  fs.mkdirSync(OUT, { recursive: true });
  for (const [pIndex, file] of photos.entries()) {
    const jpeg = await toJpeg(file);
    const { width, height } = await sharp(jpeg).metadata();
    const photo = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    // sırayla — çok sayıda Chrome'u aynı anda açmak setContent zaman aşımına düşürüyor
    for (const t of list) {
      if (mode === "video") {
        // FAST=1 → quick check render (20 fps, 720 px) while designing
        const fast = process.env.FAST ? { fps: 20, longEdge: 720, workers: 1 } : {};
        const video = await renderBannerVideo(rawOf(t).split(PLACEHOLDER).join(photo), width / height, fast);
        fs.copyFileSync(video.filePath, path.join(OUT, `${t.id}_${pIndex}.mp4`));
        video.cleanup();
        console.log(`✓ ${t.id}_${pIndex}.mp4 (${video.durationSeconds}s, ar ${(width / height).toFixed(2)})`);
        continue;
      }
      const shot = await renderBannerScreenshot(rawOf(t).split(PLACEHOLDER).join(photo), width / height);
      fs.writeFileSync(path.join(OUT, `${t.id}_${pIndex}.jpg`), shot);
      console.log(`✓ ${t.id}_${pIndex} (ar ${(width / height).toFixed(2)})`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
