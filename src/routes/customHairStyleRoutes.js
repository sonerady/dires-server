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

// Example image paths - hair styles için
const getExampleHairImagePath = () => {
  return path.join(__dirname, "../../lib/example_hair.jpg");
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
      return baseUrl + "?width=600&height=1200&quality=80";
    }
    // Normal object URL'i ise render URL'ine çevir
    return (
      imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      ) + "?width=600&height=1200&quality=80"
    );
  }

  return imageUrl;
};

// Delay fonksiyonu
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Prediction durumunu kontrol et
async function pollReplicateResult(predictionId, maxAttempts = 60) {
  console.log(
    `🔄 [NANO BANANA HAIR] Prediction polling başlatılıyor: ${predictionId}`
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
        `🔍 [NANO BANANA HAIR] Polling attempt ${attempt + 1}: status = ${
          result.status
        }`
      );

      if (result.status === "succeeded") {
        console.log("✅ [NANO BANANA HAIR] İşlem başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("❌ [NANO BANANA HAIR] İşlem başarısız:", result.error);

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
            "⚠️ [NANO BANANA HAIR] Sensitive content hatası:",
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
            "🔄 [NANO BANANA HAIR] Geçici hata tespit edildi:",
            result.error
          );
          throw new Error(`Service temporarily unavailable: ${result.error}`);
        }

        throw new Error(result.error || "Nano Banana hair processing failed");
      } else if (result.status === "canceled") {
        console.error("❌ [NANO BANANA HAIR] İşlem iptal edildi");
        throw new Error("Nano Banana hair processing was canceled");
      }

      // Processing veya starting durumundaysa bekle
      if (result.status === "processing" || result.status === "starting") {
        await delay(2000); // 2 saniye bekle
        continue;
      }
    } catch (error) {
      console.error(
        `❌ [NANO BANANA HAIR] Polling attempt ${attempt + 1} hatası:`,
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

// Nano Banana API'ye hair style isteği gönder (retry ile)
async function callNanoBananaForHair(prompt, gender) {
  const maxRetries = 3;
  let lastError = null;

  for (let retry = 1; retry <= maxRetries; retry++) {
    try {
      console.log(
        `🎨 [NANO BANANA HAIR] ${gender} hair style için API'ye istek gönderiliyor... (Deneme ${retry}/${maxRetries})`
      );
      console.log("🚻 [NANO BANANA HAIR] Gender debug:", {
        receivedGender: gender,
        genderType: typeof gender,
        isEqualToFemale: gender === "female",
        isEqualToMale: gender === "male",
      });
      console.log(
        `📝 [NANO BANANA HAIR] Prompt: ${prompt.substring(0, 200)}...`
      );

      // Hair style için example resmi kullan
      const exampleImagePath = getExampleHairImagePath();
      console.log("🖼️ [NANO BANANA HAIR] Kullanılan example image:", {
        imagePath: exampleImagePath,
        fileExists: fs.existsSync(exampleImagePath),
      });

      if (!fs.existsSync(exampleImagePath)) {
        throw new Error(`Example hair image bulunamadı: ${exampleImagePath}`);
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

      console.log("📡 [NANO BANANA HAIR] API isteği gönderiliyor...");
      console.log("📦 [NANO BANANA HAIR] Request body:", {
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
            `⚠️ [NANO BANANA HAIR] Service unavailable hatası, ${
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
        "📄 [NANO BANANA HAIR] İlk yanıt alındı, prediction ID:",
        result.id
      );
      console.log("⏳ [NANO BANANA HAIR] Durum:", result.status);

      // Polling ile sonucu bekle
      const prediction = await pollReplicateResult(result.id);

      if (prediction.status === "succeeded" && prediction.output) {
        console.log(
          "✅ [NANO BANANA HAIR] Hair style resmi başarıyla oluşturuldu!"
        );

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

        console.log("🔗 [NANO BANANA HAIR] Generated URL:", imageUrl);

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
        `❌ [NANO BANANA HAIR] API hatası (Deneme ${retry}/${maxRetries}):`,
        error.message
      );
      lastError = error;

      // Service temporarily unavailable hatası ise retry yap
      if (error.message.includes("Service temporarily unavailable")) {
        if (retry < maxRetries) {
          console.log(
            `🔄 [NANO BANANA HAIR] Service hata, retry yapılıyor... (${retry}/${maxRetries})`
          );
          await delay(5000 * retry); // Exponential backoff
          continue;
        }
      }

      // Diğer hatalar için retry yapma
      if (retry < maxRetries) {
        console.log(
          `🔄 [NANO BANANA HAIR] Diğer hata, retry yapılıyor... (${retry}/${maxRetries})`
        );
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

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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

    const result = await model.generateContent({
      contents: [{ parts: [{ text: titlePrompt }] }],
    });

    const generatedTitle = result.response.text().trim().replace(/['"]/g, "");

    console.log("✅ [GEMINI HAIR] Generated title:", generatedTitle);
    return generatedTitle;
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

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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

    const result = await model.generateContent({
      contents: [{ parts: [{ text: promptForGemini }] }],
    });

    const responseText = result.response.text().trim();
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

        // Supabase storage path: custom-hair-styles/userId/hairStyleId.png
        const storagePath = `${userId}/${hairStyleId}.png`;
        supabaseImagePath = storagePath;

        // Supabase'e yükle
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("custom-hair-styles")
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
            .from("custom-hair-styles")
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
      image_url: optimizeImageUrl(hairStyle.image_url),
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
