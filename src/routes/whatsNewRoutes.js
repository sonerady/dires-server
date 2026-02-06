const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");

/**
 * What's New Modal Kontrolü
 *
 * Bu endpoint, kullanıcının "What's New" modalını görüp görmemesi gerektiğini belirler.
 * Sadece güncelleme yayınlandıktan SONRA kayıt olmuş kullanıcılara modal gösterilir.
 * Eski kullanıcılara (güncelleme öncesi kayıt olanlara) gösterilmez.
 */

// Güncelleme yayınlanma tarihi - Bu tarihi her güncelleme için değiştir
// Bu tarihten SONRA kayıt olan kullanıcılar modalı görecek
const WHATS_NEW_CUTOFF_DATE = "2026-02-06T00:00:00.000Z"; // 6 Şubat 2026

/**
 * GET /api/whats-new/should-show
 *
 * Query params:
 * - userId: Kullanıcı ID'si
 * - appVersion: Uygulama versiyonu (opsiyonel, gelecekte kullanılabilir)
 *
 * Response:
 * - showWhatsNew: boolean - Modal gösterilmeli mi?
 * - reason: string - Neden gösterilip gösterilmediği (debug için)
 */
router.get("/should-show", async (req, res) => {
  try {
    const { userId, appVersion } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
        showWhatsNew: false,
      });
    }

    console.log(`🆕 [WHATS_NEW] Checking for user: ${userId}, appVersion: ${appVersion}`);

    // Kullanıcının kayıt tarihini al
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("created_at, id")
      .eq("id", userId)
      .single();

    if (userError || !userData) {
      console.log(`🆕 [WHATS_NEW] User not found: ${userId}`, userError);
      return res.json({
        success: true,
        showWhatsNew: false,
        reason: "user_not_found",
      });
    }

    const userCreatedAt = new Date(userData.created_at);
    const cutoffDate = new Date(WHATS_NEW_CUTOFF_DATE);

    console.log(`🆕 [WHATS_NEW] User created at: ${userCreatedAt.toISOString()}`);
    console.log(`🆕 [WHATS_NEW] Cutoff date: ${cutoffDate.toISOString()}`);

    // Kullanıcı güncelleme tarihinden SONRA mı kayıt olmuş?
    if (userCreatedAt >= cutoffDate) {
      // Yeni kullanıcı - modal göster
      console.log(`🆕 [WHATS_NEW] ✅ New user - should show modal`);
      return res.json({
        success: true,
        showWhatsNew: true,
        reason: "new_user",
        userCreatedAt: userData.created_at,
        cutoffDate: WHATS_NEW_CUTOFF_DATE,
      });
    } else {
      // Eski kullanıcı - modal gösterme
      console.log(`🆕 [WHATS_NEW] ❌ Existing user - should NOT show modal`);
      return res.json({
        success: true,
        showWhatsNew: false,
        reason: "existing_user",
        userCreatedAt: userData.created_at,
        cutoffDate: WHATS_NEW_CUTOFF_DATE,
      });
    }
  } catch (error) {
    console.error("🆕 [WHATS_NEW] Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      showWhatsNew: false,
    });
  }
});

/**
 * POST /api/whats-new/update-cutoff
 *
 * Admin endpoint - Cutoff tarihini güncelle (opsiyonel, gelecekte kullanılabilir)
 * Şimdilik sadece kod içinde sabit olarak tanımlı
 */
router.post("/update-cutoff", async (req, res) => {
  // Bu endpoint gelecekte admin panelinden cutoff tarihini güncellemek için kullanılabilir
  return res.status(501).json({
    success: false,
    error: "Not implemented. Update WHATS_NEW_CUTOFF_DATE in whatsNewRoutes.js manually.",
  });
});

module.exports = router;
