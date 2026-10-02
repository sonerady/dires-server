// 🌐 Yerelleştirilmiş banner taşma kontrolü (30 Eyl 2026). Her şablonu verilen dilde (localizeTemplates, DB'siz)
// çizip İngilizce hâliyle karşılaştırır; yalnız çeviriyle GELEN sorunları raporlar:
//   OUT  = yazı çerçevenin dışına taşıyor · CUT = yazı kendi kutusuna sığmıyor (taşma gizli/kesik)
//   node scripts/banner-templates/lint-locales.js de,fr [--ratios 0.5625,1] [--ids a,b] [--pages 6] [--out file.json]
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { TEMPLATES, PLACEHOLDER } = require("../../src/data/bannerTemplates");
const { localizeTemplates } = require("../../src/data/bannerTemplates/localize");

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LANGS = (args[0] || "").split(",").filter(Boolean);
const RATIOS = opt("--ratios", "0.5625,1,1.5").split(",").map(Number);
const IDS = opt("--ids", "") ? opt("--ids").split(",") : null;
const PAGES = Number(opt("--pages", 6));
const OUT_FILE = opt("--out", null);
const ROOT = path.join(__dirname, "../../..");

const MEASURE = () => {
  const W = innerWidth, H = innerHeight, res = { out: [], cut: [] };
  const els = [...document.querySelectorAll("body *")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (p.classList.contains("banner")) return false; if (getComputedStyle(p).overflow === "hidden") return true; } return false; };
  for (const el of els) {
    const r = el.getBoundingClientRect(), label = el.textContent.trim().slice(0, 30);
    if (!clipped(el) && (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2)) res.out.push(label);
    const cs = getComputedStyle(el);
    if ((cs.overflow === "hidden" || cs.textOverflow === "ellipsis") && (el.scrollWidth > el.clientWidth + 3 || el.scrollHeight > el.clientHeight + 3)) res.cut.push(label);
  }
  return res;
};

(async () => {
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars"] });
  const jpg = await sharp(path.join(ROOT, "client/assets/film_lab_sample.jpg")).resize(900).jpeg({ quality: 80 }).toBuffer();
  const photo = `data:image/jpeg;base64,${jpg.toString("base64")}`;
  const targets = TEMPLATES.filter((t) => !IDS || IDS.includes(t.id));
  const pages = await Promise.all(Array.from({ length: PAGES }, () => browser.newPage()));
  const measure = async (page, html, ar) => {
    const w = ar >= 1 ? 1080 : Math.round(1080 * ar), h = ar >= 1 ? Math.round(1080 / ar) : 1080;
    await page.setViewport({ width: w, height: h });
    await page.setContent(html.split(PLACEHOLDER).join(photo), { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    return page.evaluate(MEASURE);
  };
  const baseline = new Map();
  const report = {};
  for (const lang of ["en", ...LANGS]) {
    const localized = await localizeTemplates(targets, lang, { animated: false });
    const queue = localized.map((t) => t);
    const found = [];
    await Promise.all(pages.map(async (page) => {
      while (queue.length) {
        const t = queue.shift();
        for (const ar of RATIOS) {
          let m;
          try { m = await measure(page, t.html, ar); } catch (e) { continue; }
          const key = `${t.id}@${ar}`;
          if (lang === "en") { baseline.set(key, m); continue; }
          const b = baseline.get(key) || { out: [], cut: [] };
          const extraOut = m.out.length - b.out.length, extraCut = m.cut.length - b.cut.length;
          if (extraOut > 0 || extraCut > 0) found.push({ id: t.id, ratio: ar, out: extraOut > 0 ? m.out : [], cut: extraCut > 0 ? m.cut : [] });
        }
      }
    }));
    if (lang !== "en") {
      report[lang] = found;
      const ids = new Set(found.map((f) => f.id));
      console.log(`${lang}: ${ids.size} template(s) with new overflow${ids.size ? " — " + [...ids].slice(0, 12).join(", ") + (ids.size > 12 ? "…" : "") : ""}`);
    }
  }
  if (OUT_FILE) fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
