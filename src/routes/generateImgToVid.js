// routes/generateImgToVid.js
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Supabase client
const { supabase } = require("../supabaseClient");

// Replicate import kaldırıldı (Fal.ai'ye geçildi)
// @fal-ai/client import
const { fal } = require("@fal-ai/client");
fal.config({
  credentials: process.env.FAL_API_KEY, // Env'deki key: FAL_API_KEY
});

// Not: callReplicateGeminiFlash fonksiyonu hala Replicate API'sini axios ile kullanıyor,
// bu yüzden REPLICATE_API_TOKEN env variable'ı gerekli.

// Gemini imports (OpenAI yerine)
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls,
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
          timeout: 120000
        }
      );

      const data = response.data;

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.status !== "succeeded") {
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      let outputText = "";
      if (Array.isArray(data.output)) {
        outputText = data.output.join("");
      } else if (typeof data.output === "string") {
        outputText = data.output;
      }

      if (!outputText || outputText.trim() === "") {
        throw new Error("Replicate Gemini response is empty");
      }

      console.log(`✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`);
      return outputText.trim();

    } catch (error) {
      console.error(`❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

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
    console.log("Replicate Gemini ile video prompt oluşturma başlatılıyor");

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

    // Replicate Gemini Flash API için resim URL'sini hazırla
    const imageUrls = [];
    if (imageUrl && imageUrl.startsWith("http")) {
      imageUrls.push(imageUrl);
      console.log(`Video prompt için görsel Replicate Gemini'ye gönderilecek: ${imageUrl}`);
    }

    // Replicate Gemini Flash API çağrısı
    try {
      const enhancedPrompt = await callReplicateGeminiFlash(promptForGemini, imageUrls, 3);
      console.log("🎬 Replicate Gemini'nin ürettiği video prompt:", enhancedPrompt);
      return enhancedPrompt;
    } catch (geminiError) {
      console.error("Replicate Gemini API failed:", geminiError.message);
      return userPrompt; // Hata durumunda orijinal prompt'u döndür
    }
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
      duration = 10, // Default 10 saniye
    } = req.body;

    // Zorunlu alanları kontrol et (prompt opsiyonel)
    if (
      !userId ||
      !productId ||
      !product_main_image ||
      !imageCount ||
      !first_frame_image ||
      !aspect_ratio
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields. Make sure userId, productId, product_main_image, imageCount, aspect_ratio and first_frame_image are provided.",
      });
    }

    // Video süresine göre kredi hesapla
    const creditCost = duration === 10 ? 200 : 100; // 10s = 200 kredi, 5s = 100 kredi

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
    if (userData.credit_balance < creditCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient credit balance. Required: ${creditCost} credits`,
      });
    }

    // Deduct credits
    const { error: creditUpdateError } = await supabase
      .from("users")
      .update({ credit_balance: userData.credit_balance - creditCost })
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

    // GPT-4 Vision ile prompt oluştur (prompt boşsa default kullan)
    const userPrompt =
      prompt ||
      "Model highlights special details of the outfit, smiling while gently turning left and right to showcase product details from both sides. While turning left and right, model maintains a smile and strikes various poses";
    const finalPrompt = await generateVideoPrompt(firstFrameUrl, userPrompt);

    // 4) Fal.ai Queue API'ye istek at (Kling 2.1 Pro) - SDK ile
    const requestBody = {
      prompt: finalPrompt,
      image_url: firstFrameUrl,
      duration: duration.toString(), // "5" veya "10"
      aspect_ratio: aspect_ratio,
      cfg_scale: 0.5
    };

    console.log("🎬 Fal.ai Video Request gönderiliyor (SDK):", JSON.stringify(requestBody, null, 2));

    let requestId;
    // fal.queue.submit ile isteği gönderiyoruz
    try {
      const { request_id } = await fal.queue.submit("fal-ai/kling-video/v2.1/pro/image-to-video", {
        input: requestBody,
        webhookUrl: null // Opsiyonel
      });
      requestId = request_id;
    } catch (falError) {
      console.error("❌ Fal.ai SDK submit error:", falError);
      throw new Error(`Fal.ai submission failed: ${falError.message}`);
    }

    if (!requestId) {
      throw new Error("Fal.ai did not return a request_id via SDK");
    }

    console.log("✅ Fal.ai Request ID alındı:", requestId);

    // 5) DB'ye kaydet => product_main_image: productMainUrlJSON
    const { data: insertData, error: initialInsertError } = await supabase
      .from("predictions")
      .insert({
        id: uuidv4(),
        user_id: userId,
        product_id: productId,
        prediction_id: requestId, // fal.ai request_id
        categories: categories,
        product_main_image: productMainUrlJSON,
      });

    if (initialInsertError) {
      console.error("Initial Insert error:", initialInsertError);
      throw initialInsertError;
    }

    return res.status(202).json({
      success: true,
      message: "Prediction started (Fal.ai SDK). Poll with /api/predictionStatus/:id",
      predictionId: requestId,
      replicatePrediction: {
        id: requestId,
        status: "starting",
        urls: {
          // SDK status check URL is implicit via fal.queue.status, 
          // but frontend might not need this precise URL if it calls our GET endpoint.
          get: `https://queue.fal.run/fal-ai/kling-video/v2.1/pro/image-to-video/requests/${requestId}/status`
        }
      }
    });
  } catch (error) {
    console.error("Video generation error:", error.message);
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
      return res.status(400).json({ success: false, message: "No ID provided" });
    }

    // DB'den kaydı al
    const { data: rows, error } = await supabase
      .from("predictions")
      .select("*")
      .eq("prediction_id", predictionId)
      .limit(1);

    if (error) {
      console.error("DB select error:", error);
      return res.status(500).json({ success: false, message: "DB error", error: error.message });
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: "Prediction record not found" });
    }

    // Fal.ai Queue Status Polling via SDK
    console.log(`🔎 Polling Fal.ai Status (SDK): ${predictionId}`);

    let replicateStatus = "processing";
    let replicateOutput = null;

    try {
      const result = await fal.queue.status("fal-ai/kling-video/v2.1/pro/image-to-video", {
        requestId: predictionId,
        logs: true // logları da alabiliriz
      });

      // result = { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED', logs: [...], metrics: {...} }
      // Eğer COMPLETED ise data: { ...output } içinde olabilir, 
      // fal-client versiyonuna göre bazen result.data.video.url olabiliyor
      // Status mapping: Fal -> Replicate
      if (result.status === "IN_QUEUE") replicateStatus = "starting";
      else if (result.status === "IN_PROGRESS") replicateStatus = "processing";
      else if (result.status === "COMPLETED") {
        replicateStatus = "succeeded";
        // Output parsing: Kling usually returns { video: { url: "..." } }
        // fal.queue.result might fetch the final output payload

        // Note: queue.status returns high level status. 
        // To get output we might need fal.queue.result(requestId) OR 
        // if queue.status returns it on completion (some versions do).
        // Let's rely on fal.queue.result to get the output payload confidently.
        const finalData = await fal.queue.result("fal-ai/kling-video/v2.1/pro/image-to-video", {
          requestId: predictionId
        });

        if (finalData.data && finalData.data.video && finalData.data.video.url) {
          replicateOutput = finalData.data.video.url;
        } else if (finalData.data && finalData.data.images && finalData.data.images[0]) {
          replicateOutput = finalData.data.images[0].url;
        }
      }
      else if (result.status === "FAILED") replicateStatus = "failed";

    } catch (pollError) {
      console.error("Fal.ai SDK polling error:", pollError);
      // Check if 404 manually if SDK throws specific error for not found?
      // Generally SDK throws error on fail.
    }

    // Update DB logic remains the same
    const updateData = {};
    if (replicateStatus === "succeeded") {
      updateData.product_main_image = replicateOutput ? JSON.stringify([replicateOutput]) : null;
    } else if (replicateStatus === "failed") {
      updateData.product_main_image = null;
    }

    const { error: updateError } = await supabase.from("predictions").update(updateData).eq("prediction_id", predictionId);

    return res.status(200).json({
      success: true,
      status: replicateStatus,
      output: replicateOutput,
    });

  } catch (error) {
    // ... error handling
    console.error("Prediction status error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
