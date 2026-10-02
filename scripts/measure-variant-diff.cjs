#!/usr/bin/env node
// 📏 Varyasyon farkı ölçümü (30 Eyl 2026)
//
// İki (veya daha fazla) görsel arasındaki normalize ortalama piksel farkını ölçer.
// Ürün Stüdyosu araçlarının 2+ varyasyonu birbirinin kopyası mı, yoksa satıcı gerçekten
// farklı kareler mi alıyor — bunu sayıya döker.
//
//   node scripts/measure-variant-diff.cjs a.jpg b.jpg              → tek çift
//   node scripts/measure-variant-diff.cjs a.jpg b.jpg c.jpg        → tüm çiftler
//   node scripts/measure-variant-diff.cjs --dir <klasör> [--tag gpt] → <id>__<tag>_v1 / _v2 çiftleri
//   seçenekler: --size 64 (karşılaştırma küçük görselinin uzun kenarı) · --json
//
// Ölçü: iki görsel beyaza düzlenir, sRGB'ye çevrilir, AYNI küçük tuvale (ilk görselin oranı,
// uzun kenar 64 px, fit "fill") indirilir; tüm RGB örneklerinin mutlak farkının ortalaması
// 255'e bölünür → 0 (aynı) … 1. Küçültme alçak geçiren süzgeç gibi davranır: JPEG gürültüsü ve
// küçük yeniden çizimler az, kadraj/açı/yerleşim/ışık değişimi çok sayılır.
//
// Kaba ölçek (30 Eyl 14 araç testi, 64 px): GPT 2.5 eski varyantları 0,142 · NB Pro 0,198 (raporlanan ≈0,14 / ≈0,20).
// < 0,10 neredeyse kopya · 0,10–0,15 zayıf fark · ≥ 0,18 açıkça farklı kare.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DEFAULT_SIZE = 64;

async function load(input) {
  if (Buffer.isBuffer(input)) return input;
  const source = String(input);
  if (/^https?:\/\//i.test(source)) {
    const axios = require("axios");
    const response = await axios.get(source, { responseType: "arraybuffer", timeout: 120000, maxContentLength: 100 * 1024 * 1024 });
    return Buffer.from(response.data);
  }
  return fs.promises.readFile(source);
}

async function toRaw(buffer, width, height) {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColorspace("srgb")
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/**
 * Normalize ortalama piksel farkı (0 = aynı, 1 = en uç fark).
 * @param {Buffer|string} a  dosya yolu, URL veya Buffer
 * @param {Buffer|string} b
 * @param {{ size?: number }} [options]  karşılaştırma tuvalinin uzun kenarı
 * @returns {Promise<{ diff: number, width: number, height: number }>}
 */
async function meanPixelDiff(a, b, { size = DEFAULT_SIZE } = {}) {
  const [bufferA, bufferB] = await Promise.all([load(a), load(b)]);
  const meta = await sharp(bufferA, { failOn: "none" }).rotate().metadata();
  const longSide = Math.max(8, Math.floor(Number(size) || DEFAULT_SIZE));
  const w0 = meta.autoOrient?.width || meta.width || longSide;
  const h0 = meta.autoOrient?.height || meta.height || longSide;
  const scale = longSide / Math.max(w0, h0);
  const width = Math.max(1, Math.round(w0 * scale));
  const height = Math.max(1, Math.round(h0 * scale));
  const [rawA, rawB] = await Promise.all([toRaw(bufferA, width, height), toRaw(bufferB, width, height)]);
  if (rawA.info.channels !== 3 || rawB.info.channels !== 3 || rawA.data.length !== rawB.data.length) {
    throw new Error("unexpected raw layout");
  }
  let total = 0;
  for (let i = 0; i < rawA.data.length; i++) total += Math.abs(rawA.data[i] - rawB.data[i]);
  return { diff: total / (rawA.data.length * 255), width, height };
}

function parseArgs(argv) {
  const args = { files: [], size: DEFAULT_SIZE, json: false, dir: null, tag: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--size") args.size = Number(argv[++i]);
    else if (value === "--json") args.json = true;
    else if (value === "--dir") args.dir = argv[++i];
    else if (value === "--tag") args.tag = argv[++i];
    else if (value === "-h" || value === "--help") args.help = true;
    else args.files.push(value);
  }
  return args;
}

/** --dir: "<id>__<tag>_v1.<ext>" ile "<id>__<tag>_v2.<ext>" dosyalarını eşleştirir. */
function dirPairs(dir, tag) {
  const files = fs.readdirSync(dir);
  const pairs = [];
  for (const file of files) {
    const match = /^(.+?)__(.+?)_v1\.(jpe?g|png|webp)$/i.exec(file);
    if (!match || (tag && match[2] !== tag)) continue;
    const partner = files.find((other) => other.toLowerCase() === `${match[1]}__${match[2]}_v2.${match[3]}`.toLowerCase());
    if (partner) pairs.push({ label: `${match[1]} · ${match[2]}`, group: match[2], a: path.join(dir, file), b: path.join(dir, partner) });
  }
  return pairs.sort((x, y) => x.label.localeCompare(y.label));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.dir && args.files.length < 2)) {
    console.log("usage: measure-variant-diff.cjs <a> <b> [c …] [--size 64] [--json]\n       measure-variant-diff.cjs --dir <folder> [--tag gpt] [--size 64] [--json]");
    process.exit(args.help ? 0 : 1);
  }
  const pairs = args.dir
    ? dirPairs(args.dir, args.tag)
    : args.files.flatMap((a, i) => args.files.slice(i + 1).map((b) => ({ label: `${path.basename(a)} ↔ ${path.basename(b)}`, a, b })));
  const rows = [];
  for (const pair of pairs) {
    const { diff } = await meanPixelDiff(pair.a, pair.b, { size: args.size });
    rows.push({ ...pair, diff: Number(diff.toFixed(4)) });
  }
  const groups = {};
  for (const row of rows) (groups[row.group || "all"] ||= []).push(row.diff);
  const summary = Object.fromEntries(
    Object.entries(groups).map(([group, values]) => [group, { pairs: values.length, mean: Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(4)), min: Math.min(...values), max: Math.max(...values) }]),
  );
  if (args.json) {
    console.log(JSON.stringify({ size: args.size, rows: rows.map(({ label, a, b, diff }) => ({ label, a, b, diff })), summary }, null, 1));
    return;
  }
  for (const row of rows) console.log(`${row.diff.toFixed(4)}  ${row.label}`);
  if (rows.length > 1) for (const [group, s] of Object.entries(summary)) console.log(`— ${group}: ${s.pairs} çift · ortalama ${s.mean.toFixed(4)} · min ${s.min.toFixed(4)} · max ${s.max.toFixed(4)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { meanPixelDiff, DEFAULT_SIZE };
