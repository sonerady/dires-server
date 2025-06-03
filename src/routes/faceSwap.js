const express = require("express");
const router = express.Router();
const Replicate = require("replicate");
const supabase = require("../supabaseClient");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

router.post("/", async (req, res) => {
  const CREDIT_COST = 20; // Face swap için kredi maliyeti
  let creditDeducted = false;
  let userId;

  try {
    const { swapImage, inputImage, userId: requestUserId } = req.body;
    userId = requestUserId;

    console.log("1. Received request with data:", {
      swapImage,
      inputImage,
      userId,
    });

    if (!swapImage || !inputImage) {
      console.log("Error: Both swap image and input image URLs are required");
      return res
        .status(400)
        .json({ error: "Both swap image and input image URLs are required" });
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
    const replicateResponse = await replicate.run(
      "codeplugtech/face-swap:278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34",
      {
        input: {
          swap_image: swapImage,
          input_image: inputImage,
        },
      }
    );
    console.log("3. Replicate API response:", replicateResponse);

    const response = {
      success: true,
      swapImage,
      inputImage,
      output: replicateResponse,
      swappedImageUrl: replicateResponse.output,
    };
    console.log("4. Sending response to client:", response);

    res.json(response);
  } catch (error) {
    console.error("Face swap error details:", {
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
      error: "Failed to swap faces",
    });
  }
});

module.exports = router;
