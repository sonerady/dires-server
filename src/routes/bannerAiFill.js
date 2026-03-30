const express = require("express");
const Replicate = require("replicate");
const router = express.Router();

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

/**
 * POST /api/banner-ai-fill
 * Body: { textElements: [{ id, text, tag, role }], prompt: string, templateName: string }
 * Returns: { filledTexts: [{ id, text }] }
 */
router.post("/", async (req, res) => {
  try {
    const { textElements, prompt, templateName } = req.body;

    if (!textElements || !Array.isArray(textElements) || textElements.length === 0) {
      return res.status(400).json({ error: "textElements array is required" });
    }
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    // Build the element descriptions for context
    const elementDescriptions = textElements
      .map((el, i) => `${i + 1}. id="${el.id}" | current text: "${el.text}" | tag: ${el.tag || "div"} | role: ${el.role || "unknown"}`)
      .join("\n");

    const systemPrompt = `You are a creative copywriter for e-commerce banner designs.
You will receive a list of text elements from a banner template and a user prompt describing what the banner should say.
Your job is to fill in each text element with appropriate, creative, concise copy that fits the banner layout.

RULES:
- Keep text SHORT and punchy — banners have limited space
- Match the tone and style the user describes
- Respect the role of each element (heading should be bold/short, subtitle can be slightly longer, CTA should be action-oriented)
- Return ONLY a valid JSON array with objects containing "id" and "text" fields
- Do NOT add any explanation, markdown, or extra text — ONLY the JSON array
- Use the same language as the user's prompt

EXAMPLE OUTPUT:
[{"id":"e5","text":"SUMMER SALE"},{"id":"e8","text":"Up to 50% Off"},{"id":"e12","text":"Shop Now"}]`;

    const userMessage = `Template: ${templateName || "Banner"}

Text elements in this banner:
${elementDescriptions}

User's request: ${prompt}

Fill in all text elements. Return ONLY the JSON array:`;

    const output = await replicate.run("google/gemini-3-flash", {
      input: {
        prompt: `${systemPrompt}\n\n${userMessage}`,
        max_tokens: 1024,
        temperature: 0.7,
      },
    });

    // Replicate returns output as string or array of strings
    let responseText = "";
    if (Array.isArray(output)) {
      responseText = output.join("");
    } else if (typeof output === "string") {
      responseText = output;
    } else if (output && typeof output === "object") {
      responseText = JSON.stringify(output);
    }

    // Extract JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("AI Fill - Could not parse JSON from response:", responseText);
      return res.status(500).json({ error: "Could not parse AI response" });
    }

    const filledTexts = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!Array.isArray(filledTexts) || filledTexts.length === 0) {
      return res.status(500).json({ error: "Invalid AI response format" });
    }

    // Ensure each item has id and text
    const validTexts = filledTexts.filter((item) => item.id && typeof item.text === "string");

    res.json({ filledTexts: validTexts });
  } catch (error) {
    console.error("Banner AI Fill error:", error);
    res.status(500).json({ error: error.message || "AI fill failed" });
  }
});

module.exports = router;
