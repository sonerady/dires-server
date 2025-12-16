const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const NANO_BANANA_API_URL = "https://fal.run/fal-ai/nano-banana/edit";

// Example image paths - gender'a göre
const getExampleImagePath = (gender) => {
  if (gender === "female") {
    return path.join(__dirname, "../../lib/woman_pose.jpg");
  } else {
    return path.join(__dirname, "../../lib/man_pose.jpg");
  }
};

// Replicate API üzerinden Gemini 2.5 Flash çağrısı yapan helper fonksiyon
// Hata durumunda 3 kez tekrar dener
async function callReplicateGeminiFlash(
  prompt,
  imageUrls = [],
  maxRetries = 3
) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `🤖 [REPLICATE-GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`
      );

      // Debug: Request bilgilerini logla
      console.log(`🔍 [REPLICATE-GEMINI] Images count: ${imageUrls.length}`);
      console.log(
        `🔍 [REPLICATE-GEMINI] Prompt length: ${prompt.length} chars`
      );

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls, // Direkt URL string array olarak gönder
          prompt: prompt,
          videos: [],
          temperature: 1,
          dynamic_thinking: false,
          max_output_tokens: 65535,
        },
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          timeout: 120000, // 2 dakika timeout
        },
      );

      const data = response.data;

      // Hata kontrolü
      if (data.error) {
        console.error(`❌ [REPLICATE-GEMINI] API error:`, data.error);
        throw new Error(data.error);
      }

      // Status kontrolü
      if (data.status !== "succeeded") {
        console.error(
          `❌ [REPLICATE-GEMINI] Prediction failed with status:`,
          data.status
        );
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      // Output'u birleştir (array olarak geliyor)
      let outputText = "";
      if (Array.isArray(data.output)) {
        outputText = data.output.join("");
      } else if (typeof data.output === "string") {
        outputText = data.output;
      }

      if (!outputText || outputText.trim() === "") {
        console.error(`❌ [REPLICATE-GEMINI] Empty response`);
        throw new Error("Replicate Gemini response is empty");
      }

      console.log(
        `✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`
      );
      console.log(`📊 [REPLICATE-GEMINI] Metrics:`, data.metrics);

      return outputText.trim();
    } catch (error) {
      console.error(
        `❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === maxRetries) {
        console.error(
          `❌ [REPLICATE-GEMINI] All ${maxRetries} attempts failed`
        );
        throw error;
      }

      // Retry öncesi kısa bekleme (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// Supabase resim URL'lerini optimize eden yardımcı fonksiyon (düşük boyut için)
const optimizeImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Supabase storage URL'si ise optimize et - dikey kartlar için yüksek boyut
  if (imageUrl.includes("supabase.co")) {
    // Eğer zaten render URL'i ise, query parametrelerini güncelle
    if (imageUrl.includes("/storage/v1/render/image/public/")) {
      // Mevcut query parametrelerini kaldır ve yeni ekle
      const baseUrl = imageUrl.split("?")[0];
      return baseUrl + "?width=400&height=800&quality=80";
    }
    // Normal object URL'i ise render URL'ine çevir
    return (
      imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      ) + "?width=400&height=800&quality=80"
    );
  }

  return imageUrl;
};

// Delay fonksiyonu
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polling function removed as Fal.ai handles requests synchronously

// Nano Banana API'ye istek gönder (retry ile) - Fal.ai Implementation
async function callNanoBanana(prompt, gender) {
  const maxRetries = 3;
  let lastError = null;

  for (let retry = 1; retry <= maxRetries; retry++) {
    try {
      console.log(
        `🎨 [FAL.AI NANO BANANA] ${gender} pose için API'ye istek gönderiliyor... (Deneme ${retry}/${maxRetries})`
      );

      // Gender'a göre example resmi seç ve okuyup base64'e çevir
      const exampleImagePath = getExampleImagePath(gender);

      if (!fs.existsSync(exampleImagePath)) {
        throw new Error(`Example image bulunamadı: ${exampleImagePath}`);
      }

      const imageBuffer = fs.readFileSync(exampleImagePath);
      const base64Image = imageBuffer.toString("base64");
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;

      const requestBody = {
        prompt: prompt,
        image_urls: [dataUrl],
        output_format: "png",
        num_images: 1,
      };

      console.log("📡 [FAL.AI] API isteği gönderiliyor...");
      console.log("📦 [FAL.AI] Request body:", {
        prompt: prompt.substring(0, 100) + "...",
        imageInputSize: dataUrl.length,
        gender: gender,
      });

      const response = await axios.post(
        NANO_BANANA_API_URL,
        requestBody,
        {
          headers: {
            Authorization: `Key ${process.env.FAL_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 300000, // 5 dakika timeout (Client isteği üzerine)
        }
      );

      console.log("📄 [FAL.AI] Yanıt alındı, Status:", response.status);

      // Fal.ai response handling: { images: [{ url: "..." }] }
      const output = response.data;

      if (output.images && output.images.length > 0 && output.images[0].url) {
        let imageUrl = output.images[0].url;
        // Fix: Ensure imageUrl is a string if it's an array (extra safety)
        if (Array.isArray(imageUrl)) {
          imageUrl = imageUrl[0];
        }
        console.log("✅ [FAL.AI] Resim başarıyla oluşturuldu:", imageUrl);

        return {
          imageUrl: imageUrl,
          predictionId: response.data.request_id || `fal-${uuidv4()}`,
        };
      } else if (response.data.detail || response.data.error) {
        throw new Error(response.data.detail || response.data.error || "Fal.ai unknown error");
      } else {
        throw new Error("Fal.ai returned no images");
      }

    } catch (error) {
      console.error(
        `❌ [FAL.AI] API hatası (Deneme ${retry}/${maxRetries}):`,
        error.message
      );
      lastError = error;

      // Hata tipine göre retry kararı
      const isRetryable =
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        (error.response && error.response.status >= 500) ||
        (error.message && (
          error.message.includes("temporarily unavailable") ||
          error.message.includes("rate limit")
        ));

      if (isRetryable && retry < maxRetries) {
        console.log(
          `🔄 [FAL.AI] Geçici hata, retry yapılıyor... (${retry}/${maxRetries})`
        );
        await delay(5000 * retry); // Exponential backoff
        continue;
      }

      // Timeout hatası özel işlemi (retry yapma)
      if (
        error.code === 'ECONNABORTED' ||
        (error.message && error.message.includes("timeout"))
      ) {
        console.error("❌ [FAL.AI] Timeout hatası, retry yapılmıyor.");
        throw error;
      }

      // Diğer durumlar için retry
      if (retry < maxRetries) {
        await delay(3000 * retry);
        continue;
      }
    }
  }

  // Tüm retry'lar başarısız
  throw lastError || new Error("Tüm retry denemeleri başarısız oldu");
}

// Prompt oluştur (generate-pose-images.js'den alındı)
function createPosePrompt(poseDescription, gender) {
  const genderText = gender === "female" ? "female" : "male";

  return `${poseDescription}. Create a professional fashion photograph of a real person in a clean white seamless studio. The model is wearing a plain white athletic tank top paired with fitted white training shorts, presented as a simple and safe sports outfit. A colorful pose chart must be overlaid directly onto the clothing: bold lines connect each body joint, with bright round dots at the key points such as shoulders, elbows, wrists, hips, knees, ankles, and the head connection. Each limb section should use a distinct bright gradient color so the design appears sharp, vibrant, and aligned perfectly with the natural body curves. The overlay should look flat and graphic, integrated as if printed directly on the outfit, never floating above it. The model's skin, hair, and face must remain unchanged and photorealistic while the background stays pure white and distraction-free, ensuring the result looks like a professional fashion studio photo used for educational visualization.`;
}

// Poz açıklamasından otomatik başlık oluştur
async function generatePoseTitleWithGemini(poseDescription, gender) {
  try {
    console.log("🏷️ [GEMINI] Poz başlığı oluşturuluyor...");
    console.log(
      "🏷️ [GEMINI] Description:",
      poseDescription.substring(0, 50) + "..."
    );

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

    const generatedTitle = await callReplicateGeminiFlash(titlePrompt);
    const cleanedTitle = generatedTitle.trim().replace(/['"]/g, "");

    console.log("✅ [GEMINI] Generated title:", cleanedTitle);
    return cleanedTitle;
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

    const responseText = await callReplicateGeminiFlash(promptForGemini);
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

      const retryTextRaw = await callReplicateGeminiFlash(simplePrompt);

      try {
        const retryText = retryTextRaw
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
      isPublic = true, // varsayılan herkese açık
    } = req.body;

    console.log("🎭 [CUSTOM POSE] Yeni poz oluşturma isteği:", {
      userId,
      poseDescription: poseDescription?.substring(0, 100) + "...",
      gender,
      isPublic,
      originalGender: gender,
      genderType: typeof gender,
      allRequestBody: req.body,
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

    // Nano Banana için prompt hazırla (poz overlay ile)
    const posePrompt = createPosePrompt(geminiResult.poseDescription, gender);

    console.log("🎨 [NANO BANANA] Görsel oluşturma başlatılıyor...");
    console.log("🚻 [PROMPT] Gender ve prompt debug:", {
      inputGender: gender,
      genderInPrompt: gender === "female" ? "FEMALE" : "MALE",
      enhancedDescription: geminiResult.poseDescription?.substring(0, 100),
      finalPrompt: posePrompt?.substring(0, 200),
    });
    console.log("🎨 [NANO BANANA] Full Pose prompt:", posePrompt);

    // Nano Banana API çağrısı (retry ile)
    const nanoBananaResult = await callNanoBanana(posePrompt, gender);

    let imageUrl = null;
    let nanoBananaPredictionId = nanoBananaResult.predictionId;
    let supabaseImagePath = null;

    if (nanoBananaResult.imageUrl) {
      console.log(
        "✅ [NANO BANANA] Görsel başarıyla oluşturuldu:",
        nanoBananaResult.imageUrl
      );

      // 📁 Nano Banana'dan gelen görseli Supabase'e kaydet
      try {
        console.log("📁 [SUPABASE] Görsel Supabase storage'a kaydediliyor...");

        // Nano Banana'dan görseli indir
        const imageResponse = await axios.get(nanoBananaResult.imageUrl, {
          responseType: "arraybuffer",
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Supabase storage path: custom-poses/userId/poseId.png
        const storagePath = `${userId}/${poseId}.png`;
        supabaseImagePath = storagePath;

        // Supabase'e yükle
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("custom-poses")
          .upload(storagePath, imageBuffer, {
            contentType: "image/png",
            upsert: true,
          });

        if (uploadError) {
          console.error("❌ [SUPABASE] Storage upload hatası:", uploadError);
          // Nano Banana URL'sini kullan fallback olarak
          imageUrl = nanoBananaResult.imageUrl;
        } else {
          // Supabase public URL al
          const { data: publicUrlData } = supabase.storage
            .from("custom-poses")
            .getPublicUrl(storagePath);

          imageUrl = publicUrlData.publicUrl;
          console.log("✅ [SUPABASE] Görsel başarıyla kaydedildi:", imageUrl);
        }
      } catch (storageError) {
        console.error("❌ [SUPABASE] Storage işlemi hatası:", storageError);
        // Nano Banana URL'sini kullan fallback olarak
        imageUrl = nanoBananaResult.imageUrl;
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
        nano_banana_prediction_id: nanoBananaPredictionId,
        is_public: isPublic, // Visibility durumu
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

    // Sensitive content hatası kontrolü
    if (
      error.message &&
      (error.message.includes("E005") ||
        error.message.includes("flagged as sensitive") ||
        error.message.includes("sensitive content") ||
        error.message.includes("Content moderated"))
    ) {
      res.status(400).json({
        success: false,
        error:
          "İçerik uygun değil. Lütfen farklı bir poz açıklaması ile tekrar deneyin.",
        errorType: "sensitive_content",
        canRetry: true,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Poz oluşturulurken hata oluştu: " + error.message,
        canRetry: true,
      });
    }
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

    // Optimize image URLs
    const optimizedPoses = poses.map((pose) => ({
      ...pose,
      image_url: optimizeImageUrl(pose.image_url),
    }));

    res.json({
      success: true,
      result: {
        poses: optimizedPoses,
        count: optimizedPoses.length,
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

    // Eğer görsel henüz hazır değilse Nano Banana API'den kontrol et
    if (!pose.image_url && pose.nano_banana_prediction_id) {
      try {
        const statusResponse = await axios.get(
          `https://api.replicate.com/v1/predictions/${pose.nano_banana_prediction_id}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
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
      } catch (nanoBananaError) {
        console.error(
          "❌ [NANO BANANA] Status kontrolü hatası:",
          nanoBananaError.message
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
