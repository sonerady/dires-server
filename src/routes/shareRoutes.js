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
 * scope: 'all_history' | 'album' | 'single_item'
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

const VALID_SCOPES = new Set(["all_history", "album", "single_item"]);
const VALID_ITEM_TYPES = new Set([
  "reference_results",
  "pose_change_generations",
  "color_change_generations",
  "back_side_generations",
  "refiner_generations",
  "chat_edit_results",
  "video_generations",
]);

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

    let token = generateToken();
    // Ekstra güvence: çakışma olursa yeniden dene (nanoid 32 char ile çakışma astronomik düşük)
    for (let i = 0; i < 3; i++) {
      const { data: existing } = await supabase
        .from("public_share_tokens")
        .select("id")
        .eq("token", token)
        .maybeSingle();
      if (!existing) break;
      token = generateToken();
    }

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

    if (error) {
      console.error("❌ [SHARE] generate hata:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

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
      return res
        .status(404)
        .json({ success: false, message: "Share link not found or revoked" });
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
        { name: "chat_edit_results", type: "chat_edit_results", urlField: "result_image_url" },
        { name: "video_generations", type: "video_generations", urlField: "result_video_url" },
      ];

      const PER_TABLE = 60;
      const results = await Promise.all(
        tables.map(async (t) => {
          try {
            const { data } = await supabase
              .from(t.name)
              .select(
                `id, user_id, status, created_at, settings, ${t.urlField}, ${
                  t.name === "reference_results" ? "reference_images, location_image, visibility" : ""
                }`.replace(/,\s*$/g, ""),
              )
              .eq("user_id", tokenRow.user_id)
              .in("status", ["completed"])
              .order("created_at", { ascending: false })
              .limit(PER_TABLE);
            return (data || [])
              .filter((row) =>
                t.name === "reference_results" ? row.visibility !== false : true,
              )
              .map((row) => ({
                id: row.id,
                created_at: row.created_at,
                result_image_url:
                  t.urlField === "result_image_url" ? row[t.urlField] : null,
                result_video_url:
                  t.urlField === "result_video_url" ? row[t.urlField] : null,
                reference_images: row.reference_images || null,
                location_image: row.location_image || null,
                settings: row.settings || null,
                item_type: t.type,
              }));
          } catch {
            return [];
          }
        }),
      );

      payload.items = results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        )
        .slice(0, 200); // hard cap
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
