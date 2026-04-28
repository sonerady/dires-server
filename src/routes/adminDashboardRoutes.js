const express = require("express");
const router = express.Router();
const { supabaseAdmin, supabase } = require("../supabaseClient");
const db = supabaseAdmin || supabase;

if (!supabaseAdmin) {
  console.warn(
    "⚠️  [AdminDashboard] SUPABASE_SERVICE_ROLE_KEY eksik — anon client kullanılıyor. RLS devrede olduğundan tüm kullanıcıların verileri görünmeyebilir. .env'e SUPABASE_SERVICE_ROLE_KEY ekleyin."
  );
}

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
  "street-icon-kits": {
    table: "product_street_icon_kits",
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
    // count: "estimated" kullanıyoruz çünkü reference_results gibi büyük tablolarda
    // settings->gender IS NOT NULL gibi JSON path filter'la "exact" count timeout oluyor (code 57014).
    // "estimated" Postgres planner tahminini kullanır, milisaniyelerde döner.
    let query = db
      .from(config.table)
      .select("*", { count: "estimated" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (config.applyFilter) query = config.applyFilter(query);
    // Skip status filter for tables that don't have a status column
    const noStatusTables = ["product_stories", "product_unboxing_stories", "product_kits", "product_street_icon_kits"];
    if (!noStatusTables.includes(config.table)) {
      if (status && status !== "all") {
        query = query.eq("status", status);
      } else {
        // "all" → client ile eşleşmek için completed + failed (CreateModelHistoryScreen mantığı)
        query = query.in("status", ["completed", "failed"]);
      }
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

// ─────────────────────────────────────────────────────────────
// USERS — list + credit adjustment (admin)
// ─────────────────────────────────────────────────────────────

// GET /api/admin-dashboard/users?page=1&limit=30&search=&sort=created_at
router.get("/users", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      search = "",
      sort = "created_at",
      direction = "desc",
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 200);
    const offset = (pageNum - 1) * limitNum;

    const allowedSort = new Set([
      "created_at",
      "email",
      "credit_balance",
      "is_pro",
    ]);
    const sortCol = allowedSort.has(sort) ? sort : "created_at";
    const ascending = direction === "asc";

    let query = db
      .from("users")
      .select(
        "id, email, credit_balance, is_pro, subscription_type, supabase_user_id, created_at",
        { count: "estimated" },
      )
      .order(sortCol, { ascending })
      .range(offset, offset + limitNum - 1);

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      // email veya id üzerinde partial match
      query = query.or(
        `email.ilike.%${trimmedSearch}%,id.eq.${trimmedSearch},supabase_user_id.eq.${trimmedSearch}`,
      );
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("[Admin/Users] Query error:", JSON.stringify(error, null, 2));
      throw error;
    }

    res.json({
      success: true,
      data: data || [],
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error) {
    console.error("[Admin/Users] Full error:", JSON.stringify(error, null, 2));
    const msg =
      error.message ||
      error.details ||
      error.hint ||
      error.code ||
      JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/admin-dashboard/users/:id/credits
// Body: { mode: "add" | "subtract" | "set", amount: number, reason?: string }
router.post("/users/:id/credits", async (req, res) => {
  try {
    const { id } = req.params;
    const { mode = "add", amount, reason = "" } = req.body || {};

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return res
        .status(400)
        .json({ success: false, error: "amount must be a non-negative number" });
    }
    if (!["add", "subtract", "set"].includes(mode)) {
      return res.status(400).json({ success: false, error: "invalid mode" });
    }
    if (!id) {
      return res.status(400).json({ success: false, error: "user id required" });
    }

    // Fetch current balance
    const { data: user, error: fetchErr } = await db
      .from("users")
      .select("id, email, credit_balance")
      .eq("id", id)
      .single();

    if (fetchErr || !user) {
      return res
        .status(404)
        .json({ success: false, error: "User not found" });
    }

    const current = Number(user.credit_balance) || 0;
    let newBalance;
    if (mode === "add") newBalance = current + amountNum;
    else if (mode === "subtract") newBalance = Math.max(0, current - amountNum);
    else newBalance = amountNum; // set

    const { data: updated, error: updErr } = await db
      .from("users")
      .update({ credit_balance: newBalance })
      .eq("id", id)
      .select("id, email, credit_balance, is_pro")
      .single();

    if (updErr) {
      console.error("[Admin/Users] Update error:", JSON.stringify(updErr, null, 2));
      throw updErr;
    }

    console.log(
      `💰 [Admin] ${user.email || id} credit ${mode}: ${current} → ${newBalance} (Δ ${mode === "set" ? `=${amountNum}` : `${mode === "add" ? "+" : "-"}${amountNum}`})${reason ? ` — reason: ${reason}` : ""}`,
    );

    res.json({
      success: true,
      user: updated,
      previous_balance: current,
      new_balance: newBalance,
      delta:
        mode === "set"
          ? newBalance - current
          : mode === "add"
            ? amountNum
            : -amountNum,
    });
  } catch (error) {
    console.error("[Admin/Users] Credit update error:", JSON.stringify(error, null, 2));
    const msg =
      error.message ||
      error.details ||
      error.hint ||
      error.code ||
      JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

module.exports = router;
