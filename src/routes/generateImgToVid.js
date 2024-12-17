const express = require("express");
const Replicate = require("replicate");
const supabase = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const predictions = replicate.predictions;

router.post("/generateImgToVid", async (req, res) => {
  const {
    categories,
    userId,
    productId,
    product_main_image,
    imageCount,
    prompt,
    first_frame_image,
  } = req.body;

  // Basic validation
  if (
    !userId ||
    !productId ||
    !product_main_image ||
    !imageCount ||
    !prompt ||
    !first_frame_image
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields. Make sure userId, productId, product_main_image, imageCount, prompt and first_frame_image are provided.",
    });
  }

  console.log("Starting video generation for productId:", productId);

  try {
    const input = {
      prompt: prompt,
      prompt_optimizer: true,
      first_frame_image: first_frame_image,
    };

    const prediction = await predictions.create({
      version:
        "359b9915544a2a60a4687304f58669a9af7fad1e92cc5943a197f6139b6d7ecb",
      input: input,
    });

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
