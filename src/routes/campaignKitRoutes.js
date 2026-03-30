const express = require("express");
const router = express.Router();
const axios = require("axios");

/**
 * Call Replicate Gemini 3.1 Pro API with image URLs and prompt
 */
async function callReplicateGeminiPro(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 [CAMPAIGN-GEMINI-PRO] API call attempt ${attempt}/${maxRetries}`);

      const requestBody = {
        input: {
          prompt: prompt,
          images: imageUrls,
          temperature: 0.7,
          max_output_tokens: 16384,
        }
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-3.1-pro/predictions",
        requestBody,
        {
          headers: {
            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            "Prefer": "wait"
          },
          timeout: 180000
        }
      );

      const data = response.data;

      if (data.error) {
        console.error(`❌ [CAMPAIGN-GEMINI-PRO] API error:`, data.error);
        throw new Error(data.error);
      }

      if (data.status !== "succeeded") {
        console.error(`❌ [CAMPAIGN-GEMINI-PRO] Prediction failed with status:`, data.status);
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      let outputText = "";
      if (Array.isArray(data.output)) {
        outputText = data.output.join("");
      } else if (typeof data.output === "string") {
        outputText = data.output;
      }

      if (!outputText || outputText.trim() === "") {
        throw new Error("Replicate Gemini 3.1 Pro response is empty");
      }

      console.log(`✅ [CAMPAIGN-GEMINI-PRO] Success (attempt ${attempt})`);
      return outputText.trim();

    } catch (error) {
      console.error(`❌ [CAMPAIGN-GEMINI-PRO] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * POST /api/campaign-kit/generate-html
 * Receives an image URL + prompt, returns JSON campaign data (elements, colors, gradient).
 * HTML is built client-side from a static template for faster response times.
 */
router.post("/generate-html", async (req, res) => {
  try {
    const { imageUrl, userPrompt } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ success: false, error: "imageUrl is required" });
    }

    console.log("🎨 [CAMPAIGN_KIT] Generating campaign data for image:", imageUrl.substring(0, 80) + "...");
    console.log("📝 [CAMPAIGN_KIT] User prompt:", userPrompt || "(none - using defaults)");

    const userBrief = userPrompt
      ? `\n\nUSER'S CAMPAIGN BRIEF:\n"${userPrompt}"\n\nYou MUST incorporate the user's requests into the design.`
      : "";

    const prompt = `You are a world-class campaign poster designer. Analyze this product image carefully and design a beautiful mobile campaign poster (390×844px canvas).

The product photo fills the entire background. You will place text and badge overlay elements on top. Study the image — find where the empty spaces are, where the product is, and make your own creative decisions about layout.
${userBrief}

RESPOND WITH ONLY A RAW JSON OBJECT. No markdown, no code blocks, no explanation.

{
  "accentColor": "#hex color that suits the image",
  "overlayGradient": "CSS linear-gradient — MUST strongly darken the area where you place text elements. Use at least rgba(0,0,0,0.6) opacity where text sits. Example: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.85) 100%)",
  "elements": [
    {
      "text": "string",
      "x": number (0-390),
      "y": number (0-844),
      "fontSize": number,
      "fontWeight": "string",
      "fontFamily": "serif | sans-serif | condensed",
      "color": "string",
      "bgColor": "string or null",
      "padding": "CSS padding or null",
      "borderRadius": "CSS border-radius or null",
      "textTransform": "uppercase | lowercase | none",
      "letterSpacing": "CSS value or null",
      "lineHeight": "CSS value or null",
      "maxWidth": "number as string or null",
      "textShadow": "CSS value or null",
      "opacity": "string or null",
      "backdropBlur": "CSS blur value or null",
      "border": "CSS border or null",
      "boxShadow": "CSS box-shadow or null"
    }
  ]
}

QUALITY RULES (MANDATORY — FOLLOW STRICTLY):
- ALIGNMENT: ALL text elements in a group MUST share the exact same x value. For example, if headline is at x=30, then subtitle, body text, and CTA button MUST also be at x=30. Never scatter elements at different random x positions — this is the #1 cause of messy layouts.
- NO OVERLAP: Elements must NEVER overlap each other. Calculate carefully: next element y = previous element y + previous fontSize + gap (minimum 16px). If an element has padding, add the full padding to height calculation. Double-check your y values before responding.
- TYPOGRAPHIC HIERARCHY: Maximum 3-4 elements total. Keep it simple and clean. Use clear size contrast: headline 36-52px, subtitle 16-20px, body/CTA 12-15px. Don't create too many elements — fewer elements = cleaner design.
- CLEAN SPACING: Use consistent vertical gaps between elements — pick ONE gap size (16px or 20px) and use it everywhere in the group. Never use random or tight spacing.
- READABILITY (CRITICAL):
  * Every text MUST be clearly readable against the background.
  * Use overlayGradient to strongly darken the area where text is placed.
  * Text color must be high contrast — prefer pure white (#ffffff) or very light colors on dark gradients.
  * If using colored text, ensure it has strong textShadow (e.g., "0 2px 12px rgba(0,0,0,0.8)") for readability.
  * Never use semi-transparent or low-opacity text colors like rgba(255,255,255,0.5) — they become invisible.
  * Minimum fontSize is 13px — anything smaller is unreadable on mobile.
- SAFE ZONES: Avoid y=0-60 (status bar) and y=780-844 (bottom bar). Place all elements between y=80 and y=760.
- Every element needs at minimum: text, x, y, fontSize, fontWeight, color
- Keep total element count between 2-5. More than 5 elements almost always looks cluttered.

LANGUAGE & TEXT RULES:
- CRITICAL: Detect the language the user wrote their brief in. You MUST write ALL text elements in that SAME language. If the user writes in Turkish, all banner texts must be in Turkish. If in French, write in French. If in English, write in English. Match the user's language exactly.
- Do NOT copy the user's text word-for-word. Take their ideas and intentions, then rewrite them as polished, professional banner copy — short, punchy, and magazine-quality. Think like a creative director: transform casual input into compelling marketing language while preserving the core message.
- If no user brief is provided, default to English.

CREATIVE FREEDOM:
- You decide WHERE on the canvas to place elements — analyze the image and pick the best spot
- You decide WHAT elements to include — headlines, badges, prices, CTAs, tags — whatever fits the brief
- You decide the STYLE — colors, fonts, gradient direction, element shapes
- You decide the OVERLAY — gradient angle, opacity, color — whatever makes text readable on this specific image
- Every poster should feel unique, polished, and magazine-quality`;

    const responseText = await callReplicateGeminiPro(prompt, [imageUrl]);
    console.log("🤖 [CAMPAIGN_KIT] Gemini 3.1 Pro response:", responseText.substring(0, 200) + "...");

    let campaignData;
    try {
      let cleanJson = responseText;
      if (cleanJson.startsWith("```")) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      campaignData = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error("❌ [CAMPAIGN_KIT] Failed to parse Gemini 3.1 Pro response:", parseError.message);
      campaignData = {
        accentColor: "#d88d4d",
        overlayGradient: "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 40%, rgba(0,0,0,0.7) 100%)",
        elements: [
          { text: "THE NEW EDIT", x: 20, y: 520, fontSize: 48, fontWeight: "800", fontFamily: "serif", color: "#ffffff", textTransform: "uppercase", letterSpacing: "-0.04em", lineHeight: "0.92", textShadow: "0 4px 20px rgba(0,0,0,0.3)" },
          { text: "Refined silhouettes for the modern eye.", x: 20, y: 600, fontSize: 14, fontWeight: "400", fontFamily: "sans-serif", color: "rgba(255,255,255,0.85)", maxWidth: "300" },
          { text: "Explore Now", x: 20, y: 650, fontSize: 13, fontWeight: "700", fontFamily: "sans-serif", color: "#ffffff", bgColor: "#d88d4d", padding: "12px 24px", borderRadius: "999px" },
        ],
      };
    }

    // Return only JSON data — client builds HTML from static template
    res.json({ success: true, campaignData });
  } catch (error) {
    console.error("❌ [CAMPAIGN_KIT] Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
