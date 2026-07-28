const express = require("express");
const router = express.Router();
const axios = require("axios");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");
const { getEffectiveCredits } = require("../services/teamService");

const FAL_ENDPOINT = "https://fal.run/clarityai/crystal-upscaler"; // (eski sağlayıcı — artık kullanılmıyor)

// ============================================================================
// 🔍 UPSCALE SAĞLAYICISI — Replicate prunaai/p-image-upscale
// ----------------------------------------------------------------------------
// "target" modunda çıktı çözünürlüğü megapiksel olarak verilir; model 128 MP'ye
// kadar destekliyor. Replicate fiyatlandırması kademeli (çıktı MP'sine göre):
//   1-4MP $0.005 · 4-8MP $0.01 · 8-16MP $0.02 · 16-32MP $0.04 · 32-64MP $0.06 · 64-128MP $0.12
// Kredi tablosu bu maliyetle orantılı kurgulandı (aşağıdaki UPSCALE_CREDIT_BY_MP).
// ============================================================================
const REPLICATE_UPSCALE_MODEL = "prunaai/p-image-upscale";
const REPLICATE_UPSCALE_VERSION =
  "b998e77850c393ccddb1a4c32e5c298c91f89f2af9d9fc72bb85e1949fd80ae3";

// Kullanıcının seçebileceği hedef çözünürlükler (megapiksel)
const UPSCALE_MP_OPTIONS = [4, 8, 16, 32, 64, 128];
const DEFAULT_UPSCALE_MP = 4;

// Kredi maliyeti — taban 10 kredi (en düşük kademe), üstü Replicate maliyetiyle
// orantılı ikişer kat. (1 kredi ≈ $0.025 · 600 kredi = $15 paketi baz alındı)
//   4MP   → 10 kredi ($0.25 gelir / $0.005 maliyet)
//   8MP   → 20 kredi ($0.50 / $0.01)
//   16MP  → 40 kredi ($1.00 / $0.02)
//   32MP  → 80 kredi ($2.00 / $0.04)
//   64MP  →120 kredi ($3.00 / $0.06)
//   128MP →240 kredi ($6.00 / $0.12)
const UPSCALE_CREDIT_BY_MP = { 4: 10, 8: 20, 16: 40, 32: 80, 64: 120, 128: 240 };

// İstemciden gelen değeri güvenli aralığa oturt
function normalizeTargetMp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_UPSCALE_MP;
  return UPSCALE_MP_OPTIONS.includes(n) ? n : DEFAULT_UPSCALE_MP;
}

function creditCostForMp(targetMp) {
  return UPSCALE_CREDIT_BY_MP[normalizeTargetMp(targetMp)] || UPSCALE_CREDIT_BY_MP[DEFAULT_UPSCALE_MP];
}

// Replicate prediction: oluştur → tamamlanana kadar bekle → çıktı URL'i döner.
async function runReplicateUpscale(imageUrl, targetMp) {
  const mp = normalizeTargetMp(targetMp);
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN missing");

  const created = await axios.post(
    "https://api.replicate.com/v1/predictions",
    {
      version: REPLICATE_UPSCALE_VERSION,
      input: {
        image: imageUrl,
        upscale_mode: "target",
        target: mp,
        output_format: "jpg",
        output_quality: 95,
        enhance_details: true,
        // Ürün fotoğrafları zararsız; güvenlik filtresi yanlış pozitif verip
        // işi düşürmesin diye kapatıldı.
        disable_safety_checker: true,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait", // model <1sn çalışıyor; çoğu istekte tek çağrıda biter
      },
      timeout: 180000,
    },
  );

  let prediction = created.data;
  // Prefer: wait ile bitmediyse kısa aralıklarla yokla
  for (let i = 0; i < 90 && ["starting", "processing"].includes(prediction?.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await axios.get(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 },
    );
    prediction = poll.data;
  }

  if (prediction?.status !== "succeeded") {
    throw new Error(
      `Replicate upscale failed: ${prediction?.error || prediction?.status || "unknown"}`,
    );
  }

  const out = prediction.output;
  const url = Array.isArray(out) ? out[0] : out;
  if (typeof url !== "string" || !url.startsWith("http")) {
    throw new Error("Replicate upscale returned no image URL");
  }
  return url;
}

// Helper: FAL'dan dönen geçici imajı user_image_results bucket'ına yükler ve
// kalıcı api.diress.ai public URL'sini döner. Hata durumunda orijinal URL'yi döner
// (downstream akış kırılmasın). changeProductColor.js'teki saveResultImageToUserBucket
// pattern'iyle birebir aynı.
const saveResultImageToUserBucket = async (resultImageUrl, userId) => {
  try {
    if (!resultImageUrl || !userId) return { url: resultImageUrl, thumbUrl: null };
    const imageResponse = await axios.get(resultImageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    const imageBuffer = Buffer.from(imageResponse.data);
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    const fileName = `${userId}/${timestamp}_upscale_${randomId}.jpg`;
    const { error } = await supabase.storage
      .from("user_image_results")
      .upload(fileName, imageBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });
    if (error) {
      console.error("❌ [UPSCALE-BUCKET] Upload hatası:", error.message);
      return { url: resultImageUrl, thumbUrl: null };
    }
    const { data: urlData } = supabase.storage
      .from("user_image_results")
      .getPublicUrl(fileName);

    // 🖼️ Küçük önizleme — netleştirilmiş çıktı 30 MB'ı aşabiliyor ve Cloudflare
    // Image Resizing bu boyutta 403 dönüyor; geçmiş ızgarası CDN thumbnail'ına
    // güvendiği için kartlar boş görünüyordu. Thumbnail'ı burada kendimiz üretiriz.
    let thumbUrl = null;
    try {
      const thumbBuffer = await sharp(imageBuffer)
        .rotate()
        .resize(600, 600, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const thumbName = fileName.replace(/\.jpg$/, "_thumb.jpg");
      const { error: thumbErr } = await supabase.storage
        .from("user_image_results")
        .upload(thumbName, thumbBuffer, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        });
      if (!thumbErr) {
        const { data: thumbData } = supabase.storage
          .from("user_image_results")
          .getPublicUrl(thumbName);
        thumbUrl = thumbData?.publicUrl || null;
      }
    } catch (thumbException) {
      console.warn("⚠️ [UPSCALE-BUCKET] Thumbnail üretilemedi:", thumbException?.message);
    }

    return { url: urlData?.publicUrl || resultImageUrl, thumbUrl };
  } catch (err) {
    console.error("❌ [UPSCALE-BUCKET] Exception:", err?.message);
    return { url: resultImageUrl, thumbUrl: null };
  }
};

// Helper: Get file size via HEAD request
const getRemoteFileSize = async (url) => {
  if (!url) return null;
  try {
    const headResponse = await axios.head(url, { timeout: 10000 });
    const contentLength = headResponse.headers["content-length"];
    if (contentLength) {
      const parsed = parseInt(contentLength, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (err) {
    console.warn("⚠️ [UPSCALE] File size HEAD request failed:", err.message);
  }
  return null;
};

router.post("/", async (req, res) => {
  // Hedef çözünürlük (MP) → kredi. İstemci göndermezse 4MP/5 kredi.
  const targetMp = normalizeTargetMp(req.body?.targetMp);
  const CREDIT_COST = creditCostForMp(targetMp);
  let creditDeducted = false;
  let creditOwnerId;
  let userId;
  let creditBalanceBefore = null;
  let creditBalanceAfter = null;

  try {
    const {
      imageUrl,
      scale = 2, // desired_increase parametresi için
      preserveAlpha = true,
      contentModeration = false,
      userId: requestUserId,
    } = req.body;
    userId = requestUserId;

    console.log("1. Received request with data:", {
      imageUrl,
      scale,
      preserveAlpha,
      contentModeration,
      userId,
    });

    if (!imageUrl) {
      console.log("Error: No image URL provided");
      return res.status(400).json({ error: "Image URL is required" });
    }

    // 🔗 TEAM-AWARE: Kredi kontrolü ve düşme
    creditOwnerId = userId; // Kredi sahibi (team owner veya kendisi)

    if (userId && userId !== "anonymous_user") {
      try {
        console.log("💰 [BACKEND] Team-aware kredi kontrolü yapılıyor, userId:", userId);

        // Team-aware kredi bilgisi al
        const effectiveCredits = await getEffectiveCredits(userId);
        const currentCredit = effectiveCredits.creditBalance || 0;
        creditOwnerId = effectiveCredits.creditOwnerId;
        creditBalanceBefore = currentCredit;

        console.log(
          `💳 [BACKEND] Team-aware kredi: ${currentCredit}, gerekli: ${CREDIT_COST}, Yeterli mi? ${currentCredit >= CREDIT_COST ? "EVET ✅" : "HAYIR ❌"}`,
          effectiveCredits.isTeamCredit ? `(team owner: ${creditOwnerId})` : "(kendi kredisi)"
        );

        if (currentCredit < CREDIT_COST) {
          console.log(
            `❌ [BACKEND] Kredi yetersiz! ${currentCredit} < ${CREDIT_COST}, 402 dönüyor`
          );
          return res.status(402).json({
            success: false,
            error: "Yetersiz kredi",
            requiredCredit: CREDIT_COST,
            currentCredit: currentCredit,
          });
        }

        console.log(
          `✅ [BACKEND] Kredi yeterli! ${currentCredit} >= ${CREDIT_COST}, devam ediliyor...`
        );

        // Krediyi doğru hesaptan düş (team owner veya kendisi)
        const { error: updateError } = await supabase
          .from("users")
          .update({ credit_balance: currentCredit - CREDIT_COST })
          .eq("id", creditOwnerId);

        if (updateError) {
          console.error("❌ Kredi düşme hatası:", updateError);
          return res.status(500).json({
            success: false,
            error: "Kredi düşülemedi",
          });
        }

        creditDeducted = true;
        creditBalanceAfter = currentCredit - CREDIT_COST;
        console.log(
          `✅ ${CREDIT_COST} kredi düşüldü (${creditOwnerId === userId ? "kendi hesabından" : "team owner hesabından"}). Kalan: ${creditBalanceAfter}`
        );
      } catch (creditManagementError) {
        console.error("❌ Kredi yönetimi hatası:", creditManagementError);
        return res.status(500).json({
          success: false,
          error: "Kredi yönetimi sırasında hata oluştu",
        });
      }
    }

    console.log(
      `2. Starting Replicate call (${REPLICATE_UPSCALE_MODEL}) — target ${targetMp}MP, ${CREDIT_COST} kredi...`,
    );
    const tFalStart = Date.now();

    const resultImageUrl = await runReplicateUpscale(imageUrl, targetMp);

    const falElapsed = Date.now() - tFalStart;
    console.log(`3. Replicate response received (took ${falElapsed} ms)`);
    const output = { url: resultImageUrl, target_mp: targetMp };

    // FAL imajını user_image_results bucket'ına yükle → kalıcı api.diress URL'i.
    // (signed-expiry sorunu yok, frontend'de download/share çalışır)
    let finalImageUrl = resultImageUrl;
    let resultThumbUrl = null;
    if (userId && userId !== "anonymous_user") {
      const saved = await saveResultImageToUserBucket(resultImageUrl, userId);
      finalImageUrl = saved.url;
      resultThumbUrl = saved.thumbUrl;
    }

    // ✅ Client'a kalıcı URL ile dön — file size lookup ve DB insert ARKA PLANDA yapılır.
    const response = {
      success: true,
      input: imageUrl,
      output: finalImageUrl,
      rawOutput: output,
      enhancedImageUrl: finalImageUrl,
    };
    const tResponseSent = Date.now();
    console.log(`4. Sending response to client (Fal→Response delay: ${tResponseSent - tFalStart - falElapsed} ms)`);
    res.json(response);

    // 🚀 Fire-and-forget: file size + DB insert (client'ı bekletmeden)
    if (userId && userId !== "anonymous_user") {
      (async () => {
        try {
          const [originalSize, resultSize] = await Promise.all([
            getRemoteFileSize(imageUrl),
            getRemoteFileSize(finalImageUrl),
          ]);

          const { error: insertError } = await supabase
            .from("upscale_generations")
            .insert({
              user_id: userId,
              status: "completed",
              original_image_url: imageUrl,
              result_image_url: finalImageUrl,
              result_thumb_url: resultThumbUrl,
              original_size_bytes: originalSize,
              result_size_bytes: resultSize,
              scale: targetMp,
              credits_cost: CREDIT_COST,
              credit_balance_before: creditBalanceBefore,
              credit_balance_after: creditBalanceAfter,
            });

          if (insertError) {
            console.error("⚠️ [UPSCALE-BG] DB insert error:", insertError);
          } else {
            console.log("✅ [UPSCALE-BG] Saved to upscale_generations table", {
              originalSize,
              resultSize,
              bgElapsedMs: Date.now() - tResponseSent,
            });
          }
        } catch (bgError) {
          console.error("⚠️ [UPSCALE-BG] background task error:", bgError.message);
        }
      })();
    }
  } catch (error) {
    console.error("❌ [BACKEND] Image enhancement error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      errorType: error.constructor.name,
    });

    // Save failed generation to DB
    if (userId && userId !== "anonymous_user") {
      try {
        await supabase.from("upscale_generations").insert({
          user_id: userId,
          status: "failed",
          original_image_url: req.body?.imageUrl || null,
          result_image_url: null,
          scale: Number(req.body?.scale) || 2,
          credits_cost: CREDIT_COST,
          credit_balance_before: creditBalanceBefore,
          credit_balance_after: creditDeducted ? creditBalanceAfter : creditBalanceBefore,
        });
        console.log("✅ [UPSCALE] Failed generation saved to DB");
      } catch (dbError) {
        console.error("⚠️ [UPSCALE] Failed to save error to DB:", dbError.message);
      }
    }

    // 🔗 TEAM-AWARE: Hata durumunda kredi iade et (doğru hesaba)
    if (creditDeducted && creditOwnerId && creditOwnerId !== "anonymous_user") {
      try {
        console.log(
          `💰 [BACKEND] Kredi iade ediliyor, creditOwnerId: ${creditOwnerId}, amount: ${CREDIT_COST}`
        );
        const { data: currentOwnerCredit } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", creditOwnerId)
          .single();

        await supabase
          .from("users")
          .update({
            credit_balance:
              (currentOwnerCredit?.credit_balance || 0) + CREDIT_COST,
          })
          .eq("id", creditOwnerId);

        console.log(
          `✅ [BACKEND] ${CREDIT_COST} kredi iade edildi (hata nedeniyle) - ${creditOwnerId === userId ? "kendi hesabına" : "team owner hesabına"}`
        );
      } catch (refundError) {
        console.error("❌ [BACKEND] Kredi iade hatası:", refundError);
      }
    } else {
      console.log(
        `ℹ️ [BACKEND] Kredi iade edilmedi (creditDeducted: ${creditDeducted}, creditOwnerId: ${creditOwnerId})`
      );
    }

    console.log(
      `❌ [BACKEND] 500 hatası dönüyor (Paywall AÇILMAMALI!):`,
      error.message
    );
    res.status(500).json({
      success: false,
      error: "Failed to enhance image",
      errorMessage: error.message,
    });
  }
});

// ============================================================================
// BULK UPSCALE — N resmi paralel netleştir
// ----------------------------------------------------------------------------
// POST /api/imageEnhancement/generate-bulk
// Body: { userId, sessionId, items: [{ imageUrl }] }
// 1–20 item, paralel Fal.ai çağrısı (Promise.allSettled), credit yalnızca
// başarılı item'lardan kesilir. Anonymous user destekli (DB/credit skip).
// ============================================================================
const BULK_MAX_ITEMS = 20;
// Toplu modda kredi de hedef çözünürlüğe göre hesaplanır (tekil akışla aynı tablo).
const BULK_CREDIT_COST = UPSCALE_CREDIT_BY_MP[DEFAULT_UPSCALE_MP];

// ============================================================================
// BULK BATCH STATE — In-memory tracking for async/polling pattern
// ----------------------------------------------------------------------------
// Item bittikçe Map'e yazılır; client polling ile durumu öğrenir.
// 30 dakika sonra eski batches GC edilir.
// ============================================================================
const BULK_BATCH_TTL_MS = 30 * 60 * 1000;
const bulkBatches = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [batchId, batch] of bulkBatches) {
    if (now - batch.createdAt > BULK_BATCH_TTL_MS) {
      bulkBatches.delete(batchId);
    }
  }
}, 5 * 60 * 1000);

async function processBulkUpscaleItem({
  userId,
  creditOwnerId,
  imageUrl,
  index,
  batchId,
  targetMp = DEFAULT_UPSCALE_MP,
}) {
  const startedAt = Date.now();

  try {
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      throw new Error("INVALID_IMAGE_URL");
    }

    // Replicate p-image-upscale çağrısı (target modunda MP)
    const tFalStart = Date.now();
    const replicateUrl = await runReplicateUpscale(imageUrl, targetMp);
    const falElapsed = Date.now() - tFalStart;
    console.log(
      `✓ [BULK_UPSCALE] Item ${index} Replicate response received in ${falElapsed}ms (${targetMp}MP)`,
    );

    const resultUrl = replicateUrl;

    // FAL imajını user_image_results bucket'ına yükle → kalıcı api.diress URL'i.
    // (signed-expiry sorunu yok, frontend download/share/history çalışır)
    let finalImageUrl = resultUrl;
    let resultThumbUrl = null;
    if (userId && userId !== "anonymous_user") {
      const savedBulk = await saveResultImageToUserBucket(resultUrl, userId);
      finalImageUrl = savedBulk.url;
      resultThumbUrl = savedBulk.thumbUrl;
    }

    // ⚡ Critical: Credit kesimi sync (deduct atomic RPC, hızlı). HEAD + DB insert background'a.
    let creditsCharged = 0;
    if (userId && userId !== "anonymous_user" && creditOwnerId) {
      try {
        const { error: deductError } = await supabase.rpc(
          "deduct_user_credit",
          { user_id: creditOwnerId, credit_amount: creditCostForMp(targetMp) }
        );
        if (deductError) {
          console.error(
            `❌ [BULK_UPSCALE] Item ${index} credit deduct failed for ${creditOwnerId}:`,
            deductError
          );
        } else {
          creditsCharged = creditCostForMp(targetMp);
        }
      } catch (creditErr) {
        console.error(
          `⚠️ [BULK_UPSCALE] Item ${index} credit error:`,
          creditErr?.message
        );
      }

      // 🚀 Fire-and-forget: file size lookup + DB insert (client'ı bekletmesin).
      // File size hesaplaması bittiğinde bulkBatches Map'e geriye yansıt — client
      // polling ile bunu sonraki tick'te görüp UI'da "X MB → Y MB" gösterebilir.
      (async () => {
        try {
          const [originalSize, resultSize] = await Promise.all([
            getRemoteFileSize(imageUrl),
            getRemoteFileSize(finalImageUrl),
          ]);

          // Map'teki ilgili item'a size'ları yansıt
          if (batchId) {
            const batch = bulkBatches.get(batchId);
            if (batch && batch.items[index]) {
              batch.items[index].originalSize = originalSize;
              batch.items[index].resultSize = resultSize;
            }
          }

          const { error: insertError } = await supabase
            .from("upscale_generations")
            .insert({
              user_id: userId,
              status: "completed",
              original_image_url: imageUrl,
              result_image_url: finalImageUrl,
              result_thumb_url: resultThumbUrl,
              original_size_bytes: originalSize,
              result_size_bytes: resultSize,
              scale: targetMp,
              credits_cost: creditsCharged,
            });
          if (insertError) {
            console.error(
              `⚠️ [BULK_UPSCALE-BG] Item ${index} DB insert error:`,
              insertError
            );
          }
        } catch (bgError) {
          console.error(
            `⚠️ [BULK_UPSCALE-BG] Item ${index} bg error:`,
            bgError?.message
          );
        }
      })();
    }

    const totalElapsed = Date.now() - startedAt;
    console.log(
      `✅ [BULK_UPSCALE] Item ${index} succeeded (total ${totalElapsed}ms, fal ${falElapsed}ms)`
    );

    return {
      index,
      status: "succeeded",
      generationId: null, // BG'de oluşacak, client için kritik değil
      imageUrl: finalImageUrl,
      originalSize: null, // BG'de hesaplanıyor
      resultSize: null,
      creditsCharged,
      processingTimeSeconds: Math.floor(totalElapsed / 1000),
    };
  } catch (err) {
    const message = err?.message || "UNKNOWN_ERROR";
    console.error(
      `❌ [BULK_UPSCALE] Item ${index} failed:`,
      message,
      err?.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : ""
    );
    // Failed kayıt
    if (userId && userId !== "anonymous_user") {
      try {
        await supabase.from("upscale_generations").insert({
          user_id: userId,
          status: "failed",
          original_image_url: imageUrl || null,
          result_image_url: null,
          scale: targetMp,
          credits_cost: 0,
        });
      } catch (_) {
        // best-effort, ignore
      }
    }
    return {
      index,
      status: "failed",
      error: message,
    };
  }
}

router.post("/generate-bulk", async (req, res) => {
  try {
    const {
      userId: bodyUserId,
      sessionId: rawSessionId,
      items,
    } = req.body || {};

    const userId = req.user?.id || bodyUserId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId zorunludur",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "items boş olamaz",
      });
    }
    if (items.length > BULK_MAX_ITEMS) {
      return res.status(400).json({
        success: false,
        error: `En fazla ${BULK_MAX_ITEMS} resim gönderilebilir`,
      });
    }

    const invalidIdx = items.findIndex(
      (it) =>
        !it ||
        typeof it.imageUrl !== "string" ||
        !it.imageUrl.trim()
    );
    if (invalidIdx !== -1) {
      return res.status(400).json({
        success: false,
        error: `Item ${invalidIdx} geçersiz (imageUrl zorunlu)`,
      });
    }

    const sessionId = rawSessionId || uuidv4();
    const bulkTargetMp = normalizeTargetMp(req.body?.targetMp);
    const requiredCredits = items.length * creditCostForMp(bulkTargetMp);

    // Team-aware credit precheck — endpoint başında 1 KEZ. creditOwnerId'yi tüm
    // item'lara geçeceğiz, böylece her item için ayrıca getEffectiveCredits
    // çağrılmıyor (eski kod ~100-500ms × N item gecikme yapıyordu).
    let creditOwnerId = null;
    if (userId !== "anonymous_user") {
      try {
        const effective = await getEffectiveCredits(userId);
        const available = effective?.creditBalance ?? 0;
        creditOwnerId = effective?.creditOwnerId || userId;
        if (available < requiredCredits) {
          return res.status(402).json({
            success: false,
            error: "INSUFFICIENT_CREDITS",
            required: requiredCredits,
            available,
          });
        }
      } catch (creditErr) {
        console.warn(
          "⚠️ [BULK_UPSCALE] Credit precheck atlandı:",
          creditErr?.message
        );
        creditOwnerId = userId; // fallback
      }
    }

    const tBatchStart = Date.now();
    console.log(
      `🚀 [BULK_UPSCALE] ${items.length} item paralel işlenecek (sessionId=${sessionId}, targetMp=${bulkTargetMp}, creditOwnerId=${creditOwnerId})`
    );

    const settled = await Promise.allSettled(
      items.map((it, i) =>
        processBulkUpscaleItem({
          userId,
          creditOwnerId,
          imageUrl: it.imageUrl,
          index: i,
        targetMp: bulkTargetMp,
      })
      )
    );

    const batchElapsed = Date.now() - tBatchStart;
    console.log(
      `🏁 [BULK_UPSCALE] Batch ${sessionId} tamamlandı in ${batchElapsed}ms (${items.length} items)`
    );

    const results = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
          index: i,
          status: "failed",
          error: s.reason?.message || "UNHANDLED_REJECTION",
        }
    );

    const totalCharged = results
      .filter((r) => r.status === "succeeded")
      .reduce((sum, r) => sum + (r.creditsCharged || 0), 0);

    return res.status(200).json({
      success: true,
      batchSessionId: sessionId,
      results,
      totalCharged,
    });
  } catch (error) {
    console.error("❌ [BULK_UPSCALE] Endpoint hatası:", error);
    return res.status(500).json({
      success: false,
      error: "Bulk işlem hatası",
      errorMessage: error.message,
    });
  }
});

// ============================================================================
// ASYNC BULK UPSCALE — Polling pattern (item-by-item streaming via DB Map)
// ----------------------------------------------------------------------------
// POST /api/imageEnhancement/generate-bulk-async
//   Body: { userId, sessionId?, items: [{ imageUrl }] }
//   Returns immediately: { success, batchSessionId, items: [{ index, status: "processing" }] }
//   Items processed in background, written to bulkBatches Map as they finish.
//
// GET /api/imageEnhancement/generate-bulk-status/:batchId
//   Returns: { success, batchSessionId, items, completed, totalCharged }
//
// Client polls status every ~2s until `completed: true`.
// ============================================================================
router.post("/generate-bulk-async", async (req, res) => {
  try {
    const {
      userId: bodyUserId,
      sessionId: rawSessionId,
      items,
    } = req.body || {};

    const userId = req.user?.id || bodyUserId;
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId zorunludur" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "items boş olamaz" });
    }
    if (items.length > BULK_MAX_ITEMS) {
      return res.status(400).json({
        success: false,
        error: `En fazla ${BULK_MAX_ITEMS} resim gönderilebilir`,
      });
    }

    const invalidIdx = items.findIndex(
      (it) => !it || typeof it.imageUrl !== "string" || !it.imageUrl.trim()
    );
    if (invalidIdx !== -1) {
      return res.status(400).json({
        success: false,
        error: `Item ${invalidIdx} geçersiz (imageUrl zorunlu)`,
      });
    }

    const sessionId = rawSessionId || uuidv4();
    const bulkTargetMp = normalizeTargetMp(req.body?.targetMp);
    const requiredCredits = items.length * creditCostForMp(bulkTargetMp);

    // Credit precheck (1 kez)
    let creditOwnerId = null;
    if (userId !== "anonymous_user") {
      try {
        const effective = await getEffectiveCredits(userId);
        const available = effective?.creditBalance ?? 0;
        creditOwnerId = effective?.creditOwnerId || userId;
        if (available < requiredCredits) {
          return res.status(402).json({
            success: false,
            error: "INSUFFICIENT_CREDITS",
            required: requiredCredits,
            available,
          });
        }
      } catch (creditErr) {
        console.warn("⚠️ [BULK_UPSCALE_ASYNC] Credit precheck atlandı:", creditErr?.message);
        creditOwnerId = userId;
      }
    }

    // Batch state'i Map'e kaydet (her item processing)
    bulkBatches.set(sessionId, {
      userId,
      creditOwnerId,
      items: items.map((it, i) => ({
        index: i,
        status: "processing",
        imageUrl: null,
        originalImageUrl: it.imageUrl,
      })),
      completed: false,
      createdAt: Date.now(),
    });

    console.log(
      `🚀 [BULK_UPSCALE_ASYNC] ${items.length} item background'da işlenmeye başladı (batchId=${sessionId})`
    );

    // Hemen response dön — client polling başlatır
    res.status(200).json({
      success: true,
      batchSessionId: sessionId,
      items: items.map((_, i) => ({ index: i, status: "processing" })),
    });

    // Background: paralel processing, item bittikçe Map'e yazılır
    Promise.allSettled(
      items.map(async (it, i) => {
        const result = await processBulkUpscaleItem({
          userId,
          creditOwnerId,
          imageUrl: it.imageUrl,
          index: i,
          batchId: sessionId,
        targetMp: bulkTargetMp,
      });
        const batch = bulkBatches.get(sessionId);
        if (batch) {
          batch.items[i] = { ...result, originalImageUrl: it.imageUrl };
        }
        return result;
      })
    ).then(() => {
      const batch = bulkBatches.get(sessionId);
      if (batch) {
        batch.completed = true;
        console.log(`🏁 [BULK_UPSCALE_ASYNC] Batch ${sessionId} tüm itemları tamamlandı`);
      }
    });
  } catch (error) {
    console.error("❌ [BULK_UPSCALE_ASYNC] Endpoint hatası:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "Async bulk başlatma hatası",
        errorMessage: error.message,
      });
    }
  }
});

router.get("/generate-bulk-status/:batchId", (req, res) => {
  const { batchId } = req.params;
  const batch = bulkBatches.get(batchId);
  if (!batch) {
    return res.status(404).json({
      success: false,
      error: "Batch bulunamadı veya süresi dolmuş",
    });
  }
  const totalCharged = batch.items
    .filter((it) => it.status === "succeeded")
    .reduce((sum, it) => sum + (it.creditsCharged || 0), 0);
  return res.json({
    success: true,
    batchSessionId: batchId,
    items: batch.items,
    completed: batch.completed,
    totalCharged,
  });
});

module.exports = router;
