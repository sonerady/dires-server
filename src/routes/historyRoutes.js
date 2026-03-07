const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const teamService = require("../services/teamService");
const logger = require("../utils/logger");
const { optimizeHistoryImages } = require("../utils/imageOptimizer");
const router = express.Router();

// Supabase client'ını import et
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Retry helper function for Supabase queries
const retryQuery = async (queryFn, maxRetries = 3, delay = 500) => {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await queryFn();
      // Check if result has error
      if (result.error && result.error.message === '') {
        // Empty error message indicates connection issue, retry
        lastError = result.error;
        logger.log(`⚠️ [HISTORY] Empty error on attempt ${attempt}/${maxRetries}, retrying...`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay * attempt));
          continue;
        }
      }
      return result;
    } catch (err) {
      lastError = err;
      logger.log(`⚠️ [HISTORY] Exception on attempt ${attempt}/${maxRetries}:`, err.message);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }
  return { data: null, count: null, error: lastError || { message: 'Max retries exceeded' } };
};

/**
 * GET /api/history/user/:userId
 * Kullanıcının history verilerini getir (pagination ile)
 * Team üyesi ise tüm ekip üyelerinin history'sini getirir (Shared Workspace)
 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10, page = 1 } = req.query;

    // Input validation
    if (!userId || userId === "anonymous_user") {
      return res.status(400).json({
        success: false,
        message: "Valid user ID required",
      });
    }

    const parsedLimit = Math.min(parseInt(limit) || 10, 50); // Max 50 item
    const parsedPage = Math.max(parseInt(page) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;

    // Get team member IDs for shared workspace
    const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

    logger.log(`📊 [HISTORY] Fetching history for user: ${userId}`);
    logger.log(`📊 [HISTORY] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);
    logger.log(
      `📊 [HISTORY] Pagination: page=${parsedPage}, limit=${parsedLimit}, offset=${offset}`
    );

    // Toplam sayıyı al (visibility kolonu varsa true olanları, yoksa tümünü)
    // Using retry wrapper for connection stability
    // Use .in() for team members, .eq() for single user
    let { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
    );

    // Eğer visibility kolonu yoksa (hata alırsak), visibility filtresiz tekrar dene
    if (countError && (countError.message?.includes("visibility") || countError.code === "PGRST116")) {
      logger.log("⚠️ [HISTORY] Visibility column not found, retrying without visibility filter");
      const fallbackResult = await retryQuery(() =>
        supabase
          .from("reference_results")
          .select("*", { count: "exact", head: true })
          .in("user_id", memberIds)
          .in("status", ["completed", "failed"])
      );
      totalCount = fallbackResult.count;
      countError = fallbackResult.error;
    }

    if (countError) {
      console.error("❌ [HISTORY] Count query error:", countError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch total count",
      });
    }

    // History verilerini getir (visibility kolonu varsa true olanları, yoksa tümünü)
    // Using retry wrapper for connection stability
    let { data: historyData, error: historyError } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select(
          `
          id,
          user_id,
          generation_id,
          status,
          result_image_url,
          reference_images,
          location_image,
          aspect_ratio,
          created_at,
          credits_before_generation,
          credits_deducted,
          credits_after_generation,
          settings,
          quality_version,
          kits,
          stories,
          unboxing_stories
        `
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .order("created_at", { ascending: false })
        .range(offset, offset + parsedLimit - 1)
    );

    // Eğer visibility kolonu yoksa (hata alırsak), visibility filtresiz tekrar dene
    if (historyError && (historyError.message?.includes("visibility") || historyError.code === "PGRST116")) {
      logger.log("⚠️ [HISTORY] Visibility column not found, retrying without visibility filter");
      const fallbackResult = await retryQuery(() =>
        supabase
          .from("reference_results")
          .select(
            `
            id,
            user_id,
            generation_id,
            status,
            result_image_url,
            reference_images,
            location_image,
            aspect_ratio,
            created_at,
            credits_before_generation,
            credits_deducted,
            credits_after_generation,
            settings,
            quality_version,
            kits,
            stories,
            unboxing_stories
          `
          )
          .in("user_id", memberIds)
          .in("status", ["completed", "failed"])
          .order("created_at", { ascending: false })
          .range(offset, offset + parsedLimit - 1)
      );
      historyData = fallbackResult.data;
      historyError = fallbackResult.error;
    }

    if (historyError) {
      console.error("❌ [HISTORY] Query error:", historyError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch history data",
      });
    }

    const hasMore = offset + parsedLimit < (totalCount || 0);

    logger.log(`📊 [HISTORY] Retrieved ${historyData?.length || 0} items`);
    logger.log(`📊 [HISTORY] Total count: ${totalCount}`);
    logger.log(`📊 [HISTORY] Has more: ${hasMore}`);

    return res.json({
      success: true,
      data: optimizeHistoryImages(historyData || []),
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        totalCount: totalCount || 0,
        hasMore: hasMore,
        totalPages: Math.ceil((totalCount || 0) / parsedLimit),
      },
      isTeamData: isTeamMember,
    });
  } catch (error) {
    console.error("❌ [HISTORY] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/history/stats/:userId
 * Kullanıcının history istatistiklerini getir
 * Team üyesi ise tüm ekip üyelerinin istatistiklerini getirir (Shared Workspace)
 */
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || userId === "anonymous_user") {
      return res.status(400).json({
        success: false,
        message: "Valid user ID required",
      });
    }

    // Get team member IDs for shared workspace
    const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

    logger.log(`📊 [HISTORY_STATS] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);

    // İstatistikleri getir (visibility kolonu varsa true olanları, yoksa tümünü)
    let statsQuery = supabase
      .from("reference_results")
      .select("status, credits_deducted")
      .in("user_id", memberIds)
      .eq("visibility", true);

    let { data: statsData, error: statsError } = await statsQuery;

    // Eğer visibility kolonu yoksa (hata alırsak), visibility filtresiz tekrar dene
    if (statsError && (statsError.message?.includes("visibility") || statsError.code === "PGRST116")) {
      logger.log("⚠️ [HISTORY_STATS] Visibility column not found, retrying without visibility filter");
      const fallbackQuery = supabase
        .from("reference_results")
        .select("status, credits_deducted")
        .in("user_id", memberIds);
      const fallbackResult = await fallbackQuery;
      statsData = fallbackResult.data;
      statsError = fallbackResult.error;
    }

    if (statsError) {
      console.error("❌ [HISTORY_STATS] Query error:", statsError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch stats",
      });
    }

    const stats = {
      total: statsData.length,
      completed: statsData.filter((item) => item.status === "completed").length,
      failed: statsData.filter((item) => item.status === "failed").length,
      totalCreditsSpent: statsData
        .filter((item) => item.credits_deducted)
        .reduce((sum, item) => sum + (item.credits_deducted || 0), 0),
    };

    return res.json({
      success: true,
      data: stats,
      isTeamData: isTeamMember,
    });
  } catch (error) {
    console.error("❌ [HISTORY_STATS] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * DELETE /api/history/delete/:generationId
 * History item'ını sil (visibility = false yap)
 */
router.delete("/delete/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { userId } = req.body;

    logger.log(`🗑️ [HISTORY] Delete request for generationId: ${generationId}, userId: ${userId}`);

    // Input validation
    if (!generationId) {
      return res.status(400).json({
        success: false,
        message: "Generation ID required",
      });
    }

    if (!userId || userId === "anonymous_user") {
      return res.status(400).json({
        success: false,
        message: "Valid user ID required",
      });
    }

    // Visibility'yi false yap (soft delete)
    const { data: updatedData, error: updateError } = await supabase
      .from("reference_results")
      .update({
        visibility: false,
        updated_at: new Date().toISOString(),
      })
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("❌ [HISTORY] Update error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to delete history item",
        error: updateError.message,
      });
    }

    if (!updatedData) {
      return res.status(404).json({
        success: false,
        message: "History item not found or unauthorized",
      });
    }

    logger.log(`✅ [HISTORY] History item deleted (visibility=false): ${generationId}`);

    return res.json({
      success: true,
      message: "History item deleted successfully",
      data: updatedData,
    });
  } catch (error) {
    console.error("❌ [HISTORY] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/history/kits/:generationId
 * Get kits array for a specific generation
 */
router.get("/kits/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    logger.log(`📦 [HISTORY_KITS] Fetching kits for generation: ${generationId}`);

    // Input validation
    if (!generationId) {
      return res.status(400).json({
        success: false,
        message: "Generation ID required",
      });
    }

    // Kits verilerini getir
    // NOTE: generation_id may not be unique if previous attempts failed/retried, so use maybeSingle()
    const { data: generationData, error: fetchError } = await supabase
      .from("reference_results")
      .select("kits")
      .eq("generation_id", generationId)
      .order("created_at", { ascending: false }) // En son üretileni al
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("❌ [HISTORY_KITS] Query error:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch kits data",
        error: fetchError.message
      });
    }

    if (!generationData) {
      return res.status(404).json({
        success: false,
        message: "Generation not found",
      });
    }

    // Kits array'ini parse et
    let kitsArray = [];
    if (generationData.kits) {
      try {
        kitsArray = Array.isArray(generationData.kits)
          ? generationData.kits
          : JSON.parse(generationData.kits || "[]");
      } catch (e) {
        console.warn("Kits parse error:", e);
        kitsArray = [];
      }
    }

    logger.log(`✅ [HISTORY_KITS] Retrieved ${kitsArray.length} kits for generation: ${generationId}`);

    return res.json({
      success: true,
      data: {
        kits: kitsArray,
        count: kitsArray.length,
      },
    });
  } catch (error) {
    console.error("❌ [HISTORY_KITS] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/history/stories/:generationId
 * Get stories array for a specific generation
 */
router.get("/stories/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    logger.log(`📖 [HISTORY_STORIES] Fetching stories for generation: ${generationId}`);

    if (!generationId) {
      return res.status(400).json({
        success: false,
        message: "Generation ID required",
      });
    }

    const { data: generationData, error: fetchError } = await supabase
      .from("reference_results")
      .select("stories")
      .eq("generation_id", generationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("❌ [HISTORY_STORIES] Query error:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch stories data",
        error: fetchError.message
      });
    }

    if (!generationData) {
      return res.status(404).json({
        success: false,
        message: "Generation not found",
      });
    }

    let storiesArray = [];
    if (generationData.stories) {
      try {
        storiesArray = Array.isArray(generationData.stories)
          ? generationData.stories
          : JSON.parse(generationData.stories || "[]");
      } catch (e) {
        console.warn("Stories parse error:", e);
        storiesArray = [];
      }
    }

    logger.log(`✅ [HISTORY_STORIES] Retrieved ${storiesArray.length} stories for generation: ${generationId}`);

    return res.json({
      success: true,
      data: {
        stories: storiesArray,
        count: storiesArray.length,
      },
    });
  } catch (error) {
    console.error("❌ [HISTORY_STORIES] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/history/fashion-kits/:generationId
 * Get fashion_kits array for a specific generation
 */
router.get("/fashion-kits/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    logger.log(`👗 [HISTORY_FASHION] Fetching fashion kits for generation: ${generationId}`);

    if (!generationId) {
      return res.status(400).json({
        success: false,
        message: "Generation ID required",
      });
    }

    const { data: generationData, error: fetchError } = await supabase
      .from("reference_results")
      .select("fashion_kits")
      .eq("generation_id", generationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("❌ [HISTORY_FASHION] Query error:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch fashion kits data",
        error: fetchError.message
      });
    }

    if (!generationData) {
      return res.status(404).json({
        success: false,
        message: "Generation not found",
      });
    }

    let fashionKitsArray = [];
    if (generationData.fashion_kits) {
      try {
        fashionKitsArray = Array.isArray(generationData.fashion_kits)
          ? generationData.fashion_kits
          : JSON.parse(generationData.fashion_kits || "[]");
      } catch (e) {
        console.warn("Fashion kits parse error:", e);
        fashionKitsArray = [];
      }
    }

    logger.log(`✅ [HISTORY_FASHION] Retrieved ${fashionKitsArray.length} fashion kits for generation: ${generationId}`);

    return res.json({
      success: true,
      data: {
        fashionKits: fashionKitsArray,
        count: fashionKitsArray.length,
      },
    });
  } catch (error) {
    console.error("❌ [HISTORY_FASHION] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/history/unboxing-stories/:generationId
 * Get unboxing_stories array for a specific generation
 */
router.get("/unboxing-stories/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    logger.log(`📦 [HISTORY_UNBOXING] Fetching unboxing stories for generation: ${generationId}`);

    if (!generationId) {
      return res.status(400).json({
        success: false,
        message: "Generation ID required",
      });
    }

    const { data: generationData, error: fetchError } = await supabase
      .from("reference_results")
      .select("unboxing_stories")
      .eq("generation_id", generationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("❌ [HISTORY_UNBOXING] Query error:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch unboxing stories data",
        error: fetchError.message
      });
    }

    if (!generationData) {
      return res.status(404).json({
        success: false,
        message: "Generation not found",
      });
    }

    let unboxingArray = [];
    if (generationData.unboxing_stories) {
      try {
        unboxingArray = Array.isArray(generationData.unboxing_stories)
          ? generationData.unboxing_stories
          : JSON.parse(generationData.unboxing_stories || "[]");
      } catch (e) {
        console.warn("Unboxing stories parse error:", e);
        unboxingArray = [];
      }
    }

    logger.log(`✅ [HISTORY_UNBOXING] Retrieved ${unboxingArray.length} unboxing stories for generation: ${generationId}`);

    return res.json({
      success: true,
      data: {
        unboxing_stories: unboxingArray,
        count: unboxingArray.length,
      },
    });
  } catch (error) {
    console.error("❌ [HISTORY_UNBOXING] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/history/debug/user-counts
 * Debug endpoint to check actual per-user record counts WITHOUT team logic
 * Query param: userIds (comma-separated)
 */
router.get("/debug/user-counts", async (req, res) => {
  try {
    const { userIds } = req.query;

    if (!userIds) {
      return res.status(400).json({
        success: false,
        message: "userIds query parameter required (comma-separated)",
      });
    }

    const userIdArray = userIds.split(",").map(id => id.trim());
    const results = {};

    for (const userId of userIdArray) {
      // Query count for THIS user only (no team logic)
      const { count, error } = await supabase
        .from("reference_results")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("status", ["completed", "failed"])
        .eq("visibility", true);

      results[userId] = {
        count: count || 0,
        error: error?.message || null
      };

      logger.log(`🔍 [DEBUG] User ${userId.substring(0, 8)}... has ${count} records`);
    }

    return res.json({
      success: true,
      message: "Per-user counts (WITHOUT team logic)",
      data: results,
      total: Object.values(results).reduce((sum, r) => sum + r.count, 0)
    });
  } catch (error) {
    console.error("❌ [DEBUG] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
