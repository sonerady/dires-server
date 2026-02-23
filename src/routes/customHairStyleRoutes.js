const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const NANO_BANANA_API_URL = "https://fal.run/fal-ai/nano-banana/edit";

// Example image paths - hair styles için
const getExampleHairImagePath = () => {
  return path.join(__dirname, "../../lib/example_hair.jpg");
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
          thinking_level: "low",
          max_output_tokens: 65535,
        },
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-3-flash/predictions",
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

const { optimizeImageUrl } = require("../utils/imageOptimizer");

// Hair style kartları dikey olduğu için 600x1200 boyutunda optimize et
const optimizeHairStyleImageUrl = (imageUrl) => optimizeImageUrl(imageUrl, { width: 600, height: 1200, quality: 80 });

// Delay fonksiyonu
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polling function removed as Fal.ai handles requests synchronously

// Nano Banana API'ye hair style isteği gönder (retry ile) - Fal.ai Implementation
async function callNanoBananaForHair(prompt, gender) {
  const maxRetries = 3;
  let lastError = null;

  for (let retry = 1; retry <= maxRetries; retry++) {
    try {
      console.log(
        `🎨 [FAL.AI NANO BANANA HAIR] ${gender} hair style için API'ye istek gönderiliyor... (Deneme ${retry}/${maxRetries})`
      );

      // Hair style için example resmi kullan
      const exampleImagePath = getExampleHairImagePath();

      if (!fs.existsSync(exampleImagePath)) {
        throw new Error(`Example hair image bulunamadı: ${exampleImagePath}`);
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
          timeout: 300000, // 5 dakika timeout
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
        console.log("✅ [FAL.AI] Hair style resmi başarıyla oluşturuldu:", imageUrl);

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

      // Diğer hatalar için retry yapma
      if (retry < maxRetries) {
        await delay(3000 * retry);
        continue;
      }
    }
  }

  // Tüm retry'lar başarısız
  throw lastError || new Error("Tüm retry denemeleri başarısız oldu");
}

// Hair style prompt oluştur
function createHairStylePrompt(hairStyleDescription, gender) {
  const genderText = gender === "female" ? "female" : "male";

  return `CHANGE HAIR STYLE: ${hairStyleDescription}. Keep the mannequin head exactly the same - white featureless head on white background. Only change the hair style, do not make it a real person. The ${genderText} mannequin should have the new hair style: ${hairStyleDescription}. Maintain the clean, minimalist aesthetic with focus only on the hair transformation.`;
}

// Hair style açıklamasından otomatik başlık oluştur
async function generateHairStyleTitleWithGemini(hairStyleDescription, gender) {
  try {
    console.log("🏷️ [GEMINI HAIR] Hair style başlığı oluşturuluyor...");
    console.log(
      "🏷️ [GEMINI HAIR] Description:",
      hairStyleDescription.substring(0, 50) + "..."
    );

    const titlePrompt = `
Create a short, catchy title for this hair style description:

HAIR STYLE DESCRIPTION: "${hairStyleDescription}"
GENDER: ${gender}

REQUIREMENTS:
- Maximum 3-4 words
- Professional and descriptive
- Suitable for hair styling
- In English
- No quotes or special characters

EXAMPLES:
- "Curly Bob"
- "Long Waves"
- "Pixie Cut"
- "Beach Waves"
- "Sleek Straight"

Generate ONLY the title, nothing else.
    `;

    const generatedTitle = await callReplicateGeminiFlash(titlePrompt);
    const cleanedTitle = generatedTitle.trim().replace(/['"]/g, "");

    console.log("✅ [GEMINI HAIR] Generated title:", cleanedTitle);
    return cleanedTitle;
  } catch (error) {
    console.error("❌ [GEMINI HAIR] Title generation hatası:", error);
    // Fallback: basit başlık
    return "Custom Hair Style";
  }
}

// Hair style açıklamasını Gemini ile İngilizce'ye çevir ve enhance et
async function enhanceHairStyleDescriptionWithGemini(
  originalDescription,
  gender
) {
  try {
    console.log("🤖 [GEMINI HAIR] Hair style açıklaması enhance ediliyor...");
    console.log("🤖 [GEMINI HAIR] Original description:", originalDescription);
    console.log("🤖 [GEMINI HAIR] Gender:", gender);

    const promptForGemini = `
Translate and convert this hair style description to English with detailed professional description:

INPUT: "${originalDescription}"
GENDER: ${gender}

Return ONLY a JSON object:
{
  "enhancedPrompt": "A ${gender} mannequin with [detailed hair style description including length, texture, color, cut]. Focus only on hair transformation while maintaining mannequin appearance.",
  "hairStyleDescription": "DETAILED professional hair style description (40-60 words minimum, include cut details, texture, layering, styling, and overall silhouette)"
}

EXAMPLE OUTPUT:
{
  "enhancedPrompt": "A female mannequin with a timeless classic pixie cut, closely cropped around the ears and nape with slightly longer layers at the crown",
  "hairStyleDescription": "A timeless classic pixie cut, closely cropped around the ears and nape with slightly longer layers at the crown. The top is softly feathered to create natural volume and light movement, while the sides are neatly tapered to frame the face with precision. The overall silhouette hugs the head but retains a chic, airy texture, making it versatile and modern."
}

REQUIREMENTS for hairStyleDescription:
- Minimum 40-60 words
- Include specific cut details (length, layers, graduation)
- Describe texture and styling elements
- Mention how it frames the face
- Include overall silhouette and aesthetic
- Professional hairstyling terminology
- Detailed and descriptive like a professional hair stylist would describe

Examples:
- Input: "Kıvırcık saç" → "hairStyleDescription": "A voluminous curly hairstyle featuring natural spiral curls with varied textures throughout. The curls cascade from a center part, creating dynamic movement and bounce. The layers are strategically cut to enhance the curl pattern while preventing excessive bulk, resulting in a balanced silhouette that frames the face beautifully with soft, defined ringlets."

- Input: "Düz uzun saç" → "hairStyleDescription": "A sleek, long straight hairstyle that flows gracefully past the shoulders with a glass-like shine. The hair is cut in subtle layers to create gentle movement while maintaining the clean, linear appearance. The ends are precision-cut to create a healthy, blunt finish that enhances the hair's natural luster and creates an elegant, sophisticated silhouette."

- Input: "Kısa bob kesim" → "hairStyleDescription": "A classic bob cut that falls just below the jawline, featuring clean geometric lines and a blunt perimeter. The hair is cut in a precise A-line shape that gradually lengthens from the back to the front, creating a flattering angle that frames the face. The interior layers are minimal to maintain the bob's structural integrity while allowing for subtle movement and body."

IMPORTANT: Return ONLY valid JSON, no extra text.
    `;

    const responseText = await callReplicateGeminiFlash(promptForGemini);
    console.log("🔍 [GEMINI HAIR] Raw response:", responseText);

    // JSON'dan önce ve sonraki backtick'leri ve markdown formatını temizle
    const cleanedResponse = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .replace(/`/g, "")
      .trim();

    console.log("🧹 [GEMINI HAIR] Cleaned response:", cleanedResponse);

    try {
      const parsedResult = JSON.parse(cleanedResponse);
      console.log("✅ [GEMINI HAIR] Enhanced result:", {
        prompt: parsedResult.enhancedPrompt?.substring(0, 50) + "...",
        hairStyleDesc: parsedResult.hairStyleDescription,
      });
      return parsedResult;
    } catch (parseError) {
      console.error("❌ [GEMINI HAIR] JSON parse hatası:", parseError);
      console.log("🔄 [GEMINI HAIR] Tekrar deneniyor...");

      // Daha basit prompt ile tekrar dene
      const simplePrompt = `Translate "${originalDescription}" to detailed English hair style description (minimum 40 words). Return JSON: {"enhancedPrompt": "A ${gender} mannequin with detailed ${originalDescription} hair style", "hairStyleDescription": "detailed professional hair style description with cut details, texture, and styling elements"}`;

      const retryTextRaw = await callReplicateGeminiFlash(simplePrompt);

      try {
        const retryText = retryTextRaw
          .trim()
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .replace(/`/g, "")
          .trim();
        const retryParsed = JSON.parse(retryText);
        console.log("✅ [GEMINI HAIR] Retry başarılı:", retryParsed);
        return retryParsed;
      } catch (retryError) {
        console.error("❌ [GEMINI HAIR] Retry de başarısız:", retryError);
        throw new Error("Gemini hair style response could not be parsed");
      }
    }
  } catch (error) {
    console.error(
      "❌ [GEMINI HAIR] Hair style description enhancement hatası:",
      error
    );
    throw new Error("Gemini API failed to generate hair style description");
  }
}

/**
 * Kullanıcının özel hair style'ını kaydetme ve görsel oluşturma
 * POST /api/customHairStyle/create
 */
router.post("/create", async (req, res) => {
  try {
    const {
      userId,
      hairStyleDescription,
      gender = "female", // varsayılan kadın
      isPublic = true, // varsayılan herkese açık
    } = req.body;

    console.log("💇 [CUSTOM HAIR STYLE] Yeni hair style oluşturma isteği:", {
      userId,
      hairStyleDescription: hairStyleDescription?.substring(0, 100) + "...",
      gender,
      isPublic,
      originalGender: gender,
      genderType: typeof gender,
      allRequestBody: req.body,
    });

    // Validasyon
    if (!userId || !hairStyleDescription) {
      return res.status(400).json({
        success: false,
        error: "userId ve hairStyleDescription zorunludur",
      });
    }

    // Unique ID oluştur
    const hairStyleId = uuidv4();
    const timestamp = new Date().toISOString();

    // 🏷️ Gemini ile otomatik başlık oluştur
    const generatedTitle = await generateHairStyleTitleWithGemini(
      hairStyleDescription,
      gender
    );

    // 🤖 Gemini ile hair style açıklamasını enhance et
    const geminiResult = await enhanceHairStyleDescriptionWithGemini(
      hairStyleDescription,
      gender
    );

    // Nano Banana için prompt hazırla
    const hairStylePrompt = createHairStylePrompt(
      geminiResult.hairStyleDescription,
      gender
    );

    console.log("🎨 [NANO BANANA HAIR] Görsel oluşturma başlatılıyor...");
    console.log("🚻 [PROMPT HAIR] Gender ve prompt debug:", {
      inputGender: gender,
      genderInPrompt: gender === "female" ? "FEMALE" : "MALE",
      enhancedDescription: geminiResult.hairStyleDescription?.substring(0, 100),
      finalPrompt: hairStylePrompt?.substring(0, 200),
    });
    console.log(
      "🎨 [NANO BANANA HAIR] Full Hair Style prompt:",
      hairStylePrompt
    );

    // Nano Banana API çağrısı (retry ile)
    const nanoBananaResult = await callNanoBananaForHair(
      hairStylePrompt,
      gender
    );

    let imageUrl = null;
    let nanoBananaPredictionId = nanoBananaResult.predictionId;
    let supabaseImagePath = null;

    if (nanoBananaResult.imageUrl) {
      console.log(
        "✅ [NANO BANANA HAIR] Hair style görseli başarıyla oluşturuldu:",
        nanoBananaResult.imageUrl
      );

      // 📁 Nano Banana'dan gelen görseli Supabase'e kaydet
      try {
        console.log(
          "📁 [SUPABASE HAIR] Görsel Supabase storage'a kaydediliyor..."
        );

        // Nano Banana'dan görseli indir
        const imageResponse = await axios.get(nanoBananaResult.imageUrl, {
          responseType: "arraybuffer",
        });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Supabase storage path: custom_hairs/userId/hairStyleId.png
        const storagePath = `${userId}/${hairStyleId}.png`;
        supabaseImagePath = storagePath;

        // Supabase'e yükle
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("custom_hairs")
          .upload(storagePath, imageBuffer, {
            contentType: "image/png",
            upsert: true,
          });

        if (uploadError) {
          console.error(
            "❌ [SUPABASE HAIR] Storage upload hatası:",
            uploadError
          );
          // Nano Banana URL'sini kullan fallback olarak
          imageUrl = nanoBananaResult.imageUrl;
        } else {
          // Supabase public URL al
          const { data: publicUrlData } = supabase.storage
            .from("custom_hairs")
            .getPublicUrl(storagePath);

          imageUrl = publicUrlData.publicUrl;
          console.log(
            "✅ [SUPABASE HAIR] Hair style görseli başarıyla kaydedildi:",
            imageUrl
          );
        }
      } catch (storageError) {
        console.error(
          "❌ [SUPABASE HAIR] Storage işlemi hatası:",
          storageError
        );
        // Nano Banana URL'sini kullan fallback olarak
        imageUrl = nanoBananaResult.imageUrl;
      }
    }

    // 💾 Supabase'e hair style bilgilerini kaydet
    const { data: hairStyleData, error: insertError } = await supabase
      .from("custom_hair_styles")
      .insert({
        id: hairStyleId,
        user_id: userId,
        title: generatedTitle, // Gemini ile oluşturulan başlık
        description: hairStyleDescription, // Kullanıcının orijinal açıklaması
        enhanced_description: geminiResult.hairStyleDescription, // Gemini'den gelen kısa İngilizce hair style tarifi
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
      console.error(
        "❌ [SUPABASE HAIR] Hair style kaydetme hatası:",
        insertError
      );
      return res.status(500).json({
        success: false,
        error: "Hair style kaydedilemedi: " + insertError.message,
      });
    }

    console.log(
      "✅ [CUSTOM HAIR STYLE] Hair style başarıyla oluşturuldu:",
      hairStyleData.id
    );

    res.json({
      success: true,
      result: {
        hairStyle: hairStyleData,
        message: imageUrl
          ? "Hair style başarıyla oluşturuldu ve görsel hazırlandı!"
          : "Hair style oluşturuldu, görsel hazırlanıyor...",
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM HAIR STYLE] Genel hata:", error);

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
          "İçerik uygun değil. Lütfen farklı bir hair style açıklaması ile tekrar deneyin.",
        errorType: "sensitive_content",
        canRetry: true,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Hair style oluşturulurken hata oluştu: " + error.message,
        canRetry: true,
      });
    }
  }
});

/**
 * Kullanıcının özel hair style'larını listeleme
 * GET /api/customHairStyle/list/:userId
 */
router.get("/list/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { gender, category } = req.query;

    console.log("📋 [CUSTOM HAIR STYLE] Hair style listesi isteniyor:", {
      userId,
      gender,
      category,
    });

    let query = supabase
      .from("custom_hair_styles")
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

    const { data: hairStyles, error } = await query;

    if (error) {
      console.error("❌ [SUPABASE HAIR] Hair style listesi hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Hair style'lar getirilemedi: " + error.message,
      });
    }

    console.log(
      `✅ [CUSTOM HAIR STYLE] ${hairStyles.length} hair style bulundu`
    );

    // Image URL'leri optimize et
    const optimizedHairStyles = hairStyles.map((hairStyle) => ({
      ...hairStyle,
      image_url: optimizeHairStyleImageUrl(hairStyle.image_url),
    }));

    res.json({
      success: true,
      result: {
        hairStyles: optimizedHairStyles,
        count: optimizedHairStyles.length,
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM HAIR STYLE] Liste hatası:", error);
    res.status(500).json({
      success: false,
      error: "Hair style listesi alınırken hata oluştu: " + error.message,
    });
  }
});

/**
 * Özel hair style silme
 * DELETE /api/customHairStyle/delete/:hairStyleId
 */
router.delete("/delete/:hairStyleId", async (req, res) => {
  try {
    const { hairStyleId } = req.params;
    const { userId } = req.body;

    console.log("🗑️ [CUSTOM HAIR STYLE] Hair style silme isteği:", {
      hairStyleId,
      userId,
    });

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId zorunludur",
      });
    }

    // Soft delete - is_active false yap
    const { data: deletedHairStyle, error } = await supabase
      .from("custom_hair_styles")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", hairStyleId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("❌ [SUPABASE HAIR] Hair style silme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Hair style silinemedi: " + error.message,
      });
    }

    if (!deletedHairStyle) {
      return res.status(404).json({
        success: false,
        error: "Hair style bulunamadı veya size ait değil",
      });
    }

    console.log(
      "✅ [CUSTOM HAIR STYLE] Hair style başarıyla silindi:",
      hairStyleId
    );

    res.json({
      success: true,
      result: {
        message: "Hair style başarıyla silindi",
        deletedHairStyle: deletedHairStyle,
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM HAIR STYLE] Silme hatası:", error);
    res.status(500).json({
      success: false,
      error: "Hair style silinirken hata oluştu: " + error.message,
    });
  }
});

/**
 * Hair style görsel durumunu kontrol etme
 * GET /api/customHairStyle/status/:hairStyleId
 */
router.get("/status/:hairStyleId", async (req, res) => {
  try {
    const { hairStyleId } = req.params;

    console.log(
      "🔍 [CUSTOM HAIR STYLE] Hair style durumu kontrol ediliyor:",
      hairStyleId
    );

    const { data: hairStyle, error } = await supabase
      .from("custom_hair_styles")
      .select("*")
      .eq("id", hairStyleId)
      .eq("is_active", true)
      .single();

    if (error || !hairStyle) {
      return res.status(404).json({
        success: false,
        error: "Hair style bulunamadı",
      });
    }

    // Eğer görsel henüz hazır değilse Nano Banana API'den kontrol et
    if (!hairStyle.image_url && hairStyle.nano_banana_prediction_id) {
      try {
        const statusResponse = await axios.get(
          `https://api.replicate.com/v1/predictions/${hairStyle.nano_banana_prediction_id}`,
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
          const { data: updatedHairStyle, error: updateError } = await supabase
            .from("custom_hair_styles")
            .update({
              image_url: imageUrl,
              updated_at: new Date().toISOString(),
            })
            .eq("id", hairStyleId)
            .select()
            .single();

          if (!updateError) {
            hairStyle.image_url = imageUrl;
            console.log(
              "✅ [CUSTOM HAIR STYLE] Görsel URL güncellendi:",
              imageUrl
            );
          }
        }
      } catch (nanoBananaError) {
        console.error(
          "❌ [NANO BANANA HAIR] Status kontrolü hatası:",
          nanoBananaError.message
        );
      }
    }

    res.json({
      success: true,
      result: {
        hairStyle: hairStyle,
        status: hairStyle.image_url ? "ready" : "processing",
      },
    });
  } catch (error) {
    console.error("❌ [CUSTOM HAIR STYLE] Durum kontrol hatası:", error);
    res.status(500).json({
      success: false,
      error:
        "Hair style durumu kontrol edilirken hata oluştu: " + error.message,
    });
  }
});

module.exports = router;
