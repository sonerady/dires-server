const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const teamService = require("../services/teamService");
const logger = require("../utils/logger");
const { optimizeHistoryImages, getOriginalUrl } = require("../utils/imageOptimizer");
const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Retry helper function for Supabase queries
const retryQuery = async (queryFn, maxRetries = 3, delay = 1000) => {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await queryFn();
      const isRetryableError = result.error && (
        result.error.message === "" ||
        result.error.code === "57014" ||
        result.error.message?.includes("statement timeout") ||
        result.error.message?.includes("timeout")
      );
      if (isRetryableError) {
        lastError = result.error;
        logger.log(
          `⚠️ [FEATURE-HISTORY] Retryable error on attempt ${attempt}/${maxRetries}: ${result.error.code || result.error.message}, retrying...`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, delay * attempt),
          );
          continue;
        }
      }
      return result;
    } catch (err) {
      lastError = err;
      logger.log(
        `⚠️ [FEATURE-HISTORY] Exception on attempt ${attempt}/${maxRetries}:`,
        err.message,
      );
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  }
  return {
    data: null,
    count: null,
    error: lastError || { message: "Max retries exceeded" },
  };
};

/**
 * Shared pagination + team setup helper
 */
const setupRequest = async (req) => {
  const { userId } = req.params;
  const { limit = 10, page = 1, sort = "newest" } = req.query;

  if (!userId || userId === "anonymous_user") {
    return { error: "Valid user ID required" };
  }

  const parsedLimit = Math.min(parseInt(limit) || 10, 50);
  const parsedPage = Math.max(parseInt(page) || 1, 1);
  const offset = (parsedPage - 1) * parsedLimit;
  const ascending = sort === "oldest";
  const { memberIds, isTeamMember } =
    await teamService.getTeamMemberIds(userId);

  return { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending };
};

/**
 * Resolve location_ids for history items that have location_image but no locationId in settings.
 * Does a batch lookup against custom_locations by generated_title.
 */
const resolveLocationIds = async (data) => {
  if (!data || !Array.isArray(data) || data.length === 0) return data;

  // Parse settings and find items needing location_id resolution
  const titleSet = new Set();
  const parsedSettingsMap = new Map();

  data.forEach((item, idx) => {
    if (!item.location_image) return;
    let settings = item.settings;
    if (typeof settings === "string") {
      try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
    }
    if (!settings) settings = {};
    parsedSettingsMap.set(idx, settings);

    // Already has locationId - no need to resolve
    if (settings.locationId) return;

    // Collect location title for batch lookup
    if (settings.location && typeof settings.location === "string") {
      titleSet.add(settings.location);
    }
  });

  if (titleSet.size === 0) {
    // Still enrich items that already have locationId from settings
    return data.map((item, idx) => {
      const settings = parsedSettingsMap.get(idx);
      if (settings?.locationId) {
        return { ...item, resolved_location_id: String(settings.locationId) };
      }
      return item;
    });
  }

  // Batch query custom_locations by generated_title
  const titles = [...titleSet];
  const { data: locations, error } = await supabase
    .from("custom_locations")
    .select("id, generated_title")
    .in("generated_title", titles);

  if (error) {
    logger.log("⚠️ [FEATURE-HISTORY] resolveLocationIds query error:", error.message);
  }

  // Build title -> id map (first match wins)
  const titleToId = {};
  if (locations && Array.isArray(locations)) {
    locations.forEach((loc) => {
      if (loc.generated_title && !titleToId[loc.generated_title]) {
        titleToId[loc.generated_title] = String(loc.id);
      }
    });
  }

  // Enrich data with resolved_location_id
  return data.map((item, idx) => {
    const settings = parsedSettingsMap.get(idx);
    if (!settings) return item;

    if (settings.locationId) {
      return { ...item, resolved_location_id: String(settings.locationId) };
    }
    if (settings.location && titleToId[settings.location]) {
      return { ...item, resolved_location_id: titleToId[settings.location] };
    }
    return item;
  });
};

/**
 * Resolve pose IDs for history items that have pose_image but no poseId in settings.
 * Matches custom poses by normalizing image_url with getOriginalUrl.
 */
const resolvePoseIds = async (data) => {
  if (!data || !Array.isArray(data) || data.length === 0) return data;

  const imageUrlSet = new Set();
  const rawImageUrlSet = new Set();
  const parsedSettingsMap = new Map();

  data.forEach((item, idx) => {
    if (!item.pose_image) return;
    let settings = item.settings;
    if (typeof settings === "string") {
      try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
    }
    if (!settings) settings = {};
    parsedSettingsMap.set(idx, settings);

    // Already has poseId - no need to resolve
    if (settings.poseId) return;

    // Collect pose_image URL for batch lookup against custom_poses
    if (item.pose_image && typeof item.pose_image === "string") {
      // Normalize URL for matching and keep raw for fallback query
      const normalizedUrl = getOriginalUrl(item.pose_image);
      imageUrlSet.add(normalizedUrl);
      rawImageUrlSet.add(item.pose_image);
      if (normalizedUrl !== item.pose_image) {
        rawImageUrlSet.add(normalizedUrl);
      }
    }
  });

  if (imageUrlSet.size === 0) {
    // Still enrich items that already have poseId from settings
    return data.map((item, idx) => {
      const settings = parsedSettingsMap.get(idx);
      if (settings?.poseId) {
        return { ...item, resolved_pose_id: String(settings.poseId), resolved_pose_type: settings.poseType || "custom" };
      }
      return item;
    });
  }

  // Batch query custom_poses by image_url (try both raw and normalized URLs)
  const allUrls = [...rawImageUrlSet];
  const { data: customPoses, error } = await supabase
    .from("custom_poses")
    .select("id, image_url, description")
    .in("image_url", allUrls);

  if (error) {
    logger.log("⚠️ [FEATURE-HISTORY] resolvePoseIds query error:", error.message);
  }

  // Build normalized_image_url -> id map
  const normalizedUrlToId = {};
  if (customPoses && Array.isArray(customPoses)) {
    customPoses.forEach((pose) => {
      if (pose.image_url) {
        const normalized = getOriginalUrl(pose.image_url);
        if (!normalizedUrlToId[normalized]) {
          normalizedUrlToId[normalized] = String(pose.id);
        }
      }
    });
  }

  // Enrich data with resolved_pose_id
  return data.map((item, idx) => {
    const settings = parsedSettingsMap.get(idx);
    if (!settings) return item;

    if (settings.poseId) {
      return { ...item, resolved_pose_id: String(settings.poseId), resolved_pose_type: settings.poseType || "custom" };
    }
    if (item.pose_image) {
      const normalizedPoseImage = getOriginalUrl(item.pose_image);
      if (normalizedUrlToId[normalizedPoseImage]) {
        return { ...item, resolved_pose_id: normalizedUrlToId[normalizedPoseImage], resolved_pose_type: "custom" };
      }
    }
    return item;
  });
};

/**
 * Shared response builder
 */
const buildResponse = async (
  res,
  data,
  totalCount,
  parsedPage,
  parsedLimit,
  offset,
  isTeamMember,
) => {
  const hasMore = offset + parsedLimit < (totalCount || 0);

  // Resolve location_ids and pose_ids for items
  let enrichedData = await resolveLocationIds(data || []);
  enrichedData = await resolvePoseIds(enrichedData);

  return res.json({
    success: true,
    data: optimizeHistoryImages(enrichedData),
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      totalCount: totalCount || 0,
      hasMore,
      totalPages: Math.ceil((totalCount || 0) / parsedLimit),
    },
    isTeamData: isTeamMember,
  });
};

/**
 * GET /api/feature-history/virtual-model/:userId
 * Virtual model (Manken Giydirme) history from reference_results
 * Excludes pose, color, backside, refiner items
 */
router.get("/virtual-model/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching virtual-model history for user: ${userId}`,
    );

    // Count - only include records with gender key in settings (virtual model data)
    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .not("settings->gender", "is", null),
    );

    if (countError) {
      console.error(
        "❌ [FEATURE-HISTORY] virtual-model count error:",
        countError,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    // Data - only include records with gender key in settings (virtual model data)
    const { data, error } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select(
          `id, user_id, generation_id, status, result_image_url, reference_images, location_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits`,
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .not("settings->gender", "is", null)
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error("❌ [FEATURE-HISTORY] virtual-model query error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] virtual-model: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] virtual-model error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/feature-history/pose-change/:userId
 * Pose change history from reference_results filtered by pose key in settings
 */
router.get("/pose-change/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching pose-change history for user: ${userId}`,
    );

    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .not("settings->pose", "is", null),
    );

    if (countError) {
      console.error(
        "❌ [FEATURE-HISTORY] pose-change count error:",
        countError,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    const { data, error } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select(
          `id, user_id, generation_id, status, result_image_url, reference_images, location_image, pose_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits`,
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .not("settings->pose", "is", null)
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error("❌ [FEATURE-HISTORY] pose-change query error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] pose-change: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] pose-change error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/feature-history/color-change/:userId
 * Color change history from color_change_generations
 */
router.get("/color-change/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching color-change history for user: ${userId}`,
    );

    // Filter by productColor in settings (reference_results table)
    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .not("settings->productColor", "is", null),
    );

    if (countError) {
      console.error(
        "❌ [FEATURE-HISTORY] color-change count error:",
        countError,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    const { data, error } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select(
          `id, user_id, generation_id, status, result_image_url, reference_images, location_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits`,
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .not("settings->productColor", "is", null)
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error("❌ [FEATURE-HISTORY] color-change query error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] color-change: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] color-change error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/feature-history/back-side/:userId
 * Back side history from reference_results filtered by isBackSideCloset in settings
 */
router.get("/back-side/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching back-side history for user: ${userId}`,
    );

    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .filter("settings", "cs", '{"isBackSideCloset":true}'),
    );

    if (countError) {
      console.error(
        "❌ [FEATURE-HISTORY] back-side count error:",
        countError,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    const { data, error } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select(
          `id, user_id, generation_id, status, result_image_url, reference_images, location_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits`,
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .filter("settings", "cs", '{"isBackSideCloset":true}')
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error("❌ [FEATURE-HISTORY] back-side query error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] back-side: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] back-side error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/feature-history/refiner/:userId
 * Refiner history from reference_results filtered by isRefinerMode in settings
 */
router.get("/refiner/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching refiner history for user: ${userId}`,
    );

    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .filter("settings", "cs", '{"isRefinerMode":true}'),
    );

    if (countError) {
      console.error("❌ [FEATURE-HISTORY] refiner count error:", countError);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    const { data, error } = await retryQuery(() =>
      supabase
        .from("reference_results")
        .select(
          `id, user_id, generation_id, status, result_image_url, reference_images, location_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits`,
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .eq("visibility", true)
        .filter("settings", "cs", '{"isRefinerMode":true}')
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error("❌ [FEATURE-HISTORY] refiner query error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] refiner: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] refiner error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/feature-history/chat-edit/:userId
 * Chat edit history from chat_edits
 */
router.get("/chat-edit/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching chat-edit history for user: ${userId}`,
    );

    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("chat_edits")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"]),
    );

    if (countError) {
      console.error(
        "❌ [FEATURE-HISTORY] chat-edit count error:",
        countError,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    const { data, error } = await retryQuery(() =>
      supabase
        .from("chat_edits")
        .select(
          `id, user_id, status, user_prompt, enhanced_prompt, original_image_url, result_image_url, masked_image_url, selection_count, aspect_ratio, credits_cost, credit_balance_before, credit_balance_after, created_at`,
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error("❌ [FEATURE-HISTORY] chat-edit query error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] chat-edit: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] chat-edit error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/feature-history/upscale/:userId
 * Upscale (image enhancement) history from upscale_generations
 */
router.get("/upscale/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching upscale history for user: ${userId}`,
    );

    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("upscale_generations")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"]),
    );

    if (countError) {
      console.error("❌ [FEATURE-HISTORY] upscale count error:", countError);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    const { data, error } = await retryQuery(() =>
      supabase
        .from("upscale_generations")
        .select(
          `id, user_id, status, original_image_url, result_image_url, original_size_bytes, result_size_bytes, scale, credits_cost, credit_balance_before, credit_balance_after, created_at`,
        )
        .in("user_id", memberIds)
        .in("status", ["completed", "failed"])
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error("❌ [FEATURE-HISTORY] upscale query error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] upscale: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] upscale error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/feature-history/ecommerce-kits/:userId
 * E-commerce kits history from product_kits table
 */
router.get("/ecommerce-kits/:userId", async (req, res) => {
  try {
    const setup = await setupRequest(req);
    if (setup.error)
      return res.status(400).json({ success: false, message: setup.error });

    const { userId, parsedLimit, parsedPage, offset, memberIds, isTeamMember, ascending } =
      setup;

    logger.log(
      `📊 [FEATURE-HISTORY] Fetching ecommerce-kits history for user: ${userId}`,
    );

    const { count: totalCount, error: countError } = await retryQuery(() =>
      supabase
        .from("product_kits")
        .select("*", { count: "exact", head: true })
        .in("user_id", memberIds),
    );

    if (countError) {
      console.error(
        "❌ [FEATURE-HISTORY] ecommerce-kits count error:",
        countError,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch count" });
    }

    const { data, error } = await retryQuery(() =>
      supabase
        .from("product_kits")
        .select(
          `id, user_id, generation_id, original_photos, kit_images, processing_time_seconds, total_images_generated, credits_used, is_free_tier, created_at`,
        )
        .in("user_id", memberIds)
        .order("created_at", { ascending })
        .range(offset, offset + parsedLimit - 1),
    );

    if (error) {
      console.error(
        "❌ [FEATURE-HISTORY] ecommerce-kits query error:",
        error,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch data" });
    }

    logger.log(
      `📊 [FEATURE-HISTORY] ecommerce-kits: ${data?.length || 0} items, total: ${totalCount}`,
    );
    return await buildResponse(
      res,
      data,
      totalCount,
      parsedPage,
      parsedLimit,
      offset,
      isTeamMember,
    );
  } catch (error) {
    console.error("❌ [FEATURE-HISTORY] ecommerce-kits error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
