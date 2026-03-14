const express = require("express");
const router = express.Router();
const { supabaseAdmin, supabase } = require("../supabaseClient");
const db = supabaseAdmin || supabase;

const FEATURE_CONFIG = {
  "virtual-model": {
    table: "reference_results",
    select:
      "id, user_id, generation_id, status, result_image_url, reference_images, location_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits",
    applyFilter: (query) =>
      query.not("settings->gender", "is", null).eq("visibility", true),
  },
  refiner: {
    table: "refiner_generations",
    select:
      "id, user_id, generation_id, status, original_prompt, enhanced_prompt, original_image_url, result_image_url, settings, aspect_ratio, quality_version, credits_used, processing_time_seconds, created_at",
    applyFilter: null,
  },
  "pose-change": {
    table: "reference_results",
    select:
      "id, user_id, generation_id, status, result_image_url, reference_images, location_image, pose_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits",
    applyFilter: (query) =>
      query.not("settings->pose", "is", null).eq("visibility", true),
  },
  "color-change": {
    table: "reference_results",
    select:
      "id, user_id, generation_id, status, result_image_url, reference_images, location_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits",
    applyFilter: (query) =>
      query.not("settings->productColor", "is", null).eq("visibility", true),
  },
  "back-side": {
    table: "reference_results",
    select:
      "id, user_id, generation_id, status, result_image_url, reference_images, location_image, aspect_ratio, created_at, credits_before_generation, credits_deducted, credits_after_generation, settings, quality_version, kits",
    applyFilter: (query) =>
      query
        .contains("settings", { isBackSideCloset: true })
        .eq("visibility", true),
  },
  "chat-edit": {
    table: "chat_edits",
    select:
      "id, user_id, status, user_prompt, enhanced_prompt, original_image_url, result_image_url, masked_image_url, selection_count, aspect_ratio, credits_cost, credit_balance_before, credit_balance_after, created_at",
    applyFilter: null,
  },
  upscale: {
    table: "upscale_generations",
    select:
      "id, user_id, status, original_image_url, result_image_url, original_size_bytes, result_size_bytes, scale, credits_cost, credit_balance_before, credit_balance_after, created_at",
    applyFilter: null,
  },
  "ecommerce-kits": {
    table: "product_kits",
    select:
      "id, user_id, generation_id, original_photos, kit_images, processing_time_seconds, total_images_generated, credits_used, is_free_tier, created_at",
    applyFilter: null,
  },
  "product-stories": {
    table: "product_stories",
    select:
      "id, user_id, generation_id, original_photos, story_images, processing_time_seconds, total_images_generated, credits_used, is_free_tier, created_at",
    applyFilter: null,
  },
  "unboxing-stories": {
    table: "product_unboxing_stories",
    select:
      "id, user_id, generation_id, original_photos, story_images, processing_time_seconds, total_images_generated, credits_used, is_free_tier, created_at",
    applyFilter: null,
  },
};

router.get("/generations", async (req, res) => {
  try {
    const {
      feature = "virtual-model",
      page = 1,
      limit = 20,
      status = "all",
    } = req.query;

    console.log("[Admin] Query:", { feature, page, limit, status });

    const config = FEATURE_CONFIG[feature];
    if (!config) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid feature" });
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    // Single query for both data and count
    let query = db
      .from(config.table)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (config.applyFilter) query = config.applyFilter(query);
    // Skip status filter for tables that don't have a status column
    const noStatusTables = ["product_stories", "product_unboxing_stories", "product_kits"];
    if (status && status !== "all" && !noStatusTables.includes(config.table)) {
      query = query.eq("status", status);
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("[Admin] Query error:", JSON.stringify(error, null, 2));
      throw error;
    }

    console.log("[Admin] Success - rows:", data?.length, "total:", count);

    // Enrich with user info (email, credit_balance) for all features
    let enrichedData = data || [];
    if (enrichedData.length > 0) {
      const userIds = [...new Set(enrichedData.map(d => d.user_id).filter(Boolean))];
      if (userIds.length > 0) {
        const { data: users } = await db
          .from("users")
          .select("id, email, credit_balance")
          .in("id", userIds);

        const userMap = {};
        (users || []).forEach(u => { userMap[u.id] = u; });

        // For unboxing-stories, also fetch brand preferences
        let unboxingPrefsMap = {};
        if (feature === "unboxing-stories") {
          const { data: prefs } = await db
            .from("user_unboxing_preferences")
            .select("user_id, brand_name, brand_logo_url, custom_package_url")
            .in("user_id", userIds);
          (prefs || []).forEach(p => { unboxingPrefsMap[p.user_id] = p; });
        }

        enrichedData = enrichedData.map(item => {
          const user = userMap[item.user_id] || {};
          const result = {
            ...item,
            user_email: user.email || null,
            user_credit_balance: user.credit_balance ?? null,
          };
          if (feature === "unboxing-stories") {
            const pref = unboxingPrefsMap[item.user_id] || {};
            result.brand_name = pref.brand_name || null;
            result.brand_logo_url = pref.brand_logo_url || null;
            result.custom_package_url = pref.custom_package_url || null;
          }
          return result;
        });
      }
    }

    res.json({
      success: true,
      data: enrichedData,
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error) {
    console.error("[Admin] Full error:", JSON.stringify(error, null, 2));
    const msg = error.message || error.details || error.hint || error.code || JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

module.exports = router;
