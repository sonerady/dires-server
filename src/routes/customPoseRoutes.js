const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Flux dev API endpoint
const FLUX_DEV_API_URL =
  "https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions";

// Gemini API için istemci oluştur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Poz açıklamasından otomatik başlık oluştur
async function generatePoseTitleWithGemini(poseDescription, gender) {
  try {
    console.log("🏷️ [GEMINI] Poz başlığı oluşturuluyor...");
    console.log(
      "🏷️ [GEMINI] Description:",
      poseDescription.substring(0, 50) + "..."
    );

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const titlePrompt = `
Create a short, catchy title for this pose description:

POSE DESCRIPTION: "${poseDescription}"
GENDER: ${gender}

REQUIREMENTS:
- Maximum 3-4 words
- Professional and descriptive
- Suitable for fashion photography
- In English
- No quotes or special characters

EXAMPLES:
- "Confident Standing" 
- "Casual Lean"
- "Power Pose"
- "Relaxed Portrait"
- "Dynamic Stance"

Generate ONLY the title, nothing else.
    `;

    const result = await model.generateContent({
      contents: [{ parts: [{ text: titlePrompt }] }],
    });

    const generatedTitle = result.response.text().trim().replace(/['"]/g, "");

    console.log("✅ [GEMINI] Generated title:", generatedTitle);
    return generatedTitle;
  } catch (error) {
    console.error("❌ [GEMINI] Title generation hatası:", error);
    // Fallback: basit başlık
    return "Custom Pose";
  }
}

// Poz açıklamasını Gemini ile İngilizce'ye çevir ve enhance et
async function enhancePoseDescriptionWithGemini(originalDescription, gender) {
  try {
    console.log("🤖 [GEMINI] Poz açıklaması enhance ediliyor...");
    console.log("🤖 [GEMINI] Original description:", originalDescription);
    console.log("🤖 [GEMINI] Gender:", gender);

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const promptForGemini = `
Translate and convert this pose description to English:

INPUT: "${originalDescription}"
GENDER: ${gender}

Return ONLY a JSON object:
{
  "enhancedPrompt": "A professional fashion model (${gender}) [detailed pose description with body positioning, hand placement, facial expression]. The model should be positioned naturally for fashion photography.",
  "poseDescription": "Detailed English pose description (8-12 words, include body language and mood)"
}

Examples:
- Input: "Eller cepte" → "poseDescription": "Hands casually in pockets, relaxed stance"
- Input: "Kollar kavuşturulmuş" → "poseDescription": "Arms crossed confidently, upright posture"
- Input: "Saçını düzeltiyor" → "poseDescription": "Hand gently adjusting hair, natural expression"

IMPORTANT: Return ONLY valid JSON, no extra text.
    `;

    const result = await model.generateContent({
      contents: [{ parts: [{ text: promptForGemini }] }],
    });

    const responseText = result.response.text().trim();
    console.log("🔍 [GEMINI] Raw response:", responseText);

    // JSON'dan önce ve sonraki backtick'leri ve markdown formatını temizle
    const cleanedResponse = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .replace(/`/g, "")
      .trim();

    console.log("🧹 [GEMINI] Cleaned response:", cleanedResponse);

    try {
      const parsedResult = JSON.parse(cleanedResponse);
      console.log("✅ [GEMINI] Enhanced result:", {
        prompt: parsedResult.enhancedPrompt?.substring(0, 50) + "...",
        poseDesc: parsedResult.poseDescription,
      });
      return parsedResult;
    } catch (parseError) {
      console.error("❌ [GEMINI] JSON parse hatası:", parseError);
      console.log("🔄 [GEMINI] Tekrar deneniyor...");

      // Daha basit prompt ile tekrar dene
      const simplePrompt = `Translate "${originalDescription}" to English pose description (max 5 words). Return JSON: {"enhancedPrompt": "A ${gender} model in ${originalDescription} pose", "poseDescription": "translated pose"}`;

      const retryResult = await model.generateContent({
        contents: [{ parts: [{ text: simplePrompt }] }],
      });

      try {
        const retryText = retryResult.response
          .text()
          .trim()
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .replace(/`/g, "")
          .trim();
        const retryParsed = JSON.parse(retryText);
        console.log("✅ [GEMINI] Retry başarılı:", retryParsed);
        return retryParsed;
      } catch (retryError) {
        console.error("❌ [GEMINI] Retry de başarısız:", retryError);
        throw new Error("Gemini response could not be parsed");
      }
    }
  } catch (error) {
    console.error("❌ [GEMINI] Pose description enhancement hatası:", error);
    throw new Error("Gemini API failed to generate pose description");
  }
}

/**
 * Kullanıcının özel pozunu kaydetme ve görsel oluşturma
 * POST /api/customPose/create
 */
router.post("/create", async (req, res) => {
  try {
    const {
      userId,
      poseDescription,
      gender = "female", // varsayılan kadın
    } = req.body;

    console.log("🎭 [CUSTOM POSE] Yeni poz oluşturma isteği:", {
      userId,
      poseDescription: poseDescription?.substring(0, 100) + "...",
      gender,
    });

    // Validasyon - poseTitle artık gerekli değil
    if (!userId || !poseDescription) {
      return res.status(400).json({
        success: false,
        error: "userId ve poseDescription zorunludur",
      });
    }

    // Unique ID oluştur
    const poseId = uuidv4();
    const timestamp = new Date().toISOString();

    // 🏷️ Gemini ile otomatik başlık oluştur
    const generatedTitle = await generatePoseTitleWithGemini(
      poseDescription,
      gender
    );

    // 🤖 Gemini ile poz açıklamasını enhance et
    const geminiResult = await enhancePoseDescriptionWithGemini(
      poseDescription,
      gender
    );

    // Flux dev için prompt hazırla
    const basePrompt = `${geminiResult.enhancedPrompt}, wearing simple neutral clothing (white t-shirt and jeans), standing against a clean white studio background. High quality, professional lighting, 4K resolution, fashion photography style.`;

    console.log("🎨 [FLUX DEV] Görsel oluşturma başlatılıyor...");
    console.log("🎨 [FLUX DEV] Enhanced prompt:", basePrompt);

    // Flux dev API çağrısı
    const fluxResponse = await axios.post(
      FLUX_DEV_API_URL,
      {
        input: {
          prompt: basePrompt,
          aspect_ratio: "9:16",
          num_outputs: 1,
          output_format: "jpg",
          output_quality: 90,
          guidance_scale: 3.5,
          num_inference_steps: 28,
          seed: Math.floor(Math.random() * 1000000),
        },
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 60000, // 60 saniye timeout
      }
    );

    console.log("🎨 [FLUX DEV] API yanıtı:", fluxResponse.data);

    let imageUrl = null;
    let fluxPredictionId = null;
    let supabaseImagePath = null;

    if (fluxResponse.data && fluxResponse.data.id) {
      fluxPredictionId = fluxResponse.data.id;

      // Prediction tamamlanana kadar bekle
      let attempts = 0;
      const maxAttempts = 30; // 5 dakika maksimum bekleme

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 saniye bekle

        try {
          const statusResponse = await axios.get(
            `https://api.replicate.com/v1/predictions/${fluxPredictionId}`,
            {
              headers: {
                Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
              },
            }
          );

          console.log(
            `🎨 [FLUX DEV] Status check ${attempts + 1}/${maxAttempts}:`,
            statusResponse.data.status
          );

          if (
            statusResponse.data.status === "succeeded" &&
            statusResponse.data.output
          ) {
            const fluxImageUrl = Array.isArray(statusResponse.data.output)
              ? statusResponse.data.output[0]
              : statusResponse.data.output;

            console.log(
              "✅ [FLUX DEV] Görsel başarıyla oluşturuldu:",
              fluxImageUrl
            );

            // 📁 Flux'dan gelen görseli Supabase'e kaydet
            try {
              console.log(
                "📁 [SUPABASE] Görsel Supabase storage'a kaydediliyor..."
              );

              // Flux'dan görseli indir
              const imageResponse = await axios.get(fluxImageUrl, {
                responseType: "arraybuffer",
              });
              const imageBuffer = Buffer.from(imageResponse.data);

              // Supabase storage path: custom-poses/userId/poseId.jpg
              const storagePath = `${userId}/${poseId}.jpg`;
              supabaseImagePath = storagePath;

              // Supabase'e yükle
              const { data: uploadData, error: uploadError } =
                await supabase.storage
                  .from("custom-poses")
                  .upload(storagePath, imageBuffer, {
                    contentType: "image/jpeg",
                    upsert: true,
                  });

              if (uploadError) {
                console.error(
                  "❌ [SUPABASE] Storage upload hatası:",
                  uploadError
                );
                // Flux URL'sini kullan fallback olarak
                imageUrl = fluxImageUrl;
              } else {
                // Supabase public URL al
                const { data: publicUrlData } = supabase.storage
                  .from("custom-poses")
                  .getPublicUrl(storagePath);

                imageUrl = publicUrlData.publicUrl;
                console.log(
                  "✅ [SUPABASE] Görsel başarıyla kaydedildi:",
                  imageUrl
                );
              }
            } catch (storageError) {
              console.error(
                "❌ [SUPABASE] Storage işlemi hatası:",
                storageError
              );
              // Flux URL'sini kullan fallback olarak
              imageUrl = fluxImageUrl;
            }

            break;
          } else if (statusResponse.data.status === "failed") {
            console.error(
              "❌ [FLUX DEV] Görsel oluşturma başarısız:",
              statusResponse.data.error
            );
            break;
          }
        } catch (statusError) {
          console.error(
            "❌ [FLUX DEV] Status kontrolü hatası:",
            statusError.message
          );
        }

        attempts++;
      }
    }

    // 💾 Supabase'e poz bilgilerini kaydet
    const { data: poseData, error: insertError } = await supabase
      .from("custom_poses")
      .insert({
        id: poseId,
        user_id: userId,
        title: generatedTitle, // Gemini ile oluşturulan başlık
        description: poseDescription, // Kullanıcının orijinal açıklaması
        enhanced_description: geminiResult.poseDescription, // Gemini'den gelen kısa İngilizce poz tarifi
        gender: gender,
        image_url: imageUrl,
        supabase_image_path: supabaseImagePath,
        flux_prediction_id: fluxPredictionId,
        is_active: true,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select()
      .single();

    if (insertError) {
      console.error("❌ [SUPABASE] Poz kaydetme hatası:", insertError);
      return res.status(500).json({
        success: false,
        error: "Poz kaydedilemedi: " + insertError.message,
      });
    }

    console.log("✅ [CUSTOM POSE] Poz başarıyla oluşturuldu:", poseData.id);

    res.json({
      success: true,
      result: {
        pose: poseData,
        message: imageUrl
          ? "Poz başarıyla oluşturuldu ve görsel hazırlandı!"
          : "Poz oluşturuldu, görsel hazırlanıyor...",
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM POSE] Genel hata:", error);
    res.status(500).json({
      success: false,
      error: "Poz oluşturulurken hata oluştu: " + error.message,
    });
  }
});

/**
 * Kullanıcının özel pozlarını listeleme
 * GET /api/customPose/list/:userId
 */
router.get("/list/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { gender, category } = req.query;

    console.log("📋 [CUSTOM POSE] Poz listesi isteniyor:", {
      userId,
      gender,
      category,
    });

    let query = supabase
      .from("custom_poses")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    // Filtreler
    if (gender) {
      query = query.eq("gender", gender);
    }
    if (category) {
      query = query.eq("category", category);
    }

    const { data: poses, error } = await query;

    if (error) {
      console.error("❌ [SUPABASE] Poz listesi hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Pozlar getirilemedi: " + error.message,
      });
    }

    console.log(`✅ [CUSTOM POSE] ${poses.length} poz bulundu`);

    res.json({
      success: true,
      result: {
        poses: poses,
        count: poses.length,
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM POSE] Liste hatası:", error);
    res.status(500).json({
      success: false,
      error: "Poz listesi alınırken hata oluştu: " + error.message,
    });
  }
});

/**
 * Özel poz silme
 * DELETE /api/customPose/delete/:poseId
 */
router.delete("/delete/:poseId", async (req, res) => {
  try {
    const { poseId } = req.params;
    const { userId } = req.body;

    console.log("🗑️ [CUSTOM POSE] Poz silme isteği:", { poseId, userId });

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId zorunludur",
      });
    }

    // Soft delete - is_active false yap
    const { data: deletedPose, error } = await supabase
      .from("custom_poses")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", poseId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("❌ [SUPABASE] Poz silme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Poz silinemedi: " + error.message,
      });
    }

    if (!deletedPose) {
      return res.status(404).json({
        success: false,
        error: "Poz bulunamadı veya size ait değil",
      });
    }

    console.log("✅ [CUSTOM POSE] Poz başarıyla silindi:", poseId);

    res.json({
      success: true,
      result: {
        message: "Poz başarıyla silindi",
        deletedPose: deletedPose,
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM POSE] Silme hatası:", error);
    res.status(500).json({
      success: false,
      error: "Poz silinirken hata oluştu: " + error.message,
    });
  }
});

/**
 * Poz görsel durumunu kontrol etme
 * GET /api/customPose/status/:poseId
 */
router.get("/status/:poseId", async (req, res) => {
  try {
    const { poseId } = req.params;

    console.log("🔍 [CUSTOM POSE] Poz durumu kontrol ediliyor:", poseId);

    const { data: pose, error } = await supabase
      .from("custom_poses")
      .select("*")
      .eq("id", poseId)
      .eq("is_active", true)
      .single();

    if (error || !pose) {
      return res.status(404).json({
        success: false,
        error: "Poz bulunamadı",
      });
    }

    // Eğer görsel henüz hazır değilse Flux API'den kontrol et
    if (!pose.image_url && pose.flux_prediction_id) {
      try {
        const statusResponse = await axios.get(
          `https://api.replicate.com/v1/predictions/${pose.flux_prediction_id}`,
          {
            headers: {
              Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
            },
          }
        );

        if (
          statusResponse.data.status === "succeeded" &&
          statusResponse.data.output
        ) {
          const imageUrl = Array.isArray(statusResponse.data.output)
            ? statusResponse.data.output[0]
            : statusResponse.data.output;

          // Supabase'i güncelle
          const { data: updatedPose, error: updateError } = await supabase
            .from("custom_poses")
            .update({
              image_url: imageUrl,
              updated_at: new Date().toISOString(),
            })
            .eq("id", poseId)
            .select()
            .single();

          if (!updateError) {
            pose.image_url = imageUrl;
            console.log("✅ [CUSTOM POSE] Görsel URL güncellendi:", imageUrl);
          }
        }
      } catch (fluxError) {
        console.error(
          "❌ [FLUX DEV] Status kontrolü hatası:",
          fluxError.message
        );
      }
    }

    res.json({
      success: true,
      result: {
        pose: pose,
        status: pose.image_url ? "ready" : "processing",
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM POSE] Durum kontrol hatası:", error);
    res.status(500).json({
      success: false,
      error: "Poz durumu kontrol edilirken hata oluştu: " + error.message,
    });
  }
});

module.exports = router;
