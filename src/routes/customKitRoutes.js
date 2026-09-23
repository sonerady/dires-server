// 🧰 Kendi kitini oluştur (22 Eyl 2026) — client commerce/CustomKitSheet
//
// Kullanıcı kitinin mantığını serbest metinle anlatır; bu uç onu 6 sahnelik,
// düzenlenebilir bir kit tanımına çevirir (ad, açıklama, oran, sahne başlığı +
// talimatı). Kit ÜRETİMİ ayrı bir hat değildir: tanım generate-product-story'ye
// `customKit` olarak gider ve o isteğe özel sahne talimatlarını ezer.
// LLM: anasayfadaki "kendi aracını oluştur" incelemesiyle aynı Astra modeli.
const express = require("express");
const router = express.Router();
const { rateLimit } = require("express-rate-limit");
const { askAstra, parseJsonLoose } = require("../utils/menuStudioAstra");

const RATIOS = ["9:16", "4:5", "3:4", "2:3", "1:1", "5:4", "4:3", "3:2", "16:9"];
const clip = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

const SYSTEM_PROMPT = `You design "kits" for Diress, an AI fashion photoshoot app for online sellers.
A kit turns ONE photo of a product worn by a model into SIX coordinated images that the seller posts together.
Given the seller's idea, return ONLY a JSON object:
{"name": string (2-4 words), "description": string (one sentence, max 120 chars),
 "aspectRatio": one of ${RATIOS.join(", ")},
 "scenes": [ exactly 6 × {"title": string (1-3 words), "instruction": string (one vivid sentence: location, pose/action, light, mood; max 220 chars)} ]}
Rules: every scene keeps the SAME product and the same model identity; vary location, framing and action so the six images tell one story;
no brand names, no text overlays, nothing unsafe. Write name, description and titles in the requested UI language; write instructions in English.`;

function normalizeKit(raw) {
  if (!raw || typeof raw !== "object") return null;
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : [])
    .map((scene) => ({ title: clip(scene?.title, 40), instruction: clip(scene?.instruction, 400) }))
    .filter((scene) => scene.title && scene.instruction)
    .slice(0, 6);
  if (scenes.length !== 6) return null;
  return {
    name: clip(raw.name, 40) || "My kit",
    description: clip(raw.description, 160),
    aspectRatio: RATIOS.includes(raw.aspectRatio) ? raw.aspectRatio : "9:16",
    scenes,
  };
}

router.post(
  "/custom-kits/design",
  rateLimit({ windowMs: 60000, limit: 8, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    try {
      const prompt = clip(req.body?.prompt, 1500);
      const language = clip(req.body?.language, 12) || "en";
      if (prompt.length < 15) return res.status(400).json({ success: false, reason: "prompt_too_short" });

      const raw = await askAstra({
        model: "openai/gpt-6-astra",
        systemPrompt: SYSTEM_PROMPT,
        prompt: `UI language: ${language}\nSeller's idea:\n${prompt}`,
        maxTokens: 4000,
        maxRetries: 2,
        timeoutMs: 120000,
        tag: "CUSTOM_KIT",
      });
      const kit = normalizeKit(parseJsonLoose(raw));
      if (!kit) return res.status(502).json({ success: false, reason: "design_unavailable" });
      return res.json({ success: true, kit });
    } catch (error) {
      console.error("❌ [CUSTOM_KIT] design error:", error?.message);
      return res.status(502).json({ success: false, reason: "design_unavailable" });
    }
  }
);

module.exports = router;
module.exports.normalizeKit = normalizeKit;
