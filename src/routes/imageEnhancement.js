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
        console.log("💰 [BACKEND] Kredi kontrolü yapılıyor, userId:", userId);

        const { data: userCredit, error: creditError } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", userId)
          .single();

        if (creditError) {
          console.error("❌ [BACKEND] Kredi sorgulama hatası:", creditError);
          return res.status(500).json({
            success: false,
            error: "Kredi bilgisi alınamadı",
          });
        }

        const currentCredit = userCredit?.credit_balance || 0;
        console.log(
          `💳 [BACKEND] Mevcut kredi: ${currentCredit}, gerekli: ${CREDIT_COST}, Yeterli mi? ${
            currentCredit >= CREDIT_COST ? "EVET ✅" : "HAYIR ❌"
          }`
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

    let { status, output, urls } = replicateResponse.data || {};

    // Replicate bazen "Prefer: wait" header'ına rağmen işlemi async başlatabiliyor.
    // Bu durumda status "starting" veya "processing" olarak gelebilir.
    if (
      urls?.get &&
      status &&
      ["starting", "processing"].includes(status.toLowerCase())
    ) {
      console.log(
        `⚙️ Replicate prediction ${status}, polling until completion...`
      );

      const maxAttempts = 30; // ~60 saniye (30 x 2s)
      const pollInterval = 2000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const pollResponse = await axios.get(urls.get, {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        status = pollResponse.data?.status || status;
        output = pollResponse.data?.output || output;

        console.log(
          `🔄 Poll attempt ${attempt}: status=${status}, hasOutput=${
            pollResponse.data?.output ? "yes" : "no"
          }`
        );

        if (status === "succeeded") {
          break;
        }

        if (["failed", "canceled"].includes(status)) {
          throw new Error(
            `Replicate enhancement failed with status: ${status}`
          );
        }
      }
    }

    if (status !== "succeeded") {
      throw new Error(
        `Replicate enhancement failed with status: ${status || "unknown"}`
      );
    }

    const normalizedOutput = Array.isArray(output) ? output[0] : output;

    const response = {
      success: true,
      input: imageUrl,
      output: normalizedOutput,
      rawOutput: output,
      enhancedImageUrl: normalizedOutput,
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

    // Hata durumunda kredi iade et
    if (creditDeducted && userId && userId !== "anonymous_user") {
      try {
        console.log(
          `💰 [BACKEND] Kredi iade ediliyor, userId: ${userId}, amount: ${CREDIT_COST}`
        );
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

        console.log(
          `✅ [BACKEND] ${CREDIT_COST} kredi iade edildi (hata nedeniyle)`
        );
      } catch (refundError) {
        console.error("❌ [BACKEND] Kredi iade hatası:", refundError);
      }
    } else {
      console.log(
        `ℹ️ [BACKEND] Kredi iade edilmedi (creditDeducted: ${creditDeducted}, userId: ${userId})`
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
