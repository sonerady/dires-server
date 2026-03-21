const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const logger = require("../utils/logger");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const VALID_TYPES = ["beforeAfter", "infographic", "detailCloseup", "problemSolution", "comparison", "sizeDimension", "lifestyle"];

// POST /api/listing/track-generation
// Client calls this after firing each generation API to track it in listing_generations
router.post("/track-generation", async (req, res) => {
  try {
    const { userId, generationId, batchId, generatorType, originalImageUrl, prompt, settings, aspectRatio, qualityVersion } = req.body;

    if (!userId || !generationId || !generatorType) {
      return res.status(400).json({ success: false, message: "userId, generationId, and generatorType are required" });
    }

    if (!VALID_TYPES.includes(generatorType)) {
      return res.status(400).json({ success: false, message: `Invalid generatorType: ${generatorType}` });
    }

    const { data, error } = await supabase
      .from("listing_generations")
      .insert({
        user_id: userId,
        generation_id: generationId,
        batch_id: batchId || null,
        generator_type: generatorType,
        status: "processing",
        original_prompt: prompt || null,
        original_image_url: originalImageUrl || null,
        settings: settings || {},
        aspect_ratio: aspectRatio || "3:2",
        quality_version: qualityVersion || "v1",
      })
      .select()
      .single();

    if (error) {
      logger.log("❌ [LISTING] Track generation error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, result: data });
  } catch (e) {
    logger.log("❌ [LISTING] Track generation exception:", e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/listing/user-generations/:userId
// Single endpoint for hydration - returns all listing generations for user
router.get("/user-generations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    // Last 1 hour
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    let query = supabase
      .from("listing_generations")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", oneHourAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (status) {
      if (status === "pending") {
        query = query.in("status", ["pending", "processing"]);
      } else {
        query = query.eq("status", status);
      }
    }

    const { data: generations, error } = await query;

    if (error) {
      logger.log("❌ [LISTING] User generations error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    const mapped = (generations || []).map((gen) => ({
      generationId: gen.generation_id,
      batchId: gen.batch_id,
      generatorType: gen.generator_type,
      status: gen.status,
      originalPrompt: gen.original_prompt,
      referenceImages: gen.original_image_url ? [gen.original_image_url] : [],
      resultImageUrl: gen.result_image_url,
      settings: gen.settings,
      aspectRatio: gen.aspect_ratio,
      qualityVersion: gen.quality_version,
      createdAt: gen.created_at,
    }));

    return res.json({
      success: true,
      result: { generations: mapped },
    });
  } catch (e) {
    logger.log("❌ [LISTING] User generations exception:", e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/listing/sync-status/:generationId
// Polls reference_results for actual status, syncs back to listing_generations
router.get("/sync-status/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    if (!generationId) {
      return res.status(400).json({ success: false, message: "generationId is required" });
    }

    // Check reference_results for actual status
    const { data: refResult, error: refError } = await supabase
      .from("reference_results")
      .select("*")
      .eq("generation_id", generationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (refError || !refResult) {
      return res.json({
        success: true,
        result: { status: "not_found", generation: null },
      });
    }

    // If completed or failed in reference_results, sync to listing_generations
    if (refResult.status === "completed" || refResult.status === "failed") {
      const updateData = {
        status: refResult.status,
        updated_at: new Date().toISOString(),
      };
      if (refResult.result_image_url) {
        updateData.result_image_url = refResult.result_image_url;
      }
      if (refResult.enhanced_prompt) {
        updateData.enhanced_prompt = refResult.enhanced_prompt;
      }
      if (refResult.processing_time_seconds) {
        updateData.processing_time_seconds = refResult.processing_time_seconds;
      }
      if (refResult.fal_request_id) {
        updateData.fal_request_id = refResult.fal_request_id;
      }

      await supabase
        .from("listing_generations")
        .update(updateData)
        .eq("generation_id", generationId);
    }

    return res.json({
      success: true,
      result: {
        status: refResult.status,
        generation: {
          generationId: refResult.generation_id,
          status: refResult.status,
          resultImageUrl: refResult.result_image_url,
          enhancedPrompt: refResult.enhanced_prompt,
          processingTimeSeconds: refResult.processing_time_seconds,
          createdAt: refResult.created_at,
        },
      },
    });
  } catch (e) {
    logger.log("❌ [LISTING] Sync status exception:", e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
