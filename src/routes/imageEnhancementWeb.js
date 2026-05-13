const express = require("express");
const router = express.Router();
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");
const { getEffectiveCredits } = require("../services/teamService");

const FAL_ENDPOINT = "https://fal.run/clarityai/crystal-upscaler";

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
    console.log("3. Fal.ai API response received");

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

    // Save to upscale_generations table
    if (userId && userId !== "anonymous_user") {
      try {
        // Get file sizes in parallel
        const [originalSize, resultSize] = await Promise.all([
          getRemoteFileSize(imageUrl),
          getRemoteFileSize(resultImageUrl),
        ]);

        const { error: insertError } = await supabase
          .from("upscale_generations")
          .insert({
            user_id: userId,
            status: "completed",
            original_image_url: imageUrl,
            result_image_url: resultImageUrl,
            original_size_bytes: originalSize,
            result_size_bytes: resultSize,
            scale: Number(scale) || 2,
            credits_cost: CREDIT_COST,
            credit_balance_before: creditBalanceBefore,
            credit_balance_after: creditBalanceAfter,
          });

        if (insertError) {
          console.error("⚠️ [UPSCALE] DB insert error (non-blocking):", insertError);
        } else {
          console.log("✅ [UPSCALE] Saved to upscale_generations table", {
            originalSize,
            resultSize,
          });
        }
      } catch (dbError) {
        console.error("⚠️ [UPSCALE] DB save error (non-blocking):", dbError.message);
      }
    }

    const response = {
      success: true,
      input: imageUrl,
      output: resultImageUrl,
      rawOutput: output,
      enhancedImageUrl: resultImageUrl,
    };
    console.log("4. Sending response to client:", response);

    res.json(response);
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
// BULK UPSCALE — N resmi paralel netleştir (auth'lu mirror)
// POST /api/imageEnhancementWeb/generate-bulk
// ============================================================================
const BULK_MAX_ITEMS = 20;
const BULK_CREDIT_COST = 5;
const BULK_SCALE = 4;

async function processBulkUpscaleItem({ userId, imageUrl, index }) {
  const startedAt = Date.now();

  try {
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      throw new Error("INVALID_IMAGE_URL");
    }

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

    const [originalSize, resultSize] = await Promise.all([
      getRemoteFileSize(imageUrl),
      getRemoteFileSize(resultUrl),
    ]);

    let creditsCharged = 0;
    let generationId = null;
    if (userId && userId !== "anonymous_user") {
      try {
        const effective = await getEffectiveCredits(userId);
        const creditOwnerId = effective.creditOwnerId || userId;
        const currentCredit = effective.creditBalance || 0;

        const { error: deductError } = await supabase.rpc(
          "deduct_user_credit",
          { user_id: creditOwnerId, credit_amount: BULK_CREDIT_COST }
        );
        if (deductError) {
          console.error(
            `❌ [BULK_UPSCALE] Credit deduct failed for ${creditOwnerId}:`,
            deductError
          );
        } else {
          creditsCharged = BULK_CREDIT_COST;
        }

        const balanceAfter = currentCredit - creditsCharged;

        const { data: insertData, error: insertError } = await supabase
          .from("upscale_generations")
          .insert({
            user_id: userId,
            status: "completed",
            original_image_url: imageUrl,
            result_image_url: resultUrl,
            original_size_bytes: originalSize,
            result_size_bytes: resultSize,
            scale: BULK_SCALE,
            credits_cost: creditsCharged,
            credit_balance_before: currentCredit,
            credit_balance_after: balanceAfter,
          })
          .select("id")
          .single();

        if (insertError) {
          console.error(
            "⚠️ [BULK_UPSCALE] DB insert error (non-blocking):",
            insertError
          );
        } else {
          generationId = insertData?.id || null;
        }
      } catch (creditErr) {
        console.error(
          "⚠️ [BULK_UPSCALE] credit/db error (non-blocking):",
          creditErr?.message
        );
      }
    }

    return {
      index,
      status: "succeeded",
      generationId,
      imageUrl: resultUrl,
      originalSize,
      resultSize,
      creditsCharged,
      processingTimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    };
  } catch (err) {
    const message = err?.message || "UNKNOWN_ERROR";
    console.error(
      `❌ [BULK_UPSCALE] Item ${index} failed:`,
      message,
      err?.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : ""
    );
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
        // best-effort
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

    if (userId !== "anonymous_user") {
      try {
        const effective = await getEffectiveCredits(userId);
        const available = effective?.creditBalance ?? 0;
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
      }
    }

    console.log(
      `🚀 [BULK_UPSCALE] ${items.length} item paralel işlenecek (sessionId=${sessionId}, scale=${BULK_SCALE})`
    );

    const settled = await Promise.allSettled(
      items.map((it, i) =>
        processBulkUpscaleItem({
          userId,
          imageUrl: it.imageUrl,
          index: i,
        })
      )
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

module.exports = router;
