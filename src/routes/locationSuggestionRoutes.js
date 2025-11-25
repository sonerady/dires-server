const express = require("express");
const router = express.Router();
// Updated: Using Replicate's google/gemini-2.5-flash model for location suggestions
// No longer using @google/genai SDK
const axios = require("axios");
const sharp = require("sharp");

/**
 * Kıyafet resmine göre mekan önerileri oluştur
 * POST /api/location-suggestions/generate
 */
router.post("/generate", async (req, res) => {
  try {
    const { imageUrl, language = "en" } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        result: {
          message: "imageUrl gereklidir",
        },
      });
    }

    console.log("🏞️ [REPLICATE GEMINI] Mekan önerisi isteği alındı");
    console.log("🖼️ [REPLICATE GEMINI] Image URL:", imageUrl);
    console.log("🌐 [REPLICATE GEMINI] Language:", language);

    // Prompt oluştur - dil bilgisini ekle
    const promptForGemini = `
MANDATORY INSTRUCTION: You are a professional fashion photography location consultant. Analyze the image and identify:
1. The CATEGORY of the subject (baby/newborn, child, woman, man, jewelry, accessories, etc.)
2. The TYPE of product (clothing, jewelry, baby products, shoes, bags, etc.)
3. Based on these, suggest 5 suitable location prompts for professional photography.

CRITICAL REQUIREMENTS:
1. FIRST, identify the category and product type from the image
2. DO NOT describe the garment/product details, colors, patterns, or design elements
3. Focus ONLY on suggesting appropriate locations/environments that match the category and product type
4. Each suggestion should be a complete, detailed location description suitable for professional photography
5. Suggestions should be diverse and cover different aesthetic styles
6. Each suggestion should be 1-2 sentences long, descriptive and professional
7. Output format: Return ONLY a JSON array with exactly 5 location prompt strings, nothing else
8. LANGUAGE REQUIREMENT: All suggestions MUST be written in ${language} language

CATEGORY-SPECIFIC GUIDELINES:
- If it's a BABY/NEWBORN product: Suggest locations like nursery, crib, baby room, soft play area, family home setting, etc.
- If it's a CHILD product: Suggest locations like playground, children's room, school, park, fun and playful environments, etc.
- If it's WOMEN'S fashion: Suggest locations like elegant spaces, modern studios, luxury settings, fashion-forward environments, etc.
- If it's MEN'S fashion: Suggest locations like modern offices, urban settings, sophisticated spaces, etc.
- If it's JEWELRY: Suggest locations like elegant displays, luxury settings, sophisticated backgrounds, etc.
- If it's ACCESSORIES (bags, shoes, etc.): Suggest locations that complement the accessory style

IMPORTANT: 
- Do NOT mention the garment/product in your suggestions
- Focus on the environment, lighting, atmosphere, and style that matches the category and product type
- Make suggestions suitable for high-end professional photography
- Return ONLY valid JSON array, no additional text or explanations
- ALL suggestions MUST be in ${language} language

Analyze the image, identify the category and product type, then generate 5 location suggestions as a JSON array in ${language} language.`;

    // Replicate API için resim URL'ini hazırla
    let imageUrlForReplicate = imageUrl;

    // Base64 data URL ise Supabase'e upload et ve URL al (Replicate direkt base64 kabul etmiyor)
    if (imageUrl.startsWith("data:image/")) {
      console.log("📦 [REPLICATE GEMINI] Base64 data URL tespit edildi, Supabase'e upload ediliyor...");
      try {
        // Base64'ten buffer oluştur
        const base64Data = imageUrl.split(",")[1];
        const imageBuffer = Buffer.from(base64Data, "base64");

        // EXIF rotation düzeltmesi uygula
        let processedBuffer;
        try {
          processedBuffer = await sharp(imageBuffer)
            .rotate()
            .jpeg({ quality: 100 })
            .toBuffer();
        } catch (sharpError) {
          processedBuffer = imageBuffer; // Fallback
        }

        // Supabase'e upload et (geçici olarak)
        const { createClient } = require("@supabase/supabase-js");
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });

        const timestamp = Date.now();
        const fileName = `temp_location_suggestion_${timestamp}.jpg`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("reference")
          .upload(fileName, processedBuffer, {
            contentType: "image/jpeg",
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        const { data: urlData } = supabase.storage
          .from("reference")
          .getPublicUrl(fileName);

        imageUrlForReplicate = urlData.publicUrl;
        console.log("✅ [REPLICATE GEMINI] Base64 resim Supabase'e upload edildi");
      } catch (uploadError) {
        console.error("❌ [REPLICATE GEMINI] Supabase upload hatası:", uploadError.message);
        return res.status(500).json({
          success: false,
          result: {
            message: "Görsel yüklenirken hata oluştu",
            error: uploadError.message,
          },
        });
      }
    }

    // Replicate API'den cevap al (retry mekanizması ile)
    let suggestions = null;
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🤖 [REPLICATE GEMINI] Location suggestions API çağrısı attempt ${attempt}/${maxRetries}`
        );

        // Replicate API request body hazırla
        const replicateRequestBody = {
          input: {
            top_p: 0.95,
            images: [imageUrlForReplicate], // Array of image URLs
            prompt: promptForGemini,
            videos: [],
            temperature: 1,
            dynamic_thinking: false,
            max_output_tokens: 65535,
          },
        };

        const replicateResponse = await axios.post(
          "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
          replicateRequestBody,
          {
            headers: {
              Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
              "Content-Type": "application/json",
              Prefer: "wait",
            },
            timeout: 120000,
          }
        );

        const result = replicateResponse.data;

        // Response kontrolü
        let geminiResponse = "";
        if (result.status === "succeeded" && result.output) {
          // Output bir array, birleştir
          geminiResponse = Array.isArray(result.output)
            ? result.output.join("").trim()
            : String(result.output || "").trim();
        } else if (result.status === "processing" || result.status === "starting") {
          // Processing durumunda polling yap
          console.log("⏳ [REPLICATE GEMINI] Processing, polling başlatılıyor...");

          let pollingResult = result;
          const maxPollingAttempts = 30;

          for (
            let pollAttempt = 0;
            pollAttempt < maxPollingAttempts;
            pollAttempt++
          ) {
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const pollResponse = await axios.get(
              `https://api.replicate.com/v1/predictions/${result.id}`,
              {
                headers: {
                  Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
                },
                timeout: 10000,
              }
            );

            pollingResult = pollResponse.data;

            if (pollingResult.status === "succeeded" && pollingResult.output) {
              geminiResponse = Array.isArray(pollingResult.output)
                ? pollingResult.output.join("").trim()
                : String(pollingResult.output || "").trim();
              break;
            } else if (pollingResult.status === "failed") {
              throw new Error(
                `Replicate Gemini polling failed: ${
                  pollingResult.error || "Unknown error"
                }`
              );
            }
          }

          if (!geminiResponse) {
            throw new Error("Replicate Gemini polling timeout");
          }
        } else {
          throw new Error(
            `Replicate Gemini API unexpected status: ${result.status}`
          );
        }

        if (!geminiResponse) {
          console.error("❌ [REPLICATE GEMINI] API response boş");
          throw new Error("Replicate Gemini API response is empty or invalid");
        }

        console.log(
          "🤖 [REPLICATE GEMINI] Location suggestions response:",
          geminiResponse.substring(0, 200) + "..."
        );

        // JSON parse et
        try {
          // JSON kod bloklarını temizle
          let cleanedResponse = geminiResponse
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .replace(/`/g, "")
            .trim();

          // Eğer başında veya sonunda fazladan karakterler varsa temizle
          cleanedResponse = cleanedResponse.replace(/^[^[]*\[/, "[");
          cleanedResponse = cleanedResponse.replace(/\][^]]*$/, "]");

          suggestions = JSON.parse(cleanedResponse);

          // Array kontrolü
          if (!Array.isArray(suggestions)) {
            throw new Error("Response is not an array");
          }

          // 5 öneri kontrolü
          if (suggestions.length !== 5) {
            console.warn(
              `⚠️ [REPLICATE GEMINI] Beklenen 5 öneri, ${suggestions.length} alındı`
            );
            // Eğer 5'ten azsa, eksikleri doldur
            while (suggestions.length < 5) {
              suggestions.push(
                "Professional fashion photography location with optimal lighting and atmosphere"
              );
            }
            // Eğer 5'ten fazlaysa, ilk 5'i al
            suggestions = suggestions.slice(0, 5);
          }

          console.log(
            `✅ [REPLICATE GEMINI] ${suggestions.length} öneri başarıyla alındı`
          );
          break; // Başarılı olursa loop'tan çık
        } catch (parseError) {
          console.error(
            "❌ [REPLICATE GEMINI] JSON parse hatası:",
            parseError.message
          );
          console.log(
            "📝 [REPLICATE GEMINI] Raw response:",
            geminiResponse
          );

          if (attempt === maxRetries) {
            // Son denemede fallback önerileri kullan (genel amaçlı)
            suggestions = [
              "Modern minimalist office environment with large glass windows and natural daylight",
              "Luxury hotel lobby with marble floors, crystal chandeliers, elegant furniture",
              "Seaside cafe with wooden decor, tropical plants, open-air setting",
              "Vintage boutique store with antique items, warm tones, nostalgic atmosphere",
              "Modern studio with white walls, professional lighting setup, minimal decor",
            ];
            console.log(
              "🔄 [REPLICATE GEMINI] Fallback önerileri kullanılıyor"
            );
          } else {
            throw parseError;
          }
        }
      } catch (replicateError) {
        console.error(
          `❌ [REPLICATE GEMINI] Location suggestions API attempt ${attempt} failed:`,
          replicateError.message
        );

        if (attempt === maxRetries) {
          // Son denemede fallback önerileri kullan (genel amaçlı)
          suggestions = [
            "Modern minimalist office environment with large glass windows and natural daylight",
            "Luxury hotel lobby with marble floors, crystal chandeliers, elegant furniture",
            "Seaside cafe with wooden decor, tropical plants, open-air setting",
            "Vintage boutique store with antique items, warm tones, nostalgic atmosphere",
            "Modern studio with white walls, professional lighting setup, minimal decor",
          ];
          console.log(
            "🔄 [REPLICATE GEMINI] Fallback önerileri kullanılıyor (hata durumunda)"
          );
        } else {
          // Exponential backoff: 1s, 2s
          const waitTime = Math.pow(2, attempt - 1) * 1000;
          console.log(`⏳ ${waitTime}ms bekleniyor, sonra tekrar denenecek...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    if (!suggestions || suggestions.length === 0) {
      return res.status(500).json({
        success: false,
        result: {
          message: "Mekan önerileri oluşturulamadı",
        },
      });
    }

    return res.status(200).json({
      success: true,
      result: {
        suggestions: suggestions,
        count: suggestions.length,
      },
    });
  } catch (error) {
    console.error("❌ [REPLICATE GEMINI] Genel hata:", error);
    return res.status(500).json({
      success: false,
      result: {
        message: "Mekan önerileri oluşturulurken hata oluştu",
        error: error.message,
      },
    });
  }
});

module.exports = router;
