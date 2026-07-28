// 🔍 SONUÇ NETLEŞTİRME — üretim biter bitmez sonucu seçilen megapiksele yükseltir.
// Results ekranındaki MP butonu 4'ten büyük seçildiğinde devreye girer; 4 "kapalı"
// demektir. Model ve parametreler RefinerScreen'deki akışla aynı
// (prunaai/p-image-upscale, target modu).
//
// Bu dosya referenceBrowserRoutesV7 (model üretimi) ve createRefiner (refiner)
// route'larının ORTAK kaynağıdır — iki akış da aynı tarife, aynı model ve aynı
// aşama işaretini kullanır.
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const logger = require("./logger");
const teamService = require("../services/teamService");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const RESULT_UPSCALE_MODEL_VERSION =
  "b998e77850c393ccddb1a4c32e5c298c91f89f2af9d9fc72bb85e1949fd80ae3";
const RESULT_UPSCALE_ALLOWED_MP = [8, 16, 32, 64, 128];

// 🔍 Netleştirme kredi tarifesi — RefinerScreen'deki tabloyla aynı mantık:
// taban 10 kredi, kademe başına maliyetle orantılı artış. 4 MP zaten "kapalı"
// olduğu için burada yer almaz (ek işlem yapılmaz → ücret de yok).
const RESULT_UPSCALE_CREDIT_BY_MP = { 8: 20, 16: 40, 32: 80, 64: 120, 128: 240 };

// Netleştirme için krediyi atomic olarak düşer. Yetersizse false döner ve
// çağıran taraf netleştirmeyi hiç başlatmaz (üretim yine de teslim edilir).
async function chargeUpscaleCredits(userId, targetMp) {
  const cost = RESULT_UPSCALE_CREDIT_BY_MP[Number(targetMp)];
  if (!cost) return { charged: 0, ok: false };
  if (!userId || userId === "anonymous_user") return { charged: 0, ok: false };

  try {
    const effectiveCredits = await teamService.getEffectiveCredits(userId);
    const creditOwnerId = effectiveCredits.creditOwnerId || userId;
    const balance = effectiveCredits.creditBalance || 0;

    if (balance < cost) {
      logger.warn(
        `💳 [UPSCALE-CREDIT] Yetersiz kredi (var: ${balance}, gerekli: ${cost}) — netleştirme atlanıyor`,
      );
      return { charged: 0, ok: false };
    }

    const { error } = await supabase.rpc("deduct_user_credit", {
      user_id: creditOwnerId,
      credit_amount: cost,
    });
    if (error) {
      logger.warn("💳 [UPSCALE-CREDIT] Kredi düşülemedi:", error.message);
      return { charged: 0, ok: false };
    }
    logger.log(`💳 [UPSCALE-CREDIT] ${cost} kredi düşüldü (${targetMp} MP)`);
    return { charged: cost, ok: true };
  } catch (err) {
    logger.warn("💳 [UPSCALE-CREDIT] Hata:", err?.message);
    return { charged: 0, ok: false };
  }
}

// Üretim kaydına ara aşama işareti yazar (settings.stage). Polling bu alanı
// okuyup Results kartında durum rozeti gösterir. Hata durumunda sessiz geçilir —
// bu yalnızca görsel geri bildirim, üretimi bloklamamalı.
async function markGenerationStage(generationId, userId, stage) {
  try {
    if (!generationId || !userId) return;
    const { data: rows } = await supabase
      .from("reference_results")
      .select("settings")
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .limit(1);
    const current = rows?.[0]?.settings || {};
    await supabase
      .from("reference_results")
      .update({ settings: { ...current, stage } })
      .eq("generation_id", generationId)
      .eq("user_id", userId);
  } catch (err) {
    logger.warn("⚠️ [STAGE] Aşama işareti yazılamadı:", err?.message);
  }
}

async function upscaleResultImage(imageUrl, targetMp) {
  const mp = Number(targetMp);
  if (!RESULT_UPSCALE_ALLOWED_MP.includes(mp)) return null;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token || !imageUrl) return null;

  const created = await axios.post(
    "https://api.replicate.com/v1/predictions",
    {
      version: RESULT_UPSCALE_MODEL_VERSION,
      input: {
        image: imageUrl,
        upscale_mode: "target",
        target: mp,
        output_format: "jpg",
        output_quality: 95,
        enhance_details: true,
        disable_safety_checker: true,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      timeout: 180000,
    },
  );

  let prediction = created.data;
  for (
    let i = 0;
    i < 90 && ["starting", "processing"].includes(prediction?.status);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await axios.get(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 },
    );
    prediction = poll.data;
  }

  if (prediction?.status !== "succeeded") {
    throw new Error(
      `Result upscale failed: ${prediction?.error || prediction?.status || "unknown"}`,
    );
  }
  const out = prediction.output;
  const url = Array.isArray(out) ? out[0] : out;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

// 🔍 Ortak sarmalayıcı — kredi → aşama işareti → netleştirme → aşama temizliği.
// Hata durumunda ORİJİNAL sonuçla devam edilir; üretim asla kaybolmaz.
// Dönüş: { imageUrl, appliedMp, preUpscaleUrl }
async function applyResultUpscale({
  imageUrl,
  upscaleMp,
  userId,
  generationId,
  logTag = "RESULT UPSCALE",
}) {
  const result = { imageUrl, appliedMp: null, preUpscaleUrl: null };
  if (!imageUrl || !RESULT_UPSCALE_ALLOWED_MP.includes(Number(upscaleMp))) {
    return result;
  }

  try {
    // Önce kredi: yetersizse netleştirme hiç başlatılmaz, üretim sonucu
    // olduğu gibi teslim edilir (kullanıcı üretimini kaybetmez).
    const charge = await chargeUpscaleCredits(userId, upscaleMp);
    if (!charge.ok) throw new Error("UPSCALE_CREDIT_UNAVAILABLE");

    logger.log(
      `🔍 [${logTag}] Sonuç ${upscaleMp} MP'ye yükseltiliyor (${charge.charged} kredi)...`,
    );
    // İstemci polling'i "Netleştiriliyor…" rozetini bu işaretten okur.
    await markGenerationStage(generationId, userId, "upscaling");

    const startedAt = Date.now();
    const upscaled = await upscaleResultImage(imageUrl, upscaleMp);
    if (upscaled) {
      result.preUpscaleUrl = imageUrl;
      result.imageUrl = upscaled;
      result.appliedMp = Number(upscaleMp);
      logger.log(
        `✅ [${logTag}] ${result.appliedMp} MP tamamlandı (${Date.now() - startedAt}ms)`,
      );
    }
    // Aşama işaretini temizle — kart "Netleştiriliyor…" ile takılı kalmasın
    await markGenerationStage(generationId, userId, null);
  } catch (err) {
    logger.warn(
      `⚠️ [${logTag}] Netleştirme başarısız, orijinal sonuç kullanılıyor:`,
      err?.message,
    );
    await markGenerationStage(generationId, userId, null);
  }

  return result;
}

module.exports = {
  RESULT_UPSCALE_ALLOWED_MP,
  RESULT_UPSCALE_CREDIT_BY_MP,
  chargeUpscaleCredits,
  markGenerationStage,
  upscaleResultImage,
  applyResultUpscale,
};
