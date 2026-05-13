const express = require("express");
const router = express.Router();
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");
const { getEffectiveCredits } = require("../services/teamService");

const FAL_ENDPOINT = "https://fal.run/clarityai/crystal-upscaler";

// Helper: FAL'dan dönen geçici imajı user_image_results bucket'ına yükler ve
// kalıcı api.diress.ai public URL'sini döner. Hata durumunda orijinal URL'yi döner
// (downstream akış kırılmasın). changeProductColor.js'teki saveResultImageToUserBucket
// pattern'iyle birebir aynı.
const saveResultImageToUserBucket = async (resultImageUrl, userId) => {
  try {
    if (!resultImageUrl || !userId) return resultImageUrl;
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
      return resultImageUrl;
    }
    const { data: urlData } = supabase.storage
      .from("user_image_results")
      .getPublicUrl(fileName);
    return urlData?.publicUrl || resultImageUrl;
  } catch (err) {
    console.error("❌ [UPSCALE-BUCKET] Exception:", err?.message);
    return resultImageUrl;
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
  const CREDIT_COST = 5; // Image enhancement için kredi maliyeti
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

    console.log("2. Starting Fal.ai API call (clarityai/crystal-upscaler)...");
    const tFalStart = Date.now();

    // Fal.ai API çağrısı
    const falResponse = await axios.post(
      FAL_ENDPOINT,
      {
        image_url: imageUrl,
        upscaling_factor: Number(scale) || 2,
      },
      {
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 180000,
      }
    );
    const falElapsed = Date.now() - tFalStart;
    console.log(`3. Fal.ai API response received (took ${falElapsed} ms)`);

    const output = falResponse.data;
    console.log("Fal.ai raw output:", JSON.stringify(output, null, 2));

    let resultImageUrl = null;

    // Fal.ai çıktısını parse et
    if (output.image && output.image.url) {
      resultImageUrl = output.image.url;
    } else if (output.images && Array.isArray(output.images) && output.images.length > 0) {
      resultImageUrl = output.images[0].url;
    } else if (typeof output === 'string' && output.startsWith('http')) {
      resultImageUrl = output;
    } else {
      resultImageUrl = output.url || null;
    }

    if (!resultImageUrl) {
      throw new Error("Fal.ai response did not contain a valid image URL");
    }

    // FAL imajını user_image_results bucket'ına yükle → kalıcı api.diress URL'i.
    // (signed-expiry sorunu yok, frontend'de download/share çalışır)
    let finalImageUrl = resultImageUrl;
    if (userId && userId !== "anonymous_user") {
      finalImageUrl = await saveResultImageToUserBucket(resultImageUrl, userId);
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
              original_size_bytes: originalSize,
              result_size_bytes: resultSize,
              scale: Number(scale) || 2,
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
const BULK_CREDIT_COST = 5;
const BULK_SCALE = 4;

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

async function processBulkUpscaleItem({ userId, creditOwnerId, imageUrl, index, batchId }) {
  const startedAt = Date.now();

  try {
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      throw new Error("INVALID_IMAGE_URL");
    }

    // Fal.ai crystal-upscaler çağrısı
    const tFalStart = Date.now();
    const falResponse = await axios.post(
      FAL_ENDPOINT,
      {
        image_url: imageUrl,
        upscaling_factor: BULK_SCALE,
      },
      {
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 180000,
      }
    );
    const falElapsed = Date.now() - tFalStart;
    console.log(`✓ [BULK_UPSCALE] Item ${index} Fal.ai response received in ${falElapsed}ms`);

    const output = falResponse.data;
    let resultUrl = null;
    if (output?.image?.url) {
      resultUrl = output.image.url;
    } else if (Array.isArray(output?.images) && output.images.length > 0) {
      resultUrl = output.images[0].url;
    } else if (typeof output === "string" && output.startsWith("http")) {
      resultUrl = output;
    } else {
      resultUrl = output?.url || null;
    }

    if (!resultUrl) {
      throw new Error("FAL_NO_OUTPUT_URL");
    }

    // FAL imajını user_image_results bucket'ına yükle → kalıcı api.diress URL'i.
    // (signed-expiry sorunu yok, frontend download/share/history çalışır)
    let finalImageUrl = resultUrl;
    if (userId && userId !== "anonymous_user") {
      finalImageUrl = await saveResultImageToUserBucket(resultUrl, userId);
    }

    // ⚡ Critical: Credit kesimi sync (deduct atomic RPC, hızlı). HEAD + DB insert background'a.
    let creditsCharged = 0;
    if (userId && userId !== "anonymous_user" && creditOwnerId) {
      try {
        const { error: deductError } = await supabase.rpc(
          "deduct_user_credit",
          { user_id: creditOwnerId, credit_amount: BULK_CREDIT_COST }
        );
        if (deductError) {
          console.error(
            `❌ [BULK_UPSCALE] Item ${index} credit deduct failed for ${creditOwnerId}:`,
            deductError
          );
        } else {
          creditsCharged = BULK_CREDIT_COST;
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
              original_size_bytes: originalSize,
              result_size_bytes: resultSize,
              scale: BULK_SCALE,
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
          scale: BULK_SCALE,
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
    const requiredCredits = items.length * BULK_CREDIT_COST;

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
      `🚀 [BULK_UPSCALE] ${items.length} item paralel işlenecek (sessionId=${sessionId}, scale=${BULK_SCALE}, creditOwnerId=${creditOwnerId})`
    );

    const settled = await Promise.allSettled(
      items.map((it, i) =>
        processBulkUpscaleItem({
          userId,
          creditOwnerId,
          imageUrl: it.imageUrl,
          index: i,
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
    const requiredCredits = items.length * BULK_CREDIT_COST;

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
