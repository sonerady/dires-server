const express = require("express");
const router = express.Router();
const { supabaseAdmin, supabase } = require("../supabaseClient");
const {
  optimizeForThumbnail,
  getOriginalForModal,
  optimizeHistoryImages,
} = require("../utils/imageOptimizer");
const db = supabaseAdmin || supabase;

// Enrich a kit-style row (product_kits / product_stories / product_unboxing_stories)
// by transforming each JSONB image array element into { url, thumbnail, original }.
function enrichKitImageArray(raw) {
  if (!Array.isArray(raw)) return raw;
  return raw.map((entry) => {
    if (typeof entry === "string") {
      return {
        url: entry,
        thumbnail: optimizeForThumbnail(entry),
        original: getOriginalForModal(entry),
      };
    }
    if (entry && typeof entry === "object") {
      const obj = entry;
      const url =
        obj.url ||
        obj.image_url ||
        obj.imageUrl ||
        obj.uri ||
        obj.signedUrl ||
        obj.signed_url ||
        obj.public_url ||
        obj.publicUrl ||
        obj.src ||
        null;
      if (url) {
        return {
          ...obj,
          url,
          thumbnail: optimizeForThumbnail(url),
          original: getOriginalForModal(url),
        };
      }
    }
    return entry;
  });
}

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
      user_id = "",
    } = req.query;

    console.log("[Admin] Query:", { feature, page, limit, status, user_id });

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
    if (user_id) {
      query = query.eq("user_id", String(user_id));
    }
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
          .select("id, email, is_pro, is_in_trial, trial_started_at, credit_balance, theme_mode, platform, app_version")
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
            user_is_pro: user.is_pro ?? false,
            user_is_in_trial: user.is_in_trial ?? false,
            user_trial_started_at: user.trial_started_at || null,
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
            result.brand_logo_url_thumbnail = optimizeForThumbnail(pref.brand_logo_url);
            result.custom_package_url_thumbnail = optimizeForThumbnail(pref.custom_package_url);
          }
          // Kit-style features carry generated images in JSONB columns —
          // enrich each entry with .thumbnail/.original so the admin UI
          // doesn't have to download full-resolution images for cards.
          if (feature === "ecommerce-kits" && result.kit_images) {
            result.kit_images = enrichKitImageArray(result.kit_images);
          }
          if (
            (feature === "product-stories" || feature === "unboxing-stories") &&
            result.story_images
          ) {
            result.story_images = enrichKitImageArray(result.story_images);
          }
          // original_photos is a text[] of source URLs — wrap with thumbnails too
          if (Array.isArray(result.original_photos)) {
            result.original_photos_thumbnails = result.original_photos.map(
              optimizeForThumbnail,
            );
          }
          return result;
        });
      }

      // For non-kit features (virtual-model, pose-change, color-change,
      // back-side, refiner, chat-edit, upscale, videos) the row has
      // result_image_url / reference_images / location_image / etc — let
      // optimizeHistoryImages add the *_thumbnail variants.
      const kitFeatures = new Set([
        "ecommerce-kits",
        "product-stories",
        "unboxing-stories",
        "street-icon-kits",
      ]);
      if (!kitFeatures.has(feature)) {
        enrichedData = optimizeHistoryImages(enrichedData);
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

    const USER_SELECT = [
      "id",
      "supabase_user_id",
      "email",
      "full_name",
      "company_name",
      "avatar_url",
      "credit_balance",
      "is_pro",
      "subscription_type",
      "auth_provider",
      "owner",
      "device_id",
      "received_initial_credit",
      "initial_credit_date",
      "created_at",
      "updated_at",
      "web_session_version",
      "mobile_session_version",
      "last_web_login",
      "last_mobile_login",
      "is_in_trial",
      "has_used_trial",
      "trial_started_at",
      "active_team_id",
      "team_max_members",
      "team_subscription_active",
      "platform",
      "app_version",
      "theme_mode",
      "metadata_updated_at",
    ].join(", ");

    let query = db
      .from("users")
      .select(USER_SELECT, { count: "estimated" })
      .order(sortCol, { ascending })
      .range(offset, offset + limitNum - 1);

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      // PostgREST .or() uses commas as separator — strip them so they don't
      // break the filter. Also: id/supabase_user_id are UUID columns; comparing
      // them to a non-UUID string throws "invalid input syntax for type uuid"
      // and fails the whole query. Only include those clauses when the search
      // string looks like a full UUID.
      const safe = trimmedSearch.replace(/,/g, "");
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          safe,
        );

      const clauses = [
        `email.ilike.%${safe}%`,
        `full_name.ilike.%${safe}%`,
        `company_name.ilike.%${safe}%`,
      ];
      if (isUuid) {
        clauses.push(`id.eq.${safe}`);
        clauses.push(`supabase_user_id.eq.${safe}`);
      }
      query = query.or(clauses.join(","));
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
        .select("id, email, is_pro, is_in_trial, trial_started_at, credit_balance")
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

// GET /api/admin-dashboard/albums/users?page=1&limit=30&search=
// Album sahiplerini tek satırda gruplar: her satır bir kullanıcıdır,
// kullanıcının kaç albümü olduğu, en son aktivite resmi (latest item across
// all of their albums), email + PRO bilgisi ile birlikte döner.
// Search: email ile partial match.
router.get("/albums/users", async (req, res) => {
  try {
    const { page = 1, limit = 30, search = "" } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 200);
    const offset = (pageNum - 1) * limitNum;

    // 1) Tüm albümleri sadece grouping için gerekli alanlarla çek.
    //    Admin volume düşük; tüm tabloyu memory'de toplamak güvenli.
    const { data: allAlbums, error: albumsErr } = await db
      .from("user_albums")
      .select("id, user_id, created_at");
    if (albumsErr) throw albumsErr;

    // 2) user_id bazında grupla, en son album_created_at'i tut.
    const byUser = new Map();
    const albumToUser = {};
    (allAlbums || []).forEach((a) => {
      if (!a.user_id) return;
      albumToUser[a.id] = a.user_id;
      const prev = byUser.get(a.user_id);
      if (!prev) {
        byUser.set(a.user_id, {
          user_id: a.user_id,
          album_count: 1,
          album_ids: [a.id],
          latest_album_at: a.created_at,
        });
      } else {
        prev.album_count += 1;
        prev.album_ids.push(a.id);
        if (new Date(a.created_at) > new Date(prev.latest_album_at)) {
          prev.latest_album_at = a.created_at;
        }
      }
    });

    let userRows = Array.from(byUser.values());

    // 3) Search (email) — full user list'i çek ve filter et.
    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      // Önce search'e uyan user_id'leri bul, sonra userRows'u filtrele
      const { data: matchedUsers } = await db
        .from("users")
        .select("id")
        .ilike("email", `%${trimmedSearch}%`);
      const matchedIds = new Set((matchedUsers || []).map((u) => u.id));
      userRows = userRows.filter((u) => matchedIds.has(u.user_id));
    }

    // 4) En yeni aktiviteye göre sırala (üstte en aktifler).
    userRows.sort(
      (a, b) => new Date(b.latest_album_at) - new Date(a.latest_album_at)
    );

    const total = userRows.length;
    const paged = userRows.slice(offset, offset + limitNum);

    if (paged.length === 0) {
      return res.json({
        success: true,
        data: [],
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    }

    // 5) Profiles (email + pro) — sadece sayfa kullanıcılarını çek
    const pageUserIds = paged.map((u) => u.user_id);
    const { data: profiles } = await db
      .from("users")
      .select("id, email, credit_balance, is_pro")
      .in("id", pageUserIds);
    const profileMap = {};
    (profiles || []).forEach((p) => {
      profileMap[p.id] = p;
    });

    // 6) Sayfa kullanıcılarının tüm albümlerindeki son item'ı bul (cross-album latest).
    const pageAlbumIds = paged.flatMap((u) => u.album_ids);
    const { data: items } = await db
      .from("album_items")
      .select("album_id, snapshot_result_url, added_at")
      .in("album_id", pageAlbumIds)
      .order("added_at", { ascending: false });

    const userLatestItem = {};
    (items || []).forEach((it) => {
      const uid = albumToUser[it.album_id];
      if (uid && !userLatestItem[uid] && it.snapshot_result_url) {
        userLatestItem[uid] = it.snapshot_result_url;
      }
    });

    const data = paged.map((u) => {
      const p = profileMap[u.user_id] || {};
      const latestUrl = userLatestItem[u.user_id] || null;
      return {
        user_id: u.user_id,
        owner_email: p.email || null,
        owner_is_pro: p.is_pro ?? null,
        owner_credit_balance: p.credit_balance ?? null,
        album_count: u.album_count,
        latest_album_at: u.latest_album_at,
        latest_item_url: latestUrl,
        latest_item_url_thumbnail: optimizeForThumbnail(latestUrl),
      };
    });

    res.json({
      success: true,
      data,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error(
      "[Admin/Albums/users] Full error:",
      JSON.stringify(error, null, 2)
    );
    const msg =
      error.message ||
      error.details ||
      error.hint ||
      error.code ||
      JSON.stringify(error);
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
        const displayCover = a.cover_image_url || latestItemUrl;
        return {
          ...a,
          owner_email: owner.email || null,
          owner_credit_balance: owner.credit_balance ?? null,
          owner_is_pro: owner.is_pro ?? null,
          item_count: itemCountMap[a.id] || 0,
          latest_item_url: latestItemUrl,
          latest_item_url_thumbnail: optimizeForThumbnail(latestItemUrl),
          cover_image_url_thumbnail: optimizeForThumbnail(a.cover_image_url),
          // Kapak: önce manuel cover, yoksa son item — frontend tek alanla render edebilir
          display_cover_url: displayCover,
          display_cover_url_thumbnail: optimizeForThumbnail(displayCover),
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
    // + Cloudflare CDN üzerinden küçük thumbnail URL'leri (kart grid için)
    const items = (rawItems || []).map((it) => ({
      ...it,
      snapshot_image_url: it.snapshot_result_url,
      snapshot_thumb_url: it.snapshot_result_url,
      snapshot_image_url_thumbnail: optimizeForThumbnail(it.snapshot_result_url),
      snapshot_reference_url_thumbnail: optimizeForThumbnail(it.snapshot_reference_url),
      snapshot_location_url_thumbnail: optimizeForThumbnail(it.snapshot_location_url),
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

// ─────────────────────────────────────────────────────────────
// POST /api/admin-dashboard/users/:id/pro
// Body: { is_pro: boolean, reason?: string }
// ─────────────────────────────────────────────────────────────
router.post("/users/:id/pro", async (req, res) => {
  try {
    const { id } = req.params;
    const { is_pro, reason = "" } = req.body || {};

    if (typeof is_pro !== "boolean") {
      return res
        .status(400)
        .json({ success: false, error: "is_pro must be a boolean" });
    }
    if (!id) {
      return res.status(400).json({ success: false, error: "user id required" });
    }

    const { data: prev, error: fetchErr } = await db
      .from("users")
      .select("id, email, is_pro")
      .eq("id", id)
      .single();

    if (fetchErr || !prev) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const { data: updated, error: updErr } = await db
      .from("users")
      .update({ is_pro })
      .eq("id", id)
      .select("id, email, is_pro, credit_balance, subscription_type")
      .single();

    if (updErr) {
      console.error("[Admin/Users] PRO toggle error:", JSON.stringify(updErr, null, 2));
      throw updErr;
    }

    const actorEmail = req.adminUser?.email || "unknown-admin";
    console.log(
      `👑 [Admin/${actorEmail}] PRO toggled: ${prev.email || id} ${prev.is_pro} → ${is_pro}${reason ? ` — reason: ${reason}` : ""}`,
    );

    res.json({
      success: true,
      user: updated,
      previous_is_pro: prev.is_pro,
      new_is_pro: is_pro,
    });
  } catch (error) {
    console.error("[Admin/Users] PRO toggle error:", JSON.stringify(error, null, 2));
    const msg =
      error.message || error.details || error.hint || error.code || JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin-dashboard/color-changes
// Lists rows from `color_change_generations` with owner info.
// Query params: page, limit, search, user_id, status
// ─────────────────────────────────────────────────────────────
router.get("/color-changes", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      search = "",
      user_id = "",
      status = "",
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 200);
    const offset = (pageNum - 1) * limitNum;

    let query = db
      .from("color_change_generations")
      .select(
        "id, user_id, generation_id, status, original_prompt, enhanced_prompt, original_image_url, result_image_url, target_color, aspect_ratio, quality_version, fal_request_id, processing_time_seconds, credits_used, settings, created_at",
        { count: "estimated" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (user_id) {
      query = query.eq("user_id", String(user_id));
    }

    if (
      status &&
      ["pending", "processing", "completed", "failed"].includes(String(status))
    ) {
      query = query.eq("status", String(status));
    }

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      // search on generation_id (exact-ish) or fal_request_id
      query = query.or(
        `generation_id.ilike.%${trimmedSearch}%,fal_request_id.ilike.%${trimmedSearch}%,target_color.ilike.%${trimmedSearch}%`,
      );
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("[Admin/ColorChanges] Query error:", JSON.stringify(error, null, 2));
      throw error;
    }

    const rows = data || [];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const userMap = new Map();
    if (userIds.length > 0) {
      const { data: users } = await db
        .from("users")
        .select("id, email, is_pro, is_in_trial, trial_started_at, credit_balance")
        .in("id", userIds);
      (users || []).forEach((u) => userMap.set(u.id, u));
    }

    const enriched = optimizeHistoryImages(
      rows.map((r) => {
        const u = userMap.get(r.user_id);
        return {
          ...r,
          user_email: u?.email ?? null,
          user_is_pro: u?.is_pro ?? false,
          user_is_in_trial: u?.is_in_trial ?? false,
          user_trial_started_at: u?.trial_started_at || null,
          user_credit_balance: u?.credit_balance ?? null,
        };
      }),
    );

    res.json({
      success: true,
      data: enriched,
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error) {
    console.error("[Admin/ColorChanges] Full error:", JSON.stringify(error, null, 2));
    const msg =
      error.message || error.details || error.hint || error.code || JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin-dashboard/refiner
// Lists rows from `refiner_generations` with owner info.
// Query params: page, limit, search, user_id, status
// ─────────────────────────────────────────────────────────────
router.get("/refiner", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      search = "",
      user_id = "",
      status = "",
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 200);
    const offset = (pageNum - 1) * limitNum;

    let query = db
      .from("refiner_generations")
      .select(
        "id, user_id, generation_id, status, original_prompt, enhanced_prompt, original_image_url, result_image_url, aspect_ratio, quality_version, fal_request_id, processing_time_seconds, credits_used, settings, created_at",
        { count: "estimated" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (user_id) {
      query = query.eq("user_id", String(user_id));
    }

    if (
      status &&
      ["pending", "processing", "completed", "failed"].includes(String(status))
    ) {
      query = query.eq("status", String(status));
    }

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      query = query.or(
        `generation_id.ilike.%${trimmedSearch}%,fal_request_id.ilike.%${trimmedSearch}%`,
      );
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("[Admin/Refiner] Query error:", JSON.stringify(error, null, 2));
      throw error;
    }

    const rows = data || [];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const userMap = new Map();
    if (userIds.length > 0) {
      const { data: users } = await db
        .from("users")
        .select("id, email, is_pro, is_in_trial, trial_started_at, credit_balance")
        .in("id", userIds);
      (users || []).forEach((u) => userMap.set(u.id, u));
    }

    const enriched = optimizeHistoryImages(
      rows.map((r) => {
        const u = userMap.get(r.user_id);
        return {
          ...r,
          user_email: u?.email ?? null,
          user_is_pro: u?.is_pro ?? false,
          user_is_in_trial: u?.is_in_trial ?? false,
          user_trial_started_at: u?.trial_started_at || null,
          user_credit_balance: u?.credit_balance ?? null,
        };
      }),
    );

    res.json({
      success: true,
      data: enriched,
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error) {
    console.error("[Admin/Refiner] Full error:", JSON.stringify(error, null, 2));
    const msg =
      error.message || error.details || error.hint || error.code || JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin-dashboard/videos
// Lists rows from `video_generations` with owner info + thumbnail URLs.
// Query params: page, limit, search, user_id, status
// ─────────────────────────────────────────────────────────────
router.get("/videos", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      search = "",
      user_id = "",
      status = "",
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 30, 200);
    const offset = (pageNum - 1) * limitNum;

    let query = db
      .from("video_generations")
      .select(
        "id, user_id, fal_request_id, status, original_image_url, result_video_url, user_prompt, enhanced_prompt, duration, aspect_ratio, credits_used, error_message, processing_time_seconds, created_at",
        { count: "estimated" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (user_id) {
      query = query.eq("user_id", String(user_id));
    }
    if (
      status &&
      ["pending", "processing", "completed", "failed"].includes(String(status))
    ) {
      query = query.eq("status", String(status));
    }

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      query = query.or(
        `fal_request_id.ilike.%${trimmedSearch}%,user_prompt.ilike.%${trimmedSearch}%`,
      );
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("[Admin/Videos] Query error:", JSON.stringify(error, null, 2));
      throw error;
    }

    const rows = data || [];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const userMap = new Map();
    if (userIds.length > 0) {
      const { data: users } = await db
        .from("users")
        .select("id, email, is_pro, is_in_trial, trial_started_at, credit_balance")
        .in("id", userIds);
      (users || []).forEach((u) => userMap.set(u.id, u));
    }

    const enriched = optimizeHistoryImages(
      rows.map((r) => {
        const u = userMap.get(r.user_id);
        return {
          ...r,
          user_email: u?.email ?? null,
          user_is_pro: u?.is_pro ?? false,
          user_is_in_trial: u?.is_in_trial ?? false,
          user_trial_started_at: u?.trial_started_at || null,
          user_credit_balance: u?.credit_balance ?? null,
        };
      }),
    );

    res.json({
      success: true,
      data: enriched,
      total: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum),
    });
  } catch (error) {
    console.error("[Admin/Videos] Full error:", JSON.stringify(error, null, 2));
    const msg =
      error.message || error.details || error.hint || error.code || JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─────────────────────────────────────────────────────────────
// RevenueCat v2 customer helper
// Calls GET /v2/projects/{project_id}/customers/{app_user_id} and extracts
// the minimal subset the admin UI needs. Returns { ok, ... } shape so the
// caller can render gracefully on partial failures.
// ─────────────────────────────────────────────────────────────
const RC_PROJECT_ID = process.env.REVENUECAT_PROJECT_ID || "proj2f06e69e";
const RC_SECRET_KEY =
  process.env.REVENUECAT_SECRET_API_KEY ||
  process.env.REVENUECAT_V2_API_KEY ||
  process.env.REVENUECAT_API_KEY;

async function fetchRevenueCatCustomer(appUserId) {
  if (!RC_SECRET_KEY) {
    return { ok: false, error: "REVENUECAT_API_KEY not configured" };
  }
  if (!appUserId) {
    return { ok: false, error: "Missing app_user_id" };
  }
  const url = `https://api.revenuecat.com/v2/projects/${RC_PROJECT_ID}/customers/${encodeURIComponent(appUserId)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${RC_SECRET_KEY}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `RC ${res.status}: ${text.slice(0, 200) || res.statusText}`,
      };
    }
    const body = await res.json();
    return { ok: true, raw: body, ...extractRevenueCatLite(body) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function extractRevenueCatLite(customer) {
  // RC v2 customer response shape (per docs):
  //   { id, project_id, first_seen_at, last_seen_at, active_entitlements: { items: [...] },
  //     subscriptions: { items: [{ store, product_identifier, period_type, ... }] }, ... }
  if (!customer || typeof customer !== "object") return {};

  const entitlements = Array.isArray(customer?.active_entitlements?.items)
    ? customer.active_entitlements.items.map((e) => e.lookup_key || e.entitlement_id || e.id).filter(Boolean)
    : [];

  const subscriptionItems = Array.isArray(customer?.subscriptions?.items)
    ? customer.subscriptions.items
    : [];

  // Pick the "freshest" subscription (most recent purchase / current period end)
  const sub =
    subscriptionItems.find((s) => s.status === "active" || s.status === "in_trial") ||
    subscriptionItems[0] ||
    null;

  const periodType = sub?.current_period?.type || sub?.period_type || null;
  const isInTrial =
    periodType === "TRIAL" ||
    periodType === "trial" ||
    sub?.status === "in_trial";

  return {
    is_in_trial: Boolean(isInTrial),
    entitlements,
    trial_will_renew: sub?.auto_renewal_status === "WILL_RENEW" || sub?.will_renew === true,
    trial_expires_at:
      sub?.current_period?.expires_at ||
      sub?.expires_date ||
      sub?.expires_at ||
      null,
    subscription: sub
      ? {
          store: sub.store || null,
          product_id: sub.product_identifier || sub.product_id || null,
          status: sub.status || null,
        }
      : null,
  };
}

// Concurrency-limited Promise.all — runs up to `limit` tasks in parallel.
async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        results[idx] = { ok: false, error: err.message || String(err) };
      }
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(runners);
  return results;
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin-dashboard/trials?days=3
// Returns: { summary, cohorts (last N days), active_users (RC-enriched) }
// `days` clamped to [1, 30]; defaults to 3 (matches TRIAL_DURATION_DAYS so
// the admin view shows currently in-progress cohorts).
// ─────────────────────────────────────────────────────────────
const TRIAL_DURATION_DAYS = 3;
const COHORT_DAYS_DEFAULT = 3;
const COHORT_DAYS_MAX = 30;

router.get("/trials", async (req, res) => {
  try {
    const requestedDays = parseInt(req.query.days, 10);
    const cohortDays =
      Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.min(requestedDays, COHORT_DAYS_MAX)
        : COHORT_DAYS_DEFAULT;
    const now = new Date();
    const windowStart = new Date(now.getTime() - cohortDays * 24 * 60 * 60 * 1000);

    // 5 parallel DB queries
    const [
      activeCountRes,
      convertedCountRes,
      expiredCountRes,
      allTimeStartedRes,
      cohortRowsRes,
      activeListRes,
    ] = await Promise.all([
      db.from("users").select("id", { count: "estimated", head: true }).eq("is_in_trial", true),
      // Converted: trial'dan çıkmış (is_in_trial=false) VE PRO. is_in_trial=false
      // şartı şart — çünkü trial sırasında da is_pro=true (watermark kapalı).
      db
        .from("users")
        .select("id", { count: "estimated", head: true })
        .eq("has_used_trial", true)
        .eq("is_pro", true)
        .eq("is_in_trial", false),
      db
        .from("users")
        .select("id", { count: "estimated", head: true })
        .eq("has_used_trial", true)
        .eq("is_pro", false)
        .eq("is_in_trial", false),
      db.from("users").select("id", { count: "estimated", head: true }).eq("has_used_trial", true),
      db
        .from("users")
        .select("id, trial_started_at, is_in_trial, is_pro, has_used_trial")
        .gte("trial_started_at", windowStart.toISOString())
        .order("trial_started_at", { ascending: false })
        .limit(20000),
      db
        .from("users")
        .select(
          "id, supabase_user_id, email, trial_started_at, credit_balance, platform, subscription_type",
        )
        .eq("is_in_trial", true)
        .gte("trial_started_at", windowStart.toISOString())
        .order("trial_started_at", { ascending: false })
        .limit(200),
    ]);

    for (const r of [activeCountRes, convertedCountRes, expiredCountRes, allTimeStartedRes, cohortRowsRes, activeListRes]) {
      if (r.error) throw r.error;
    }

    const active = activeCountRes.count || 0;
    const converted = convertedCountRes.count || 0;
    const expired = expiredCountRes.count || 0;
    const allTimeStarted = allTimeStartedRes.count || 0;
    const conversion = allTimeStarted > 0 ? converted / allTimeStarted : 0;

    // Build cohort buckets for last N days (newest first)
    const cohortMap = new Map();
    const todayKey = ymd(now);
    for (let d = 0; d < cohortDays; d++) {
      const dt = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      cohortMap.set(ymd(dt), {
        date: ymd(dt),
        days_ago: d,
        started: 0,
        converted: 0,
        expired_or_canceled: 0,
        still_active: 0,
        trial_in_progress: d < TRIAL_DURATION_DAYS,
      });
    }
    // Cohort sayım kuralı (önemli):
    //
    // Diress'te TRIAL kullanıcıları da is_pro=true olarak işaretleniyor
    // (watermark kapalı, PRO erişim — webhook v2/v3 line ~783). Bu yüzden
    // `is_pro=true` "converted" anlamına gelmiyor. Kullanıcı trial'dan
    // CIKMIŞ olmalı ve yine ödüyor olmalı.
    //
    //   started            = trial_started_at penceredeyse
    //   still_active       = hâlâ trial içinde (is_in_trial=true)
    //   converted          = trial bitmiş + is_pro=true + has_used_trial=true
    //   expired_or_canceled= trial bitmiş + is_pro=false
    (cohortRowsRes.data || []).forEach((u) => {
      if (!u.trial_started_at) return;
      const key = ymd(new Date(u.trial_started_at));
      const bucket = cohortMap.get(key);
      if (!bucket) return;
      bucket.started++;
      if (u.is_in_trial) {
        bucket.still_active++;
      } else if (u.is_pro && u.has_used_trial) {
        bucket.converted++;
      } else if (u.has_used_trial) {
        bucket.expired_or_canceled++;
      } else {
        // Edge case: trial_started_at set ama has_used_trial=false → veri tutarsız;
        // güvenli tarafta still_active say (kullanıcı görmeyi tercih ederiz).
        bucket.still_active++;
      }
    });
    const cohorts = Array.from(cohortMap.values()).sort((a, b) => a.days_ago - b.days_ago);

    // Build active_users list with computed time fields
    const activeRows = (activeListRes.data || []).map((u) => {
      const startedAtMs = u.trial_started_at ? new Date(u.trial_started_at).getTime() : null;
      const elapsedHours = startedAtMs
        ? Math.max(0, Math.floor((now.getTime() - startedAtMs) / (60 * 60 * 1000)))
        : 0;
      const remainingHours = Math.max(0, TRIAL_DURATION_DAYS * 24 - elapsedHours);
      return {
        id: u.id,
        supabase_user_id: u.supabase_user_id,
        email: u.email,
        trial_started_at: u.trial_started_at,
        elapsed_hours: elapsedHours,
        remaining_hours: remainingHours,
        credit_balance: u.credit_balance,
        platform: u.platform,
        subscription_type: u.subscription_type,
        rc: null,
      };
    });

    // RC enrichment (concurrency-limited)
    if (RC_SECRET_KEY && activeRows.length > 0) {
      const rcResults = await withConcurrency(activeRows, 5, (u) =>
        fetchRevenueCatCustomer(u.id),
      );
      rcResults.forEach((rc, i) => {
        if (rc && rc.raw) {
          const { raw: _raw, ...lite } = rc;
          activeRows[i].rc = lite;
        } else {
          activeRows[i].rc = rc || { ok: false, error: "unknown" };
        }
      });
    }

    // RC tarafında trial'i iptal etmiş (auto-renew kapatmış) kullanıcı sayısı —
    // hâlâ trial'de ama dönüşmeyecek, yenilenmeyecek. `trial_will_renew === false`
    // sinyalini kullanıyoruz (extractRevenueCatLite içinde set ediliyor).
    const rcCanceledInWindow = activeRows.filter(
      (u) => u.rc && u.rc.is_in_trial && u.rc.trial_will_renew === false,
    ).length;

    res.json({
      success: true,
      trial_duration_days: TRIAL_DURATION_DAYS,
      window_days: cohortDays,
      summary: {
        active,
        converted,
        expired_or_canceled: expired,
        all_time_started: allTimeStarted,
        conversion_rate: conversion,
        rc_canceled_in_window: rcCanceledInWindow,
      },
      cohorts,
      active_users: activeRows,
    });
    // referenced for clarity but unused after destructure
    void todayKey;
  } catch (error) {
    console.error("[Admin/Trials] Full error:", JSON.stringify(error, null, 2));
    const msg =
      error.message || error.details || error.hint || error.code || JSON.stringify(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// Returns "YYYY-MM-DD" in UTC.
function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin-dashboard/users/:id/revenuecat
// Per-user RC live state, with the raw response for debugging.
// ─────────────────────────────────────────────────────────────
router.get("/users/:id/revenuecat", async (req, res) => {
  const { id } = req.params;
  const rc = await fetchRevenueCatCustomer(id);
  res.json({ success: rc.ok !== false, ...rc });
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin-dashboard/me
// Returns the authenticated admin user (set by requireAdmin)
// ─────────────────────────────────────────────────────────────
router.get("/me", (req, res) => {
  const admin = req.adminUser;
  if (!admin) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  res.json({
    success: true,
    user: {
      id: admin.id,
      email: admin.email,
      owner: admin.owner === true,
    },
  });
});

module.exports = router;
