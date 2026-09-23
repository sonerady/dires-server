// 🔴 Abonelik durumu (23 Eyl 2026) — anasayfa iptal banner'ı
// GET /api/subscription-status/:userId → { success, cancelBanner: { show, expiresAt, daysLeft }, platform }
const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { cancelBannerState } = require("../utils/revenuecatCancelState");

// Kill switch: app_config.cancel_banner_enabled (varsayılan true); 60 sn önbellek
let bannerEnabled = true;
let bannerCheckedAt = 0;
async function isCancelBannerEnabled() {
  if (Date.now() - bannerCheckedAt < 60000) return bannerEnabled;
  bannerCheckedAt = Date.now();
  try {
    const { data, error } = await supabase.from("app_config").select("cancel_banner_enabled");
    if (!error && Array.isArray(data)) bannerEnabled = !data.some((row) => row.cancel_banner_enabled === false);
  } catch (_) {}
  return bannerEnabled;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/subscription-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!UUID_REGEX.test(String(userId))) return res.status(400).json({ success: false, message: "Invalid userId" });
    const { data: user, error } = await supabase
      .from("users")
      .select("is_pro, is_in_trial, subscription_cancelled_at, subscription_expires_at")
      .eq("id", userId)
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, message: "Failed to read user" });
    const cancelBanner = (await isCancelBannerEnabled()) ? cancelBannerState(user) : { show: false, expiresAt: null, daysLeft: null };
    return res.json({ success: true, cancelBanner });
  } catch (error) {
    console.error("❌ [SUBSCRIPTION_STATUS]", error?.message);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
