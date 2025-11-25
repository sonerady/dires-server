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

    // Google Gemini API için resim verilerini hazırla
    const parts = [{ text: promptForGemini }];

    // Resim verilerini içerecek parts dizisini hazırla
    try {
      console.log("📤 [GEMINI] Resim Gemini'ye gönderiliyor...");

      let imageBuffer;

      // HTTP URL ise indir, base64 data URL ise direkt kullan
      if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
        // HTTP URL - normal indirme
        console.log("🌐 [GEMINI] HTTP URL indiriliyor...");
        const imageResponse = await axios.get(imageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
        });
        imageBuffer = Buffer.from(imageResponse.data);
      } else if (imageUrl.startsWith("data:image/")) {
        // Base64 data URL
        console.log("📦 [GEMINI] Base64 data URL kullanılıyor...");
        const base64Data = imageUrl.split(",")[1];
        imageBuffer = Buffer.from(base64Data, "base64");
      } else {
        throw new Error("Invalid image URL format");
      }

      // EXIF rotation düzeltmesi uygula
      let processedBuffer;
      try {
        processedBuffer = await sharp(imageBuffer)
          .rotate() // EXIF orientation bilgisini otomatik uygula
          .jpeg({ quality: 100 })
          .toBuffer();
      } catch (sharpError) {
        processedBuffer = imageBuffer; // Fallback
      }

      const base64 = processedBuffer.toString("base64");
      const mimeType = mime.getType(imageUrl) || "image/jpeg";
      parts.push({
        inlineData: {
          data: base64,
          mimeType: mimeType,
        },
      });

      console.log("✅ [GEMINI] Resim Gemini'ye eklendi");
    } catch (imageError) {
      console.error("❌ Resim işleme hatası:", imageError);
      throw new Error(`Image processing error: ${imageError.message}`);
    }

    // Google Gemini API çağrısı (retry mekanizması ile)
    let suggestions = null;
    const maxRetries = 2;
    const model = "gemini-flash-latest";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🤖 [GEMINI] Location suggestions API çağrısı attempt ${attempt}/${maxRetries}`
        );

        const result = await genAI.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: parts,
            },
          ],
        });

        const geminiResponse =
          result.text?.trim() || result.response?.text()?.trim() || "";

        if (!geminiResponse) {
          console.error("❌ [GEMINI] API response boş:", result);
          if (attempt === maxRetries) {
            throw new Error("Gemini API response is empty or invalid");
          }
          continue;
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
              `⚠️ [GEMINI] Beklenen 5 öneri, ${suggestions.length} alındı`
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
            `✅ [GEMINI] ${suggestions.length} öneri başarıyla alındı`
          );
          break; // Başarılı olursa loop'tan çık
        } catch (parseError) {
          console.error(
            "❌ [GEMINI] JSON parse hatası:",
            parseError.message
          );
          console.log(
            "📝 [GEMINI] Raw response:",
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
              "🔄 [GEMINI] Fallback önerileri kullanılıyor"
            );
          } else {
            throw parseError;
          }
        }
      } catch (geminiError) {
        console.error(
          `❌ [GEMINI] Location suggestions API attempt ${attempt} failed:`,
          geminiError.message
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
            "🔄 [GEMINI] Fallback önerileri kullanılıyor (hata durumunda)"
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
