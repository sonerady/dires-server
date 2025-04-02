const express = require("express");
const router = express.Router();
const axios = require("axios");

// Clarity AI API token
const CLARITY_API_TOKEN = "ap_cousjkym10sd5s0urv80l82rl6dx1wpuaycglwz4";

/**
 * Image-Clarity API endpoint
 * Supabase'deki resim linkini Clarity AI API'ye gönderir ve sonucu döndürür
 */
router.post("/image-clarity", async (req, res) => {
  try {
    const { imageUrl, mode = "flux", creativity = 0, prompt = "" } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: "No image URL provided",
      });
    }

    console.log(`Processing image with Clarity AI: ${imageUrl}`);
    console.log(`Mode: ${mode}, Creativity: ${creativity}`);

    // Prepare request to Clarity AI
    const clarityApiUrl = "https://api-upscale.clarityai.co";

    // Prepare request data
    const requestData = {
      image: imageUrl, // Clarity AI API 'image' parametresi bekliyor, 'imageUrl' değil
      mode: mode,
      creativity: creativity,
    };

    // Add prompt if provided
    if (prompt && prompt.trim().length > 0) {
      requestData.prompt = prompt;
    }

    console.log("Sending request to Clarity AI:", requestData);

    // Make request to Clarity AI API
    const response = await axios.post(clarityApiUrl, requestData, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLARITY_API_TOKEN}`,
      },
    });

    console.log("ClarityAI Response:", response.data);

    // Return the response from Clarity AI
    return res.status(200).json({
      success: true,
      result: response.data,
      upscaledImageUrl:
        response.data.message || response.data.upscaled_image_url,
      status: response.data.status,
      balance: response.data.balance,
    });
  } catch (error) {
    console.error("Error processing image with Clarity AI:", error);

    const errorDetails = error.response
      ? {
          status: error.response.status,
          data: error.response.data,
        }
      : error.message;

    return res.status(500).json({
      success: false,
      error: "Failed to process image with Clarity AI",
      details: errorDetails,
    });
  }
});

module.exports = router;
