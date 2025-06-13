// routes/generateImgToVid.js
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Supabase client
const supabase = require("../supabaseClient");

// Replicate
const Replicate = require("replicate");
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});
const predictions = replicate.predictions;

// Gemini imports (OpenAI yerine)
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * generateVideoPrompt
 *  - imageUrl: Supabase'ten aldığımız public URL
 *  - userPrompt: Kullanıcının girdiği prompt (farklı dilde olabilir)
 *
 * Bu fonksiyon, Gemini'ye resmi ve kullanıcı prompt'unu göndererek
 * bize kısa, İngilizce bir "video prompt" geri döndürür.
 */
async function generateVideoPrompt(imageUrl, userPrompt) {
  try {
    console.log("Gemini ile video prompt oluşturma başlatılıyor");

    // Gemini modeli
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-exp" });

    // Gemini'ye gönderilecek metin
    const promptForGemini = `
    Based on the user's input: "${userPrompt}" (which may be in any language) and the provided image, create a concise English prompt for image-to-video generation. 

    Describe how the image should naturally animate and move in a short video sequence. Focus on:
    - Smooth transitions and subtle movements
    - Natural flow and realistic motion
    - How objects, people, or elements in the image should move
    - Camera movements if appropriate (zoom, pan, etc.)
    - Lighting changes or environmental effects
    
    Keep it under 50 words and provide only the prompt without any additional formatting or explanations.
    
    User's request: ${userPrompt}
    `;

    // Resim verilerini içerecek parts dizisini hazırla
    const parts = [{ text: promptForGemini }];

    // Referans görseli Gemini'ye gönder
    try {
      console.log(
        `Video prompt için görsel Gemini'ye gönderiliyor: ${imageUrl}`
      );

      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });
      const imageBuffer = imageResponse.data;

      // Base64'e çevir
      const base64Image = Buffer.from(imageBuffer).toString("base64");

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      });

      console.log("Video prompt için görsel başarıyla Gemini'ye yüklendi");
    } catch (imageError) {
      console.error(
        `Video prompt görseli yüklenirken hata: ${imageError.message}`
      );
    }

    // Gemini'den cevap al (retry mekanizması ile)
    let enhancedPrompt;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent({
          contents: [{ parts }],
        });

        enhancedPrompt = result.response.text().trim();
        console.log("🎬 Gemini'nin ürettiği video prompt:", enhancedPrompt);
        break; // Başarılı olursa loop'tan çık
      } catch (geminiError) {
        console.error(
          `Gemini API attempt ${attempt} failed:`,
          geminiError.message
        );

        if (attempt === maxRetries) {
          console.error(
            "Gemini API all attempts failed, using original prompt"
          );
          enhancedPrompt = userPrompt;
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    return enhancedPrompt;
  } catch (error) {
    console.error("Video prompt oluşturma hatası:", error);
    return userPrompt; // Hata durumunda orijinal prompt'u döndür
  }
}

// Yardımcı fonksiyonlar
async function downloadImage(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function uploadToGemini(filePath, mimeType) {
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: path.basename(filePath),
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}

/**
 * Bu fonksiyon: Tek bir base64 string'i (veya istersen bir array'i) Supabase'e yükler ve
 * elde ettiği public URL'leri bir dizi olarak döndürür.
 */
async function uploadToSupabaseAsArray(base64String, prefix = "product_main_") {
  const urlsArray = [];

  // Tek bir string'i de dizi yapıyoruz. (Eğer birden fazla imaj yollayacaksan, parametreyi array'e çevirebilirsin.)
  const base64Items = Array.isArray(base64String)
    ? base64String
    : [base64String];

  for (const item of base64Items) {
    // Eğer base64 formatı değilse, muhtemelen URL'dir, direkt ekle
    if (!item.startsWith("data:image/")) {
      urlsArray.push(item);
      continue;
    }

    const base64Data = item.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `${prefix}${uuidv4()}.png`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("images")
      .upload(`generated/${fileName}`, buffer, {
        contentType: "image/png",
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      throw new Error(
        `Failed to upload image to Supabase: ${uploadError.message}`
      );
    }

    const { data: publicUrlData, error: publicUrlError } =
      await supabase.storage
        .from("images")
        .getPublicUrl(`generated/${fileName}`);
    if (publicUrlError) {
      console.error("Supabase publicUrl error:", publicUrlError);
      throw new Error(
        `Failed to get public URL of image: ${publicUrlError.message}`
      );
    }

    urlsArray.push(publicUrlData.publicUrl);
  }

  return urlsArray;
}

/**
 * 1) POST /api/generateImgToVid
 *
 * Bu endpoint:
 * - Kullanıcıdan gelen ürün resmi (product_main_image) ve first_frame_image base64'lerini
 *   Supabase'e yükler, oradan URL'ler alır. (Birden fazla resim geliyorsa array'e çevirir.)
 * - GPT-4 Vision ile prompt oluşturur.
 * - Replicate Minimax'e istek atar, asenkron bir prediction döner.
 * - Supabase'e prediction kaydı ekler (prediction_id, user_id, vb.).
 * - 202 Accepted döner, statüyü /api/predictionStatus/:id ile sorgulayabilirsin.
 */
router.post("/generateImgToVid", async (req, res) => {
  try {
    const {
      userId,
      productId,
      product_main_image,
      imageCount,
      prompt,
      categories,
      first_frame_image,
      aspect_ratio,
    } = req.body;

    // Zorunlu alanları kontrol et
    if (
      !userId ||
      !productId ||
      !product_main_image ||
      !imageCount ||
      !prompt ||
      !first_frame_image ||
      !aspect_ratio
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields. Make sure userId, productId, product_main_image, imageCount, prompt, aspect_ratio and first_frame_image are provided.",
      });
    }

    // Base64 string'i temizle (DOCTYPE veya diğer HTML etiketlerini kaldır)
    const cleanBase64 = (base64String) => {
      // Eğer base64 string değilse (URL ise) direkt döndür
      if (!base64String || !base64String.includes("base64")) {
        return base64String;
      }

      // base64 kısmını ayıkla
      const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const contentType = matches[1];
        const base64Data = matches[2];
        return `data:${contentType};base64,${base64Data}`;
      }

      return base64String;
    };

    // Resimleri temizle
    const cleanedFirstFrame = cleanBase64(first_frame_image);
    let cleanedProductMain;

    if (Array.isArray(product_main_image)) {
      cleanedProductMain = product_main_image.map((img) => cleanBase64(img));
    } else {
      cleanedProductMain = cleanBase64(product_main_image);
    }

    // Check user's credit balance
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    if (userError) {
      console.error("Error fetching user data:", userError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user data",
        error: userError.message,
      });
    }

    // Check if user has enough credits
    if (userData.credit_balance < 150) {
      return res.status(400).json({
        success: false,
        message: "Insufficient credit balance. Required: 100 credits",
      });
    }

    // Deduct credits
    const { error: creditUpdateError } = await supabase
      .from("users")
      .update({ credit_balance: userData.credit_balance - 150 })
      .eq("id", userId);

    if (creditUpdateError) {
      console.error("Error updating credit balance:", creditUpdateError);
      return res.status(500).json({
        success: false,
        message: "Failed to deduct credits",
        error: creditUpdateError.message,
      });
    }

    // 1) firstFrameUrl işleme
    let firstFrameUrl = cleanedFirstFrame;
    if (firstFrameUrl.startsWith("data:image/")) {
      const uploadedFirstFrame = await uploadToSupabaseAsArray(
        firstFrameUrl,
        "first_frame_"
      );
      firstFrameUrl = uploadedFirstFrame[0];
    }

    // 2) productMainUrl işleme
    let productMainUrlArray = [];
    if (Array.isArray(cleanedProductMain)) {
      for (const image of cleanedProductMain) {
        const uploaded = await uploadToSupabaseAsArray(image, "product_main_");
        productMainUrlArray.push(...uploaded);
      }
    } else {
      const uploaded = await uploadToSupabaseAsArray(
        cleanedProductMain,
        "product_main_"
      );
      productMainUrlArray.push(...uploaded);
    }

    const productMainUrlJSON = JSON.stringify(productMainUrlArray);

    // GPT-4 Vision ile prompt oluştur
    const finalPrompt = await generateVideoPrompt(firstFrameUrl, prompt);

    // 4) Replicate'e asenkron istek (Minimax)
    const prediction = await predictions.create({
      model: "kwaivgi/kling-v1.6-pro",
      input: {
        prompt: finalPrompt,
        duration: 10,
        cfg_scale: 0.5,
        start_image: firstFrameUrl,
        aspect_ratio: aspect_ratio,
        negative_prompt: "",
      },
    });

    // 5) DB'ye kaydet => product_main_image: productMainUrlJSON
    const { data: insertData, error: initialInsertError } = await supabase
      .from("predictions")
      .insert({
        id: uuidv4(),
        user_id: userId,
        product_id: productId,
        prediction_id: prediction.id, // replicate'ten gelen id
        categories: categories,
        product_main_image: productMainUrlJSON,
      });

    if (initialInsertError) {
      console.error("Initial Insert error:", initialInsertError);
      throw initialInsertError;
    }

    return res.status(202).json({
      success: true,
      message: "Prediction started. Poll with /api/predictionStatus/:id",
      predictionId: prediction.id,
      replicatePrediction: prediction,
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return res.status(500).json({
      success: false,
      message: "Video generation failed",
      error: error.message,
    });
  }
});

/**
 * 2) GET /api/predictionStatus/:predictionId
 *
 * Bu endpoint:
 * - DB'den kaydı bulur.
 * - replicate.predictions.get(...) ile durumu (status, output vb.) çeker.
 * - DB'yi günceller (ancak 'status' kolonunu artık güncellemiyoruz).
 * - Sonucu front-end'e döner.
 */
router.get("/predictionStatus/:predictionId", async (req, res) => {
  try {
    const { predictionId } = req.params;
    if (!predictionId) {
      return res
        .status(400)
        .json({ success: false, message: "No ID provided" });
    }

    // DB'den kaydı al
    const { data: rows, error } = await supabase
      .from("predictions")
      .select("*")
      .eq("prediction_id", predictionId)
      .limit(1);

    if (error) {
      console.error("DB select error:", error);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: error.message,
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Prediction record not found",
      });
    }

    const predictionRow = rows[0];

    // replicate üzerinden güncel durumu sorgula
    const replicatePrediction = await predictions.get(predictionId);

    // Artık status'u güncellemiyoruz, sadece outputu güncelliyoruz:
    const updateData = {};

    if (replicatePrediction.status === "succeeded") {
      // Bazen replicatePrediction.output bir dizi link olabilir:
      // Tek string ise => "https://..."
      // Array ise => ["https://...", "https://..."]
      updateData.product_main_image = replicatePrediction.output
        ? JSON.stringify(replicatePrediction.output)
        : null;
    } else if (replicatePrediction.status === "failed") {
      // Başarısızsa null çekiyoruz
      updateData.product_main_image = null;
    }

    // DB'de product_main_image kolonunu güncelle
    // (status kolonu olmadığı için artık ekleme yapmıyoruz)
    const { error: updateError } = await supabase
      .from("predictions")
      .update(updateData)
      .eq("prediction_id", predictionId);

    if (updateError) {
      console.error("Update error:", updateError);
      // hata olsa bile, yine de replicatePrediction ile cevabı dönüyoruz
    }

    return res.status(200).json({
      success: true,
      // status bilgisini tabloya kaydetmiyoruz ama yine de FE'ye gönderebiliriz
      status: replicatePrediction.status,
      output: replicatePrediction.output || null,
    });
  } catch (error) {
    console.error("Prediction status error:", error);
    return res.status(500).json({
      success: false,
      message: "Error retrieving prediction status",
      error: error.message,
    });
  }
});

module.exports = router;
