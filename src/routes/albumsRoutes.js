/**
 * 📁 Albums Routes
 *
 * History albümleri (kullanıcının isimlendirdiği klasörler) için CRUD.
 * Kullanım: CreateModelHistoryScreen "Albümler" tab'ı + add-to-album action sheet.
 *
 * Endpoints:
 *   POST   /api/albums                       — yeni albüm
 *   GET    /api/albums/:userId               — kullanıcının albüm listesi
 *   GET    /api/albums/detail/:albumId       — albüm + içindeki items
 *   PATCH  /api/albums/:albumId              — yeniden adlandır
 *   DELETE /api/albums/:albumId              — albümü sil (cascade album_items)
 *   POST   /api/albums/:albumId/items        — albüme item ekle
 *   DELETE /api/albums/:albumId/items/:itemId — albümden item çıkar
 *
 * Auth: mevcut history pattern'i ile uyumlu — userId URL/body'den, no JWT.
 * (Web variant /api/albumsWeb/* requireAuth + requireBrowser ile korunabilir.)
 */

const express = require("express");
const { supabase } = require("../supabaseClient");
const {
  optimizeForThumbnail,
  getOriginalForModal,
} = require("../utils/imageOptimizer");

const router = express.Router();

// ─────────────────────────────────────────
// POST /api/albums — yeni albüm oluştur
// body: { userId, name, description? }
// ─────────────────────────────────────────
router.post("/albums", async (req, res) => {
  try {
    const { userId, name, description = null } = req.body;
    if (!userId || !name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Missing userId or name",
      });
    }

    const { data, error } = await supabase
      .from("user_albums")
      .insert({
        user_id: userId,
        name: name.trim().slice(0, 255),
        description: description?.trim()?.slice(0, 2000) || null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("❌ [ALBUMS] insert hata:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, album: data });
  } catch (err) {
    console.error("❌ [ALBUMS] create exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /api/albums/:userId — kullanıcının albümleri (item count ile)
// ─────────────────────────────────────────
router.get("/albums/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const page = parseInt(req.query.page) || 0;
    const offset = page * limit;

    const { data: albums, error } = await supabase
      .from("user_albums")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("❌ [ALBUMS] list hata:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    // Her albüm için item count + ilk item'ın result_url'ini cover olarak ekle
    const enriched = await Promise.all(
      (albums || []).map(async (alb) => {
        const { count } = await supabase
          .from("album_items")
          .select("id", { count: "exact", head: true })
          .eq("album_id", alb.id);

        let cover = alb.cover_image_url;
        if (!cover) {
          const { data: firstItem } = await supabase
            .from("album_items")
            .select("snapshot_result_url")
            .eq("album_id", alb.id)
            .order("added_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          cover = firstItem?.snapshot_result_url || null;
        }

        return {
          ...alb,
          item_count: count || 0,
          cover_image_url: cover,
          cover_image_url_thumbnail: cover ? optimizeForThumbnail(cover) : null,
          cover_image_url_original: cover ? getOriginalForModal(cover) : null,
        };
      }),
    );

    return res.json({ success: true, albums: enriched });
  } catch (err) {
    console.error("❌ [ALBUMS] list exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /api/albums/detail/:albumId — albüm meta + item'lar
// ?limit=50&page=0
// ─────────────────────────────────────────
router.get("/albums/detail/:albumId", async (req, res) => {
  try {
    const { albumId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const page = parseInt(req.query.page) || 0;
    const offset = page * limit;

    const { data: album, error: albErr } = await supabase
      .from("user_albums")
      .select("*")
      .eq("id", albumId)
      .single();

    if (albErr || !album) {
      return res.status(404).json({ success: false, message: "Album not found" });
    }

    const { data: items, error: itemsErr } = await supabase
      .from("album_items")
      .select("*")
      .eq("album_id", albumId)
      .order("sort_order", { ascending: true })
      .order("added_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (itemsErr) {
      console.error("❌ [ALBUMS] detail items hata:", itemsErr.message);
      return res
        .status(500)
        .json({ success: false, message: itemsErr.message });
    }

    return res.json({ success: true, album, items: items || [] });
  } catch (err) {
    console.error("❌ [ALBUMS] detail exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// PATCH /api/albums/:albumId — yeniden adlandır
// body: { userId, name?, description?, cover_image_url? }
// ─────────────────────────────────────────
router.patch("/albums/:albumId", async (req, res) => {
  try {
    const { albumId } = req.params;
    const { userId, name, description, cover_image_url } = req.body;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing userId" });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (typeof name === "string" && name.trim()) {
      updates.name = name.trim().slice(0, 255);
    }
    if (typeof description === "string") {
      updates.description = description.trim().slice(0, 2000) || null;
    }
    if (typeof cover_image_url === "string") {
      updates.cover_image_url = cover_image_url || null;
    }

    const { data, error } = await supabase
      .from("user_albums")
      .update(updates)
      .eq("id", albumId)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
    if (!data) {
      return res.status(404).json({ success: false, message: "Album not found or not owner" });
    }

    return res.json({ success: true, album: data });
  } catch (err) {
    console.error("❌ [ALBUMS] patch exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// DELETE /api/albums/:albumId — albümü sil (cascade album_items)
// body: { userId }
// ─────────────────────────────────────────
router.delete("/albums/:albumId", async (req, res) => {
  try {
    const { albumId } = req.params;
    const { userId } = req.body;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing userId" });
    }

    const { error } = await supabase
      .from("user_albums")
      .delete()
      .eq("id", albumId)
      .eq("user_id", userId);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ [ALBUMS] delete exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /api/albums/:albumId/items — albüme item ekle
// body: {
//   userId,
//   item_type, item_id,
//   snapshot_result_url?, snapshot_reference_url?, snapshot_location_url?,
//   snapshot_prompt?, snapshot_settings?, custom_label?
// }
// ─────────────────────────────────────────
router.post("/albums/:albumId/items", async (req, res) => {
  try {
    const { albumId } = req.params;
    const {
      userId,
      item_type,
      item_id,
      snapshot_result_url = null,
      snapshot_reference_url = null,
      snapshot_location_url = null,
      snapshot_prompt = null,
      snapshot_settings = null,
      custom_label = null,
    } = req.body;

    if (!userId || !item_type || !item_id) {
      return res.status(400).json({
        success: false,
        message: "Missing userId / item_type / item_id",
      });
    }

    // Owner check
    const { data: album, error: albErr } = await supabase
      .from("user_albums")
      .select("id")
      .eq("id", albumId)
      .eq("user_id", userId)
      .single();
    if (albErr || !album) {
      return res
        .status(404)
        .json({ success: false, message: "Album not found or not owner" });
    }

    const { data, error } = await supabase
      .from("album_items")
      .insert({
        album_id: albumId,
        item_type,
        item_id,
        snapshot_result_url,
        snapshot_reference_url,
        snapshot_location_url,
        snapshot_prompt,
        snapshot_settings,
        custom_label,
      })
      .select("*")
      .single();

    if (error) {
      // UNIQUE violation → item zaten albümde
      if (error.code === "23505") {
        return res.json({ success: true, alreadyExists: true });
      }
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, item: data });
  } catch (err) {
    console.error("❌ [ALBUMS] add item exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

// ─────────────────────────────────────────
// DELETE /api/albums/:albumId/items/:itemId — albümden item çıkar
// ─────────────────────────────────────────
router.delete("/albums/:albumId/items/:itemId", async (req, res) => {
  try {
    const { albumId, itemId } = req.params;
    const { error } = await supabase
      .from("album_items")
      .delete()
      .eq("album_id", albumId)
      .eq("id", itemId);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ [ALBUMS] remove item exception:", err?.message);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Server error" });
  }
});

module.exports = router;
