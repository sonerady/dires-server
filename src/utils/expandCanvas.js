// 🧩 Görselin Çevresini Genişlet — gerçek tuval (26 Eyl 2026, kullanıcı isteği: "oran butonları, tıklayınca karesi
// hazırlanıyor"). Uygulama fotoğrafın hedef tuvaldeki yerini { x, y, w, h } (0–1) gönderir. Burada:
//   1) prepareExpandCanvas: hedef boyutta tuval — fotoğraf TAM o yerde, boş alan fotoğrafın bulanık uzantısıyla
//      (renk/ışık ipucu) — ve maske (fotoğraf alanı korunur, boş alan saydam = doldurulacak) üretilir.
//   2) buildExpandCanvasPrompt: tuval modunun istemi — geometri açıkça yazılır; "ortada tut, her yöne eşit
//      genişlet" konum satırı ve aracın "tuvali dışa genişlet" yönü (model ikisini de "uzaklaş" diye okuyordu)
//      tuval modunda kullanılmaz.
//   3) finishExpandResult: model çıktısı tuvale oturtulur, orijinal fotoğraf dikişi yumuşatılarak geri konur.
//
// ⚠️ 30 Eyl 2026 hatası: GPT Image 2.5 maskeyi yalnız İPUCU sayar, kareyi baştan çizer. Kırmızı elbise testinde
// (foto 1296×2304 @72,256, tuval 1440×2560) sahneyi ~0,8× uzaklaştırıp ortalayarak yeniden kurdu — orijinal
// pikseller gitti, ayaklar kadraja girdi. 26 Eyl'de kapatılan "orijinali geri yapıştır" adımı da aynı nedenle
// dikişte kayma bırakıyordu: model fotoğrafı yerinde tutmayınca yapıştırılan orijinal çevresiyle hizasız kalır.
// Bitirme adımları:
//   a) çıktı tuval boyutuna getirilir (boyut/oran farklıysa),
//   b) modelin fotoğrafı NEREYE ve HANGİ ÖLÇEKTE çizdiği bulunur (ölçek + öteleme; kaba tarama + alt-piksel NCC),
//   c) model fotoğrafı sadık ama kaymış/ölçeklenmiş çizdiyse çıktı ters dönüşümle hizalanır,
//   d) her açık kenar boyunca kalan küçük yerel kayma (≤24 px) ölçülür, yeni alan kenardan uzaklaştıkça sönen bir
//      yer değiştirmeyle orijinale oturtulur; genel pozlama farkı tek bir ton kaydırmasıyla giderilir,
//   e) orijinal fotoğraf dikdörtgenine geri konur: yalnız yeni alana bakan kenarlarda 8–16 px yumuşak geçiş,
//      geri kalan her piksel orijinalin birebir aynısı.
const sharp = require("sharp");

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** { x, y, w, h } doğrulaması — geçersizse null */
function parseCanvasPlacement(raw) {
  if (!raw || typeof raw !== "object") return null;
  const p = { x: Number(raw.x), y: Number(raw.y), w: Number(raw.w), h: Number(raw.h) };
  if (![p.x, p.y, p.w, p.h].every(Number.isFinite)) return null;
  if (p.w < 0.08 || p.h < 0.08 || p.w > 1.001 || p.h > 1.001) return null;
  if (p.x < -0.001 || p.y < -0.001 || p.x + p.w > 1.002 || p.y + p.h > 1.002) return null;
  // fotoğraf tuvalin tamamını kaplıyorsa genişletecek alan yok
  if (p.w > 0.985 && p.h > 0.985) return null;
  return { x: clamp01(p.x), y: clamp01(p.y), w: Math.min(p.w, 1 - clamp01(p.x)), h: Math.min(p.h, 1 - clamp01(p.y)) };
}

function rectPx(placement, W, H) {
  const left = Math.round(placement.x * W), top = Math.round(placement.y * H);
  const width = Math.max(8, Math.min(W - left, Math.round(placement.w * W)));
  const height = Math.max(8, Math.min(H - top, Math.round(placement.h * H)));
  return { left, top, width, height };
}

/** Fotoğrafın hangi kenarları yeni alana bakıyor (tuval kenarına değen kenar kapalıdır) */
function openEdges(rect, W, H) {
  return { left: rect.left > 0, top: rect.top > 0, right: rect.left + rect.width < W, bottom: rect.top + rect.height < H };
}

/**
 * @returns {{ canvas: Buffer (PNG), mask: Buffer (PNG, alfa: 255 koru / 0 doldur), photo: Buffer (yerleşim boyutunda), rect }}
 */
async function prepareExpandCanvas(sourceBuffer, placement, W, H) {
  const rect = rectPx(placement, W, H);
  const src = sharp(sourceBuffer).rotate();
  const photo = await src.clone().resize(rect.width, rect.height, { fit: "cover" }).removeAlpha().png().toBuffer();
  // boş alan: fotoğrafın tuvali kaplayan bulanık, hafif soluk hâli — model için renk/ışık ipucu
  const ground = await src.clone().resize(W, H, { fit: "cover" }).removeAlpha().blur(Math.max(20, Math.round(Math.min(W, H) / 40)))
    .modulate({ brightness: 1.02, saturation: 0.85 }).png().toBuffer();
  const canvas = await sharp(ground).composite([{ input: photo, left: rect.left, top: rect.top }]).png().toBuffer();
  // maske: model fotoğrafın kenarından biraz içeriye kadar düzenleyebilsin (dikiş payı), gerisi korunsun
  const inset = Math.round(Math.min(W, H) * 0.012);
  const open = openEdges(rect, W, H);
  const keep = {
    left: rect.left + (open.left ? inset : 0),
    top: rect.top + (open.top ? inset : 0),
    right: rect.left + rect.width - (open.right ? inset : 0),
    bottom: rect.top + rect.height - (open.bottom ? inset : 0),
  };
  // Doldurulacak alan alfa 0 (OpenAI kuralı) VE beyaz (beyaz = düzenle kuralı): iki yorumda da aynı anlam.
  // Korunacak alan opak siyah. Baytlar elle yazılır — sharp bindirmesi saydam pikselin rengini sıfırlıyor.
  const maskRaw = Buffer.alloc(W * H * 4);
  for (let i = 0; i < maskRaw.length; i += 4) { maskRaw[i] = 255; maskRaw[i + 1] = 255; maskRaw[i + 2] = 255; }
  for (let y = Math.max(0, keep.top); y < Math.min(H, keep.bottom); y++) {
    maskRaw.fill(0, (y * W + Math.max(0, keep.left)) * 4, (y * W + Math.min(W, keep.right)) * 4);
    for (let x = Math.max(0, keep.left); x < Math.min(W, keep.right); x++) maskRaw[(y * W + x) * 4 + 3] = 255;
  }
  const mask = await sharp(maskRaw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return { canvas, mask, photo, rect };
}

// ─────────────────────────── istem ───────────────────────────

/** Tuval modunda aracın "tuvali dışa genişlet" yönünün yerine geçer (araç tanımına dokunulmaz). */
const CANVAS_DIRECTION = "Outpaint a prepared canvas. Image 1 is already the final, larger frame with the original photograph placed in it; only the blurred placeholder border around the photograph is new area. Keep the original photograph exactly as placed — same position, same size, same framing, every detail untouched — and paint only the placeholder so the scene continues seamlessly.";

/** Aracın tuval modundaki kopyası: yalnız `direction` değişir. */
const canvasPromptTool = (tool) => ({ ...tool, direction: CANVAS_DIRECTION });

/** Tuval yerleşimi "Ürün konumu" seçeneğinin yerini alır — "ortada tut, her yöne eşit genişlet" satırı çıkar. */
function canvasPromptValues(values = {}) {
  const { position, ...rest } = values;
  return rest;
}

/** Tuval istemi: geometri + kurallar başa (öncelikli), kısa kontrol sona; araç istemi arada aynen. */
function buildExpandCanvasPrompt(basePrompt, rect, W, H) {
  const sides = [["top", rect.top], ["bottom", H - rect.top - rect.height], ["left", rect.left], ["right", W - rect.left - rect.width]];
  const bands = sides.filter(([, px]) => px > 0).map(([side, px]) => `a ${px} px band along the ${side}`);
  const closed = sides.filter(([, px]) => px <= 0).map(([side]) => side);
  const lead = [
    "CANVAS MODE (this overrides any instruction below that conflicts with it):",
    `Image 1 is not a loose product reference to re-shoot — it is the final frame at its final size (${W}×${H} px). The original photograph already sits in its final place inside it: the rectangle x ${rect.left}–${rect.left + rect.width} px, y ${rect.top}–${rect.top + rect.height} px. Everything outside that rectangle is only a blurred colour placeholder and is transparent in the mask.`,
    `Your only job is to replace that placeholder with new, sharp, realistic content that continues the original scene outward: ${bands.join(", ")}.` +
      (closed.length ? ` The photograph already touches the ${closed.join(" and ")} edge${closed.length > 1 ? "s" : ""} of the frame — add nothing beyond ${closed.length > 1 ? "them" : "it"}.` : ""),
    "Keep the original photograph exactly where it is and at exactly the same size: do NOT zoom out, zoom in, re-frame, re-centre, shift, shrink, crop, mirror or re-shoot the scene, and do not redraw, move or resize the product, any person or anything else inside the rectangle. The result must look like the very same photo with more of its surroundings revealed around it.",
    "Continue horizon, perspective lines, surfaces, light direction, shadows, colour, grain and sharpness across the rectangle's edges so the joins are invisible.",
  ].join("\n");
  const tail = "FINAL CHECK: the original photograph stays pixel-aligned in its rectangle at the same scale; only the transparent (masked) placeholder area is newly painted.";
  return `${lead}\n\n${basePrompt}\n\n${tail}`;
}

// ─────────────────────────── ortak ───────────────────────────

/** Görseli tuval boyutunda ham sRGB'ye çevirir (alfa beyaza düzlenir). */
async function toRawRGB(input, W, H, fit = "fill") {
  let img = sharp(input, { limitInputPixels: 80_000_000 }).rotate();
  if (W && H) img = img.resize(W, H, { fit, position: "centre", kernel: "lanczos3" });
  const { data, info } = await img.flatten({ background: "#ffffff" }).removeAlpha().toColorspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { data, raw: { width: info.width, height: info.height, channels: info.channels } };
}

// ─────────────────────────── hizalama (model fotoğrafı nereye çizdi?) ───────────────────────────
// Dönüşüm: modelin çizdiği fotoğraf kopyasının merkezi = dikdörtgen merkezi + (dx, dy), boyutu = scale × dikdörtgen.
// Yani çıktıdaki q noktası ↔ tuvaldeki p: q = c + (dx, dy) + scale·(p − c).

/** Ayrılabilir yeniden örnekleme (küçültmede alan ortalaması, büyütmede doğrusal) — tek kanallı float */
function resampleGray(src, sw, sh, dw, dh) {
  const tmp = new Float32Array(dw * sh);
  const out = new Float32Array(dw * dh);
  const pass = (read, write, sLen, dLen, lines) => {
    const k = sLen / dLen;
    for (let line = 0; line < lines; line++) {
      for (let d = 0; d < dLen; d++) {
        if (k > 1) {
          const a = d * k, b = a + k;
          let acc = 0;
          for (let i = Math.floor(a); i < b && i < sLen; i++) acc += read(line, i) * (Math.min(b, i + 1) - Math.max(a, i));
          write(line, d, acc / k);
        } else {
          const x = (d + 0.5) * k - 0.5;
          const x0 = Math.max(0, Math.min(sLen - 1, Math.floor(x)));
          const x1 = Math.min(sLen - 1, x0 + 1);
          const t = Math.max(0, Math.min(1, x - x0));
          write(line, d, read(line, x0) * (1 - t) + read(line, x1) * t);
        }
      }
    }
  };
  pass((y, x) => src[y * sw + x], (y, x, v) => { tmp[y * dw + x] = v; }, sw, dw, sh);
  pass((x, y) => tmp[y * dw + x], (x, y, v) => { out[y * dw + x] = v; }, sh, dh, dw);
  return out;
}

/** Gri seviye (w×h); girdi kodlu görsel ya da { data, raw } olabilir */
async function grayLevel(input, w, h) {
  const img = input && input.raw ? sharp(input.data, { raw: input.raw }) : sharp(input);
  const { data } = await img.resize(w, h, { fit: "fill", kernel: "cubic" }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from(data);
}

function integral(img, w, h) {
  const W1 = w + 1;
  const s = new Float64Array(W1 * (h + 1));
  const s2 = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0, row2 = 0;
    for (let x = 0; x < w; x++) {
      const v = img[y * w + x];
      row += v; row2 += v * v;
      s[(y + 1) * W1 + x + 1] = s[y * W1 + x + 1] + row;
      s2[(y + 1) * W1 + x + 1] = s2[y * W1 + x + 1] + row2;
    }
  }
  return { s, s2, W1 };
}
const boxSum = (arr, W1, x0, y0, x1, y1) => arr[y1 * W1 + x1] - arr[y0 * W1 + x1] - arr[y1 * W1 + x0] + arr[y0 * W1 + x0];

/** Tam sayı konumlu NCC (kaba tarama); yalnız örtüşen kısım, örtüşme < minOverlap → -2 */
function nccPlaced(O, IO, ow, oh, T, IT, tw, th, px, py, minOverlap) {
  const u0 = Math.max(0, -px), v0 = Math.max(0, -py);
  const u1 = Math.min(tw, ow - px), v1 = Math.min(th, oh - py);
  if (u1 <= u0 || v1 <= v0) return -2;
  const n = (u1 - u0) * (v1 - v0);
  if (n < minOverlap * tw * th) return -2;
  const sT = boxSum(IT.s, IT.W1, u0, v0, u1, v1), sT2 = boxSum(IT.s2, IT.W1, u0, v0, u1, v1);
  const sO = boxSum(IO.s, IO.W1, u0 + px, v0 + py, u1 + px, v1 + py), sO2 = boxSum(IO.s2, IO.W1, u0 + px, v0 + py, u1 + px, v1 + py);
  let sOT = 0;
  for (let v = v0; v < v1; v++) {
    const to = v * tw, oo = (v + py) * ow + px;
    for (let u = u0; u < u1; u++) sOT += T[to + u] * O[oo + u];
  }
  const vO = sO2 - (sO * sO) / n, vT = sT2 - (sT * sT) / n;
  if (vO <= 1e-6 || vT <= 1e-6) return 0;
  return (sOT - (sO * sT) / n) / Math.sqrt(vO * vT);
}

/**
 * Ters-bükme NCC (alt-piksel): tuvaldeki fotoğrafın iç bölgesi (şablon; tuvalle AYNI örneklemeyle) ile çıktının
 * q = c' + s(p − c) noktasındaki çift doğrusal örneği karşılaştırılır. Kimlikte q = p → aynı ızgara.
 */
function nccWarped(lv, s, dx, dy, stride) {
  const { O, C, ow, oh, u0, u1, v0, v1, cx, cy } = lv;
  const qcx = cx + dx * lv.f, qcy = cy + dy * lv.f;
  let n = 0, total = 0, sP = 0, sP2 = 0, sO = 0, sO2 = 0, sPO = 0;
  for (let v = v0; v < v1; v += stride) {
    const qy = qcy + s * (v + 0.5 - cy) - 0.5;
    const y0 = Math.floor(qy);
    const fy = qy - y0;
    const rowOk = y0 >= 0 && y0 + 1 < oh;
    for (let u = u0; u < u1; u += stride) {
      total++;
      if (!rowOk) continue;
      const qx = qcx + s * (u + 0.5 - cx) - 0.5;
      const x0 = Math.floor(qx);
      if (x0 < 0 || x0 + 1 >= ow) continue;
      const fx = qx - x0;
      const i = y0 * ow + x0;
      const o = (O[i] * (1 - fx) + O[i + 1] * fx) * (1 - fy) + (O[i + ow] * (1 - fx) + O[i + ow + 1] * fx) * fy;
      const p = C[v * ow + u];
      n++; sP += p; sP2 += p * p; sO += o; sO2 += o * o; sPO += p * o;
    }
  }
  if (n < 16 || n < 0.55 * total) return -2;
  const vP = sP2 - (sP * sP) / n, vO = sO2 - (sO * sO) / n;
  if (vP <= 1e-6 || vO <= 1e-6) return 0;
  return (sPO - (sP * sO) / n) / Math.sqrt(vP * vO);
}

/**
 * Model fotoğrafı çıktının neresine, hangi ölçekte çizdi?
 * @param output tuval boyutunda ham çıktı { data, raw }
 * @param canvas prepareExpandCanvas tuvali (kodlu ya da { data, raw }) — ince şablon kaynağı
 * @param photo  yerleşim boyutundaki fotoğraf — kaba tarama şablonu
 * @returns {Promise<{scale, dx, dy, ncc, nccIdentity}>} dx/dy tam çözünürlük px
 */
async function estimatePlacement(output, canvas, photo, rect, W, H, { sMin = 0.5, sMax = 1.4, margin = 0.05 } = {}) {
  const long = Math.max(W, H);
  const Ls = [64, 128, 256, 512, 1024].filter((L, i) => i === 0 || L <= long);
  const cxF = rect.left + rect.width / 2, cyF = rect.top + rect.height / 2;
  const levels = await Promise.all(Ls.map(async (L) => {
    const f = L / long;
    const ow = Math.max(8, Math.round(W * f)), oh = Math.max(8, Math.round(H * f));
    const [O, C] = await Promise.all([grayLevel(output, ow, oh), grayLevel(canvas, ow, oh)]);
    const mx = rect.width * f * margin, my = rect.height * f * margin;
    return {
      L, f, ow, oh, O, C, cx: cxF * f, cy: cyF * f,
      u0: Math.max(0, Math.ceil(rect.left * f + mx)), u1: Math.min(ow, Math.floor((rect.left + rect.width) * f - mx)),
      v0: Math.max(0, Math.ceil(rect.top * f + my)), v1: Math.min(oh, Math.floor((rect.top + rect.height) * f - my)),
    };
  }));

  // 1) kaba: en küçük seviyede ölçek × öteleme taraması (fotoğrafın iç bölgesi şablon)
  const d0 = levels[0];
  const IO = integral(d0.O, d0.ow, d0.oh);
  const pw = Math.max(8, Math.round(rect.width * d0.f * 2)), ph = Math.max(8, Math.round(rect.height * d0.f * 2));
  const P = await grayLevel(photo, pw, ph);
  const mx = Math.round(pw * margin), my = Math.round(ph * margin);
  const cw = pw - 2 * mx, ch = ph - 2 * my;
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = P[(y + my) * pw + x + mx];
  const cands = [];
  for (let s = sMin; s <= sMax + 1e-9; s += 0.02) {
    const tw = Math.max(4, Math.round(rect.width * d0.f * s * (1 - 2 * margin)));
    const th = Math.max(4, Math.round(rect.height * d0.f * s * (1 - 2 * margin)));
    const T = resampleGray(crop, cw, ch, tw, th);
    const IT = integral(T, tw, th);
    const rangeX = Math.round(0.35 * d0.ow), rangeY = Math.round(0.35 * d0.oh);
    const bx = Math.round(d0.cx - tw / 2), by = Math.round(d0.cy - th / 2);
    for (let py = by - rangeY; py <= by + rangeY; py++) {
      for (let px = bx - rangeX; px <= bx + rangeX; px++) {
        const v = nccPlaced(d0.O, IO, d0.ow, d0.oh, T, IT, tw, th, px, py, 0.55);
        if (v > -1) cands.push({ v, s, dx: (px + tw / 2) / d0.f - cxF, dy: (py + th / 2) / d0.f - cyF });
      }
    }
  }
  cands.sort((a, b) => b.v - a.v);
  const starts = [];
  for (const c of cands) {
    if (starts.length >= 4) break;
    if (starts.some((p) => Math.abs(p.s - c.s) < 0.06 && Math.abs(p.dx - c.dx) < W * 0.04 && Math.abs(p.dy - c.dy) < H * 0.04)) continue;
    starts.push(c);
  }
  starts.push({ s: 1, dx: 0, dy: 0 }); // kimlik her zaman aday

  // 2) ince: her seviyede ±1 ölçek adımı × ±R piksel, ters-bükme NCC
  const local = (lv, cur, step, ds, R, stride) => {
    let best = { v: -3, s: cur.s, dx: cur.dx, dy: cur.dy };
    for (const s of [cur.s - ds, cur.s, cur.s + ds]) {
      for (let j = -R; j <= R; j++) {
        for (let i = -R; i <= R; i++) {
          const dx = cur.dx + i * step, dy = cur.dy + j * step;
          const v = nccWarped(lv, s, dx, dy, stride);
          if (v > best.v) best = { v, s, dx, dy };
        }
      }
    }
    return best;
  };
  let best = null;
  for (const start of starts) {
    let cur = { s: start.s, dx: start.dx, dy: start.dy, v: -3 };
    let ds = 0.02;
    for (let li = 1; li < levels.length; li++) {
      ds /= 2;
      cur = local(levels[li], cur, 1 / levels[li].f, ds, li === 1 ? 3 : 2, levels[li].L >= 512 ? 2 : 1);
    }
    if (!best || cur.v > best.v) best = cur;
  }
  // 3) alt-piksel cilası (en ince seviye, adım yarılanarak)
  const fine = levels[levels.length - 1];
  if (levels.length > 1) {
    let step = 1 / fine.f, ds = 0.0025;
    for (let k = 0; k < 3; k++) {
      step /= 2; ds /= 2;
      best = local(fine, best, step, ds, 1, 1);
    }
  }
  return { scale: best.s, dx: best.dx, dy: best.dy, ncc: best.v, nccIdentity: nccWarped(fine, 1, 0, 0, 1) };
}

// ─────────────────────────── dikiş inceltme (yerel kayma + genel ton) ───────────────────────────
// Model sahneyi yeniden çizerken fotoğrafın farklı yerlerini biraz farklı kaydırır (ör. çatı gölgesi 8–10 px).
// Bütünsel dönüşüm bunu silemez; her açık kenar boyunca, dikdörtgenin hemen İÇİNDE modelin kopyası orijinalle
// karşılaştırılır, küçük kayma ölçülür ve yeni alan kenardan uzaklaştıkça sönen bir yer değiştirmeyle orijinale
// oturtulur. Orijinalin piksellerine dokunulmaz (çekirdek atlanır; geçiş şeridinde zaten orijinal ağır basar).

const SEAM = { step: 36, along: 72, depth: 56, maxShift: 24, band: 128, penalty: 0.1 };
const TONE_MAX = 10; // genel ton kaydırması sınırı (0–255 düzeyi)

function lumaPlane(data, W, H, channels) {
  const g = new Float32Array(W * H);
  for (let i = 0, j = 0; i < g.length; i++, j += channels) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return g;
}
function halve(g, w, h) {
  const w2 = w >> 1, h2 = h >> 1;
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    const a = 2 * y * w, b = a + w;
    for (let x = 0; x < w2; x++) out[y * w2 + x] = 0.25 * (g[a + 2 * x] + g[a + 2 * x + 1] + g[b + 2 * x] + g[b + 2 * x + 1]);
  }
  return { g: out, w: w2, h: h2 };
}
/** A'nın (x,y,ww,wh) penceresi ile B'nin (x+sx, y+sy) penceresi arasında NCC; taşarsa -2 */
function windowNcc(lv, x, y, ww, wh, sx, sy) {
  const { A, B, w, h } = lv;
  if (x < 0 || y < 0 || x + ww > w || y + wh > h || x + sx < 0 || y + sy < 0 || x + sx + ww > w || y + sy + wh > h) return -2;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let j = 0; j < wh; j++) {
    const ia = (y + j) * w + x, ib = (y + j + sy) * w + x + sx;
    for (let i = 0; i < ww; i++) {
      const a = A[ia + i], b = B[ib + i];
      sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
  }
  const n = ww * wh;
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  if (va <= 1e-6 || vb <= 1e-6) return 0;
  return (sab - (sa * sb) / n) / Math.sqrt(va * vb);
}

/** Açık bir kenarın örnek pencereleri (tam çözünürlük, dikdörtgenin içinde, kenara bitişik) */
function edgeWindows(edge, rect) {
  const horizontal = edge === "top" || edge === "bottom";
  const len = horizontal ? rect.width : rect.height;
  const count = Math.max(1, Math.floor(len / SEAM.step));
  const lo = horizontal ? rect.left : rect.top;
  const hi = lo + len - Math.min(SEAM.along, len);
  const list = [];
  for (let k = 0; k < count; k++) {
    const t = lo + (k + 0.5) * (len / count);
    const start = Math.max(lo, Math.min(hi, Math.round(t - SEAM.along / 2)));
    if (horizontal) {
      const ww = Math.min(SEAM.along, rect.width), wh = Math.min(SEAM.depth, rect.height);
      list.push({ t, x: start, y: edge === "top" ? rect.top : rect.top + rect.height - wh, ww, wh });
    } else {
      const ww = Math.min(SEAM.depth, rect.width), wh = Math.min(SEAM.along, rect.height);
      list.push({ t, x: edge === "left" ? rect.left : rect.left + rect.width - ww, y: start, ww, wh });
    }
  }
  return list;
}

/** Tek pencerede kayma: çeyrek → yarım → tam çözünürlükte (NCC − ceza·|v|²) en iyisi; güven 0–1 */
function windowShift(pyr, win) {
  const R = SEAM.maxShift;
  const pen = (sx, sy) => SEAM.penalty * ((sx * sx + sy * sy) / (R * R));
  let best = { v: -3, sx: 0, sy: 0 };
  const quarter = pyr[2];
  const q = { x: win.x >> 2, y: win.y >> 2, ww: Math.max(4, win.ww >> 2), wh: Math.max(4, win.wh >> 2) };
  const Rq = Math.ceil(R / 4);
  for (let sy = -Rq; sy <= Rq; sy++) {
    for (let sx = -Rq; sx <= Rq; sx++) {
      const v = windowNcc(quarter, q.x, q.y, q.ww, q.wh, sx, sy) - pen(sx * 4, sy * 4);
      if (v > best.v) best = { v, sx: sx * 4, sy: sy * 4 };
    }
  }
  for (const [lv, k, r] of [[pyr[1], 2, 2], [pyr[0], 1, 1]]) {
    const cx = Math.round(best.sx / k), cy = Math.round(best.sy / k);
    const w0 = { x: Math.floor(win.x / k), y: Math.floor(win.y / k), ww: Math.max(4, Math.floor(win.ww / k)), wh: Math.max(4, Math.floor(win.wh / k)) };
    let next = { v: -3, sx: best.sx, sy: best.sy };
    for (let sy = cy - r; sy <= cy + r; sy++) {
      for (let sx = cx - r; sx <= cx + r; sx++) {
        if (Math.abs(sx * k) > R || Math.abs(sy * k) > R) continue;
        const v = windowNcc(lv, w0.x, w0.y, w0.ww, w0.wh, sx, sy) - pen(sx * k, sy * k);
        if (v > next.v) next = { v, sx: sx * k, sy: sy * k };
      }
    }
    best = next;
  }
  // güven: benzerlik yüksek VE pencerede doku var (düz duvarda kayma anlamsız); arama sınırına dayanan kayma sayılmaz
  const full = pyr[0];
  let s = 0, s2 = 0;
  for (let j = 0; j < win.wh; j++) for (let i = 0; i < win.ww; i++) { const a = full.A[(win.y + j) * full.w + win.x + i]; s += a; s2 += a * a; }
  const n = win.ww * win.wh;
  const std = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  const ncc = best.v + pen(best.sx, best.sy);
  const atLimit = Math.abs(best.sx) >= R - 1 || Math.abs(best.sy) >= R - 1;
  const confidence = atLimit ? 0 : smooth01((ncc - 0.8) / 0.15) * smooth01((std - 3) / 6);
  return { sx: best.sx, sy: best.sy, ncc, confidence };
}

/** Büyük kayma komşularla doğrulanmalı (±2 örnekte ≥2 güvenilir komşu, medyana ≤6 px); yoksa güven düşer. */
function corroborate(samples) {
  return samples.map((sample, k) => {
    if (sample.confidence <= 0) return sample;
    const near = [];
    for (let j = Math.max(0, k - 2); j <= Math.min(samples.length - 1, k + 2); j++) {
      if (j !== k && samples[j].confidence > 0.3) near.push(samples[j]);
    }
    const mag = Math.hypot(sample.sx, sample.sy);
    if (near.length < 2) return mag > 8 ? { ...sample, confidence: sample.confidence * 0.2 } : sample;
    const med = (key) => { const a = near.map((n) => n[key]).sort((x, y) => x - y); return a[a.length >> 1]; };
    return Math.hypot(sample.sx - med("sx"), sample.sy - med("sy")) > 6 ? { ...sample, confidence: sample.confidence * 0.2 } : sample;
  });
}

/** Güven ağırlıklı Gauss yumuşatma; çevrede güvenilir örnek yoksa sıfıra (bütünsel hizaya) çekilir */
function smoothProfile(samples, key, sigma = 1.5, prior = 0.1) {
  return samples.map((_, k) => {
    let num = 0, den = prior;
    for (let j = 0; j < samples.length; j++) {
      const g = Math.exp(-((k - j) ** 2) / (2 * sigma * sigma)) * samples[j].confidence;
      num += g * samples[j][key]; den += g;
    }
    return num / den;
  });
}

/** Kenar profilini piksel başına tabloya çevirir (doğrusal ara değer, uçlarda sabit) */
function profileTable(ts, values, length) {
  const out = new Float32Array(length);
  let k = 0;
  for (let i = 0; i < length; i++) {
    const t = i + 0.5;
    if (t <= ts[0]) { out[i] = values[0]; continue; }
    if (t >= ts[ts.length - 1]) { out[i] = values[values.length - 1]; continue; }
    while (k < ts.length - 2 && ts[k + 1] < t) k++;
    const a = (t - ts[k]) / (ts[k + 1] - ts[k]);
    out[i] = values[k] * (1 - a) + values[k + 1] * a;
  }
  return out;
}

/**
 * @param base   tuval boyutunda ham RGB (bütünsel olarak hizalanmış model çıktısı)
 * @param orig   tuval boyutunda ham RGB tuval (dikdörtgen içi = orijinal)
 * @returns {{data, raw, stats}} dikdörtgenin çekirdeğine dokunmaz
 */
function refineSeams(base, orig, rect, W, H, feather) {
  const open = openEdges(rect, W, H);
  const edges = Object.keys(open).filter((e) => open[e]);
  if (!edges.length) return { ...base, stats: null };
  const ch = base.raw.channels, och = orig.raw.channels;
  const A0 = lumaPlane(orig.data, W, H, och), B0 = lumaPlane(base.data, W, H, ch);
  const h1a = halve(A0, W, H), h1b = halve(B0, W, H);
  const h2a = halve(h1a.g, h1a.w, h1a.h), h2b = halve(h1b.g, h1b.w, h1b.h);
  const pyr = [{ A: A0, B: B0, w: W, h: H }, { A: h1a.g, B: h1b.g, w: h1a.w, h: h1a.h }, { A: h2a.g, B: h2b.g, w: h2a.w, h: h2a.h }];

  // 1) her açık kenar boyunca kayma profili (güvenilir, komşularca doğrulanmış pencerelerden; yumuşatılmış)
  const tables = {};
  const stats = {};
  let moved = false;
  const lim = (v) => Math.max(-SEAM.maxShift, Math.min(SEAM.maxShift, v));
  for (const edge of edges) {
    const wins = edgeWindows(edge, rect);
    const samples = corroborate(wins.map((win) => ({ t: win.t, ...windowShift(pyr, win) })));
    const vx = smoothProfile(samples, "sx").map(lim);
    const vy = smoothProfile(samples, "sy").map(lim);
    const ts = wins.map((w) => w.t);
    const length = edge === "top" || edge === "bottom" ? W : H;
    tables[edge] = [profileTable(ts, vx, length), profileTable(ts, vy, length)];
    const mags = vx.map((v, k) => Math.hypot(v, vy[k])).sort((a, b) => a - b);
    if (mags[mags.length - 1] >= 0.25) moved = true;
    stats[edge] = { confident: samples.filter((s) => s.confidence > 0.5).length, of: samples.length, medianShift: Number(mags[mags.length >> 1].toFixed(1)), maxShift: Number(mags[mags.length - 1].toFixed(1)) };
  }

  // 2) dikiş bölgesi: dışarıda `band` px boyunca sönen, içeride geçiş şeridinde tam yer değiştirme
  const src = base.data;
  const R0 = rect.left, R1 = rect.left + rect.width, T0 = rect.top, T1 = rect.top + rect.height;
  const B = SEAM.band;
  const inner = feather + 2;
  let out = src;
  if (moved) {
    out = Buffer.from(src);
    const x0 = Math.max(0, Math.floor(R0 - B)), x1 = Math.min(W, Math.ceil(R1 + B));
    const y0 = Math.max(0, Math.floor(T0 - B)), y1 = Math.min(H, Math.ceil(T1 + B));
    for (let y = y0; y < y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x < x1; x++) {
        const px = x + 0.5;
        if (px - R0 > inner && R1 - px > inner && py - T0 > inner && T1 - py > inner) continue; // çekirdek: orijinal kalır
        let wsum = 0, dx = 0, dy = 0;
        for (const edge of edges) {
          let outward, lateral, along;
          if (edge === "top") { outward = T0 - py; lateral = Math.max(0, R0 - px, px - R1); along = x; }
          else if (edge === "bottom") { outward = py - T1; lateral = Math.max(0, R0 - px, px - R1); along = x; }
          else if (edge === "left") { outward = R0 - px; lateral = Math.max(0, T0 - py, py - T1); along = y; }
          else { outward = px - R1; lateral = Math.max(0, T0 - py, py - T1); along = y; }
          if (outward < -inner) continue; // bu kenarın içinde, geçiş şeridinden derin
          const w = smooth01(1 - (outward > 0 ? Math.hypot(outward, lateral) : lateral) / B);
          if (w <= 0) continue;
          wsum += w; dx += w * tables[edge][0][along]; dy += w * tables[edge][1][along];
        }
        if (wsum <= 0) continue;
        const norm = Math.max(1, wsum);
        dx /= norm; dy /= norm;
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue;
        // çift doğrusal örnek (tuval sınırında kıskaç)
        const fx = Math.min(W - 1.001, Math.max(0, px + dx - 0.5)), fy = Math.min(H - 1.001, Math.max(0, py + dy - 0.5));
        const sx0 = Math.floor(fx), sy0 = Math.floor(fy), ax = fx - sx0, ay = fy - sy0;
        const i = (sy0 * W + sx0) * ch, o = (y * W + x) * ch;
        for (let c = 0; c < 3; c++) {
          const top = src[i + c] * (1 - ax) + src[i + ch + c] * ax;
          const bot = src[i + W * ch + c] * (1 - ax) + src[i + W * ch + ch + c] * ax;
          out[o + c] = Math.round(top * (1 - ay) + bot * ay);
        }
      }
    }
  }

  // 3) ton: model pozlamayı/beyaz dengesini biraz kaydırabiliyor → düz alanda dikiş çizgisi. Kenarın hemen
  //    içindeki ince şeritlerde (orijinal − model) farkının pencere MEDYANLARI; içeriği tutarlı pencerelerden
  //    (yayılım küçük) TEK bir genel kaydırma bulunur ve tüm çıktıya uygulanır. Yerel fark (gölgenin başka yerde
  //    olması gibi) bilerek düzeltilmez — yerel ton düzeltmesi denemede hale/leke bırakıyordu.
  const depth = Math.max(6, feather * 2);
  const median = (arr) => { if (!arr.length) return 0; const a = Float32Array.from(arr).sort(); return a[a.length >> 1]; };
  const kept = [[], [], []];
  let windows = 0;
  for (const edge of edges) {
    const horizontal = edge === "top" || edge === "bottom";
    for (const win of edgeWindows(edge, rect)) {
      const strip = horizontal
        ? { x: win.x, y: edge === "top" ? T0 : T1 - depth, w: win.ww, h: depth }
        : { x: edge === "left" ? R0 : R1 - depth, y: win.y, w: depth, h: win.wh };
      const d = [[], [], []];
      const lum = [];
      for (let y = Math.max(0, strip.y); y < Math.min(H, strip.y + strip.h); y++) {
        for (let x = Math.max(0, strip.x); x < Math.min(W, strip.x + strip.w); x++) {
          const i = (y * W + x) * och, j = (y * W + x) * ch;
          const dr = orig.data[i] - out[j], dg = orig.data[i + 1] - out[j + 1], db = orig.data[i + 2] - out[j + 2];
          d[0].push(dr); d[1].push(dg); d[2].push(db);
          lum.push(0.299 * dr + 0.587 * dg + 0.114 * db);
        }
      }
      windows++;
      const ml = median(lum);
      if (median(lum.map((v) => Math.abs(v - ml))) > 5 || Math.abs(ml) > 20) continue; // içerik uyuşmuyor → sayma
      for (let c = 0; c < 3; c++) kept[c].push(median(d[c]));
    }
  }
  let offset = [0, 0, 0];
  if (kept[0].length >= Math.max(6, windows * 0.3)) offset = kept.map((arr) => Math.max(-TONE_MAX, Math.min(TONE_MAX, median(arr))));
  stats.tone = offset.map((v) => Number(v.toFixed(1)));
  if (offset.some((v) => Math.abs(v) >= 0.5)) {
    if (out === src) out = Buffer.from(src);
    for (let i = 0; i < out.length; i += ch) {
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(out[i + c] + offset[c])));
    }
  }
  return { data: out, raw: base.raw, stats };
}

// ─────────────────────────── bitirme ───────────────────────────

const ALIGNED_MAX_PX = 1.5; // dikdörtgen köşelerindeki en büyük sapma bunun altındaysa çıktı bükülmez
const FAITHFUL_NCC = 0.85; // model fotoğrafı bu benzerlikle çizdiyse (yalnız yeri/ölçeği kaymışsa) hizalanır
const SCALE_RANGE = [0.5, 1.25];
// Hizalarken çıktının dışına düşen şerit, kenarın en çok %6'sı olabilir (aynalanır). Test: model fotoğrafı 60 px
// sağa kaydırınca hizasız bırakmak dikişte 60 px kırık bırakıyordu; hizalayıp tuval kenarında 41 px aynalamak temiz.
const MAX_UNCOVERED = 0.06;

/** Dikişin yumuşak geçiş genişliği: kısa kenarın %0,8'i, 8–16 px (maskenin %1,2 dikiş payının içinde kalır) */
const featherPx = (W, H) => Math.max(8, Math.min(16, Math.round(Math.min(W, H) * 0.008)));

/** Dikdörtgen köşelerinde dönüşümün yarattığı en büyük kayma (px) */
function cornerShift(t, rect) {
  const hw = rect.width / 2, hh = rect.height / 2;
  return Math.max(Math.abs(t.dx) + Math.abs(t.scale - 1) * hw, Math.abs(t.dy) + Math.abs(t.scale - 1) * hh);
}

/** Hizalamada çıktının dışında kalan (aynalanarak doldurulacak) şerit kalınlıkları, tuval px */
function uncoveredBands(t, rect, W, H) {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const qx0 = cx + t.dx - t.scale * cx, qx1 = cx + t.dx + t.scale * (W - cx);
  const qy0 = cy + t.dy - t.scale * cy, qy1 = cy + t.dy + t.scale * (H - cy);
  return {
    left: Math.max(0, -qx0) / t.scale, right: Math.max(0, qx1 - W) / t.scale,
    top: Math.max(0, -qy0) / t.scale, bottom: Math.max(0, qy1 - H) / t.scale,
  };
}

/** Çıktıyı tuval boyutuna getirir. Oran %3'ten fazla farklıysa "cover" ve "fill" adayları birlikte döner. */
async function normalizeToCanvas(outputBuffer, W, H) {
  const meta = await sharp(outputBuffer, { limitInputPixels: 80_000_000 }).metadata();
  const swap = (meta.orientation || 1) >= 5;
  const source = { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
  const same = source.width === W && source.height === H;
  if (same) return { candidates: [{ ...(await toRawRGB(outputBuffer)), fit: "none" }], source, resized: false };
  const aspectGap = Math.abs(Math.log((source.width / source.height) / (W / H)));
  const fits = aspectGap <= 0.03 ? ["fill"] : ["cover", "fill"];
  const candidates = await Promise.all(fits.map(async (fit) => ({ ...(await toRawRGB(outputBuffer, W, H, fit)), fit })));
  return { candidates, source, resized: true };
}

/** Çıktıyı ters dönüşümle hizalar: O'(p) = O(c' + s(p − c)). Çıktının dışına düşen ince şeritler aynalanarak dolar. */
async function warpToRect(output, t, rect, W, H) {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const rw = Math.max(1, Math.round(W / t.scale)), rh = Math.max(1, Math.round(H / t.scale));
  const kx = rw / W, ky = rh / H; // gerçek büyütme (≈ 1/s)
  // pencere başlangıcı (büyütülmüş görüntüde): p = 0 → q = c' − s·c → q·k
  const ox = Math.round((cx + t.dx - t.scale * cx) * kx), oy = Math.round((cy + t.dy - t.scale * cy) * ky);
  const pad = { left: Math.max(0, -ox), top: Math.max(0, -oy), right: Math.max(0, ox + W - rw), bottom: Math.max(0, oy + H - rh) };
  let resized = await sharp(output.data, { raw: output.raw }).resize(rw, rh, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  if (pad.left || pad.top || pad.right || pad.bottom) {
    resized = await sharp(resized.data, { raw: resized.info }).extend({ ...pad, extendWith: "mirror" }).raw().toBuffer({ resolveWithObject: true });
  }
  const { data, info } = await sharp(resized.data, { raw: resized.info })
    .extract({ left: ox + pad.left, top: oy + pad.top, width: W, height: H }).raw().toBuffer({ resolveWithObject: true });
  return { data, raw: { width: info.width, height: info.height, channels: info.channels } };
}

/** Yerleşim boyutunda alfa: iç kısım 255; yeni alana bakan kenarlarda `feather` px'te yumuşak (smoothstep) iniş. */
function featherAlpha(rect, W, H, feather) {
  const open = openEdges(rect, W, H);
  const ramp = (d) => smooth01(d / feather);
  const { width, height } = rect;
  const colRamp = new Float32Array(width), rowRamp = new Float32Array(height);
  for (let x = 0; x < width; x++) colRamp[x] = (open.left ? ramp(x + 0.5) : 1) * (open.right ? ramp(width - x - 0.5) : 1);
  for (let y = 0; y < height; y++) rowRamp[y] = (open.top ? ramp(y + 0.5) : 1) * (open.bottom ? ramp(height - y - 0.5) : 1);
  const alpha = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) alpha[y * width + x] = Math.round(255 * colRamp[x] * rowRamp[y]);
  }
  return alpha;
}

/** Orijinal fotoğrafı `base` (tuval boyutunda ham RGB) üzerine yumuşak kenarla koyar → RGB PNG */
async function compositeOriginal(base, photo, rect, W, H, feather = featherPx(W, H)) {
  const alpha = featherAlpha(rect, W, H, feather);
  const rgb = await sharp(photo).resize(rect.width, rect.height, { fit: "fill" }).removeAlpha().toColorspace("srgb").raw().toBuffer();
  const rgba = Buffer.alloc(rect.width * rect.height * 4);
  for (let i = 0, j = 0, k = 0; i < alpha.length; i++, j += 3, k += 4) {
    rgba[k] = rgb[j]; rgba[k + 1] = rgb[j + 1]; rgba[k + 2] = rgb[j + 2]; rgba[k + 3] = alpha[i];
  }
  const { data, info } = await sharp(base.data, { raw: base.raw })
    .composite([{ input: rgba, raw: { width: rect.width, height: rect.height, channels: 4 }, left: rect.left, top: rect.top }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).removeAlpha().png().toBuffer();
}

/**
 * Modelin çıktısını bitirir: tuvale oturt → hizala (gerekirse) → dikişi incelt → orijinali geri koy.
 * Hiçbir adım orijinal fotoğrafın kendisini değiştirmez; hizalama hesaplanamazsa bile orijinal geri konur.
 * @param {Buffer} outputBuffer modelin döndürdüğü görsel
 * @param {{canvas:Buffer, photo:Buffer, rect:object, W:number, H:number}} prepared prepareExpandCanvas çıktısı + tuval boyutu
 * @returns {Promise<{buffer:Buffer, meta:object}>} buffer: tuval boyutunda RGB PNG
 */
async function finishExpandResult(outputBuffer, { canvas, photo, rect, W, H }) {
  const started = Date.now();
  const [norm, orig] = await Promise.all([normalizeToCanvas(outputBuffer, W, H), toRawRGB(canvas, W, H)]);
  let chosen = norm.candidates[0];
  let est = null;
  try {
    for (const candidate of norm.candidates) {
      const e = await estimatePlacement(candidate, orig, photo, rect, W, H);
      if (!est || e.ncc > est.ncc) { est = e; chosen = candidate; }
    }
  } catch (error) {
    est = null; // hizalama hesaplanamadı → orijinal yine de geri konur
  }
  let alignment = "unaligned";
  let base = chosen;
  if (est) {
    const bands = uncoveredBands(est, rect, W, H);
    const covered = Math.max(bands.left, bands.right) <= W * MAX_UNCOVERED && Math.max(bands.top, bands.bottom) <= H * MAX_UNCOVERED;
    if (est.ncc < FAITHFUL_NCC) {
      alignment = "unaligned"; // model içeriği yeniden kurmuş; hizalanacak sadık kopya yok
    } else if (cornerShift(est, rect) <= ALIGNED_MAX_PX) {
      alignment = "aligned";
    } else if (est.scale >= SCALE_RANGE[0] && est.scale <= SCALE_RANGE[1] && covered) {
      base = await warpToRect(chosen, est, rect, W, H);
      alignment = "warped";
    }
  }
  const feather = featherPx(W, H);
  let seams = null;
  if (alignment !== "unaligned") {
    try {
      const refined = refineSeams(base, orig, rect, W, H, feather);
      base = refined;
      seams = refined.stats;
    } catch (error) {
      seams = null; // inceltme olmadan devam (hizalı taban yine kullanılır)
    }
  }
  const buffer = await compositeOriginal(base, photo, rect, W, H, feather);
  const round = (v, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  return {
    buffer,
    meta: {
      alignment,
      scale: round(est?.scale, 4),
      dx: round(est?.dx, 1),
      dy: round(est?.dy, 1),
      ncc: round(est?.ncc),
      nccIdentity: round(est?.nccIdentity),
      feather,
      seams,
      resized: norm.resized,
      fit: chosen.fit,
      source: norm.source,
      ms: Date.now() - started,
    },
  };
}

module.exports = {
  parseCanvasPlacement,
  prepareExpandCanvas,
  CANVAS_DIRECTION,
  canvasPromptTool,
  canvasPromptValues,
  buildExpandCanvasPrompt,
  estimatePlacement,
  normalizeToCanvas,
  warpToRect,
  refineSeams,
  featherAlpha,
  featherPx,
  compositeOriginal,
  finishExpandResult,
};
