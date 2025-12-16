const express = require("express");
const router = express.Router();
const axios = require("axios");
const { supabase } = require("../supabaseClient");

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

    // Kredi kontrolü ve düşme
    if (userId && userId !== "anonymous_user") {
      try {
        console.log("💰 Kredi kontrolü yapılıyor...");

        const { data: userCredit, error: creditError } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        if (creditError) {
          console.error("❌ Kredi sorgulama hatası:", creditError);
          return res.status(500).json({
            success: false,
            error: "Kredi bilgisi alınamadı",
          });
        }

        const currentCredit = userCredit?.credit_balance || 0;
        console.log(
          `💳 Mevcut kredi: ${currentCredit}, gerekli: ${CREDIT_COST}`
        );

        if (currentCredit < CREDIT_COST) {
          return res.status(402).json({
            success: false,
            error: "Yetersiz kredi",
            requiredCredit: CREDIT_COST,
            currentCredit: currentCredit,
          });
        }

        // Krediyi düş
        const { error: updateError } = await supabase
          .from("users")
          .update({ credit_balance: currentCredit - CREDIT_COST })
          .eq("id", userId);

        if (updateError) {
          console.error("❌ Kredi düşme hatası:", updateError);
          return res.status(500).json({
            success: false,
            error: "Kredi düşülemedi",
          });
        }

        creditDeducted = true;
        console.log(
          `✅ ${CREDIT_COST} kredi düşüldü. Kalan: ${currentCredit - CREDIT_COST
          }`
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

    // Hata durumunda kredi iade et
    if (creditDeducted && userId && userId !== "anonymous_user") {
      try {
        const { data: currentUserCredit } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        await supabase
          .from("users")
          .update({
            credit_balance:
              (currentUserCredit?.credit_balance || 0) + CREDIT_COST,
          })
          .eq("id", userId);

        console.log(`💰 ${CREDIT_COST} kredi iade edildi (hata nedeniyle)`);
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
