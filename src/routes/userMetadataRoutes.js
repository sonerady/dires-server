// routes/userMetadataRoutes.js
// Lightweight endpoint to keep client-reported metadata fresh on the users table.
// Backwards-compatible: old clients that don't call this endpoint simply leave
// the new columns NULL, which doesn't affect any existing queries or features.

const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");

const ALLOWED_PLATFORMS = new Set(["ios", "android", "web"]);
const ALLOWED_THEMES = new Set(["light", "dark"]);

router.post("/update-metadata", async (req, res) => {
  try {
    const { userId, appVersion, platform, themeMode } = req.body || {};

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const updates = {};
    if (typeof appVersion === "string" && appVersion.length > 0 && appVersion.length <= 32) {
      updates.app_version = appVersion;
    }
    if (typeof platform === "string" && ALLOWED_PLATFORMS.has(platform)) {
      updates.platform = platform;
    }
    if (typeof themeMode === "string" && ALLOWED_THEMES.has(themeMode)) {
      updates.theme_mode = themeMode;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields supplied" });
    }

    updates.metadata_updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId);

    if (error) {
      console.warn("⚠️ [UserMetadata] update error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(200).json({ success: true, updated: Object.keys(updates) });
  } catch (err) {
    console.error("❌ [UserMetadata] unexpected error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
