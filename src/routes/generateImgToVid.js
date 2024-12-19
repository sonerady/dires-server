const express = require("express");
const Replicate = require("replicate");
const supabase = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Gemini ile ilgili importlar
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const router = express.Router();

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const predictions = replicate.predictions;

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

async function generateVideoPrompt(imageUrl, userPrompt, useAIPrompt) {
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const tempImagePath = path.join(tempDir, `${uuidv4()}.jpg`);
  await downloadImage(imageUrl, tempImagePath);
  const uploadedFile = await uploadToGemini(tempImagePath, "image/jpeg");
  fs.unlinkSync(tempImagePath);

  let contentMessage = "";
  if (useAIPrompt) {
    contentMessage = `Create a short, single-line English prompt describing a fashion video scene from the given image; focus on the clothing style, the environment, and model movement; get closer to the garment and the model; avoid showing the garment's back side, focus solely on the front view; no headings, no paragraphs, no line breaks, just one continuous line of text.`;
  } else {
    contentMessage = `Using the given image and integrating this user prompt: "${userPrompt}", create a short, single-line English prompt describing a fashion video scene; highlight the clothing, environment, and model movement; avoid showing the garment's back side, focus solely on the front view; no headings, no paragraphs, no line breaks, just one continuous line of text.`;
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

  const history = [
    {
      role: "user",
      parts: [
        {
          fileData: {
            mimeType: "image/jpeg",
            fileUri: uploadedFile.uri,
          },
        },
        { text: contentMessage },
      ],
    },
  ];

  const chatSession = model.startChat({
    generationConfig,
    history,
  });

  const result = await chatSession.sendMessage("");
  const generatedPrompt = result.response.text();

  console.log("Generated Video Prompt:", generatedPrompt);
  return generatedPrompt;
}

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

router.post("/generateImgToVid", async (req, res) => {
  const {
    userId,
    productId,
    product_main_image,
    imageCount,
    prompt,
    categories,
    first_frame_image,
    use_ai_prompt,
  } = req.body;

  if (
    !userId ||
    !productId ||
    !product_main_image ||
    !imageCount ||
    (!use_ai_prompt && !prompt) ||
    !first_frame_image
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields. Make sure userId, productId, product_main_image, imageCount, prompt (if use_ai_prompt is false) and first_frame_image are provided.",
    });
  }

  console.log("reqqqq", req.body);

  console.log("Starting video generation for productId:", productId);

  try {
    const finalPrompt = await generateVideoPrompt(
      first_frame_image,
      prompt,
      use_ai_prompt
    );

    const input = {
      prompt: finalPrompt,
      prompt_optimizer: true,
      first_frame_image: first_frame_image,
    };

    const prediction = await predictions.create({
      model: "minimax/video-01-live",
      input: input,
    });

    // Prediction oluşturuldu, şimdi predictions tablosuna ekleyelim:
    const predictionId = prediction.id;

    const { error: initialInsertError } = await supabase
      .from("predictions")
      .insert({
        id: uuidv4(),
        user_id: userId,
        product_id: first_frame_image,
        prediction_id: predictionId,
        categories: categories,
        product_main_image: prediction.output,
      });

    if (initialInsertError) {
      console.error("Initial Insert error:", initialInsertError);
      throw initialInsertError;
    }

    return res.status(202).json({
      success: true,
      message: "Prediction started. Processing in background.",
      prediction: prediction,
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

module.exports = router;
