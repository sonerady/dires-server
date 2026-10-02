// 🧩 Görselin Çevresini Genişlet — tuval, istem ve bitirme (orijinali geri koyma) testleri (30 Eyl 2026).
// Sahne analitik bir fonksiyon: "gerçek" genişletilmiş kare ve modelin olası sapmaları (uzaklaştırma, kayma,
// farklı boyut/oran, alakasız çıktı) birebir üretilebiliyor.
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  parseCanvasPlacement,
  prepareExpandCanvas,
  canvasPromptTool,
  canvasPromptValues,
  buildExpandCanvasPrompt,
  estimatePlacement,
  normalizeToCanvas,
  featherAlpha,
  featherPx,
  compositeOriginal,
  finishExpandResult,
} = require("../src/utils/expandCanvas");
const { getTool, validateOptions, buildPrompt } = require("../src/utils/studioTools");

const W = 360;
const H = 640;
const PLACEMENT = { x: 0.05, y: 0.1, w: 0.9, h: 0.9 }; // kırmızı elbise vakası: üst + yanlar açık, alt tuval kenarında

/** Dokulu, tekrarsız analitik sahne (tuval koordinatında) */
function scene(x, y) {
  const r = 128 + 55 * Math.sin(x / 7.3 + y / 11.1) + 35 * Math.cos(x / 19.7 - y / 5.3) + 25 * Math.sin(Math.hypot(x - 140, y - 260) / 9);
  const g = 120 + 50 * Math.cos(x / 13.9 + y / 6.1) + 40 * Math.sin((x * 0.6 - y) / 17.3) + 20 * Math.cos(Math.hypot(x - 260, y - 120) / 7);
  const b = 110 + 45 * Math.sin(x / 5.9 - y / 23.7) + 45 * Math.cos((x + y) / 29.1) + 25 * Math.sin(Math.hypot(x - 60, y - 520) / 11);
  return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))));
}

/** q = c' + s(p − c) ile görülen kare: çıktı pikseli q, sahne noktası p = c + (q − c')/s gösterir */
async function renderView({ width = W, height = H, rect, scale = 1, dx = 0, dy = 0, fx = (v) => v } = {}) {
  const data = Buffer.alloc(width * height * 3);
  const cx = rect ? rect.left + rect.width / 2 : width / 2;
  const cy = rect ? rect.top + rect.height / 2 : height / 2;
  const kx = W / width, ky = H / height; // çıktı başka boyuttaysa aynı kareyi o boyutta örnekle
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const qx = (i + 0.5) * kx, qy = (j + 0.5) * ky;
      const px = cx + (qx - (cx + dx)) / scale, py = cy + (qy - (cy + dy)) / scale;
      const [r, g, b] = scene(px, py);
      const o = (j * width + i) * 3;
      data[o] = fx(r); data[o + 1] = fx(g); data[o + 2] = fx(b);
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function renderRect(rect) {
  const data = Buffer.alloc(rect.width * rect.height * 3);
  for (let j = 0; j < rect.height; j++) {
    for (let i = 0; i < rect.width; i++) {
      const [r, g, b] = scene(rect.left + i + 0.5, rect.top + j + 0.5);
      const o = (j * rect.width + i) * 3;
      data[o] = r; data[o + 1] = g; data[o + 2] = b;
    }
  }
  return sharp(data, { raw: { width: rect.width, height: rect.height, channels: 3 } }).png().toBuffer();
}

async function prepared() {
  const rect = { left: Math.round(PLACEMENT.x * W), top: Math.round(PLACEMENT.y * H), width: Math.round(PLACEMENT.w * W), height: Math.round(PLACEMENT.h * H) };
  const photoSource = await renderRect(rect);
  const prep = await prepareExpandCanvas(photoSource, PLACEMENT, W, H);
  return { ...prep, W, H };
}

const raw = async (buffer) => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });

/** Dikdörtgenin açık kenarlardan `feather` kadar içerisi (orijinalle birebir aynı olmalı) */
function interior(rect, feather) {
  const left = rect.left + (rect.left > 0 ? feather : 0);
  const top = rect.top + (rect.top > 0 ? feather : 0);
  const right = rect.left + rect.width - (rect.left + rect.width < W ? feather : 0);
  const bottom = rect.top + rect.height - (rect.top + rect.height < H ? feather : 0);
  return { left, top, width: right - left, height: bottom - top };
}

async function assertInteriorIdentical(resultPng, prep, feather) {
  const box = interior(prep.rect, feather);
  const a = await sharp(resultPng).extract(box).removeAlpha().raw().toBuffer();
  const b = await sharp(prep.photo).extract({ left: box.left - prep.rect.left, top: box.top - prep.rect.top, width: box.width, height: box.height }).removeAlpha().raw().toBuffer();
  assert.equal(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assert.equal(diff, 0, `orijinal alanda ${diff} farklı kanal değeri`);
}

/** Dikdörtgenin dışındaki dikiş şeridinde (en çok `band` px) gerçek sahneye ortalama mutlak hata */
async function seamBandError(resultPng, rect, band = 24) {
  const { data } = await raw(resultPng);
  const truth = await raw(await renderView({ rect }));
  let sum = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height;
      if (inside) continue;
      const dist = Math.max(rect.left - x - 1, x - (rect.left + rect.width), rect.top - y - 1, y - (rect.top + rect.height));
      if (dist >= band) continue;
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) { sum += Math.abs(data[i + c] - truth.data[i + c]); n++; }
    }
  }
  return sum / n;
}

test("parseCanvasPlacement: geçerli yerleşim döner, geçersizi ve tam kaplayanı reddeder", () => {
  assert.deepEqual(parseCanvasPlacement({ x: 0.05, y: 0.1, w: 0.9, h: 0.9 }), { x: 0.05, y: 0.1, w: 0.9, h: 0.9 });
  assert.equal(parseCanvasPlacement(null), null);
  assert.equal(parseCanvasPlacement({ x: 0, y: 0, w: 1, h: 1 }), null);
  assert.equal(parseCanvasPlacement({ x: "a", y: 0, w: 0.5, h: 0.5 }), null);
  assert.equal(parseCanvasPlacement({ x: 0.6, y: 0, w: 0.5, h: 0.5 }), null);
});

test("prepareExpandCanvas: fotoğraf tam yerinde, maske kutbu doğru (doldur = alfa 0 + beyaz, koru = opak siyah)", async () => {
  const prep = await prepared();
  assert.deepEqual(prep.rect, { left: 18, top: 64, width: 324, height: 576 });
  // tuvalin dikdörtgeni = fotoğraf
  const inCanvas = await sharp(prep.canvas).extract(prep.rect).removeAlpha().raw().toBuffer();
  const photo = await sharp(prep.photo).removeAlpha().raw().toBuffer();
  assert.ok(inCanvas.equals(photo), "tuvaldeki fotoğraf alanı fotoğrafla aynı olmalı");
  const { data, info } = await sharp(prep.mask).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(info.width, W);
  assert.equal(info.height, H);
  const px = (x, y) => Array.from(data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
  assert.deepEqual(px(5, 5), [255, 255, 255, 0], "yeni alan: saydam + beyaz");
  assert.deepEqual(px(W / 2, H / 2), [0, 0, 0, 255], "fotoğraf: opak siyah");
  const inset = Math.round(Math.min(W, H) * 0.012);
  assert.equal(px(prep.rect.left + 1, H / 2)[3], 0, "açık kenarda dikiş payı düzenlenebilir");
  assert.equal(px(prep.rect.left + inset + 1, H / 2)[3], 255);
  assert.equal(px(W / 2, H - 1)[3], 255, "tuval kenarına değen (kapalı) alt kenarda pay yok");
});

test("featherAlpha: açık kenarda yumuşak iniş, kapalı kenar sert, iç kısım tam opak", () => {
  const rect = { left: 18, top: 64, width: 324, height: 576 };
  const feather = featherPx(W, H);
  assert.ok(feather >= 8 && feather <= 16);
  const alpha = featherAlpha(rect, W, H, feather);
  const at = (x, y) => alpha[y * rect.width + x];
  assert.equal(at(rect.width / 2, rect.height / 2), 255);
  assert.ok(at(0, rect.height / 2) < 16, "sol (açık) kenar neredeyse saydam");
  assert.ok(at(rect.width / 2, 0) < 16, "üst (açık) kenar neredeyse saydam");
  assert.equal(at(rect.width / 2, rect.height - 1), 255, "alt (kapalı) kenar tam opak");
  assert.equal(at(feather, rect.height / 2), 255, "yumuşak geçiş `feather` px'te biter");
  for (let x = 1; x < feather; x++) assert.ok(at(x, rect.height / 2) >= at(x - 1, rect.height / 2), "rampa artan");
});

test("compositeOriginal: dikdörtgenin içi (geçiş şeridi hariç) orijinalle birebir, dışı tabanla aynı", async () => {
  const prep = await prepared();
  const feather = featherPx(W, H);
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 10, g: 200, b: 30 } } }).raw().toBuffer({ resolveWithObject: true });
  const png = await compositeOriginal({ data: base.data, raw: base.info }, prep.photo, prep.rect, W, H, feather);
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, W);
  assert.equal(meta.height, H);
  assert.equal(meta.channels, 3);
  await assertInteriorIdentical(png, prep, feather);
  const { data } = await raw(png);
  assert.deepEqual(Array.from(data.subarray(((5 * W) + 5) * 3, ((5 * W) + 5) * 3 + 3)), [10, 200, 30]);
});

test("finishExpandResult: model fotoğrafı yerinde tuttuysa çıktı bükülmez, orijinal geri konur", async () => {
  const prep = await prepared();
  // yeniden çizim benzetimi: gerçek sahne + hafif ton kayması
  const model = await renderView({ rect: prep.rect, fx: (v) => Math.min(255, v + 2) });
  const { buffer, meta } = await finishExpandResult(model, prep);
  assert.equal(meta.alignment, "aligned");
  assert.ok(Math.abs(meta.scale - 1) < 0.004, `ölçek ${meta.scale}`);
  await assertInteriorIdentical(buffer, prep, meta.feather);
  assert.ok((await seamBandError(buffer, prep.rect)) < 4);
});

test("finishExpandResult: 30 Eyl hatası — model sahneyi 0,85× uzaklaştırıp kaydırdı → hizalanır, dikiş tutar", async () => {
  const prep = await prepared();
  const truth = { scale: 0.85, dx: 14, dy: -40 };
  const model = await renderView({ rect: prep.rect, ...truth });
  const before = await seamBandError(await compositeOriginal(await raw(model).then(({ data, info }) => ({ data, raw: info })), prep.photo, prep.rect, W, H), prep.rect);
  const { buffer, meta } = await finishExpandResult(model, prep);
  assert.equal(meta.alignment, "warped");
  assert.ok(Math.abs(meta.scale - truth.scale) < 0.01, `ölçek ${meta.scale}`);
  assert.ok(Math.abs(meta.dx - truth.dx) < 1.5 && Math.abs(meta.dy - truth.dy) < 1.5, `kayma ${meta.dx},${meta.dy}`);
  await assertInteriorIdentical(buffer, prep, meta.feather);
  const after = await seamBandError(buffer, prep.rect);
  assert.ok(after < 8, `hizalı dikiş hatası ${after.toFixed(1)}`);
  assert.ok(before > after * 3, `hizalamasız geri yapıştırma (${before.toFixed(1)}) çok daha kötü olmalı`);
});

test("finishExpandResult: çıktı farklı boyutta (aynı oran) → tuvale ölçeklenir, orijinal geri konur", async () => {
  const prep = await prepared();
  const model = await renderView({ rect: prep.rect, width: 270, height: 480 });
  const { buffer, meta } = await finishExpandResult(model, prep);
  assert.equal(meta.resized, true);
  assert.deepEqual(meta.source, { width: 270, height: 480 });
  const out = await sharp(buffer).metadata();
  assert.equal(out.width, W);
  assert.equal(out.height, H);
  assert.notEqual(meta.alignment, "unaligned");
  await assertInteriorIdentical(buffer, prep, meta.feather);
});

test("finishExpandResult: çıktı farklı oranda (kare) → tuval boyutuna getirilir, orijinal yine birebir", async () => {
  const prep = await prepared();
  const model = await renderView({ rect: prep.rect, width: 400, height: 400 });
  const { buffer, meta } = await finishExpandResult(model, prep);
  assert.equal(meta.resized, true);
  assert.ok(["cover", "fill"].includes(meta.fit));
  const out = await sharp(buffer).metadata();
  assert.equal(out.width, W);
  assert.equal(out.height, H);
  await assertInteriorIdentical(buffer, prep, meta.feather);
});

test("finishExpandResult: alakasız çıktı → bükme/inceltme yok ama orijinal alan yine birebir", async () => {
  const prep = await prepared();
  const noise = Buffer.alloc(W * H * 3);
  let seed = 7;
  for (let i = 0; i < noise.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise[i] = seed >> 23; }
  const model = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).blur(3).png().toBuffer();
  const { buffer, meta } = await finishExpandResult(model, prep);
  assert.equal(meta.alignment, "unaligned");
  assert.equal(meta.seams, null);
  await assertInteriorIdentical(buffer, prep, meta.feather);
});

test("estimatePlacement: alt-piksel kayma ve ölçek tahmini", async () => {
  const prep = await prepared();
  const model = await renderView({ rect: prep.rect, dx: 6.5, dy: -3 });
  const { candidates } = await normalizeToCanvas(model, W, H);
  const orig = await raw(prep.canvas);
  const est = await estimatePlacement(candidates[0], { data: orig.data, raw: orig.info }, prep.photo, prep.rect, W, H);
  assert.ok(Math.abs(est.scale - 1) < 0.004, `ölçek ${est.scale}`);
  assert.ok(Math.abs(est.dx - 6.5) < 1 && Math.abs(est.dy + 3) < 1, `kayma ${est.dx},${est.dy}`);
  assert.ok(est.ncc > 0.95 && est.ncc > est.nccIdentity);
});

test("tuval istemi: geometri açık, uzaklaştırma yasak; 'ortala/her yöne eşit' ve 'dışa genişlet' satırları yok", () => {
  const tool = getTool("smart-canvas-expansion");
  const options = validateOptions(tool, {});
  assert.equal(options.values.position, "center");
  assert.equal(canvasPromptValues(options.values).position, undefined);
  const rect = { left: 72, top: 256, width: 1296, height: 2304 };
  const base = buildPrompt(canvasPromptTool(tool), { values: canvasPromptValues(options.values), texts: options.texts, variantIndex: 1, variantTotal: 2 });
  const prompt = buildExpandCanvasPrompt(base, rect, 1440, 2560);
  assert.match(prompt, /^CANVAS MODE/);
  assert.match(prompt, /x 72–1368 px, y 256–2560 px/);
  assert.match(prompt, /a 256 px band along the top/);
  assert.match(prompt, /a 72 px band along the left/);
  assert.match(prompt, /touches the bottom edge of the frame — add nothing beyond it/);
  assert.match(prompt, /do NOT zoom out/);
  assert.ok(prompt.includes(base), "araç istemi (seçenekler, varyasyon, kurallar) aynen korunur");
  assert.doesNotMatch(prompt, /extend evenly on all sides/);
  assert.doesNotMatch(prompt, /Expand the canvas outward/);
  assert.match(buildPrompt(tool, { values: options.values }), /Expand the canvas outward/, "araç tanımının kendisi değişmez");
});
