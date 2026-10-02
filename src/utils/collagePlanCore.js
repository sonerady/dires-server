// 🧩 Kolaj planlayıcı çekirdeği (30 Eyl 2026)
//
// ⚠️ Bu dosya client/components/collage/collagePlanCore.js ve
// server/src/utils/collagePlanCore.js olarak BİREBİR aynıdır (client testi iki kopyayı
// karşılaştırır). Değiştirirsen ikisini birlikte değiştir. Saf CommonJS: RN/Node bağımlılığı yok,
// şablon kaydı dışarıdan verilir → createCollagePlanner(require(".../collageTemplates.json")).
//
// Görevleri:
//   • brief doğrulama (validateBrief) ve yapay zekâ planının SIKI doğrulaması (validatePlan)
//   • deterministik yedek plan (fallbackPlan): kırpma kaybını en aza indiren şablon + fotoğraf
//     yerleşimi (Macar algoritması), amaç/ton profilleri, düz zeminli ürün fotoğraflarında akıllı
//     yakınlaştırma (ürün kutusu), fotoğraflardan türeyen zemin rengi
//   • satıcının açık seçimleri her zaman kazanır (applyExplicit)
//   • piksel analizi (analyzePixels): düz zemin tespiti, ürün kutusu, ortalama renk
"use strict";

const RATIOS = ["1:1", "4:5", "3:4", "9:16", "16:9"];
const PURPOSES = ["instagram_post", "story", "marketplace", "lookbook", "before_after", "bundle", "color_variants"];
const MOODS = ["minimal", "bold", "luxury", "playful", "natural"];
const FONTS = ["modern", "elegant", "bold", "classic"];
const ALIGNS = ["left", "center", "right"];
const POSITIONS = ["top", "bottom", "overlay"];
const CAPTION_MODES = ["ai", "none", "custom"];
// Stil birimleri: tuvalin KISA kenarının yüzdesi (gap/margin/radius); zoom = kaplama ölçeğinin katı
const LIMITS = { gap: [0, 8], margin: [0, 12], radius: [0, 12], zoom: [1, 4] };
const MAX_PHOTOS = 9;
const TITLE_MAX = 60;
const SUBTITLE_MAX = 90;
const REASON_MAX = 280;

// Amaç profilleri — oran adayları (ilki tercih), şablon aileleri (sıra = tercih), stil, yazı yeri
const PROFILES = {
  instagram_post: { ratios: ["4:5", "1:1"], families: ["hero", "mosaic", "grid", "strip", "split", "inset"], gap: 1.6, margin: 3.2, radius: 1.8, caption: "bottom", align: "center", font: "modern" },
  story: { ratios: ["9:16"], families: ["strip", "hero", "grid", "mosaic", "split", "inset"], gap: 1.4, margin: 4.5, radius: 2.4, caption: "top", align: "center", font: "modern" },
  marketplace: { ratios: ["1:1"], families: ["hero", "grid", "mosaic", "strip", "inset", "split"], gap: 1.2, margin: 2.4, radius: 0, caption: "top", align: "left", font: "modern", background: "#FFFFFF" },
  lookbook: { ratios: ["3:4", "4:5"], families: ["hero", "mosaic", "grid", "strip", "inset", "split"], gap: 2.2, margin: 6, radius: 0, caption: "bottom", align: "left", font: "elegant" },
  before_after: { ratios: ["1:1", "4:5", "16:9"], families: ["split", "grid", "strip", "hero", "mosaic", "inset"], gap: 1, margin: 0, radius: 0, caption: "top", align: "center", font: "bold", labels: true },
  bundle: { ratios: ["1:1", "4:5"], families: ["hero", "grid", "mosaic", "strip", "inset", "split"], gap: 1.6, margin: 3, radius: 2, caption: "top", align: "center", font: "modern", background: "#FFFFFF" },
  color_variants: { ratios: ["1:1", "4:5"], families: ["grid", "strip", "mosaic", "hero", "split", "inset"], gap: 1.2, margin: 3, radius: 1.5, caption: "bottom", align: "center", font: "modern", equalZoom: true },
};
const MOOD_LOOK = {
  minimal: { background: "#FFFFFF", gap: 1.2, margin: 1.3, radius: 0.6, font: "modern" },
  bold: { background: "#111111", gap: 0.7, margin: 0.8, radius: 2.5, font: "bold" },
  luxury: { background: "#F3EDE4", gap: 1.1, margin: 1.6, radius: 0, font: "elegant" },
  playful: { background: "#FDE8EF", gap: 1.5, margin: 1.2, radius: 5, font: "modern" },
  natural: { background: "#EFEBE3", gap: 1.1, margin: 1.3, radius: 1.6, font: "classic" },
};

// ─── küçük yardımcılar ─────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

function normalizeHex(value) {
  if (typeof value !== "string") return null;
  let s = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
}
function hexToRgb(hex) {
  const h = normalizeHex(hex) || "#FFFFFF";
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbToHex(rgb) {
  return `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
/** a → b arası karışım (t = b'nin payı) */
function mixHex(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x.map((c, i) => c + (y[i] - c) * t));
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Zemin üstünde okunur yazı rengi */
function readableOn(bg) {
  return contrast(bg, "#111111") >= contrast(bg, "#FFFFFF") ? "#111111" : "#FFFFFF";
}
function cleanText(value, max) {
  if (typeof value !== "string") return "";
  // kontrol karakterleri ve fazla boşluk atılır; tek satır sonu korunur
  return value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, max);
}
function ratioValue(ratio) {
  const [a, b] = String(ratio).split(":").map(Number);
  return a > 0 && b > 0 ? a / b : 1;
}
function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Kırpma kaybı: "kaplama" yerleşiminde fotoğrafın kesilen payı (0 = hiç kesilmez) */
function cropLoss(photoAspect, cellAspect) {
  if (!(photoAspect > 0) || !(cellAspect > 0)) return 0;
  return 1 - Math.min(photoAspect, cellAspect) / Math.max(photoAspect, cellAspect);
}

/** Macar algoritması (kare maliyet matrisi, en düşük toplam) → satır i için sütun */
function hungarian(cost) {
  const n = cost.length;
  if (!n) return [];
  const INF = 1e18;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array(n).fill(0);
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

/**
 * Piksel analizi (küçük RGBA önizleme, ≤ ~96 px): kenar halkasından zemin rengi; halkanın
 * büyük kısmı tek renkse "düz zemin" → zeminden ayrışan piksellerin kutusu = ürün kutusu.
 * Saydam pikseller (alfa < 16) zemin sayılır (dekupe PNG ürünler).
 */
function analyzePixels(data, width, height) {
  if (!data || !(width >= 4) || !(height >= 4) || data.length < width * height * 4) return null;
  const at = (x, y) => (y * width + x) * 4;
  const ring = [];
  const push = (x, y) => {
    const i = at(x, y);
    ring.push(data[i + 3] < 16 ? [-1, -1, -1] : [data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, 1); push(x, height - 2); push(x, height - 1); }
  for (let y = 2; y < height - 2; y++) { push(0, y); push(1, y); push(width - 2, y); push(width - 1, y); }
  const transparentRing = ring.filter((p) => p[0] < 0).length / ring.length > 0.5;
  const opaqueRing = ring.filter((p) => p[0] >= 0);
  const bg = transparentRing || !opaqueRing.length ? [255, 255, 255] : [0, 1, 2].map((c) => median(opaqueRing.map((p) => p[c])));
  const near = (r, g, b) => Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
  const closeShare = transparentRing ? 1 : opaqueRing.filter((p) => near(p[0], p[1], p[2]) < 30).length / ring.length;
  const plain = closeShare >= 0.86;

  const cols = new Array(width).fill(0);
  const rows = new Array(height).fill(0);
  let fg = 0;
  const fgSum = [0, 0, 0];
  const allSum = [0, 0, 0];
  let opaque = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = at(x, y);
      if (data[i + 3] < 16) continue;
      opaque++;
      allSum[0] += data[i]; allSum[1] += data[i + 1]; allSum[2] += data[i + 2];
      if (near(data[i], data[i + 1], data[i + 2]) > 42) {
        fg++;
        cols[x]++; rows[y]++;
        fgSum[0] += data[i]; fgSum[1] += data[i + 1]; fgSum[2] += data[i + 2];
      }
    }
  }
  const avg = fg ? fgSum.map((s) => s / fg) : opaque ? allSum.map((s) => s / opaque) : [255, 255, 255];
  const fill = fg / (width * height);
  let bbox = null;
  if (plain && fill > 0.004) {
    // Tek tük gürültü pikselleri kutuyu büyütmesin: satır/sütun eşiği
    const colMin = Math.max(1, Math.round(height * 0.012));
    const rowMin = Math.max(1, Math.round(width * 0.012));
    let x0 = cols.findIndex((c) => c >= colMin);
    let x1 = width - 1 - cols.slice().reverse().findIndex((c) => c >= colMin);
    let y0 = rows.findIndex((c) => c >= rowMin);
    let y1 = height - 1 - rows.slice().reverse().findIndex((c) => c >= rowMin);
    if (x0 >= 0 && y0 >= 0 && x1 >= x0 && y1 >= y0) {
      bbox = [x0 / width, y0 / height, (x1 + 1) / width, (y1 + 1) / height].map((v) => round(clamp(v, 0, 1), 4));
    }
  }
  return { plain, bg: transparentRing ? null : rgbToHex(bg), transparent: transparentRing, bbox, avg: rgbToHex(avg), fill: round(fill, 4) };
}

// Doğrulanmış brief'ler (sahte `valid: true` alanıyla atlatılamasın diye modül içi WeakSet)
const VALIDATED = new WeakSet();

function createCollagePlanner(data) {
  const templates = Array.isArray(data && data.templates) ? data.templates : [];
  const byId = new Map(templates.map((t) => [t.id, t]));

  const templatesFor = (count) => templates.filter((t) => t.count === count);
  const templateById = (id) => byId.get(id) || null;
  const cellArea = (c) => (c[2] - c[0]) * (c[3] - c[1]);
  /** Kahraman hücre: şablonun belirttiği, yoksa en büyük (eşitse null — ızgara) */
  function heroSlot(template) {
    if (!template) return null;
    if (isInt(template.hero)) return template.hero;
    const areas = template.cells.map(cellArea);
    const max = Math.max(...areas);
    // 1/3 gibi yuvarlanmış kesirler eşit hücreleri 0.0001 farklı yapar → %1 tolerans (ızgara = kahramansız)
    const top = areas.filter((a) => max - a < 0.01).length;
    return top === 1 ? areas.indexOf(max) : null;
  }
  /** Hücre en/boy oranları (boşluklar yok sayılır — puanlama için yeterli) */
  const cellAspects = (template, ratio) => template.cells.map((c) => ((c[2] - c[0]) * ratioValue(ratio)) / (c[3] - c[1]));

  /**
   * Bir fotoğrafın bir hücredeki kaybı. Düz zeminli üründe ölçü ÜRÜN KUTUSUDUR: zemini kırpmak
   * kayıp değil, ürünün kesilen payı kayıptır (küçük pay: yine de daha az kırpan hücre tercih
   * edilir). Diğer fotoğraflarda görselin kırpılan payı.
   */
  function placementLoss(photo, cellAspect) {
    const pa = photo && photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 0.75;
    if (photo && photo.plain && Array.isArray(photo.bbox)) {
      const [x0, y0, x1, y1] = photo.bbox;
      const bw = Math.max(0.02, x1 - x0), bh = Math.max(0.02, y1 - y0);
      // zoom 1'de hücrede görünen pencere (görsel koordinatında, 0–1)
      const ww = pa > cellAspect ? cellAspect / pa : 1;
      const wh = pa > cellAspect ? 1 : pa / cellAspect;
      const cut = 1 - Math.min(1, ww / bw, wh / bh);
      return cut * 0.9 + cropLoss(pa, cellAspect) * 0.1;
    }
    return cropLoss(pa, cellAspect);
  }

  /**
   * Fotoğrafları hücrelere yerleştir: alanla ağırlıklı kayıp en az (Macar). Kahraman fotoğraf
   * verilirse kahraman hücreye sabitlenir. Eşitlikte ekleme sırası korunur. Üstteki (resim içinde
   * resim) hücre alttaki fotoğrafın örttüğü alan kadar maliyet ekler.
   * @returns {{ order: number[], cost: number }} order[slot] = photoIndex
   */
  function assignPhotos(template, ratio, photos, heroIndex = null) {
    const n = template.cells.length;
    const aspects = cellAspects(template, ratio);
    const hero = heroSlot(template);
    const cost = template.cells.map((cell, slot) => photos.map((photo, index) => {
      let c = cellArea(cell) * placementLoss(photo, aspects[slot]) + 0.0005 * Math.abs(slot - index);
      if (hero !== null && isInt(heroIndex) && heroIndex >= 0 && heroIndex < n && slot === hero && index !== heroIndex) c += 1000;
      return c;
    }));
    // Kahraman cezası (1000) en iyi çözüme hiç girmez: kahraman fotoğraf her zaman o hücreye gidebilir
    const order = hungarian(cost);
    let total = 0;
    order.forEach((photo, slot) => { total += cost[slot][photo]; });
    for (const i of template.overlay || []) total += cellArea(template.cells[i]);
    return { order, cost: total };
  }

  function inferPurpose(photos) {
    const plain = photos.filter((p) => p && p.plain).length;
    return photos.length && plain / photos.length >= 0.75 ? "marketplace" : "instagram_post";
  }

  /** Amaç + oran için en az kırpan şablon (aile tercih cezası + oran tercih cezası) */
  function pickLayout({ count, photos, purpose, ratio, heroIndex }) {
    const profile = PROFILES[purpose] || PROFILES.instagram_post;
    const ratios = ratio && RATIOS.includes(ratio) ? [ratio] : profile.ratios;
    const candidates = templatesFor(count);
    if (!candidates.length) return null;
    let best = null;
    ratios.forEach((r, ratioRank) => {
      candidates.forEach((template, templateRank) => {
        const familyRank = profile.families.indexOf(template.family);
        const familyPenalty = familyRank < 0 ? 0.3 : familyRank * 0.035;
        // Önce/sonra etiketli şablon yalnız o amaçta (ya da 2 fotoğrafta kullanıcı seçerse)
        const splitPenalty = template.family === "split" && purpose !== "before_after" ? 0.25 : 0;
        const insetPenalty = template.family === "inset" && purpose !== "before_after" ? 0.08 : 0;
        const { order, cost } = assignPhotos(template, r, photos, heroIndex);
        const total = cost + familyPenalty + splitPenalty + insetPenalty + ratioRank * 0.05 + templateRank * 0.0001;
        if (!best || total < best.total - 1e-9) best = { template, ratio: r, order, total };
      });
    });
    return best;
  }

  /** Düz zeminli ürün: ürün kutusu hücrenin ~%80'ini dolduracak yakınlaştırma, merkez = kutu merkezi */
  function smartZoom(photoAspect, cellAspect, bbox) {
    if (!bbox) return { zoom: 1, focusX: 0.5, focusY: 0.5 };
    const [x0, y0, x1, y1] = bbox;
    const bw = Math.max(0.02, x1 - x0), bh = Math.max(0.02, y1 - y0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // hücre = 1×1; zoom 1'de görselin hücre birimindeki boyu (kaplama)
    const imgW = photoAspect > cellAspect ? photoAspect / cellAspect : 1;
    const imgH = photoAspect > cellAspect ? 1 : cellAspect / photoAspect;
    let zoom = clamp(0.8 / Math.max(bw * imgW, bh * imgH), 1, 2.5);
    for (let step = 0; step < 12 && zoom > 1; step++) {
      const ww = 1 / (imgW * zoom), wh = 1 / (imgH * zoom);
      const vx = clamp(cx, ww / 2, 1 - ww / 2), vy = clamp(cy, wh / 2, 1 - wh / 2);
      const pad = 0.01;
      const fits = x0 >= vx - ww / 2 - pad && x1 <= vx + ww / 2 + pad && y0 >= vy - wh / 2 - pad && y1 <= vy + wh / 2 + pad;
      if (fits) break;
      zoom = Math.max(1, zoom * 0.9);
    }
    return { zoom: round(zoom, 3), focusX: round(clamp(cx, 0, 1), 4), focusY: round(clamp(cy, 0, 1), 4) };
  }

  /** Sayfaya gelen brief'in doğrulanmış/normalize hâli (bilinmeyen alan → "auto") */
  function validateBrief(input) {
    const src = input && typeof input === "object" ? input : {};
    const rawPhotos = Array.isArray(src.photos) ? src.photos.slice(0, MAX_PHOTOS) : [];
    const photos = rawPhotos.map((p) => {
      const o = p && typeof p === "object" ? p : {};
      const width = finite(o.width) && o.width > 0 ? Math.round(o.width) : 1500;
      const height = finite(o.height) && o.height > 0 ? Math.round(o.height) : 2000;
      const bbox = Array.isArray(o.bbox) && o.bbox.length === 4 && o.bbox.every((v) => finite(v) && v >= 0 && v <= 1) && o.bbox[2] > o.bbox[0] && o.bbox[3] > o.bbox[1] ? o.bbox.map((v) => round(v, 4)) : null;
      return {
        width: clamp(width, 1, 20000),
        height: clamp(height, 1, 20000),
        plain: o.plain === true,
        bbox,
        bg: normalizeHex(o.bg),
        avg: normalizeHex(o.avg),
        url: typeof o.url === "string" && /^https:\/\//i.test(o.url) && o.url.length <= 2048 ? o.url : null,
      };
    });
    const manual = src.mode === "manual";
    const pick = (value, list) => (manual && list.includes(value) ? value : "auto");
    const cap = src.caption && typeof src.caption === "object" ? src.caption : {};
    const captionMode = CAPTION_MODES.includes(cap.mode) ? cap.mode : "ai";
    const hero = manual && isInt(src.heroIndex) && src.heroIndex >= 0 && src.heroIndex < photos.length ? src.heroIndex : null;
    const language = typeof src.language === "string" && /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(src.language) ? src.language : "en";
    const brief = {
      mode: manual ? "manual" : "auto",
      purpose: pick(src.purpose, PURPOSES),
      ratio: pick(src.ratio, RATIOS),
      mood: pick(src.mood, MOODS),
      caption: {
        // "Yapay zekâya bırak" modunda da satıcının tuvale yazdığı metin korunur (custom gelir)
        mode: captionMode,
        title: captionMode === "custom" ? cleanText(cap.title, TITLE_MAX) : "",
        subtitle: captionMode === "custom" ? cleanText(cap.subtitle, SUBTITLE_MAX) : "",
      },
      brandColor: manual ? normalizeHex(src.brandColor) : null,
      heroIndex: hero,
      language,
      photos,
    };
    VALIDATED.add(brief);
    return brief;
  }
  const ensureBrief = (input) => (input && typeof input === "object" && VALIDATED.has(input) ? input : validateBrief(input));

  /** Deterministik plan — yapay zekâ yoksa / yanıt bozuksa aynı girdi hep aynı planı verir */
  function fallbackPlan(briefInput) {
    const brief = ensureBrief(briefInput);
    const photos = brief.photos;
    const count = photos.length;
    if (!count) return null;
    const purpose = brief.purpose !== "auto" ? brief.purpose : inferPurpose(photos);
    const profile = PROFILES[purpose];
    const mood = brief.mood !== "auto" ? MOOD_LOOK[brief.mood] : null;
    const heroIndex = isInt(brief.heroIndex) ? brief.heroIndex : 0;
    const layout = pickLayout({ count, photos, purpose, ratio: brief.ratio !== "auto" ? brief.ratio : null, heroIndex });
    if (!layout) return null;
    const { template, ratio, order } = layout;

    const gap = clamp(profile.gap * (mood ? mood.gap : 1), ...LIMITS.gap);
    const margin = clamp(profile.margin * (mood ? mood.margin : 1), ...LIMITS.margin);
    const radius = clamp(mood ? mood.radius : profile.radius, ...LIMITS.radius);

    let background;
    if (profile.background) background = profile.background;
    else if (mood) background = mood.background;
    else {
      const lightPlain = photos.filter((p) => p.plain && p.bg && luminance(p.bg) > 0.82).length;
      const avgs = photos.map((p) => p.avg).filter(Boolean);
      if (lightPlain / count >= 0.6 || !avgs.length) background = "#FFFFFF";
      else {
        const mean = [0, 1, 2].map((c) => avgs.reduce((s, h) => s + hexToRgb(h)[c], 0) / avgs.length);
        background = mixHex(rgbToHex(mean), "#F7F7F5", 0.86);
      }
    }

    const aspects = cellAspects(template, ratio);
    let cells = order.map((photoIndex, slot) => {
      const photo = photos[photoIndex];
      const pa = photo.width / photo.height;
      const z = photo.plain && photo.bbox ? smartZoom(pa, aspects[slot], photo.bbox) : { zoom: 1, focusX: 0.5, focusY: 0.5 };
      return { photoIndex, focusX: z.focusX, focusY: z.focusY, zoom: z.zoom };
    });
    if (profile.equalZoom) {
      // Renk varyantları: hepsi aynı ölçekte (ürün hiçbir karede kesilmesin → en küçük yakınlaştırma)
      const zoom = Math.min(...cells.map((c) => c.zoom));
      cells = cells.map((c) => ({ ...c, zoom }));
    }
    cells.sort((a, b) => a.photoIndex - b.photoIndex);

    const font = (mood && mood.font) || profile.font || "modern";
    const caption = brief.caption.mode === "custom" && (brief.caption.title || brief.caption.subtitle)
      ? { title: brief.caption.title, subtitle: brief.caption.subtitle, align: profile.align, color: readableOn(background), position: profile.caption === "overlay" ? "overlay" : profile.caption, font }
      : null;
    const hero = heroSlot(template);
    const plan = {
      templateId: template.id,
      ratio,
      order,
      heroIndex: hero !== null ? order[hero] : order[0],
      cells,
      gap: round(gap, 2),
      margin: round(margin, 2),
      radius: round(radius, 2),
      background,
      caption,
      labels: template.family === "split",
      purpose,
      reason: "",
    };
    return applyExplicit(plan, brief);
  }

  /**
   * Yapay zekâ planının SIKI doğrulaması. Kullanılamaz (şablon/sıra geçersiz) → hata fırlatır
   * (çağıran yeniden sorar ya da yedeğe düşer). Diğer alanlar tek tek onarılır; `issues` hangi
   * alanların onarıldığını söyler.
   * @returns {{ plan: object, issues: string[] }}
   */
  function validatePlan(raw, briefInput) {
    const brief = ensureBrief(briefInput);
    const count = brief.photos.length;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("plan_not_object");
    const template = templateById(raw.templateId);
    if (!template || template.count !== count) throw new Error("plan_template");
    const order = raw.order;
    if (!Array.isArray(order) || order.length !== count || !order.every((v) => isInt(v) && v >= 0 && v < count) || new Set(order).size !== count) throw new Error("plan_order");
    const issues = [];
    const fallback = fallbackPlan(brief);
    const fix = (field, value) => { issues.push(field); return value; };

    const ratio = RATIOS.includes(raw.ratio) ? raw.ratio : fix("ratio", fallback.ratio);
    const num = (field) => {
      const v = raw[field];
      if (!finite(v)) return fix(field, fallback[field]);
      const [lo, hi] = LIMITS[field];
      if (v < lo || v > hi) issues.push(field);
      return round(clamp(v, lo, hi), 2);
    };
    const gap = num("gap"), margin = num("margin"), radius = num("radius");
    const background = normalizeHex(raw.background) || fix("background", fallback.background);

    const seen = new Set();
    const cellsIn = Array.isArray(raw.cells) ? raw.cells : [];
    const cells = [];
    for (const c of cellsIn) {
      if (!c || typeof c !== "object" || !isInt(c.photoIndex) || c.photoIndex < 0 || c.photoIndex >= count || seen.has(c.photoIndex)) continue;
      seen.add(c.photoIndex);
      const fx = finite(c.focusX) ? clamp(c.focusX, 0, 1) : 0.5;
      const fy = finite(c.focusY) ? clamp(c.focusY, 0, 1) : 0.5;
      const zoom = finite(c.zoom) ? clamp(c.zoom, 1, 2.5) : 1;
      cells.push({ photoIndex: c.photoIndex, focusX: round(fx, 4), focusY: round(fy, 4), zoom: round(zoom, 3) });
    }
    if (cells.length !== cellsIn.length || cells.length !== count) issues.push("cells");
    for (let i = 0; i < count; i++) if (!seen.has(i)) cells.push({ photoIndex: i, focusX: 0.5, focusY: 0.5, zoom: 1 });
    cells.sort((a, b) => a.photoIndex - b.photoIndex);

    let caption = null;
    if (raw.caption && typeof raw.caption === "object") {
      const title = cleanText(raw.caption.title, TITLE_MAX);
      const subtitle = cleanText(raw.caption.subtitle, SUBTITLE_MAX);
      if (title || subtitle) {
        const color = normalizeHex(raw.caption.color);
        caption = {
          title,
          subtitle,
          align: ALIGNS.includes(raw.caption.align) ? raw.caption.align : fix("caption.align", "center"),
          color: color && contrast(color, background) >= 2.2 ? color : fix("caption.color", readableOn(background)),
          position: POSITIONS.includes(raw.caption.position) ? raw.caption.position : fix("caption.position", "bottom"),
          font: FONTS.includes(raw.caption.font) ? raw.caption.font : fix("caption.font", "modern"),
        };
      }
    } else if (raw.caption !== null && raw.caption !== undefined) issues.push("caption");

    const hero = heroSlot(template);
    const heroIndex = isInt(raw.heroIndex) && raw.heroIndex >= 0 && raw.heroIndex < count
      ? raw.heroIndex
      : fix("heroIndex", hero !== null ? order[hero] : order[0]);
    const purpose = PURPOSES.includes(raw.purpose) ? raw.purpose : brief.purpose !== "auto" ? brief.purpose : fallback.purpose;
    const plan = {
      templateId: template.id,
      ratio,
      order: order.slice(),
      heroIndex,
      cells,
      gap,
      margin,
      radius,
      background,
      caption,
      labels: template.family === "split" ? raw.labels !== false : false,
      purpose,
      reason: cleanText(raw.reason, REASON_MAX),
    };
    return { plan: applyExplicit(plan, brief), issues };
  }

  /** Satıcının açıkça verdiği değerler planın önüne geçer */
  function applyExplicit(planInput, briefInput) {
    const brief = ensureBrief(briefInput);
    const plan = { ...planInput, order: planInput.order.slice(), cells: planInput.cells.map((c) => ({ ...c })), caption: planInput.caption ? { ...planInput.caption } : null };
    const template = templateById(plan.templateId);
    if (brief.ratio !== "auto") plan.ratio = brief.ratio;
    if (brief.caption.mode === "none") plan.caption = null;
    else if (brief.caption.mode === "custom") {
      const { title, subtitle } = brief.caption;
      if (!title && !subtitle) plan.caption = null;
      else {
        const base = plan.caption || { align: "center", position: "bottom", font: "modern", color: readableOn(plan.background) };
        plan.caption = { ...base, title, subtitle };
      }
    }
    if (brief.brandColor) {
      const brand = brief.brandColor;
      const usesBrand = (hex) => hex && Math.hypot(...hexToRgb(hex).map((c, i) => c - hexToRgb(brand)[i])) < 24;
      if (!usesBrand(plan.background) && !(plan.caption && usesBrand(plan.caption.color))) {
        if (plan.caption && contrast(brand, plan.background) >= 3) plan.caption.color = brand;
        else {
          plan.background = mixHex(brand, "#FFFFFF", 0.86);
          if (plan.caption) plan.caption.color = contrast(brand, plan.background) >= 3 ? brand : readableOn(plan.background);
        }
      }
    }
    if (plan.caption && contrast(plan.caption.color, plan.background) < 2.2) plan.caption.color = readableOn(plan.background);
    const hero = heroSlot(template);
    if (isInt(brief.heroIndex) && brief.heroIndex < plan.order.length) {
      const slot = hero !== null ? hero : 0;
      const at = plan.order.indexOf(brief.heroIndex);
      if (at !== slot && at >= 0) { plan.order[at] = plan.order[slot]; plan.order[slot] = brief.heroIndex; }
      plan.heroIndex = brief.heroIndex;
    }
    if (brief.purpose === "before_after" && template && template.family === "split") plan.labels = true;
    return plan;
  }

  return {
    templates,
    templatesFor,
    templateById,
    heroSlot,
    cellAspects,
    placementLoss,
    assignPhotos,
    pickLayout,
    smartZoom,
    validateBrief,
    fallbackPlan,
    validatePlan,
    applyExplicit,
    inferPurpose,
  };
}

module.exports = createCollagePlanner;
Object.assign(module.exports, {
  RATIOS,
  PURPOSES,
  MOODS,
  FONTS,
  ALIGNS,
  POSITIONS,
  CAPTION_MODES,
  LIMITS,
  MAX_PHOTOS,
  TITLE_MAX,
  SUBTITLE_MAX,
  PROFILES,
  MOOD_LOOK,
  normalizeHex,
  hexToRgb,
  rgbToHex,
  mixHex,
  luminance,
  contrast,
  readableOn,
  cleanText,
  ratioValue,
  cropLoss,
  hungarian,
  analyzePixels,
});
