const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Nano Banana API endpoint
const NANO_BANANA_API_URL =
  "https://api.replicate.com/v1/models/google/nano-banana/predictions";

// Example image paths - gender'a göre
const getExampleImagePath = (gender) => {
  if (gender === "female") {
    return path.join(__dirname, "../../lib/woman_pose.jpg");
  } else {
    return path.join(__dirname, "../../lib/man_pose.jpg");
  }
};

// Gemini API için istemci oluştur
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

// Prediction durumunu kontrol et (generate-pose-images.js'den alındı)
async function pollReplicateResult(predictionId, maxAttempts = 60) {
  console.log(
    `🔄 [NANO BANANA] Prediction polling başlatılıyor: ${predictionId}`
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "json",
          timeout: 15000,
        }
      );

      const result = response.data;
      console.log(
        `🔍 [NANO BANANA] Polling attempt ${attempt + 1}: status = ${
          result.status
        }`
      );

      if (result.status === "succeeded") {
        console.log("✅ [NANO BANANA] İşlem başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("❌ [NANO BANANA] İşlem başarısız:", result.error);

        // E005 (sensitive content) ve diğer kalıcı hatalar için hata fırlat
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("E005") ||
            result.error.includes("flagged as sensitive") ||
            result.error.includes("sensitive content") ||
            result.error.includes("Content moderated"))
        ) {
          console.log(
            "⚠️ [NANO BANANA] Sensitive content hatası:",
            result.error
          );
          throw new Error(`Sensitive content error: ${result.error}`);
        }

        // E004 ve benzeri geçici hatalar için retry'a uygun hata fırlat
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("E004") ||
            result.error.includes("Service is temporarily unavailable") ||
            result.error.includes("Please try again later"))
        ) {
          console.log(
            "🔄 [NANO BANANA] Geçici hata tespit edildi:",
            result.error
          );
          throw new Error(`Service temporarily unavailable: ${result.error}`);
        }

        throw new Error(result.error || "Nano Banana processing failed");
      } else if (result.status === "canceled") {
        console.error("❌ [NANO BANANA] İşlem iptal edildi");
        throw new Error("Nano Banana processing was canceled");
      }

      // Processing veya starting durumundaysa bekle
      if (result.status === "processing" || result.status === "starting") {
        await delay(2000); // 2 saniye bekle
        continue;
      }
    } catch (error) {
      console.error(
        `❌ [NANO BANANA] Polling attempt ${attempt + 1} hatası:`,
        error.message
      );

      // Son deneme değilse devam et
      if (attempt < maxAttempts - 1) {
        await delay(2000);
        continue;
      }

      throw error;
    }
  }

  throw new Error("Polling timeout - maksimum deneme sayısına ulaşıldı");
}

// Nano Banana API'ye istek gönder (retry ile)
async function callNanoBanana(prompt, gender) {
  const maxRetries = 3;
  let lastError = null;

  for (let retry = 1; retry <= maxRetries; retry++) {
    try {
      console.log(
        `🎨 [NANO BANANA] ${gender} pose için API'ye istek gönderiliyor... (Deneme ${retry}/${maxRetries})`
      );
      console.log("🚻 [NANO BANANA] Gender debug:", {
        receivedGender: gender,
        genderType: typeof gender,
        isEqualToFemale: gender === "female",
        isEqualToMale: gender === "male",
      });
      console.log(`📝 [NANO BANANA] Prompt: ${prompt.substring(0, 200)}...`);

      // Gender'a göre example resmi seç ve okuyup base64'e çevir
      const exampleImagePath = getExampleImagePath(gender);
      console.log("🖼️ [NANO BANANA] Kullanılan example image:", {
        gender,
        imagePath: exampleImagePath,
        fileExists: fs.existsSync(exampleImagePath),
      });

      if (!fs.existsSync(exampleImagePath)) {
        throw new Error(`Example image bulunamadı: ${exampleImagePath}`);
      }

      const imageBuffer = fs.readFileSync(exampleImagePath);
      const base64Image = imageBuffer.toString("base64");
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;

      const requestBody = {
        input: {
          prompt: prompt,
          image_input: [dataUrl],
          output_format: "png",
        },
      };

      console.log("📡 [NANO BANANA] API isteği gönderiliyor...");
      console.log("📦 [NANO BANANA] Request body:", {
        prompt: prompt.substring(0, 150),
        imageInputSize: dataUrl.length,
        imageFormat: dataUrl.substring(0, 30) + "...",
        gender: gender,
        exampleImageUsed: exampleImagePath,
      });

      const response = await fetch(NANO_BANANA_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(
          `API hatası: ${response.status} - ${errorText}`
        );

        // Service unavailable hatası ise retry yap
        if (
          errorText.includes("Service is temporarily unavailable") ||
          errorText.includes("E004")
        ) {
          console.log(
            `⚠️ [NANO BANANA] Service unavailable hatası, ${
              retry < maxRetries ? "retry yapılıyor..." : "son deneme başarısız"
            }`
          );
          lastError = error;
          if (retry < maxRetries) {
            await delay(5000 * retry); // Exponential backoff
            continue;
          }
        }
        throw error;
      }

      const result = await response.json();
      console.log(
        "📄 [NANO BANANA] İlk yanıt alındı, prediction ID:",
        result.id
      );
      console.log("⏳ [NANO BANANA] Durum:", result.status);

      // Polling ile sonucu bekle
      const prediction = await pollReplicateResult(result.id);

      if (prediction.status === "succeeded" && prediction.output) {
        console.log("✅ [NANO BANANA] Resim başarıyla oluşturuldu!");

        // Output'u kontrol et - string veya array olabilir
        let imageUrl;
        if (typeof prediction.output === "string") {
          imageUrl = prediction.output;
        } else if (
          Array.isArray(prediction.output) &&
          prediction.output.length > 0
        ) {
          imageUrl = prediction.output[0];
        } else {
          throw new Error(
            `Geçersiz output formatı: ${JSON.stringify(prediction.output)}`
          );
        }

        console.log("🔗 [NANO BANANA] Generated URL:", imageUrl);

        // URL kontrolü
        if (!imageUrl || typeof imageUrl !== "string" || imageUrl.length < 10) {
          throw new Error(`Geçersiz URL alındı: ${imageUrl}`);
        }

        return {
          imageUrl: imageUrl,
          predictionId: result.id,
        };
      } else {
        throw new Error(`Beklenmeyen durum: ${prediction.status}`);
      }
    } catch (error) {
      console.error(
        `❌ [NANO BANANA] API hatası (Deneme ${retry}/${maxRetries}):`,
        error.message
      );
      lastError = error;

      // Service temporarily unavailable hatası ise retry yap
      if (error.message.includes("Service temporarily unavailable")) {
        if (retry < maxRetries) {
          console.log(
            `🔄 [NANO BANANA] Service hata, retry yapılıyor... (${retry}/${maxRetries})`
          );
          await delay(5000 * retry); // Exponential backoff
          continue;
        }
      }

      // Diğer hatalar için retry yapma
      if (retry < maxRetries) {
        console.log(
          `🔄 [NANO BANANA] Diğer hata, retry yapılıyor... (${retry}/${maxRetries})`
        );
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
