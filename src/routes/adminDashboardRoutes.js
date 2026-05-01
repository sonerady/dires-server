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
  videos: {
    table: "video_generations",
    select:
      "id, user_id, status, original_image_url, result_video_url, user_prompt, enhanced_prompt, duration, aspect_ratio, credits_used, error_message, processing_time_seconds, created_at",
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
          .select("id, email, credit_balance, theme_mode, platform, app_version")
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
            user_theme_mode: user.theme_mode || null,
            user_platform: user.platform || null,
            user_app_version: user.app_version || null,
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
        "id, email, credit_balance, is_pro, subscription_type, supabase_user_id, created_at, theme_mode, platform, app_version",
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

// ─────────────────────────────────────────────────────────────
// ALBUMS — list albums with owner email + latest share link
// ─────────────────────────────────────────────────────────────

const WEB_APP_URL = process.env.WEB_APP_URL || "https://app.diress.ai";

// GET /api/admin-dashboard/album-users?page=1&limit=30&search=
// Albümü olan kullanıcıları kart-grid için döndürür: her kullanıcı için
// albums_count + latest_album_cover + latest_album_at
router.get("/album-users", async (req, res) => {
  try {
    const { page = 1, limit = 30, search = "" } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 200);
    const offset = (pageNum - 1) * limitNum;
    const trimmedSearch = String(search || "").trim().toLowerCase();

    // Tüm albümleri çek — JS'te user_id'ye göre grupla (admin dashboard için OK).
    const { data: allAlbums, error: albumsErr } = await db
      .from("user_albums")
      .select("id, user_id, cover_image_url, name, created_at")
      .order("created_at", { ascending: false });
    if (albumsErr) throw albumsErr;

    // user_id → { albums_count, latest_cover, latest_at, latest_name, latest_album_id }
    const userMap = {};
    (allAlbums || []).forEach((a) => {
      if (!a.user_id) return;
      if (!userMap[a.user_id]) {
        userMap[a.user_id] = {
          user_id: a.user_id,
          albums_count: 0,
          latest_album_id: null,
          latest_album_cover_url: null,
          latest_album_name: null,
          latest_album_at: null,
        };
      }
      userMap[a.user_id].albums_count += 1;
      if (
        !userMap[a.user_id].latest_album_at ||
        a.created_at > userMap[a.user_id].latest_album_at
      ) {
        userMap[a.user_id].latest_album_at = a.created_at;
        userMap[a.user_id].latest_album_id = a.id;
        userMap[a.user_id].latest_album_cover_url = a.cover_image_url;
        userMap[a.user_id].latest_album_name = a.name;
      }
    });

    let users = Object.values(userMap).sort(
      (a, b) => new Date(b.latest_album_at) - new Date(a.latest_album_at),
    );

    // Email + plan + credit fetch (gruplanmış user_id'ler için)
    const allUserIds = users.map((u) => u.user_id);
    const dbUserMap = {};
    if (allUserIds.length > 0) {
      const { data: dbUsers } = await db
        .from("users")
        .select("id, email, is_pro, credit_balance")
        .in("id", allUserIds);
      (dbUsers || []).forEach((u) => {
        dbUserMap[u.id] = u;
      });
    }
    users = users.map((u) => ({
      ...u,
      email: dbUserMap[u.user_id]?.email || null,
      is_pro: dbUserMap[u.user_id]?.is_pro ?? null,
      credit_balance: dbUserMap[u.user_id]?.credit_balance ?? null,
    }));

    // Search: email VEYA latest_album_name içinde
    if (trimmedSearch) {
      users = users.filter((u) => {
        const email = (u.email || "").toLowerCase();
        const albumName = (u.latest_album_name || "").toLowerCase();
        return email.includes(trimmedSearch) || albumName.includes(trimmedSearch);
      });
    }

    const total = users.length;
    let paged = users.slice(offset, offset + limitNum);

    // Sayfalanan kullanıcıların en yeni albümünün son item URL'ini çek;
    // kullanıcı kartının kapağı: latest_album_item_url || latest_album_cover_url
    const pagedAlbumIds = paged
      .map((u) => u.latest_album_id)
      .filter(Boolean);
    if (pagedAlbumIds.length > 0) {
      const { data: latestItems } = await db
        .from("album_items")
        .select("album_id, snapshot_result_url, added_at")
        .in("album_id", pagedAlbumIds)
        .order("added_at", { ascending: false });
      const albumLatestItemMap = {};
      (latestItems || []).forEach((it) => {
        if (!albumLatestItemMap[it.album_id] && it.snapshot_result_url) {
          albumLatestItemMap[it.album_id] = it.snapshot_result_url;
        }
      });
      paged = paged.map((u) => ({
        ...u,
        latest_album_item_url: albumLatestItemMap[u.latest_album_id] || null,
        // Kart kapağı: önce son item, yoksa manuel cover
        display_cover_url:
          albumLatestItemMap[u.latest_album_id] || u.latest_album_cover_url || null,
      }));
    }

    res.json({
      success: true,
      data: paged,
      total,
      page: pageNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    });
  } catch (error) {
    console.error("[Admin/AlbumUsers] Full error:", JSON.stringify(error, null, 2));
    const msg =
      error.message || error.details || error.hint || error.code || JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/admin-dashboard/albums?page=1&limit=30&search=&user_id=
router.get("/albums", async (req, res) => {
  try {
    const { page = 1, limit = 30, search = "", user_id = "" } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 200);
    const offset = (pageNum - 1) * limitNum;

    let query = db
      .from("user_albums")
      .select("id, user_id, name, description, cover_image_url, created_at", {
        count: "estimated",
      })
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      query = query.ilike("name", `%${trimmedSearch}%`);
    }

    // user_id filter — drill-down için (bir kullanıcının tüm albümleri)
    const trimmedUserId = String(user_id || "").trim();
    if (trimmedUserId) {
      query = query.eq("user_id", trimmedUserId);
    }

    const { data: albums, count, error } = await query;
    if (error) {
      console.error("[Admin/Albums] Query error:", JSON.stringify(error, null, 2));
      throw error;
    }

    const list = albums || [];
    let enriched = list;

    if (list.length > 0) {
      const albumIds = list.map((a) => a.id);
      const userIds = [...new Set(list.map((a) => a.user_id).filter(Boolean))];

      // Owner emails
      const userMap = {};
      if (userIds.length > 0) {
        const { data: users } = await db
          .from("users")
          .select("id, email, credit_balance, is_pro")
          .in("id", userIds);
        (users || []).forEach((u) => {
          userMap[u.id] = u;
        });
      }

      // Item counts + latest item URL per album (kapak için en son eklenen
      // resim — kullanıcı manuel cover_image_url set etmediyse fallback olur)
      const itemCountMap = {};
      const latestItemUrlMap = {};
      const { data: items } = await db
        .from("album_items")
        .select("album_id, snapshot_result_url, added_at")
        .in("album_id", albumIds)
        .order("added_at", { ascending: false });
      (items || []).forEach((it) => {
        itemCountMap[it.album_id] = (itemCountMap[it.album_id] || 0) + 1;
        if (!latestItemUrlMap[it.album_id] && it.snapshot_result_url) {
          latestItemUrlMap[it.album_id] = it.snapshot_result_url;
        }
      });

      // Active album-scope share tokens (latest first); pick first per album
      const tokenMap = {};
      const { data: tokens } = await db
        .from("public_share_tokens")
        .select("album_id, token, is_active, created_at, expires_at, access_count")
        .eq("scope", "album")
        .eq("is_active", true)
        .in("album_id", albumIds)
        .order("created_at", { ascending: false });
      (tokens || []).forEach((t) => {
        if (!tokenMap[t.album_id]) tokenMap[t.album_id] = t;
      });

      enriched = list.map((a) => {
        const owner = userMap[a.user_id] || {};
        const tok = tokenMap[a.id] || null;
        const latestItemUrl = latestItemUrlMap[a.id] || null;
        return {
          ...a,
          owner_email: owner.email || null,
          owner_credit_balance: owner.credit_balance ?? null,
          owner_is_pro: owner.is_pro ?? null,
          item_count: itemCountMap[a.id] || 0,
          latest_item_url: latestItemUrl,
          // Kapak: önce manuel cover, yoksa son item — frontend tek alanla render edebilir
          display_cover_url: a.cover_image_url || latestItemUrl,
          latest_share_token: tok ? tok.token : null,
          latest_share_url: tok ? `${WEB_APP_URL}/share/${tok.token}` : null,
          latest_share_created_at: tok ? tok.created_at : null,
          latest_share_expires_at: tok ? tok.expires_at : null,
          latest_share_access_count: tok ? tok.access_count : null,
        };
      });
    }

    res.json({
      success: true,
      data: enriched,
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error) {
    console.error("[Admin/Albums] Full error:", JSON.stringify(error, null, 2));
    const msg =
      error.message ||
      error.details ||
      error.hint ||
      error.code ||
      JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/admin-dashboard/albums/:id/items — list items inside an album
router.get("/albums/:id/items", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: "album id required" });
    }

    const { data: album, error: albumErr } = await db
      .from("user_albums")
      .select("id, user_id, name, description, cover_image_url, created_at")
      .eq("id", id)
      .single();
    if (albumErr || !album) {
      return res.status(404).json({ success: false, error: "album not found" });
    }

    const { data: rawItems, error: itemsErr } = await db
      .from("album_items")
      .select(
        "id, album_id, item_type, item_id, snapshot_result_url, snapshot_reference_url, snapshot_location_url, snapshot_prompt, snapshot_settings, custom_label, sort_order, added_at"
      )
      .eq("album_id", id)
      .order("sort_order", { ascending: true })
      .order("added_at", { ascending: false });

    if (itemsErr) throw itemsErr;

    // Frontend uyumluluğu için alias alanlar (snapshot_image_url, snapshot_meta vb.)
    const items = (rawItems || []).map((it) => ({
      ...it,
      snapshot_image_url: it.snapshot_result_url,
      snapshot_thumb_url: it.snapshot_result_url,
      snapshot_meta: it.snapshot_settings,
    }));

    const { data: tokens } = await db
      .from("public_share_tokens")
      .select("id, scope, item_type, item_id, token, is_active, created_at, expires_at, access_count")
      .eq("album_id", id)
      .order("created_at", { ascending: false });

    const shareTokens = (tokens || []).map((t) => ({
      ...t,
      url: `${WEB_APP_URL}/share/${t.token}`,
    }));

    let owner = null;
    if (album.user_id) {
      const { data: u } = await db
        .from("users")
        .select("id, email, credit_balance, is_pro")
        .eq("id", album.user_id)
        .single();
      owner = u || null;
    }

    res.json({
      success: true,
      album,
      owner,
      items: items || [],
      share_tokens: shareTokens,
    });
  } catch (error) {
    console.error("[Admin/Albums/items] Full error:", JSON.stringify(error, null, 2));
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
