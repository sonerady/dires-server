const express = require("express");
const router = express.Router();
const axios = require("axios");
const supabase = require("../supabaseClient");

const REPLICATE_ENDPOINT =
  "https://api.replicate.com/v1/models/philz1337x/crystal-upscaler/predictions";

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
          `✅ ${CREDIT_COST} kredi düşüldü. Kalan: ${
            currentCredit - CREDIT_COST
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

    console.log("2. Starting Replicate API call...");
    const replicateResponse = await axios.post(
      REPLICATE_ENDPOINT,
      {
        input: {
          image: imageUrl,
          scale_factor: Number(scale) || 2,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
      }
    );
    console.log("3. Replicate API response:", replicateResponse.data);

    const { status, output } = replicateResponse.data || {};
    if (status !== "succeeded") {
      throw new Error(
        `Replicate enhancement failed with status: ${status || "unknown"}`
      );
    }

    const response = {
      success: true,
      input: imageUrl,
      output,
      enhancedImageUrl: Array.isArray(output) ? output[0] : output,
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
