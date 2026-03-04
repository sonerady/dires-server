const express = require("express");
const router = express.Router();
const axios = require("axios");
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

module.exports = router;
