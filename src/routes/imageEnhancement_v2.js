const express = require("express");
const router = express.Router();
const axios = require("axios");
const { supabase } = require("../supabaseClient");
const { getEffectiveCredits } = require("../services/teamService");

const FAL_ENDPOINT = "https://fal.run/clarityai/crystal-upscaler";

router.post("/", async (req, res) => {
  const CREDIT_COST = 5; // Image enhancement için kredi maliyeti
  let creditDeducted = false;
  let userId;

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
    let creditOwnerId = userId;

    if (userId && userId !== "anonymous_user") {
      try {
        console.log("💰 [V2] Team-aware kredi kontrolü yapılıyor...");

        // Team-aware kredi bilgisi al
        const effectiveCredits = await getEffectiveCredits(userId);
        const currentCredit = effectiveCredits.creditBalance || 0;
        creditOwnerId = effectiveCredits.creditOwnerId;

        console.log(
          `💳 [V2] Team-aware kredi: ${currentCredit}, gerekli: ${CREDIT_COST}`,
          effectiveCredits.isTeamCredit ? `(team owner: ${creditOwnerId})` : "(kendi kredisi)"
        );

        if (currentCredit < CREDIT_COST) {
          return res.status(402).json({
            success: false,
            error: "Yetersiz kredi",
            requiredCredit: CREDIT_COST,
            currentCredit: currentCredit,
          });
        }

        // Krediyi doğru hesaptan düş
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
        console.log(
          `✅ [V2] ${CREDIT_COST} kredi düşüldü (${creditOwnerId === userId ? "kendi hesabından" : "team owner hesabından"}). Kalan: ${currentCredit - CREDIT_COST}`
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
        // Diğer parametreler model tarafından destekleniyorsa eklenebilir
      },
      {
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 180000, // 3 dakika timeout
      }
    );

    console.log("3. Fal.ai API response received");

    // Fal.ai genellikle { image: { url: "..." } } veya { images: [...] } döner
    // Crystal Upscaler: Genellikle { image: { url: ... } } veya direkt URL dönebilir, dokümana göre değişir.
    // Standart Fal pattern: { image: { url: "...", ... } }

    const output = falResponse.data;
    console.log("Fal.ai raw output:", JSON.stringify(output, null, 2));

    let resultImageUrl = null;

    if (output.image && output.image.url) {
      resultImageUrl = output.image.url;
    } else if (output.images && Array.isArray(output.images) && output.images.length > 0) {
      resultImageUrl = output.images[0].url;
    } else if (typeof output === 'string' && output.startsWith('http')) {
      resultImageUrl = output; // Nadir durum
    } else {
      // Fallback: Belki direkt { url: "..." } döner
      resultImageUrl = output.url || null;
    }

    if (!resultImageUrl) {
      console.error("❌ Fal.ai response'da resim URL'i bulunamadı:", output);
      throw new Error("Fal.ai response did not contain a valid image URL");
    }

    const response = {
      success: true,
      input: imageUrl,
      output: resultImageUrl, // Uyumluluk için
      enhancedImageUrl: resultImageUrl,
    };

    console.log("4. Sending response to client:", response);

    res.json(response);
  } catch (error) {
    console.error("Image enhancement error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });

    // 🔗 TEAM-AWARE: Hata durumunda kredi iade et (doğru hesaba)
    if (creditDeducted && creditOwnerId && creditOwnerId !== "anonymous_user") {
      try {
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

        console.log(`💰 [V2] ${CREDIT_COST} kredi iade edildi (hata nedeniyle) - ${creditOwnerId === userId ? "kendi hesabına" : "team owner hesabına"}`);
      } catch (refundError) {
        console.error("❌ Kredi iade hatası:", refundError);
      }
    }

    res.status(500).json({
      success: false,
      error: "Failed to enhance image",
    });
  }
});

module.exports = router;
