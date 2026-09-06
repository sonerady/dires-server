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
const { UPSCALE_CREDITS } = require("./generationCredits");

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
const RESULT_UPSCALE_CREDIT_BY_MP = UPSCALE_CREDITS;

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

    const { data, error } = await supabase.rpc("deduct_user_credit", {
      user_id: creditOwnerId,
      credit_amount: cost,
    });
    if (error || data === false || data?.success === false) {
      logger.warn("💳 [UPSCALE-CREDIT] Kredi düşülemedi:", error?.message || "rejected");
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

// Temel üretim önce ödenir; MP ücreti yalnızca başarılı netleştirmeden sonra
// kesilir. Başarısız/boş/zaman aşımına uğrayan MP işlemi ücretlendirilmez.
async function applyResultUpscale({
  imageUrl,
  upscaleMp,
  userId,
  generationId,
  ensureBaseCharge,
  logTag = "RESULT UPSCALE",
}) {
  const result = { imageUrl, appliedMp: null, preUpscaleUrl: null, creditsCharged: 0 };
  const cost = RESULT_UPSCALE_CREDIT_BY_MP[Number(upscaleMp)];
  if (!imageUrl || !cost || !userId || userId === "anonymous_user") return result;

  try {
    // Callback mevcut üretim ücretini ve creditDeducted kontrolünü kullanır.
    // Bu kesinti onaylanmadan MP bakiyesine dokunulmaz.
    if (typeof ensureBaseCharge !== "function" || !(await ensureBaseCharge())) {
      throw new Error("BASE_GENERATION_CREDIT_UNAVAILABLE");
    }
    const available = await teamService.getEffectiveCredits(userId);
    if ((available.creditBalance || 0) < cost) {
      throw new Error("UPSCALE_CREDIT_UNAVAILABLE");
    }

    await markGenerationStage(generationId, userId, "upscaling");
    const upscaled = await upscaleResultImage(imageUrl, upscaleMp);
    if (!upscaled) throw new Error("UPSCALE_EMPTY_RESULT");

    // İşlem sırasında bakiye değişmiş olabilir; gerçek kesinti tekrar atomik
    // RPC üzerinden yapılır. Kesinti reddedilirse orijinal sonuç teslim edilir.
    const charge = await chargeUpscaleCredits(userId, upscaleMp);
    if (!charge.ok) throw new Error("UPSCALE_CREDIT_UNAVAILABLE");

    result.preUpscaleUrl = imageUrl;
    result.imageUrl = upscaled;
    result.appliedMp = Number(upscaleMp);
    result.creditsCharged = charge.charged;
    logger.log(`✅ [${logTag}] ${result.appliedMp} MP tamamlandı (${charge.charged} kredi)`);
  } catch (err) {
    logger.warn(`⚠️ [${logTag}] Orijinal sonuç kullanılıyor:`, err?.message);
  } finally {
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
