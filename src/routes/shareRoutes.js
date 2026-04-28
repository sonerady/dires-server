/**
 * 🔗 Share Routes
 *
 * Token-based public sharing — kullanıcı history'sini / bir albümünü / tek bir
 * resmi tarayıcıda açan link üretir, link login'siz erişilir.
 *
 * Endpoints:
 *   POST   /api/share/generate            — yeni token oluştur, { token, url } döner
 *   GET    /api/share/list/:userId        — kullanıcının aktif token listesi
 *   DELETE /api/share/:tokenId            — token revoke (is_active=false)
 *   GET    /api/public/share/:token       — PUBLIC, no auth — paylaşılan içeriği döner
 *
 * scope: 'all_history' | 'albums' | 'album' | 'single_item'
 *
 * URL formatı: <WEB_APP_URL>/share/<token>
 *   WEB_APP_URL env'de tanımlı (default: https://app.diress.ai)
 */

const express = require("express");
const { customAlphabet } = require("nanoid");
const { supabase } = require("../supabaseClient");

const router = express.Router();

// URL-safe token (32 char, [A-Za-z0-9_-])
const generateToken = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  32,
);

const WEB_APP_URL = process.env.WEB_APP_URL || "https://app.diress.ai";

const VALID_SCOPES = new Set(["all_history", "albums", "album", "single_item"]);
const VALID_ITEM_TYPES = new Set([
  "reference_results",
  "pose_change_generations",
  "color_change_generations",
  "back_side_generations",
  "refiner_generations",
  "chat_edit_results",
  "video_generations",
]);
const MISSING_HISTORY_TABLES = new Set();

const isMissingRelationError = (message = "") =>
  /relation .* does not exist/i.test(message);

const isMissingColumnError = (message = "", columnName = "") =>
  !!columnName && new RegExp(`column .*\\.${columnName} .* does not exist`, "i").test(message);

const buildHistorySelect = ({ urlField, includeReferenceFields = false, includeSettings = true }) =>
  [
    "id",
    "user_id",
    "status",
    "created_at",
    includeSettings ? "settings" : null,
    urlField,
    includeReferenceFields ? "reference_images" : null,
    includeReferenceFields ? "location_image" : null,
    includeReferenceFields ? "visibility" : null,
  ]
    .filter(Boolean)
    .join(", ");

const fetchSharedHistoryTable = async (tableConfig, userId, limit) => {
  if (MISSING_HISTORY_TABLES.has(tableConfig.name)) {
    return [];
  }

  const runQuery = async (includeSettings) => {
    const selectClause = buildHistorySelect({
      urlField: tableConfig.urlField,
      includeReferenceFields: tableConfig.name === "reference_results",
      includeSettings,
    });

    return supabase
      .from(tableConfig.name)
      .select(selectClause)
      .eq("user_id", userId)
      .in("status", ["completed"])
      .order("created_at", { ascending: false })
      .limit(limit);
  };

  let { data, error } = await runQuery(true);

  if (error && isMissingRelationError(error.message)) {
    MISSING_HISTORY_TABLES.add(tableConfig.name);
    return [];
  }

  if (error && isMissingColumnError(error.message, "settings")) {
    const retryResult = await runQuery(false);
    data = retryResult.data;
    error = retryResult.error;
  }

  if (error) {
    console.warn(`⚠️ [SHARE] ${tableConfig.name} query hata:`, error.message);
    return [];
  }

  return (data || [])
    .filter((row) =>
      tableConfig.name === "reference_results" ? row.visibility !== false : true,
    )
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      result_image_url:
        tableConfig.urlField === "result_image_url" ? row[tableConfig.urlField] : null,
      result_video_url:
        tableConfig.urlField === "result_video_url" ? row[tableConfig.urlField] : null,
      reference_images: row.reference_images || null,
      location_image: row.location_image || null,
      settings: row.settings || null,
      item_type: tableConfig.type,
    }));
};

const createUniqueShareToken = async () => {
  let token = generateToken();
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await supabase
      .from("public_share_tokens")
      .select("id")
      .eq("token", token)
      .maybeSingle();
    if (!existing) return token;
    token = generateToken();
  }
  return token;
};

const createShareRow = async ({
  userId,
  scope,
  album_id = null,
  item_type = null,
  item_id = null,
  expiresAt = null,
}) => {
  const token = await createUniqueShareToken();
  const { data, error } = await supabase
    .from("public_share_tokens")
    .insert({
      user_id: userId,
      scope,
      album_id,
      item_type,
      item_id,
      token,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
};

// ─────────────────────────────────────────
// POST /api/share/generate
// body: { userId, scope, album_id?, item_type?, item_id?, expires_in_days? }
// ─────────────────────────────────────────
router.post("/share/generate", async (req, res) => {
  try {
    const {
      userId,
      scope,
      album_id = null,
      item_type = null,
      item_id = null,
      expires_in_days = null,
    } = req.body;

    if (!userId || !VALID_SCOPES.has(scope)) {
      return res
        .status(400)
        .json({ success: false, message: "Missing userId or invalid scope" });
    }
    if (scope === "album" && !album_id) {
      return res
        .status(400)
        .json({ success: false, message: "scope=album requires album_id" });
    }
    if (
      scope === "single_item" &&
      (!item_type || !VALID_ITEM_TYPES.has(item_type) || !item_id)
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "scope=single_item requires valid item_type + item_id",
        });
    }

    const expiresAt =
      typeof expires_in_days === "number" && expires_in_days > 0
        ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
        : null;

    const data = await createShareRow({
      userId,
      scope,
      album_id,
      item_type,
      item_id,
      expiresAt,
    });

    return res.json({
      success: true,
      token: data.token,
      tokenId: data.id,
      url: `${WEB_APP_URL}/share/${data.token}`,
      scope: data.scope,
    });
  } catch (err) {
    console.error("❌ [SHARE] generate exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /api/share/list/:userId — kullanıcının aktif token'ları
// ─────────────────────────────────────────
router.get("/share/list/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from("public_share_tokens")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({
      success: true,
      tokens: (data || []).map((t) => ({
        ...t,
        url: `${WEB_APP_URL}/share/${t.token}`,
      })),
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// DELETE /api/share/:tokenId — revoke
// body: { userId }
// ─────────────────────────────────────────
router.delete("/share/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { userId } = req.body;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing userId" });
    }

    const { error } = await supabase
      .from("public_share_tokens")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", tokenId)
      .eq("user_id", userId);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /api/public/share/:token — PUBLIC, no auth
// scope'a göre paylaşılan veriyi döner.
// ─────────────────────────────────────────
router.get("/public/share/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { data: tokenRow, error: tErr } = await supabase
      .from("public_share_tokens")
      .select("*")
      .eq("token", token)
      .eq("is_active", true)
      .single();

    if (tErr || !tokenRow) {
      // Teşhis: token DB'de hiç var mı, yoksa sadece is_active=false mi?
      const { data: anyRow } = await supabase
        .from("public_share_tokens")
        .select("id, is_active, expires_at, created_at, scope")
        .eq("token", token)
        .maybeSingle();
      console.warn(
        `⚠️ [SHARE] public token lookup miss — token=${token} ` +
          `tErr=${tErr?.message || "(none)"} ` +
          `anyRow=${anyRow ? JSON.stringify(anyRow) : "null"} ` +
          `supabaseUrl=${process.env.SUPABASE_URL || "(unset)"}`,
      );
      const reason = anyRow
        ? anyRow.is_active === false
          ? "Share link revoked"
          : "Share link expired or invalid"
        : "Share link not found";
      return res.status(404).json({ success: false, message: reason });
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      return res
        .status(410)
        .json({ success: false, message: "Share link expired" });
    }

    // Access count (best effort, hatayı yutuyoruz)
    supabase
      .from("public_share_tokens")
      .update({
        access_count: (tokenRow.access_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tokenRow.id)
      .then(() => {})
      .catch(() => {});

    // Scope'a göre veri topla
    let payload = { scope: tokenRow.scope };

    if (tokenRow.scope === "all_history") {
      const tables = [
        { name: "reference_results", type: "reference_results", urlField: "result_image_url" },
        { name: "pose_change_generations", type: "pose_change_generations", urlField: "result_image_url" },
        { name: "color_change_generations", type: "color_change_generations", urlField: "result_image_url" },
        { name: "back_side_generations", type: "back_side_generations", urlField: "result_image_url" },
        { name: "refiner_generations", type: "refiner_generations", urlField: "result_image_url" },
        { name: "chat_edits", type: "chat_edit_results", urlField: "result_image_url" },
        { name: "video_generations", type: "video_generations", urlField: "result_video_url" },
      ];

      const PER_TABLE = 60;
      const results = await Promise.all(
        tables.map((t) => fetchSharedHistoryTable(t, tokenRow.user_id, PER_TABLE)),
      );

      payload.items = results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        )
        .slice(0, 200); // hard cap
    } else if (tokenRow.scope === "albums") {
      const { data: albums } = await supabase
        .from("user_albums")
        .select("*")
        .eq("user_id", tokenRow.user_id)
        .order("created_at", { ascending: false });

      const enrichedAlbums = await Promise.all(
        (albums || []).map(async (album) => {
          const { count } = await supabase
            .from("album_items")
            .select("id", { count: "exact", head: true })
            .eq("album_id", album.id);

          let cover = album.cover_image_url;
          if (!cover) {
            const { data: firstItem } = await supabase
              .from("album_items")
              .select("snapshot_result_url")
              .eq("album_id", album.id)
              .order("added_at", { ascending: true })
              .limit(1)
              .maybeSingle();
            cover = firstItem?.snapshot_result_url || null;
          }

          let albumToken = null;
          const { data: existingAlbumToken } = await supabase
            .from("public_share_tokens")
            .select("token")
            .eq("user_id", tokenRow.user_id)
            .eq("scope", "album")
            .eq("album_id", album.id)
            .eq("is_active", true)
            .is("expires_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingAlbumToken?.token) {
            albumToken = existingAlbumToken.token;
          } else {
            try {
              const createdAlbumShare = await createShareRow({
                userId: tokenRow.user_id,
                scope: "album",
                album_id: album.id,
              });
              albumToken = createdAlbumShare.token;
            } catch (shareErr) {
              console.error(
                `❌ [SHARE] album token create hata (${album.id}):`,
                shareErr?.message,
              );
            }
          }

          return {
            ...album,
            item_count: count || 0,
            cover_image_url: cover,
            share_token: albumToken,
            share_url: albumToken ? `${WEB_APP_URL}/share/${albumToken}` : null,
          };
        }),
      );

      payload.albums = enrichedAlbums;
    } else if (tokenRow.scope === "album" && tokenRow.album_id) {
      const { data: album } = await supabase
        .from("user_albums")
        .select("*")
        .eq("id", tokenRow.album_id)
        .single();
      const { data: items } = await supabase
        .from("album_items")
        .select("*")
        .eq("album_id", tokenRow.album_id)
        .order("sort_order", { ascending: true })
        .order("added_at", { ascending: false });
      payload.album = album;
      payload.items = (items || []).map((i) => ({
        id: i.id,
        item_type: i.item_type,
        item_id: i.item_id,
        result_image_url: i.snapshot_result_url,
        reference_image_url: i.snapshot_reference_url,
        location_image_url: i.snapshot_location_url,
        prompt: i.snapshot_prompt,
        settings: i.snapshot_settings,
        custom_label: i.custom_label,
        added_at: i.added_at,
      }));
    } else if (
      tokenRow.scope === "single_item" &&
      tokenRow.item_type &&
      tokenRow.item_id
    ) {
      const { data: row } = await supabase
        .from(tokenRow.item_type)
        .select("*")
        .eq("id", tokenRow.item_id)
        .single();
      payload.item = row || null;
      payload.item_type = tokenRow.item_type;
    }

    return res.json({
      success: true,
      ...payload,
      shared_at: tokenRow.created_at,
    });
  } catch (err) {
    console.error("❌ [SHARE] public fetch exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

module.exports = router;
