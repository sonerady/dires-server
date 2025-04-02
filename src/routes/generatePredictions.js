const express = require("express");
const Replicate = require("replicate");
const supabase = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const router = express.Router();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const predictions = replicate.predictions;

// Function to download an image from a URL
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

// Function to upload a file to Gemini
async function uploadToGemini(filePath, mimeType) {
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: path.basename(filePath),
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}

// Function to generate a prompt using Google Gemini (modified for multiple images)
async function generatePrompt(
  imageUrl,
  initialPrompt,
  customPrompt,
  extraPromptDetail,
  categories
) {
  const MAX_RETRIES = 20;
  let attempt = 0;
  let generatedPrompt = "";
  console.log("Extra Prompt Detail:", extraPromptDetail);

  console.log("Image URL:", imageUrl);

  // Ensure temp directory exists
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  let convertedImageUrls;
  try {
    // imageUrl parametresi bir array'i JSON.stringify ile verilmiş olabilir.
    // JSON parse edilebilir ise çoklu görseli bu şekilde alacağız.
    convertedImageUrls = JSON.parse(imageUrl);
  } catch (error) {
    console.error("Error parsing image URL:", error);
    // Eğer parse edilemez ise tek bir URL olduğunu varsayıyoruz
    convertedImageUrls = [imageUrl];
  }

  while (attempt < MAX_RETRIES) {
    try {
      let contentMessage = "";

      let environmentContext = "";
      if (customPrompt && initialPrompt) {
        environmentContext = `${initialPrompt}, ${customPrompt}`;
      } else if (customPrompt) {
        environmentContext = customPrompt;
      } else if (initialPrompt) {
        environmentContext = initialPrompt;
      }

      if (categories === "on_model") {
        contentMessage = `
          Create an ultra in-depth, extremely long, meticulously detailed, 
          and highly descriptive English prompt that intensively emphasizes 
          every minute detail of the product in the provided image—its vibrant 
          colors, intricate fabric textures, subtle embroidery, delicate stitching 
          patterns, and any unique design elements—ensuring it is worn by a 
          real-life, photorealistic human model (no mannequins, no CGI), 
          strongly highlighting how the material drapes, moves, and catches the 
          light on the model’s body in a physically plausible manner. Additionally, 
          if the product or environment details indicate a clothing item, specify 
          whether it is sleeveless, strapless, or long-sleeved, and exactly how far 
          it extends on the wearer’s body (e.g., waist-length, knee-length, or ankle-length), 
          emphasizing these critical details within this single continuous line. 

If any specific color information is provided in the additional details, 
          it is ABSOLUTELY CRUCIAL to prioritize and emphasize that exact color 
          in the product description, making it the dominant color characteristic 
          of the item regardless of the original image.

          Demand the prompt be styled in a refined, high-fashion editorial photography 
          manner, with exceptional lighting, composition, and camera angles. 
          Translate and integrate any provided environmental, model, or product details 
          into English if needed, and merge all elements into a single continuous line 
          without headings or paragraphs.
      
          Importantly, specify precisely **where each detail is located** on the garment 
          (for example, on the collar, sleeve, chest area, or hem) because it's **extremely important** 
          to mention the exact location of every design element to ensure thorough clarity.
      
          ${environmentContext ? `include: ${environmentContext},` : ""} 
          ${extraPromptDetail ? `also include: ${extraPromptDetail}.` : ""}
        `;

        // Eğer environmentContext'te "Model's pose" ibaresi yoksa ek cümle ekleyebilirsin:
        if (
          !environmentContext ||
          !environmentContext.includes("Model's pose")
        ) {
          contentMessage += `
            Additionally, instruct the model to adopt a pose that complements 
            the garment’s aesthetic and ensure the final prompt insists on 
            hyperrealistic lighting and shading that further enhances the realism.
          `;
        }
      } else if (categories === "photoshoot") {
        contentMessage = `Create an extremely detailed, vividly descriptive, and atmospherically rich English prompt that showcases the product as the focal point of a creative AI-generated photoshoot scene without any model; portray intricate textures, colors, materials, subtle patterns, and how light and shadow play across its surface in a captivating environment that enhances the product’s unique qualities, translating any provided environmental or contextual details into English and seamlessly integrating them, along with additional product information, into a single continuous prompt line without headings or paragraphs; ${
          environmentContext ? `include: ${environmentContext},` : ""
        } ${extraPromptDetail ? `also include: ${extraPromptDetail}.` : ""}`;
      } else if (categories === "retouch") {
        contentMessage = `Create an extremely long, single-line English prompt that fully describes and enhances the main product in the image with the highest possible level of detail, meticulously emphasizing every tiny intricate aspect of its design—its subtle textures, delicate stitching, fabric quality, and all other minuscule details—and then refine brightness, clarity, shadows, texture, and color vibrancy on a pure white background. Translate and integrate any provided environmental or contextual details into English if needed, merge all elements into a single continuous line without headings or paragraphs, ensure no other elements except the product details are mentioned.${
          environmentContext ? `include: ${environmentContext},` : ""
        } ${extraPromptDetail ? `also include: ${extraPromptDetail}.` : ""}`;
      }

      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain",
      };

      // userParts array'i oluşturuyoruz. Her bir image için fileData ekleyeceğiz.
      const userParts = [];

      for (const imgUrl of convertedImageUrls) {
        const tempImagePath = path.join(tempDir, `${uuidv4()}.jpg`);
        await downloadImage(imgUrl, tempImagePath);
        const uploadedFile = await uploadToGemini(tempImagePath, "image/jpeg");
        userParts.push({
          fileData: {
            mimeType: "image/jpeg",
            fileUri: uploadedFile.uri,
          },
        });
        // Her resim yüklendikten sonra temp image sil
        fs.unlinkSync(tempImagePath);
      }

      // Son olarak metni ekliyoruz
      userParts.push({ text: contentMessage });

      const history = [
        {
          role: "user",
          parts: userParts,
        },
      ];

      // Start chat session
      const chatSession = model.startChat({
        generationConfig,
        history,
      });

      // Send an empty message to get the response
      const result = await chatSession.sendMessage("");

      // Extract the response text
      generatedPrompt = result.response.text();

      console.log("Generated prompt:", generatedPrompt);
      const finalWordCount = generatedPrompt.trim().split(/\s+/).length;

      if (
        generatedPrompt.includes("I’m sorry") ||
        generatedPrompt.includes("I'm sorry") ||
        generatedPrompt.includes("I'm unable") ||
        generatedPrompt.includes("I can't") ||
        (generatedPrompt.includes("I cannot") && finalWordCount < 100)
      ) {
        console.warn(
          `Attempt ${
            attempt + 1
          }: Received an undesired response from Gemini. Retrying...`
        );
        attempt++;
        // Optional: Add a delay before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue; // Retry the loop
      }

      // If the response is valid, break out of the loop
      break;
    } catch (error) {
      console.error("Error generating prompt:", error);
      attempt++;
      // Optional: Add a delay before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (
    generatedPrompt.includes("I’m sorry") ||
    generatedPrompt.includes("I'm sorry") ||
    generatedPrompt.includes("I'm unable")
  ) {
    throw new Error(
      "Gemini API could not generate a valid prompt after multiple attempts."
    );
  }

  return generatedPrompt;
}

// Function to generate images using Replicate API
async function generateImagesWithReplicate(
  prompt,
  hf_loras,
  categories,
  imageRatio,
  imageFormat,
  imageCount
) {
  try {
    // Modify prompt based on category
    let modifiedPrompt = `A photo of TOK ${prompt}`;
    if (categories === "retouch") {
      modifiedPrompt += " in the middle, white background";
    }

    // Set default hf_loras based on category
    let hf_loras_default = [];
    if (categories === "on_model") {
      hf_loras_default = ["VideoAditor/Flux-Lora-Realism"];
    } else if (categories === "retouch") {
      hf_loras_default = ["gokaygokay/Flux-White-Background-LoRA"];
    }

    const filteredHfLoras = Array.isArray(hf_loras)
      ? hf_loras.filter(
          (item) => typeof item === "string" && item.trim() !== ""
        )
      : [];

    // Combine default and provided hf_loras
    const combinedHfLoras =
      filteredHfLoras.length > 0
        ? [...hf_loras_default, ...filteredHfLoras]
        : hf_loras_default;

    const prediction = await predictions.create({
      version:
        "2389224e115448d9a77c07d7d45672b3f0aa45acacf1c5bcf51857ac295e3aec",
      input: {
        prompt: modifiedPrompt,
        hf_loras: combinedHfLoras,
        lora_scales: [0.9],
        num_outputs: imageCount,
        aspect_ratio: imageRatio,
        output_format: imageFormat,
        guidance_scale: 5,
        output_quality: 100,
        prompt_strength: 1,
        num_inference_steps: 50,
        disable_safety_checker: true,
      },
    });

    return prediction.id;
  } catch (error) {
    console.error("Error generating images:", error);
    throw error;
  }
}

// Function to update the image count in Supabase
async function updateImageCount(productId, imageCount) {
  // Fetch current imageCount for the product
  const { data: productData, error: productError } = await supabase
    .from("userproduct")
    .select("imageCount")
    .eq("product_id", productId)
    .maybeSingle();

  if (productError) {
    console.error("Error fetching product data:", productError);
    throw new Error("Failed to fetch product data");
  }

  // Calculate the new imageCount
  const newImageCount = (productData?.imageCount || 0) + imageCount;

  // Update the imageCount in the 'userproduct' table
  const { error: updateError } = await supabase
    .from("userproduct")
    .update({ imageCount: newImageCount })
    .eq("product_id", productId);

  if (updateError) {
    console.error("Error updating image count:", updateError);
    throw new Error("Failed to update image count");
  }

  console.log(
    `Image count for productId ${productId} updated to ${newImageCount}`
  );
  return newImageCount;
}

router.post("/generatePredictions", async (req, res) => {
  const {
    prompt,
    hf_loras,
    categories,
    userId,
    productId, // This will be a varchar
    product_main_image,
    customPrompt,
    extraPromptDetail,
    imageRatio,
    imageFormat,
    imageCount,
  } = req.body;

  console.log("Extra Prompt Detail:", prompt);

  // Basic validation
  if (!userId || !productId || !product_main_image || !imageCount) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields.",
    });
  }

  console.log("proooo:", productId);

  try {
    console.log("Starting prompt generation for productId:", productId);

    const generatedPrompt = await generatePrompt(
      product_main_image,
      prompt,
      customPrompt,
      extraPromptDetail,
      categories
    );

    console.log("Generated Prompt:", generatedPrompt);

    // Mevcut imageCount değerini çek
    const { data: productData, error: productError } = await supabase
      .from("userproduct")
      .select("imageCount")
      .eq("product_id", productId)
      .maybeSingle();

    if (productError) {
      console.error("Error fetching product data:", productError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch product data",
        error: productError.message,
      });
    }

    // Her resim başına 1 imageCount ekliyoruz
    const newImageCount = (productData?.imageCount || 0) + imageCount;

    // Fetch user's pro status
    const { data: userProData, error: userProError } = await supabase
      .from("users")
      .select("is_pro")
      .eq("id", userId)
      .single();

    if (userProError) {
      console.error("Error fetching user pro status:", userProError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user pro status",
        error: userProError.message,
      });
    }

    // Determine the threshold based on pro status
    const imageCountThreshold = userProData.is_pro ? 60 : 30;

    // Check if newImageCount exceeds the threshold
    if (newImageCount >= imageCountThreshold) {
      // Her resim başına 5 kredi düş
      const creditsToDeduct = imageCount * 5;

      // Kullanıcının mevcut kredilerini çek
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

      // Yeterli kredi var mı kontrol et
      if (userData.credit_balance < creditsToDeduct) {
        return res.status(400).json({
          success: false,
          message: "Insufficient credit balance",
        });
      }

      // Kredi düş
      const { error: creditUpdateError } = await supabase
        .from("users")
        .update({ credit_balance: userData.credit_balance - creditsToDeduct })
        .eq("id", userId);

      if (creditUpdateError) {
        console.error("Error updating credit balance:", creditUpdateError);
        return res.status(500).json({
          success: false,
          message: "Failed to deduct credits",
          error: creditUpdateError.message,
        });
      }

      console.log(`Deducted ${creditsToDeduct} credits from userId: ${userId}`);
    }

    // Yeni imageCount değerini veritabanına yaz
    const { error: updateError } = await supabase
      .from("userproduct")
      .update({ imageCount: newImageCount })
      .eq("product_id", productId);

    if (updateError) {
      console.error("Error updating image count:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to update image count",
        error: updateError.message,
      });
    }

    // Replicate ile görüntü üret
    const predictionId = await generateImagesWithReplicate(
      generatedPrompt,
      hf_loras,
      categories,
      imageRatio,
      imageFormat,
      imageCount
    );

    console.log("Prediction ID:", predictionId);

    // Supabase 'predictions' tablosuna ilk kaydı ekle
    const { error: initialInsertError } = await supabase
      .from("predictions")
      .insert({
        id: uuidv4(),
        user_id: userId,
        product_id: productId,
        prediction_id: predictionId,
        categories,
        product_main_image:
          Array.isArray(product_main_image) && product_main_image.length > 0
            ? product_main_image[0]
            : product_main_image,
      });

    if (initialInsertError) {
      console.error("Initial Insert error:", initialInsertError);
      throw initialInsertError;
    }

    console.log("Initial prediction record inserted into Supabase.");

    res.status(202).json({
      success: true,
      message: "Prediction started. Processing in background.",
      predictionId: predictionId,
    });

    console.log("Response sent to client.");
  } catch (error) {
    console.error("Prediction error:", error);
    res.status(500).json({
      success: false,
      message: "Prediction generation failed",
      error: error.message,
    });
  }
});

module.exports = router;
