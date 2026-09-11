// GPT Image 2.5 Sunburst edit schema. Do not forward provider-specific NB fields.
// Kalite: app_config.gpt25_quality ("low" | "medium" | "high", varsayılan "high") — sunucu 60 sn önbellekler,
// tablo değişince yeniden deploy gerekmez. (nb2_thinking_level ile aynı desen.)
const { createClient } = require('@supabase/supabase-js');
const GPT25_EDIT_MODEL = 'openai/gpt-image-2.5/sunburst/edit';
/** Kitler için Flare varyantı: aynı fiyat, daha düşük gecikme (Sunburst ince detay için araçlarda kalıyor). */
const GPT25_FLARE_EDIT_MODEL = 'openai/gpt-image-2.5/flare/edit';
const GPT25_QUALITIES = ['low', 'medium', 'high', 'xhigh'];
const GPT25_DEFAULT_QUALITY = 'high'; // 11 Eyl 2026 (kullanıcı kararı): V1 genel kalite medium → high
/** V2 (35 kredi) üretimleri: app_config.gpt25_quality_v2, varsayılan "high"; app_config.v2_model
 *  ("gpt25" | "nbpro", varsayılan "gpt25") V2'nin önce hangi sağlayıcıya gideceğini seçer —
 *  nano-banana-pro her durumda yedek olarak kalır. */
const GPT25_DEFAULT_QUALITY_V2 = 'high';
const V2_MODELS = ['gpt25', 'nbpro'];
const V2_DEFAULT_MODEL = 'gpt25';
const QUALITY_TTL_MS = 60 * 1000;

let cachedQuality = GPT25_DEFAULT_QUALITY;
let cachedQualityV2 = GPT25_DEFAULT_QUALITY_V2;
let cachedV2Model = V2_DEFAULT_MODEL;
let cachedAt = 0;
let inflight = null;
let supabase = null;
function db() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return supabase;
}
function normalizeQuality(v) {
  const s = String(v || '').trim().toLowerCase();
  return GPT25_QUALITIES.includes(s) ? s : null;
}
/** app_config.gpt25_quality → önbellekli; hata/kolon yoksa varsayılan. */
async function refreshGpt25Quality() {
  const client = db();
  if (!client) return cachedQuality;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await client.from('app_config').select('gpt25_quality, gpt25_quality_v2, v2_model').limit(1).maybeSingle();
      const v = normalizeQuality(data && data.gpt25_quality);
      if (v) cachedQuality = v;
      const v2 = normalizeQuality(data && data.gpt25_quality_v2);
      if (v2) cachedQualityV2 = v2;
      const m = String((data && data.v2_model) || '').trim().toLowerCase();
      if (V2_MODELS.includes(m)) cachedV2Model = m;
    } catch (e) {
      // kolon yoksa / ağ hatası → son bilinen değer kalır
    } finally {
      cachedAt = Date.now();
      inflight = null;
    }
    return cachedQuality;
  })();
  return inflight;
}
/** Senkron okuma (buildEditInput için): süresi dolduysa arka planda tazeler, elde olan değeri döner. */
function getGpt25Quality() {
  if (Date.now() - cachedAt > QUALITY_TTL_MS) refreshGpt25Quality().catch(() => {});
  return cachedQuality;
}
/** V2 kalitesi (varsayılan high) — aynı önbellek. */
function getGpt25QualityV2() {
  if (Date.now() - cachedAt > QUALITY_TTL_MS) refreshGpt25Quality().catch(() => {});
  return cachedQualityV2;
}
/** V2 birincil sağlayıcı: "gpt25" (varsayılan) | "nbpro". */
function getV2Model() {
  if (Date.now() - cachedAt > QUALITY_TTL_MS) refreshGpt25Quality().catch(() => {});
  return cachedV2Model;
}
// İlk yükleme
refreshGpt25Quality().catch(() => {});

/* GPT 2.5 sabit çıktı boyutları (~4 MP, ürün sahibi kararı): orana göre tam boyut; "auto"/"original"/bilinmeyen → 'auto'.
   Bilinen oranlar dışında ("21:9" gibi) fal'ın kendi mantığına bırakılır. */
const GPT25_IMAGE_SIZES = Object.freeze({
  // ~4 MP hedefi, 16'nın katına yuvarlanmış (oran korunur)
  '1:1':  { width: 2000, height: 2000 },
  '9:16': { width: 1440, height: 2560 },
  '16:9': { width: 2560, height: 1440 },
  '3:4':  { width: 1728, height: 2304 },
  '4:3':  { width: 2304, height: 1728 },
  '4:5':  { width: 1792, height: 2240 },
  '5:4':  { width: 2240, height: 1792 },
  '2:3':  { width: 1632, height: 2448 },
  '3:2':  { width: 2448, height: 1632 },
  '21:9': { width: 3024, height: 1296 },
});
function gpt25ImageSize(ratio) {
  if (!ratio || ratio === 'auto' || ratio === 'original') return 'auto';
  const key = String(ratio).replace(/\s+/g, '');
  if (GPT25_IMAGE_SIZES[key]) return { ...GPT25_IMAGE_SIZES[key] };
  return 'auto';
}
/** Kaynak görselin en-boy oranına en yakın tablo ORANI ("3:4" gibi) — "Orijinal" seçimi için; geçersizse null. */
function gpt25NearestRatio(width, height) {
  const w = Number(width), h = Number(height);
  if (!(w > 0 && h > 0)) return null;
  const target = w / h; let best = null, bestDiff = Infinity;
  for (const [key, size] of Object.entries(GPT25_IMAGE_SIZES)) {
    const d = Math.abs(Math.log(size.width / size.height) - Math.log(target));
    if (d < bestDiff) { bestDiff = d; best = key; }
  }
  return best;
}
/** Kaynak görselin en-boy oranına en yakın tablo boyutu ("Orijinal" seçimi için). */
function gpt25ImageSizeFromDims(width, height) {
  const best = gpt25NearestRatio(width, height);
  return best ? { ...GPT25_IMAGE_SIZES[best] } : 'auto';
}
/** Uzak görselin boyutunu okur (sharp metadata) — "Orijinal" oran için; hata → null. */
async function probeImageDims(url, timeoutMs = 15000) {
  try {
    const axios = require('axios'); const sharp = require('sharp');
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: timeoutMs, maxContentLength: 40 * 1024 * 1024 });
    const m = await sharp(Buffer.from(r.data)).metadata();
    return m.width && m.height ? { width: m.width, height: m.height } : null;
  } catch (e) { return null; }
}
function buildEditInput(model, input) {
  if (model !== GPT25_EDIT_MODEL) return input;
  return {
    prompt: input.prompt,
    image_urls: input.image_urls,
    /* image_size: açık verilmişse o; oran tabloda ise ~4 MP sabit boyut; "auto"/"original" + source_size varsa kaynağa en yakın oran; aksi hâlde fal 'auto' */
    image_size: input.image_size
      || (['auto', 'original', undefined, null, ''].includes(input.aspect_ratio) && input.source_size ? gpt25ImageSizeFromDims(input.source_size.width, input.source_size.height) : gpt25ImageSize(input.aspect_ratio)),
    quality: normalizeQuality(input.quality) || getGpt25Quality(),
    num_images: input.num_images || 1,
    output_format: input.output_format || 'png',
    ...(input.mask_url ? {mask_url: input.mask_url} : {}),
  };
}
module.exports = {GPT25_EDIT_MODEL, GPT25_FLARE_EDIT_MODEL, GPT25_DEFAULT_QUALITY_V2, V2_MODELS, V2_DEFAULT_MODEL, getGpt25QualityV2, getV2Model, GPT25_IMAGE_SIZES, GPT25_QUALITIES, GPT25_DEFAULT_QUALITY, gpt25ImageSize, gpt25NearestRatio, gpt25ImageSizeFromDims, probeImageDims, buildEditInput, getGpt25Quality, refreshGpt25Quality};
