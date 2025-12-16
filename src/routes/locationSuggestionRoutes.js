const express = require("express");
const router = express.Router();
// Updated: Using Google Gemini API for location suggestions
const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");
const sharp = require("sharp");
const mime = require("mime");

// Gemini API setup
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Replicate API üzerinden Gemini 2.5 Flash çağrısı yapan helper fonksiyon
// Hata durumunda 3 kez tekrar dener
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 [REPLICATE-GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

      // Debug: Request bilgilerini logla
      console.log(`🔍 [REPLICATE-GEMINI] Images count: ${imageUrls.length}`);
      console.log(`🔍 [REPLICATE-GEMINI] Prompt length: ${prompt.length} chars`);

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls, // Direkt URL string array olarak gönder
          prompt: prompt,
          videos: [],
          temperature: 1,
          dynamic_thinking: false,
          max_output_tokens: 65535
        }
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
        requestBody,
        {
          headers: {
            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            "Prefer": "wait"
          },
          timeout: 120000 // 2 dakika timeout
        }
      );

      const data = response.data;

      // Hata kontrolü
      if (data.error) {
        console.error(`❌ [REPLICATE-GEMINI] API error:`, data.error);
        throw new Error(data.error);
      }

      // Status kontrolü
      if (data.status !== "succeeded") {
        console.error(`❌ [REPLICATE-GEMINI] Prediction failed with status:`, data.status);
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

      console.log(`✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`);
      console.log(`📊 [REPLICATE-GEMINI] Metrics:`, data.metrics);

      return outputText.trim();

    } catch (error) {
      console.error(`❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        console.error(`❌ [REPLICATE-GEMINI] All ${maxRetries} attempts failed`);
        throw error;
      }

      // Retry öncesi kısa bekleme (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

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

    console.log("🏞️ [GEMINI] Mekan önerisi isteği alındı");
    console.log("🖼️ [GEMINI] Image URL:", imageUrl);
    console.log("🌐 [GEMINI] Language:", language);

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

DIVERSITY GUIDELINES:
- Suggestions detailed, vivid, and highly descriptive
- Avoid generic or cliché locations (e.g., standard parks, plain white rooms) unless specifically suitable
- Aim for UNIQUE, CREATIVE, and AESTHETICALLY PLEASING environments
- Consider the mood, lighting, and texture of the location
- Ensure diversity in indoor vs outdoor settings (unless category strictly dictates one)
- For fashion items, consider editorial and lifestyle contexts

IMPORTANT: 
- Do NOT mention the garment/product in your suggestions
- Focus on the environment, lighting, atmosphere, and style that matches the category and product type
- Make suggestions suitable for high-end professional photography
- Return ONLY valid JSON array, no additional text or explanations
- ALL suggestions MUST be in ${language} language



Analyze the image, identify the category and product type, then generate 5 location suggestions as a JSON array in ${language} language.`;

    // Replicate Gemini Flash API için resim URL'lerini hazırla
    const imageUrls = [];

    // HTTP URL ise direkt kullan, base64 ise URL yok
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      imageUrls.push(imageUrl);
      console.log("🖼️ [REPLICATE-GEMINI] Image URL eklendi:", imageUrl);
    } else if (imageUrl.startsWith("data:image/")) {
      console.log("⚠️ [REPLICATE-GEMINI] Base64 data URL - resim olmadan devam ediliyor (Replicate API sadece URL destekler)");
    }

    // Replicate Gemini Flash API çağrısı
    let suggestions = null;

    try {
      console.log("🤖 [REPLICATE-GEMINI] Location suggestions API çağrısı başlatılıyor...");

      const geminiResponse = await callReplicateGeminiFlash(promptForGemini, imageUrls, 3);

      if (!geminiResponse) {
        throw new Error("Replicate Gemini API response is empty or invalid");
      }

      console.log(
        "🤖 [REPLICATE-GEMINI] Location suggestions response:",
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
        cleanedResponse = cleanedResponse.replace(/\][^]*$/, "]");

        suggestions = JSON.parse(cleanedResponse);

        // Array kontrolü
        if (!Array.isArray(suggestions)) {
          throw new Error("Response is not an array");
        }

        // 5 öneri kontrolü
        if (suggestions.length !== 5) {
          console.warn(
            `⚠️ [REPLICATE-GEMINI] Beklenen 5 öneri, ${suggestions.length} alındı`
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
          `✅ [REPLICATE-GEMINI] ${suggestions.length} öneri başarıyla alındı`
        );
      } catch (parseError) {
        console.error(
          "❌ [REPLICATE-GEMINI] JSON parse hatası:",
          parseError.message
        );
        console.log(
          "📝 [REPLICATE-GEMINI] Raw response:",
          geminiResponse
        );

        // Fallback önerileri kullan (genel amaçlı)
        suggestions = [
          "Modern minimalist office environment with large glass windows and natural daylight",
          "Luxury hotel lobby with marble floors, crystal chandeliers, elegant furniture",
          "Seaside cafe with wooden decor, tropical plants, open-air setting",
          "Vintage boutique store with antique items, warm tones, nostalgic atmosphere",
          "Modern studio with white walls, professional lighting setup, minimal decor",
        ];
        console.log(
          "🔄 [REPLICATE-GEMINI] Fallback önerileri kullanılıyor"
        );
      }
    } catch (geminiError) {
      console.error(
        "❌ [REPLICATE-GEMINI] Location suggestions API failed:",
        geminiError.message
      );

      // Fallback önerileri kullan (genel amaçlı)
      suggestions = [
        "Modern minimalist office environment with large glass windows and natural daylight",
        "Luxury hotel lobby with marble floors, crystal chandeliers, elegant furniture",
        "Seaside cafe with wooden decor, tropical plants, open-air setting",
        "Vintage boutique store with antique items, warm tones, nostalgic atmosphere",
        "Modern studio with white walls, professional lighting setup, minimal decor",
      ];
      console.log(
        "🔄 [REPLICATE-GEMINI] Fallback önerileri kullanılıyor (hata durumunda)"
      );
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
    console.error("❌ [GEMINI] Genel hata:", error);
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
