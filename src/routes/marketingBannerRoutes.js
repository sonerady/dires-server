const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../utils/logger");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * POST /api/marketing-banner/generate
 * Accepts an image URL and generates marketing banner elements (texts, CTA, etc.)
 */
router.post("/generate", async (req, res) => {
  try {
    const { imageUrl, productName, style, language } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl is required" });
    }

    const lang = language || "en";
    const stylePref = style || "luxury";

    // Fetch image and convert to base64
    const axios = require("axios");
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
    });
    const base64Image = Buffer.from(imageResponse.data).toString("base64");
    const mimeType = imageResponse.headers["content-type"] || "image/jpeg";

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `You are a world-class marketing designer. Analyze this product image and generate a marketing banner layout.

Product name: ${productName || "Unknown Product"}
Style: ${stylePref}
Language: ${lang === "tr" ? "Turkish" : "English"}

Return a JSON object with this exact structure. The canvas is 375x667 (phone screen).
Each element has x, y (position from top-left), width, height in pixels.

{
  "elements": [
    {
      "id": "headline",
      "type": "text",
      "content": "A short catchy headline for this product",
      "x": 20,
      "y": 40,
      "width": 335,
      "height": 60,
      "fontSize": 32,
      "fontWeight": "bold",
      "color": "#FFFFFF",
      "textAlign": "center",
      "fontFamily": "serif"
    },
    {
      "id": "subheadline",
      "type": "text",
      "content": "A compelling subheadline",
      "x": 30,
      "y": 110,
      "width": 315,
      "height": 40,
      "fontSize": 16,
      "fontWeight": "normal",
      "color": "#FFFFFF",
      "textAlign": "center",
      "fontFamily": "sans-serif"
    },
    {
      "id": "cta",
      "type": "button",
      "content": "Shop Now",
      "x": 100,
      "y": 580,
      "width": 175,
      "height": 50,
      "fontSize": 18,
      "fontWeight": "bold",
      "color": "#FFFFFF",
      "backgroundColor": "#000000",
      "borderRadius": 25,
      "textAlign": "center"
    },
    {
      "id": "price",
      "type": "text",
      "content": "$XX.XX",
      "x": 20,
      "y": 520,
      "width": 335,
      "height": 40,
      "fontSize": 28,
      "fontWeight": "bold",
      "color": "#FFFFFF",
      "textAlign": "center",
      "fontFamily": "sans-serif"
    },
    {
      "id": "badge",
      "type": "badge",
      "content": "NEW",
      "x": 20,
      "y": 20,
      "width": 70,
      "height": 30,
      "fontSize": 12,
      "fontWeight": "bold",
      "color": "#FFFFFF",
      "backgroundColor": "#FF3B30",
      "borderRadius": 15,
      "textAlign": "center"
    }
  ],
  "overlay": {
    "type": "gradient",
    "direction": "to bottom",
    "colors": ["rgba(0,0,0,0.1)", "rgba(0,0,0,0.6)"]
  }
}

IMPORTANT RULES:
- Generate 4-6 elements that look luxurious and professional
- Text colors must contrast well with the image
- Position elements so they don't overlap the main product
- The headline should be attention-grabbing and relevant to the product
- CTA button should be at the bottom area
- Keep text short and impactful
- Return ONLY valid JSON, no markdown or extra text`;

    const result = await model.generateContent({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2000,
      },
    });

    let responseText = result.response.text();

    // Clean JSON from potential markdown wrappers
    responseText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const bannerData = JSON.parse(responseText);

    logger.log("✅ Marketing banner generated:", bannerData.elements?.length, "elements");

    res.json({
      success: true,
      banner: bannerData,
    });
  } catch (error) {
    logger.error("❌ Marketing banner generation error:", error.message);
    res.status(500).json({
      error: "Banner generation failed",
      details: error.message,
    });
  }
});

module.exports = router;
